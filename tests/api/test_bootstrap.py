from __future__ import annotations

import json
from threading import Event, Thread
from time import monotonic

from fastapi.testclient import TestClient
from pydantic import SecretStr
import pytest
from sqlalchemy import text

from tests.api.conftest import FixtureTokenVerifier
from nba_stock_market.api.app import create_app
from nba_stock_market.api.auth import Principal
from nba_stock_market.api.database import Database
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
    assert game.json()["data"]["next_game_date"] == "2025-10-21"


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
