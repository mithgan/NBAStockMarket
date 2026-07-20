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
    NET_POINTS_TO_DOLLARS,
    SHARES_OUT,
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
MIN_GAME_COUNT = 15
CALIBRATION_UNIVERSE_SIZE = 150
PER_HOLDER_DOLLARS_PER_NP = NET_POINTS_TO_DOLLARS / SHARES_OUT
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
    if PER_HOLDER_DOLLARS_PER_NP != 40_000:
        raise ValueError(
            "engine dividend constants no longer implement the required $40K/NP holder rule"
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

    trends: dict[str, list[dict[str, float | str]]] = {
        player.id: [] for player in players
    }
    raw_surprises: list[tuple[date, float]] = []
    bias_corrections: dict[str, float] = {}
    projection_count = 0
    for game_date in sorted(calibration_events_by_date):
        correction = rolling_bias_for_date(
            raw_surprises,
            game_date,
            seed_bias=APP_COLD_START_BIAS_NET_POINTS,
        )
        bias_corrections[game_date.isoformat()] = _rounded(correction, 8)
        daily_surprises: list[tuple[date, float]] = []
        raw_expected_by_game: dict[tuple[str, str], float] = {}
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
            daily_surprises.append((game_date, actual_np - raw_expected_np))
            projection_count += 1

        for player, game in sorted(
            events_by_date.get(game_date, []),
            key=lambda item: (item[0].id, item[1].game_id),
        ):
            actual_np = net_points.score(game.box_score)
            raw_expected_np = raw_expected_by_game.get((player.id, game.game_id))
            if raw_expected_np is None:
                projected = expectations.expected_performance(player, game_date)
                raw_expected_np = (
                    player_salary_implied_net_points(player)
                    if projected is None
                    else net_points.score(projected)
                    if isinstance(projected, BoxScoreLine)
                    else float(projected)
                )
            expected_np = raw_expected_np + correction
            trends[player.id].append(
                {
                    "date": game_date.isoformat(),
                    "np": _rounded(actual_np, 5),
                    "expected_np": _rounded(expected_np, 5),
                    "dividend_per_holder": _rounded(
                        (actual_np - expected_np) * PER_HOLDER_DOLLARS_PER_NP,
                        2,
                    ),
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
        "spot_checks": {"3112335": {"2025-12-25": christmas}},
        "metadata": {
            "cold_start_bias_net_points": APP_COLD_START_BIAS_NET_POINTS,
            "rolling_window_days": ROLLING_WINDOW_DAYS,
            "rolling_minimum_games": ROLLING_MIN_GAMES,
            "calibration_universe_size": len(calibration_universe),
            "calibration_projection_count": projection_count,
            "bias_corrections": bias_corrections,
        },
    }


def render_typescript(generated: dict[str, Any]) -> str:
    trends = json.dumps(generated["player_trends"], indent=2, ensure_ascii=False)
    spot_checks = json.dumps(generated["spot_checks"], indent=2, ensure_ascii=False)
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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--json-output", type=Path)
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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
