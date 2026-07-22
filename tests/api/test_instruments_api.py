from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import date

from fastapi.testclient import TestClient
from pydantic import SecretStr
import pytest
from sqlalchemy import func, select

from nba_stock_market.api.app import create_app
from nba_stock_market.api.auth import Principal
from nba_stock_market.api.database import (
    AccountRow,
    BoostRow,
    Database,
    InstrumentCommandRow,
    SeedPlayer,
    SeedReplayEvent,
    SettlementRow,
    WeeklyShortRow,
)
from nba_stock_market.api.settings import ApiSettings
from tests.api.conftest import FixtureTokenVerifier


ADMIN_KEY = "test-settlement-admin-key-at-least-32"


def auth(token: str = "alice-token") -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def command_headers(token: str, key: str) -> dict[str, str]:
    return {**auth(token), "Idempotency-Key": key}


def settle(client: TestClient, game_date: str, key: str):
    return client.post(
        "/api/v1/admin/settlements/next",
        headers={
            "X-Settlement-Key": ADMIN_KEY,
            "Idempotency-Key": key,
        },
        json={"expected_game_date": game_date},
    )


@pytest.fixture
def instrument_database(tmp_path) -> Database:
    database = Database(f"sqlite+pysqlite:///{tmp_path / 'instruments.db'}")
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
            SeedPlayer(
                id="dnp",
                name="DNP Player",
                tier="bench",
                current_price_cents=500_000_000,
                opening_price_cents=500_000_000,
                actual_salary_cents=500_000_000,
            ),
            SeedPlayer(
                id="no-projection",
                name="No Projection Player",
                tier="bench",
                current_price_cents=500_000_000,
                opening_price_cents=500_000_000,
                actual_salary_cents=500_000_000,
            ),
            *[
                SeedPlayer(
                    id=f"role-{index}",
                    name=f"Role Player {index}",
                    tier="bench",
                    current_price_cents=500_000_000,
                    opening_price_cents=500_000_000,
                    actual_salary_cents=500_000_000,
                )
                for index in range(2, 5)
            ],
        ]
    )
    database.seed_replay_events(
        season_id="2025-26",
        events=[
            SeedReplayEvent(
                game_date=date(2025, 10, 20),
                player_id="dnp",
                actual_net_points_micros=0,
                expected_net_points_micros=20_000_000,
                dividend_cents=0,
                actual_minutes_micros=0,
                projected_minutes_micros=30_000_000,
                qualifies_for_instruments=False,
            ),
            SeedReplayEvent(
                game_date=date(2025, 10, 20),
                player_id="jokic",
                actual_net_points_micros=35_000_000,
                expected_net_points_micros=25_000_000,
                dividend_cents=40_000_000,
                actual_minutes_micros=34_000_000,
                projected_minutes_micros=34_000_000,
                qualifies_for_instruments=True,
            ),
            SeedReplayEvent(
                game_date=date(2025, 10, 20),
                player_id="no-projection",
                actual_net_points_micros=10_000_000,
                expected_net_points_micros=10_000_000,
                dividend_cents=0,
                actual_minutes_micros=20_000_000,
                projected_minutes_micros=None,
                qualifies_for_instruments=False,
            ),
            SeedReplayEvent(
                game_date=date(2025, 10, 20),
                player_id="sga",
                actual_net_points_micros=10_000_000,
                expected_net_points_micros=20_000_000,
                dividend_cents=-40_000_000,
                actual_minutes_micros=32_000_000,
                projected_minutes_micros=32_000_000,
                qualifies_for_instruments=True,
            ),
            *[
                SeedReplayEvent(
                    game_date=date(2025, 10, 20),
                    player_id=f"role-{index}",
                    actual_net_points_micros=10_000_000,
                    expected_net_points_micros=10_000_000,
                    dividend_cents=0,
                    actual_minutes_micros=20_000_000,
                    projected_minutes_micros=20_000_000,
                    qualifies_for_instruments=True,
                )
                for index in range(2, 5)
            ],
            SeedReplayEvent(
                game_date=date(2025, 10, 21),
                player_id="sga",
                actual_net_points_micros=50_000_000,
                expected_net_points_micros=20_000_000,
                dividend_cents=120_000_000,
                actual_minutes_micros=35_000_000,
                projected_minutes_micros=35_000_000,
                qualifies_for_instruments=True,
            ),
            SeedReplayEvent(
                game_date=date(2025, 10, 27),
                player_id="sga",
                actual_net_points_micros=20_000_000,
                expected_net_points_micros=20_000_000,
                dividend_cents=0,
                actual_minutes_micros=32_000_000,
                projected_minutes_micros=32_000_000,
                qualifies_for_instruments=True,
            ),
        ],
    )
    yield database
    database.dispose()


@pytest.fixture
def instrument_client(instrument_database: Database) -> TestClient:
    users = {
        "alice-token": Principal(id="alice", display_name="Alice"),
        "bob-token": Principal(id="bob", display_name="Bob"),
        **{
            f"user-{index}-token": Principal(
                id=f"user-{index}",
                display_name=f"User {index}",
            )
            for index in range(26)
        },
    }
    app = create_app(
        settings=ApiSettings(
            database_url=instrument_database.url,
            environment="test",
            settlement_admin_key=SecretStr(ADMIN_KEY),
        ),
        database=instrument_database,
        token_verifier=FixtureTokenVerifier(users),
    )
    with TestClient(app) as client:
        yield client


def buy(client: TestClient, player_id: str, *, token: str, key: str):
    return client.post(
        "/api/v1/trades",
        headers=command_headers(token, key),
        json={"player_id": player_id, "side": "buy"},
    )


def arm_short(client: TestClient, player_id: str, *, token: str, key: str):
    return client.post(
        "/api/v1/instruments/weekly-shorts",
        headers=command_headers(token, key),
        json={"player_id": player_id},
    )


def arm_boost(
    client: TestClient,
    player_id: str,
    game_date: str,
    *,
    token: str,
    key: str,
):
    return client.post(
        "/api/v1/instruments/boosts",
        headers=command_headers(token, key),
        json={"player_id": player_id, "game_date": game_date},
    )


def test_instrument_summary_starts_with_server_week_and_full_capacity(
    instrument_client: TestClient,
) -> None:
    response = instrument_client.get("/api/v1/instruments", headers=auth())

    assert response.status_code == 200
    assert response.json()["data"] == {
        "week_start": "2025-10-20",
        "reserved_collateral_cents": 0,
        "free_cash_cents": 14_000_000_000,
        "weekly_short_slots": {"limit": 3, "used": 0, "remaining": 3},
        "boost_slots": {"limit": 2, "used": 0, "remaining": 2},
        "weekly_shorts": [],
        "boosts": [],
    }


def test_arm_short_is_server_owned_idempotent_and_reserves_collateral(
    instrument_client: TestClient,
    instrument_database: Database,
) -> None:
    first = arm_short(
        instrument_client,
        "sga",
        token="alice-token",
        key="alice-short-sga-0001",
    )
    replay = arm_short(
        instrument_client,
        "sga",
        token="alice-token",
        key="alice-short-sga-0001",
    )
    conflict = arm_boost(
        instrument_client,
        "sga",
        "2025-10-20",
        token="alice-token",
        key="alice-short-sga-0001",
    )

    assert first.status_code == 201
    assert replay.status_code == 200
    assert replay.json()["data"] == {**first.json()["data"], "replayed": True}
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "idempotency_conflict"
    data = first.json()["data"]
    assert data["position"] == {
        "id": data["position"]["id"],
        "player_id": "sga",
        "week_start": "2025-10-20",
        "status": "active",
        "opening_price_cents": 5_000_000_000,
        "fee_cents": 12_500_000,
        "collateral_cents": 200_000_000,
        "accrued_net_points_micros": 0,
        "qualifying_games": 0,
        "payout_cents": None,
        "settled_game_date": None,
        "created_at": data["position"]["created_at"],
    }
    portfolio = data["portfolio"]
    assert portfolio["cash_cents"] == 13_987_500_000
    assert portfolio["reserved_collateral_cents"] == 200_000_000
    assert portfolio["free_cash_cents"] == 13_787_500_000
    assert portfolio["instruments"]["weekly_short_slots"]["used"] == 1

    with instrument_database.session() as session:
        assert session.scalar(select(func.count(WeeklyShortRow.id))) == 1
        assert session.scalar(select(func.count(InstrumentCommandRow.id))) == 1


def test_instrument_eligibility_and_trade_conflicts_are_enforced_server_side(
    instrument_client: TestClient,
    instrument_database: Database,
) -> None:
    unknown_boost = arm_boost(
        instrument_client,
        "unknown-player",
        "2025-10-20",
        token="alice-token",
        key="unknown-player-boost",
    )
    assert unknown_boost.status_code == 404
    assert unknown_boost.json()["error"]["code"] == "player_not_found"

    missing_projection = arm_short(
        instrument_client,
        "no-projection",
        token="alice-token",
        key="missing-projection-short",
    )
    assert missing_projection.status_code == 409
    assert missing_projection.json()["error"]["code"] == "projection_unavailable"

    assert buy(
        instrument_client,
        "jokic",
        token="alice-token",
        key="buy-jokic-before-boost",
    ).status_code == 201
    held_short = arm_short(
        instrument_client,
        "jokic",
        token="alice-token",
        key="cannot-short-held-jokic",
    )
    assert held_short.status_code == 409
    assert held_short.json()["error"]["code"] == "player_held"

    boost = arm_boost(
        instrument_client,
        "jokic",
        "2025-10-20",
        token="alice-token",
        key="boost-jokic-day-one",
    )
    assert boost.status_code == 201
    blocked_sell = instrument_client.post(
        "/api/v1/trades",
        headers=command_headers("alice-token", "sell-boosted-jokic"),
        json={"player_id": "jokic", "side": "sell"},
    )
    assert blocked_sell.status_code == 409
    assert blocked_sell.json()["error"]["code"] == "active_boost"

    assert arm_short(
        instrument_client,
        "sga",
        token="bob-token",
        key="bob-short-sga",
    ).status_code == 201
    blocked_buy = buy(
        instrument_client,
        "sga",
        token="bob-token",
        key="buy-shorted-sga",
    )
    assert blocked_buy.status_code == 409
    assert blocked_buy.json()["error"]["code"] == "active_short"

    with instrument_database.session() as session, session.begin():
        bob = session.get(AccountRow, "bob")
        assert bob is not None
        bob.cash_cents = 5_150_000_000
    collateral_block = buy(
        instrument_client,
        "jokic",
        token="bob-token",
        key="collateral-cannot-be-spent",
    )
    assert collateral_block.status_code == 409
    assert collateral_block.json()["error"]["code"] == "insufficient_cash"


def test_boost_rejects_a_second_future_game_for_the_same_player(
    instrument_client: TestClient,
    instrument_database: Database,
) -> None:
    assert buy(
        instrument_client,
        "sga",
        token="alice-token",
        key="buy-sga-before-two-date-boost",
    ).status_code == 201
    first = arm_boost(
        instrument_client,
        "sga",
        "2025-10-20",
        token="alice-token",
        key="boost-sga-first-date",
    )
    assert first.status_code == 201
    cash_after_first = first.json()["data"]["portfolio"]["cash_cents"]

    second = arm_boost(
        instrument_client,
        "sga",
        "2025-10-21",
        token="alice-token",
        key="boost-sga-second-date",
    )

    assert second.status_code == 409
    assert second.json()["error"]["code"] == "active_boost"
    portfolio = instrument_client.get(
        "/api/v1/portfolio", headers=auth("alice-token")
    ).json()["data"]
    assert portfolio["cash_cents"] == cash_after_first
    with instrument_database.session() as session:
        assert session.scalar(select(func.count(BoostRow.id))) == 1


def test_settlement_atomically_applies_dividends_boosts_and_weekly_shorts(
    instrument_client: TestClient,
    instrument_database: Database,
) -> None:
    assert buy(
        instrument_client,
        "jokic",
        token="alice-token",
        key="alice-buy-jokic-settlement",
    ).status_code == 201
    assert arm_boost(
        instrument_client,
        "jokic",
        "2025-10-20",
        token="alice-token",
        key="alice-boost-jokic-settlement",
    ).status_code == 201
    assert arm_short(
        instrument_client,
        "sga",
        token="alice-token",
        key="alice-short-sga-settlement",
    ).status_code == 201
    before = instrument_client.get("/api/v1/portfolio", headers=auth()).json()["data"]

    day_one = settle(instrument_client, "2025-10-20", "instrument-day-one")
    day_two = settle(instrument_client, "2025-10-21", "instrument-day-two")
    replay = settle(instrument_client, "2025-10-21", "instrument-day-two")

    assert day_one.status_code == 201
    assert day_one.json()["data"]["cash_breakdown_cents"] == {
        "dividends": 40_000_000,
        "boosts": 40_000_000,
        "weekly_shorts": 0,
    }
    assert day_one.json()["data"]["net_cash_cents"] == 80_000_000
    assert day_two.status_code == 201
    assert day_two.json()["data"]["cash_breakdown_cents"] == {
        "dividends": 0,
        "boosts": 0,
        "weekly_shorts": -60_000_000,
    }
    assert replay.status_code == 200
    assert replay.json()["data"] == {**day_two.json()["data"], "replayed": True}

    after = instrument_client.get("/api/v1/portfolio", headers=auth()).json()["data"]
    assert after["cash_cents"] - before["cash_cents"] == 20_000_000
    assert after["reserved_collateral_cents"] == 0
    short = after["instruments"]["weekly_shorts"][0]
    assert short["status"] == "settled"
    assert short["accrued_net_points_micros"] == -15_000_000
    assert short["qualifying_games"] == 2
    assert short["payout_cents"] == -60_000_000
    boost = after["instruments"]["boosts"][0]
    assert boost["status"] == "consumed"
    assert boost["payout_cents"] == 40_000_000

    with instrument_database.session() as session:
        assert session.scalar(select(func.count(WeeklyShortRow.id))) == 1
        assert session.scalar(select(func.count(BoostRow.id))) == 1


def test_dnp_voids_refund_fees_and_return_boost_slot(
    instrument_client: TestClient,
) -> None:
    assert buy(
        instrument_client,
        "dnp",
        token="alice-token",
        key="alice-buy-dnp",
    ).status_code == 201
    boost_response = arm_boost(
        instrument_client,
        "dnp",
        "2025-10-20",
        token="alice-token",
        key="alice-boost-dnp",
    )
    short_response = arm_short(
        instrument_client,
        "dnp",
        token="bob-token",
        key="bob-short-dnp",
    )
    assert boost_response.status_code == 201
    assert short_response.status_code == 201
    alice_before = boost_response.json()["data"]["portfolio"]["cash_cents"]
    bob_before = short_response.json()["data"]["portfolio"]["cash_cents"]

    assert settle(instrument_client, "2025-10-20", "dnp-day-one").status_code == 201
    alice_after_day = instrument_client.get(
        "/api/v1/portfolio", headers=auth("alice-token")
    ).json()["data"]
    boost_fee = boost_response.json()["data"]["position"]["fee_cents"]
    assert alice_after_day["cash_cents"] - alice_before == boost_fee
    assert alice_after_day["instruments"]["boost_slots"] == {
        "limit": 2,
        "used": 0,
        "remaining": 2,
    }
    assert alice_after_day["instruments"]["boosts"][0]["status"] == "refunded"

    assert settle(instrument_client, "2025-10-21", "dnp-week-close").status_code == 201
    bob_after = instrument_client.get(
        "/api/v1/portfolio", headers=auth("bob-token")
    ).json()["data"]
    short_fee = short_response.json()["data"]["position"]["fee_cents"]
    assert bob_after["cash_cents"] == bob_before + short_fee
    assert bob_after["reserved_collateral_cents"] == 0
    assert bob_after["instruments"]["weekly_shorts"][0]["status"] == "voided"


def test_player_specific_cutoff_rejects_short_after_player_has_played(
    instrument_client: TestClient,
) -> None:
    assert settle(instrument_client, "2025-10-20", "cutoff-day-one").status_code == 201

    response = arm_short(
        instrument_client,
        "sga",
        token="alice-token",
        key="late-sga-short",
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "player_already_played"


def test_weekly_short_and_boost_slot_limits_are_enforced(
    instrument_client: TestClient,
) -> None:
    for index, player_id in enumerate(("sga", "role-2", "role-3"), start=1):
        response = arm_short(
            instrument_client,
            player_id,
            token="alice-token",
            key=f"alice-short-slot-{index}",
        )
        assert response.status_code == 201
    extra_short = arm_short(
        instrument_client,
        "role-4",
        token="alice-token",
        key="alice-short-slot-overflow",
    )
    assert extra_short.status_code == 409
    assert extra_short.json()["error"]["code"] == "short_slots_full"

    for index, player_id in enumerate(("role-2", "role-3", "role-4"), start=1):
        assert buy(
            instrument_client,
            player_id,
            token="bob-token",
            key=f"bob-buy-boost-slot-{index}",
        ).status_code == 201
    for index, player_id in enumerate(("role-2", "role-3"), start=1):
        response = arm_boost(
            instrument_client,
            player_id,
            "2025-10-20",
            token="bob-token",
            key=f"bob-boost-slot-{index}",
        )
        assert response.status_code == 201
    extra_boost = arm_boost(
        instrument_client,
        "role-4",
        "2025-10-20",
        token="bob-token",
        key="bob-boost-slot-overflow",
    )
    assert extra_boost.status_code == 409
    assert extra_boost.json()["error"]["code"] == "boost_slots_full"


def test_concurrent_duplicate_command_only_debits_once(
    instrument_client: TestClient,
    instrument_database: Database,
) -> None:
    def request():
        return arm_short(
            instrument_client,
            "sga",
            token="alice-token",
            key="concurrent-identical-short",
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda _: request(), range(2)))

    assert sorted(response.status_code for response in responses) == [200, 201]
    assert sorted(
        response.json()["data"]["replayed"] for response in responses
    ) == [False, True]
    with instrument_database.session() as session:
        assert session.scalar(select(func.count(WeeklyShortRow.id))) == 1
        alice = session.get(AccountRow, "alice")
        assert alice is not None
        assert alice.cash_cents == 13_987_500_000


def test_weekly_short_loss_can_make_cash_negative_and_blocks_new_risk(
    instrument_client: TestClient,
    instrument_database: Database,
) -> None:
    assert arm_short(
        instrument_client,
        "sga",
        token="alice-token",
        key="negative-short-sga",
    ).status_code == 201
    with instrument_database.session() as session, session.begin():
        alice = session.get(AccountRow, "alice")
        assert alice is not None
        alice.cash_cents = 0

    assert settle(instrument_client, "2025-10-20", "negative-short-day-one").status_code == 201
    assert settle(instrument_client, "2025-10-21", "negative-short-day-two").status_code == 201
    portfolio = instrument_client.get("/api/v1/portfolio", headers=auth()).json()["data"]
    assert portfolio["cash_cents"] == -60_000_000
    assert portfolio["free_cash_cents"] == -60_000_000
    blocked_buy = buy(
        instrument_client,
        "role-2",
        token="alice-token",
        key="negative-cash-new-buy",
    )
    assert blocked_buy.status_code == 409
    assert blocked_buy.json()["error"]["code"] == "insufficient_cash"


def test_instrument_settlement_failure_rolls_back_positions_cash_and_clock(
    instrument_client: TestClient,
    instrument_database: Database,
    monkeypatch,
) -> None:
    assert arm_short(
        instrument_client,
        "sga",
        token="alice-token",
        key="rollback-short-sga",
    ).status_code == 201
    before = instrument_client.get("/api/v1/portfolio", headers=auth()).json()["data"]
    service = instrument_client.app.state.market_service
    original_apply = service._apply_dividends

    def fail_after_instruments(*args, **kwargs):
        original_apply(*args, **kwargs)
        raise RuntimeError("injected instrument settlement failure")

    monkeypatch.setattr(service, "_apply_dividends", fail_after_instruments)
    with pytest.raises(RuntimeError, match="injected instrument settlement failure"):
        settle(instrument_client, "2025-10-20", "rollback-instrument-day")

    after = instrument_client.get("/api/v1/portfolio", headers=auth()).json()["data"]
    assert after["cash_cents"] == before["cash_cents"]
    assert after["instruments"]["weekly_shorts"][0][
        "accrued_net_points_micros"
    ] == 0
    with instrument_database.session() as session:
        assert session.scalar(select(func.count(WeeklyShortRow.id))) == 1
        assert session.scalar(select(func.count()).select_from(SettlementRow)) == 0


def test_concurrent_arming_enforces_league_cap_and_does_not_overcharge(
    instrument_client: TestClient,
    instrument_database: Database,
) -> None:
    def request(index: int):
        return arm_short(
            instrument_client,
            "sga",
            token=f"user-{index}-token",
            key=f"league-cap-short-{index:02d}",
        )

    with ThreadPoolExecutor(max_workers=12) as executor:
        responses = list(executor.map(request, range(26)))

    assert [response.status_code for response in responses].count(201) == 25
    rejected = next(response for response in responses if response.status_code == 409)
    assert rejected.json()["error"]["code"] == "player_short_cap"
    with instrument_database.session() as session:
        assert session.scalar(select(func.count(WeeklyShortRow.id))) == 25
        charged_accounts = session.scalar(
            select(func.count(AccountRow.id)).where(
                AccountRow.cash_cents == 13_987_500_000
            )
        )
        assert charged_accounts == 25
