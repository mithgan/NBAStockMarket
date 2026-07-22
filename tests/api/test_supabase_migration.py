from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path

from sqlalchemy import BigInteger, Boolean, CheckConstraint, DateTime, Integer, JSON, String

from nba_stock_market.api.database import (
    Base,
    EXPECTED_MARKET_SEED,
    database_connect_args,
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
MARKET_SEED = Path(__file__).parents[2] / "data" / "generated" / "market-seed.json"
PUSH_SCRIPT = Path(__file__).parents[2] / "scripts" / "push_supabase_schema.sh"


def normalized_sql() -> str:
    return re.sub(r"\s+", " ", MIGRATION.read_text(encoding="utf-8").lower()).strip()


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
    if isinstance(column_type, Boolean):
        return "boolean"
    if isinstance(column_type, JSON):
        return "json"
    raise AssertionError(f"unsupported ORM type in migration test: {column_type!r}")


def test_supabase_migration_matches_orm_table_structure() -> None:
    sql = MIGRATION.read_text(encoding="utf-8").lower()

    for table in Base.metadata.sorted_tables:
        definition = table_definition(sql, table.name)
        for column in table.columns:
            declaration = re.search(
                rf"(?m)^\s*{re.escape(column.name)}\s+([^,\n]+)",
                definition,
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

        normalized_definition = normalized_constraint_sql(definition)
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
    assert sql.endswith("commit;")


def test_supabase_migration_preserves_authoritative_economy_constraints() -> None:
    sql = normalized_sql()

    assert "cash_cents bigint not null default 14000000000" in sql
    assert "constraint ck_market_holding_whole_player check (shares = 1)" in sql
    assert "unique (account_id, idempotency_key)" in sql
    assert "held_shares >= 0 and held_shares <= shares_outstanding" in sql


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
