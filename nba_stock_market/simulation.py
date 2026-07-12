from __future__ import annotations

import argparse
import json
import math
import random
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Protocol

from .engine import IMPACT_K, Market, Player, TradeError, TradeSide, User


SAMPLE_PLAYERS = [
    ("wembanyama", "Victor Wembanyama", "star", 58_000_000.0, 68_000_000.0),
    ("jokic", "Nikola Jokic", "star", 68_000_000.0, 65_000_000.0),
    ("shai", "Shai Gilgeous-Alexander", "star", 62_000_000.0, 64_000_000.0),
    ("mobley", "Evan Mobley", "mid", 25_000_000.0, 29_000_000.0),
    ("maxey", "Tyrese Maxey", "mid", 28_000_000.0, 25_000_000.0),
    ("jalen_johnson", "Jalen Johnson", "mid", 21_000_000.0, 24_000_000.0),
    ("pritchard", "Payton Pritchard", "bench", 8_000_000.0, 10_000_000.0),
    ("lively", "Dereck Lively II", "bench", 11_000_000.0, 13_000_000.0),
    ("hield", "Buddy Hield", "bench", 7_000_000.0, 6_000_000.0),
]


@dataclass(frozen=True)
class SimulationConfig:
    seed: int = 1337
    days: int = 60
    traders: int = 48
    trades_per_day: int = 90
    impact_k: float = IMPACT_K
    reversion_rate: float = 0.0
    games_per_day: int = 5
    scenario: str = "balanced"


@dataclass(frozen=True)
class SimulatedGameResult:
    player_id: str
    actual_net_points: float
    expected_net_points: float


GameResultsHook = Callable[[Market, int, random.Random], list[SimulatedGameResult]]


class TraderStrategy(Protocol):
    name: str

    def choose_trade(self, market: Market, user: User, rng: random.Random) -> tuple[str, TradeSide, int] | None:
        ...


def _buy_candidates(market: Market, user: User) -> list[Player]:
    # Leave headroom for a possible anti-flip surcharge. Strategies should
    # model intent, not spam orders the engine can obviously reject.
    cash_buffer = 1.0 + market.fee_pct + 0.10
    return [
        player
        for player in market.players.values()
        if user.shares(player.id) < market.max_shares_per_user_per_player
        and market.total_held_shares(player.id) < player.shares_outstanding
        and user.cash >= player.current_price * cash_buffer
    ]


def _momentum(player: Player, lookback: int = 8) -> float:
    if len(player.price_history) < lookback:
        return 1.0
    return player.price_history[-1] / player.price_history[-lookback]


class ValueTrader:
    name = "value"

    def choose_trade(self, market: Market, user: User, rng: random.Random) -> tuple[str, TradeSide, int] | None:
        held = [
            market.players[player_id]
            for player_id, shares in user.holdings.items()
            if shares > 0
        ]
        overvalued = [
            player
            for player in held
            if (player.fair_value - player.current_price) / player.current_price < -0.05
        ]
        if overvalued:
            player = min(
                overvalued,
                key=lambda p: (p.fair_value - p.current_price) / p.current_price,
            )
            return player.id, TradeSide.SELL, 1
        buyable = _buy_candidates(market, user)
        if buyable:
            player = max(
                buyable,
                key=lambda p: (p.fair_value - p.current_price) / p.current_price,
            )
            if (player.fair_value - player.current_price) / player.current_price > 0.05:
                return player.id, TradeSide.BUY, 1
        return None


class HypeTrader:
    name = "hype"

    def choose_trade(self, market: Market, user: User, rng: random.Random) -> tuple[str, TradeSide, int] | None:
        held = [
            market.players[player_id]
            for player_id, shares in user.holdings.items()
            if shares > 0
        ]
        if held and rng.random() < 0.12:
            return min(held, key=_momentum).id, TradeSide.SELL, 1
        candidates = sorted(_buy_candidates(market, user), key=_momentum, reverse=True)
        if candidates:
            return rng.choice(candidates[: min(3, len(candidates))]).id, TradeSide.BUY, 1
        if held:
            return min(held, key=_momentum).id, TradeSide.SELL, 1
        return None


class PanicSeller:
    name = "panic"

    def choose_trade(self, market: Market, user: User, rng: random.Random) -> tuple[str, TradeSide, int] | None:
        held = [market.players[player_id] for player_id, shares in user.holdings.items() if shares > 0]
        player = min(held, key=lambda p: _momentum(p, 4)) if held else None
        if player is not None and _momentum(player, 4) < 0.99:
            return player.id, TradeSide.SELL, 1
        if held and rng.random() < 0.30:
            return rng.choice(held).id, TradeSide.SELL, 1
        buyable = _buy_candidates(market, user)
        if buyable:
            return rng.choice(buyable).id, TradeSide.BUY, 1
        if held:
            return rng.choice(held).id, TradeSide.SELL, 1
        return None


class NoiseTrader:
    name = "noise"

    def choose_trade(self, market: Market, user: User, rng: random.Random) -> tuple[str, TradeSide, int] | None:
        held = [
            market.players[player_id]
            for player_id, shares in user.holdings.items()
            if shares > 0
        ]
        if held and rng.random() < 0.40:
            return rng.choice(held).id, TradeSide.SELL, 1
        buyable = _buy_candidates(market, user)
        if buyable:
            return rng.choice(buyable).id, TradeSide.BUY, 1
        if held:
            return rng.choice(held).id, TradeSide.SELL, 1
        return None


class BoomBustTrader:
    """Concentrate into one name, then unwind to stress both price directions."""

    name = "boom_bust"

    def __init__(self, switch_day: int, player_id: str = "wembanyama") -> None:
        self.switch_day = switch_day
        self.player_id = player_id

    def choose_trade(self, market: Market, user: User, rng: random.Random) -> tuple[str, TradeSide, int] | None:
        if market.day < self.switch_day:
            if user.shares(self.player_id) == 0:
                return self.player_id, TradeSide.BUY, 1
            return None
        if user.shares(self.player_id) > 0:
            return self.player_id, TradeSide.SELL, 1
        return None


def build_sample_market(
    *,
    impact_k: float = IMPACT_K,
    reversion_rate: float = 0.0,
    trader_count: int = 48,
) -> Market:
    players = [Player(pid, name, tier, price, fair_value) for pid, name, tier, price, fair_value in SAMPLE_PLAYERS]
    users = [User(f"trader_{idx:03d}") for idx in range(trader_count)]
    return Market(players, users, impact_k=impact_k, reversion_rate=reversion_rate)


def _strategies_for_scenario(config: SimulationConfig) -> list[TraderStrategy]:
    if config.scenario == "balanced":
        return [ValueTrader(), HypeTrader(), PanicSeller(), NoiseTrader()]
    if config.scenario == "hype":
        return [HypeTrader(), HypeTrader(), HypeTrader(), NoiseTrader()]
    if config.scenario == "boom_bust":
        return [BoomBustTrader(max(1, config.days // 2))]
    raise ValueError(f"unknown simulation scenario: {config.scenario}")


def _max_drawdown(values: list[float]) -> float:
    peak = values[0]
    max_drawdown = 0.0
    for value in values:
        peak = max(peak, value)
        max_drawdown = max(max_drawdown, (peak - value) / peak)
    return max_drawdown


def _price_metrics(
    market: Market,
    opening_prices: dict[str, float],
    observed_prices: dict[str, list[float]] | None = None,
) -> dict[str, float]:
    returns: list[float] = []
    daily_moves: list[float] = []
    drawdowns: list[float] = []
    price_multiples: list[float] = []
    minimum_price_ratios: list[float] = []
    for player_id, player in market.players.items():
        opening = opening_prices[player_id]
        daily_history = player.price_history
        full_history = (
            observed_prices[player_id]
            if observed_prices is not None
            else daily_history
        )
        returns.append(abs(player.current_price / opening - 1.0))
        daily_moves.extend(
            abs(current / previous - 1.0)
            for previous, current in zip(daily_history, daily_history[1:])
            if previous > 0
        )
        drawdowns.append(_max_drawdown(full_history))
        price_multiples.append(max(full_history) / opening)
        minimum_price_ratios.append(min(full_history) / opening)
    return {
        "median_abs_return_pct": round(100.0 * statistics.median(returns), 4),
        "max_abs_return_pct": round(100.0 * max(returns), 4),
        "max_drawdown_pct": round(100.0 * max(drawdowns), 4),
        "max_daily_move_pct": round(100.0 * max(daily_moves, default=0.0), 4),
        "max_price_multiple": round(max(price_multiples), 6),
        "minimum_price_ratio": round(min(minimum_price_ratios), 6),
    }


def _market_health(market: Market) -> dict[str, object]:
    prices = [player.current_price for player in market.players.values()]
    cash = [user.cash for user in market.users.values()]
    portfolio_values = [market.portfolio_value(user.id) for user in market.users.values()]
    holdings = [
        shares
        for user in market.users.values()
        for shares in user.holdings.values()
    ]
    ownership = [market.ownership_pct(player_id) for player_id in market.players]
    finite = all(math.isfinite(value) for value in prices + cash + portfolio_values)
    positive_prices = all(value > 0 for value in prices)
    solvent = all(value >= 0 for value in cash)
    holding_cap_ok = all(
        shares <= market.max_shares_per_user_per_player
        for shares in holdings
    )
    float_ok = all(
        market.total_held_shares(player_id) <= player.shares_outstanding
        for player_id, player in market.players.items()
    )
    return {
        "finite_values": finite,
        "positive_prices": positive_prices,
        "non_negative_cash": solvent,
        "holding_cap_respected": holding_cap_ok,
        "float_respected": float_ok,
        "all_invariants_hold": finite and positive_prices and solvent and holding_cap_ok and float_ok,
        "minimum_cash": round(min(cash, default=0.0), 2),
        "minimum_portfolio_value": round(min(portfolio_values, default=0.0), 2),
        "maximum_user_player_holding": max(holdings, default=0),
        "maximum_player_ownership_pct": round(max(ownership, default=0.0), 4),
    }


def _fake_game_results(
    market: Market,
    rng: random.Random,
    games_per_day: int,
) -> list[SimulatedGameResult]:
    if games_per_day <= 0:
        return []
    players = rng.sample(list(market.players.values()), k=min(games_per_day, len(market.players)))
    expected_by_tier = {"star": 20.0, "mid": 12.0, "bench": 6.0}
    return [
        SimulatedGameResult(
            player_id=player.id,
            expected_net_points=expected_by_tier[player.tier],
            actual_net_points=expected_by_tier[player.tier] + rng.gauss(0.0, 5.0),
        )
        for player in players
    ]


def run_simulation(
    config: SimulationConfig,
    *,
    game_results_hook: GameResultsHook | None = None,
) -> dict[str, object]:
    rng = random.Random(config.seed)
    market = build_sample_market(
        impact_k=config.impact_k,
        reversion_rate=config.reversion_rate,
        trader_count=config.traders,
    )
    strategies = _strategies_for_scenario(config)
    strategy_by_user = {
        user.id: strategies[idx % len(strategies)]
        for idx, user in enumerate(market.users.values())
    }
    opening_prices = {player.id: player.current_price for player in market.players.values()}
    observed_prices = {
        player.id: [player.current_price]
        for player in market.players.values()
    }
    starting_wealth = sum(market.portfolio_value(user.id) for user in market.users.values())
    attempted_orders = 0
    rejected_orders = 0
    fees_paid = 0.0
    total_notional = 0.0
    trade_moves: list[float] = []
    rejection_reasons: Counter[str] = Counter()
    strategy_metrics: dict[str, Counter[str]] = defaultdict(Counter)

    daily_dividend_events = 0
    daily_dividend_total_cash_change = 0.0
    for day in range(config.days):
        for _ in range(config.trades_per_day):
            user = rng.choice(list(market.users.values()))
            strategy = strategy_by_user[user.id]
            order = strategy.choose_trade(market, user, rng)
            if order is None:
                continue
            attempted_orders += 1
            strategy_metrics[strategy.name]["attempted"] += 1
            player_id, side, quantity = order
            try:
                position = market.execute_trade(user.id, player_id, side, quantity)
            except TradeError as exc:
                rejected_orders += 1
                rejection_reasons[str(exc)] += 1
                strategy_metrics[strategy.name]["rejected"] += 1
                continue
            strategy_metrics[strategy.name]["executed"] += 1
            fees_paid += position.fee
            total_notional += position.execution_price * position.quantity
            trade_moves.append(abs(position.new_price / position.execution_price - 1.0))
            observed_prices[player_id].append(position.new_price)
        game_results = (
            game_results_hook(market, day, rng)
            if game_results_hook is not None
            else _fake_game_results(market, rng, config.games_per_day)
        )
        for result in game_results:
            event = market.pay_daily_performance_dividend(
                result.player_id,
                actual_net_points=result.actual_net_points,
                expected_net_points=result.expected_net_points,
            )
            daily_dividend_events += 1
            daily_dividend_total_cash_change += event.total_cash_change
        market.advance_day()
        for player in market.players.values():
            observed_prices[player.id].append(player.current_price)

    prices = list(market.players.values())
    avg_abs_gap = sum(abs(player.fair_value - player.current_price) for player in prices) / len(prices)
    total_trades = len(market.trade_log)
    ending_wealth = sum(market.portfolio_value(user.id) for user in market.users.values())
    ending_cash = sum(user.cash for user in market.users.values())
    base_fees = total_notional * market.fee_pct
    flip_surcharges = max(0.0, fees_paid - base_fees)
    trader_count = len(market.users)
    leaderboard = sorted(
        ((user.id, market.portfolio_value(user.id)) for user in market.users.values()),
        key=lambda item: item[1],
        reverse=True,
    )[:5]
    return {
        "config": config.__dict__,
        "total_trades": total_trades,
        "order_metrics": {
            "attempted": attempted_orders,
            "executed": total_trades,
            "rejected": rejected_orders,
            "execution_rate": round(total_trades / attempted_orders, 6) if attempted_orders else 0.0,
            "total_notional": round(total_notional, 2),
            "fees_paid": round(fees_paid, 2),
            "median_trade_move_pct": round(
                100.0 * statistics.median(trade_moves), 6
            ) if trade_moves else 0.0,
            "rejection_reasons": dict(sorted(rejection_reasons.items())),
        },
        "strategy_metrics": {
            name: dict(sorted(counts.items()))
            for name, counts in sorted(strategy_metrics.items())
        },
        "daily_dividend_events": daily_dividend_events,
        "daily_dividend_total_cash_change": round(daily_dividend_total_cash_change, 2),
        "economy_metrics": {
            "starting_wealth": round(starting_wealth, 2),
            "ending_wealth": round(ending_wealth, 2),
            "ending_cash": round(ending_cash, 2),
            "ending_holdings_value": round(ending_wealth - ending_cash, 2),
            "wealth_change": round(ending_wealth - starting_wealth, 2),
            "wealth_change_pct": round(
                100.0 * (ending_wealth / starting_wealth - 1.0), 4
            ) if starting_wealth else 0.0,
            "fees_paid_per_trader": round(fees_paid / trader_count, 2) if trader_count else 0.0,
            "base_fees_paid": round(base_fees, 2),
            "flip_surcharges_paid": round(flip_surcharges, 2),
            "notional_per_trader": round(total_notional / trader_count, 2) if trader_count else 0.0,
        },
        "avg_abs_gap_to_fair_value": round(avg_abs_gap, 2),
        "price_metrics": _price_metrics(market, opening_prices, observed_prices),
        "market_health": _market_health(market),
        "players": market.snapshot(),
        "leaderboard_top_5": [(user_id, round(value, 2)) for user_id, value in leaderboard],
    }


def _candidate_summary(impact_k: float, runs: list[dict[str, object]]) -> dict[str, object]:
    price_metrics = [run["price_metrics"] for run in runs]
    order_metrics = [run["order_metrics"] for run in runs]
    economy_metrics = [run["economy_metrics"] for run in runs]
    all_safe = all(run["market_health"]["all_invariants_hold"] for run in runs)
    has_trade_evidence = all(
        row["attempted"] > 0 and row["executed"] > 0
        for row in order_metrics
    )
    summary = {
        "impact_k": impact_k,
        "all_invariants_hold": all_safe,
        "has_trade_evidence": has_trade_evidence,
        "median_trade_move_pct": round(
            statistics.median(row["median_trade_move_pct"] for row in order_metrics), 4
        ),
        "median_abs_return_pct": round(
            statistics.median(row["median_abs_return_pct"] for row in price_metrics), 4
        ),
        "worst_max_drawdown_pct": round(max(row["max_drawdown_pct"] for row in price_metrics), 4),
        "worst_max_daily_move_pct": round(max(row["max_daily_move_pct"] for row in price_metrics), 4),
        "worst_max_price_multiple": round(max(row["max_price_multiple"] for row in price_metrics), 4),
        "minimum_execution_rate": round(min(row["execution_rate"] for row in order_metrics), 4),
        "worst_wealth_loss_pct": round(
            max(max(0.0, -row["wealth_change_pct"]) for row in economy_metrics), 4
        ),
    }
    safe = (
        all_safe
        and has_trade_evidence
        and summary["worst_max_drawdown_pct"] <= 50.0
        and summary["worst_max_daily_move_pct"] <= 10.0
        and summary["worst_max_price_multiple"] <= 2.0
    )
    # Prefer a visible but not twitchy median trade response around 0.5%, then
    # penalize markets that barely move over the full test window.
    responsiveness_penalty = abs(summary["median_trade_move_pct"] - 0.5)
    if summary["median_abs_return_pct"] < 3.0:
        responsiveness_penalty += (3.0 - summary["median_abs_return_pct"]) * 0.1
    summary["passes_safety_gate"] = safe
    summary["selection_penalty"] = round(responsiveness_penalty, 6) if safe else None
    return summary


def run_impact_sweep(
    *,
    candidates: tuple[float, ...] = (0.0003, 0.001, 0.003, 0.01, 0.03),
    seeds: tuple[int, ...] = (7, 42, 1337),
    days: int = 45,
    traders: int = 48,
    trades_per_day: int = 90,
) -> dict[str, object]:
    if not candidates:
        raise ValueError("impact sweep requires at least one candidate")
    if not seeds:
        raise ValueError("impact sweep requires at least one seed")
    for name, value in (
        ("days", days),
        ("traders", traders),
        ("trades_per_day", trades_per_day),
    ):
        if type(value) is not int or value <= 0:
            raise ValueError(f"{name} must be positive")
    if any(
        isinstance(candidate, bool)
        or not math.isfinite(float(candidate))
        or candidate <= 0
        for candidate in candidates
    ):
        raise ValueError("impact candidates must be finite and positive")
    scenarios = ("balanced", "hype", "boom_bust")
    full_runs: list[dict[str, object]] = []
    compact_runs: list[dict[str, object]] = []
    for impact_k in candidates:
        for seed in seeds:
            for scenario in scenarios:
                result = run_simulation(
                    SimulationConfig(
                        seed=seed,
                        days=days,
                        traders=traders,
                        trades_per_day=trades_per_day,
                        games_per_day=0,
                        impact_k=impact_k,
                        reversion_rate=0.0,
                        scenario=scenario,
                    )
                )
                full_runs.append(result)
                compact_runs.append(
                    {
                        "impact_k": impact_k,
                        "seed": seed,
                        "scenario": scenario,
                        "reversion_rate": 0.0,
                        "all_invariants_hold": result["market_health"]["all_invariants_hold"],
                        "order_metrics": result["order_metrics"],
                        "price_metrics": result["price_metrics"],
                        "economy_metrics": result["economy_metrics"],
                        "market_health": result["market_health"],
                    }
                )
    candidate_summaries = [
        _candidate_summary(
            impact_k,
            [run for run in full_runs if run["config"]["impact_k"] == impact_k],
        )
        for impact_k in candidates
    ]
    safe = [row for row in candidate_summaries if row["passes_safety_gate"]]
    if not safe:
        raise ValueError("no impact candidate passed the safety gate")
    recommendation = min(
        safe,
        key=lambda row: (
            row["selection_penalty"] is None,
            row["selection_penalty"] if row["selection_penalty"] is not None else float("inf"),
            row["impact_k"],
        ),
    )
    recommended_runs = [
        row for row in compact_runs if row["impact_k"] == recommendation["impact_k"]
    ]
    ready_for_production = (
        recommendation["passes_safety_gate"]
        and max(
            max(0.0, -row["economy_metrics"]["wealth_change_pct"])
            for row in recommended_runs
        ) <= 25.0
    )
    return {
        "method": {
            "days": days,
            "traders": traders,
            "trades_per_day": trades_per_day,
            "seeds": list(seeds),
            "scenarios": list(scenarios),
            "fair_value_reversion": 0.0,
            "safety_gate": {
                "max_drawdown_pct": 50.0,
                "max_daily_move_pct": 10.0,
                "max_price_multiple": 2.0,
            },
            "target_median_trade_move_pct": 0.5,
        },
        "recommended_impact_k": recommendation["impact_k"],
        "ready_for_production": ready_for_production,
        "candidate_summaries": candidate_summaries,
        "runs": compact_runs,
    }


def render_impact_report(sweep: dict[str, object]) -> str:
    recommended = sweep["recommended_impact_k"]
    method = sweep["method"]
    recommended_runs = [row for row in sweep["runs"] if row["impact_k"] == recommended]
    worst_economy_run = min(
        recommended_runs,
        key=lambda row: row["economy_metrics"]["wealth_change_pct"],
    )
    worst_economy = worst_economy_run["economy_metrics"]
    total_fees = worst_economy["base_fees_paid"] + worst_economy["flip_surcharges_paid"]
    flip_fee_share = (
        100.0 * worst_economy["flip_surcharges_paid"] / total_fees
        if total_fees else 0.0
    )
    lines = [
        "# Trader Simulation: Price-Impact Calibration",
        "",
        f"**Recommended `IMPACT_K`: `{recommended}` (provisional).**",
        "",
        "**Production readiness: "
        + ("READY for the next gate." if sweep["ready_for_production"] else "NOT READY; price behavior passes, but the fee economy does not.")
        + "**",
        "",
        "This sweep isolates market mechanics: game dividends are disabled and fair-value reversion remains off. "
        "Prices move only through buys, sells, and inactivity decay.",
        "",
        "## Method",
        "",
        f"- {method['days']} simulated days, {method['traders']} traders, and {method['trades_per_day']} order opportunities per day.",
        f"- Fixed seeds: {', '.join(str(seed) for seed in method['seeds'])}.",
        "- Scenarios: balanced strategies, hype-heavy buying, and a concentrated boom/bust unwind.",
        "- Safety gates: no invariant failures, no >50% drawdown, no >10% one-day move, and no >2x price spike.",
        "- Among safe candidates, choose the median per-trade move closest to 0.5%; penalize a market that moves <3% over the test window.",
        "",
        "## Candidate results",
        "",
        "| IMPACT_K | Price-safe | Median trade move | Median window move | Worst drawdown | Worst daily move | Worst price multiple | Worst wealth loss | Min execution |",
        "|---:|:---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for row in sweep["candidate_summaries"]:
        lines.append(
            f"| {row['impact_k']} | {'yes' if row['passes_safety_gate'] else 'no'} | "
            f"{row['median_trade_move_pct']:.3f}% | {row['median_abs_return_pct']:.2f}% | "
            f"{row['worst_max_drawdown_pct']:.2f}% | {row['worst_max_daily_move_pct']:.2f}% | "
            f"{row['worst_max_price_multiple']:.3f}x | {row['worst_wealth_loss_pct']:.2f}% | "
            f"{100 * row['minimum_execution_rate']:.1f}% |"
        )
    lines.extend(
        [
            "",
            "## Scenario checks for the recommendation",
            "",
            "| Scenario | Seed | Executed / attempted | End-window median move | Max drawdown | Max daily move | Wealth change | Fees / trader | Invariants |",
            "|---|---:|---:|---:|---:|---:|---:|---:|:---:|",
        ]
    )
    for row in sweep["runs"]:
        if row["impact_k"] != recommended:
            continue
        orders = row["order_metrics"]
        prices = row["price_metrics"]
        economy = row["economy_metrics"]
        lines.append(
            f"| {row['scenario']} | {row['seed']} | {orders['executed']} / {orders['attempted']} | "
            f"{prices['median_abs_return_pct']:.2f}% | {prices['max_drawdown_pct']:.2f}% | "
            f"{prices['max_daily_move_pct']:.2f}% | {economy['wealth_change_pct']:.2f}% | "
            f"${economy['fees_paid_per_trader']:,.0f} | {'pass' if row['all_invariants_hold'] else 'FAIL'} |"
        )
    lines.extend(
        [
            "",
            "## Economy finding",
            "",
            "The stress run also checks whether the existing 1% trade fee and escalating same-player flip penalty "
            "drain user wealth at the simulated turnover rate. A price-safe `IMPACT_K` does not make the full economy "
            "production-ready if the worst scenario destroys more than 25% of starting wealth. Treat that as a "
            "separate fee/turnover calibration task; do not raise `IMPACT_K` to compensate for cash sinks.",
            "",
            f"At the recommended setting, the worst run was `{worst_economy_run['scenario']}` / seed "
            f"`{worst_economy_run['seed']}`: wealth changed {worst_economy['wealth_change_pct']:.2f}% and "
            f"{flip_fee_share:.1f}% of charged fees came from flip surcharges.",
            "",
            "## Decision",
            "",
            f"Use `{recommended}` for the next interactive prototype. It is the safe candidate closest to the "
            "0.5% median per-trade responsiveness target under these synthetic order flows.",
            "",
            "This is not a production calibration. Re-run the sweep against observed order-size, turnover, and "
            "concentration distributions once real users trade; the simulator intentionally makes no claim that its "
            "mock trader mix predicts demand.",
            "",
        ]
    )
    return "\n".join(lines)


def run_strategy_comparison(seed: int = 1337, days: int = 45) -> dict[str, object]:
    """Backward-compatible experimental comparison; not used by the NBA-9 CLI."""

    pure_crowd = run_simulation(
        SimulationConfig(seed=seed, days=days, reversion_rate=0.0)
    )
    crowd_plus_gravity = run_simulation(
        SimulationConfig(seed=seed, days=days, reversion_rate=0.03)
    )
    high_gravity = run_simulation(
        SimulationConfig(seed=seed, days=days, reversion_rate=0.12)
    )
    return {
        "pure_crowd": pure_crowd,
        "crowd_plus_gravity": crowd_plus_gravity,
        "high_gravity": high_gravity,
        "summary": {
            "pure_gap": pure_crowd["avg_abs_gap_to_fair_value"],
            "gravity_gap": crowd_plus_gravity["avg_abs_gap_to_fair_value"],
            "high_gravity_gap": high_gravity["avg_abs_gap_to_fair_value"],
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Calibrate NBA stock-market trade price impact.")
    parser.add_argument("--seeds", type=int, nargs="+", default=[7, 42, 1337])
    parser.add_argument("--days", type=int, default=45)
    parser.add_argument("--candidates", type=float, nargs="+", default=[0.0003, 0.001, 0.003, 0.01, 0.03])
    parser.add_argument("--traders", type=int, default=48)
    parser.add_argument("--trades-per-day", type=int, default=90)
    parser.add_argument("--output", type=Path, help="JSON evidence output path")
    parser.add_argument("--report", type=Path, help="Markdown report output path")
    args = parser.parse_args()

    result = run_impact_sweep(
        candidates=tuple(args.candidates),
        seeds=tuple(args.seeds),
        days=args.days,
        traders=args.traders,
        trades_per_day=args.trades_per_day,
    )
    encoded = json.dumps(result, indent=2, sort_keys=True)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + "\n")
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(render_impact_report(result))
    if not args.output and not args.report:
        print(encoded)


if __name__ == "__main__":
    main()
