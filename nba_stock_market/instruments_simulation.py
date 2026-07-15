"""Replay 2025-26 with mock traders who can short and long.

Instruments simulated on top of Engine v2 (docs/shorts-and-longs-proposal.md):

- 3 weekly-short slots: Mon-Sun dividend mirrors, per-game surprise capped at
  +/-25 NP, weekly aggregate capped at +/-50 NP, $2M reserve, $2K arming fee.
- 1 season price short: no proceeds at open, 30% collateral, auto-close at
  +30% adverse, 0.05%/day borrow fee, decay paused while shorted.
- 2 boost slots: one-game 2x dividend on an owned player, 0.25% price fee.

Expectations are the cached Dunks & Threes pregame projections (Option B
canonical source); actuals are the ESPN player game logs. Deterministic seed.
"""

from __future__ import annotations

import argparse
import math
import random
import statistics
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

from nba_stock_market.backtest import (
    GameRecord,
    load_salary_by_name,
    select_universe,
)
from nba_stock_market.engine import (
    INACTIVITY_DECAY_RATE as INACTIVITY_DECAY_DEFAULT,
    Market,
    Player,
    TradeError,
    TradeSide,
    User,
)
from nba_stock_market.expectations import DunksAndThreesExpectation
from nba_stock_market.historical_data import load_game_records


WEEKLY_SHORT_SLOTS = 3
WEEKLY_GAME_CAP_NP = 25.0
WEEKLY_AGGREGATE_CAP_NP = 50.0
WEEKLY_SHORT_RESERVE = 2_000_000.0
WEEKLY_SHORT_FEE = 2_000.0
PRICE_SHORT_COLLATERAL_PCT = 0.30
PRICE_SHORT_AUTO_CLOSE = 1.30
PRICE_SHORT_BORROW_FEE_DAILY = 0.0005
PRICE_SHORT_TAKE_PROFIT = 0.85
BOOST_SLOTS = 2
BOOST_FEE_PCT = 0.0025
DOLLARS_PER_NP = 40_000.0

ARCHETYPE_COUNTS = {
    "holder": 8,
    "booster": 8,
    "fader": 10,
    "random_short": 10,
    "price_shorter": 8,
    "momentum": 8,
    "noise": 8,
}


@dataclass
class WeeklyShort:
    user_id: str
    player_id: str
    week: str
    accumulated_np: float = 0.0
    games: int = 0


@dataclass
class PriceShort:
    user_id: str
    player_id: str
    open_price: float
    open_day: int
    closed: bool = False
    close_price: float = 0.0
    auto_closed: bool = False


@dataclass
class Ledger:
    dividends: float = 0.0
    boosts: float = 0.0
    weekly_shorts: float = 0.0
    price_shorts: float = 0.0
    fees: float = 0.0
    weekly_short_results: list[float] = field(default_factory=list)


def week_key(game_date: date) -> str:
    iso = game_date.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def build_market(
    data_dir: Path, universe_size: int = 150, *, decay: bool = False
) -> tuple[Market, list, dict]:
    games = load_game_records(data_dir / "player_game_logs.csv")
    salaries = load_salary_by_name(
        [data_dir / "salaries.csv", data_dir / "salaries-fallback.csv"]
    )
    universe = select_universe(games, salaries, size=universe_size)
    players = [
        Player(entry.player_id, entry.name, entry.tier, entry.salary, entry.salary)
        for entry in universe
    ]
    total = sum(ARCHETYPE_COUNTS.values())
    users = [User(f"trader_{index:03d}") for index in range(total)]
    market = Market(
        players,
        users,
        expectation_source=None,
        inactivity_decay_rate=INACTIVITY_DECAY_DEFAULT if decay else 0.0,
    )
    universe_ids = {entry.player_id for entry in universe}
    game_rows = [game for game in games if game.player_id in universe_ids]
    by_tier: dict[str, list] = defaultdict(list)
    for entry in universe:
        by_tier[entry.tier].append(entry)
    return market, game_rows, by_tier


def assign_archetypes(market: Market) -> dict[str, str]:
    assignment: dict[str, str] = {}
    user_ids = sorted(market.users)
    index = 0
    for archetype, count in ARCHETYPE_COUNTS.items():
        for _ in range(count):
            assignment[user_ids[index]] = archetype
            index += 1
    return assignment


def draft_rosters(market: Market, by_tier: dict, rng: random.Random) -> None:
    """Every trader drafts ~10 players under the bankroll: 2 stars, 4 mid, 4 bench."""

    plan = (("star", 2), ("mid", 4), ("bench", 4))
    for user_id in sorted(market.users):
        for tier, want in plan:
            candidates = by_tier.get(tier, [])[:]
            rng.shuffle(candidates)
            bought = 0
            for entry in candidates:
                if bought >= want:
                    break
                user = market.users[user_id]
                price = market.players[entry.player_id].current_price
                if user.cash < price * (1 + market.fee_pct) + 8_000_000:
                    continue
                try:
                    market.execute_trade(user_id, entry.player_id, TradeSide.BUY, 1)
                    bought += 1
                except TradeError:
                    continue


def surprise_last_week(
    weekly_np: dict[str, dict[str, float]], week: str, player_id: str
) -> float:
    return weekly_np.get(week, {}).get(player_id, 0.0)


def run_simulation(
    data_dir: Path, dnt_dir: Path, seed: int = 2027, *, decay: bool = False
) -> dict:
    rng = random.Random(seed)
    market, game_rows, by_tier = build_market(data_dir, decay=decay)
    archetype_of = assign_archetypes(market)
    ledgers: dict[str, Ledger] = {uid: Ledger() for uid in market.users}
    expectation = DunksAndThreesExpectation(cache_dir=dnt_dir)
    draft_rosters(market, by_tier, rng)
    start_wealth = {uid: market.portfolio_value(uid) for uid in market.users}

    games_by_date: dict[date, list[GameRecord]] = defaultdict(list)
    for row in game_rows:
        games_by_date[row.game_date].append(row)
    calendar = sorted(games_by_date)
    season_weeks = sorted({week_key(day) for day in calendar})
    days_of_week: dict[str, list[date]] = defaultdict(list)
    for day in calendar:
        days_of_week[week_key(day)].append(day)

    weekly_np: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    open_weeklies: list[WeeklyShort] = []
    open_price_shorts: dict[str, PriceShort] = {}
    closed_price_shorts: list[PriceShort] = []
    boosts_today: dict[tuple[str, str], str] = {}
    listing = {pid: market.players[pid].opening_price for pid in market.players}
    projection_cover = [0, 0]

    def arm_weekly_shorts(week: str, prev_week: str | None) -> None:
        for uid, kind in archetype_of.items():
            if kind not in ("fader", "random_short"):
                continue
            user = market.users[uid]
            if kind == "fader" and prev_week:
                pool = sorted(
                    weekly_np[prev_week].items(), key=lambda item: -item[1]
                )
                picks = [pid for pid, _ in pool if user.shares(pid) == 0][:WEEKLY_SHORT_SLOTS]
            else:
                pool = [pid for pid in market.players if user.shares(pid) == 0]
                picks = rng.sample(pool, WEEKLY_SHORT_SLOTS)
            for pid in picks:
                if user.cash < WEEKLY_SHORT_RESERVE + WEEKLY_SHORT_FEE:
                    break
                user.cash -= WEEKLY_SHORT_FEE
                ledgers[uid].fees += WEEKLY_SHORT_FEE
                open_weeklies.append(WeeklyShort(uid, pid, week))

    def settle_weekly_shorts(week: str) -> None:
        for position in [p for p in open_weeklies if p.week == week]:
            capped = max(-WEEKLY_AGGREGATE_CAP_NP, min(WEEKLY_AGGREGATE_CAP_NP, position.accumulated_np))
            pnl = -capped * DOLLARS_PER_NP
            user = market.users[position.user_id]
            if position.games == 0:
                user.cash += WEEKLY_SHORT_FEE
                ledgers[position.user_id].fees -= WEEKLY_SHORT_FEE
            else:
                user.cash += pnl
                ledgers[position.user_id].weekly_shorts += pnl
                ledgers[position.user_id].weekly_short_results.append(pnl)
            open_weeklies.remove(position)

    def maybe_open_price_shorts(week_index: int) -> None:
        if week_index < 3:
            return
        for uid, kind in archetype_of.items():
            if kind != "price_shorter" or uid in open_price_shorts:
                continue
            user = market.users[uid]
            pumped = max(
                (pid for pid in market.players if user.shares(pid) == 0),
                key=lambda pid: market.players[pid].current_price / listing[pid],
            )
            player = market.players[pumped]
            if player.current_price / listing[pumped] < 1.05:
                continue
            collateral = PRICE_SHORT_COLLATERAL_PCT * player.current_price
            if user.cash < collateral:
                continue
            depth = market.liquidity(pumped)
            player.current_price *= math.exp(-market.impact_k / depth)
            player.current_price = max(player.current_price, player.floor)
            open_price_shorts[uid] = PriceShort(uid, pumped, player.current_price, market.day)

    def price_short_daily() -> None:
        for uid, position in list(open_price_shorts.items()):
            player = market.players[position.player_id]
            player.last_trade_day = market.day
            user = market.users[uid]
            borrow = PRICE_SHORT_BORROW_FEE_DAILY * position.open_price
            user.cash -= borrow
            ledgers[uid].fees += borrow
            ratio = player.current_price / position.open_price
            take_profit = ratio <= PRICE_SHORT_TAKE_PROFIT
            stopped = ratio >= PRICE_SHORT_AUTO_CLOSE
            if take_profit or stopped:
                close_price_short(uid, auto=stopped)

    def close_price_short(uid: str, *, auto: bool) -> None:
        position = open_price_shorts.pop(uid)
        player = market.players[position.player_id]
        depth = market.liquidity(position.player_id)
        player.current_price *= math.exp(market.impact_k / depth)
        pnl = position.open_price - player.current_price
        market.users[uid].cash += pnl
        ledgers[uid].price_shorts += pnl
        position.closed = True
        position.close_price = player.current_price
        position.auto_closed = auto
        closed_price_shorts.append(position)

    def arm_boosts(week: str, prev_week: str | None) -> None:
        boosts_today.clear()
        if not prev_week:
            return
        for uid, kind in archetype_of.items():
            if kind != "booster":
                continue
            user = market.users[uid]
            owned = [pid for pid in market.players if user.shares(pid) > 0]
            ranked = sorted(owned, key=lambda pid: -surprise_last_week(weekly_np, prev_week, pid))
            for pid in ranked[:BOOST_SLOTS]:
                fee = BOOST_FEE_PCT * market.players[pid].current_price
                if user.cash < fee:
                    continue
                user.cash -= fee
                ledgers[uid].fees += fee
                boosts_today[(uid, pid)] = week

    def weekly_trading(prev_week: str | None) -> None:
        if not prev_week:
            return
        winners = sorted(weekly_np[prev_week].items(), key=lambda item: -item[1])
        for uid, kind in archetype_of.items():
            user = market.users[uid]
            if kind == "momentum":
                for pid, _ in winners[:5]:
                    price = market.players[pid].current_price
                    if user.shares(pid) == 0 and user.cash > price * 1.01:
                        try:
                            market.execute_trade(uid, pid, TradeSide.BUY, 1)
                            break
                        except TradeError:
                            continue
                losers = [pid for pid, np_sum in weekly_np[prev_week].items() if np_sum < -10]
                for pid in losers:
                    if user.shares(pid) > 0:
                        try:
                            market.execute_trade(uid, pid, TradeSide.SELL, 1)
                            break
                        except TradeError:
                            continue
            elif kind == "noise" and rng.random() < 0.8:
                pid = rng.choice(sorted(market.players))
                try:
                    if user.shares(pid) > 0 and rng.random() < 0.4:
                        market.execute_trade(uid, pid, TradeSide.SELL, 1)
                    elif user.cash > market.players[pid].current_price * 1.01:
                        market.execute_trade(uid, pid, TradeSide.BUY, 1)
                except TradeError:
                    continue

    prev_week: str | None = None
    for week_index, week in enumerate(season_weeks):
        arm_weekly_shorts(week, prev_week)
        arm_boosts(week, prev_week)
        weekly_trading(prev_week)
        maybe_open_price_shorts(week_index)
        for day in days_of_week[week]:
            for row in games_by_date[day]:
                projected = expectation.projected_box_score(
                    market.players[row.player_id], day
                )
                if projected is None:
                    projection_cover[1] += 1
                    continue
                projection_cover[0] += 1
                actual_np = market.net_points_model.score(row.box_score)
                expected_np = market.net_points_model.score(projected)
                event = market.pay_daily_performance_dividend(
                    row.player_id,
                    actual_net_points=actual_np,
                    expected_net_points=expected_np,
                    game_date=day,
                    settlement_key=f"sim-{row.game_id}",
                )
                for uid in market.users:
                    if market.users[uid].shares(row.player_id) > 0:
                        ledgers[uid].dividends += event.dividend_per_share * market.users[
                            uid
                        ].shares(row.player_id)
                    if (uid, row.player_id) in boosts_today:
                        market.users[uid].cash += event.dividend_per_share
                        ledgers[uid].boosts += event.dividend_per_share
                surprise = event.actual_net_points - event.expected_net_points
                surprise = max(-WEEKLY_GAME_CAP_NP, min(WEEKLY_GAME_CAP_NP, surprise))
                weekly_np[week][row.player_id] += surprise
                for position in open_weeklies:
                    if position.week == week and position.player_id == row.player_id:
                        position.accumulated_np += surprise
                        position.games += 1
            price_short_daily()
            market.advance_day()
        settle_weekly_shorts(week)
        prev_week = week

    for uid in list(open_price_shorts):
        close_price_short(uid, auto=False)

    by_archetype: dict[str, list[float]] = defaultdict(list)
    decomposition: dict[str, Ledger] = {}
    for uid in market.users:
        final = market.portfolio_value(uid)
        by_archetype[archetype_of[uid]].append(final - start_wealth[uid])
        agg = decomposition.setdefault(archetype_of[uid], Ledger())
        led = ledgers[uid]
        agg.dividends += led.dividends
        agg.boosts += led.boosts
        agg.weekly_shorts += led.weekly_shorts
        agg.price_shorts += led.price_shorts
        agg.fees += led.fees
        agg.weekly_short_results.extend(led.weekly_short_results)

    total_start = sum(start_wealth.values())
    total_end = sum(market.portfolio_value(uid) for uid in market.users)
    return {
        "by_archetype": dict(by_archetype),
        "decomposition": decomposition,
        "price_shorts": closed_price_shorts,
        "projection_coverage": tuple(projection_cover),
        "inflation_pct": 100.0 * (total_end - total_start) / total_start,
        "listing": listing,
        "market": market,
    }


def render_report(result: dict) -> str:
    lines = [
        "# Instruments simulation - shorts & longs on the 2025-26 replay",
        "",
        f"Projection coverage: {result['projection_coverage'][0]:,} settled player-games, "
        f"{result['projection_coverage'][1]:,} skipped (no D&T projection).",
        f"Cohort wealth change with all instruments active: "
        f"{result['inflation_pct']:+.2f}%.",
        "",
        "## Outcome by archetype (mean net-worth change per trader)",
        "",
        "| Archetype | n | Mean P/L | Median | Best | Worst |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for archetype, deltas in sorted(
        result["by_archetype"].items(), key=lambda item: -statistics.fmean(item[1])
    ):
        lines.append(
            f"| {archetype} | {len(deltas)} | ${statistics.fmean(deltas):,.0f} "
            f"| ${statistics.median(deltas):,.0f} | ${max(deltas):,.0f} | ${min(deltas):,.0f} |"
        )
    lines += [
        "",
        "## P/L decomposition by archetype (totals)",
        "",
        "| Archetype | Dividends | Weekly shorts | Price shorts | Boosts | Fees |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for archetype, ledger in sorted(result["decomposition"].items()):
        lines.append(
            f"| {archetype} | ${ledger.dividends:,.0f} | ${ledger.weekly_shorts:,.0f} "
            f"| ${ledger.price_shorts:,.0f} | ${ledger.boosts:,.0f} | ${ledger.fees:,.0f} |"
        )
    fader = result["decomposition"].get("fader")
    randoms = result["decomposition"].get("random_short")
    lines += ["", "## Weekly shorts - informed (fade last week's hottest) vs random", ""]
    for label, ledger in (("fader", fader), ("random_short", randoms)):
        results = ledger.weekly_short_results if ledger else []
        if results:
            wins = sum(1 for value in results if value > 0)
            lines.append(
                f"- **{label}**: {len(results)} settled shorts | mean ${statistics.fmean(results):,.0f} "
                f"| median ${statistics.median(results):,.0f} | std ${statistics.pstdev(results):,.0f} "
                f"| win rate {100 * wins / len(results):.1f}%"
            )
    shorts = result["price_shorts"]
    if shorts:
        pnls = [s.open_price - s.close_price for s in shorts]
        autos = sum(1 for s in shorts if s.auto_closed)
        lines += [
            "",
            "## Season price shorts",
            "",
            f"- {len(shorts)} closed | mean P/L ${statistics.fmean(pnls):,.0f} "
            f"| best ${max(pnls):,.0f} | worst ${min(pnls):,.0f} | auto-closed (stop-out): {autos}",
        ]
    market = result["market"]
    listing = result["listing"]
    drifts = sorted(
        ((market.players[pid].current_price / listing[pid], market.players[pid].name) for pid in market.players),
        key=lambda item: -item[0],
    )
    lines += [
        "",
        "## Price sanity",
        "",
        "Top price run-ups vs listing: "
        + ", ".join(f"{name} {ratio:.2f}x" for ratio, name in drifts[:5]),
        "Biggest declines: "
        + ", ".join(f"{name} {ratio:.2f}x" for ratio, name in drifts[-5:]),
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Simulate shorts/longs instruments on 2025-26.")
    parser.add_argument("--data-dir", type=Path, default=Path("data/raw/2025-26"))
    parser.add_argument("--dnt-dir", type=Path, default=Path("data/raw/dnt"))
    parser.add_argument("--seed", type=int, default=2027)
    parser.add_argument("--output", type=Path, default=Path("output/instruments-sim.md"))
    parser.add_argument(
        "--decay",
        action="store_true",
        help="Enable engine inactivity decay (default off: at 60 traders x 150 players "
        "most names never trade, and -0.5%%/day compounds to ~0.5x by April, drowning "
        "instrument effects in mark-to-market losses)",
    )
    args = parser.parse_args()

    result = run_simulation(args.data_dir, args.dnt_dir, seed=args.seed, decay=args.decay)
    report = render_report(result)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(report, encoding="utf-8")
    print(report)


if __name__ == "__main__":
    main()
