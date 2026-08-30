from __future__ import annotations

from datetime import UTC, date, datetime
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from nba_stock_market.api.app import create_app
from nba_stock_market.api.auth import Principal
from nba_stock_market.api.database import (
    Database,
    PerGameAccountRow,
    PerGameAccrualRow,
    PerGameLedgerEntryRow,
    PerGamePositionRow,
    PerGameProjectionRow,
    PerGameResultRow,
    PerGameRulesetRow,
)
from nba_stock_market.api.settings import ApiSettings
from tests.api.conftest import FixtureTokenVerifier


SETTLEMENT_KEY = "v2-test-settlement-key-32-bytes-long"
FROZEN_API_EXAMPLE = (
    Path(__file__).parents[2] / "docs" / "per-game-economy-v2-api-example.json"
)


@pytest.fixture
def v2_client(database: Database) -> TestClient:
    verifier = FixtureTokenVerifier(
        {
            "alice-token": Principal(id="alice", display_name="Alice"),
            "bob-token": Principal(id="bob", display_name="Bob"),
        }
    )
    app = create_app(
        settings=ApiSettings(
            database_url=database.url,
            environment="test",
            settlement_admin_key=SETTLEMENT_KEY,
        ),
        database=database,
        token_verifier=verifier,
    )
    with TestClient(app) as test_client:
        yield test_client


def command_headers(token: str, key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Idempotency-Key": key,
    }


def settlement_headers(key: str) -> dict[str, str]:
    return {
        "X-Settlement-Key": SETTLEMENT_KEY,
        "Idempotency-Key": key,
    }


def open_position(
    client: TestClient,
    *,
    token: str,
    player_id: str,
    side: str = "long",
    version: int = 0,
    quote_version: int = 0,
    key: str,
) -> dict[str, object]:
    response = client.post(
        "/api/v2/positions",
        headers=command_headers(token, key),
        json={
            "player_id": player_id,
            "side": side,
            "expected_account_version": version,
            "expected_quote_version": quote_version,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


def raw_result(
    *,
    game_id: str,
    player_id: str = "sga",
    sequence: int = 0,
    revision: int = 1,
    actual: float = 20.0,
    game_date: str = "2025-10-21",
    next_game_date: str | None = "2025-10-23",
) -> dict[str, object]:
    return {
        "game_id": game_id,
        "player_id": player_id,
        "game_date": game_date,
        "next_game_date": next_game_date,
        "event_sequence": sequence,
        "result_revision": revision,
        "actual_net_points": actual,
    }


def test_v2_settlement_route_reuses_the_scheduler_guard(
    client: TestClient,
) -> None:
    unavailable = client.post(
        "/api/v2/admin/player-games/settle",
        headers={
            "X-Settlement-Key": SETTLEMENT_KEY,
            "Idempotency-Key": "v2-guard-unavailable",
        },
        json=raw_result(game_id="guard-game"),
    )
    assert unavailable.status_code == 503
    assert unavailable.json()["error"]["code"] == "settlement_unavailable"


def test_live_ruleset_requires_and_exposes_the_scheduler_roster_lock(
    v2_client: TestClient,
    database: Database,
) -> None:
    v2_client.get(
        "/api/v2/bootstrap", headers={"Authorization": "Bearer alice-token"}
    )
    with database.session() as session, session.begin():
        ruleset = session.get(PerGameRulesetRow, "per-game-v2-staging")
        assert ruleset is not None
        ruleset.enforce_roster_lock = True

    unlocked_settlement = v2_client.post(
        "/api/v2/admin/player-games/settle",
        headers=settlement_headers("v2-live-without-lock"),
        json=raw_result(game_id="live-lock-game"),
    )
    assert unlocked_settlement.status_code == 409
    assert unlocked_settlement.json()["error"]["code"] == "roster_lock_required"

    lock_body = {"locked": True, "game_date": "2025-10-21"}
    locked = v2_client.post(
        "/api/v2/admin/roster-lock",
        headers=settlement_headers("v2-live-lock"),
        json=lock_body,
    )
    assert locked.status_code == 201
    assert locked.json()["data"]["roster_mutations_locked"] is True
    replay = v2_client.post(
        "/api/v2/admin/roster-lock",
        headers=settlement_headers("v2-live-lock"),
        json=lock_body,
    )
    assert replay.status_code == 200
    assert replay.json()["data"]["replayed"] is True

    bootstrap = v2_client.get(
        "/api/v2/bootstrap", headers={"Authorization": "Bearer alice-token"}
    ).json()["data"]
    assert bootstrap["ruleset"]["roster_mutations_locked"] is True
    assert bootstrap["ruleset"]["roster_lock_game_date"] == "2025-10-21"
    assert bootstrap["capabilities"]["can_open_long"] is False
    assert bootstrap["capabilities"]["can_open_short"] is False

    blocked_open = v2_client.post(
        "/api/v2/positions",
        headers=command_headers("alice-token", "v2-live-blocked-open"),
        json={
            "player_id": "sga",
            "side": "long",
            "expected_account_version": 0,
            "expected_quote_version": 0,
        },
    )
    assert blocked_open.status_code == 423
    assert blocked_open.json()["error"]["code"] == "roster_locked"

    early_unlock = v2_client.post(
        "/api/v2/admin/roster-lock",
        headers=settlement_headers("v2-live-early-unlock"),
        json={"locked": False, "game_date": "2025-10-21"},
    )
    assert early_unlock.status_code == 201
    settlement_after_early_unlock = v2_client.post(
        "/api/v2/admin/player-games/settle",
        headers=settlement_headers("v2-live-after-early-unlock"),
        json=raw_result(game_id="live-lock-game"),
    )
    assert settlement_after_early_unlock.status_code == 409
    assert (
        settlement_after_early_unlock.json()["error"]["code"]
        == "roster_lock_required"
    )

    relock_for_settlement = v2_client.post(
        "/api/v2/admin/roster-lock",
        headers=settlement_headers("v2-live-relock-for-settlement"),
        json=lock_body,
    )
    assert relock_for_settlement.status_code == 201

    settled = v2_client.post(
        "/api/v2/admin/player-games/settle",
        headers=settlement_headers("v2-live-with-lock"),
        json=raw_result(game_id="live-lock-game"),
    )
    assert settled.status_code == 201

    stale_unlock = v2_client.post(
        "/api/v2/admin/roster-lock",
        headers=settlement_headers("v2-live-stale-unlock"),
        json={"locked": False, "game_date": "2025-10-22"},
    )
    assert stale_unlock.status_code == 409
    assert stale_unlock.json()["error"]["code"] == "roster_lock_conflict"

    unlocked = v2_client.post(
        "/api/v2/admin/roster-lock",
        headers=settlement_headers("v2-live-unlock"),
        json={"locked": False, "game_date": "2025-10-21"},
    )
    assert unlocked.status_code == 201
    assert unlocked.json()["data"]["roster_mutations_locked"] is False
    opened = open_position(
        v2_client,
        token="alice-token",
        player_id="sga",
        key="v2-live-open-after-unlock",
    )
    assert opened["position"]["opened_event_sequence"] == 1

    relocked = v2_client.post(
        "/api/v2/admin/roster-lock",
        headers=settlement_headers("v2-live-relock"),
        json={"locked": True, "game_date": "2025-10-23"},
    )
    assert relocked.status_code == 201
    blocked_close = v2_client.request(
        "DELETE",
        f"/api/v2/positions/{opened['position_id']}",
        headers=command_headers("alice-token", "v2-live-blocked-close"),
        json={"expected_account_version": 1},
    )
    assert blocked_close.status_code == 423
    assert blocked_close.json()["error"]["code"] == "roster_locked"


def test_base_settlement_posts_cost_and_dividend_exactly_once(
    v2_client: TestClient,
    database: Database,
) -> None:
    opened = open_position(
        v2_client,
        token="alice-token",
        player_id="sga",
        key="v2-base-open-0001",
    )
    cost = int(opened["locked_game_cost_dollars"])
    body = raw_result(game_id="game-base-1", actual=20.0)

    settled = v2_client.post(
        "/api/v2/admin/player-games/settle",
        headers=settlement_headers("v2-base-settle-0001"),
        json=body,
    )

    assert settled.status_code == 201
    data = settled.json()["data"]
    assert data["replayed"] is False
    assert data["result"]["status"] == "settled"
    assert data["result"]["dividend_dollars"] == 800_000
    assert data["settlements"][0]["locked_game_cost_dollars"] == cost
    assert data["settlements"][0]["net_pnl_dollars"] == 800_000 - cost
    assert data["accounts"][0]["cumulative_pnl_dollars"] == 800_000 - cost

    identical_new_key = v2_client.post(
        "/api/v2/admin/player-games/settle",
        headers=settlement_headers("v2-base-settle-replay"),
        json=body,
    )
    assert identical_new_key.status_code == 200
    assert identical_new_key.json()["data"]["replayed"] is True

    same_key_replay = v2_client.post(
        "/api/v2/admin/player-games/settle",
        headers=settlement_headers("v2-base-settle-0001"),
        json=body,
    )
    assert same_key_replay.status_code == 200

    conflict = v2_client.post(
        "/api/v2/admin/player-games/settle",
        headers=settlement_headers("v2-base-settle-conflict"),
        json={**body, "actual_net_points": 21.0},
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "result_revision_conflict"

    with database.session() as session:
        entries = session.scalars(
            select(PerGameLedgerEntryRow).where(
                PerGameLedgerEntryRow.game_id == "game-base-1"
            )
        ).all()
        assert [(entry.kind, entry.amount_dollars) for entry in entries] == [
            ("game_cost", -cost),
            ("game_dividend", 800_000),
        ]
        assert (
            session.scalar(
                select(func.count()).select_from(PerGameResultRow).where(
                    PerGameResultRow.game_id == "game-base-1"
                )
            )
            == 1
        )


def test_correction_appends_only_the_dividend_delta_and_advances_cursor(
    v2_client: TestClient,
    database: Database,
) -> None:
    opened = open_position(
        v2_client,
        token="alice-token",
        player_id="sga",
        key="v2-correction-open",
    )
    cost = int(opened["locked_game_cost_dollars"])
    base = raw_result(game_id="game-correction", actual=20.0)
    base_response = v2_client.post(
        "/api/v2/admin/player-games/settle",
        headers=settlement_headers("v2-correction-base"),
        json=base,
    )
    assert base_response.status_code == 201
    base_cursor = base_response.json()["data"]["event_cursor"]

    correction = v2_client.post(
        "/api/v2/admin/player-games/settle",
        headers=settlement_headers("v2-correction-revision-2"),
        json={**base, "result_revision": 2, "actual_net_points": 22.0},
    )

    assert correction.status_code == 201
    corrected = correction.json()["data"]
    assert corrected["event_cursor"] > base_cursor
    assert corrected["result"]["kind"] == "correction"
    assert corrected["result"]["adjusts_result_revision"] == 1
    assert corrected["settlements"][0]["dividend_dollars"] == 880_000
    assert corrected["settlements"][0]["net_pnl_dollars"] == 880_000 - cost
    assert corrected["accounts"][0]["cumulative_pnl_dollars"] == 880_000 - cost

    incremental = v2_client.get(
        "/api/v2/bootstrap",
        headers={"Authorization": "Bearer alice-token"},
        params={"after_event_cursor": base_cursor},
    )
    assert incremental.status_code == 200
    incremental_data = incremental.json()["data"]
    assert [row["kind"] for row in incremental_data["ledger"]["items"]] == [
        "dividend_correction"
    ]
    assert incremental_data["settled_results"][0]["result_revision"] == 2

    with database.session() as session:
        entries = session.scalars(
            select(PerGameLedgerEntryRow)
            .where(PerGameLedgerEntryRow.game_id == "game-correction")
            .order_by(PerGameLedgerEntryRow.result_revision, PerGameLedgerEntryRow.kind)
        ).all()
        assert sum(entry.kind == "game_cost" for entry in entries) == 1
        assert sum(entry.kind == "game_dividend" for entry in entries) == 1
        corrections = [
            entry for entry in entries if entry.kind == "dividend_correction"
        ]
        assert len(corrections) == 1
        assert corrections[0].amount_dollars == 80_000
        assert corrections[0].adjusts_entry_id is not None


def test_correction_uses_the_original_settlement_policy_after_rules_change(
    v2_client: TestClient,
    database: Database,
) -> None:
    open_position(
        v2_client,
        token="alice-token",
        player_id="sga",
        key="v2-policy-lock-open",
    )
    base = raw_result(game_id="policy-lock-game", actual=20.0)
    base_response = v2_client.post(
        "/api/v2/admin/player-games/settle",
        headers=settlement_headers("v2-policy-lock-base"),
        json=base,
    )
    assert base_response.status_code == 201
    assert base_response.json()["data"]["result"]["dividend_dollars"] == 800_000

    with database.session() as session, session.begin():
        ruleset = session.get(PerGameRulesetRow, "per-game-v2-staging")
        assert ruleset is not None
        ruleset.dividend_basis = "surprise_vs_projection"
        ruleset.dividend_dollars_per_net_point = 100_000

    correction = v2_client.post(
        "/api/v2/admin/player-games/settle",
        headers=settlement_headers("v2-policy-lock-correction"),
        json={**base, "result_revision": 2, "actual_net_points": 22.0},
    )

    assert correction.status_code == 201
    result = correction.json()["data"]["result"]
    assert result["dividend_basis"] == "raw_net_points"
    assert result["dividend_dollars_per_net_point"] == 40_000
    assert result["dividend_dollars"] == 880_000

    with database.session() as session:
        rows = session.scalars(
            select(PerGameResultRow)
            .where(PerGameResultRow.game_id == "policy-lock-game")
            .order_by(PerGameResultRow.revision)
        ).all()
        assert [(row.dividend_basis, row.dividend_dollars_per_net_point) for row in rows] == [
            ("raw_net_points", 40_000),
            ("raw_net_points", 40_000),
        ]


def test_settlement_advances_schedule_without_allowing_a_correction_to_rewind_it(
    v2_client: TestClient,
) -> None:
    v2_client.get(
        "/api/v2/bootstrap", headers={"Authorization": "Bearer alice-token"}
    )
    game_one = raw_result(
        game_id="schedule-game-one",
        sequence=0,
        game_date="2025-10-21",
        next_game_date="2025-10-23",
    )
    first = v2_client.post(
        "/api/v2/admin/player-games/settle",
        headers=settlement_headers("v2-schedule-game-one"),
        json=game_one,
    )
    assert first.status_code == 201

    game_two = raw_result(
        game_id="schedule-game-two",
        sequence=1,
        game_date="2025-10-23",
        next_game_date="2025-10-25",
    )
    second = v2_client.post(
        "/api/v2/admin/player-games/settle",
        headers=settlement_headers("v2-schedule-game-two"),
        json=game_two,
    )
    assert second.status_code == 201

    correction = v2_client.post(
        "/api/v2/admin/player-games/settle",
        headers=settlement_headers("v2-schedule-old-correction"),
        json={
            **game_one,
            "result_revision": 2,
            "actual_net_points": 21.0,
            "next_game_date": "2025-10-22",
        },
    )
    assert correction.status_code == 201

    bootstrap = v2_client.get(
        "/api/v2/bootstrap", headers={"Authorization": "Bearer alice-token"}
    ).json()["data"]
    assert bootstrap["game"]["last_settled_date"] == "2025-10-23"
    assert bootstrap["game"]["next_game_date"] == "2025-10-25"

    season_end = v2_client.post(
        "/api/v2/admin/player-games/settle",
        headers=settlement_headers("v2-schedule-season-end"),
        json=raw_result(
            game_id="schedule-season-end",
            sequence=2,
            game_date="2025-10-25",
            next_game_date=None,
        ),
    )
    assert season_end.status_code == 201
    ended = v2_client.get(
        "/api/v2/bootstrap", headers={"Authorization": "Bearer alice-token"}
    ).json()["data"]
    assert ended["game"]["last_settled_date"] == "2025-10-25"
    assert ended["game"]["next_game_date"] is None


def test_settlement_rejects_a_nonfuture_next_game_date(
    v2_client: TestClient,
    database: Database,
) -> None:
    response = v2_client.post(
        "/api/v2/admin/player-games/settle",
        headers=settlement_headers("v2-invalid-next-game-date"),
        json=raw_result(
            game_id="invalid-next-game-date",
            game_date="2025-10-21",
            next_game_date="2025-10-21",
        ),
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "next_game_date_invalid"
    with database.session() as session:
        assert session.scalar(select(func.count()).select_from(PerGameResultRow)) == 0


def test_players_in_the_same_game_cannot_publish_conflicting_next_dates(
    v2_client: TestClient,
    database: Database,
) -> None:
    first = v2_client.post(
        "/api/v2/admin/player-games/settle",
        headers=settlement_headers("v2-game-boundary-next-date-a"),
        json=raw_result(
            game_id="shared-schedule-game",
            player_id="sga",
            next_game_date="2025-10-23",
        ),
    )
    assert first.status_code == 201

    conflicting = v2_client.post(
        "/api/v2/admin/player-games/settle",
        headers=settlement_headers("v2-game-boundary-next-date-b"),
        json=raw_result(
            game_id="shared-schedule-game",
            player_id="jokic",
            next_game_date="2025-10-24",
        ),
    )
    assert conflicting.status_code == 409
    assert conflicting.json()["error"]["code"] == "game_boundary_conflict"

    with database.session() as session:
        assert session.scalar(select(func.count()).select_from(PerGameResultRow)) == 1
        ruleset = session.get(PerGameRulesetRow, "per-game-v2-staging")
        assert ruleset is not None
        assert ruleset.next_game_date == date(2025, 10, 23)


def test_timed_short_cannot_open_after_the_authoritative_schedule_ends(
    v2_client: TestClient,
    database: Database,
) -> None:
    bootstrap = v2_client.get(
        "/api/v2/bootstrap", headers={"Authorization": "Bearer alice-token"}
    ).json()["data"]
    quote = next(row for row in bootstrap["market"] if row["player_id"] == "sga")
    with database.session() as session, session.begin():
        ruleset = session.get(PerGameRulesetRow, "per-game-v2-staging")
        assert ruleset is not None
        ruleset.last_settled_date = date(2026, 4, 12)
        ruleset.next_game_date = None

    response = v2_client.post(
        "/api/v2/positions",
        headers=command_headers("alice-token", "v2-season-ended-short"),
        json={
            "player_id": "sga",
            "side": "short",
            "expected_account_version": 0,
            "expected_quote_version": quote["quote_version"],
        },
    )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "short_schedule_unavailable"


def test_surprise_mode_keeps_missing_projection_visible_and_unsettled(
    v2_client: TestClient,
    database: Database,
) -> None:
    v2_client.get(
        "/api/v2/bootstrap", headers={"Authorization": "Bearer alice-token"}
    )
    with database.session() as session, session.begin():
        ruleset = session.get(PerGameRulesetRow, "per-game-v2-staging")
        assert ruleset is not None
        ruleset.dividend_basis = "surprise_vs_projection"

    open_position(
        v2_client,
        token="alice-token",
        player_id="sga",
        key="v2-missing-open",
    )
    response = v2_client.post(
        "/api/v2/admin/player-games/settle",
        headers=settlement_headers("v2-missing-settlement"),
        json=raw_result(game_id="game-missing-projection", actual=25.0),
    )

    assert response.status_code == 201
    data = response.json()["data"]
    assert data["result"]["status"] == "unsettled_missing_projection"
    assert data["result"]["dividend_dollars"] is None
    assert data["settlements"][0]["status"] == "unsettled_missing_projection"
    assert data["settlements"][0]["net_pnl_dollars"] is None
    assert data["accounts"] == []

    bootstrap = v2_client.get(
        "/api/v2/bootstrap", headers={"Authorization": "Bearer alice-token"}
    ).json()["data"]
    assert bootstrap["account"]["cumulative_pnl_dollars"] == 0
    assert bootstrap["ledger"]["items"] == []
    assert bootstrap["settled_results"][0]["status"] == (
        "unsettled_missing_projection"
    )

    with database.session() as session:
        assert (
            session.scalar(
                select(func.count()).select_from(PerGameLedgerEntryRow)
            )
            == 0
        )
        accrual = session.scalar(
            select(PerGameAccrualRow).where(
                PerGameAccrualRow.game_id == "game-missing-projection"
            )
        )
        assert accrual is not None
        assert accrual.base_result_revision is None


def test_surprise_mode_uses_saved_pregame_projection(
    v2_client: TestClient,
    database: Database,
) -> None:
    v2_client.get(
        "/api/v2/bootstrap", headers={"Authorization": "Bearer alice-token"}
    )
    with database.session() as session, session.begin():
        ruleset = session.get(PerGameRulesetRow, "per-game-v2-staging")
        assert ruleset is not None
        ruleset.dividend_basis = "surprise_vs_projection"
    opened = open_position(
        v2_client,
        token="alice-token",
        player_id="sga",
        key="v2-projection-open",
    )
    cost = int(opened["locked_game_cost_dollars"])

    response = v2_client.post(
        "/api/v2/admin/player-games/settle",
        headers=settlement_headers("v2-projection-settlement"),
        json={
            **raw_result(game_id="game-with-projection", actual=25.0),
            "game_started_at": datetime(2025, 10, 21, 21, tzinfo=UTC).isoformat(),
            "saved_projection_net_points": 20.0,
            "projection_model": "dnt",
            "projection_version": "pregame-v1",
            "projection_captured_at": datetime(2025, 10, 21, 20, tzinfo=UTC).isoformat(),
        },
    )

    assert response.status_code == 201
    data = response.json()["data"]
    assert data["result"]["dividend_dollars"] == 200_000
    assert data["settlements"][0]["net_pnl_dollars"] == 200_000 - cost


@pytest.mark.parametrize(
    ("game_started_at", "projection_captured_at", "expected_code"),
    [
        (None, "2025-10-21T20:00:00+00:00", "game_start_required"),
        (
            "2025-10-21T21:00:00+00:00",
            "2025-10-21T21:00:00+00:00",
            "projection_not_pregame",
        ),
        (
            "2025-10-21T21:00:00+00:00",
            "2025-10-21T21:00:01+00:00",
            "projection_not_pregame",
        ),
        (
            "2025-10-21T21:00:00+00:00",
            "2025-10-21T20:00:00",
            "timezone_required",
        ),
    ],
)
def test_projection_settlement_requires_provably_pregame_capture(
    v2_client: TestClient,
    database: Database,
    game_started_at: str | None,
    projection_captured_at: str,
    expected_code: str,
) -> None:
    body = {
        **raw_result(game_id=f"invalid-projection-{expected_code}"),
        "game_started_at": game_started_at,
        "saved_projection_net_points": 20.0,
        "projection_model": "dnt",
        "projection_version": "pregame-v1",
        "projection_captured_at": projection_captured_at,
    }
    response = v2_client.post(
        "/api/v2/admin/player-games/settle",
        headers=settlement_headers(f"v2-{expected_code}-{projection_captured_at}"),
        json=body,
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == expected_code
    with database.session() as session:
        assert session.scalar(select(func.count()).select_from(PerGameProjectionRow)) == 0
        assert session.scalar(select(func.count()).select_from(PerGameResultRow)) == 0


def test_close_boundary_prevents_later_game_exposure(
    v2_client: TestClient,
    database: Database,
) -> None:
    opened = open_position(
        v2_client,
        token="alice-token",
        player_id="sga",
        key="v2-boundary-open",
    )
    first = v2_client.post(
        "/api/v2/admin/player-games/settle",
        headers=settlement_headers("v2-boundary-game-1"),
        json=raw_result(game_id="boundary-game-1", sequence=0, actual=20.0),
    )
    assert first.status_code == 201
    first_pnl = first.json()["data"]["accounts"][0]["cumulative_pnl_dollars"]

    closed = v2_client.request(
        "DELETE",
        f"/api/v2/positions/{opened['position_id']}",
        headers=command_headers("alice-token", "v2-boundary-close"),
        json={"expected_account_version": 2},
    )
    assert closed.status_code == 200
    assert closed.json()["data"]["closed_event_sequence"] == 1

    second = v2_client.post(
        "/api/v2/admin/player-games/settle",
        headers=settlement_headers("v2-boundary-game-2"),
        json=raw_result(
            game_id="boundary-game-2",
            sequence=1,
            actual=30.0,
            game_date="2025-10-23",
            next_game_date="2025-10-24",
        ),
    )
    assert second.status_code == 201
    assert second.json()["data"]["settlements"] == []

    with database.session() as session:
        account = session.get(
            PerGameAccountRow,
            {"ruleset_id": "per-game-v2-staging", "account_id": "alice"},
        )
        assert account is not None
        assert account.cumulative_pnl_dollars == first_pnl
        assert (
            session.scalar(
                select(func.count()).select_from(PerGameAccrualRow).where(
                    PerGameAccrualRow.game_id == "boundary-game-2"
                )
            )
            == 0
        )


def test_leaderboard_is_ranked_by_cumulative_pnl(
    v2_client: TestClient,
) -> None:
    open_position(
        v2_client,
        token="alice-token",
        player_id="sga",
        key="v2-leader-open",
    )
    v2_client.get(
        "/api/v2/bootstrap", headers={"Authorization": "Bearer bob-token"}
    )
    settled = v2_client.post(
        "/api/v2/admin/player-games/settle",
        headers=settlement_headers("v2-leader-settle"),
        json=raw_result(game_id="leader-game", actual=30.0),
    )
    assert settled.status_code == 201

    bob_view = v2_client.get(
        "/api/v2/bootstrap", headers={"Authorization": "Bearer bob-token"}
    ).json()["data"]
    assert [row["account_id"] for row in bob_view["leaderboard"]] == [
        "alice",
        "bob",
    ]
    assert bob_view["leaderboard"][0]["cumulative_pnl_dollars"] > 0
    assert bob_view["leaderboard"][1]["is_current_user"] is True


def test_leaderboard_includes_the_current_users_real_rank_outside_top_50(
    v2_client: TestClient,
    database: Database,
) -> None:
    v2_client.get(
        "/api/v2/bootstrap", headers={"Authorization": "Bearer alice-token"}
    )
    with database.session() as session, session.begin():
        session.add_all(
            PerGameAccountRow(
                ruleset_id="per-game-v2-staging",
                account_id=f"ranked-{index:02d}",
                display_name=f"Ranked {index:02d}",
                cumulative_pnl_dollars=100_000 - index,
                latest_game_pnl_dollars=0,
            )
            for index in range(55)
        )

    view = v2_client.get(
        "/api/v2/bootstrap", headers={"Authorization": "Bearer alice-token"}
    ).json()["data"]
    current = [row for row in view["leaderboard"] if row["is_current_user"]]

    assert len(view["leaderboard"]) == 51
    assert current == [
        {
            "rank": 56,
            "account_id": "alice",
            "display_name": "Alice",
            "cumulative_pnl_dollars": 0,
            "is_current_user": True,
        }
    ]


def test_ledger_cursor_pagination_cannot_skip_rows_from_one_settlement(
    v2_client: TestClient,
    database: Database,
) -> None:
    open_position(
        v2_client,
        token="alice-token",
        player_id="sga",
        key="v2-cursor-open",
    )
    settled = v2_client.post(
        "/api/v2/admin/player-games/settle",
        headers=settlement_headers("v2-cursor-settle"),
        json=raw_result(game_id="cursor-game", actual=20.0),
    )
    assert settled.status_code == 201

    first_page = v2_client.get(
        "/api/v2/bootstrap",
        headers={"Authorization": "Bearer alice-token"},
        params={"ledger_limit": 1},
    ).json()["data"]["ledger"]
    assert len(first_page["items"]) == 1
    assert first_page["next_cursor"] == first_page["items"][0]["event_cursor"]

    second_page = v2_client.get(
        "/api/v2/bootstrap",
        headers={"Authorization": "Bearer alice-token"},
        params={
            "ledger_limit": 1,
            "after_event_cursor": first_page["next_cursor"],
        },
    ).json()["data"]["ledger"]
    assert len(second_page["items"]) == 1
    assert second_page["items"][0]["event_cursor"] > first_page["next_cursor"]
    assert {first_page["items"][0]["kind"], second_page["items"][0]["kind"]} == {
        "game_cost",
        "game_dividend",
    }

    with database.session() as session:
        cursors = list(
            session.scalars(
                select(PerGameLedgerEntryRow.event_cursor).where(
                    PerGameLedgerEntryRow.game_id == "cursor-game"
                )
            )
        )
        assert len(cursors) == len(set(cursors)) == 2


def test_short_cashflow_is_inverse_and_account_reconciles_to_ledger(
    v2_client: TestClient,
    database: Database,
) -> None:
    opened = open_position(
        v2_client,
        token="alice-token",
        player_id="sga",
        side="short",
        key="v2-short-open",
    )
    locked_cost = int(opened["locked_game_cost_dollars"])
    settled = v2_client.post(
        "/api/v2/admin/player-games/settle",
        headers=settlement_headers("v2-short-settle"),
        json=raw_result(game_id="short-game", actual=20.0),
    )

    assert settled.status_code == 201
    data = settled.json()["data"]
    expected_pnl = locked_cost - 800_000
    assert data["settlements"][0]["side"] == "short"
    assert data["settlements"][0]["net_pnl_dollars"] == expected_pnl
    assert data["accounts"][0]["cumulative_pnl_dollars"] == expected_pnl

    with database.session() as session:
        entries = session.scalars(
            select(PerGameLedgerEntryRow).where(
                PerGameLedgerEntryRow.account_id == "alice"
            )
        ).all()
        assert [(row.kind, row.amount_dollars) for row in entries] == [
            ("game_cost", locked_cost),
            ("game_dividend", -800_000),
        ]
        account = session.get(
            PerGameAccountRow,
            {"ruleset_id": "per-game-v2-staging", "account_id": "alice"},
        )
        assert account is not None
        assert account.cumulative_pnl_dollars == sum(
            row.amount_dollars for row in entries
        )


def test_timed_short_expires_before_the_first_game_after_its_term(
    v2_client: TestClient,
    database: Database,
) -> None:
    initial = v2_client.get(
        "/api/v2/bootstrap", headers={"Authorization": "Bearer alice-token"}
    ).json()["data"]
    initial_quote = next(
        row["current_game_cost_dollars"]
        for row in initial["market"]
        if row["player_id"] == "sga"
    )
    close_fee = 25_000
    with database.session() as session, session.begin():
        ruleset = session.get(PerGameRulesetRow, "per-game-v2-staging")
        assert ruleset is not None
        ruleset.transaction_fee_dollars = close_fee
    opened = open_position(
        v2_client,
        token="alice-token",
        player_id="sga",
        side="short",
        key="v2-expiring-short-open",
    )
    assert opened["position"]["expires_on"] == "2025-10-27"

    final_in_term = v2_client.post(
        "/api/v2/admin/player-games/settle",
        headers=settlement_headers("v2-expiring-short-in-term"),
        json=raw_result(
            game_id="short-final-in-term",
            sequence=0,
            game_date="2025-10-27",
            next_game_date="2025-10-28",
        ),
    )
    assert final_in_term.status_code == 201
    assert len(final_in_term.json()["data"]["settlements"]) == 1
    before_expiry = v2_client.get(
        "/api/v2/bootstrap", headers={"Authorization": "Bearer alice-token"}
    ).json()["data"]

    after_term = v2_client.post(
        "/api/v2/admin/player-games/settle",
        headers=settlement_headers("v2-expiring-short-after-term"),
        json=raw_result(
            game_id="short-after-term",
            player_id="jokic",
            sequence=1,
            game_date="2025-10-28",
            next_game_date="2025-10-29",
        ),
    )
    assert after_term.status_code == 201
    assert after_term.json()["data"]["settlements"] == []

    refreshed = v2_client.get(
        "/api/v2/bootstrap", headers={"Authorization": "Bearer alice-token"}
    ).json()["data"]
    expired = next(
        row for row in refreshed["positions"] if row["position_id"] == opened["position_id"]
    )
    assert expired["status"] == "closed"
    assert expired["closed_event_sequence"] == 1
    assert refreshed["account"]["short_slots"]["used"] == 0
    assert refreshed["account"]["cumulative_pnl_dollars"] == (
        before_expiry["account"]["cumulative_pnl_dollars"] - close_fee
    )
    assert next(
        row["current_game_cost_dollars"]
        for row in refreshed["market"]
        if row["player_id"] == "sga"
    ) == initial_quote
    with database.session() as session:
        stored = session.get(PerGamePositionRow, opened["position_id"])
        assert stored is not None
        assert stored.expires_on == date(2025, 10, 27)
        fee_entry = session.scalar(
            select(PerGameLedgerEntryRow).where(
                PerGameLedgerEntryRow.position_id == opened["position_id"],
                PerGameLedgerEntryRow.kind == "drop_fee",
            )
        )
        assert fee_entry is not None
        assert fee_entry.amount_dollars == -close_fee


def test_missing_projection_history_pages_without_ledger_rows(
    v2_client: TestClient,
    database: Database,
) -> None:
    v2_client.get(
        "/api/v2/bootstrap", headers={"Authorization": "Bearer alice-token"}
    )
    with database.session() as session, session.begin():
        ruleset = session.get(PerGameRulesetRow, "per-game-v2-staging")
        assert ruleset is not None
        ruleset.dividend_basis = "surprise_vs_projection"

    open_position(
        v2_client,
        token="alice-token",
        player_id="sga",
        key="v2-history-missing-open",
    )
    expected_game_ids = [f"missing-history-{index:03d}" for index in range(101)]
    for index, game_id in enumerate(expected_game_ids):
        response = v2_client.post(
            "/api/v2/admin/player-games/settle",
            headers=settlement_headers(f"v2-history-missing-{index:03d}"),
            json=raw_result(game_id=game_id, sequence=index, actual=25.0),
        )
        assert response.status_code == 201, response.text
        assert response.json()["data"]["result"]["status"] == (
            "unsettled_missing_projection"
        )

    collected_game_ids: list[str] = []
    after_cursor: int | None = None
    page_count = 0
    final_cursor = 0
    while True:
        params: dict[str, int] = {"ledger_limit": 17}
        if after_cursor is not None:
            params["after_event_cursor"] = after_cursor
        page = v2_client.get(
            "/api/v2/bootstrap",
            headers={"Authorization": "Bearer alice-token"},
            params=params,
        ).json()["data"]
        assert page["ledger"]["items"] == []
        collected_game_ids.extend(
            result["game_id"] for result in page["settled_results"]
        )
        page_count += 1
        final_cursor = page["game"]["event_cursor"]
        next_cursor = page["ledger"]["next_cursor"]
        if next_cursor is None:
            break
        assert after_cursor is None or next_cursor > after_cursor
        after_cursor = next_cursor
        assert page_count < 20

    assert page_count == 6
    assert collected_game_ids == expected_game_ids
    assert len(collected_game_ids) == len(set(collected_game_ids)) == 101
    assert final_cursor == page["settled_results"][-1]["event_cursor"]


def test_game_boundary_is_shared_across_player_results(
    v2_client: TestClient,
    database: Database,
) -> None:
    v2_client.get(
        "/api/v2/bootstrap", headers={"Authorization": "Bearer alice-token"}
    )
    first = v2_client.post(
        "/api/v2/admin/player-games/settle",
        headers=settlement_headers("v2-shared-boundary-sga"),
        json=raw_result(game_id="shared-game", player_id="sga", sequence=0),
    )
    assert first.status_code == 201
    opened = open_position(
        v2_client,
        token="alice-token",
        player_id="jokic",
        key="v2-shared-boundary-open",
    )
    assert opened["position"]["opened_event_sequence"] == 1

    conflicting = v2_client.post(
        "/api/v2/admin/player-games/settle",
        headers=settlement_headers("v2-shared-boundary-jokic"),
        json=raw_result(game_id="shared-game", player_id="jokic", sequence=1),
    )

    assert conflicting.status_code == 409
    assert conflicting.json()["error"]["code"] == "game_boundary_conflict"
    with database.session() as session:
        assert (
            session.scalar(
                select(func.count()).select_from(PerGameAccrualRow).where(
                    PerGameAccrualRow.game_id == "shared-game",
                    PerGameAccrualRow.player_id == "jokic",
                )
            )
            == 0
        )


def test_latest_game_pnl_uses_all_games_on_latest_affected_date(
    v2_client: TestClient,
) -> None:
    opened = open_position(
        v2_client,
        token="alice-token",
        player_id="sga",
        key="v2-latest-date-open",
    )
    cost = int(opened["locked_game_cost_dollars"])
    game_one = raw_result(game_id="latest-date-g1", sequence=0, actual=20.0)
    first = v2_client.post(
        "/api/v2/admin/player-games/settle",
        headers=settlement_headers("v2-latest-date-g1"),
        json=game_one,
    )
    assert first.status_code == 201

    game_two = raw_result(
        game_id="latest-date-g2",
        sequence=1,
        actual=30.0,
        game_date="2025-10-23",
        next_game_date="2025-10-24",
    )
    second = v2_client.post(
        "/api/v2/admin/player-games/settle",
        headers=settlement_headers("v2-latest-date-g2"),
        json=game_two,
    )
    assert second.status_code == 201
    assert second.json()["data"]["accounts"][0]["latest_game_pnl_dollars"] == (
        1_200_000 - cost
    )

    same_date = raw_result(
        game_id="latest-date-g3",
        sequence=2,
        actual=10.0,
        game_date="2025-10-23",
        next_game_date="2025-10-24",
    )
    third = v2_client.post(
        "/api/v2/admin/player-games/settle",
        headers=settlement_headers("v2-latest-date-g3"),
        json=same_date,
    )
    assert third.status_code == 201
    expected_latest = (1_200_000 - cost) + (400_000 - cost)
    assert third.json()["data"]["accounts"][0][
        "latest_game_pnl_dollars"
    ] == expected_latest

    correction = v2_client.post(
        "/api/v2/admin/player-games/settle",
        headers=settlement_headers("v2-latest-date-g1-correction"),
        json={**game_one, "result_revision": 2, "actual_net_points": 22.0},
    )
    assert correction.status_code == 201
    corrected_account = correction.json()["data"]["accounts"][0]
    assert corrected_account["latest_game_pnl_dollars"] == expected_latest
    assert corrected_account["cumulative_pnl_dollars"] == (
        (880_000 - cost) + expected_latest
    )

    bootstrap = v2_client.get(
        "/api/v2/bootstrap", headers={"Authorization": "Bearer alice-token"}
    ).json()["data"]
    assert bootstrap["game"]["last_settled_date"] == "2025-10-23"
    assert bootstrap["account"]["latest_game_pnl_dollars"] == expected_latest


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("actual_net_points", 1000.000001),
        ("actual_net_points", -1000.000001),
        ("saved_projection_net_points", 1000.000001),
        ("saved_projection_net_points", -1000.000001),
    ],
)
def test_settlement_rejects_out_of_range_net_points(
    v2_client: TestClient,
    field: str,
    value: float,
) -> None:
    body = {
        **raw_result(game_id=f"range-{field}-{value}"),
        "saved_projection_net_points": 20.0,
        "projection_model": "dnt",
        "projection_version": "pregame-v1",
        "projection_captured_at": datetime(2025, 10, 21, 20, tzinfo=UTC).isoformat(),
        field: value,
    }
    with TestClient(v2_client.app, raise_server_exceptions=False) as client:
        response = client.post(
            "/api/v2/admin/player-games/settle",
            headers=settlement_headers(f"v2-range-{field}-{value}"),
            json=body,
        )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_frozen_api_example_uses_runtime_ledger_kind(
    v2_client: TestClient,
) -> None:
    fixture = json.loads(FROZEN_API_EXAMPLE.read_text(encoding="utf-8"))
    documented_kind = fixture["bootstrap"]["ledger"]["items"][0]["kind"]

    open_position(
        v2_client,
        token="alice-token",
        player_id="sga",
        key="v2-frozen-kind-open",
    )
    settled = v2_client.post(
        "/api/v2/admin/player-games/settle",
        headers=settlement_headers("v2-frozen-kind-settle"),
        json=raw_result(game_id="frozen-kind-game"),
    )
    assert settled.status_code == 201
    bootstrap = v2_client.get(
        "/api/v2/bootstrap", headers={"Authorization": "Bearer alice-token"}
    ).json()["data"]

    assert documented_kind == bootstrap["ledger"]["items"][-1]["kind"]
    assert documented_kind == "game_dividend"
