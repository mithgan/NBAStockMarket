from __future__ import annotations

import json
import os
import re
import subprocess
from datetime import date
from pathlib import Path

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Integer,
    JSON,
    String,
)

from nba_stock_market.api.database import (
    Base,
    EXPECTED_MARKET_MIGRATIONS,
    EXPECTED_MARKET_SEED,
    EXPECTED_REPLAY_EVENT_COUNT,
    EXPECTED_REPLAY_SEED_SHA256,
    database_connect_args,
    replay_seed_digest,
)


MIGRATION = (
    Path(__file__).parents[2]
    / "supabase"
    / "migrations"
    / "20260721000000_create_market_backend.sql"
)
SEED_MIGRATION = (
    Path(__file__).parents[2]
    / "supabase"
    / "migrations"
    / "20260721010000_seed_market_players.sql"
)
SETTLEMENT_MIGRATION = (
    Path(__file__).parents[2]
    / "supabase"
    / "migrations"
    / "20260722000000_create_market_settlement.sql"
)
INSTRUMENT_MIGRATION = (
    Path(__file__).parents[2]
    / "supabase"
    / "migrations"
    / "20260723000000_create_market_instruments.sql"
)
ACCOUNT_HISTORY_MIGRATION = (
    Path(__file__).parents[2]
    / "supabase"
    / "migrations"
    / "20260724000000_create_market_account_history.sql"
)
SCHEMA_MIGRATIONS = (
    MIGRATION,
    SETTLEMENT_MIGRATION,
    INSTRUMENT_MIGRATION,
    ACCOUNT_HISTORY_MIGRATION,
)
MARKET_SEED = Path(__file__).parents[2] / "data" / "generated" / "market-seed.json"
REPLAY_SEED = Path(__file__).parents[2] / "data" / "generated" / "replay-seed.json"
REPLAY_SEED_MIGRATION = (
    Path(__file__).parents[2]
    / "supabase"
    / "migrations"
    / "20260722010000_seed_replay_events.sql"
)
REPLAY_INSTRUMENT_MIGRATION = (
    Path(__file__).parents[2]
    / "supabase"
    / "migrations"
    / "20260723010000_seed_replay_instrument_metadata.sql"
)
ECONOMY_MIGRATION = (
    Path(__file__).parents[2]
    / "supabase"
    / "migrations"
    / "20260815000000_rebase_market_economy.sql"
)
PUSH_SCRIPT = Path(__file__).parents[2] / "scripts" / "push_supabase_schema.sh"


def normalized_sql() -> str:
    return re.sub(r"\s+", " ", cumulative_sql()).strip()


def cumulative_sql() -> str:
    return "\n".join(
        migration.read_text(encoding="utf-8").lower()
        for migration in (*SCHEMA_MIGRATIONS, ECONOMY_MIGRATION)
    )


def normalized_constraint_sql(value: object) -> str:
    normalized = re.sub(r"\s+", " ", str(value).lower()).strip()
    normalized = re.sub(r"\(\s+", "(", normalized)
    return re.sub(r"\s+\)", ")", normalized)


def table_definition(sql: str, table_name: str) -> str:
    marker = f"create table public.{table_name} ("
    start = sql.index(marker) + len(marker)
    depth = 1
    for index in range(start, len(sql)):
        if sql[index] == "(":
            depth += 1
        elif sql[index] == ")":
            depth -= 1
            if depth == 0:
                return sql[start:index]
    raise AssertionError(f"unterminated definition for {table_name}")


def expected_sql_type(column_type: object) -> str:
    if isinstance(column_type, String):
        return f"varchar({column_type.length})"
    if isinstance(column_type, BigInteger):
        return "bigint"
    if isinstance(column_type, Integer):
        return "integer"
    if isinstance(column_type, DateTime):
        return "timestamp without time zone"
    if isinstance(column_type, Date):
        return "date"
    if isinstance(column_type, Boolean):
        return "boolean"
    if isinstance(column_type, JSON):
        return "json"
    raise AssertionError(f"unsupported ORM type in migration test: {column_type!r}")


def test_supabase_migration_matches_orm_table_structure() -> None:
    sql = cumulative_sql()

    for table in Base.metadata.sorted_tables:
        definition = table_definition(sql, table.name)
        for column in table.columns:
            declaration = re.search(
                rf"(?m)^\s*{re.escape(column.name)}\s+([^,\n]+)",
                definition,
            )
            if declaration is None:
                declaration = re.search(
                    rf"add column\s+{re.escape(column.name)}\s+([^,;\n]+)",
                    sql,
                )
            assert declaration, (
                f"{table.name}.{column.name} is missing from its table definition"
            )
            column_sql = declaration.group(1)
            assert column_sql.startswith(expected_sql_type(column.type))
            if not column.nullable and not column.primary_key:
                assert "not null" in column_sql

        primary_key = ", ".join(column.name for column in table.primary_key.columns)
        if len(table.primary_key.columns) > 1:
            assert f"primary key ({primary_key})" in definition

        for foreign_key in table.foreign_keys:
            target = foreign_key.target_fullname.split(".")
            assert (
                f"references public.{target[-2]} ({target[-1]})"
                in definition
            )

        for index in table.indexes:
            columns = ", ".join(column.name for column in index.columns)
            assert (
                f"create index {index.name} on public.{table.name} ({columns})"
                in re.sub(r"\s+", " ", sql)
            )

        normalized_definition = normalized_constraint_sql(sql)
        for constraint in table.constraints:
            if not isinstance(constraint, CheckConstraint):
                continue
            expression = normalized_constraint_sql(constraint.sqltext)
            assert (
                f"constraint {constraint.name} check ({expression})"
                in normalized_definition
            )


def test_supabase_migration_keeps_market_data_server_only() -> None:
    sql = normalized_sql()

    for table in Base.metadata.sorted_tables:
        name = table.name
        assert f"alter table public.{name} enable row level security" in sql
        assert (
            f"revoke all privileges on table public.{name} "
            "from public, anon, authenticated"
        ) in sql
        assert f"grant all privileges on table public.{name} to service_role" in sql

    assert "references auth.users" not in sql
    assert sql.startswith("begin;")
    for migration in SCHEMA_MIGRATIONS:
        migration_sql = re.sub(
            r"\s+", " ", migration.read_text(encoding="utf-8").lower()
        ).strip()
        assert migration_sql.startswith("begin;")
        assert migration_sql.endswith("commit;")


def test_supabase_migration_preserves_authoritative_economy_constraints() -> None:
    sql = normalized_sql()

    assert (
        "alter table public.market_accounts alter column cash_cents "
        "set default 20782400000"
        in sql
    )
    assert "constraint ck_market_holding_whole_player check (shares = 1)" in sql
    assert "unique (account_id, idempotency_key)" in sql
    assert "held_shares >= 0 and held_shares <= shares_outstanding" in sql
    assert "drop constraint if exists ck_market_account_cash" in sql


def test_account_history_migration_backfills_authoritative_activity_ledgers() -> None:
    sql = re.sub(
        r"\s+",
        " ",
        ACCOUNT_HISTORY_MIGRATION.read_text(encoding="utf-8").lower(),
    ).strip()
    backfill_sql = sql.split("-- compatibility triggers", maxsplit=1)[0]

    assert backfill_sql.count("insert into public.market_account_activity") == 6
    for table in (
        "market_trades",
        "market_dividends",
        "market_weekly_shorts",
        "market_boosts",
    ):
        assert f"from public.{table}" in backfill_sql
    for source_key in (
        "'trade:'",
        "'dividend:'",
        "'weekly_short:'",
        "'boost:'",
    ):
        assert source_key in backfill_sql
    assert backfill_sql.count("on conflict (account_id, source_key) do nothing") == 6


def test_account_history_migration_bridges_rolling_api_workers() -> None:
    sql = re.sub(
        r"\s+",
        " ",
        ACCOUNT_HISTORY_MIGRATION.read_text(encoding="utf-8").lower(),
    ).strip()

    advisory_lock = "select pg_advisory_xact_lock(1846237911)"
    account_lock = "lock table public.market_accounts in access exclusive mode"
    source_lock = (
        "lock table public.market_trades, public.market_dividends, "
        "public.market_weekly_shorts, public.market_boosts, "
        "public.market_settlements in share row exclusive mode"
    )
    assert advisory_lock in sql
    assert account_lock in sql
    assert source_lock in sql
    assert sql.index(advisory_lock) < sql.index(account_lock) < sql.index(source_lock)
    for trigger in (
        "market_history_trade_activity_compat",
        "market_history_dividend_activity_compat",
        "market_history_short_opened_compat",
        "market_history_short_terminal_compat",
        "market_history_boost_armed_compat",
        "market_history_boost_terminal_compat",
    ):
        assert f"create trigger {trigger}" in sql
    assert (
        "create constraint trigger market_history_settlement_snapshot_compat "
        "after insert on public.market_settlements deferrable initially deferred"
    ) in sql
    assert (
        "on conflict (account_id, game_date) do nothing; return new; end; $$;"
    ) in sql
    assert "cross join public.market_settlements" in sql
    assert "s.settled_at >= a.created_at" not in sql


def test_seed_migration_reproduces_the_canonical_market_without_overwriting() -> None:
    payload = json.loads(MARKET_SEED.read_text(encoding="utf-8"))
    sql = re.sub(
        r"\s+",
        " ",
        SEED_MIGRATION.read_text(encoding="utf-8").lower(),
    ).strip()
    expected_seed = {
        player["id"]: (
            player["name"],
            player["tier"],
            player["opening_price_cents"],
            player["actual_salary_cents"],
            player["shares_outstanding"],
        )
        for player in payload["players"]
    }

    assert payload["schema_version"] == 1
    assert len(payload["players"]) == 30
    assert EXPECTED_MARKET_SEED == expected_seed
    for player in payload["players"]:
        escaped_name = player["name"].replace("'", "''").lower()
        row = (
            f"('{player['id']}', '{escaped_name}', '{player['tier']}', "
            f"{player['current_price_cents']}, {player['opening_price_cents']}, "
            f"{player['actual_salary_cents']}, {player['shares_outstanding']})"
        )
        assert row in sql

    assert "on conflict (id) do nothing" in sql


def test_replay_seed_migrations_preserve_historical_inputs_before_rebase() -> None:
    payload = json.loads(REPLAY_SEED.read_text(encoding="utf-8"))
    sql = REPLAY_SEED_MIGRATION.read_text(encoding="utf-8").lower()
    events = [event for day in payload["days"] for event in day["events"]]

    assert payload["schema_version"] == 1
    assert payload["season_id"] == "2025-26"
    assert len(payload["days"]) == 164
    assert len(events) == 2_126
    played_events = [event for event in events if event["actual_minutes_micros"] > 0]
    void_events = [event for event in events if event["actual_minutes_micros"] == 0]
    assert len(played_events) == 2_123
    assert len(void_events) == 3
    digest_rows = [
        (
            date.fromisoformat(event["game_date"]),
            event["player_id"],
            event["actual_net_points_micros"],
            event["expected_net_points_micros"],
            event["dividend_cents"],
            event["actual_minutes_micros"],
            event["projected_minutes_micros"],
            event["qualifies_for_instruments"],
        )
        for event in events
    ]
    assert replay_seed_digest(
        sorted(digest_rows, key=lambda row: (row[0], row[1]))
    ) == EXPECTED_REPLAY_SEED_SHA256
    for event in played_events:
        legacy_dividends = {
            event["dividend_cents"] // 2,
            -(-event["dividend_cents"] // 2),
        }
        assert any(
            (
                f"('{event['game_date']}', '{event['player_id']}', "
                f"{event['actual_net_points_micros']}, "
                f"{event['expected_net_points_micros']}, {dividend})"
            )
            in sql
            for dividend in legacy_dividends
        )
    for event in void_events:
        row_prefix = (
            f"('{event['game_date']}', '{event['player_id']}', "
            f"{event['actual_net_points_micros']}, "
            f"{event['expected_net_points_micros']},"
        )
        assert row_prefix not in sql

    assert "on conflict (game_date, player_id) do nothing" in sql
    assert "'historical-2025-26', '2025-26', null" in sql
    assert "on conflict (id) do nothing" in sql
    instrument_sql = REPLAY_INSTRUMENT_MIGRATION.read_text(encoding="utf-8").lower()
    for event in events:
        projected_minutes = (
            str(event["projected_minutes_micros"])
            if event["projected_minutes_micros"] is not None
            else "null"
        )
        qualifies = "true" if event["qualifies_for_instruments"] else "false"
        legacy_dividends = {
            event["dividend_cents"] // 2,
            -(-event["dividend_cents"] // 2),
        }
        assert any(
            (
                f"('{event['game_date']}', '{event['player_id']}', "
                f"{event['actual_net_points_micros']}, "
                f"{event['expected_net_points_micros']}, "
                f"{dividend}, {event['actual_minutes_micros']}, "
                f"{projected_minutes}, {qualifies})"
            )
            in instrument_sql
            for dividend in legacy_dividends
        )
    assert "create temporary table market_replay_instrument_seed" in instrument_sql
    assert "raise exception 'canonical replay event conflict'" in instrument_sql
    assert "qualifies_for_instruments = excluded.qualifies_for_instruments" in (
        instrument_sql
    )
    assert EXPECTED_MARKET_MIGRATIONS == {
        "20260721000000",
        "20260721010000",
        "20260722000000",
        "20260722010000",
        "20260723000000",
        "20260723010000",
        "20260724000000",
        "20260815000000",
    }


def test_database_connection_args_support_supabase_transaction_pooler() -> None:
    transaction_url = (
        "postgresql+psycopg://postgres.project:password@"
        "aws-0-us-west-2.pooler.supabase.com:6543/postgres"
    )
    session_url = transaction_url.replace(":6543/", ":5432/")

    assert database_connect_args(transaction_url) == {
        "connect_timeout": 5,
        "keepalives": 1,
        "keepalives_idle": 5,
        "keepalives_interval": 2,
        "keepalives_count": 2,
        "prepare_threshold": None,
        "tcp_user_timeout": 5_000,
    }
    assert database_connect_args(session_url) == {
        "connect_timeout": 5,
        "keepalives": 1,
        "keepalives_idle": 5,
        "keepalives_interval": 2,
        "keepalives_count": 2,
        "tcp_user_timeout": 5_000,
    }
    assert database_connect_args("sqlite+pysqlite:///:memory:") == {
        "check_same_thread": False
    }


def test_economy_migration_rebases_full_seed_without_self_recording() -> None:
    sql = ECONOMY_MIGRATION.read_text(encoding="utf-8").lower()
    normalized = re.sub(r"\s+", " ", sql)

    assert sql.count("\n    ('20") == EXPECTED_REPLAY_EVENT_COUNT
    assert "where version = '20260815000000'" in sql
    assert "insert into supabase_migrations.schema_migrations" not in sql
    assert "cannot rebase market economy after historical settlements exist" in sql
    assert "before insert on public.market_accounts" in sql
    assert "if new.cash_cents = 14000000000 then" in sql
    assert "message = 'legacy $140m market worker rejected'" in sql
    assert (
        "revoke all on function public.market_reject_legacy_starting_cash() "
        "from public"
    ) in re.sub(r"\s+", " ", sql)
    assert (
        "if to_regclass('public.market_production_settlement_events') "
        "is not null then"
    ) in re.sub(r"\s+", " ", sql)
    assert "required market production settlement table is missing" not in sql
    assert "before insert on public.market_production_settlement_events" in sql
    assert "message = 'legacy settlement worker rejected'" in sql
    assert ") is distinct from true then" in sql
    assert (
        "net-points-v1+dnt-bias-0.43586495+usd-80000" in sql
        and "net-points-v1+dnt-bias-0.43586495+usd-40000" in sql
    )
    assert (
        "revoke all on function public.market_guard_settlement_economy() "
        "from public"
    ) in re.sub(r"\s+", " ", sql)
    assert "actual_minutes_micros bigint not null" in sql
    assert "projected_minutes_micros bigint" in sql
    assert "qualifies_for_instruments boolean not null" in sql
    assert sql.count("update public.market_portfolio_snapshots") == 1
    assert "free_cash_cents = free_cash_cents + 6782400000" in sql
    assert "total_value_cents = total_value_cents + 6782400000" in sql
    assert (
        "from public.market_settlements as settlement where "
        "settlement.game_date = event.game_date"
    ) not in normalized
    assert "is distinct from seed.projected_minutes_micros" in sql
    assert (
        "('2025-12-25', '3112335', 59350000, 25972740, 267018073, "
        "43000000, 32308300, true)"
        in sql
    )
    assert not sql.startswith("begin;")
    assert not sql.rstrip().endswith("commit;")


def test_supabase_push_helper_stops_when_linking_fails(tmp_path) -> None:
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    calls = tmp_path / "npx-calls.txt"
    fake_npx = fake_bin / "npx"
    fake_npx.write_text(
        "#!/bin/sh\n"
        'printf "%s\\n" "$*" >> "$CALLS_LOG"\n'
        'if [ "$2" = "link" ]; then exit 7; fi\n'
        "exit 0\n",
        encoding="utf-8",
    )
    fake_npx.chmod(0o755)

    project = tmp_path / "project"
    (project / "supabase").mkdir(parents=True)
    environment = {
        **os.environ,
        "PATH": f"{fake_bin}:{os.environ['PATH']}",
        "CALLS_LOG": str(calls),
        "NBA_STOCK_REPO_ROOT": str(project),
        "SUPABASE_PROJECT_REF": "expected-project",
        "SUPABASE_DB_PASSWORD": "test-password",
    }

    result = subprocess.run(
        ["bash", str(PUSH_SCRIPT)],
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 7
    assert calls.read_text(encoding="utf-8").splitlines() == [
        "supabase link --project-ref expected-project"
    ]


def test_supabase_push_helper_rejects_wrong_linked_project(tmp_path) -> None:
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    calls = tmp_path / "npx-calls.txt"
    fake_npx = fake_bin / "npx"
    fake_npx.write_text(
        "#!/bin/sh\n"
        'printf "%s\\n" "$*" >> "$CALLS_LOG"\n'
        'if [ "$2" = "link" ]; then\n'
        '  mkdir -p "$NBA_STOCK_REPO_ROOT/supabase/.temp"\n'
        '  printf "%s\\n" "wrong-project" > '
        '"$NBA_STOCK_REPO_ROOT/supabase/.temp/project-ref"\n'
        "fi\n"
        "exit 0\n",
        encoding="utf-8",
    )
    fake_npx.chmod(0o755)

    project = tmp_path / "project"
    (project / "supabase").mkdir(parents=True)
    result = subprocess.run(
        ["bash", str(PUSH_SCRIPT)],
        env={
            **os.environ,
            "PATH": f"{fake_bin}:{os.environ['PATH']}",
            "CALLS_LOG": str(calls),
            "NBA_STOCK_REPO_ROOT": str(project),
            "SUPABASE_PROJECT_REF": "expected-project",
            "SUPABASE_DB_PASSWORD": "test-password",
        },
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode != 0
    assert "linked project is 'wrong-project'" in result.stderr
    assert calls.read_text(encoding="utf-8").splitlines() == [
        "supabase link --project-ref expected-project"
    ]


def test_supabase_push_helper_stops_when_dry_run_fails(tmp_path) -> None:
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    calls = tmp_path / "npx-calls.txt"
    fake_npx = fake_bin / "npx"
    fake_npx.write_text(
        "#!/bin/sh\n"
        'printf "%s\\n" "$*" >> "$CALLS_LOG"\n'
        'if [ "$2" = "link" ]; then\n'
        '  mkdir -p "$NBA_STOCK_REPO_ROOT/supabase/.temp"\n'
        '  printf "%s\\n" "$SUPABASE_PROJECT_REF" > '
        '"$NBA_STOCK_REPO_ROOT/supabase/.temp/project-ref"\n'
        "fi\n"
        'if [ "$*" = "supabase db push --dry-run" ]; then exit 9; fi\n'
        "exit 0\n",
        encoding="utf-8",
    )
    fake_npx.chmod(0o755)

    project = tmp_path / "project"
    (project / "supabase").mkdir(parents=True)
    result = subprocess.run(
        ["bash", str(PUSH_SCRIPT)],
        env={
            **os.environ,
            "PATH": f"{fake_bin}:{os.environ['PATH']}",
            "CALLS_LOG": str(calls),
            "NBA_STOCK_REPO_ROOT": str(project),
            "SUPABASE_PROJECT_REF": "expected-project",
            "SUPABASE_DB_PASSWORD": "test-password",
        },
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 9
    assert calls.read_text(encoding="utf-8").splitlines() == [
        "supabase link --project-ref expected-project",
        "supabase db push --dry-run",
    ]
