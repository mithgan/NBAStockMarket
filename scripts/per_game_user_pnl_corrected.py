"""Corrected normal-user P&L: archetype replay with last-season-value locks.

Same archetypes as the rate study's test C, but opening-week locks use the
stable prior anchor (season mean excluding October, the stand-in for "last
season's value per game" that the lock-drift test measured at ~0.00 pooled
drift) instead of the October-inflated trailing-10. Mid-season adds still lock
at trailing-10 (that is what the live market will quote). Reports daily and
weekly P&L in NP and dollars at $15K/$20K/$25K.
"""
from __future__ import annotations

import math
import random
import statistics
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, ".")
from nba_stock_market.per_game_simulation import load_historical_games

UNIVERSE_SIZE = 150
TRAILING_WINDOW = 10
TRAILING_MIN = 3
SLOTS = 10
SEEDS = tuple(range(1, 11))
RATES = (15_000, 20_000, 25_000)


def fmean(v):
    return statistics.fmean(v) if v else float("nan")


def pstdev(v):
    return statistics.pstdev(v) if len(v) > 1 else float("nan")


def pct(values, q):
    if not values:
        return float("nan")
    ordered = sorted(values)
    pos = q * (len(ordered) - 1)
    lo = int(math.floor(pos))
    hi = min(lo + 1, len(ordered) - 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (pos - lo)


def main() -> int:
    games = load_historical_games(Path("data/raw/2025-26"), Path("data/raw/dnt"))
    counts: dict[str, int] = defaultdict(int)
    for g in games:
        if g.saved_projection_net_points is not None:
            counts[g.player_id] += 1
    universe = {p for p, _ in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:UNIVERSE_SIZE]}

    series: dict[str, list[tuple[date, float, float | None]]] = defaultdict(list)
    for g in sorted(games, key=lambda g: (g.game_date, g.game_id, g.player_id)):
        if g.player_id in universe:
            series[g.player_id].append((g.game_date, g.actual_net_points, g.saved_projection_net_points))
    by_date: dict[date, list[tuple[str, float, float | None]]] = defaultdict(list)
    for pid, s in series.items():
        for d, a, p in s:
            by_date[d].append((pid, a, p))
    dates = sorted(by_date)

    prior_anchor = {
        pid: fmean([a for d, a, _ in s if d.month != 10])
        for pid, s in series.items()
        if len([a for d, a, _ in s if d.month != 10]) >= 20
    }

    def trailing_anchor(pid: str, day: date) -> float | None:
        prior = [a for d, a, _ in series[pid] if d < day]
        if len(prior) >= TRAILING_MIN:
            return fmean(prior[-TRAILING_WINDOW:])
        projs = [p for d, _, p in series[pid] if d <= day and p is not None]
        return projs[0] if projs else None

    def lock_anchor(pid: str, day: date, opening: bool) -> float | None:
        if opening and pid in prior_anchor:
            return prior_anchor[pid]
        return trailing_anchor(pid, day)

    early = dates[:14]
    early_proj: dict[str, list[float]] = defaultdict(list)
    for day in early:
        for pid, _, p in by_date[day]:
            if p is not None:
                early_proj[pid].append(p)
    ranked = sorted(early_proj, key=lambda pid: -fmean(early_proj[pid]))
    rosters = {
        "star holder": set(ranked[:SLOTS]),
        "balanced holder": set(ranked[len(ranked) // 2 - 5:len(ranked) // 2 + 5]),
        "bench holder": set(ranked[-SLOTS - 10:-10]),
    }

    def replay_fixed(roster: set[str]) -> list[float]:
        locks = {}
        lock_day = dates[10]
        for pid in roster:
            anchor = lock_anchor(pid, lock_day, opening=True)
            if anchor is not None:
                locks[pid] = anchor
        daily = []
        for day in dates:
            if day < lock_day:
                daily.append(0.0)
                continue
            daily.append(sum(a - locks[pid] for pid, a, _ in by_date[day] if pid in locks))
        return daily

    def replay_weekly_random(seed: int) -> list[float]:
        rng = random.Random(seed)
        locks: dict[str, float] = {}
        week = None
        daily = []
        for index, day in enumerate(dates):
            if index >= 10:
                wk = day.isocalendar()[:2]
                if wk != week:
                    week = wk
                    pool = sorted(pid for pid in universe if trailing_anchor(pid, day) is not None)
                    rng.shuffle(pool)
                    opening = index == 10
                    locks = {}
                    for pid in pool[:SLOTS]:
                        anchor = lock_anchor(pid, day, opening=opening)
                        if anchor is not None:
                            locks[pid] = anchor
            daily.append(sum(a - locks[pid] for pid, a, _ in by_date[day] if pid in locks))
        return daily

    results: dict[str, list[float]] = {k: replay_fixed(r) for k, r in rosters.items()}
    random_runs = [replay_weekly_random(seed) for seed in SEEDS]

    lines = ["# Corrected normal-user P&L (last-season opening locks)", ""]
    lines.append("| Archetype | Season NP | Daily SD (NP) | Weekly SD (NP) | Night p95 | Week p95 |")
    lines.append("|---|---:|---:|---:|---:|---:|")

    def weekly_totals(daily: list[float]) -> list[float]:
        acc: dict[tuple[int, int], float] = defaultdict(float)
        for day, v in zip(dates, daily):
            acc[day.isocalendar()[:2]] += v
        return list(acc.values())

    summary: dict[str, tuple[float, float, float]] = {}
    for label, daily in results.items():
        active = [v for v in daily if v != 0.0]
        weeks = weekly_totals(daily)
        summary[label] = (sum(daily), pstdev(active), pstdev(weeks))
        lines.append(
            f"| {label} | {sum(daily):+.0f} | {pstdev(active):.1f} | {pstdev(weeks):.1f} "
            f"| {pct([abs(v) for v in active], 0.95):.1f} | {pct([abs(v) for v in weeks], 0.95):.1f} |"
        )
    rand_totals = [sum(r) for r in random_runs]
    rand_daily = [v for r in random_runs for v in r if v != 0.0]
    rand_weeks = [w for r in random_runs for w in weekly_totals(r)]
    lines.append(
        f"| weekly random (10 seeds) | {fmean(rand_totals):+.0f} (SD {pstdev(rand_totals):.0f}) "
        f"| {pstdev(rand_daily):.1f} | {pstdev(rand_weeks):.1f} "
        f"| {pct([abs(v) for v in rand_daily], 0.95):.1f} | {pct([abs(v) for v in rand_weeks], 0.95):.1f} |"
    )
    lines.append("")
    lines.append("Dollar view, balanced holder (the 'normal user'):")
    lines.append("")
    lines.append("| Rate | Typical night (±1 SD) | Big night (p95) | Typical week (±1 SD) | Big week (p95) | Season luck band (random ±2 SD) |")
    lines.append("|---|---:|---:|---:|---:|---:|")
    _, day_sd, week_sd = summary["balanced holder"]
    night95 = pct([abs(v) for v in results["balanced holder"] if v != 0.0], 0.95)
    week95 = pct([abs(v) for v in weekly_totals(results["balanced holder"])], 0.95)
    for rate in RATES:
        lines.append(
            f"| ${rate/1000:.0f}K | ±${day_sd*rate:,.0f} | ±${night95*rate:,.0f} "
            f"| ±${week_sd*rate:,.0f} | ±${week95*rate:,.0f} "
            f"| ±${2*pstdev(rand_totals)*rate:,.0f} |"
        )
    lines.append("")
    out = Path("output/per-game-user-pnl-corrected.md")
    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
