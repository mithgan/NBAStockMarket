from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select

from nba_stock_market.api.auth import Principal
from nba_stock_market.api.database import (
    AccountRow,
    Database,
    HoldingRow,
    ReplayEventRow,
    TradeRow,
    utcnow,
)
from nba_stock_market.api.service import KeyedLockRegistry
from nba_stock_market.engine import STARTING_CASH


STARTING_CASH_CENTS = round(STARTING_CASH * 100)


def trade_headers(auth: dict[str, str], key: str) -> dict[str, str]:
    return {**auth, "Idempotency-Key": key}


def test_health_is_public(client: TestClient) -> None:
    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"data": {"status": "ok", "service": "nba-stock-market-api"}}


def test_readiness_checks_database(client: TestClient) -> None:
    response = client.get("/readyz")

    assert response.status_code == 200
    assert response.json() == {"data": {"status": "ready"}}


def test_readiness_fails_closed_when_database_is_unavailable(
    client: TestClient,
    database: Database,
    monkeypatch,
) -> None:
    def unavailable() -> None:
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(database, "assert_ready", unavailable)

    response = client.get("/readyz")

    assert response.status_code == 503
    assert response.json() == {"data": {"status": "unavailable"}}


def test_market_requires_authentication(client: TestClient) -> None:
    response = client.get("/api/v1/market")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


def test_bootstrap_is_atomic_and_never_exposes_unsettled_results(
    client: TestClient,
    alice_headers: dict[str, str],
    database: Database,
) -> None:
    assert client.get("/api/v1/bootstrap").status_code == 401
    with database.session() as session, session.begin():
        session.add(
            ReplayEventRow(
                game_date=date(2025, 10, 22),
                player_id="sga",
                actual_net_points_micros=99_000_000,
                expected_net_points_micros=1_000_000,
                dividend_cents=392_000_000,
                actual_minutes_micros=40_000_000,
                projected_minutes_micros=30_000_000,
                qualifies_for_instruments=True,
            )
        )

    before = client.get("/api/v1/bootstrap", headers=alice_headers)
    assert before.status_code == 200
    assert before.json()["data"]["settled_results"] == []

    client.app.state.market_service.settle_next(
        expected_game_date=date(2025, 10, 21),
        idempotency_key="bootstrap-settlement-0001",
    )
    after = client.get("/api/v1/bootstrap", headers=alice_headers)

    assert after.status_code == 200
    payload = after.json()["data"]
    assert set(payload) == {
        "activity",
        "game",
        "leaderboard",
        "market",
        "portfolio",
        "portfolio_history",
        "settled_results",
        "settlements",
    }
    assert [row["game_date"] for row in payload["settled_results"]] == [
        "2025-10-21"
    ]
    assert payload["game"]["next_game_date"] == "2025-10-22"
    assert payload["market"][0]["current_price_cents"] > 0
    assert payload["leaderboard"][0]["account_id"] == "alice"

    unchanged = client.get(
        "/api/v1/bootstrap?settled_results_after=2025-10-21",
        headers=alice_headers,
    )
    assert unchanged.status_code == 200
    assert unchanged.json()["data"]["settled_results"] == []

    client.app.state.market_service.settle_next(
        expected_game_date=date(2025, 10, 22),
        idempotency_key="bootstrap-settlement-0002",
    )
    incremental = client.get(
        "/api/v1/bootstrap?settled_results_after=2025-10-21",
        headers=alice_headers,
    )
    assert incremental.status_code == 200
    assert [
        row["game_date"] for row in incremental.json()["data"]["settled_results"]
    ] == ["2025-10-22"]

    trade = client.post(
        "/api/v1/trades",
        headers=trade_headers(alice_headers, "bootstrap-trade-0001"),
        json={
            "player_id": "one-share",
            "side": "buy",
            "settled_results_after": "2025-10-22",
        },
    )
    assert trade.status_code == 201
    assert trade.json()["data"]["bootstrap"]["settled_results"] == []
    assert trade.json()["data"]["bootstrap"]["portfolio"]["holdings"][0][
        "player_id"
    ] == "one-share"


def test_trade_acknowledgement_survives_a_post_commit_snapshot_failure(
    client: TestClient,
    database: Database,
    monkeypatch,
) -> None:
    service = client.app.state.market_service

    def fail_snapshot(*_args, **_kwargs):
        raise RuntimeError("snapshot unavailable")

    monkeypatch.setattr(service, "_bootstrap_payload", fail_snapshot)

    result = service.execute_trade(
        Principal(id="alice", display_name="Alice"),
        player_id="one-share",
        side="buy",
        idempotency_key="post-commit-snapshot-failure-0001",
    )

    with database.snapshot_session() as session:
        assert session.scalar(select(TradeRow)) is not None
        assert session.scalar(select(HoldingRow)) is not None
    assert "bootstrap" not in result


def test_non_json_trade_body_returns_serializable_validation_error(
    client: TestClient,
    alice_headers: dict[str, str],
) -> None:
    response = client.post(
        "/api/v1/trades",
        headers={
            **trade_headers(alice_headers, "invalid-body-0001"),
            "Content-Type": "text/plain",
        },
        content=b"not-json",
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_non_utf8_trade_body_returns_serializable_validation_error(
    client: TestClient,
    alice_headers: dict[str, str],
) -> None:
    response = client.post(
        "/api/v1/trades",
        headers={
            **trade_headers(alice_headers, "invalid-binary-0001"),
            "Content-Type": "text/plain",
        },
        content=b"\xff",
    )

    assert response.status_code == 422
    payload = response.json()["error"]
    assert payload["code"] == "validation_error"
    assert all("input" not in detail for detail in payload["details"])


def test_player_id_rejects_database_control_characters(
    client: TestClient,
    alice_headers: dict[str, str],
) -> None:
    response = client.post(
        "/api/v1/trades",
        headers=trade_headers(alice_headers, "invalid-player-0001"),
        json={"player_id": "sga\u0000other", "side": "buy"},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_first_authenticated_read_creates_starting_portfolio(
    client: TestClient,
    alice_headers: dict[str, str],
) -> None:
    market = client.get("/api/v1/market", headers=alice_headers)
    portfolio = client.get("/api/v1/portfolio", headers=alice_headers)

    assert market.status_code == 200
    assert [item["id"] for item in market.json()["data"]] == ["jokic", "one-share", "sga"]
    assert portfolio.status_code == 200
    portfolio_data = portfolio.json()["data"]
    assert portfolio_data == {
        "account_id": "alice",
        "display_name": "Alice",
        "version": 0,
        "reset_at": portfolio_data["reset_at"],
        "cash_cents": STARTING_CASH_CENTS,
        "free_cash_cents": STARTING_CASH_CENTS,
        "reserved_collateral_cents": 0,
        "market_value_cents": 0,
        "total_value_cents": STARTING_CASH_CENTS,
        "holdings": [],
        "recent_trades": [],
        "instruments": {
            "week_start": "2025-10-20",
            "reserved_collateral_cents": 0,
            "free_cash_cents": STARTING_CASH_CENTS,
            "weekly_short_slots": {"limit": 3, "used": 0, "remaining": 3},
            "boost_slots": {"limit": 2, "used": 0, "remaining": 2},
            "weekly_shorts": [],
            "boosts": [],
            "weekly_short_targets": [
                {
                    "player_id": "sga",
                    "game_date": "2025-10-21",
                    "fee_cents": 12_500_000,
                },
            ],
            "boost_targets": [],
        },
    }
    assert portfolio_data["reset_at"].endswith("Z")


def test_buy_and_sell_are_server_authoritative_and_charge_fees(
    client: TestClient,
    alice_headers: dict[str, str],
) -> None:
    buy = client.post(
        "/api/v1/trades",
        headers=trade_headers(alice_headers, "buy-sga-0001"),
        json={"player_id": "sga", "side": "buy"},
    )

    assert buy.status_code == 201
    buy_data = buy.json()["data"]
    assert buy_data["replayed"] is False
    assert buy_data["trade"]["execution_price_cents"] == 5_000_000_000
    assert buy_data["trade"]["fee_cents"] == 12_500_000
    assert buy_data["trade"]["new_price_cents"] > 5_000_000_000
    assert buy_data["portfolio"]["cash_cents"] == STARTING_CASH_CENTS - 5_012_500_000
    assert buy_data["portfolio"]["holdings"][0]["player_id"] == "sga"

    sell = client.post(
        "/api/v1/trades",
        headers=trade_headers(alice_headers, "sell-sga-0001"),
        json={"player_id": "sga", "side": "sell"},
    )

    assert sell.status_code == 201
    sell_data = sell.json()["data"]
    assert sell_data["trade"]["side"] == "sell"
    assert sell_data["trade"]["fee_cents"] > sell_data["trade"]["execution_price_cents"] * 0.0025
    assert sell_data["portfolio"]["holdings"] == []


def test_market_quotes_the_exact_account_specific_rebuy_fee(
    client: TestClient,
    alice_headers: dict[str, str],
) -> None:
    buy = client.post(
        "/api/v1/trades",
        headers=trade_headers(alice_headers, "quote-buy-sga-0001"),
        json={"player_id": "sga", "side": "buy"},
    )
    assert buy.status_code == 201
    sell = client.post(
        "/api/v1/trades",
        headers=trade_headers(alice_headers, "quote-sell-sga-0001"),
        json={"player_id": "sga", "side": "sell"},
    )
    assert sell.status_code == 201

    market = client.get("/api/v1/market", headers=alice_headers)
    assert market.status_code == 200
    sga = next(row for row in market.json()["data"] if row["id"] == "sga")
    assert sga["buy_fee_cents"] > round(sga["current_price_cents"] * 0.0025)

    rebuy = client.post(
        "/api/v1/trades",
        headers=trade_headers(alice_headers, "quote-rebuy-sga-0001"),
        json={"player_id": "sga", "side": "buy"},
    )
    assert rebuy.status_code == 201
    assert rebuy.json()["data"]["trade"]["fee_cents"] == sga["buy_fee_cents"]


def test_trade_idempotency_replays_once_and_rejects_body_reuse(
    client: TestClient,
    alice_headers: dict[str, str],
) -> None:
    headers = trade_headers(alice_headers, "same-request-0001")
    first = client.post(
        "/api/v1/trades",
        headers=headers,
        json={"player_id": "sga", "side": "buy"},
    )
    replay = client.post(
        "/api/v1/trades",
        headers=headers,
        json={"player_id": "sga", "side": "buy"},
    )
    conflict = client.post(
        "/api/v1/trades",
        headers=headers,
        json={"player_id": "jokic", "side": "buy"},
    )

    assert first.status_code == 201
    assert replay.status_code == 200
    assert replay.json()["data"]["replayed"] is True
    assert replay.json()["data"]["trade"]["id"] == first.json()["data"]["trade"]["id"]
    assert replay.json()["data"]["portfolio"] == first.json()["data"]["portfolio"]
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "idempotency_conflict"


def test_holding_cap_unknown_player_and_insufficient_cash_are_conflicts(
    client: TestClient,
    database: Database,
    alice_headers: dict[str, str],
) -> None:
    first = client.post(
        "/api/v1/trades",
        headers=trade_headers(alice_headers, "cap-buy-0001"),
        json={"player_id": "sga", "side": "buy"},
    )
    duplicate_holding = client.post(
        "/api/v1/trades",
        headers=trade_headers(alice_headers, "cap-buy-0002"),
        json={"player_id": "sga", "side": "buy"},
    )
    unknown = client.post(
        "/api/v1/trades",
        headers=trade_headers(alice_headers, "unknown-0001"),
        json={"player_id": "missing", "side": "buy"},
    )
    with database.session() as session, session.begin():
        account = session.get(AccountRow, "alice")
        assert account is not None
        account.cash_cents = 0
    too_expensive = client.post(
        "/api/v1/trades",
        headers=trade_headers(alice_headers, "cash-buy-0001"),
        json={"player_id": "jokic", "side": "buy"},
    )

    assert first.status_code == 201
    assert duplicate_holding.status_code == 409
    assert duplicate_holding.json()["error"]["code"] == "holding_cap"
    assert unknown.status_code == 404
    assert unknown.json()["error"]["code"] == "player_not_found"
    assert too_expensive.status_code == 409
    assert too_expensive.json()["error"]["code"] == "insufficient_cash"


def test_concurrent_buyers_cannot_oversell_player_float(client: TestClient) -> None:
    def buy(token: str, key: str):
        return client.post(
            "/api/v1/trades",
            headers={"Authorization": f"Bearer {token}", "Idempotency-Key": key},
            json={"player_id": "one-share", "side": "buy"},
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(
            executor.map(
                lambda args: buy(*args),
                [("alice-token", "float-alice-0001"), ("bob-token", "float-bob-0001")],
            )
        )

    assert sorted(response.status_code for response in responses) == [201, 409]
    failed = next(response for response in responses if response.status_code == 409)
    assert failed.json()["error"]["code"] == "float_exhausted"


def test_leaderboard_uses_current_portfolio_values(
    client: TestClient,
    alice_headers: dict[str, str],
) -> None:
    client.get("/api/v1/portfolio", headers={"Authorization": "Bearer bob-token"})
    client.post(
        "/api/v1/trades",
        headers=trade_headers(alice_headers, "leader-buy-0001"),
        json={"player_id": "sga", "side": "buy"},
    )

    response = client.get("/api/v1/leaderboard", headers=alice_headers)

    assert response.status_code == 200
    rows = response.json()["data"]
    assert [row["rank"] for row in rows] == [1, 2]
    assert {row["account_id"] for row in rows} == {"alice", "bob"}
    assert next(row for row in rows if row["account_id"] == "alice")["is_current_user"] is True


def test_local_lock_registry_has_fixed_memory() -> None:
    registry = KeyedLockRegistry(stripe_count=8)

    for index in range(10_000):
        with registry.acquire(f"untrusted-key:{index}"):
            pass

    assert registry.stripe_count == 8


def test_market_volume_expires_trades_older_than_30_days(
    client: TestClient,
    alice_headers: dict[str, str],
    database: Database,
) -> None:
    buy = client.post(
        "/api/v1/trades",
        headers=trade_headers(alice_headers, "volume-buy-0001"),
        json={"player_id": "sga", "side": "buy"},
    )
    assert buy.status_code == 201
    current = client.get("/api/v1/market", headers=alice_headers)
    current_sga = next(row for row in current.json()["data"] if row["id"] == "sga")
    assert current_sga["volume_30d"] == 1

    with database.session() as session, session.begin():
        trade = session.scalar(select(TradeRow).where(TradeRow.player_id == "sga"))
        assert trade is not None
        trade.created_at = utcnow() - timedelta(days=31)

    expired = client.get("/api/v1/market", headers=alice_headers)
    expired_sga = next(row for row in expired.json()["data"] if row["id"] == "sga")
    assert expired_sga["volume_30d"] == 0
