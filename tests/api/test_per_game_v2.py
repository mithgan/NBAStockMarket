from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from nba_stock_market.api.database import (
    AccountRow,
    Database,
    PerGameAccountRow,
    PerGameCommandRow,
    PerGamePositionRow,
    PerGameQuoteRow,
    PerGameRulesetRow,
)
from nba_stock_market.api.per_game_service import PerGameService
from nba_stock_market.api.service import ApiProblem


def position_headers(
    auth_headers: dict[str, str], idempotency_key: str
) -> dict[str, str]:
    return {**auth_headers, "Idempotency-Key": idempotency_key}


def test_v2_bootstrap_creates_an_isolated_zero_pnl_account(
    client: TestClient,
    database: Database,
    alice_headers: dict[str, str],
) -> None:
    response = client.get("/api/v2/bootstrap", headers=alice_headers)

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["schema_version"] == 2
    assert data["account"] == {
        "account_id": "alice",
        "display_name": "Alice",
        "version": 0,
        "cumulative_pnl_dollars": 0,
        "latest_game_pnl_dollars": 0,
        "long_slots": {"used": 0, "limit": 10, "remaining": 10},
        "short_slots": {"used": 0, "limit": 5, "remaining": 5},
    }
    assert data["positions"] == []
    assert data["ledger"] == {"items": [], "next_cursor": None}
    assert data["game"]["event_cursor"] == 0
    assert data["ruleset"]["dividend_basis"] == "raw_net_points"
    assert {row["player_id"] for row in data["market"]} == {
        "sga",
        "jokic",
        "one-share",
    }
    assert all(row["current_game_cost_dollars"] > 0 for row in data["market"])
    assert data["leaderboard"][0]["cumulative_pnl_dollars"] == 0
    assert data["leaderboard"][0]["is_current_user"] is True

    with database.session() as session:
        assert session.scalar(select(func.count()).select_from(AccountRow)) == 0
        account = session.get(
            PerGameAccountRow,
            {"ruleset_id": "per-game-v2-staging", "account_id": "alice"},
        )
        assert account is not None
        assert account.cumulative_pnl_dollars == 0


def test_v2_routes_require_authentication(client: TestClient) -> None:
    assert client.get("/api/v2/bootstrap").status_code == 401
    assert (
        client.post(
            "/api/v2/positions",
            headers={"Idempotency-Key": "unauth-open-0001"},
            json={
                "player_id": "sga",
                "side": "long",
                "expected_account_version": 0,
                "expected_quote_version": 0,
            },
        ).status_code
        == 401
    )


def test_v2_meta_identifies_the_public_contract_without_authentication(
    client: TestClient,
) -> None:
    response = client.get("/api/v2/meta")

    assert response.status_code == 200
    assert response.json() == {
        "data": {
            "service": "nba-stock-market-api",
            "api_version": "v2",
            "schema_version": 2,
            "economy": "per_game",
        }
    }


def test_postgres_bootstrap_fails_closed_on_a_partial_quote_seed(
    client: TestClient,
    database: Database,
    alice_headers: dict[str, str],
) -> None:
    assert client.get("/api/v2/bootstrap", headers=alice_headers).status_code == 200
    with database.session() as session, session.begin():
        quote = session.get(
            PerGameQuoteRow,
            {"ruleset_id": "per-game-v2-staging", "player_id": "sga"},
        )
        assert quote is not None
        session.delete(quote)

    service = PerGameService(database)
    with database.session() as session:
        assert session.bind is not None
        original_dialect_name = session.bind.dialect.name
        session.bind.dialect.name = "postgresql"
        try:
            with pytest.raises(ApiProblem) as raised:
                service._ensure_environment(session)
        finally:
            session.bind.dialect.name = original_dialect_name

    assert raised.value.status_code == 503
    assert raised.value.code == "quotes_unavailable"


def test_open_and_drop_are_versioned_locked_and_idempotent(
    client: TestClient,
    database: Database,
    alice_headers: dict[str, str],
) -> None:
    bootstrap = client.get("/api/v2/bootstrap", headers=alice_headers).json()["data"]
    opening_quote = next(
        row for row in bootstrap["market"] if row["player_id"] == "sga"
    )

    request = {
        "player_id": "sga",
        "side": "long",
        "expected_account_version": 0,
        "expected_quote_version": opening_quote["quote_version"],
    }
    headers = position_headers(alice_headers, "v2-open-sga-0001")
    opened = client.post("/api/v2/positions", headers=headers, json=request)

    assert opened.status_code == 201
    opened_data = opened.json()["data"]
    assert opened_data["replayed"] is False
    assert opened_data["account_version"] == 1
    assert (
        opened_data["locked_game_cost_dollars"]
        == opening_quote["current_game_cost_dollars"]
    )
    assert (
        opened_data["current_game_cost_dollars"]
        > opened_data["locked_game_cost_dollars"]
    )
    position_id = opened_data["position_id"]

    replay = client.post("/api/v2/positions", headers=headers, json=request)
    assert replay.status_code == 200
    assert replay.json()["data"]["replayed"] is True
    assert replay.json()["data"]["position_id"] == position_id

    conflict = client.post(
        "/api/v2/positions",
        headers=headers,
        json={**request, "player_id": "jokic"},
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "idempotency_conflict"

    duplicate = client.post(
        "/api/v2/positions",
        headers=position_headers(alice_headers, "v2-open-sga-0002"),
        json={
            **request,
            "expected_account_version": 1,
            "expected_quote_version": 1,
        },
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "position_exists"

    stale = client.post(
        "/api/v2/positions",
        headers=position_headers(alice_headers, "v2-open-jokic-stale"),
        json={
            "player_id": "jokic",
            "side": "long",
            "expected_account_version": 0,
            "expected_quote_version": 0,
        },
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "stale_account_version"

    closed = client.request(
        "DELETE",
        f"/api/v2/positions/{position_id}",
        headers=position_headers(alice_headers, "v2-close-sga-0001"),
        json={"expected_account_version": 1},
    )
    assert closed.status_code == 200
    closed_data = closed.json()["data"]
    assert closed_data["position"]["status"] == "closed"
    assert closed_data["position"]["closed_event_sequence"] == 0
    assert closed_data["account_version"] == 2

    after = client.get("/api/v2/bootstrap", headers=alice_headers).json()["data"]
    assert after["account"]["long_slots"]["used"] == 0
    assert after["positions"][0]["locked_game_cost_dollars"] == opening_quote[
        "current_game_cost_dollars"
    ]
    assert after["positions"][0]["status"] == "closed"

    with database.session() as session:
        assert (
            session.scalar(select(func.count()).select_from(PerGamePositionRow)) == 1
        )
        assert (
            session.scalar(select(func.count()).select_from(PerGameCommandRow)) == 2
        )


def test_slot_limits_and_opposing_positions_are_transactional(
    client: TestClient,
    database: Database,
    alice_headers: dict[str, str],
) -> None:
    client.get("/api/v2/bootstrap", headers=alice_headers)
    with database.session() as session, session.begin():
        ruleset = session.get(PerGameRulesetRow, "per-game-v2-staging")
        assert ruleset is not None
        ruleset.long_slot_limit = 1

    first = client.post(
        "/api/v2/positions",
        headers=position_headers(alice_headers, "v2-one-long-0001"),
        json={
            "player_id": "sga",
            "side": "long",
            "expected_account_version": 0,
            "expected_quote_version": 0,
        },
    )
    assert first.status_code == 201

    full = client.post(
        "/api/v2/positions",
        headers=position_headers(alice_headers, "v2-second-long-0001"),
        json={
            "player_id": "jokic",
            "side": "long",
            "expected_account_version": 1,
            "expected_quote_version": 0,
        },
    )
    assert full.status_code == 409
    assert full.json()["error"]["code"] == "roster_full"

    opposing = client.post(
        "/api/v2/positions",
        headers=position_headers(alice_headers, "v2-opposing-0001"),
        json={
            "player_id": "sga",
            "side": "short",
            "expected_account_version": 1,
            "expected_quote_version": 1,
        },
    )
    assert opposing.status_code == 409
    assert opposing.json()["error"]["code"] == "opposing_position"


def test_open_rejects_a_stale_displayed_quote_before_locking_cost(
    client: TestClient,
    database: Database,
    alice_headers: dict[str, str],
) -> None:
    alice_bootstrap = client.get(
        "/api/v2/bootstrap", headers=alice_headers
    ).json()["data"]
    displayed = next(
        row for row in alice_bootstrap["market"] if row["player_id"] == "sga"
    )
    first = client.post(
        "/api/v2/positions",
        headers=position_headers(alice_headers, "v2-quote-lock-alice"),
        json={
            "player_id": "sga",
            "side": "long",
            "expected_account_version": 0,
            "expected_quote_version": displayed["quote_version"],
        },
    )
    assert first.status_code == 201

    stale = client.post(
        "/api/v2/positions",
        headers=position_headers(
            {"Authorization": "Bearer bob-token"}, "v2-quote-lock-bob-stale"
        ),
        json={
            "player_id": "sga",
            "side": "long",
            "expected_account_version": 0,
            "expected_quote_version": displayed["quote_version"],
        },
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "quote_conflict"

    refreshed = client.get(
        "/api/v2/bootstrap",
        headers={"Authorization": "Bearer bob-token"},
    ).json()["data"]
    current = next(
        row for row in refreshed["market"] if row["player_id"] == "sga"
    )
    assert current["quote_version"] == displayed["quote_version"] + 1
    assert refreshed["positions"] == []

    accepted = client.post(
        "/api/v2/positions",
        headers=position_headers(
            {"Authorization": "Bearer bob-token"}, "v2-quote-lock-bob-fresh"
        ),
        json={
            "player_id": "sga",
            "side": "long",
            "expected_account_version": 0,
            "expected_quote_version": current["quote_version"],
        },
    )
    assert accepted.status_code == 201
    assert accepted.json()["data"]["locked_game_cost_dollars"] == current[
        "current_game_cost_dollars"
    ]

    with database.session() as session:
        bob_positions = session.scalars(
            select(PerGamePositionRow).where(
                PerGamePositionRow.account_id == "bob"
            )
        ).all()
        assert len(bob_positions) == 1


def test_v2_does_not_change_v1_portfolio_contract(
    client: TestClient,
    alice_headers: dict[str, str],
) -> None:
    client.get("/api/v2/bootstrap", headers=alice_headers)

    v1 = client.get("/api/v1/bootstrap", headers=alice_headers)

    assert v1.status_code == 200
    assert set(v1.json()["data"]) == {
        "market",
        "portfolio",
        "game",
        "activity",
        "portfolio_history",
        "settlements",
        "leaderboard",
        "settled_results",
    }
    assert v1.json()["data"]["portfolio"]["cash_cents"] == 14_000_000_000


def test_concurrent_duplicate_open_is_persisted_once(
    client: TestClient,
    database: Database,
    alice_headers: dict[str, str],
) -> None:
    client.get("/api/v2/bootstrap", headers=alice_headers)
    headers = position_headers(alice_headers, "v2-concurrent-open")
    body = {
        "player_id": "sga",
        "side": "long",
        "expected_account_version": 0,
        "expected_quote_version": 0,
    }

    def issue_request() -> tuple[int, dict[str, object]]:
        response = client.post("/api/v2/positions", headers=headers, json=body)
        return response.status_code, response.json()["data"]

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: issue_request(), range(2)))

    assert sorted(status for status, _ in results) == [200, 201]
    assert len({payload["position_id"] for _, payload in results}) == 1
    assert sorted(payload["replayed"] for _, payload in results) == [False, True]

    with database.session() as session:
        assert (
            session.scalar(select(func.count()).select_from(PerGamePositionRow)) == 1
        )
        assert (
            session.scalar(select(func.count()).select_from(PerGameCommandRow)) == 1
        )


def test_database_rejects_duplicate_active_same_side_position(
    client: TestClient,
    database: Database,
    alice_headers: dict[str, str],
) -> None:
    client.get("/api/v2/bootstrap", headers=alice_headers)
    opened = client.post(
        "/api/v2/positions",
        headers=position_headers(alice_headers, "v2-unique-active-open"),
        json={
            "player_id": "sga",
            "side": "long",
            "expected_account_version": 0,
            "expected_quote_version": 0,
        },
    )
    assert opened.status_code == 201

    with database.session() as session:
        original = session.get(PerGamePositionRow, opened.json()["data"]["position_id"])
        assert original is not None
        duplicate = {
            "id": "duplicate-active-position",
            "ruleset_id": original.ruleset_id,
            "account_id": original.account_id,
            "player_id": original.player_id,
            "side": original.side,
            "status": "active",
            "locked_game_cost_dollars": original.locked_game_cost_dollars,
            "opened_event_sequence": original.opened_event_sequence,
        }

    with pytest.raises(IntegrityError):
        with database.session() as session, session.begin():
            session.add(PerGamePositionRow(**duplicate))
