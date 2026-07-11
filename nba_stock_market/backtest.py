from __future__ import annotations

import argparse
import csv
import json
import math
import statistics
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from itertools import groupby
import random
from pathlib import Path
from typing import Any

from nba_stock_market.engine import (
    NET_POINTS_TO_DOLLARS,
    SHARES_OUT,
    STARTING_CASH,
    BoxScoreLine,
    Market,
    Player,
    User,
)
from nba_stock_market.expectations import (
    DunksAndThreesExpectation,
    ProductionExpectation,
    SalaryProjectionExpectation,
    TrailingMeanExpectation,
    normalize_player_name,
    salary_implied_net_points,
)


EXPECTED_SEASON = "2025-26"
EXPECTED_SEASON_START = date(2025, 10, 21)
EXPECTED_SEASON_END = date(2026, 4, 12)
EXPECTED_REGULAR_SEASON_GAMES = 1230
REQUIRED_MANIFEST_FIELDS = {
    "season",
    "competition",
    "season_start",
    "season_end",
    "game_count",
    "player_game_count",
    "espn_scoreboard_endpoint",
    "espn_summary_endpoint",
    "salary_repository",
    "salary_commit",
    "salary_file",
    "fallback_salary_url",
    "fallback_salary_file",
}


@dataclass(frozen=True)
class GameRecord:
    game_id: str
    game_date: date
    player_id: str
    player_name: str
    team: str
    box_score: BoxScoreLine


@dataclass(frozen=True)
class ListedPlayer:
    player_id: str
    name: str
    salary: float
    minutes: float
    games: int
    tier: str


@dataclass(frozen=True)
class ReplaySummary:
    game_count: int
    game_day_count: int
    calendar_day_count: int
    idle_cash_sunk: float
    evaluations: tuple["GameEvaluation", ...]
    expectation_fallback_count: int = 0


@dataclass(frozen=True)
class GameEvaluation:
    game: GameRecord
    actual_net_points: float
    expected_net_points: float
    dividend_per_share: float
    total_cash_change: float


def load_source_manifest(
    path: Path,
    games: list[GameRecord],
    *,
    require_complete_season: bool = False,
) -> dict[str, Any]:
    """Load provenance and reject caches that disagree with their manifest."""

    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read source manifest {path}: {exc}") from exc
    if not isinstance(manifest, dict):
        raise ValueError("source manifest must be a JSON object")
    missing = sorted(REQUIRED_MANIFEST_FIELDS - manifest.keys())
    if missing:
        raise ValueError(f"source manifest is missing fields: {', '.join(missing)}")

    keys = [(game.game_id, game.player_id) for game in games]
    if len(keys) != len(set(keys)):
        raise ValueError("source cache contains a duplicate player-game")
    game_count = len({game.game_id for game in games})
    if manifest["game_count"] != game_count:
        raise ValueError(
            f"source manifest claims {manifest['game_count']} games but cache has {game_count}"
        )
    if manifest["player_game_count"] != len(games):
        raise ValueError(
            "source manifest claims "
            f"{manifest['player_game_count']} player-games but cache has {len(games)}"
        )
    if not games:
        raise ValueError("source cache contains no player-games")
    first_date = min(game.game_date for game in games)
    last_date = max(game.game_date for game in games)
    if manifest["season_start"] != first_date.isoformat():
        raise ValueError("source manifest season_start disagrees with cached games")
    if manifest["season_end"] != last_date.isoformat():
        raise ValueError("source manifest season_end disagrees with cached games")

    if require_complete_season:
        expected = {
            "season": EXPECTED_SEASON,
            "season_start": EXPECTED_SEASON_START.isoformat(),
            "season_end": EXPECTED_SEASON_END.isoformat(),
            "game_count": EXPECTED_REGULAR_SEASON_GAMES,
        }
        mismatches = [
            f"{field}={manifest[field]!r} (expected {value!r})"
            for field, value in expected.items()
            if manifest[field] != value
        ]
        if mismatches:
            raise ValueError(
                "cache is not the complete 2025-26 regular season: " + "; ".join(mismatches)
            )
    return manifest


def build_synthetic_users(
    players: list[ListedPlayer],
    *,
    count: int = 100,
    seed: int = 2026,
) -> list[User]:
    if len(players) < 10:
        raise ValueError("at least ten listed players are required")
    if count <= 0:
        raise ValueError("portfolio count must be positive")
    if count > SHARES_OUT:
        raise ValueError(
            f"portfolio count cannot exceed the {SHARES_OUT}-share float"
        )
    rng = random.Random(seed)
    users: list[User] = []
    for index in range(count):
        for _ in range(10_000):
            holdings = rng.sample(players, 10)
            invested = sum(player.salary for player in holdings)
            if invested <= STARTING_CASH:
                users.append(
                    User(
                        id=f"portfolio-{index + 1:03d}",
                        cash=STARTING_CASH - invested,
                        holdings={player.player_id: 1 for player in holdings},
                    )
                )
                break
        else:
            raise ValueError("could not construct a ten-player portfolio within the bankroll")
    return users


def replay_game_records(
    market: Market,
    games: list[GameRecord],
    expectation_source: object,
) -> ReplaySummary:
    ordered = sorted(games, key=lambda game: (game.game_date, game.game_id, game.player_id))
    game_day_count = 0
    idle_cash_sunk = 0.0
    games_by_date = {
        game_date: list(games_on_date)
        for game_date, games_on_date in groupby(ordered, key=lambda game: game.game_date)
    }
    if not ordered:
        return ReplaySummary(0, 0, 0, 0.0, (), 0)
    current_date = ordered[0].game_date
    end_date = ordered[-1].game_date
    evaluations: list[GameEvaluation] = []
    calendar_day_count = 0
    expectation_fallback_count = 0
    while current_date <= end_date:
        calendar_day_count += 1
        games_on_date = games_by_date.get(current_date, [])
        if games_on_date:
            game_day_count += 1
        for game in games_on_date:
            actual = market.net_points_model.score(game.box_score)
            expected = expectation_source.expected_performance(
                market.players[game.player_id], current_date
            )
            if expected is None:
                expectation_fallback_count += 1
                expected_net_points = salary_implied_net_points(
                    market.players[game.player_id].opening_price
                    or market.players[game.player_id].current_price
                )
            elif isinstance(expected, BoxScoreLine):
                expected_net_points = market.net_points_model.score(expected)
            else:
                expected_net_points = float(expected)
            event = market.pay_daily_performance_dividend(
                game.player_id,
                actual_net_points=actual,
                expected_net_points=expected_net_points,
                game_date=current_date,
            )
            evaluations.append(
                GameEvaluation(
                    game,
                    actual,
                    expected_net_points,
                    event.dividend_per_share,
                    event.total_cash_change,
                )
            )
            expectation_source.observe(game.player_id, actual)

        cash_before = sum(user.cash for user in market.users.values())
        market.advance_day(apply_reversion=False, apply_idle_fee=True)
        cash_after = sum(user.cash for user in market.users.values())
        idle_cash_sunk += cash_before - cash_after
        current_date += timedelta(days=1)

    return ReplaySummary(
        len(ordered),
        game_day_count,
        calendar_day_count,
        idle_cash_sunk,
        tuple(evaluations),
        expectation_fallback_count,
    )


def _salary_value(raw: str | None) -> float:
    try:
        return float((raw or "").replace("$", "").replace(",", ""))
    except ValueError:
        return 0.0


def load_salary_by_name(paths: list[Path]) -> dict[str, float]:
    salaries: dict[str, float] = {}
    for path in paths:
        with path.open(encoding="utf-8", newline="") as handle:
            for row in csv.DictReader(handle):
                player_name = row.get("Player", "")
                salary = _salary_value(row.get("2025-26"))
                if player_name and player_name != "Dead Cap" and salary > 0:
                    salaries.setdefault(normalize_player_name(player_name), salary)
    return salaries


def _tier(salary: float) -> str:
    if salary >= 30_000_000:
        return "star"
    if salary >= 10_000_000:
        return "mid"
    return "bench"


def select_universe(
    games: list[GameRecord],
    salary_by_name: dict[str, float],
    *,
    size: int = 150,
) -> list[ListedPlayer]:
    minutes: defaultdict[str, float] = defaultdict(float)
    appearances: defaultdict[str, int] = defaultdict(int)
    names: dict[str, str] = {}
    for game in games:
        minutes[game.player_id] += game.box_score.minutes
        appearances[game.player_id] += 1
        names[game.player_id] = game.player_name
    ordered_ids = sorted(minutes, key=lambda player_id: (-minutes[player_id], player_id))
    selected_ids = ordered_ids[:size]
    missing = [names[player_id] for player_id in selected_ids if normalize_player_name(names[player_id]) not in salary_by_name]
    if missing:
        raise ValueError(f"missing salaries for top-minute players: {', '.join(missing)}")
    return [
        ListedPlayer(
            player_id=player_id,
            name=names[player_id],
            salary=salary_by_name[normalize_player_name(names[player_id])],
            minutes=minutes[player_id],
            games=appearances[player_id],
            tier=_tier(salary_by_name[normalize_player_name(names[player_id])]),
        )
        for player_id in selected_ids
    ]


def _percentile(values: list[float], quantile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    position = (len(ordered) - 1) * quantile
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def _round_money(value: float) -> float:
    rounded = round(value, 2)
    return 0.0 if rounded == 0 else rounded


def _player_row(player: ListedPlayer, per_share: float, holder_total: float) -> dict[str, Any]:
    return {
        "player_id": player.player_id,
        "name": player.name,
        "tier": player.tier,
        "salary": _round_money(player.salary),
        "games": player.games,
        "minutes": round(player.minutes, 1),
        "season_dividend_per_share": _round_money(per_share),
        "season_dividend_full_float": _round_money(per_share * SHARES_OUT),
        "cohort_cash_change": _round_money(holder_total),
    }


def _build_report(
    market: Market,
    universe: list[ListedPlayer],
    replay: ReplaySummary,
    *,
    seed: int,
    expectation_window: int,
    expectation_model: str,
    source_manifest: dict[str, Any],
) -> dict[str, Any]:
    listed = {player.player_id: player for player in universe}
    per_share_by_player: defaultdict[str, float] = defaultdict(float)
    holder_total_by_player: defaultdict[str, float] = defaultdict(float)
    for evaluation in replay.evaluations:
        per_share_by_player[evaluation.game.player_id] += evaluation.dividend_per_share
        holder_total_by_player[evaluation.game.player_id] += evaluation.total_cash_change

    player_rows = [
        _player_row(
            player,
            per_share_by_player[player.player_id],
            holder_total_by_player[player.player_id],
        )
        for player in universe
    ]
    ranked = sorted(
        player_rows,
        key=lambda row: (-row["season_dividend_per_share"], row["player_id"]),
    )

    gross_positive = sum(
        max(0.0, evaluation.total_cash_change) for evaluation in replay.evaluations
    )
    gross_negative = -sum(
        min(0.0, evaluation.total_cash_change) for evaluation in replay.evaluations
    )
    net_dividends = gross_positive - gross_negative
    initial_wealth = len(market.users) * STARTING_CASH
    final_wealth = sum(market.portfolio_value(user_id) for user_id in market.users)
    net_inflation = net_dividends - replay.idle_cash_sunk

    tier_metrics: dict[str, Any] = {}
    for tier in ("star", "mid", "bench"):
        tier_ids = {player.player_id for player in universe if player.tier == tier}
        tier_games = [item for item in replay.evaluations if item.game.player_id in tier_ids]
        positive_full_float = [
            item.dividend_per_share * SHARES_OUT
            for item in tier_games
            if item.dividend_per_share > 0
        ]
        season_values = [per_share_by_player[player_id] for player_id in tier_ids]
        tier_metrics[tier] = {
            "players": len(tier_ids),
            "player_games": len(tier_games),
            "median_absolute_game_per_share": _round_money(
                statistics.median(abs(item.dividend_per_share) for item in tier_games)
            ),
            "median_positive_game_full_float": _round_money(
                statistics.median(positive_full_float)
            ),
            "median_season_per_share": _round_money(statistics.median(season_values)),
            "median_season_full_float": _round_money(
                statistics.median(season_values) * SHARES_OUT
            ),
        }

    star_positive_surprises = [
        item.actual_net_points - item.expected_net_points
        for item in replay.evaluations
        if listed[item.game.player_id].tier == "star"
        and item.actual_net_points > item.expected_net_points
    ]
    great_game_surprise = _percentile(star_positive_surprises, 0.90)
    great_game_payout = great_game_surprise * NET_POINTS_TO_DOLLARS
    calibration_distance = max(
        great_game_payout / 800_000,
        800_000 / great_game_payout,
    )
    candidate_constant = 800_000 / great_game_surprise
    calibration = {
        "definition": "90th-percentile positive star surprise; payout is across all 100 shares",
        "target_full_float_payout": 800_000.0,
        "great_game_surprise_net_points": round(great_game_surprise, 4),
        "current_net_points_to_dollars": NET_POINTS_TO_DOLLARS,
        "current_great_game_full_float_payout": _round_money(great_game_payout),
        "candidate_net_points_to_dollars": _round_money(candidate_constant),
        "distance_from_target_multiple": round(calibration_distance, 4),
        "decision": (
            "retain current constant; empirical payout is within 2x of target"
            if calibration_distance <= 2
            else "calibration required; current constant is more than 2x from target"
        ),
        "applied_net_points_to_dollars": NET_POINTS_TO_DOLLARS,
        "tiers": tier_metrics,
    }

    portfolio_rows = []
    for user in market.users.values():
        final_value = market.portfolio_value(user.id)
        portfolio_rows.append(
            {
                "portfolio_id": user.id,
                "holdings": [listed[player_id].name for player_id in sorted(user.holdings)],
                "final_value": _round_money(final_value),
                "profit_loss": _round_money(final_value - STARTING_CASH),
                "return_pct": round(100 * (final_value / STARTING_CASH - 1), 4),
            }
        )
    portfolio_rows.sort(key=lambda row: (row["final_value"], row["portfolio_id"]))
    median_value = statistics.median(row["final_value"] for row in portfolio_rows)
    median_row = min(portfolio_rows, key=lambda row: abs(row["final_value"] - median_value))

    preferred_examples = (
        "Shai Gilgeous-Alexander",
        "Nikola Jokic",
        "Luka Doncic",
    )
    examples = []
    for name in preferred_examples:
        candidates = [item for item in replay.evaluations if item.game.player_name == name]
        if not candidates:
            raise ValueError(f"missing named example player: {name}")
        item = max(candidates, key=lambda value: (value.dividend_per_share, value.game.game_date))
        examples.append(
            {
                "player": name,
                "game_id": item.game.game_id,
                "game_date": item.game.game_date.isoformat(),
                "team": item.game.team,
                "box_score": {
                    field: getattr(item.game.box_score, field)
                    for field in BoxScoreLine.__dataclass_fields__
                },
                "expected_net_points": round(item.expected_net_points, 4),
                "actual_net_points": round(item.actual_net_points, 4),
                "surprise_net_points": round(
                    item.actual_net_points - item.expected_net_points, 4
                ),
                "payout_per_share": _round_money(item.dividend_per_share),
                "payout_full_float": _round_money(item.dividend_per_share * SHARES_OUT),
            }
        )

    return {
        "data_sources": {
            "actuals": {
                "provider": "ESPN",
                "competition": source_manifest["competition"],
                "scoreboard_endpoint": source_manifest["espn_scoreboard_endpoint"],
                "summary_endpoint": source_manifest["espn_summary_endpoint"],
            },
            "salaries": {
                "primary_repository": source_manifest["salary_repository"],
                "primary_commit": source_manifest["salary_commit"],
                "primary_file": source_manifest["salary_file"],
                "fallback_url": source_manifest["fallback_salary_url"],
                "fallback_file": source_manifest["fallback_salary_file"],
            },
        },
        "metadata": {
            "season": source_manifest["season"],
            "competition": source_manifest["competition"],
            "source_game_count": source_manifest["game_count"],
            "source_player_game_count": source_manifest["player_game_count"],
            "universe_players": len(universe),
            "universe_player_games": replay.game_count,
            "game_days": replay.game_day_count,
            "calendar_days": replay.calendar_day_count,
            "portfolio_count": len(market.users),
            "portfolio_size": 10,
            "seed": seed,
            "expectation_window": expectation_window,
            **(
                {"expectation_fallback_count": replay.expectation_fallback_count}
                if expectation_model == "dnt"
                else {}
            ),
            "expectation": (
                (
                    f"mean of the player's prior {expectation_window} played games; "
                    "salary-implied prior only before game 1"
                )
                if expectation_model == "trailing"
                else (
                    "Dunks & Threes pre-game box-score projection; salary-implied "
                    "fallback for missing player-games"
                    if expectation_model == "dnt"
                    else (
                        "zero expected net points; dividends reward raw game-log value"
                        if expectation_model == "production"
                        else "constant season projection from the salary-implied formula"
                    )
                )
            ),
            "salary_prior_formula": "min(25, 5 + 0.3 * salary_in_millions)",
            "trading_simulation": False,
            "inactivity_decay": False,
            "fair_value_reversion": False,
        },
        "money_supply": {
            "initial_portfolio_wealth": _round_money(initial_wealth),
            "gross_positive_dividends": _round_money(gross_positive),
            "gross_negative_dividend_debits": _round_money(gross_negative),
            "net_dividends": _round_money(net_dividends),
            "trade_fees": 0.0,
            "idle_cash_sunk": _round_money(replay.idle_cash_sunk),
            "net_inflation": _round_money(net_inflation),
            "final_portfolio_wealth": _round_money(final_wealth),
            "reconciliation_difference": _round_money(
                final_wealth - initial_wealth - net_inflation
            ),
            "net_inflation_pct": round(100 * net_inflation / initial_wealth, 6),
        },
        "calibration": calibration,
        "distribution": {"top_10": ranked[:10], "bottom_10": list(reversed(ranked[-10:]))},
        "portfolio_spread": {
            "best": portfolio_rows[-1],
            "median_final_value": _round_money(median_value),
            "median_example": median_row,
            "worst": portfolio_rows[0],
        },
        "examples": examples,
    }


def _money(value: float) -> str:
    sign = "-" if value < 0 else ""
    return f"{sign}${abs(value):,.0f}"


def _render_markdown(report: dict[str, Any]) -> str:
    metadata = report["metadata"]
    sources = report["data_sources"]
    money = report["money_supply"]
    calibration = report["calibration"]
    portfolio = report["portfolio_spread"]
    lines = [
        "# NBA Stock Market 2025-26 Backtest",
        "",
        "This deterministic replay covers the 1,230-game 2025-26 NBA regular season. "
        "The universe is the top 150 players by final regular-season minutes. One hundred "
        "synthetic users each begin at $140M and hold one share of 10 unique players. "
        "Trading and inactivity decay are off; prices stay at salary-derived listings, so "
        "the measured economy is dividends minus the daily idle-cash sink.",
        "",
        "## Method",
        "",
        f"- Actuals: {metadata['source_player_game_count']:,} played player-games from {sources['actuals']['provider']} game summaries ({metadata['source_game_count']:,} games).",
        f"- Salaries: `{sources['salaries']['primary_repository']}` `{sources['salaries']['primary_file']}` at commit `{sources['salaries']['primary_commit'][:7]}`; missing names filled from the pinned fallback snapshot.",
        f"- Expectation: {metadata['expectation']}. A 10-game window balances recent role/form against single-game noise; before game 1 the prior is `{metadata['salary_prior_formula']}`.",
        f"- Replay: {metadata['universe_player_games']:,} universe player-games on {metadata['game_days']} game days, with {metadata['calendar_days']} calendar-day idle-fee passes.",
        "- Payout conventions: per-share amounts are what one holder receives; full-float amounts are the same result across all 100 shares.",
        "",
        "## A. Money supply",
        "",
        "| Measure | Amount |",
        "|---|---:|",
        f"| Starting cohort wealth | {_money(money['initial_portfolio_wealth'])} |",
        f"| Gross positive dividends (faucet) | {_money(money['gross_positive_dividends'])} |",
        f"| Negative dividend debits | {_money(money['gross_negative_dividend_debits'])} |",
        f"| Net signed dividends | {_money(money['net_dividends'])} |",
        f"| Trading fees (trading off) | {_money(money['trade_fees'])} |",
        f"| Idle cash sunk | {_money(money['idle_cash_sunk'])} |",
        f"| **Net inflation** | **{_money(money['net_inflation'])} ({money['net_inflation_pct']:.4f}%)** |",
        f"| Ending cohort wealth | {_money(money['final_portfolio_wealth'])} |",
        "",
        "Russell's answer: signed surprise dividends are close to self-cancelling at the player level, while portfolio ownership and the idle fee determine cohort inflation. The reconciliation difference is "
        f"{_money(money['reconciliation_difference'])} (rounding only).",
        "",
        "## B. Calibration",
        "",
        f"A great game is defined before inspection as the 90th-percentile positive surprise by a star: **+{calibration['great_game_surprise_net_points']:.2f} net points**. At the current `${calibration['current_net_points_to_dollars']:,.0f}` constant that pays **{_money(calibration['current_great_game_full_float_payout'])} across the float**, versus the $800K target. The candidate exact-fit constant is `${calibration['candidate_net_points_to_dollars']:,.0f}`. Decision: **{calibration['decision']}**.",
        "",
        "| Tier | Players | Games | Typical absolute game / share | Typical positive game / full float | Median signed season / share | Median signed season / full float |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for tier in ("star", "mid", "bench"):
        row = calibration["tiers"][tier]
        lines.append(
            f"| {tier.title()} | {row['players']} | {row['player_games']:,} | "
            f"{_money(row['median_absolute_game_per_share'])} | "
            f"{_money(row['median_positive_game_full_float'])} | "
            f"{_money(row['median_season_per_share'])} | "
            f"{_money(row['median_season_full_float'])} |"
        )

    lines.extend(["", "## C. Player distribution", "", "### Top 10", "", "| Player | Tier | Salary | Games | Season / share | Full float | Cohort cash |", "|---|---|---:|---:|---:|---:|---:|"])
    for row in report["distribution"]["top_10"]:
        lines.append(
            f"| {row['name']} | {row['tier']} | {_money(row['salary'])} | {row['games']} | "
            f"{_money(row['season_dividend_per_share'])} | {_money(row['season_dividend_full_float'])} | {_money(row['cohort_cash_change'])} |"
        )
    lines.extend(["", "### Bottom 10", "", "| Player | Tier | Salary | Games | Season / share | Full float | Cohort cash |", "|---|---|---:|---:|---:|---:|---:|"])
    for row in report["distribution"]["bottom_10"]:
        lines.append(
            f"| {row['name']} | {row['tier']} | {_money(row['salary'])} | {row['games']} | "
            f"{_money(row['season_dividend_per_share'])} | {_money(row['season_dividend_full_float'])} | {_money(row['cohort_cash_change'])} |"
        )
    lines.extend(
        [
            "",
            "The ranking is signed surprise versus each player's own trailing baseline, not raw scoring. Rising/outperforming players lead; slow starts, declining roles, and poor games following hot runs debit holders. Injuries themselves create no game event, but reduced post-return performance can cost holders.",
            "",
            "## D. Portfolio spread",
            "",
            "| Portfolio | Final value | P/L vs $140M | Return |",
            "|---|---:|---:|---:|",
            f"| Best ({portfolio['best']['portfolio_id']}) | {_money(portfolio['best']['final_value'])} | {_money(portfolio['best']['profit_loss'])} | {portfolio['best']['return_pct']:.4f}% |",
            f"| Median | {_money(portfolio['median_final_value'])} | {_money(portfolio['median_final_value'] - STARTING_CASH)} | {100 * (portfolio['median_final_value'] / STARTING_CASH - 1):.4f}% |",
            f"| Worst ({portfolio['worst']['portfolio_id']}) | {_money(portfolio['worst']['final_value'])} | {_money(portfolio['worst']['profit_loss'])} | {portfolio['worst']['return_pct']:.4f}% |",
            "",
            "## E. Shareable player-games",
            "",
        ]
    )
    for example in report["examples"]:
        box = example["box_score"]
        lines.extend(
            [
                f"### {example['player']} — {example['game_date']}",
                "",
                f"{box['pts']:.0f} PTS, {box['fgm']:.0f}-{box['fga']:.0f} FG, {box['three_pm']:.0f}-{box['three_pa']:.0f} 3PT, {box['ftm']:.0f}-{box['fta']:.0f} FT, {box['offensive_rebounds'] + box['defensive_rebounds']:.0f} REB, {box['ast']:.0f} AST, {box['stl']:.0f} STL, {box['blk']:.0f} BLK, {box['tov']:.0f} TO in {box['minutes']:.0f} MIN. Expected **{example['expected_net_points']:.2f} NP**, actual **{example['actual_net_points']:.2f} NP** (surprise **+{example['surprise_net_points']:.2f}**): **{_money(example['payout_per_share'])} per share / {_money(example['payout_full_float'])} full float**. ESPN game `{example['game_id']}`.",
                "",
            ]
        )
    lines.extend(
        [
            "## Reproduction and caveats",
            "",
            "The data downloader caches raw provider JSON and normalized CSV under ignored `data/raw/`; the backtest itself performs no network calls. Universe selection uses final-season minutes (appropriate for economy evaluation, not a preseason trading strategy). Salary is a season-level listing anchor, prices are fixed, portfolios hold one share per name, and negative dividends may reduce cash. Dunks & Threes is intentionally not called.",
            "",
        ]
    )
    return "\n".join(lines)


def run_backtest(
    data_dir: Path,
    output_dir: Path,
    *,
    seed: int = 2026,
    portfolio_count: int = 100,
    expectation_window: int = 10,
    expectation_model: str = "trailing",
) -> dict[str, Any]:
    from nba_stock_market.historical_data import load_game_records

    games = load_game_records(data_dir / "player_game_logs.csv")
    source_manifest = load_source_manifest(
        data_dir / "manifest.json",
        games,
        require_complete_season=True,
    )
    salary_by_name = load_salary_by_name(
        [data_dir / "salaries.csv", data_dir / "salaries-fallback.csv"]
    )
    universe = select_universe(games, salary_by_name, size=150)
    users = build_synthetic_users(universe, count=portfolio_count, seed=seed)
    if expectation_model == "trailing":
        expectation = TrailingMeanExpectation(window=expectation_window)
    elif expectation_model == "projection":
        expectation = SalaryProjectionExpectation()
    elif expectation_model == "dnt":
        expectation = DunksAndThreesExpectation(cache_dir=data_dir.parent / "dnt")
    elif expectation_model == "production":
        expectation = ProductionExpectation()
    else:
        raise ValueError(
            "expectation_model must be 'trailing', 'projection', 'dnt', or 'production'"
        )
    market = Market(
        [
            Player(
                player.player_id,
                player.name,
                player.tier,
                player.salary,
                player.salary,
            )
            for player in universe
        ],
        users,
        expectation_source=expectation,
        reversion_rate=0.0,
        inactivity_decay_rate=0.0,
        impact_k=0.0,
        net_points_to_dollars=NET_POINTS_TO_DOLLARS,
    )
    universe_ids = {player.player_id for player in universe}
    replay = replay_game_records(
        market,
        [game for game in games if game.player_id in universe_ids],
        expectation,
    )
    report = _build_report(
        market,
        universe,
        replay,
        seed=seed,
        expectation_window=expectation_window,
        expectation_model=expectation_model,
        source_manifest=source_manifest,
    )
    if (
        expectation_model == "trailing"
        and report["calibration"]["distance_from_target_multiple"] > 2
    ):
        raise RuntimeError(
            "NET_POINTS_TO_DOLLARS is more than 2x from the $800K target; update the engine constant and rerun"
        )
    output_dir.mkdir(parents=True, exist_ok=True)
    output_stem = (
        f"backtest-2026-{expectation_model}"
        if expectation_model in {"dnt", "production"}
        else "backtest-2026"
    )
    (output_dir / f"{output_stem}.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    (output_dir / f"{output_stem}.md").write_text(
        _render_markdown(report),
        encoding="utf-8",
    )
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Replay the 2025-26 NBA season through Engine v2")
    parser.add_argument("--data-dir", type=Path, default=Path("data/raw/2025-26"))
    parser.add_argument("--output-dir", type=Path, default=Path("output"))
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--portfolios", type=int, default=100)
    parser.add_argument(
        "--expectation",
        choices=("trailing", "projection", "dnt", "production"),
        default="trailing",
    )
    args = parser.parse_args()
    report = run_backtest(
        args.data_dir,
        args.output_dir,
        seed=args.seed,
        portfolio_count=args.portfolios,
        expectation_model=args.expectation,
    )
    money = report["money_supply"]
    print(
        f"Wrote backtest-2026.md/json: net inflation {_money(money['net_inflation'])}; "
        f"ending wealth {_money(money['final_portfolio_wealth'])}"
    )


if __name__ == "__main__":
    main()
