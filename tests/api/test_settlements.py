from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime
from threading import Event

from fastapi.testclient import TestClient
from pydantic import SecretStr
import pytest
from sqlalchemy import func, select

from nba_stock_market.api.app import create_app
from nba_stock_market.api.auth import Principal
from nba_stock_market.api.database import (
    AccountActivityRow,
    AccountRow,
    Database,
    DividendRow,
    GameStateRow,
    SeedPlayer,
    SeedReplayEvent,
    SettlementRow,
)
from nba_stock_market.api.service import MarketService
from nba_stock_market.api.settings import ApiSettings
from nba_stock_market.engine import STARTING_CASH
from tests.api.conftest import FixtureTokenVerifier


ADMIN_KEY = "test-settlement-admin-key-at-least-32"
STARTING_CASH_CENTS = round(STARTING_CASH * 100)


@pytest.fixture
def settlement_database(tmp_path) -> Database:
    database = Database(f"sqlite+pysqlite:///{tmp_path / 'settlement.db'}")
    database.create_schema()
    database.seed_players(
        [
            SeedPlayer(
                id="sga",
                name="Shai Gilgeous-Alexander",
                tier="star",
                current_price_cents=5_000_000_000,
                opening_price_cents=5_000_000_000,
                actual_salary_cents=4_080_615_000,
            ),
            SeedPlayer(
                id="jokic",
                name="Nikola Jokic",
                tier="star",
                current_price_cents=7_000_000_000,
                opening_price_cents=7_000_000_000,
                actual_salary_cents=5_903_311_400,
            ),
        ]
    )
    database.seed_replay_events(
        season_id="2025-26",
        events=[
            SeedReplayEvent(
                game_date=date(2025, 10, 21),
                player_id="jokic",
                actual_net_points_micros=20_000_000,
                expected_net_points_micros=25_000_000,
                dividend_cents=-40_000_000,
            ),
            SeedReplayEvent(
                game_date=date(2025, 10, 21),
                player_id="sga",
                actual_net_points_micros=40_000_000,
                expected_net_points_micros=20_000_000,
                dividend_cents=160_000_000,
            ),
            SeedReplayEvent(
                game_date=date(2025, 10, 22),
                player_id="sga",
                actual_net_points_micros=5_000_000,
                expected_net_points_micros=20_000_000,
                dividend_cents=-120_000_000,
            ),
        ],
    )
    yield database
    database.dispose()


@pytest.fixture
def settlement_client(settlement_database: Database) -> TestClient:
    app = create_app(
        settings=ApiSettings(
            database_url=settlement_database.url,
            environment="test",
            settlement_admin_key=SecretStr(ADMIN_KEY),
        ),
        database=settlement_database,
        token_verifier=FixtureTokenVerifier(
            {
                "alice-token": Principal(id="alice", display_name="Alice"),
                "bob-token": Principal(id="bob", display_name="Bob"),
            }
        ),
    )
    with TestClient(app) as client:
        yield client


def auth(token: str = "alice-token") -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def admin(key: str, idempotency_key: str) -> dict[str, str]:
    return {"X-Settlement-Key": key, "Idempotency-Key": idempotency_key}


def settle(
    client: TestClient,
    *,
    expected_date: str,
    key: str,
    admin_key: str = ADMIN_KEY,
):
    return client.post(
        "/api/v1/admin/settlements/next",
        headers=admin(admin_key, key),
        json={"expected_game_date": expected_date},
    )


def buy_sga(client: TestClient, token: str = "alice-token") -> None:
    response = client.post(
        "/api/v1/trades",
        headers={**auth(token), "Idempotency-Key": f"buy-sga-{token}"},
        json={"player_id": "sga", "side": "buy"},
    )
    assert response.status_code == 201


def test_game_state_and_history_require_player_authentication(
    settlement_client: TestClient,
) -> None:
    assert settlement_client.get("/api/v1/game").status_code == 401
    assert settlement_client.get("/api/v1/settlements").status_code == 401

    state = settlement_client.get("/api/v1/game", headers=auth())
    history = settlement_client.get("/api/v1/settlements", headers=auth())

    assert state.status_code == 200
    assert state.json()["data"] == {
        "season_id": "2025-26",
        "last_settled_date": None,
        "next_game_date": "2025-10-21",
        "is_complete": False,
        "version": 0,
    }
    assert history.status_code == 200
    assert history.json() == {"data": []}


def test_local_replay_seed_is_idempotent_but_rejects_conflicting_events(
    settlement_database: Database,
) -> None:
    identical = SeedReplayEvent(
        game_date=date(2025, 10, 21),
        player_id="sga",
        actual_net_points_micros=40_000_000,
        expected_net_points_micros=20_000_000,
        dividend_cents=160_000_000,
    )
    settlement_database.seed_replay_events(
        season_id="2025-26",
        events=[identical],
    )

    with pytest.raises(ValueError, match="conflicts with an existing event"):
        settlement_database.seed_replay_events(
            season_id="2025-26",
            events=[
                SeedReplayEvent(
                    game_date=identical.game_date,
                    player_id=identical.player_id,
                    actual_net_points_micros=identical.actual_net_points_micros,
                    expected_net_points_micros=identical.expected_net_points_micros,
                    dividend_cents=identical.dividend_cents + 1,
                )
            ],
        )


def test_bulk_activity_insert_chunks_and_remains_idempotent_on_sqlite(
    settlement_database: Database,
) -> None:
    service = MarketService(settlement_database)
    principal = Principal(id="alice", display_name="Alice")
    service.bootstrap(principal)
    occurred_at = datetime(2025, 10, 21, 12, tzinfo=UTC)
    rows = [
        {
            "account_id": principal.id,
            "kind": "dividend",
            "player_id": None,
            "game_date": date(2025, 10, 21),
            "amount_cents": index,
            "source_key": f"chunk-test:{index}",
            "details": {"index": index},
            "occurred_at": occurred_at,
        }
        for index in range(250)
    ]

    with settlement_database.market_write_transaction(
        settlement_exclusive=False
    ) as session:
        service._record_activities(session, rows)
        service._record_activities(session, rows)

    with settlement_database.session() as session:
        count = session.scalar(
            select(func.count())
            .select_from(AccountActivityRow)
            .where(AccountActivityRow.account_id == principal.id)
        )
    assert count == 250


def test_settlement_route_is_scheduler_only_and_fails_closed_when_unconfigured(
    settlement_client: TestClient,
    settlement_database: Database,
) -> None:
    missing = settlement_client.post(
        "/api/v1/admin/settlements/next",
        headers={"Idempotency-Key": "missing-admin-key"},
        json={"expected_game_date": "2025-10-21"},
    )
    wrong = settle(
        settlement_client,
        expected_date="2025-10-21",
        key="wrong-admin-key",
        admin_key="not-the-key",
    )
    assert missing.status_code == 401
    assert wrong.status_code == 401

    app = create_app(
        settings=ApiSettings(
            database_url=settlement_database.url,
            environment="test",
        ),
        database=settlement_database,
        token_verifier=FixtureTokenVerifier({}),
    )
    with TestClient(app) as unconfigured:
        response = settle(
            unconfigured,
            expected_date="2025-10-21",
            key="unconfigured-admin",
        )
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "settlement_unavailable"

    empty_key_app = create_app(
        settings=ApiSettings(
            database_url=settlement_database.url,
            environment="test",
            settlement_admin_key=SecretStr(""),
        ),
        database=settlement_database,
        token_verifier=FixtureTokenVerifier({}),
    )
    with TestClient(empty_key_app) as empty_key_configured:
        empty_key_response = empty_key_configured.post(
            "/api/v1/admin/settlements/next",
            headers={"Idempotency-Key": "empty-admin-key"},
            json={"expected_game_date": "2025-10-21"},
        )
    assert empty_key_response.status_code == 503
    assert empty_key_response.json()["error"]["code"] == "settlement_unavailable"

    unicode_app = create_app(
        settings=ApiSettings(
            database_url=settlement_database.url,
            environment="test",
            settlement_admin_key=SecretStr("雪" * 32),
        ),
        database=settlement_database,
        token_verifier=FixtureTokenVerifier({}),
    )
    with TestClient(unicode_app) as unicode_configured:
        rejected = settle(
            unicode_configured,
            expected_date="2025-10-21",
            key="unicode-config-admin",
            admin_key="ascii-wrong-key",
        )
    assert rejected.status_code == 401


def test_daily_settlement_pays_holders_once_and_reconciles_history(
    settlement_client: TestClient,
    settlement_database: Database,
) -> None:
    buy_sga(settlement_client)
    before = settlement_client.get("/api/v1/portfolio", headers=auth()).json()["data"]

    first = settle(
        settlement_client,
        expected_date="2025-10-21",
        key="settle-2025-10-21",
    )
    replay = settle(
        settlement_client,
        expected_date="2025-10-21",
        key="settle-2025-10-21",
    )

    assert first.status_code == 201
    assert replay.status_code == 200
    assert replay.json()["data"] == {**first.json()["data"], "replayed": True}
    payload = first.json()["data"]
    assert payload == {
        "replayed": False,
        "game_date": "2025-10-21",
        "next_game_date": "2025-10-22",
        "is_complete": False,
        "event_count": 2,
        "payout_count": 1,
        "net_cash_cents": 160_000_000,
        "cash_breakdown_cents": {
            "dividends": 160_000_000,
            "boosts": 0,
            "weekly_shorts": 0,
        },
    }

    after = settlement_client.get("/api/v1/portfolio", headers=auth()).json()["data"]
    assert after["cash_cents"] - before["cash_cents"] == 160_000_000
    history = settlement_client.get("/api/v1/settlements", headers=auth()).json()["data"]
    assert history == [
        {
            "game_date": "2025-10-21",
            "event_count": 2,
            "payout_count": 1,
            "net_cash_cents": 160_000_000,
            "current_user_dividend_cents": 160_000_000,
            "settled_at": history[0]["settled_at"],
        }
    ]
    assert history[0]["settled_at"].endswith("Z")

    with settlement_database.session() as session:
        assert session.scalar(select(func.count(DividendRow.account_id))) == 1
        assert session.scalar(select(func.count(SettlementRow.game_date))) == 1


def test_settlement_reconciles_every_holder_and_skips_unowned_events(
    settlement_client: TestClient,
    settlement_database: Database,
) -> None:
    buy_sga(settlement_client, "alice-token")
    buy_sga(settlement_client, "bob-token")

    response = settle(
        settlement_client,
        expected_date="2025-10-21",
        key="settle-two-holders",
    )

    assert response.status_code == 201
    assert response.json()["data"]["payout_count"] == 2
    assert response.json()["data"]["net_cash_cents"] == 320_000_000
    with settlement_database.session() as session:
        rows = session.scalars(
            select(DividendRow).order_by(DividendRow.account_id)
        ).all()
        assert [row.account_id for row in rows] == ["alice", "bob"]
        assert {row.player_id for row in rows} == {"sga"}
        assert sum(row.amount_cents for row in rows) == 320_000_000


def test_stale_expected_date_and_idempotency_misuse_do_not_advance_clock(
    settlement_client: TestClient,
) -> None:
    first = settle(
        settlement_client,
        expected_date="2025-10-21",
        key="clock-guard-0001",
    )
    stale = settle(
        settlement_client,
        expected_date="2025-10-21",
        key="clock-guard-0002",
    )
    misuse = settle(
        settlement_client,
        expected_date="2025-10-22",
        key="clock-guard-0001",
    )

    assert first.status_code == 201
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "clock_conflict"
    assert misuse.status_code == 409
    assert misuse.json()["error"]["code"] == "idempotency_conflict"
    state = settlement_client.get("/api/v1/game", headers=auth()).json()["data"]
    assert state["last_settled_date"] == "2025-10-21"
    assert state["next_game_date"] == "2025-10-22"
    assert state["version"] == 1


def test_concurrent_retries_cannot_double_pay_or_advance_twice(
    settlement_client: TestClient,
    settlement_database: Database,
) -> None:
    buy_sga(settlement_client)

    def request():
        return settle(
            settlement_client,
            expected_date="2025-10-21",
            key="concurrent-settlement",
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda _: request(), range(2)))

    assert sorted(response.status_code for response in responses) == [200, 201]
    assert sorted(response.json()["data"]["replayed"] for response in responses) == [False, True]
    with settlement_database.session() as session:
        assert session.scalar(select(func.count(SettlementRow.game_date))) == 1
        assert session.scalar(select(func.count(DividendRow.account_id))) == 1
        state = session.get(GameStateRow, "historical-2025-26")
        assert state is not None
        assert state.version == 1
        assert state.next_game_date == date(2025, 10, 22)


def test_sqlite_trade_waits_for_settlement_and_observes_post_settlement_state(
    settlement_client: TestClient,
    settlement_database: Database,
    monkeypatch,
) -> None:
    buy_sga(settlement_client)
    service = settlement_client.app.state.market_service
    original_apply = service._apply_dividends
    settlement_entered = Event()
    allow_settlement = Event()
    trade_started = Event()

    def pause_settlement(*args, **kwargs):
        settlement_entered.set()
        assert allow_settlement.wait(timeout=2)
        return original_apply(*args, **kwargs)

    def buy_after_settlement():
        trade_started.set()
        return settlement_client.post(
            "/api/v1/trades",
            headers={**auth("bob-token"), "Idempotency-Key": "buy-jokic-after-day"},
            json={"player_id": "jokic", "side": "buy"},
        )

    monkeypatch.setattr(service, "_apply_dividends", pause_settlement)
    with ThreadPoolExecutor(max_workers=2) as executor:
        settlement_future = executor.submit(
            settle,
            settlement_client,
            expected_date="2025-10-21",
            key="sqlite-settlement-barrier",
        )
        assert settlement_entered.wait(timeout=2)
        trade_future = executor.submit(buy_after_settlement)
        assert trade_started.wait(timeout=2)
        assert not trade_future.done()
        allow_settlement.set()
        settlement_response = settlement_future.result(timeout=2)
        trade_response = trade_future.result(timeout=2)

    assert settlement_response.status_code == 201
    assert trade_response.status_code == 201
    assert (
        trade_response.json()["data"]["portfolio"]["cash_cents"]
        == STARTING_CASH_CENTS - 7_017_500_000
    )
    with settlement_database.session() as session:
        bob_dividends = session.scalar(
            select(func.count(DividendRow.account_id)).where(
                DividendRow.account_id == "bob"
            )
        )
        assert bob_dividends == 0


def test_signed_dividend_can_make_cash_negative_and_blocks_new_buys(
    settlement_client: TestClient,
    settlement_database: Database,
) -> None:
    buy_sga(settlement_client)
    settle(
        settlement_client,
        expected_date="2025-10-21",
        key="negative-cash-day-one",
    )
    with settlement_database.session() as session, session.begin():
        account = session.get(AccountRow, "alice")
        assert account is not None
        account.cash_cents = 10_000_000

    second = settle(
        settlement_client,
        expected_date="2025-10-22",
        key="negative-cash-day-two",
    )
    assert second.status_code == 201
    portfolio = settlement_client.get("/api/v1/portfolio", headers=auth()).json()["data"]
    assert portfolio["cash_cents"] == -110_000_000
    blocked = settlement_client.post(
        "/api/v1/trades",
        headers={**auth(), "Idempotency-Key": "blocked-negative-cash"},
        json={"player_id": "jokic", "side": "buy"},
    )
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "insufficient_cash"


def test_final_settlement_completes_replay_and_rejects_another_advance(
    settlement_client: TestClient,
) -> None:
    first = settle(
        settlement_client,
        expected_date="2025-10-21",
        key="complete-day-one",
    )
    final = settle(
        settlement_client,
        expected_date="2025-10-22",
        key="complete-day-two",
    )
    extra = settle(
        settlement_client,
        expected_date="2025-10-23",
        key="complete-day-three",
    )

    assert first.status_code == 201
    assert final.status_code == 201
    assert final.json()["data"]["next_game_date"] is None
    assert final.json()["data"]["is_complete"] is True
    assert extra.status_code == 409
    assert extra.json()["error"]["code"] == "replay_complete"
    state = settlement_client.get("/api/v1/game", headers=auth()).json()["data"]
    assert state["last_settled_date"] == "2025-10-22"
    assert state["next_game_date"] is None
    assert state["is_complete"] is True
    assert state["version"] == 2

    bootstrap = settlement_client.get("/api/v1/bootstrap", headers=auth())
    assert bootstrap.status_code == 200
    bootstrap_data = bootstrap.json()["data"]
    assert bootstrap_data["game"]["next_game_date"] is None
    assert bootstrap_data["game"]["is_complete"] is True
    assert {
        result["game_date"] for result in bootstrap_data["settled_results"]
    } == {"2025-10-21", "2025-10-22"}


def test_settlement_failure_rolls_back_every_mutation(
    settlement_client: TestClient,
    settlement_database: Database,
    monkeypatch,
) -> None:
    buy_sga(settlement_client)
    before = settlement_client.get("/api/v1/portfolio", headers=auth()).json()["data"]
    service = settlement_client.app.state.market_service

    def fail_after_payout(*args, **kwargs):
        service._apply_dividends_original(*args, **kwargs)
        raise RuntimeError("injected settlement failure")

    service._apply_dividends_original = service._apply_dividends
    monkeypatch.setattr(service, "_apply_dividends", fail_after_payout)

    with pytest.raises(RuntimeError, match="injected settlement failure"):
        settle(
            settlement_client,
            expected_date="2025-10-21",
            key="rollback-settlement",
        )

    after = settlement_client.get("/api/v1/portfolio", headers=auth()).json()["data"]
    assert after["cash_cents"] == before["cash_cents"]
    with settlement_database.session() as session:
        assert session.scalar(select(func.count(SettlementRow.game_date))) == 0
        assert session.scalar(select(func.count(DividendRow.account_id))) == 0
        state = session.get(GameStateRow, "historical-2025-26")
        assert state is not None
        assert state.version == 0
        assert state.next_game_date == date(2025, 10, 21)
