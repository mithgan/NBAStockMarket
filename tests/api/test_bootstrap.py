from __future__ import annotations

import json
from datetime import date
from threading import Event, Thread
from time import monotonic

from fastapi.testclient import TestClient
from pydantic import SecretStr
import pytest
from sqlalchemy import text

from tests.api.conftest import FixtureTokenVerifier
from nba_stock_market.api.app import create_app
from nba_stock_market.api.auth import Principal
from nba_stock_market.api.database import Database, SeedPlayer, SeedReplayEvent
from nba_stock_market.api.settings import ApiSettings
import nba_stock_market.api.database as database_module


def test_local_bootstrap_creates_schema_and_loads_seed_file(tmp_path) -> None:
    seed_file = tmp_path / "market-seed.json"
    replay_seed_file = tmp_path / "replay-seed.json"
    seed_file.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "players": [
                    {
                        "id": "sga",
                        "name": "Shai Gilgeous-Alexander",
                        "tier": "star",
                        "current_price_cents": 5_000_000_000,
                        "opening_price_cents": 5_000_000_000,
                        "actual_salary_cents": 4_080_615_000,
                        "shares_outstanding": 100,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    replay_seed_file.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "season_id": "2025-26",
                "days": [
                    {
                        "date": "2025-10-21",
                        "events": [
                            {
                                "game_date": "2025-10-21",
                                "player_id": "sga",
                                    "actual_net_points_micros": 40_000_000,
                                    "expected_net_points_micros": 20_000_000,
                                    "dividend_cents": 80_000_000,
                                        "actual_minutes_micros": 32_000_000,
                                        "projected_minutes_micros": 30_000_000,
                                        "qualifies_for_instruments": True,
                                }
                        ],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    settings = ApiSettings(
        environment="test",
        database_url=f"sqlite+pysqlite:///{tmp_path / 'bootstrap.db'}",
        auto_create_schema=True,
        seed_file=seed_file,
        replay_seed_file=replay_seed_file,
    )
    app = create_app(
        settings=settings,
        token_verifier=FixtureTokenVerifier(
            {"alice-token": Principal(id="alice", display_name="Alice")}
        ),
    )

    with TestClient(app) as client:
        response = client.get(
            "/api/v1/market",
            headers={"Authorization": "Bearer alice-token"},
        )
        game = client.get(
            "/api/v1/game",
            headers={"Authorization": "Bearer alice-token"},
        )

    assert response.status_code == 200
    assert response.json()["data"][0]["id"] == "sga"
    assert game.status_code == 200
    game_data = game.json()["data"]
    assert game_data["next_game_date"] == "2025-10-21"
    assert game_data["next_game_player_ids"] == ["sga"]
    assert game_data["next_game_projections"] == [
        {
            "player_id": "sga",
            "expected_net_points_micros": 20_000_000,
        }
    ]


def test_sqlite_snapshot_session_is_repeatable(tmp_path) -> None:
    database = Database(f"sqlite+pysqlite:///{tmp_path / 'snapshot.db'}")
    with database.engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA journal_mode=WAL")
        connection.exec_driver_sql(
            "CREATE TABLE snapshot_probe (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)"
        )
        connection.exec_driver_sql(
            "INSERT INTO snapshot_probe (id, value) VALUES (1, 1)"
        )

    with database.snapshot_session() as snapshot:
        driver_connection = snapshot.connection().connection.driver_connection
        assert driver_connection.in_transaction is True
        assert snapshot.scalar(text("SELECT value FROM snapshot_probe WHERE id = 1")) == 1

        with database.session() as writer, writer.begin():
            writer.execute(text("UPDATE snapshot_probe SET value = 2 WHERE id = 1"))

        assert snapshot.scalar(text("SELECT value FROM snapshot_probe WHERE id = 1")) == 1

    with database.session() as session, session.begin():
        assert session.scalar(text("SELECT value FROM snapshot_probe WHERE id = 1")) == 2


def test_production_startup_requires_migrated_seeded_database(tmp_path) -> None:
    database = Database(f"sqlite+pysqlite:///{tmp_path / 'empty.db'}")
    database.create_schema()
    settings = ApiSettings(
        environment="production",
        database_url="postgresql+psycopg://market:password@db.example/market",
        supabase_url="https://example.supabase.co",
        settlement_admin_key=SecretStr("test-settlement-admin-key-at-least-32"),
    )
    app = create_app(
        settings=settings,
        database=database,
        token_verifier=FixtureTokenVerifier({}),
    )

    try:
        with pytest.raises(RuntimeError, match="no seeded player listings"):
            with TestClient(app):
                pass
    finally:
        database.dispose()


def test_readiness_rejects_partially_created_database(tmp_path) -> None:
    database = Database(f"sqlite+pysqlite:///{tmp_path / 'partial.db'}")
    with database.engine.begin() as connection:
        connection.execute(
            text("CREATE TABLE market_players (id varchar(64) primary key)")
        )
        connection.execute(text("INSERT INTO market_players (id) VALUES ('sga')"))

    try:
        with pytest.raises(RuntimeError, match="missing required tables"):
            database.assert_ready()
    finally:
        database.dispose()


def test_local_schema_upgrade_removes_legacy_nonnegative_cash_constraint(
    tmp_path,
) -> None:
    database = Database(f"sqlite+pysqlite:///{tmp_path / 'legacy.db'}")
    with database.engine.begin() as connection:
        connection.execute(
            text(
                """
                CREATE TABLE market_accounts (
                    id varchar(128) primary key,
                    display_name varchar(80) not null,
                    cash_cents bigint not null,
                    version integer not null,
                    created_at timestamp not null,
                    updated_at timestamp not null,
                    constraint ck_market_account_cash check (cash_cents >= 0),
                    constraint ck_market_account_version check (version >= 0)
                )
                """
            )
        )
        connection.execute(
            text(
                """
                INSERT INTO market_accounts (
                    id, display_name, cash_cents, version, created_at, updated_at
                ) VALUES (
                    'alice', 'Alice', 100, 0,
                    '2026-07-21 00:00:00', '2026-07-21 00:00:00'
                )
                """
            )
        )

    try:
        database.create_schema()
        with database.engine.begin() as connection:
            connection.execute(
                text("UPDATE market_accounts SET cash_cents = -1 WHERE id = 'alice'")
            )
            account = connection.execute(
                text(
                    "SELECT display_name, cash_cents FROM market_accounts "
                    "WHERE id = 'alice'"
                )
            ).one()
            table_sql = connection.scalar(
                text(
                    "SELECT sql FROM sqlite_master "
                    "WHERE type = 'table' AND name = 'market_accounts'"
                )
            )
            foreign_key_errors = connection.execute(
                text("PRAGMA foreign_key_check")
            ).all()

        assert tuple(account) == ("Alice", -1)
        assert "ck_market_account_cash" not in str(table_sql)
        assert foreign_key_errors == []
    finally:
        database.dispose()


def test_local_schema_upgrade_adds_and_backfills_account_reset_boundary(
    tmp_path,
) -> None:
    database = Database(f"sqlite+pysqlite:///{tmp_path / 'legacy-account.db'}")
    with database.engine.begin() as connection:
        connection.execute(
            text(
                """
                CREATE TABLE market_accounts (
                    id varchar(128) primary key,
                    display_name varchar(80) not null,
                    cash_cents bigint not null,
                    version integer not null,
                    created_at timestamp not null,
                    updated_at timestamp not null,
                    constraint ck_market_account_version check (version >= 0)
                )
                """
            )
        )
        connection.execute(
            text(
                """
                INSERT INTO market_accounts (
                    id, display_name, cash_cents, version, created_at, updated_at
                ) VALUES (
                    'alice', 'Alice', 14000000000, 0,
                    '2026-07-20 10:00:00', '2026-07-20 11:00:00'
                )
                """
            )
        )

    try:
        database.create_schema()
        with database.engine.connect() as connection:
            columns = {
                row[1]
                for row in connection.execute(
                    text("PRAGMA table_info(market_accounts)")
                )
            }
            reset_at = connection.scalar(
                text("SELECT reset_at FROM market_accounts WHERE id = 'alice'")
            )

        assert "reset_at" in columns
        assert str(reset_at).startswith("2026-07-20 10:00:00")
    finally:
        database.dispose()


def test_local_schema_upgrade_retries_partial_reset_boundary_backfill(
    tmp_path,
) -> None:
    database = Database(f"sqlite+pysqlite:///{tmp_path / 'partial-reset.db'}")
    with database.engine.begin() as connection:
        connection.execute(
            text(
                """
                CREATE TABLE market_accounts (
                    id varchar(128) primary key,
                    display_name varchar(80) not null,
                    cash_cents bigint not null,
                    version integer not null,
                    created_at timestamp not null,
                    updated_at timestamp not null,
                    reset_at timestamp,
                    constraint ck_market_account_version check (version >= 0)
                )
                """
            )
        )
        connection.execute(
            text(
                """
                INSERT INTO market_accounts (
                    id, display_name, cash_cents, version,
                    created_at, updated_at, reset_at
                ) VALUES (
                    'alice', 'Alice', 14000000000, 0,
                    '2026-07-20 10:00:00', '2026-07-20 11:00:00', null
                )
                """
            )
        )

    try:
        database.create_schema()
        with database.engine.connect() as connection:
            reset_at = connection.scalar(
                text("SELECT reset_at FROM market_accounts WHERE id = 'alice'")
            )

        assert str(reset_at).startswith("2026-07-20 10:00:00")
    finally:
        database.dispose()


def test_local_schema_upgrade_adds_and_backfills_replay_instrument_metadata(
    tmp_path,
) -> None:
    database = Database(f"sqlite+pysqlite:///{tmp_path / 'legacy-replay.db'}")
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
            )
        ]
    )
    with database.engine.begin() as connection:
        connection.execute(text("DROP TABLE market_replay_events"))
        connection.execute(
            text(
                """
                CREATE TABLE market_replay_events (
                    game_date date not null,
                    player_id varchar(64) not null,
                    actual_net_points_micros bigint not null,
                    expected_net_points_micros bigint not null,
                    dividend_cents bigint not null,
                    primary key (game_date, player_id),
                    foreign key(player_id) references market_players (id)
                )
                """
            )
        )
        connection.execute(
            text(
                """
                INSERT INTO market_replay_events (
                    game_date, player_id, actual_net_points_micros,
                    expected_net_points_micros, dividend_cents
                ) VALUES (
                    '2025-10-21', 'sga', 40000000, 20000000, 80000000
                )
                """
            )
        )

    try:
        database.create_schema()
        database.seed_replay_events(
            season_id="2025-26",
            events=[
                SeedReplayEvent(
                    game_date=date(2025, 10, 21),
                    player_id="sga",
                    actual_net_points_micros=40_000_000,
                    expected_net_points_micros=20_000_000,
                    dividend_cents=80_000_000,
                    actual_minutes_micros=2_100_000,
                    projected_minutes_micros=3_000_000,
                    qualifies_for_instruments=True,
                )
            ],
        )
        with database.engine.connect() as connection:
            columns = {
                row[1]
                for row in connection.execute(
                    text("PRAGMA table_info(market_replay_events)")
                )
            }
            metadata = connection.execute(
                text(
                    """
                    SELECT actual_minutes_micros, projected_minutes_micros,
                           qualifies_for_instruments
                    FROM market_replay_events
                    WHERE game_date = '2025-10-21' AND player_id = 'sga'
                    """
                )
            ).one()

        assert {
            "actual_minutes_micros",
            "projected_minutes_micros",
            "qualifies_for_instruments",
        } <= columns
        assert tuple(metadata) == (2_100_000, 3_000_000, 1)
    finally:
        database.dispose()


def test_readiness_timeout_bounds_one_shared_blocked_worker(
    tmp_path,
    monkeypatch,
) -> None:
    database = Database(f"sqlite+pysqlite:///{tmp_path / 'blocked.db'}")
    release = Event()
    calls = 0

    def blocked_check() -> None:
        nonlocal calls
        calls += 1
        release.wait(timeout=2)

    monkeypatch.setattr(database, "_assert_ready_sync", blocked_check)
    started_at = monotonic()

    try:
        with pytest.raises(RuntimeError, match="timed out"):
            database.assert_ready(timeout_seconds=0.05)
        with pytest.raises(RuntimeError, match="timed out"):
            database.assert_ready(timeout_seconds=0.05)
        assert monotonic() - started_at < 0.5
        assert calls == 1
    finally:
        release.set()
        attempt = database._readiness_attempt
        if attempt is not None and attempt.worker is not None:
            attempt.worker.join(timeout=1)
        database.dispose()


def test_readiness_result_stays_scoped_to_its_attempt(
    tmp_path,
    monkeypatch,
) -> None:
    database = Database(f"sqlite+pysqlite:///{tmp_path / 'attempts.db'}")
    first_wait_blocked = Event()
    release_first_wait = Event()
    caller_finished = Event()
    first_error: list[RuntimeError] = []
    real_event_type = Event
    event_count = 0

    class GatedEvent:
        def __init__(self, gate_waiter: bool) -> None:
            self._event = real_event_type()
            self._gate_waiter = gate_waiter

        def set(self) -> None:
            self._event.set()

        def wait(self, timeout: float | None = None) -> bool:
            result = self._event.wait(timeout)
            if result and self._gate_waiter:
                first_wait_blocked.set()
                release_first_wait.wait(timeout=1)
            return result

    def event_factory() -> GatedEvent | Event:
        nonlocal event_count
        event_count += 1
        return GatedEvent(gate_waiter=event_count == 1)

    check_count = 0

    def sequenced_check() -> None:
        nonlocal check_count
        check_count += 1
        if check_count == 1:
            raise RuntimeError("first readiness failure")

    def first_caller() -> None:
        try:
            database.assert_ready(timeout_seconds=1)
        except RuntimeError as exc:
            first_error.append(exc)
        finally:
            caller_finished.set()

    monkeypatch.setattr(database_module, "ThreadEvent", event_factory)
    monkeypatch.setattr(database, "_assert_ready_sync", sequenced_check)
    caller = Thread(target=first_caller)

    try:
        caller.start()
        assert first_wait_blocked.wait(timeout=1)
        first_attempt = database._readiness_attempt
        assert first_attempt is not None
        assert first_attempt.worker is not None
        first_attempt.worker.join(timeout=1)
        assert not first_attempt.worker.is_alive()
        database.assert_ready(timeout_seconds=1)
        release_first_wait.set()
        assert caller_finished.wait(timeout=1)
        assert [str(error) for error in first_error] == ["first readiness failure"]
        assert check_count == 2
    finally:
        release_first_wait.set()
        caller.join(timeout=1)
        database.dispose()
