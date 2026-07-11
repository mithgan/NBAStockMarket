from __future__ import annotations

import argparse
import json
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Protocol

from .engine import Market, Player, TradeError, TradeSide, User


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
    reversion_rate: float = 0.0
    games_per_day: int = 5


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


class ValueTrader:
    name = "value"

    def choose_trade(self, market: Market, user: User, rng: random.Random) -> tuple[str, TradeSide, int] | None:
        player = max(market.players.values(), key=lambda p: (p.fair_value - p.current_price) / p.current_price)
        edge = (player.fair_value - player.current_price) / player.current_price
        if edge > 0.05:
            return player.id, TradeSide.BUY, 1
        if edge < -0.05 and user.shares(player.id) > 0:
            return player.id, TradeSide.SELL, 1
        return None


class HypeTrader:
    name = "hype"

    def choose_trade(self, market: Market, user: User, rng: random.Random) -> tuple[str, TradeSide, int] | None:
        candidates = sorted(
            market.players.values(),
            key=lambda p: (p.price_history[-1] / p.price_history[-8] if len(p.price_history) >= 8 else 1.0),
            reverse=True,
        )
        player = rng.choice(candidates[:3])
        return player.id, TradeSide.BUY, 1


class PanicSeller:
    name = "panic"

    def choose_trade(self, market: Market, user: User, rng: random.Random) -> tuple[str, TradeSide, int] | None:
        held = [market.players[player_id] for player_id, shares in user.holdings.items() if shares > 0]
        if not held:
            player = rng.choice(list(market.players.values()))
            return player.id, TradeSide.BUY, 1
        player = min(held, key=lambda p: p.price_history[-1] / p.price_history[-4] if len(p.price_history) >= 4 else 1.0)
        if len(player.price_history) >= 4 and player.price_history[-1] < player.price_history[-4] * 0.99:
            return player.id, TradeSide.SELL, 1
        return rng.choice(held).id, TradeSide.BUY, 1


class NoiseTrader:
    name = "noise"

    def choose_trade(self, market: Market, user: User, rng: random.Random) -> tuple[str, TradeSide, int] | None:
        player = rng.choice(list(market.players.values()))
        if user.shares(player.id) > 0 and rng.random() < 0.35:
            return player.id, TradeSide.SELL, 1
        return player.id, TradeSide.BUY, 1


def build_sample_market(*, reversion_rate: float = 0.0, trader_count: int = 48) -> Market:
    players = [Player(pid, name, tier, price, fair_value) for pid, name, tier, price, fair_value in SAMPLE_PLAYERS]
    users = [User(f"trader_{idx:03d}") for idx in range(trader_count)]
    return Market(players, users, reversion_rate=reversion_rate)


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
    market = build_sample_market(reversion_rate=config.reversion_rate, trader_count=config.traders)
    strategies: list[TraderStrategy] = [ValueTrader(), HypeTrader(), PanicSeller(), NoiseTrader()]
    strategy_by_user = {
        user.id: strategies[idx % len(strategies)]
        for idx, user in enumerate(market.users.values())
    }

    daily_dividend_events = 0
    daily_dividend_total_cash_change = 0.0
    for day in range(config.days):
        for _ in range(config.trades_per_day):
            user = rng.choice(list(market.users.values()))
            strategy = strategy_by_user[user.id]
            order = strategy.choose_trade(market, user, rng)
            if order is None:
                continue
            player_id, side, quantity = order
            try:
                market.execute_trade(user.id, player_id, side, quantity)
            except TradeError:
                continue
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

    prices = list(market.players.values())
    avg_abs_gap = sum(abs(player.fair_value - player.current_price) for player in prices) / len(prices)
    total_trades = len(market.trade_log)
    leaderboard = sorted(
        ((user.id, market.portfolio_value(user.id)) for user in market.users.values()),
        key=lambda item: item[1],
        reverse=True,
    )[:5]
    return {
        "config": config.__dict__,
        "total_trades": total_trades,
        "daily_dividend_events": daily_dividend_events,
        "daily_dividend_total_cash_change": round(daily_dividend_total_cash_change, 2),
        "avg_abs_gap_to_fair_value": round(avg_abs_gap, 2),
        "players": market.snapshot(),
        "leaderboard_top_5": [(user_id, round(value, 2)) for user_id, value in leaderboard],
    }


def run_strategy_comparison(seed: int = 1337, days: int = 45) -> dict[str, object]:
    pure_crowd = run_simulation(SimulationConfig(seed=seed, days=days, reversion_rate=0.0))
    crowd_plus_gravity = run_simulation(SimulationConfig(seed=seed, days=days, reversion_rate=0.03))
    high_gravity = run_simulation(SimulationConfig(seed=seed, days=days, reversion_rate=0.12))
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
    parser = argparse.ArgumentParser(description="Run the NBA stock-market pricing simulation.")
    parser.add_argument("--seed", type=int, default=1337)
    parser.add_argument("--days", type=int, default=45)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    result = run_strategy_comparison(seed=args.seed, days=args.days)
    encoded = json.dumps(result, indent=2, sort_keys=True)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + "\n")
    print(encoded)


if __name__ == "__main__":
    main()
