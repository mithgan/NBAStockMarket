"""Replay 2025-26 with mock traders using the PRODUCTION instruments module.

Runs the acceptance tests of docs/shorting-spec.md §9: the season is replayed
through Engine v2 with `InstrumentsBook` (spec fees: 0.25% ad valorem, min
$10K), and the expectation bias is the spec's **rolling 30-day correction with
a seeded cold start** (previous season's October mean when available) fitted
on the listed universe.

Acceptance criteria checked in the report:
  1. random weekly shorting EV ~ -fee (no structural tilt)
  2. fade-the-hottest EV <= 0 net of fees
  3. cohort wealth change inside the -1.5%..+5% band
"""

from __future__ import annotations

import argparse
import random
import statistics
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from nba_stock_market.backtest import (
    GameRecord,
    load_salary_by_name,
    select_universe,
)
from nba_stock_market.bias import rolling_bias_for_date
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
from nba_stock_market.instruments import (
    InstrumentError,
    InstrumentsBook,
    week_of,
)


FALLBACK_COLD_START = 0.35
PRICE_SHORT_TAKE_PROFIT = 0.85

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
class Ledger:
    dividends: float = 0.0
    boosts: float = 0.0
    weekly_shorts: float = 0.0
    price_shorts: float = 0.0
    fees: float = 0.0
    weekly_short_net_results: list[float] = field(default_factory=list)


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
        expectation_bias=0.0,
        inactivity_decay_rate=INACTIVITY_DECAY_DEFAULT if decay else 0.0,
    )
    universe_ids = {entry.player_id for entry in universe}
    game_rows = [game for game in games if game.player_id in universe_ids]
    by_tier: dict[str, list] = defaultdict(list)
    for entry in universe:
        by_tier[entry.tier].append(entry)
    return market, game_rows, by_tier


def cold_start_bias(prior_data_dir: Path, prior_dnt_dir: Path) -> float:
    """Previous season's October raw-surprise mean on its listed universe."""

    try:
        games = load_game_records(prior_data_dir / "player_game_logs.csv")
    except OSError:
        return FALLBACK_COLD_START
    if not prior_dnt_dir.exists():
        return FALLBACK_COLD_START
    minutes: defaultdict[str, float] = defaultdict(float)
    for game in games:
        minutes[game.player_id] += game.box_score.minutes
    top150 = set(sorted(minutes, key=lambda pid: -minutes[pid])[:150])
    expectation = DunksAndThreesExpectation(cache_dir=prior_dnt_dir)
    dummy: dict[str, Player] = {}
    surprises = []
    for game in games:
        if game.player_id not in top150 or game.game_date.month != 10:
            continue
        player = dummy.setdefault(
            game.player_name, Player(game.player_id, game.player_name, "mid", 1e6, 1e6)
        )
        try:
            projected = expectation.projected_box_score(player, game.game_date)
        except Exception:
            continue
        if projected is None:
            continue
        from nba_stock_market.engine import NetPointsModel

        model = NetPointsModel()
        surprises.append(model.score(game.box_score) - model.score(projected))
    return statistics.fmean(surprises) if surprises else FALLBACK_COLD_START


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
                if user.cash < price * (1 + market.fee_pct) + 12_000_000:
                    continue
                try:
                    market.execute_trade(user_id, entry.player_id, TradeSide.BUY, 1)
                    bought += 1
                except TradeError:
                    continue


def run_simulation(
    data_dir: Path,
    dnt_dir: Path,
    seed: int = 2027,
    *,
    decay: bool = False,
    prior_data_dir: Path = Path("data/raw/2024-25"),
    prior_dnt_dir: Path = Path("data/raw/dnt-2024-25"),
) -> dict:
    rng = random.Random(seed)
    market, game_rows, by_tier = build_market(data_dir, decay=decay)
    book = InstrumentsBook(market)
    archetype_of = assign_archetypes(market)
    ledgers: dict[str, Ledger] = {uid: Ledger() for uid in market.users}
    expectation = DunksAndThreesExpectation(cache_dir=dnt_dir)
    seed_bias = cold_start_bias(prior_data_dir, prior_dnt_dir)
    draft_rosters(market, by_tier, rng)
    start_wealth = {uid: market.portfolio_value(uid) for uid in market.users}

    games_by_date: dict[date, list[GameRecord]] = defaultdict(list)
    for row in game_rows:
        games_by_date[row.game_date].append(row)
    calendar = sorted(games_by_date)
    season_weeks = sorted({week_of(day) for day in calendar})
    days_of_week: dict[str, list[date]] = defaultdict(list)
    for day in calendar:
        days_of_week[week_of(day)].append(day)
    player_days_in_week: dict[str, dict[str, date]] = defaultdict(dict)
    for day in calendar:
        for row in games_by_date[day]:
            player_days_in_week[week_of(day)].setdefault(row.player_id, day)

    raw_surprises: list[tuple[date, float]] = []
    weekly_np: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    listing = {pid: market.players[pid].opening_price for pid in market.players}
    positions_by_user_week: dict[tuple[str, str], list] = defaultdict(list)
    projection_cover = [0, 0]

    def arm_weekly_shorts(week: str, prev_week: str | None) -> None:
        first_day = days_of_week[week][0]
        for uid, kind in archetype_of.items():
            if kind not in ("fader", "random_short"):
                continue
            if kind == "fader" and prev_week:
                pool = [pid for pid, _ in sorted(weekly_np[prev_week].items(), key=lambda kv: -kv[1])]
            elif kind == "random_short":
                pool = sorted(market.players)
                rng.shuffle(pool)
            else:
                continue
            armed = 0
            for pid in pool:
                if armed >= 3:
                    break
                try:
                    position = book.arm_weekly_short(uid, pid, first_day)
                except InstrumentError:
                    continue
                ledgers[uid].fees += position.fee_paid
                positions_by_user_week[(uid, week)].append(position)
                armed += 1

    def arm_boosts(week: str, prev_week: str | None) -> None:
        if not prev_week:
            return
        for uid, kind in archetype_of.items():
            if kind != "booster":
                continue
            user = market.users[uid]
            owned = [pid for pid in market.players if user.shares(pid) > 0]
            ranked = sorted(owned, key=lambda pid: -weekly_np[prev_week].get(pid, 0.0))
            armed = 0
            for pid in ranked:
                if armed >= 2:
                    break
                target_day = player_days_in_week[week].get(pid)
                if target_day is None:
                    continue
                try:
                    boost = book.arm_boost(uid, pid, target_day)
                except InstrumentError:
                    continue
                ledgers[uid].fees += boost.fee_paid
                armed += 1

    def manage_price_shorts(week_index: int) -> None:
        for uid, kind in archetype_of.items():
            if kind != "price_shorter":
                continue
            open_position = book.price_shorts.get(uid)
            if open_position is not None:
                player = market.players[open_position.player_id]
                if player.current_price <= PRICE_SHORT_TAKE_PROFIT * open_position.open_price:
                    closed = book.close_price_short(uid, reason="take-profit")
                    ledgers[uid].price_shorts += closed.pnl
                continue
            if week_index < 3:
                continue
            user = market.users[uid]
            candidates = sorted(
                (pid for pid in market.players if user.shares(pid) == 0),
                key=lambda pid: -market.players[pid].current_price / listing[pid],
            )
            for pid in candidates[:3]:
                if market.players[pid].current_price / listing[pid] < 1.05:
                    break
                try:
                    book.open_price_short(uid, pid)
                    break
                except InstrumentError:
                    continue

    def weekly_trading(prev_week: str | None) -> None:
        if not prev_week:
            return
        winners = sorted(weekly_np[prev_week].items(), key=lambda kv: -kv[1])
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
                losers = [pid for pid, total in weekly_np[prev_week].items() if total < -10]
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
            book.check_stop_outs()

    prev_week: str | None = None
    for week_index, week in enumerate(season_weeks):
        arm_weekly_shorts(week, prev_week)
        arm_boosts(week, prev_week)
        weekly_trading(prev_week)
        manage_price_shorts(week_index)
        for day in days_of_week[week]:
            correction = rolling_bias_for_date(
                raw_surprises,
                day,
                seed_bias=seed_bias,
            )
            for row in games_by_date[day]:
                player = market.players[row.player_id]
                try:
                    projected = expectation.projected_box_score(player, day)
                except Exception:
                    projected = None
                if projected is None:
                    projection_cover[1] += 1
                    continue
                projection_cover[0] += 1
                actual_np = market.net_points_model.score(row.box_score)
                projected_np = market.net_points_model.score(projected)
                event = market.pay_daily_performance_dividend(
                    row.player_id,
                    actual_net_points=actual_np,
                    expected_net_points=projected_np + correction,
                    game_date=day,
                    settlement_key=f"sim-{row.game_id}",
                )
                for uid in market.users:
                    shares = market.users[uid].shares(row.player_id)
                    if shares > 0:
                        ledgers[uid].dividends += event.dividend_per_share * shares
                surprise = event.actual_net_points - event.expected_net_points
                book.record_game(
                    row.player_id,
                    day,
                    surprise_np=surprise,
                    dividend_per_share=event.dividend_per_share,
                    actual_minutes=row.box_score.minutes,
                    projected_minutes=projected.minutes,
                )
                capped = max(-25.0, min(25.0, surprise))
                weekly_np[week][row.player_id] += capped
                raw_surprises.append((day, actual_np - projected_np))
            for boost in book.expire_boosts(day):
                ledgers[boost.user_id].fees -= boost.fee_paid
            book.daily_pass()
            market.advance_day()
        for position in book.settle_week(week):
            ledger = ledgers[position.user_id]
            if position.voided:
                ledger.fees -= position.fee_paid
            else:
                ledger.weekly_shorts += position.pnl or 0.0
                ledger.weekly_short_net_results.append((position.pnl or 0.0) - position.fee_paid)
        prev_week = week

    for uid in list(book.price_shorts):
        closed = book.close_price_short(uid, reason="season-end")
        ledgers[uid].price_shorts += closed.pnl
    for position in book.closed_price_shorts:
        if position.close_reason in ("stop-out", "insolvency", "take-profit"):
            if position.user_id in ledgers and position.pnl != 0.0:
                pass
    for uid, paid in book.borrow_paid.items():
        ledgers[uid].fees += paid
    for boost in book.boosts:
        if boost.consumed:
            ledgers[boost.user_id].boosts += boost.payout

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
        agg.weekly_short_net_results.extend(led.weekly_short_net_results)

    total_start = sum(start_wealth.values())
    total_end = sum(market.portfolio_value(uid) for uid in market.users)
    return {
        "by_archetype": dict(by_archetype),
        "decomposition": decomposition,
        "price_shorts": list(book.closed_price_shorts),
        "projection_coverage": tuple(projection_cover),
        "inflation_pct": 100.0 * (total_end - total_start) / total_start,
        "seed_bias": seed_bias,
        "listing": listing,
        "market": market,
    }


def render_report(result: dict) -> str:
    lines = [
        "# Instruments simulation - production spec parameters (shorting-spec v1.0)",
        "",
        f"Rolling-30 bias with cold start {result['seed_bias']:+.3f} NP; 0.25% ad-valorem",
        "fees (min $10K); production `InstrumentsBook` mechanics throughout.",
        "",
        f"Projection coverage: {result['projection_coverage'][0]:,} settled player-games, "
        f"{result['projection_coverage'][1]:,} skipped.",
        f"Cohort wealth change: {result['inflation_pct']:+.2f}%.",
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
        "## Weekly shorts - net of fees (acceptance criteria)",
        "",
    ]
    verdicts = []
    for label in ("fader", "random_short"):
        ledger = result["decomposition"].get(label)
        results = ledger.weekly_short_net_results if ledger else []
        if results:
            mean = statistics.fmean(results)
            wins = sum(1 for value in results if value > 0)
            lines.append(
                f"- **{label}**: {len(results)} settled | mean net ${mean:,.0f} "
                f"| median ${statistics.median(results):,.0f} "
                f"| std ${statistics.pstdev(results):,.0f} "
                f"| win rate {100 * wins / len(results):.1f}%"
            )
            verdicts.append((label, mean))
    lines.append("")
    for label, mean in verdicts:
        target = "<= 0" if label == "fader" else "~ -fee"
        status = "PASS" if mean <= 0 else "FAIL"
        lines.append(f"- acceptance ({label} {target}): mean ${mean:,.0f} -> **{status}**")
    band = -1.5 <= result["inflation_pct"] <= 5.0
    lines.append(
        f"- acceptance (inflation in -1.5%..+5%): {result['inflation_pct']:+.2f}% -> "
        f"**{'PASS' if band else 'FAIL'}**"
    )
    shorts = result["price_shorts"]
    if shorts:
        pnls = [s.pnl for s in shorts]
        lines += [
            "",
            "## Price shorts",
            "",
            f"- {len(shorts)} closed | mean P/L ${statistics.fmean(pnls):,.0f} "
            f"| stop-outs {sum(1 for s in shorts if s.close_reason == 'stop-out')} "
            f"| insolvency closes {sum(1 for s in shorts if s.close_reason == 'insolvency')}",
        ]
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Simulate spec-final instruments on 2025-26.")
    parser.add_argument("--data-dir", type=Path, default=Path("data/raw/2025-26"))
    parser.add_argument("--dnt-dir", type=Path, default=Path("data/raw/dnt"))
    parser.add_argument("--seed", type=int, default=2027)
    parser.add_argument("--output", type=Path, default=Path("output/instruments-sim.md"))
    parser.add_argument("--decay", action="store_true")
    args = parser.parse_args()

    result = run_simulation(args.data_dir, args.dnt_dir, seed=args.seed, decay=args.decay)
    report = render_report(result)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(report, encoding="utf-8")
    print(report)


if __name__ == "__main__":
    main()
