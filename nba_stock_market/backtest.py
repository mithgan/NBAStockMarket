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
    MAX_SHARES_PER_USER_PER_PLAYER,
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
    player_salary_implied_net_points,
)


EXPECTED_SEASON = "2025-26"
EXPECTED_SEASON_START = date(2025, 10, 21)
EXPECTED_SEASON_END = date(2026, 4, 12)
EXPECTED_REGULAR_SEASON_GAMES = 1230
DEFAULT_OPENING_PRICES_PATH = (
    Path(__file__).resolve().parents[1] / "output/opening-prices-2026-27.csv"
)
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
    used_salary_fallback: bool = False
    actual_salary: float | None = None


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
                user = User(
                    id=f"portfolio-{index + 1:03d}",
                    cash=STARTING_CASH - invested,
                    holdings={player.player_id: 1 for player in holdings},
                )
                assert all(
                    shares <= MAX_SHARES_PER_USER_PER_PLAYER
                    for shares in user.holdings.values()
                )
                users.append(user)
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
    processed_settlements: set[tuple[str, str]] = set()
    while current_date <= end_date:
        calendar_day_count += 1
        games_on_date = games_by_date.get(current_date, [])
        if games_on_date:
            game_day_count += 1
        for game in games_on_date:
            settlement = (game.player_id, game.game_id)
            if settlement in processed_settlements:
                continue
            actual = market.net_points_model.score(game.box_score)
            expected = expectation_source.expected_performance(
                market.players[game.player_id], current_date
            )
            if expected is None:
                expectation_fallback_count += 1
                expected_net_points = player_salary_implied_net_points(
                    market.players[game.player_id]
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
                settlement_key=game.game_id,
            )
            processed_settlements.add(settlement)
            evaluations.append(
                GameEvaluation(
                    game,
                    actual,
                    event.expected_net_points,
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
        len(evaluations),
        game_day_count,
        calendar_day_count,
        idle_cash_sunk,
        tuple(evaluations),
        expectation_fallback_count,
    )


def compute_league_mean_surprise(
    market: Market,
    games: list[GameRecord],
    expectation_source: object,
) -> float:
    """Return mean actual-minus-expected NP over a deterministic replay universe."""

    surprises: list[float] = []
    for game in sorted(games, key=lambda item: (item.game_date, item.game_id, item.player_id)):
        actual = market.net_points_model.score(game.box_score)
        expected = expectation_source.expected_performance(
            market.players[game.player_id], game.game_date
        )
        if expected is None:
            expected_net_points = player_salary_implied_net_points(
                market.players[game.player_id]
            )
        elif isinstance(expected, BoxScoreLine):
            expected_net_points = market.net_points_model.score(expected)
        else:
            expected_net_points = float(expected)
        surprise = actual - expected_net_points
        if not math.isfinite(surprise):
            raise ValueError("league surprise must be finite")
        surprises.append(surprise)
        expectation_source.observe(game.player_id, actual)
    if not surprises:
        raise ValueError("cannot compute expectation bias from an empty replay")
    return statistics.fmean(surprises)


def inflation_option_row(
    option: str,
    dollars_per_net_point_per_holder: float,
    expectation_bias: float,
    report: dict[str, Any],
) -> dict[str, Any]:
    """Extract the decision metrics for one inflation-calibration option."""

    examples = {
        (item["player"], item["game_date"]): item for item in report["examples"]
    }
    return {
        "option": option,
        "dollars_per_net_point_per_holder": dollars_per_net_point_per_holder,
        "expectation_bias": expectation_bias,
        "net_inflation": report["money_supply"]["net_inflation"],
        "net_inflation_pct": report["money_supply"]["net_inflation_pct"],
        "sga_payout": examples[("Shai Gilgeous-Alexander", "2025-10-23")]["payout_per_share"],
        "jokic_payout": examples[("Nikola Jokic", "2025-12-25")]["payout_per_share"],
        "star_game_p90_payout": report["calibration"]["current_great_game_per_holder_payout"],
        "median_portfolio_final_value": report["portfolio_spread"]["median_final_value"],
    }


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


def load_opening_prices_by_name(path: Path) -> dict[str, tuple[float, str]]:
    """Load Mith's listings using the same normalized-name keys as salaries."""

    listings: dict[str, tuple[float, str]] = {}
    with path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            player_name = (row.get("player") or "").strip()
            opening_price = _salary_value(row.get("opening_price"))
            tier = (row.get("tier") or "").strip().lower()
            if player_name and opening_price > 0:
                listings.setdefault(
                    normalize_player_name(player_name),
                    (opening_price, tier if tier in {"star", "mid", "bench"} else _tier(opening_price)),
                )
    if not listings:
        raise ValueError(f"no usable opening prices in {path}")
    return listings


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
    opening_prices_by_name: dict[str, tuple[float, str]] | None = None,
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
    players = []
    for player_id in selected_ids:
        normalized_name = normalize_player_name(names[player_id])
        salary = salary_by_name[normalized_name]
        opening = (
            opening_prices_by_name.get(normalized_name)
            if opening_prices_by_name is not None
            else None
        )
        listing_price, tier = opening if opening is not None else (salary, _tier(salary))
        players.append(
            ListedPlayer(
                player_id=player_id,
                name=names[player_id],
                salary=listing_price,
                minutes=minutes[player_id],
                games=appearances[player_id],
                tier=tier,
                used_salary_fallback=opening_prices_by_name is not None and opening is None,
                actual_salary=salary,
            )
        )
    return players


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
        "listing_price": _round_money(player.salary),
        "actual_salary": (
            _round_money(player.actual_salary)
            if player.actual_salary is not None
            else None
        ),
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
    expectation_bias_mode: str,
    source_manifest: dict[str, Any],
    listing_basis: str,
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
    great_game_payout = great_game_surprise * market.net_points_to_dollars / SHARES_OUT
    calibration = {
        "status": "DECIDED 2026-07-14 (Mith, Discord 7/14)",
        "definition": "one holder receives $40,000 per net-point surprise",
        "target_surprise_net_points": 20.0,
        "target_per_holder_payout": 800_000.0,
        "great_game_surprise_net_points": round(great_game_surprise, 4),
        "current_net_points_to_dollars": market.net_points_to_dollars,
        "dividend_per_net_point_per_share": market.net_points_to_dollars / SHARES_OUT,
        "current_great_game_per_holder_payout": _round_money(great_game_payout),
        "decision": (
            "Option B: keep $40K per net point per holder and apply the "
            "league-mean expectation-bias correction"
        ),
        "applied_net_points_to_dollars": market.net_points_to_dollars,
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
            "max_shares_per_user_per_player": MAX_SHARES_PER_USER_PER_PLAYER,
            "expectation_model": expectation_model,
            "expectation_bias_mode": expectation_bias_mode,
            "seed": seed,
            "expectation_window": expectation_window,
            **(
                {"expectation_bias_net_points": market.expectation_bias}
                if market.expectation_bias != 0.0
                else {}
            ),
            "listing_basis": listing_basis,
            "listing_salary_fallback_count": sum(
                player.used_salary_fallback for player in universe
            ),
            "listing_salary_fallback_players": [
                player.name for player in universe if player.used_salary_fallback
            ],
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
    bias = metadata.get("expectation_bias_net_points", 0.0)
    bias_statement = (
        f" Expectations include the automatically computed +{bias:.17g} NP/player-game "
        "league-mean surprise correction."
        if metadata.get("expectation_bias_mode") == "auto"
        else ""
    )
    modeled_listings = metadata["listing_basis"].startswith("Mith ")
    if modeled_listings:
        share_design = "one opening-price-model share is the whole player"
        listing_statement = "Listings use Mith's impact + salary blend."
        fixed_price_basis = "opening-price-model listings"
        listing_method = (
            "Mith's committed impact + salary blend; "
            f"{metadata['listing_salary_fallback_count']} of {metadata['universe_players']} "
            "players fall back to salary "
            f"({', '.join(metadata['listing_salary_fallback_players']) or 'none'})."
        )
        listing_caveat = (
            "Mith's impact + salary blend is the season-level listing price "
            "(salary is used only for reported fallbacks)"
        )
    else:
        share_design = "one salary-priced share is the whole player"
        listing_statement = "Listings use a salary-only basis."
        fixed_price_basis = "salary-only listings"
        listing_method = "salary-only listing prices; no opening-price model is applied."
        listing_caveat = "Contract salary is the season-level listing price"
    lines = [
        "# NBA Stock Market 2025-26 Backtest",
        "",
        f"**DECIDED DESIGN (Russ, Discord 7/12): {share_design}; "
        "each user may hold at most one share per player; dividends settle actual game logs "
        "against cached Dunks & Threes pregame projections. The decided economy keeps $40,000 "
        f"per net point per holder and applies the league-mean expectation-bias correction. "
        f"{listing_statement}**",
        "",
        "This deterministic replay covers the 1,230-game 2025-26 NBA regular season. "
        "The universe is the top 150 players by final regular-season minutes. One hundred "
        "synthetic users each begin at $140M and hold one share of 10 unique players. "
        f"Trading and inactivity decay are off; prices stay at {fixed_price_basis}, so "
        "the measured economy is dividends minus the daily idle-cash sink.",
        "",
        "## Method",
        "",
        f"- Actuals: {metadata['source_player_game_count']:,} played player-games from {sources['actuals']['provider']} game summaries ({metadata['source_game_count']:,} games).",
        f"- Salaries: `{sources['salaries']['primary_repository']}` `{sources['salaries']['primary_file']}` at commit `{sources['salaries']['primary_commit'][:7]}`; missing names filled from the pinned fallback snapshot.",
        f"- Listings: {listing_method}",
        f"- Expectation: {metadata['expectation']}.{bias_statement}",
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
        "The league-mean correction removes systematic projection inflation by design; the "
        "remaining cohort deflation reflects non-uniform ownership and the intended idle-cash "
        "sink. The reconciliation difference is "
        f"{_money(money['reconciliation_difference'])} (rounding only).",
        "",
        "## B. Calibration",
        "",
        f"**{calibration['status']}.** The decided rate is **{_money(calibration['dividend_per_net_point_per_share'])} per net point per holder**, so a +20 surprise pays **{_money(calibration['target_per_holder_payout'])}**. The observed 90th-percentile positive star surprise is +{calibration['great_game_surprise_net_points']:.2f} NP, paying {_money(calibration['current_great_game_per_holder_payout'])} to one holder.",
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

    lines.extend(["", "## C. Player distribution", "", "### Top 10", "", "| Player | Tier | Listing | Actual salary | Games | Season / share | Full float | Cohort cash |", "|---|---|---:|---:|---:|---:|---:|---:|"])
    for row in report["distribution"]["top_10"]:
        lines.append(
            f"| {row['name']} | {row['tier']} | {_money(row['listing_price'])} | "
            f"{_money(row['actual_salary'])} | {row['games']} | "
            f"{_money(row['season_dividend_per_share'])} | {_money(row['season_dividend_full_float'])} | {_money(row['cohort_cash_change'])} |"
        )
    lines.extend(["", "### Bottom 10", "", "| Player | Tier | Listing | Actual salary | Games | Season / share | Full float | Cohort cash |", "|---|---|---:|---:|---:|---:|---:|---:|"])
    for row in report["distribution"]["bottom_10"]:
        lines.append(
            f"| {row['name']} | {row['tier']} | {_money(row['listing_price'])} | "
            f"{_money(row['actual_salary'])} | {row['games']} | "
            f"{_money(row['season_dividend_per_share'])} | {_money(row['season_dividend_full_float'])} | {_money(row['cohort_cash_change'])} |"
        )
    lines.extend(
        [
            "",
            "The ranking is signed surprise versus Dunks & Threes pregame projections, not raw scoring. Players who outperform those projections lead; underperformance debits holders. Injuries themselves create no game event.",
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
            f"All ESPN actuals and Dunks & Threes projections are cached; the backtest performs no network calls. Universe selection uses final-season minutes (appropriate for economy evaluation, not a preseason trading strategy). {listing_caveat}, prices are fixed, portfolios respect the one-share-per-user-per-player cap, and negative dividends may reduce cash.",
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
    expectation_model: str = "dnt",
    opening_prices_path: Path | None = DEFAULT_OPENING_PRICES_PATH,
    expectation_bias: float | str = "auto",
    net_points_to_dollars: float = NET_POINTS_TO_DOLLARS,
    write_outputs: bool = True,
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
    opening_prices = (
        load_opening_prices_by_name(opening_prices_path)
        if opening_prices_path is not None
        else None
    )
    universe = select_universe(
        games,
        salary_by_name,
        opening_prices_by_name=opening_prices,
        size=150,
    )
    def make_expectation() -> object:
        if expectation_model == "trailing":
            return TrailingMeanExpectation(window=expectation_window)
        if expectation_model == "projection":
            return SalaryProjectionExpectation()
        if expectation_model == "dnt":
            return DunksAndThreesExpectation(cache_dir=data_dir.parent / "dnt")
        if expectation_model == "production":
            return ProductionExpectation()
        raise ValueError(
            "expectation_model must be 'trailing', 'projection', 'dnt', or 'production'"
        )

    users = build_synthetic_users(universe, count=portfolio_count, seed=seed)
    universe_ids = {player.player_id for player in universe}
    universe_games = [game for game in games if game.player_id in universe_ids]
    market_players = [
        Player(
            player.player_id,
            player.name,
            player.tier,
            player.salary,
            player.salary,
            actual_salary=player.actual_salary,
        )
        for player in universe
    ]
    if expectation_bias == "auto":
        if expectation_model != "dnt":
            raise ValueError("automatic expectation bias requires the dnt expectation model")
        calibration_market = Market(market_players, inactivity_decay_rate=0.0)
        applied_expectation_bias = compute_league_mean_surprise(
            calibration_market, universe_games, make_expectation()
        )
        market_players = [
            Player(
                player.player_id,
                player.name,
                player.tier,
                player.salary,
                player.salary,
                actual_salary=player.actual_salary,
            )
            for player in universe
        ]
    else:
        applied_expectation_bias = float(expectation_bias)
        if not math.isfinite(applied_expectation_bias):
            raise ValueError("expectation_bias must be finite")
    expectation = make_expectation()
    market = Market(
        market_players,
        users,
        expectation_source=expectation,
        reversion_rate=0.0,
        inactivity_decay_rate=0.0,
        impact_k=0.0,
        net_points_to_dollars=net_points_to_dollars,
        expectation_bias=applied_expectation_bias,
    )
    replay = replay_game_records(
        market,
        universe_games,
        expectation,
    )
    report = _build_report(
        market,
        universe,
        replay,
        seed=seed,
        expectation_window=expectation_window,
        expectation_model=expectation_model,
        expectation_bias_mode="auto" if expectation_bias == "auto" else "override",
        source_manifest=source_manifest,
        listing_basis=(
            "Mith opening-price model (impact + salary blend)"
            if opening_prices is not None
            else "salary-only listings"
        ),
    )
    if not write_outputs:
        return report
    output_dir.mkdir(parents=True, exist_ok=True)
    output_stem = (
        "backtest-2026"
        if expectation_model == "dnt"
        else f"backtest-2026-{expectation_model}"
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
        default="dnt",
    )
    parser.add_argument(
        "--expectation-bias",
        default="auto",
        help=(
            "net points added to every expectation; defaults to 'auto' for the D&T league "
            "mean surprise (pass 0 to opt out)"
        ),
    )
    args = parser.parse_args()
    report = run_backtest(
        args.data_dir,
        args.output_dir,
        seed=args.seed,
        portfolio_count=args.portfolios,
        expectation_model=args.expectation,
        expectation_bias=(
            "auto" if args.expectation_bias == "auto" else float(args.expectation_bias)
        ),
    )
    money = report["money_supply"]
    print(
        f"Wrote backtest-2026.md/json: net inflation {_money(money['net_inflation'])}; "
        f"ending wealth {_money(money['final_portfolio_wealth'])}"
    )


if __name__ == "__main__":
    main()
