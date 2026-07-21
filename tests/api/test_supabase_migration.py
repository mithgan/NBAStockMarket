from __future__ import annotations

import json
import re
from pathlib import Path

from sqlalchemy import BigInteger, Boolean, DateTime, Integer, JSON, String

from nba_stock_market.api.database import Base


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


def normalized_sql() -> str:
    return re.sub(r"\s+", " ", MIGRATION.read_text(encoding="utf-8").lower()).strip()


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

    assert payload["schema_version"] == 1
    assert len(payload["players"]) == 30
    for player in payload["players"]:
        escaped_name = player["name"].replace("'", "''").lower()
        row = (
            f"('{player['id']}', '{escaped_name}', '{player['tier']}', "
            f"{player['current_price_cents']}, {player['opening_price_cents']}, "
            f"{player['actual_salary_cents']}, {player['shares_outstanding']})"
        )
        assert row in sql

    assert "on conflict (id) do nothing" in sql
