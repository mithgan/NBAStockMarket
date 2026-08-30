"""Deterministic historical evaluator for the per-game roster economy.

The evaluator is deliberately local-only. It consumes cached ESPN player-game rows
and saved Dunks & Threes pregame projections, drives :mod:`nba_stock_market.per_game`,
and emits reproducible policy comparisons. Trader actions are synthetic scenarios,
not observations of real demand.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import statistics
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Iterable, Sequence

from nba_stock_market.engine import NetPointsModel, Player
from nba_stock_market.expectations import DunksAndThreesExpectation
from nba_stock_market.historical_data import load_game_records
from nba_stock_market.per_game import (
    DividendBasis,
    EconomyPolicy,
    EconomyRuleError,
    LedgerEntryKind,
    PerGameEconomy,
    PlayerGameResult,
    PlayerQuote,
    PositionSide,
    SettlementStatus,
)


STRATEGIES = ("hold", "value_seeking", "schedule_streaming", "seeded_random")
DEFAULT_SEEDS = (7, 2027)
DEFAULT_RATES = (20_000, 40_000)
DEFAULT_IMPACT_BPS = (0, 50)
DEFAULT_SHORT_MODES = (False, True)
DEFAULT_UNIVERSE_SIZE = 60
DEFAULT_LONG_SLOTS = 10
DEFAULT_WEEKLY_SHORT_SLOTS = 3
MINIMUM_QUOTE_DOLLARS = 25_000


@dataclass(frozen=True)
class HistoricalPlayerGame:
    game_id: str
    game_date: date
    player_id: str
    player_name: str
    actual_net_points: float
    saved_projection_net_points: float | None


@dataclass(frozen=True)
class ScenarioConfig:
    dividend_basis: DividendBasis
    dividend_dollars_per_net_point: int
    quote_impact_bps: int
    weekly_shorts: bool
    seed: int
    universe_size: int = DEFAULT_UNIVERSE_SIZE
    long_slots: int = DEFAULT_LONG_SLOTS
    weekly_short_slots: int = DEFAULT_WEEKLY_SHORT_SLOTS

    def __post_init__(self) -> None:
        if not isinstance(self.dividend_basis, DividendBasis):
            raise ValueError("dividend_basis must be a DividendBasis")
        if self.dividend_dollars_per_net_point < 0:
            raise ValueError("dividend rate must be non-negative")
        if self.quote_impact_bps < 0:
            raise ValueError("quote impact must be non-negative")
        if self.universe_size < self.long_slots:
            raise ValueError("universe must be at least as large as the long roster")
        if self.long_slots != 10:
            raise ValueError("SIM-V2 evaluates exactly 10 long slots")
        if not 0 <= self.weekly_short_slots <= 5:
            raise ValueError("weekly short slots must be between zero and five")

    @property
    def scenario_id(self) -> str:
        shorts = "weekly-shorts" if self.weekly_shorts else "no-shorts"
        return (
            f"{self.dividend_basis.value}-{self.dividend_dollars_per_net_point}-"
            f"impact-{self.quote_impact_bps}-{shorts}-seed-{self.seed}"
        )


@dataclass(frozen=True)
class EvaluationMatrix:
    bases: tuple[DividendBasis, ...] = (
        DividendBasis.RAW_NET_POINTS,
        DividendBasis.SURPRISE_VS_PROJECTION,
    )
    rates: tuple[int, ...] = DEFAULT_RATES
    quote_impacts_bps: tuple[int, ...] = DEFAULT_IMPACT_BPS
    short_modes: tuple[bool, ...] = DEFAULT_SHORT_MODES
    seeds: tuple[int, ...] = DEFAULT_SEEDS
    universe_size: int = DEFAULT_UNIVERSE_SIZE

    def scenarios(self) -> tuple[ScenarioConfig, ...]:
        return tuple(
            ScenarioConfig(
                dividend_basis=basis,
                dividend_dollars_per_net_point=rate,
                quote_impact_bps=impact,
                weekly_shorts=shorts,
                seed=seed,
                universe_size=self.universe_size,
            )
            for basis in self.bases
            for rate in self.rates
            for impact in self.quote_impacts_bps
            for shorts in self.short_modes
            for seed in self.seeds
        )


@dataclass(frozen=True)
class OpeningMarket:
    quotes: tuple[PlayerQuote, ...]
    player_names: dict[str, str]
    available_on: dict[str, date]
    opening_projection_net_points: dict[str, float]
    method: str


@dataclass(frozen=True)
class ActionTrace:
    game_date: date
    account_id: str
    strategy: str
    action: str
    player_id: str
    side: PositionSide
    sequence: int
    knowledge_max_date: date | None
    quote_before_dollars: int
    quote_after_dollars: int
    locked_cost_dollars: int


@dataclass
class _PositionTrace:
    position_id: str
    account_id: str
    strategy: str
    player_id: str
    side: PositionSide
    opened_date: date
    opened_sequence: int
    locked_cost_dollars: int
    quote_before_open_dollars: int
    closed_date: date | None = None
    closed_sequence: int | None = None


@dataclass(frozen=True)
class _PlannedAction:
    phase: int
    strategy: str
    action: str
    player_id: str
    side: PositionSide
    position_id: str | None = None


@dataclass(frozen=True)
class ScenarioRun:
    report: dict[str, object]
    actions: tuple[ActionTrace, ...]


def _round_half_up(value: float | Decimal) -> int:
    return int(Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _quote_from_projection(projected_net_points: float, rate: int) -> int:
    projected = max(Decimal("0"), Decimal(str(projected_net_points)))
    return max(MINIMUM_QUOTE_DOLLARS, _round_half_up(projected * rate))


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def input_hashes(data_dir: Path, dnt_dir: Path) -> dict[str, object]:
    game_log = data_dir / "player_game_logs.csv"
    dnt_files = sorted(dnt_dir.glob("*.json"), key=lambda item: item.name)
    aggregate = hashlib.sha256()
    for path in dnt_files:
        aggregate.update(path.name.encode("utf-8"))
        aggregate.update(b"\0")
        aggregate.update(_sha256(path).encode("ascii"))
        aggregate.update(b"\n")
    return {
        "player_game_logs_sha256": _sha256(game_log),
        "dnt_aggregate_sha256": aggregate.hexdigest(),
        "dnt_file_count": len(dnt_files),
    }


def load_historical_games(
    data_dir: Path,
    dnt_dir: Path,
) -> list[HistoricalPlayerGame]:
    """Load actuals and their saved pregame projections without fallbacks."""

    records = sorted(
        load_game_records(data_dir / "player_game_logs.csv"),
        key=lambda item: (item.game_date, item.game_id, item.player_id),
    )
    expectation = DunksAndThreesExpectation(cache_dir=dnt_dir)
    model = NetPointsModel()
    players: dict[str, Player] = {}
    games: list[HistoricalPlayerGame] = []
    for record in records:
        player = players.setdefault(
            record.player_id,
            Player(record.player_id, record.player_name, "unavailable", 1.0, 1.0),
        )
        try:
            projection = expectation.projected_box_score(player, record.game_date)
        except TypeError:
            # A cached provider row with null numeric fields is not a usable saved
            # projection. Preserve it as missing; never substitute a salary/current
            # value fallback into a projection-dependent settlement.
            projection = None
        games.append(
            HistoricalPlayerGame(
                game_id=record.game_id,
                game_date=record.game_date,
                player_id=record.player_id,
                player_name=record.player_name,
                actual_net_points=model.score(record.box_score),
                saved_projection_net_points=(
                    None if projection is None else model.score(projection)
                ),
            )
        )
    return games


def derive_opening_market(
    games: Sequence[HistoricalPlayerGame],
    config: ScenarioConfig,
) -> OpeningMarket:
    """Build quotes exclusively from first-available saved pregame projections.

    Player selection is ordered by projection availability and stable player ID. It
    never uses final minutes, salaries from a later season, or realized outcomes.
    """

    first_projection: dict[str, tuple[date, float, str]] = {}
    for game in sorted(games, key=lambda item: (item.game_date, item.game_id, item.player_id)):
        if game.saved_projection_net_points is None or game.player_id in first_projection:
            continue
        first_projection[game.player_id] = (
            game.game_date,
            game.saved_projection_net_points,
            game.player_name,
        )
    ordered = sorted(
        first_projection.items(),
        key=lambda item: (item[1][0], item[0]),
    )[: config.universe_size]
    if len(ordered) < config.long_slots:
        raise ValueError(
            "not enough players with saved pregame projections to fill 10 slots"
        )
    quotes = tuple(
        PlayerQuote(
            player_id=player_id,
            current_per_game_cost_dollars=_quote_from_projection(projection, config.dividend_dollars_per_net_point),
            prior_season_value_per_game_dollars=None,
        )
        for player_id, (_, projection, _) in ordered
    )
    return OpeningMarket(
        quotes=quotes,
        player_names={player_id: values[2] for player_id, values in ordered},
        available_on={player_id: values[0] for player_id, values in ordered},
        opening_projection_net_points={player_id: values[1] for player_id, values in ordered},
        method=(
            "first available saved pregame D&T projection, ordered by availability; "
            "no realized 2025-26 output"
        ),
    )


def _percentile(values: Sequence[float], quantile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    position = (len(ordered) - 1) * quantile
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return float(ordered[lower])
    return float(ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower))


def _rounded(value: float, places: int = 4) -> float:
    rounded = round(float(value), places)
    return 0.0 if rounded == 0 else rounded


def _distribution(values: Sequence[float]) -> dict[str, float]:
    if not values:
        return {
            "mean": 0.0,
            "median": 0.0,
            "p05": 0.0,
            "p25": 0.0,
            "p75": 0.0,
            "p95": 0.0,
            "minimum": 0.0,
            "maximum": 0.0,
        }
    return {
        "mean": _rounded(statistics.fmean(values), 2),
        "median": _rounded(statistics.median(values), 2),
        "p05": _rounded(_percentile(values, 0.05), 2),
        "p25": _rounded(_percentile(values, 0.25), 2),
        "p75": _rounded(_percentile(values, 0.75), 2),
        "p95": _rounded(_percentile(values, 0.95), 2),
        "minimum": _rounded(min(values), 2),
        "maximum": _rounded(max(values), 2),
    }


def _rank(values: Sequence[float]) -> list[float]:
    indexed = sorted(enumerate(values), key=lambda item: (item[1], item[0]))
    ranks = [0.0] * len(values)
    cursor = 0
    while cursor < len(indexed):
        end = cursor + 1
        while end < len(indexed) and indexed[end][1] == indexed[cursor][1]:
            end += 1
        rank = (cursor + end - 1) / 2.0
        for original, _ in indexed[cursor:end]:
            ranks[original] = rank
        cursor = end
    return ranks


def _spearman(left: Sequence[float], right: Sequence[float]) -> float | None:
    if len(left) < 2 or len(left) != len(right):
        return None
    left_ranks = _rank(left)
    right_ranks = _rank(right)
    left_mean = statistics.fmean(left_ranks)
    right_mean = statistics.fmean(right_ranks)
    numerator = sum(
        (a - left_mean) * (b - right_mean)
        for a, b in zip(left_ranks, right_ranks, strict=True)
    )
    left_scale = math.sqrt(sum((value - left_mean) ** 2 for value in left_ranks))
    right_scale = math.sqrt(sum((value - right_mean) ** 2 for value in right_ranks))
    if not left_scale or not right_scale:
        return None
    return _rounded(numerator / (left_scale * right_scale), 6)


def _max_drawdown(values: Sequence[int]) -> int:
    peak = 0
    worst = 0
    for value in values:
        peak = max(peak, value)
        worst = min(worst, value - peak)
    return worst


def _expected_position_cashflow(
    *,
    side: PositionSide,
    locked_cost_dollars: int,
    opened_sequence: int,
    closed_sequence: int | None,
    settled_games: Sequence[tuple[int, int]],
    open_fee_dollars: int,
    drop_fee_dollars: int,
) -> dict[str, int]:
    exposed_dividends = [
        dividend_dollars
        for sequence, dividend_dollars in settled_games
        if opened_sequence <= sequence
        and (closed_sequence is None or sequence < closed_sequence)
    ]
    direction = 1 if side is PositionSide.LONG else -1
    game_cashflow = sum(
        direction * (dividend_dollars - locked_cost_dollars)
        for dividend_dollars in exposed_dividends
    )
    lifecycle_fees = open_fee_dollars + (
        drop_fee_dollars if closed_sequence is not None else 0
    )
    return {
        "qualifying_games": len(exposed_dividends),
        "expected_game_cashflow_dollars": game_cashflow,
        "expected_lifecycle_fee_dollars": -lifecycle_fees,
        "expected_total_cashflow_dollars": game_cashflow - lifecycle_fees,
    }


def _short_inverse_cashflow_audit(
    *,
    locked_cost_dollars: int,
    opened_sequence: int,
    closed_sequence: int | None,
    settled_games: Sequence[tuple[int, int]],
    actual_short_game_pnl_dollars: int,
) -> dict[str, int]:
    """Independently compare a short ledger with inverse-long game cash flow."""

    expected = _expected_position_cashflow(
        side=PositionSide.SHORT,
        locked_cost_dollars=locked_cost_dollars,
        opened_sequence=opened_sequence,
        closed_sequence=closed_sequence,
        settled_games=settled_games,
        open_fee_dollars=0,
        drop_fee_dollars=0,
    )
    expected_short_pnl = expected["expected_game_cashflow_dollars"]
    return {
        "qualifying_games": expected["qualifying_games"],
        "expected_short_pnl_dollars": expected_short_pnl,
        "actual_short_game_pnl_dollars": actual_short_game_pnl_dollars,
        "asymmetry_dollars": actual_short_game_pnl_dollars - expected_short_pnl,
    }


def _active_player_ids(
    economy: PerGameEconomy,
    account_id: str,
    side: PositionSide,
) -> set[str]:
    return {
        position.player_id
        for position in economy.active_positions(account_id=account_id, side=side)
    }


def _latest_knowledge_date(history: dict[str, list[tuple[date, float]]]) -> date | None:
    dates = [day for rows in history.values() for day, _ in rows]
    return max(dates, default=None)


def _estimated_np(
    player_id: str,
    history: dict[str, list[tuple[date, float]]],
    latest_projection: dict[str, float],
    opening: OpeningMarket,
) -> float:
    prior = history.get(player_id, [])[-5:]
    if prior:
        return statistics.fmean(value for _, value in prior)
    return latest_projection.get(
        player_id,
        opening.opening_projection_net_points[player_id],
    )


def _week_key(day: date) -> tuple[int, int]:
    iso = day.isocalendar()
    return (iso.year, iso.week)


def run_scenario(
    games: Sequence[HistoricalPlayerGame],
    config: ScenarioConfig,
) -> ScenarioRun:
    """Run one deterministic policy scenario through ``PerGameEconomy``."""

    ordered_games = sorted(
        games,
        key=lambda item: (item.game_date, item.game_id, item.player_id),
    )
    if not ordered_games:
        raise ValueError("simulation requires at least one player-game")
    opening = derive_opening_market(ordered_games, config)
    universe = {quote.player_id for quote in opening.quotes}
    selected_games = [game for game in ordered_games if game.player_id in universe]
    if not selected_games:
        raise ValueError("selected point-in-time universe has no games")
    games_by_date: dict[date, list[HistoricalPlayerGame]] = defaultdict(list)
    game_dates_by_id: dict[str, date] = {}
    for game in selected_games:
        known_date = game_dates_by_id.setdefault(game.game_id, game.game_date)
        if known_date != game.game_date:
            raise ValueError(f"game {game.game_id} appears on multiple dates")
        games_by_date[game.game_date].append(game)
    calendar = sorted(games_by_date)
    sequence_by_game = {
        game_id: index
        for index, game_id in enumerate(
            sorted(game_dates_by_id, key=lambda item: (game_dates_by_id[item], item)),
            start=1,
        )
    }

    policy = EconomyPolicy(
        ruleset_id=config.scenario_id,
        dividend_basis=config.dividend_basis,
        dividend_dollars_per_net_point=config.dividend_dollars_per_net_point,
        max_long_positions=config.long_slots,
        max_short_positions=5,
        open_quote_impact_bps=config.quote_impact_bps,
        drop_quote_impact_bps=config.quote_impact_bps,
        minimum_quote_dollars=MINIMUM_QUOTE_DOLLARS,
    )
    economy = PerGameEconomy(list(opening.quotes), policy=policy)
    strategies = tuple(sorted(STRATEGIES))
    accounts = {strategy: f"account-{strategy}" for strategy in strategies}
    for account_id in accounts.values():
        economy.register_account(account_id)

    rng = random.Random(config.seed)
    actions: list[ActionTrace] = []
    positions: dict[str, _PositionTrace] = {}
    position_counter = 0
    rejected_actions = 0
    actual_history: dict[str, list[tuple[date, float]]] = defaultdict(list)
    latest_projection: dict[str, float] = {}
    settled = 0
    unsettled = 0
    outcomes_by_player: dict[str, list[int]] = defaultdict(list)
    settled_dividends_by_player_game: dict[tuple[str, str], int] = {}
    account_daily_pnl: dict[str, list[int]] = defaultdict(list)
    long_slot_samples: list[int] = []
    short_slot_samples: list[int] = []
    max_active_longs = 0
    max_active_shorts = 0
    max_active_longs_by_account = {account_id: 0 for account_id in accounts.values()}
    max_active_shorts_by_account = {account_id: 0 for account_id in accounts.values()}

    opening_quotes = {
        quote.player_id: quote.current_per_game_cost_dollars for quote in opening.quotes
    }
    price_series = {player_id: [value] for player_id, value in opening_quotes.items()}
    movement_by_player: dict[str, int] = defaultdict(int)
    action_move_pcts: list[float] = []
    daily_move_pcts: list[float] = []
    ratio_snapshots: dict[int, list[float]] = {}

    def trace_position_action(
        *,
        day: date,
        account_id: str,
        strategy: str,
        action: str,
        player_id: str,
        side: PositionSide,
        sequence: int,
        before: int,
        after: int,
        locked: int,
    ) -> None:
        actions.append(
            ActionTrace(
                game_date=day,
                account_id=account_id,
                strategy=strategy,
                action=action,
                player_id=player_id,
                side=side,
                sequence=sequence,
                knowledge_max_date=_latest_knowledge_date(actual_history),
                quote_before_dollars=before,
                quote_after_dollars=after,
                locked_cost_dollars=locked,
            )
        )
        price_series[player_id].append(after)
        movement_by_player[player_id] += abs(after - before)
        if before:
            action_move_pcts.append(abs(after / before - 1.0))

    def open_position(
        *,
        day: date,
        account_id: str,
        strategy: str,
        player_id: str,
        side: PositionSide,
        sequence: int,
    ) -> bool:
        nonlocal position_counter, rejected_actions
        position_counter += 1
        position_id = f"{config.scenario_id}:{account_id}:{position_counter:05d}"
        before = economy.quote(player_id).current_per_game_cost_dollars
        try:
            opened = economy.open_position(
                position_id=position_id,
                account_id=account_id,
                player_id=player_id,
                side=side,
                sequence=sequence,
            )
        except EconomyRuleError:
            rejected_actions += 1
            return False
        after = economy.quote(player_id).current_per_game_cost_dollars
        positions[position_id] = _PositionTrace(
            position_id=position_id,
            account_id=account_id,
            strategy=strategy,
            player_id=player_id,
            side=side,
            opened_date=day,
            opened_sequence=sequence,
            locked_cost_dollars=opened.locked_per_game_cost_dollars,
            quote_before_open_dollars=before,
        )
        trace_position_action(
            day=day,
            account_id=account_id,
            strategy=strategy,
            action="add" if side is PositionSide.LONG else "short_open",
            player_id=player_id,
            side=side,
            sequence=sequence,
            before=before,
            after=after,
            locked=opened.locked_per_game_cost_dollars,
        )
        return True

    def close_position(
        *,
        day: date,
        strategy: str,
        position_id: str,
        sequence: int,
    ) -> bool:
        nonlocal rejected_actions
        tracked = positions[position_id]
        before = economy.quote(tracked.player_id).current_per_game_cost_dollars
        try:
            economy.close_position(position_id, sequence=sequence)
        except EconomyRuleError:
            rejected_actions += 1
            return False
        after = economy.quote(tracked.player_id).current_per_game_cost_dollars
        tracked.closed_date = day
        tracked.closed_sequence = sequence
        trace_position_action(
            day=day,
            account_id=tracked.account_id,
            strategy=strategy,
            action="drop" if tracked.side is PositionSide.LONG else "short_close",
            player_id=tracked.player_id,
            side=tracked.side,
            sequence=sequence,
            before=before,
            after=after,
            locked=tracked.locked_cost_dollars,
        )
        return True

    def available_players(day: date, short_player_ids: set[str]) -> list[str]:
        return [
            player_id
            for player_id in sorted(universe)
            if opening.available_on[player_id] <= day
            and player_id not in short_player_ids
        ]

    def target_longs(
        strategy: str,
        day: date,
        todays_players: set[str],
        rebalance_due: bool,
        active_longs: set[str],
        active_shorts: set[str],
        quote_snapshot: dict[str, int],
    ) -> list[str] | None:
        if strategy == "hold" and active_longs:
            return None
        if (
            strategy in {"value_seeking", "seeded_random"}
            and active_longs
            and not rebalance_due
        ):
            return None
        candidates = available_players(day, active_shorts)
        if strategy == "seeded_random":
            candidates = candidates[:]
            rng.shuffle(candidates)
            return candidates[: config.long_slots]
        if strategy == "schedule_streaming":
            playing = [player_id for player_id in candidates if player_id in todays_players]
            ranked_playing = sorted(
                playing,
                key=lambda player_id: (
                    -latest_projection.get(
                        player_id,
                        opening.opening_projection_net_points[player_id],
                    ),
                    player_id,
                ),
            )
            remainder = [player_id for player_id in candidates if player_id not in set(ranked_playing)]
            remainder.sort(
                key=lambda player_id: (
                    -_estimated_np(player_id, actual_history, latest_projection, opening),
                    player_id,
                )
            )
            return (ranked_playing + remainder)[: config.long_slots]
        if strategy == "value_seeking":
            return sorted(
                candidates,
                key=lambda player_id: (
                    -(
                        _estimated_np(player_id, actual_history, latest_projection, opening)
                        * config.dividend_dollars_per_net_point
                        - quote_snapshot[player_id]
                    ),
                    player_id,
                ),
            )[: config.long_slots]
        return sorted(
            candidates,
            key=lambda player_id: (
                -latest_projection.get(
                    player_id,
                    opening.opening_projection_net_points[player_id],
                ),
                player_id,
            ),
        )[: config.long_slots]

    def target_weekly_shorts(
        strategy: str,
        day: date,
        long_player_ids: set[str],
        quote_snapshot: dict[str, int],
    ) -> list[str]:
        candidates = [
            player_id
            for player_id in sorted(universe)
            if opening.available_on[player_id] <= day
            and player_id not in long_player_ids
        ]
        if strategy == "seeded_random":
            rng.shuffle(candidates)
        elif strategy == "schedule_streaming":
            candidates.sort(
                key=lambda player_id: (
                    -_estimated_np(player_id, actual_history, latest_projection, opening),
                    player_id,
                )
            )
        else:
            candidates.sort(
                key=lambda player_id: (
                    -(
                        quote_snapshot[player_id]
                        - _estimated_np(player_id, actual_history, latest_projection, opening)
                        * config.dividend_dollars_per_net_point
                    ),
                    player_id,
                )
            )
        return candidates[: config.weekly_short_slots]

    def execute_action_batch(
        *,
        day: date,
        sequence: int,
        planned_actions: Sequence[_PlannedAction],
    ) -> None:
        ordered_actions = sorted(
            planned_actions,
            key=lambda item: (
                item.phase,
                item.player_id,
                item.side.value,
                item.strategy,
                item.position_id or "",
            ),
        )
        for planned in ordered_actions:
            if planned.action == "close":
                assert planned.position_id is not None
                close_position(
                    day=day,
                    strategy=planned.strategy,
                    position_id=planned.position_id,
                    sequence=sequence,
                )
                continue
            if planned.action != "open":
                raise AssertionError(f"unknown planned action {planned.action}")
            open_position(
                day=day,
                account_id=accounts[planned.strategy],
                strategy=planned.strategy,
                player_id=planned.player_id,
                side=planned.side,
                sequence=sequence,
            )

    previous_week: tuple[int, int] | None = None
    for day_index, day in enumerate(calendar, start=1):
        day_games = sorted(
            games_by_date[day],
            key=lambda item: (item.game_id, item.player_id),
        )
        day_sequence = min(
            sequence_by_game[game.game_id] for game in day_games
        )
        start_quotes = {
            player_id: economy.quote(player_id).current_per_game_cost_dollars
            for player_id in universe
        }

        # Pregame projection phase: values are available before roster decisions.
        for game in day_games:
            if game.saved_projection_net_points is not None:
                latest_projection[game.player_id] = game.saved_projection_net_points
        todays_players = {game.player_id for game in day_games}
        current_week = _week_key(day)
        rebalance_due = current_week != previous_week
        active_long_positions = {
            strategy: tuple(
                economy.active_positions(
                    account_id=accounts[strategy],
                    side=PositionSide.LONG,
                )
            )
            for strategy in strategies
        }
        active_short_positions = {
            strategy: tuple(
                economy.active_positions(
                    account_id=accounts[strategy],
                    side=PositionSide.SHORT,
                )
            )
            for strategy in strategies
        }
        planned_actions: list[_PlannedAction] = []
        if rebalance_due:
            for strategy in strategies:
                planned_actions.extend(
                    _PlannedAction(
                        phase=0,
                        strategy=strategy,
                        action="close",
                        player_id=position.player_id,
                        side=PositionSide.SHORT,
                        position_id=position.position_id,
                    )
                    for position in active_short_positions[strategy]
                )

        planned_long_players: dict[str, set[str]] = {}
        for strategy in strategies:
            current_longs = {
                position.player_id for position in active_long_positions[strategy]
            }
            decision_shorts = (
                set()
                if rebalance_due
                else {
                    position.player_id
                    for position in active_short_positions[strategy]
                }
            )
            targets = target_longs(
                strategy,
                day,
                todays_players,
                rebalance_due,
                current_longs,
                decision_shorts,
                start_quotes,
            )
            if targets is None:
                planned_long_players[strategy] = current_longs
                continue

            target_set = set(targets)
            for position in active_long_positions[strategy]:
                if position.player_id not in target_set:
                    planned_actions.append(
                        _PlannedAction(
                            phase=1,
                            strategy=strategy,
                            action="close",
                            player_id=position.player_id,
                            side=PositionSide.LONG,
                            position_id=position.position_id,
                        )
                    )
            final_longs = current_longs & target_set
            for player_id in targets:
                if player_id in final_longs:
                    continue
                if len(final_longs) >= config.long_slots:
                    break
                planned_actions.append(
                    _PlannedAction(
                        phase=2,
                        strategy=strategy,
                        action="open",
                        player_id=player_id,
                        side=PositionSide.LONG,
                    )
                )
                final_longs.add(player_id)
            planned_long_players[strategy] = final_longs

        if rebalance_due and config.weekly_shorts:
            for strategy in strategies:
                planned_actions.extend(
                    _PlannedAction(
                        phase=3,
                        strategy=strategy,
                        action="open",
                        player_id=player_id,
                        side=PositionSide.SHORT,
                    )
                    for player_id in target_weekly_shorts(
                        strategy,
                        day,
                        planned_long_players[strategy],
                        start_quotes,
                    )
                )
        execute_action_batch(
            day=day,
            sequence=day_sequence,
            planned_actions=planned_actions,
        )

        active_long_counts = {
            account: len(
                economy.active_positions(account_id=account, side=PositionSide.LONG)
            )
            for account in accounts.values()
        }
        active_short_counts = {
            account: len(
                economy.active_positions(account_id=account, side=PositionSide.SHORT)
            )
            for account in accounts.values()
        }
        for account_id, count in active_long_counts.items():
            max_active_longs_by_account[account_id] = max(
                max_active_longs_by_account[account_id], count
            )
        for account_id, count in active_short_counts.items():
            max_active_shorts_by_account[account_id] = max(
                max_active_shorts_by_account[account_id], count
            )
        active_longs = sum(active_long_counts.values())
        active_shorts = sum(active_short_counts.values())
        long_slot_samples.append(active_longs)
        short_slot_samples.append(active_shorts)
        max_active_longs = max(max_active_longs, active_longs)
        max_active_shorts = max(max_active_shorts, active_shorts)

        # Settlement phase: actuals are not added to strategy history until the day ends.
        for game in day_games:
            outcome = economy.settle_player_game(
                PlayerGameResult(
                    game_id=game.game_id,
                    player_id=game.player_id,
                    sequence=sequence_by_game[game.game_id],
                    revision=1,
                    actual_net_points=game.actual_net_points,
                    saved_projection_net_points=game.saved_projection_net_points,
                )
            )
            if outcome.status is SettlementStatus.SETTLED:
                settled += 1
                if outcome.dividend_dollars is not None:
                    outcomes_by_player[game.player_id].append(outcome.dividend_dollars)
                    settled_dividends_by_player_game[
                        (game.game_id, game.player_id)
                    ] = outcome.dividend_dollars
            else:
                unsettled += 1
        for game in day_games:
            actual_history[game.player_id].append((day, game.actual_net_points))
        for account_id in accounts.values():
            account_daily_pnl[account_id].append(economy.account_pnl_dollars(account_id))

        end_quotes = {
            player_id: economy.quote(player_id).current_per_game_cost_dollars
            for player_id in universe
        }
        daily_move_pcts.extend(
            abs(end_quotes[player_id] / start_quotes[player_id] - 1.0)
            for player_id in universe
            if start_quotes[player_id]
        )
        if day_index in {7, 30, len(calendar)}:
            ratio_snapshots[day_index] = [
                end_quotes[player_id] / opening_quotes[player_id]
                for player_id in sorted(universe)
            ]
        previous_week = current_week

    final_sequence = max(sequence_by_game.values()) + 1
    final_day = calendar[-1]
    close_day = final_day + timedelta(days=1)
    if config.weekly_shorts:
        execute_action_batch(
            day=close_day,
            sequence=final_sequence,
            planned_actions=[
                _PlannedAction(
                    phase=0,
                    strategy=strategy,
                    action="close",
                    player_id=position.player_id,
                    side=PositionSide.SHORT,
                    position_id=position.position_id,
                )
                for strategy in strategies
                for position in economy.active_positions(
                    account_id=accounts[strategy],
                    side=PositionSide.SHORT,
                )
            ],
        )

    settled_dividends_by_player: dict[str, list[tuple[int, int]]] = defaultdict(list)
    for game in selected_games:
        dividend_dollars = settled_dividends_by_player_game.get(
            (game.game_id, game.player_id)
        )
        if dividend_dollars is None:
            continue
        settled_dividends_by_player[game.player_id].append(
            (sequence_by_game[game.game_id], dividend_dollars)
        )

    entries = economy.ledger_entries()
    entries_by_account: dict[str, list] = defaultdict(list)
    entries_by_position: dict[str, list] = defaultdict(list)
    for entry in entries:
        entries_by_account[entry.account_id].append(entry)
        entries_by_position[entry.position_id].append(entry)

    account_rows: list[dict[str, object]] = []
    ledger_reconciled = True
    for strategy, account_id in accounts.items():
        account_entries = entries_by_account[account_id]
        ledger_sum = sum(entry.amount_dollars for entry in account_entries)
        engine_pnl = economy.account_pnl_dollars(account_id)
        expected_cash_flow = sum(
            _expected_position_cashflow(
                side=position.side,
                locked_cost_dollars=position.locked_cost_dollars,
                opened_sequence=position.opened_sequence,
                closed_sequence=position.closed_sequence,
                settled_games=settled_dividends_by_player.get(
                    position.player_id,
                    (),
                ),
                open_fee_dollars=policy.open_fee_dollars,
                drop_fee_dollars=policy.drop_fee_dollars,
            )["expected_total_cashflow_dollars"]
            for position in positions.values()
            if position.account_id == account_id
        )
        reconciled = ledger_sum == engine_pnl == expected_cash_flow
        ledger_reconciled = ledger_reconciled and reconciled
        long_entries = [
            entry
            for entry in account_entries
            if positions[entry.position_id].side is PositionSide.LONG
        ]
        short_entries = [
            entry
            for entry in account_entries
            if positions[entry.position_id].side is PositionSide.SHORT
        ]
        account_rows.append(
            {
                "account_id": account_id,
                "strategy": strategy,
                "pnl_dollars": engine_pnl,
                "ledger_sum_dollars": ledger_sum,
                "expected_cash_flow_dollars": expected_cash_flow,
                "ledger_reconciled": reconciled,
                "long_game_cost_dollars": sum(
                    entry.amount_dollars
                    for entry in long_entries
                    if entry.kind is LedgerEntryKind.GAME_COST
                ),
                "long_dividend_dollars": sum(
                    entry.amount_dollars
                    for entry in long_entries
                    if entry.kind in {
                        LedgerEntryKind.GAME_DIVIDEND,
                        LedgerEntryKind.DIVIDEND_CORRECTION,
                    }
                ),
                "short_cost_credit_dollars": sum(
                    entry.amount_dollars
                    for entry in short_entries
                    if entry.kind is LedgerEntryKind.GAME_COST
                ),
                "short_dividend_debit_dollars": sum(
                    entry.amount_dollars
                    for entry in short_entries
                    if entry.kind in {
                        LedgerEntryKind.GAME_DIVIDEND,
                        LedgerEntryKind.DIVIDEND_CORRECTION,
                    }
                ),
                "fee_dollars": sum(
                    entry.amount_dollars
                    for entry in account_entries
                    if entry.kind in {LedgerEntryKind.OPEN_FEE, LedgerEntryKind.DROP_FEE}
                ),
                "settled_exposures": sum(
                    entry.kind is LedgerEntryKind.GAME_COST for entry in account_entries
                ),
                "max_drawdown_dollars": _max_drawdown(account_daily_pnl[account_id]),
            }
        )

    long_positions = [item for item in positions.values() if item.side is PositionSide.LONG]
    short_positions = [item for item in positions.values() if item.side is PositionSide.SHORT]
    adds = sum(action.action == "add" for action in actions)
    drops = sum(action.action == "drop" for action in actions)
    weeks = len({_week_key(day) for day in calendar})
    holding_days = [
        ((position.closed_date or final_day) - position.opened_date).days
        for position in long_positions
    ]
    games_held = [
        sum(entry.kind is LedgerEntryKind.GAME_COST for entry in entries_by_position[position.position_id])
        for position in long_positions
    ]
    opens_by_account_player: dict[tuple[str, str], int] = defaultdict(int)
    for position in long_positions:
        opens_by_account_player[(position.account_id, position.player_id)] += 1
    round_trips = sum(max(0, count - 1) for count in opens_by_account_player.values())
    lifecycle_fee_total = -sum(
        entry.amount_dollars
        for entry in entries
        if entry.kind in {LedgerEntryKind.OPEN_FEE, LedgerEntryKind.DROP_FEE}
    )

    ending_quotes = {
        player_id: economy.quote(player_id).current_per_game_cost_dollars
        for player_id in universe
    }
    end_ratios = [
        ending_quotes[player_id] / opening_quotes[player_id]
        for player_id in sorted(universe)
    ]
    path_ratios = [
        value / opening_quotes[player_id]
        for player_id, series in price_series.items()
        for value in series
    ]
    drawdowns = []
    for player_id, series in price_series.items():
        peak = series[0]
        worst = 0.0
        for value in series:
            peak = max(peak, value)
            worst = max(worst, 1.0 - value / peak)
        drawdowns.append(worst)
    total_movement = sum(movement_by_player.values())

    calibration_rows: list[dict[str, object]] = []
    for player_id in sorted(universe):
        dividends = outcomes_by_player.get(player_id, [])
        if not dividends:
            continue
        realized = statistics.fmean(dividends)
        opening_cost = opening_quotes[player_id]
        calibration_rows.append(
            {
                "player_id": player_id,
                "player_name": opening.player_names[player_id],
                "opening_cost_dollars": opening_cost,
                "realized_average_dividend_dollars": _rounded(realized, 2),
                "signed_error_dollars": _rounded(realized - opening_cost, 2),
                "absolute_error_dollars": _rounded(abs(realized - opening_cost), 2),
                "settled_games": len(dividends),
            }
        )
    calibration_rows.sort(key=lambda row: (row["opening_cost_dollars"], row["player_id"]))
    deciles: list[dict[str, object]] = []
    for decile in range(10):
        start = math.floor(len(calibration_rows) * decile / 10)
        end = math.floor(len(calibration_rows) * (decile + 1) / 10)
        bucket = calibration_rows[start:end]
        deciles.append(
            {
                "decile": decile + 1,
                "players": len(bucket),
                "mean_signed_error_dollars": _rounded(
                    statistics.fmean(float(row["signed_error_dollars"]) for row in bucket),
                    2,
                )
                if bucket
                else 0.0,
            }
        )
    opening_values = [float(row["opening_cost_dollars"]) for row in calibration_rows]
    realized_values = [
        float(row["realized_average_dividend_dollars"]) for row in calibration_rows
    ]
    worst_under = sorted(
        calibration_rows,
        key=lambda row: (-float(row["signed_error_dollars"]), str(row["player_id"])),
    )[:5]
    worst_over = sorted(
        calibration_rows,
        key=lambda row: (float(row["signed_error_dollars"]), str(row["player_id"])),
    )[:5]

    short_inverse_audits: list[dict[str, object]] = []
    short_position_pnl: list[int] = []
    short_games: list[int] = []
    for position in short_positions:
        position_entries = entries_by_position[position.position_id]
        actual_game_pnl = sum(
            entry.amount_dollars
            for entry in position_entries
            if entry.kind
            in {
                LedgerEntryKind.GAME_COST,
                LedgerEntryKind.GAME_DIVIDEND,
                LedgerEntryKind.DIVIDEND_CORRECTION,
            }
        )
        audit = _short_inverse_cashflow_audit(
            locked_cost_dollars=position.locked_cost_dollars,
            opened_sequence=position.opened_sequence,
            closed_sequence=position.closed_sequence,
            settled_games=settled_dividends_by_player.get(position.player_id, ()),
            actual_short_game_pnl_dollars=actual_game_pnl,
        )
        short_inverse_audits.append(
            {
                "position_id": position.position_id,
                "player_id": position.player_id,
                **audit,
            }
        )
        short_games.append(audit["qualifying_games"])
        short_position_pnl.append(sum(entry.amount_dollars for entry in position_entries))
    random_short_ids = {
        position.position_id
        for position in short_positions
        if position.strategy == "seeded_random"
    }
    random_short_pnl = [
        sum(entry.amount_dollars for entry in entries_by_position[position_id])
        for position_id in sorted(random_short_ids)
    ]
    expected_inverse_short_pnl = sum(
        int(row["expected_short_pnl_dollars"]) for row in short_inverse_audits
    )
    actual_short_game_pnl = sum(
        int(row["actual_short_game_pnl_dollars"]) for row in short_inverse_audits
    )
    inverse_cashflow_aggregate_asymmetry = sum(
        int(row["asymmetry_dollars"]) for row in short_inverse_audits
    )
    inverse_cashflow_max_position_asymmetry = max(
        (abs(int(row["asymmetry_dollars"])) for row in short_inverse_audits),
        default=0,
    )

    pnl_values = [int(row["pnl_dollars"]) for row in account_rows]
    hold_row = next(row for row in account_rows if row["strategy"] == "hold")
    stream_row = next(row for row in account_rows if row["strategy"] == "schedule_streaming")
    pnl_share_by_day: dict[str, float | None] = {}
    aggregate_final = sum(pnl_values)
    for threshold in (5, 10, 20):
        if len(calendar) < threshold or aggregate_final == 0:
            pnl_share_by_day[str(threshold)] = None
        else:
            at_threshold = sum(
                account_daily_pnl[account_id][threshold - 1]
                for account_id in accounts.values()
            )
            pnl_share_by_day[str(threshold)] = _rounded(at_threshold / aggregate_final, 6)

    no_leakage_violations = sum(
        action.knowledge_max_date is not None
        and action.knowledge_max_date >= action.game_date
        for action in actions
    )
    locked_cost_violations = sum(
        position.locked_cost_dollars != position.quote_before_open_dollars
        for position in positions.values()
    )
    post_drop_exposure_violations = 0
    for position in positions.values():
        if position.closed_sequence is None:
            continue
        for entry in entries_by_position[position.position_id]:
            if entry.game_id is None:
                continue
            game_sequence = sequence_by_game[entry.game_id]
            if game_sequence >= position.closed_sequence:
                post_drop_exposure_violations += 1

    if not ledger_reconciled:
        raise AssertionError(
            "account P&L and ledger did not match independent expected cash flow"
        )
    if no_leakage_violations:
        raise AssertionError("a roster action observed a same-day outcome")
    if locked_cost_violations:
        raise AssertionError("a position did not lock the quote visible at acquisition")
    if post_drop_exposure_violations:
        raise AssertionError("a closed position received a later game cash flow")
    if not all(isinstance(entry.amount_dollars, int) for entry in entries):
        raise AssertionError("the per-game ledger contains a non-integer amount")
    if max_active_longs > len(accounts) * config.long_slots:
        raise AssertionError("the simulation exceeded the long roster limit")
    if max_active_shorts > len(accounts) * 5:
        raise AssertionError("the simulation exceeded the short roster limit")
    if any(count > config.long_slots for count in max_active_longs_by_account.values()):
        raise AssertionError("an account exceeded the long roster limit")
    if any(count > 5 for count in max_active_shorts_by_account.values()):
        raise AssertionError("an account exceeded the short roster limit")
    if (
        inverse_cashflow_aggregate_asymmetry
        or inverse_cashflow_max_position_asymmetry
    ):
        raise AssertionError("a short ledger was not the exact inverse long cash flow")

    roster_metrics = {
        "adds": adds,
        "drops": drops,
        "adds_per_user_week": _rounded(adds / (len(accounts) * weeks), 4),
        "drops_per_user_week": _rounded(drops / (len(accounts) * weeks), 4),
        "completed_same_player_round_trips": round_trips,
        "median_holding_days": _rounded(statistics.median(holding_days), 2),
        "p10_holding_days": _rounded(_percentile(holding_days, 0.10), 2),
        "median_settled_games_per_position": _rounded(statistics.median(games_held), 2),
        "share_positions_held_0_games": _rounded(sum(value == 0 for value in games_held) / len(games_held), 6),
        "share_positions_held_1_game": _rounded(sum(value == 1 for value in games_held) / len(games_held), 6),
        "share_positions_held_2_games": _rounded(sum(value == 2 for value in games_held) / len(games_held), 6),
        "replacements_per_82_game_dates": _rounded(drops / len(accounts) * 82 / len(calendar), 4),
        "rejected_actions": rejected_actions,
        "transaction_friction_dollars": lifecycle_fee_total,
        "average_long_slot_utilization": _rounded(
            statistics.fmean(long_slot_samples) / (len(accounts) * config.long_slots), 6
        ),
        "max_active_longs_per_account": max(max_active_longs_by_account.values()),
        "max_active_shorts_per_account": max(max_active_shorts_by_account.values()),
        "max_active_longs_by_account": dict(sorted(max_active_longs_by_account.items())),
        "max_active_shorts_by_account": dict(sorted(max_active_shorts_by_account.items())),
        "schedule_streaming_incremental_pnl_vs_hold_dollars": int(stream_row["pnl_dollars"]) - int(hold_row["pnl_dollars"]),
        "schedule_streaming_extra_exposures_vs_hold": int(stream_row["settled_exposures"]) - int(hold_row["settled_exposures"]),
    }
    price_metrics = {
        "median_absolute_change_from_opening_pct": _rounded(100 * statistics.median(abs(value - 1.0) for value in end_ratios), 4),
        "maximum_absolute_change_from_opening_pct": _rounded(100 * max(abs(value - 1.0) for value in path_ratios), 4),
        "maximum_single_action_move_pct": _rounded(100 * max(action_move_pcts, default=0.0), 4),
        "maximum_daily_move_pct": _rounded(100 * max(daily_move_pcts, default=0.0), 4),
        "maximum_drawdown_pct": _rounded(100 * max(drawdowns, default=0.0), 4),
        "maximum_price_opening_multiple": _rounded(max(path_ratios), 6),
        "minimum_price_opening_ratio": _rounded(min(path_ratios), 6),
        "floor_hit_count": sum(
            action.quote_after_dollars == MINIMUM_QUOTE_DOLLARS
            and action.action in {"drop", "short_open"}
            and config.quote_impact_bps > 0
            for action in actions
        ),
        "cap_hit_count": None,
        "day_7_cross_section_ratio_stdev": _rounded(statistics.pstdev(ratio_snapshots.get(7, [1.0])), 6),
        "day_30_cross_section_ratio_stdev": _rounded(statistics.pstdev(ratio_snapshots.get(30, [1.0])), 6),
        "end_cross_section_ratio_stdev": _rounded(statistics.pstdev(end_ratios), 6),
        "largest_player_share_of_absolute_quote_movement": _rounded(
            max(movement_by_player.values(), default=0) / total_movement if total_movement else 0.0,
            6,
        ),
    }
    early_metrics = {
        "opening_method": opening.method,
        "prior_season_anchor": "unavailable: mounted cache has no 2024-25 player-game actual/projection pair",
        "players_evaluated": len(calibration_rows),
        "mean_signed_error_dollars": _rounded(statistics.fmean(float(row["signed_error_dollars"]) for row in calibration_rows), 2),
        "mean_absolute_error_dollars": _rounded(statistics.fmean(float(row["absolute_error_dollars"]) for row in calibration_rows), 2),
        "opening_to_realized_rank_correlation": _spearman(opening_values, realized_values),
        "calibration_deciles": deciles,
        "worst_underpriced": worst_under,
        "worst_overpriced": worst_over,
        "pnl_share_after_game_dates": pnl_share_by_day,
        "tier_and_rookie_breakdown": "unavailable without outcome-safe prior-season player classification",
    }
    short_metrics = {
        "enabled": config.weekly_shorts,
        "slot_limit": 5,
        "slots_used_per_week": config.weekly_short_slots if config.weekly_shorts else 0,
        "entries": len(short_positions),
        "closes": sum(position.closed_sequence is not None for position in short_positions),
        "qualifying_games": sum(short_games),
        "pnl_distribution_dollars": _distribution(short_position_pnl),
        "gross_pnl_dollars": sum(short_position_pnl),
        "net_pnl_dollars": sum(short_position_pnl),
        "win_rate": _rounded(sum(value > 0 for value in short_position_pnl) / len(short_position_pnl), 6) if short_position_pnl else 0.0,
        "maximum_loss_dollars": min(short_position_pnl, default=0),
        "fees_and_penalties_dollars": 0,
        "forced_closes": sum(position.closed_sequence == final_sequence for position in short_positions),
        "voided_closes": 0,
        "random_entry_ev_dollars": _rounded(statistics.fmean(random_short_pnl), 2) if random_short_pnl else 0.0,
        "inverse_cashflow_positions_checked": len(short_inverse_audits),
        "inverse_cashflow_expected_short_pnl_dollars": expected_inverse_short_pnl,
        "inverse_cashflow_actual_short_game_pnl_dollars": actual_short_game_pnl,
        "inverse_cashflow_aggregate_asymmetry_dollars": inverse_cashflow_aggregate_asymmetry,
        "inverse_cashflow_max_position_asymmetry_dollars": inverse_cashflow_max_position_asymmetry,
    }
    pnl_metrics = {
        "distribution_dollars": _distribution(pnl_values),
        "share_below_zero": _rounded(sum(value < 0 for value in pnl_values) / len(pnl_values), 6),
        "aggregate_pnl_dollars": sum(pnl_values),
        "pnl_per_settled_exposure_dollars": _rounded(
            sum(pnl_values) / sum(int(row["settled_exposures"]) for row in account_rows),
            2,
        ) if sum(int(row["settled_exposures"]) for row in account_rows) else 0.0,
        "accounts": account_rows,
    }

    report: dict[str, object] = {
        "scenario_id": config.scenario_id,
        "policy": {
            "dividend_basis": config.dividend_basis.value,
            "dividend_dollars_per_net_point": config.dividend_dollars_per_net_point,
            "quote_impact_bps_on_add_and_drop": config.quote_impact_bps,
            "weekly_shorts": config.weekly_shorts,
            "long_slot_limit": config.long_slots,
            "short_slot_limit": 5,
            "weekly_short_slots_used": config.weekly_short_slots if config.weekly_shorts else 0,
            "open_fee_dollars": 0,
            "drop_fee_dollars": 0,
        },
        "seed": config.seed,
        "dataset": {
            "selected_players": len(universe),
            "selected_player_games": len(selected_games),
            "game_dates": len(calendar),
            "first_game_date": calendar[0].isoformat(),
            "last_game_date": calendar[-1].isoformat(),
            "outside_universe_player_games": len(ordered_games) - len(selected_games),
        },
        "settled": settled,
        "unsettled": unsettled,
        "ledger_reconciled": ledger_reconciled,
        "no_same_day_outcome_leakage": no_leakage_violations == 0,
        "order_flow_label": "synthetic trader scenarios; not observed user demand",
        "roster_churn": roster_metrics,
        "price_stability": price_metrics,
        "early_mispricing": early_metrics,
        "short_policy": short_metrics,
        "user_pnl": pnl_metrics,
        "adapter_invariants": {
            "no_same_day_outcome_leakage_violations": no_leakage_violations,
            "locked_cost_violations": locked_cost_violations,
            "post_drop_exposure_violations": post_drop_exposure_violations,
            "integer_ledger_amounts": all(isinstance(entry.amount_dollars, int) for entry in entries),
            "max_active_longs_across_all_accounts": max_active_longs,
            "max_active_shorts_across_all_accounts": max_active_shorts,
            "max_active_longs_per_account": max(max_active_longs_by_account.values()),
            "max_active_shorts_per_account": max(max_active_shorts_by_account.values()),
            "inverse_cashflow_aggregate_asymmetry_dollars": inverse_cashflow_aggregate_asymmetry,
            "inverse_cashflow_max_position_asymmetry_dollars": inverse_cashflow_max_position_asymmetry,
        },
    }
    return ScenarioRun(report=report, actions=tuple(actions))


def _policy_key(report: dict[str, object]) -> tuple[object, ...]:
    policy = report["policy"]
    assert isinstance(policy, dict)
    return (
        policy["dividend_basis"],
        policy["dividend_dollars_per_net_point"],
        policy["quote_impact_bps_on_add_and_drop"],
        policy["weekly_shorts"],
    )


def _aggregate_policy_rows(scenarios: Sequence[dict[str, object]]) -> list[dict[str, object]]:
    grouped: dict[tuple[object, ...], list[dict[str, object]]] = defaultdict(list)
    for scenario in scenarios:
        grouped[_policy_key(scenario)].append(scenario)
    rows: list[dict[str, object]] = []
    for key in sorted(grouped, key=lambda item: (str(item[0]), int(item[1]), int(item[2]), bool(item[3]))):
        members = grouped[key]
        pnl_means = [
            float(member["user_pnl"]["distribution_dollars"]["mean"])  # type: ignore[index]
            for member in members
        ]
        rows.append(
            {
                "dividend_basis": key[0],
                "dividend_dollars_per_net_point": key[1],
                "quote_impact_bps": key[2],
                "weekly_shorts": key[3],
                "seeds": [member["seed"] for member in members],
                "mean_user_pnl_dollars": _rounded(statistics.fmean(pnl_means), 2),
                "cross_seed_user_pnl_stdev_dollars": _rounded(statistics.pstdev(pnl_means), 2),
                "mean_adds_per_user_week": _rounded(statistics.fmean(float(member["roster_churn"]["adds_per_user_week"]) for member in members), 4),  # type: ignore[index]
                "mean_drops_per_user_week": _rounded(statistics.fmean(float(member["roster_churn"]["drops_per_user_week"]) for member in members), 4),  # type: ignore[index]
                "mean_end_price_dispersion": _rounded(statistics.fmean(float(member["price_stability"]["end_cross_section_ratio_stdev"]) for member in members), 6),  # type: ignore[index]
                "mean_max_daily_move_pct": _rounded(statistics.fmean(float(member["price_stability"]["maximum_daily_move_pct"]) for member in members), 4),  # type: ignore[index]
                "mean_opening_mae_dollars": _rounded(statistics.fmean(float(member["early_mispricing"]["mean_absolute_error_dollars"]) for member in members), 2),  # type: ignore[index]
                "mean_short_pnl_dollars": _rounded(statistics.fmean(float(member["short_policy"]["net_pnl_dollars"]) for member in members), 2),  # type: ignore[index]
                "all_ledgers_reconciled": all(bool(member["ledger_reconciled"]) for member in members),
            }
        )
    return rows


def run_evaluation(
    games: Sequence[HistoricalPlayerGame],
    *,
    hashes: dict[str, object],
    matrix: EvaluationMatrix | None = None,
) -> dict[str, object]:
    matrix = matrix or EvaluationMatrix()
    runs = [run_scenario(games, config) for config in matrix.scenarios()]
    scenarios = [run.report for run in runs]
    report: dict[str, object] = {
        "schema_version": 1,
        "study": "per-game economy v2 historical scenario evaluation",
        "input_hashes": hashes,
        "policies": {
            "dividend_bases": [basis.value for basis in matrix.bases],
            "dividend_dollars_per_net_point": list(matrix.rates),
            "quote_impacts_bps": list(matrix.quote_impacts_bps),
            "weekly_short_modes": list(matrix.short_modes),
            "long_slots": 10,
            "short_slot_limit": 5,
            "weekly_short_slots_used": 3,
            "opening_quote_method": "first available saved pregame D&T projection only",
            "transaction_friction_dollars": 0,
            "scenario_count": len(scenarios),
        },
        "seeds": list(matrix.seeds),
        "settled": sum(int(scenario["settled"]) for scenario in scenarios),
        "unsettled": sum(int(scenario["unsettled"]) for scenario in scenarios),
        "ledger_reconciled": all(bool(scenario["ledger_reconciled"]) for scenario in scenarios),
        "no_same_day_outcome_leakage": all(bool(scenario["no_same_day_outcome_leakage"]) for scenario in scenarios),
        "order_flow_label": "all adds, drops, and shorts are synthetic; none are observed demand",
        "unavailable_metrics": [
            "Exact prior-season value per game: 2024-25 player-game actuals and saved projections are not mounted.",
            "Observed user demand: no real add/drop/short order-flow dataset was supplied.",
            "Historical correction frequency: the ESPN cache contains final rows, not provider revisions.",
            "Outcome-safe star/mid/bench/rookie labels: no reviewed prior-season classification was supplied.",
        ],
        "dataset": {
            "input_player_games": len(games),
            "input_players": len({game.player_id for game in games}),
            "input_missing_or_unusable_projection_rows": sum(
                game.saved_projection_net_points is None for game in games
            ),
            "first_date": min(game.game_date for game in games).isoformat(),
            "last_date": max(game.game_date for game in games).isoformat(),
            "universe_size_per_scenario": matrix.universe_size,
        },
        "policy_summary": _aggregate_policy_rows(scenarios),
        "scenarios": scenarios,
    }
    return report


def _money(value: object) -> str:
    number = float(value)
    sign = "-" if number < 0 else ""
    return f"{sign}${abs(number):,.0f}"


def render_markdown(report: dict[str, object]) -> str:
    policies = report["policies"]
    dataset = report["dataset"]
    hashes = report["input_hashes"]
    rows = report["policy_summary"]
    assert isinstance(policies, dict)
    assert isinstance(dataset, dict)
    assert isinstance(hashes, dict)
    assert isinstance(rows, list)
    lines = [
        "# Per-game economy v2 historical evaluation",
        "",
        "All order flow in this report is **synthetic scenario behavior**, not observed user demand.",
        "The run is local-only and deterministic; it does not call a network, database, migration, or deployment.",
        "",
        "## Inputs and limits",
        "",
        f"- Player-games in mounted cache: {int(dataset['input_player_games']):,}.",
        f"- Missing or unusable saved projection rows in the full cache: {int(dataset['input_missing_or_unusable_projection_rows']):,}.",
        f"- Date range: {dataset['first_date']} through {dataset['last_date']}.",
        f"- Point-in-time universe per scenario: {dataset['universe_size_per_scenario']} players, selected by first saved pregame projection availability.",
        f"- ESPN game-log SHA-256: `{hashes.get('player_game_logs_sha256', 'fixture-not-provided')}`.",
        f"- D&T aggregate SHA-256: `{hashes.get('dnt_aggregate_sha256', 'fixture-not-provided')}` across {hashes.get('dnt_file_count', 0)} files.",
        f"- Seeds: {', '.join(str(seed) for seed in report['seeds'])}.",
        f"- Settled player-games across scenarios: {int(report['settled']):,}; unsettled: {int(report['unsettled']):,}.",
        f"- Independent cash-flow reconciliation: {'passed' if report['ledger_reconciled'] else 'FAILED'}; position exposure, settled dividends, and lifecycle fees agree with engine P&L and the ledger.",
        "- Exact prior-season per-game anchors are unavailable because the mounted cache has no 2024-25 player-game actual/projection pair.",
        "- Current-season realized outcomes are used only for retrospective evaluation and later decisions, never for opening quotes.",
        "",
        "## Policy matrix",
        "",
        f"The complete matrix has {policies['scenario_count']} runs: raw versus old D&T-surprise dividends, $20K versus $40K per net point, two quote-impact settings, weekly shorts on/off, and every listed seed.",
        "Open/drop fees are zero in this comparison so price impact and strategy behavior remain separately visible.",
        "",
        "## Roster churn",
        "",
        "| Basis | $/NP | Impact | Shorts | Adds/user/week | Drops/user/week |",
        "|---|---:|---:|:---:|---:|---:|",
    ]
    for row in rows:
        lines.append(
            f"| {row['dividend_basis']} | {_money(row['dividend_dollars_per_net_point'])} | {row['quote_impact_bps']} bps | {'yes' if row['weekly_shorts'] else 'no'} | {float(row['mean_adds_per_user_week']):.2f} | {float(row['mean_drops_per_user_week']):.2f} |"
        )
    lines.extend(
        [
            "",
            "Schedule streaming rebalances before each day's outcomes; value and random strategies rebalance weekly; hold does not churn after filling its roster. Detailed per-scenario round trips, holding times, slot use, rejected actions, and the streaming-versus-hold exposure diagnostic are in the JSON.",
            "",
            "## Price stability",
            "",
            "| Basis | $/NP | Impact | Shorts | End ratio dispersion | Max daily move |",
            "|---|---:|---:|:---:|---:|---:|",
        ]
    )
    for row in rows:
        lines.append(
            f"| {row['dividend_basis']} | {_money(row['dividend_dollars_per_net_point'])} | {row['quote_impact_bps']} bps | {'yes' if row['weekly_shorts'] else 'no'} | {float(row['mean_end_price_dispersion']):.4f} | {float(row['mean_max_daily_move_pct']):.2f}% |"
        )
    lines.extend(
        [
            "",
            "Quote changes come only from synthetic adds, drops, and short opens/closes. The JSON also records single-action moves, drawdowns, floor hits, price/opening extremes, day-7/day-30 dispersion, and movement concentration.",
            "",
            "## Early mispricing",
            "",
            "Exact prior-season value-per-game anchors are **unavailable** in the mounted cache. Opening cost therefore uses the player's first saved pregame D&T projection as an explicitly labeled proxy and never uses final-season minutes or results.",
            "",
            "| Basis | $/NP | Impact | Shorts | Retrospective opening MAE |",
            "|---|---:|---:|:---:|---:|",
        ]
    )
    for row in rows:
        lines.append(
            f"| {row['dividend_basis']} | {_money(row['dividend_dollars_per_net_point'])} | {row['quote_impact_bps']} bps | {'yes' if row['weekly_shorts'] else 'no'} | {_money(row['mean_opening_mae_dollars'])} |"
        )
    lines.extend(
        [
            "",
            "The retrospective calibration table is diagnostic only. It was not fed back into any trader decision. Per-scenario deciles, rank correlation, worst over/underpricing, and early-date P&L shares are in the JSON.",
            "",
            "## Short policy",
            "",
            "Weekly inverse positions open before that week's outcomes and close at the next week boundary. Each account uses at most three of the five allowed slots.",
            "",
            "| Basis | $/NP | Impact | Shorts | Mean short P&L |",
            "|---|---:|---:|:---:|---:|",
        ]
    )
    for row in rows:
        lines.append(
            f"| {row['dividend_basis']} | {_money(row['dividend_dollars_per_net_point'])} | {row['quote_impact_bps']} bps | {'yes' if row['weekly_shorts'] else 'no'} | {_money(row['mean_short_pnl_dollars'])} |"
        )
    lines.extend(
        [
            "",
            "The JSON reports entries, closes, qualifying games, random-entry EV, win rate, maximum loss, forced closes, and the exact inverse-long symmetry check. No short fee or penalty was assumed.",
            "",
            "## User P&L",
            "",
            "P&L starts at zero and is independently reconstructed from position exposure, settled dividends, and lifecycle fees before comparison with the integer-dollar append-only ledger. It excludes mark-to-market roster value.",
            "",
            "| Basis | $/NP | Impact | Shorts | Mean user P&L | Cross-seed SD | Reconciled |",
            "|---|---:|---:|:---:|---:|---:|:---:|",
        ]
    )
    for row in rows:
        lines.append(
            f"| {row['dividend_basis']} | {_money(row['dividend_dollars_per_net_point'])} | {row['quote_impact_bps']} bps | {'yes' if row['weekly_shorts'] else 'no'} | {_money(row['mean_user_pnl_dollars'])} | {_money(row['cross_seed_user_pnl_stdev_dollars'])} | {'yes' if row['all_ledgers_reconciled'] else 'NO'} |"
        )
    lines.extend(
        [
            "",
            "The old surprise dividend is near zero-mean; charging a positive projection-sized game cost on top of it therefore creates strongly negative expected long P&L. That is a model consequence to resolve with Russell, not a hidden recommendation from this report.",
            "",
        ]
    )
    return "\n".join(lines)


def write_reports(report: dict[str, object], output_dir: Path) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "per-game-economy-v2.json"
    markdown_path = output_dir / "per-game-economy-v2.md"
    json_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    markdown_path.write_text(render_markdown(report), encoding="utf-8")
    return json_path, markdown_path


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=Path("data/raw/2025-26"))
    parser.add_argument("--dnt-dir", type=Path, default=Path("data/raw/dnt"))
    parser.add_argument("--output-dir", type=Path, default=Path("output"))
    parser.add_argument("--universe-size", type=int, default=DEFAULT_UNIVERSE_SIZE)
    parser.add_argument("--seeds", type=int, nargs="+", default=list(DEFAULT_SEEDS))
    args = parser.parse_args(argv)

    games = load_historical_games(args.data_dir, args.dnt_dir)
    report = run_evaluation(
        games,
        hashes=input_hashes(args.data_dir, args.dnt_dir),
        matrix=EvaluationMatrix(
            seeds=tuple(args.seeds),
            universe_size=args.universe_size,
        ),
    )
    json_path, markdown_path = write_reports(report, args.output_dir)
    print(
        f"wrote {json_path} and {markdown_path}: "
        f"{report['policies']['scenario_count']} scenarios, "  # type: ignore[index]
        f"{report['settled']} settled, {report['unsettled']} unsettled"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
