"""Held-cost repricing head-to-head: locked forever vs weekly capped repricing.

Ryan's proposal: update each held position's cost weekly toward the market
quote, capped at a % per week, visible before games start. Test against the
current rule (cost locked at signing for the life of the position).

Regimes:
  LOCKED   cost never changes after signing (current v2 rule)
  CAP5     weekly: cost <- clamp(quote, cost*0.95, cost*1.05)
  CAP10    weekly: +/-10% cap
  CAP25    weekly: +/-25% cap
  FULL     weekly: cost <- quote (no cap)

Market quote = trailing-10 produced NP (weekly requote, the recommended rule);
signing cost = quote at signing. Season 2025-26, top-150 universe, $20K/NP.

Archetypes:
  scout       weekly: top-10 by (trailing-3 minus trailing-10) - rides improvers
              signed while the quote still reflects the old form
  star hold   fixed top-10 by early projections, signed day 15, never dropped
  balanced    fixed mid-tier 10, same
  random x10  weekly random rosters (10 seeds)

Reported per regime: season P&L per archetype, aggregate holder leak
(mean actual - cost per held game), and the scout's captured premium.
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
TRAIL = 10
TRAIL_MIN = 3
SLOTS = 10
RATE = 20_000
SIGN_FEE_DOLLARS = 10_000
FLOOR_DOLLARS = 25_000
SIGN_FEE_NP = SIGN_FEE_DOLLARS / RATE
FLOOR_NP = FLOOR_DOLLARS / RATE
SEEDS = tuple(range(1, 11))
REGIMES = {"LOCKED": None, "CAP5": 0.05, "CAP10": 0.10, "CAP25": 0.25, "FULL": math.inf}


def fmean(v):
    return statistics.fmean(v) if v else float("nan")


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
    by_date: dict[date, list[tuple[str, float]]] = defaultdict(list)
    for pid, s in series.items():
        for d, a, _ in s:
            by_date[d].append((pid, a))
    dates = sorted(by_date)

    played_before: dict[str, list[tuple[date, float]]] = {
        pid: [(d, a) for d, a, _ in s] for pid, s in series.items()
    }

    def quote_at(pid: str, day: date) -> float | None:
        prior = [a for d, a in played_before[pid] if d < day]
        if len(prior) >= TRAIL_MIN:
            return max(fmean(prior[-TRAIL:]), FLOOR_NP)
        projs = [p for d, _, p in series[pid] if d <= day and p is not None]
        return max(projs[0], FLOOR_NP) if projs else None

    def improver_score(pid: str, day: date) -> float | None:
        prior = [a for d, a in played_before[pid] if d < day]
        if len(prior) < 6:
            return None
        return fmean(prior[-3:]) - fmean(prior[-TRAIL:])

    early: dict[str, list[float]] = defaultdict(list)
    for day in dates[:14]:
        for pid, a in by_date[day]:
            projs = [p for d, _, p in series[pid] if d == day and p is not None]
            if projs:
                early[pid].append(projs[0])
    ranked_early = sorted(early, key=lambda pid: -fmean(early[pid]))
    mid = len(ranked_early) // 2
    fixed_rosters = {
        "star hold": ranked_early[:SLOTS],
        "balanced": ranked_early[mid - 5:mid + 5],
    }

    def run(regime_cap: float | None, pick_fn, seed: int | None = None) -> tuple[float, int, float, int]:
        """Returns (season P&L in NP, held games, sum(actual-cost), reprice count)."""
        rng = random.Random(seed) if seed is not None else None
        positions: dict[str, float] = {}
        week = None
        pnl = 0.0
        held_games = 0
        repriced = 0
        for index, day in enumerate(dates):
            wk = day.isocalendar()[:2]
            new_week = wk != week
            if new_week and week is not None and regime_cap is not None:
                for pid in list(positions):
                    quote = quote_at(pid, day)
                    if quote is None:
                        continue
                    cost = positions[pid]
                    if regime_cap is math.inf:
                        new_cost = quote
                    else:
                        low = cost - abs(cost) * regime_cap
                        high = cost + abs(cost) * regime_cap
                        new_cost = min(max(quote, low), high)
                    new_cost = max(new_cost, FLOOR_NP)
                    if new_cost != cost:
                        repriced += 1
                    positions[pid] = new_cost
            if index >= 10 and new_week:
                want = pick_fn(day, set(positions), rng)
                if want is not None:
                    for pid in list(positions):
                        if pid not in want:
                            del positions[pid]
                    for pid in want:
                        if pid not in positions:
                            quote = quote_at(pid, day)
                            if quote is not None:
                                positions[pid] = quote
                                pnl -= SIGN_FEE_NP
            week = wk
            for pid, actual in by_date[day]:
                if pid in positions:
                    pnl += actual - positions[pid]
                    held_games += 1
        return pnl, held_games, pnl, repriced

    def pick_fixed(roster):
        state = {"done": False}
        def fn(day, current, rng):
            if state["done"]:
                return None
            state["done"] = True
            return set(roster)
        return fn

    def pick_scout(day, current, rng):
        scored = []
        for pid in universe:
            s = improver_score(pid, day)
            if s is not None:
                scored.append((s, pid))
        scored.sort(key=lambda t: (-t[0], t[1]))
        return {pid for _, pid in scored[:SLOTS]}

    def pick_random(day, current, rng):
        pool = sorted(pid for pid in universe if quote_at(pid, day) is not None)
        rng.shuffle(pool)
        return set(pool[:SLOTS])

    lines = [
        "# Held-cost repricing: locked vs weekly capped (2025-26, $20K/NP)",
        "",
        "Market quote = trailing-10 with weekly requote; signing cost = quote at signing.",
        "Every add pays the $10K signing fee; quotes, signing costs, and repriced costs",
        "respect the $25K minimum price. Repricing happens at the week boundary before",
        "any of that week's games settle.",
        "",
        "| Regime | Scout (improver-chaser) | Star hold | Balanced hold | Random x10 mean | Holder leak $/held game |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for regime, cap in REGIMES.items():
        row = [regime]
        leak_num = 0.0
        leak_den = 0
        scout_pnl, hg, _, _ = run(cap, pick_scout)
        leak_num += scout_pnl; leak_den += hg
        row.append(f"${scout_pnl*RATE:+,.0f}")
        for name, roster in fixed_rosters.items():
            p, hg2, _, _ = run(cap, pick_fixed(roster))
            leak_num += p; leak_den += hg2
            row.append(f"${p*RATE:+,.0f}")
        rand_totals = []
        for seed in SEEDS:
            p, hg3, _, _ = run(cap, pick_random, seed)
            rand_totals.append(p)
            leak_num += p; leak_den += hg3
        row.append(f"${fmean(rand_totals)*RATE:+,.0f}")
        row.append(f"${leak_num/leak_den*RATE:+,.0f}")
        lines.append("| " + " | ".join(row) + " |")
    lines.append("")
    lines.append(
        "Scout = signs improvers while the trailing-10 quote still reflects old form; "
        "its edge under LOCKED is the permanent-annuity effect, and each cap level "
        "shows how much of that discovery premium survives."
    )
    lines.append("")
    out = Path("output/per-game-repricing-test.md")
    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
