#!/usr/bin/env python3
"""Generate deterministic app trend series from committed 2025-26 caches."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from nba_stock_market.backtest import GameRecord, load_salary_by_name, select_universe
from nba_stock_market.bias import (
    ROLLING_MIN_GAMES,
    ROLLING_WINDOW_DAYS,
    rolling_bias_for_date,
)
from nba_stock_market.engine import (
    DOLLARS_PER_NET_POINT,
    BoxScoreLine,
    NetPointsModel,
    Player,
)
from nba_stock_market.expectations import (
    DunksAndThreesExpectation,
    player_salary_implied_net_points,
)
from nba_stock_market.historical_data import load_game_records


GAME_LOG = ROOT / "data/raw/2025-26/player_game_logs.csv"
SALARY_FILES = (
    ROOT / "data/raw/2025-26/salaries.csv",
    ROOT / "data/raw/2025-26/salaries-fallback.csv",
)
DNT_CACHE = ROOT / "data/raw/dnt"
SNAPSHOT = ROOT / "app/src/data/snapshot.ts"
DEFAULT_OUTPUT = ROOT / "app/src/data/trends.ts"
DEFAULT_API_OUTPUT = ROOT / "data/generated/replay-seed.json"
MIN_GAME_COUNT = 15
CALIBRATION_UNIVERSE_SIZE = 150
PER_HOLDER_DOLLARS_PER_NP = DOLLARS_PER_NET_POINT
# Verified from the prior-season October cache; see docs/data-regeneration.md.
APP_COLD_START_BIAS_NET_POINTS = 1.002

SNAPSHOT_PLAYER = re.compile(
    r'\{ id: "([^"]+)", name: "([^"]+)", tier: "([^"]+)", '
    r"listing_price: ([\d_]+), actual_salary: ([\d_]+) \}"
)


def _snapshot_players(path: Path = SNAPSHOT) -> list[Player]:
    players: list[Player] = []
    for match in SNAPSHOT_PLAYER.finditer(path.read_text(encoding="utf-8")):
        player_id, name, tier, price, salary = match.groups()
        listing_price = float(price.replace("_", ""))
        players.append(
            Player(
                player_id,
                name,
                tier,
                listing_price,
                listing_price,
                actual_salary=float(salary.replace("_", "")),
            )
        )
    if len(players) != 30:
        raise ValueError(f"expected 30 snapshot players, found {len(players)} in {path}")
    return players


def _rounded(value: float, digits: int) -> float:
    rounded = round(value, digits)
    return 0.0 if rounded == 0 else rounded


def generate() -> dict[str, Any]:
    if PER_HOLDER_DOLLARS_PER_NP != 80_000:
        raise ValueError(
            "engine dividend constants no longer implement the selected $80K/NP holder rule"
        )

    players = _snapshot_players()
    player_by_id = {player.id: player for player in players}
    all_games = load_game_records(GAME_LOG)
    salaries = load_salary_by_name(list(SALARY_FILES))
    calibration_universe = select_universe(
        all_games,
        salaries,
        size=CALIBRATION_UNIVERSE_SIZE,
    )
    calibration_players = {
        listed.player_id: Player(
            listed.player_id,
            listed.name,
            listed.tier,
            listed.salary,
            listed.salary,
            actual_salary=listed.actual_salary,
        )
        for listed in calibration_universe
    }
    calibration_events_by_date: defaultdict[date, list[GameRecord]] = defaultdict(list)
    games_by_player: defaultdict[str, list[GameRecord]] = defaultdict(list)
    for game in all_games:
        if game.player_id in calibration_players:
            calibration_events_by_date[game.game_date].append(game)
        if game.player_id in player_by_id:
            games_by_player[game.player_id].append(game)

    net_points = NetPointsModel()
    expectations = DunksAndThreesExpectation(cache_dir=DNT_CACHE)

    events_by_date: defaultdict[date, list[tuple[Player, GameRecord]]] = defaultdict(list)
    for player in players:
        games = sorted(
            games_by_player[player.id],
            key=lambda game: (game.game_date, game.game_id),
        )
        if len(games) < MIN_GAME_COUNT:
            raise ValueError(
                f"{player.name} has only {len(games)} cached games; need {MIN_GAME_COUNT}"
            )
        for game in games:
            events_by_date[game.game_date].append((player, game))

    trends: dict[str, list[dict[str, bool | float | str | None]]] = {
        player.id: [] for player in players
    }
    raw_surprises: list[tuple[date, float]] = []
    bias_corrections: dict[str, float] = {}
    projection_count = 0
    instrument_void_events: list[dict[str, bool | float | str | None]] = []
    for game_date in sorted(calibration_events_by_date):
        correction = rolling_bias_for_date(
            raw_surprises,
            game_date,
            seed_bias=APP_COLD_START_BIAS_NET_POINTS,
        )
        bias_corrections[game_date.isoformat()] = _rounded(correction, 8)
        daily_surprises: list[tuple[date, float]] = []
        raw_expected_by_game: dict[tuple[str, str], float] = {}
        projected_box_by_game: dict[tuple[str, str], BoxScoreLine] = {}
        for game in sorted(
            calibration_events_by_date[game_date],
            key=lambda item: (item.player_id, item.game_id),
        ):
            calibration_player = calibration_players[game.player_id]
            projected = expectations.expected_performance(calibration_player, game_date)
            if projected is None:
                continue
            raw_expected_np = (
                net_points.score(projected)
                if isinstance(projected, BoxScoreLine)
                else float(projected)
            )
            actual_np = net_points.score(game.box_score)
            raw_expected_by_game[(game.player_id, game.game_id)] = raw_expected_np
            if isinstance(projected, BoxScoreLine):
                projected_box_by_game[(game.player_id, game.game_id)] = projected
            daily_surprises.append((game_date, actual_np - raw_expected_np))
            projection_count += 1

        played_player_ids: set[str] = set()
        for player, game in sorted(
            events_by_date.get(game_date, []),
            key=lambda item: (item[0].id, item[1].game_id),
        ):
            played_player_ids.add(player.id)
            actual_np = net_points.score(game.box_score)
            raw_expected_np = raw_expected_by_game.get((player.id, game.game_id))
            projected_box = projected_box_by_game.get((player.id, game.game_id))
            if raw_expected_np is None:
                projected = expectations.expected_performance(player, game_date)
                projected_box = projected if isinstance(projected, BoxScoreLine) else None
                raw_expected_np = (
                    player_salary_implied_net_points(player)
                    if projected is None
                    else net_points.score(projected)
                    if isinstance(projected, BoxScoreLine)
                    else float(projected)
                )
            expected_np = raw_expected_np + correction
            actual_minutes = float(game.box_score.minutes)
            projected_minutes = (
                float(projected_box.minutes) if projected_box is not None else None
            )
            qualifies_for_instruments = bool(
                projected_minutes is not None
                and projected_minutes > 0
                and actual_minutes >= 0.40 * projected_minutes
            )
            trends[player.id].append(
                {
                    "date": game_date.isoformat(),
                    "np": _rounded(actual_np, 5),
                    "expected_np": _rounded(expected_np, 5),
                    "dividend_per_holder": _rounded(
                        (actual_np - expected_np) * PER_HOLDER_DOLLARS_PER_NP,
                        2,
                    ),
                    "actual_minutes": _rounded(actual_minutes, 5),
                    "projected_minutes": (
                        _rounded(projected_minutes, 5)
                        if projected_minutes is not None
                        else None
                    ),
                    "qualifies_for_instruments": qualifies_for_instruments,
                }
            )
        for player in sorted(players, key=lambda item: item.id):
            if player.id in played_player_ids:
                continue
            projected = expectations.expected_performance(player, game_date)
            if not isinstance(projected, BoxScoreLine):
                continue
            projected_minutes = float(projected.minutes)
            if projected_minutes <= 0:
                continue
            instrument_void_events.append(
                {
                    "player_id": player.id,
                    "date": game_date.isoformat(),
                    "np": 0.0,
                    "expected_np": _rounded(
                        net_points.score(projected) + correction,
                        5,
                    ),
                    "dividend_per_holder": 0.0,
                    "actual_minutes": 0.0,
                    "projected_minutes": _rounded(projected_minutes, 5),
                    "qualifies_for_instruments": False,
                }
            )
        raw_surprises.extend(daily_surprises)

    christmas = next(
        point
        for point in trends["3112335"]
        if point["date"] == "2025-12-25"
    )
    return {
        "player_trends": trends,
        "instrument_void_events": instrument_void_events,
        "spot_checks": {"3112335": {"2025-12-25": christmas}},
        "metadata": {
            "cold_start_bias_net_points": APP_COLD_START_BIAS_NET_POINTS,
            "rolling_window_days": ROLLING_WINDOW_DAYS,
            "rolling_minimum_games": ROLLING_MIN_GAMES,
            "calibration_universe_size": len(calibration_universe),
            "calibration_projection_count": projection_count,
            "instrument_void_event_count": len(instrument_void_events),
            "bias_corrections": bias_corrections,
        },
    }


def render_typescript(generated: dict[str, Any]) -> str:
    def public_point(point: dict[str, Any]) -> dict[str, Any]:
        return {
            "date": point["date"],
            "np": point["np"],
            "expected_np": point["expected_np"],
            "dividend_per_holder": point["dividend_per_holder"],
        }

    public_trends = {
        player_id: [public_point(point) for point in points]
        for player_id, points in generated["player_trends"].items()
    }
    public_spot_checks = {
        player_id: {
            game_date: public_point(point)
            for game_date, point in dated_points.items()
        }
        for player_id, dated_points in generated["spot_checks"].items()
    }
    trends = json.dumps(public_trends, indent=2, ensure_ascii=False)
    spot_checks = json.dumps(public_spot_checks, indent=2, ensure_ascii=False)
    return (
        "// Generated by scripts/generate_app_trends.py from committed ESPN and D&T caches.\n"
        "// Do not edit by hand.\n\n"
        "export interface TrendPoint {\n"
        "  date: string;\n"
        "  np: number;\n"
        "  expected_np: number;\n"
        "  dividend_per_holder: number;\n"
        "}\n\n"
        f"export const playerTrends: Record<string, TrendPoint[]> = {trends};\n\n"
        "// A stable source-data spot check retained alongside the full-season series.\n"
        "export const trendSpotChecks: Record<string, Record<string, TrendPoint>> = "
        f"{spot_checks};\n"
    )


def render_api_seed(generated: dict[str, Any]) -> dict[str, Any]:
    events_by_date: defaultdict[str, list[dict[str, int | str]]] = defaultdict(list)
    replay_points = [
        (player_id, point)
        for player_id, points in generated["player_trends"].items()
        for point in points
    ]
    replay_points.extend(
        (str(point["player_id"]), point)
        for point in generated["instrument_void_events"]
    )
    for player_id, point in replay_points:
        game_date = str(point["date"])
        events_by_date[game_date].append(
            {
                "player_id": player_id,
                "game_date": game_date,
                "actual_net_points_micros": round(float(point["np"]) * 1_000_000),
                "expected_net_points_micros": round(
                    float(point["expected_np"]) * 1_000_000
                ),
                "dividend_cents": round(
                    float(point["dividend_per_holder"]) * 100
                ),
                "actual_minutes_micros": round(
                    float(point["actual_minutes"]) * 1_000_000
                ),
                "projected_minutes_micros": (
                    round(float(point["projected_minutes"]) * 1_000_000)
                    if point["projected_minutes"] is not None
                    else None
                ),
                "qualifies_for_instruments": bool(
                    point["qualifies_for_instruments"]
                ),
            }
        )

    return {
        "schema_version": 1,
        "season_id": "2025-26",
        "days": [
            {
                "date": game_date,
                "events": sorted(
                    events_by_date[game_date],
                    key=lambda event: str(event["player_id"]),
                ),
            }
            for game_date in sorted(events_by_date)
        ],
    }


def render_api_seed_sql(seed: dict[str, Any]) -> str:
    rows = [
        (
            f"    ('{event['game_date']}', '{event['player_id']}', "
            f"{event['actual_net_points_micros']}, "
            f"{event['expected_net_points_micros']}, {event['dividend_cents']}, "
            f"{event['actual_minutes_micros']})"
        )
        for day in seed["days"]
        for event in day["events"]
    ]
    season_id = str(seed["season_id"]).replace("'", "''")
    values = ",\n".join(rows)
    return (
        "begin;\n\n"
        "create temporary table market_replay_event_seed (\n"
        "    game_date date not null,\n"
        "    player_id varchar(64) not null,\n"
        "    actual_net_points_micros bigint not null,\n"
        "    expected_net_points_micros bigint not null,\n"
        "    dividend_cents bigint not null,\n"
        "    actual_minutes_micros bigint not null,\n"
        "    primary key (game_date, player_id)\n"
        ") on commit drop;\n\n"
        "insert into market_replay_event_seed values\n"
        f"{values}\n"
        ";\n\n"
        "lock table public.market_replay_events in share row exclusive mode;\n\n"
        "do $$\n"
        "begin\n"
        "    if exists (\n"
        "        select 1\n"
        "        from public.market_replay_events as event\n"
        "        join market_replay_event_seed as seed\n"
        "          using (game_date, player_id)\n"
        "        where event.actual_net_points_micros\n"
        "                  is distinct from seed.actual_net_points_micros\n"
        "           or event.expected_net_points_micros\n"
        "                  is distinct from seed.expected_net_points_micros\n"
        "           or event.dividend_cents\n"
        "                  is distinct from seed.dividend_cents\n"
        "        union all\n"
        "        select 1\n"
        "        from public.market_replay_events as event\n"
        "        where not exists (\n"
        "            select 1\n"
        "            from market_replay_event_seed as seed\n"
        "            where seed.game_date = event.game_date\n"
        "              and seed.player_id = event.player_id\n"
        "        )\n"
        "    ) then\n"
        "        raise exception 'canonical replay event conflict';\n"
        "    end if;\n"
        "end\n"
        "$$;\n\n"
        "insert into public.market_replay_events (\n"
        "    game_date,\n"
        "    player_id,\n"
        "    actual_net_points_micros,\n"
        "    expected_net_points_micros,\n"
        "    dividend_cents\n"
        ")\n"
        "select game_date, player_id, actual_net_points_micros,\n"
        "       expected_net_points_micros, dividend_cents\n"
        "from market_replay_event_seed\n"
        "where actual_minutes_micros > 0\n"
        "on conflict (game_date, player_id) do nothing;\n\n"
        "insert into public.market_game_state (\n"
        "    id, season_id, last_settled_date, next_game_date, version\n"
        ") values (\n"
        f"    'historical-{season_id}', '{season_id}', null,\n"
        "    (select min(game_date) from public.market_replay_events), 0\n"
        ")\n"
        "on conflict (id) do nothing;\n\n"
        "commit;\n"
    )


def render_api_instrument_metadata_sql(seed: dict[str, Any]) -> str:
    rows = [
        (
            f"    ('{event['game_date']}', '{event['player_id']}', "
            f"{event['actual_net_points_micros']}, "
            f"{event['expected_net_points_micros']}, "
            f"{event['dividend_cents']}, "
            f"{event['actual_minutes_micros']}, "
            f"{event['projected_minutes_micros'] if event['projected_minutes_micros'] is not None else 'null'}, "
            f"{'true' if event['qualifies_for_instruments'] else 'false'})"
        )
        for day in seed["days"]
        for event in day["events"]
    ]
    values = ",\n".join(rows)
    return (
        "begin;\n\n"
        "create temporary table market_replay_instrument_seed (\n"
        "    game_date date not null,\n"
        "    player_id varchar(64) not null,\n"
        "    actual_net_points_micros bigint not null,\n"
        "    expected_net_points_micros bigint not null,\n"
        "    dividend_cents bigint not null,\n"
        "    actual_minutes_micros bigint not null,\n"
        "    projected_minutes_micros bigint,\n"
        "    qualifies_for_instruments boolean not null,\n"
        "    primary key (game_date, player_id)\n"
        ") on commit drop;\n\n"
        "insert into market_replay_instrument_seed values\n"
        f"{values}\n"
        ";\n\n"
        "lock table public.market_replay_events in share row exclusive mode;\n\n"
        "do $$\n"
        "begin\n"
        "    if exists (\n"
        "        select 1\n"
        "        from public.market_replay_events as event\n"
        "        join market_replay_instrument_seed as seed\n"
        "          using (game_date, player_id)\n"
        "        where event.actual_net_points_micros <> seed.actual_net_points_micros\n"
        "           or event.expected_net_points_micros <> seed.expected_net_points_micros\n"
        "           or event.dividend_cents <> seed.dividend_cents\n"
        "        union all\n"
        "        select 1\n"
        "        from public.market_replay_events as event\n"
        "        where not exists (\n"
        "            select 1\n"
        "            from market_replay_instrument_seed as seed\n"
        "            where seed.game_date = event.game_date\n"
        "              and seed.player_id = event.player_id\n"
        "        )\n"
        "    ) then\n"
        "        raise exception 'canonical replay event conflict';\n"
        "    end if;\n"
        "end\n"
        "$$;\n\n"
        "insert into public.market_replay_events (\n"
        "    game_date, player_id, actual_net_points_micros,\n"
        "    expected_net_points_micros, dividend_cents,\n"
        "    actual_minutes_micros, projected_minutes_micros,\n"
        "    qualifies_for_instruments\n"
        ")\n"
        "select game_date, player_id, actual_net_points_micros,\n"
        "       expected_net_points_micros, dividend_cents,\n"
        "       actual_minutes_micros, projected_minutes_micros,\n"
        "       qualifies_for_instruments\n"
        "from market_replay_instrument_seed\n"
        "on conflict (game_date, player_id) do update\n"
        "set actual_minutes_micros = excluded.actual_minutes_micros,\n"
        "    projected_minutes_micros = excluded.projected_minutes_micros,\n"
        "    qualifies_for_instruments = excluded.qualifies_for_instruments;\n\n"
        "commit;\n"
    )


def render_api_economy_rebase_sql(
    seed: dict[str, Any],
    *,
    migration_version: str,
    record_migration: bool = False,
) -> str:
    if re.fullmatch(r"\d{14}", migration_version) is None:
        raise ValueError("migration version must be a 14-digit timestamp")
    events = [event for day in seed["days"] for event in day["events"]]
    rows = []
    for event in events:
        projected_minutes = (
            event["projected_minutes_micros"]
            if event["projected_minutes_micros"] is not None
            else "null"
        )
        qualifies = "true" if event["qualifies_for_instruments"] else "false"
        rows.append(
            f"    ('{event['game_date']}', '{event['player_id']}', "
            f"{event['actual_net_points_micros']}, "
            f"{event['expected_net_points_micros']}, {event['dividend_cents']}, "
            f"{event['actual_minutes_micros']}, "
            f"{projected_minutes}, {qualifies})"
        )
    values = ",\n".join(rows)
    migration_record = (
        "        insert into supabase_migrations.schema_migrations (version)\n"
        f"        values ('{migration_version}')\n"
        "        on conflict (version) do nothing;\n"
        if record_migration
        else ""
    )
    transaction_start = "begin;\n\n" if record_migration else ""
    transaction_end = "\ncommit;\n" if record_migration else ""
    settlement_table_requirement = (
        "    if to_regclass('public.market_production_settlement_events')\n"
        "            is null\n"
        "        or to_regclass(\n"
        "            'public.market_production_instrument_applications'\n"
        "        ) is null then\n"
        "        raise exception using\n"
        "            errcode = '55000',\n"
        "            message = 'required market production settlement tables are missing';\n"
        "    end if;\n\n"
        if record_migration
        else ""
    )
    settlement_lock = (
        "        lock table public.market_accounts, public.market_replay_events,\n"
        "            public.market_settlements,\n"
        "            public.market_production_settlement_events,\n"
        "            public.market_production_instrument_applications\n"
        "            in access exclusive mode;\n\n"
        if record_migration
        else (
            "        lock table public.market_accounts, public.market_replay_events,\n"
            "            public.market_settlements in access exclusive mode;\n\n"
        )
    )
    settlement_rebase_guard = (
        "        if exists (\n"
        "            select 1\n"
        "            from public.market_settlements as settlement\n"
        "            where settlement.idempotency_key\n"
        "                    <> 'production:' || settlement.game_date::text\n"
        "               or coalesce(\n"
        "                    settlement.response_payload ->> 'source', ''\n"
        "                  ) <> 'production_pipeline'\n"
        "               or not (\n"
        "                    exists (\n"
        "                        select 1\n"
        "                        from public.market_production_settlement_events\n"
        "                            as event\n"
        "                        where event.game_date = settlement.game_date\n"
        "                          and event.event_type = 'original'\n"
        "                          and (event.calculation_inputs ->>\n"
        "                              'expectation_bias_micros')::bigint = 435865\n"
        "                          and (\n"
        "                              (event.formula_version =\n"
        "                                  'net-points-v1+dnt-bias-0.43586495+usd-40000'\n"
        "                               and (event.calculation_inputs ->>\n"
        "                                  'dollars_per_net_point')::numeric = 40000)\n"
        "                              or (event.formula_version =\n"
        "                                  'net-points-v1+dnt-bias-0.43586495+usd-80000'\n"
        "                               and (event.calculation_inputs ->>\n"
        "                                  'dollars_per_net_point')::numeric = 80000)\n"
        "                          )\n"
        "                    )\n"
        "                    or exists (\n"
        "                        select 1\n"
        "                        from public.market_production_instrument_applications\n"
        "                            as application\n"
        "                        where application.game_date = settlement.game_date\n"
        "                    )\n"
        "               )\n"
        "        ) then\n"
        "            raise exception 'cannot rebase market economy after historical or unverified settlements exist';\n"
        "        end if;\n\n"
        if record_migration
        else (
            "        if exists (select 1 from public.market_settlements) then\n"
            "            raise exception 'cannot rebase market economy after historical settlements exist';\n"
            "        end if;\n\n"
        )
    )
    legacy_replay_dividend_cte = (
        "        with legacy_replay_dividends as (\n"
        "            select legacy_event.game_date, legacy_event.player_id,\n"
        "                min(legacy_event.canonical_dividend_cents)\n"
        "                    as dividend_cents\n"
        "            from public.market_production_settlement_events\n"
        "                as legacy_event\n"
        "            join public.market_settlements as legacy_settlement\n"
        "              on legacy_settlement.game_date = legacy_event.game_date\n"
        "            join market_economy_replay_seed as legacy_seed\n"
        "              on legacy_seed.game_date = legacy_event.game_date\n"
        "             and legacy_seed.player_id = legacy_event.player_id\n"
        "             and legacy_seed.actual_net_points_micros =\n"
        "                 legacy_event.actual_net_points_micros\n"
        "            where legacy_settlement.idempotency_key =\n"
        "                    'production:' || legacy_settlement.game_date::text\n"
        "              and coalesce(legacy_settlement.response_payload ->>\n"
        "                    'source', '') = 'production_pipeline'\n"
        "              and legacy_event.event_type = 'original'\n"
        "              and legacy_event.formula_version =\n"
        "                    'net-points-v1+dnt-bias-0.43586495+usd-40000'\n"
        "              and (legacy_event.calculation_inputs ->>\n"
        "                    'expectation_bias_micros')::bigint = 435865\n"
        "              and (legacy_event.calculation_inputs ->>\n"
        "                    'dollars_per_net_point')::numeric = 40000\n"
        "            group by legacy_event.game_date, legacy_event.player_id\n"
        "            having count(*) = 1\n"
        "        )\n"
        if record_migration
        else ""
    )
    legacy_replay_join = (
        "        left join legacy_replay_dividends as legacy\n"
        "          on legacy.game_date = seed.game_date\n"
        "         and legacy.player_id = seed.player_id\n"
        if record_migration
        else ""
    )
    replay_dividend_expression = (
        "coalesce(legacy.dividend_cents, seed.dividend_cents)"
        if record_migration
        else "seed.dividend_cents"
    )
    return transaction_start + (
        "select pg_advisory_xact_lock(1846237911);\n\n"
        "create temporary table market_economy_replay_seed (\n"
        "    game_date date not null,\n"
        "    player_id varchar(64) not null,\n"
        "    actual_net_points_micros bigint not null,\n"
        "    expected_net_points_micros bigint not null,\n"
        "    dividend_cents bigint not null,\n"
        "    actual_minutes_micros bigint not null,\n"
        "    projected_minutes_micros bigint,\n"
        "    qualifies_for_instruments boolean not null,\n"
        "    primary key (game_date, player_id)\n"
        ") on commit drop;\n\n"
        "insert into market_economy_replay_seed values\n"
        f"{values}\n"
        ";\n\n"
        "create or replace function public.market_reject_legacy_starting_cash()\n"
        "returns trigger\n"
        "language plpgsql\n"
        "set search_path = pg_catalog, public\n"
        "as $function$\n"
        "begin\n"
        "    if new.cash_cents = 14000000000 then\n"
        "        raise exception using\n"
        "            errcode = '55000',\n"
        "            message = 'legacy $140M market worker rejected';\n"
        "    end if;\n"
        "    return new;\n"
        "end;\n"
        "$function$;\n\n"
        "revoke all on function public.market_reject_legacy_starting_cash()\n"
        "    from public;\n\n"
        "drop trigger if exists market_accounts_reject_legacy_starting_cash\n"
        "    on public.market_accounts;\n"
        "create trigger market_accounts_reject_legacy_starting_cash\n"
        "before insert on public.market_accounts\n"
        "for each row execute function public.market_reject_legacy_starting_cash();\n\n"
        "create or replace function public.market_guard_settlement_economy()\n"
        "returns trigger\n"
        "language plpgsql\n"
        "set search_path = pg_catalog, public\n"
        "as $function$\n"
        "declare\n"
        "    persisted_bias bigint;\n"
        "    persisted_rate numeric;\n"
        "begin\n"
        "    persisted_bias := (\n"
        "        new.calculation_inputs ->> 'expectation_bias_micros'\n"
        "    )::bigint;\n"
        "    persisted_rate := (\n"
        "        new.calculation_inputs ->> 'dollars_per_net_point'\n"
        "    )::numeric;\n\n"
        "    if persisted_bias is distinct from 435865 then\n"
        "        raise exception using\n"
        "            errcode = '55000',\n"
        "            message = 'unsupported settlement economy parameters';\n"
        "    end if;\n\n"
        "    if new.event_type = 'original' then\n"
        "        if new.formula_version is distinct from\n"
        "                'net-points-v1+dnt-bias-0.43586495+usd-80000'\n"
        "            or persisted_rate is distinct from 80000 then\n"
        "            raise exception using\n"
        "                errcode = '55000',\n"
        "                message = 'legacy settlement worker rejected';\n"
        "        end if;\n"
        "    elsif new.event_type = 'adjustment' then\n"
        "        if (\n"
        "            (\n"
        "                new.formula_version =\n"
        "                    'net-points-v1+dnt-bias-0.43586495+usd-80000'\n"
        "                and persisted_rate = 80000\n"
        "            )\n"
        "            or (\n"
        "                new.formula_version =\n"
        "                    'net-points-v1+dnt-bias-0.43586495+usd-40000'\n"
        "                and persisted_rate = 40000\n"
        "            )\n"
        "        ) is distinct from true then\n"
        "            raise exception using\n"
        "                errcode = '55000',\n"
        "                message = 'unsupported settlement adjustment economy';\n"
        "        end if;\n"
        "    else\n"
        "        raise exception using\n"
        "            errcode = '55000',\n"
        "            message = 'unsupported settlement event type';\n"
        "    end if;\n\n"
        "    return new;\n"
        "end;\n"
        "$function$;\n\n"
        "revoke all on function public.market_guard_settlement_economy()\n"
        "    from public;\n\n"
        "do $settlement_guard$\n"
        "begin\n"
        f"{settlement_table_requirement}"
        "    if to_regclass('public.market_production_settlement_events')\n"
        "            is not null then\n"
        "        execute 'drop trigger if exists "
        "market_settlement_economy_guard on "
        "public.market_production_settlement_events';\n"
        "        execute 'create trigger market_settlement_economy_guard "
        "before insert on public.market_production_settlement_events "
        "for each row execute function "
        "public.market_guard_settlement_economy()';\n"
        "    end if;\n"
        "end;\n"
        "$settlement_guard$;\n\n"
        "do $migration$\n"
        "declare\n"
        "    seed_count bigint;\n"
        "begin\n"
        "    if not exists (\n"
        "        select 1\n"
        "        from supabase_migrations.schema_migrations\n"
        f"        where version = '{migration_version}'\n"
        "    ) then\n"
        f"{settlement_lock}"
        f"{settlement_rebase_guard}"
        "        select count(*) into seed_count\n"
        "        from market_economy_replay_seed;\n"
        f"        if seed_count <> {len(events)} then\n"
        "            raise exception 'canonical economy seed count mismatch';\n"
        "        end if;\n"
        "        if (select count(*) from public.market_replay_events)\n"
        "            <> seed_count then\n"
        "            raise exception 'market replay event count mismatch';\n"
        "        end if;\n"
        "        if (\n"
        "            select count(*)\n"
        "            from public.market_replay_events as event\n"
        "            join market_economy_replay_seed as seed\n"
        "              using (game_date, player_id)\n"
        "        ) <> seed_count then\n"
        "            raise exception 'market replay event identity mismatch';\n"
        "        end if;\n"
        "        if exists (\n"
        "            select 1\n"
        "            from public.market_replay_events as event\n"
        "            join market_economy_replay_seed as seed\n"
        "              using (game_date, player_id)\n"
        "            where event.actual_net_points_micros\n"
        "                    <> seed.actual_net_points_micros\n"
        "               or event.expected_net_points_micros\n"
        "                    <> seed.expected_net_points_micros\n"
        "               or event.actual_minutes_micros\n"
        "                    <> seed.actual_minutes_micros\n"
        "               or event.projected_minutes_micros\n"
        "                    is distinct from seed.projected_minutes_micros\n"
        "               or event.qualifies_for_instruments\n"
        "                    <> seed.qualifies_for_instruments\n"
        "        ) then\n"
        "            raise exception 'canonical replay inputs changed';\n"
        "        end if;\n\n"
        "        alter table public.market_accounts\n"
        "            alter column cash_cents set default 20782400000;\n\n"
        "        update public.market_accounts\n"
        "        set cash_cents = cash_cents + 6782400000,\n"
        "            version = case\n"
        "                when version = 0 then 0\n"
        "                else version + 1\n"
        "            end,\n"
        "            updated_at = timezone('utc', now());\n\n"
        "        update public.market_portfolio_snapshots\n"
        "        set cash_cents = cash_cents + 6782400000,\n"
        "            free_cash_cents = free_cash_cents + 6782400000,\n"
        "            total_value_cents = total_value_cents + 6782400000;\n\n"
        f"{legacy_replay_dividend_cte}"
        "        update public.market_replay_events as event\n"
        f"        set dividend_cents = {replay_dividend_expression}\n"
        "        from market_economy_replay_seed as seed\n"
        f"{legacy_replay_join}"
        "        where event.game_date = seed.game_date\n"
        "          and event.player_id = seed.player_id\n"
        "          and event.dividend_cents is distinct from\n"
        f"              {replay_dividend_expression};\n\n"
        f"{migration_record}"
        "    end if;\n"
        "end;\n"
        "$migration$;\n"
    ) + transaction_end


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--json-output", type=Path)
    parser.add_argument("--api-output", type=Path, default=DEFAULT_API_OUTPUT)
    parser.add_argument("--api-sql-output", type=Path)
    parser.add_argument(
        "--api-instruments-sql-output",
        type=Path,
        help="Write incremental instrument seed SQL to a caller-chosen new migration path.",
    )
    parser.add_argument(
        "--api-economy-sql-output",
        type=Path,
        help="Write the guarded second-apron/replay-dividend economy migration.",
    )
    parser.add_argument(
        "--api-economy-migration-version",
        default="20260815000000",
        help="14-digit migration version used by --api-economy-sql-output.",
    )
    parser.add_argument(
        "--api-economy-record-migration",
        action="store_true",
        help=(
            "Record the migration version inside the SQL for direct psql deployment; "
            "leave off for Supabase CLI-managed migration files."
        ),
    )
    args = parser.parse_args(argv)

    generated = generate()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(render_typescript(generated), encoding="utf-8")
    if args.json_output is not None:
        args.json_output.parent.mkdir(parents=True, exist_ok=True)
        args.json_output.write_text(
            json.dumps(generated, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
    api_seed = render_api_seed(generated)
    if args.api_output is not None:
        args.api_output.parent.mkdir(parents=True, exist_ok=True)
        args.api_output.write_text(
            json.dumps(api_seed, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
    if args.api_sql_output is not None:
        args.api_sql_output.parent.mkdir(parents=True, exist_ok=True)
        args.api_sql_output.write_text(
            render_api_seed_sql(api_seed),
            encoding="utf-8",
        )
    if args.api_instruments_sql_output is not None:
        args.api_instruments_sql_output.parent.mkdir(parents=True, exist_ok=True)
        args.api_instruments_sql_output.write_text(
            render_api_instrument_metadata_sql(api_seed),
            encoding="utf-8",
        )
    if args.api_economy_sql_output is not None:
        args.api_economy_sql_output.parent.mkdir(parents=True, exist_ok=True)
        args.api_economy_sql_output.write_text(
            render_api_economy_rebase_sql(
                api_seed,
                migration_version=args.api_economy_migration_version,
                record_migration=args.api_economy_record_migration,
            ),
            encoding="utf-8",
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
