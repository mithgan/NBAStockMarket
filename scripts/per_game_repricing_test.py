"""Conditional, long-only held-cost repricing replay with causal sample selection.

The sample and fixed rosters use only information observed before trading.
Every actual add pays $10K; signing and held costs respect the $25K floor.
This isolates weekly repricing, not the full economy: no demand impact,
short expiry, prior-season anchors, bankroll limits or optimal drop/re-signing.
"""
from __future__ import annotations

import argparse
import sys
import math
import random
import statistics
from dataclasses import dataclass, field
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.per_game_rate_study import Study, SLOTS, TRAILING_WINDOW, fmean

RATE = 20_000
SIGN_FEE_DOLLARS = 10_000
FLOOR_DOLLARS = 25_000
SEEDS = tuple(range(1, 11))
REGIMES = {"LOCKED": None, "CAP5": 0.05, "CAP10": 0.10, "CAP25": 0.25, "FULL": math.inf}


@dataclass
class ReplayResult:
    gross_dollars: float = 0.0
    fees_dollars: float = 0.0
    opens: int = 0
    held_games: int = 0
    repriced: int = 0
    events: list[dict] = field(default_factory=list)

    @property
    def net_dollars(self):
        return self.gross_dollars - self.fees_dollars


def reprice_cost(cost, quote, cap):
    """Only valid positive costs enter the percentage cap."""
    if not all(math.isfinite(value) for value in (cost, quote)) or cost < FLOOR_DOLLARS or quote < FLOOR_DOLLARS:
        raise ValueError("cost and quote must respect the $25K floor")
    if cap is None:
        return cost
    if cap < 0 or math.isnan(cap):
        raise ValueError("cap must be nonnegative")
    return max(FLOOR_DOLLARS, quote if math.isinf(cap) else min(max(quote, cost * (1 - cap)), cost * (1 + cap)))


class RepricingStudy(Study):
    def __init__(self, *args, rate=RATE, **kwargs):
        if rate <= 0 or not math.isfinite(rate):
            raise ValueError("rate must be positive and finite")
        self.rate = rate
        super().__init__(*args, **kwargs)

    def quote_dollars(self, pid, day):
        anchor = self.anchor_on(pid, day)
        return max(FLOOR_DOLLARS, anchor * self.rate) if anchor is not None else None

    def picker(self, kind, seed=None):
        if kind in ("star hold", "balanced", "bench hold"):
            early = {}
            for pid, rows in self.by_player.items():
                projections = [r["proj"] for r in rows if r["date"] < self.opening_day and r["proj"] is not None]
                if projections:
                    early[pid] = fmean(projections)
            ranked = sorted(early, key=lambda pid: (-early[pid], pid))
            mid = len(ranked) // 2
            selected = (ranked[:SLOTS] if kind == "star hold" else
                        ranked[-SLOTS - 10:-10] if kind == "bench hold" and len(ranked) >= SLOTS + 10 else
                        ranked[-SLOTS:] if kind == "bench hold" else
                        ranked[mid - SLOTS // 2:mid + SLOTS // 2])
            roster = set(selected)
            return lambda day, current: roster
        if kind == "random":
            rng = random.Random(seed)
            def pick_random(day, current):
                pool = sorted(pid for pid in self.universe if self.quote_dollars(pid, day) is not None)
                rng.shuffle(pool)
                return set(pool[:SLOTS])
            return pick_random
        if kind != "scout":
            raise ValueError(f"unknown strategy: {kind}")
        def pick_scout(day, current):
            scored = []
            for pid, rows in self.by_player.items():
                prior = [r["actual"] for r in rows if r["date"] < day]
                if len(prior) >= 6:
                    scored.append((fmean(prior[-3:]) - fmean(prior[-TRAILING_WINDOW:]), pid))
            return {pid for _, pid in sorted(scored, key=lambda item: (-item[0], item[1]))[:SLOTS]}
        return pick_scout

    def run(self, cap, pick, *, record_events=False):
        result = ReplayResult()
        positions = {}
        week = None
        for day in self.dates:
            current_week = day.isocalendar()[:2]
            if current_week != week:
                for pid in list(positions):
                    quote = self.quote_dollars(pid, day)
                    if quote is None:
                        continue
                    old = positions[pid]
                    positions[pid] = reprice_cost(old, quote, cap)
                    result.repriced += positions[pid] != old
                    if record_events:
                        result.events.append({"kind": "reprice", "date": day, "pid": pid, "old": old, "cost": positions[pid], "quote": quote})
                want = pick(day, set(positions))
                if want is not None:
                    if len(want) > SLOTS or not set(want) <= self.universe:
                        raise ValueError("policy selected an invalid roster")
                    for pid in list(positions):
                        if pid not in want:
                            del positions[pid]
                    for pid in sorted(want):
                        if pid not in positions:
                            quote = self.quote_dollars(pid, day)
                            if quote is not None:
                                positions[pid] = quote
                                result.opens += 1
                                result.fees_dollars += SIGN_FEE_DOLLARS
                                if record_events:
                                    result.events.append({"kind": "open", "date": day, "pid": pid, "cost": quote, "fee": SIGN_FEE_DOLLARS})
                week = current_week
            for row in self.by_date[day]:
                pid = row["pid"]
                if pid in positions:
                    dividend = row["actual"] * self.rate
                    result.gross_dollars += dividend - positions[pid]
                    result.held_games += 1
                    if record_events:
                        result.events.append({"kind": "game", "date": day, "pid": pid, "cost": positions[pid], "dividend": dividend})
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=Path("data/raw/2025-26"))
    parser.add_argument("--dnt-dir", type=Path, default=Path("data/raw/dnt"))
    parser.add_argument("--output", type=Path, default=Path("output/per-game-repricing-test.md"))
    args = parser.parse_args(argv)
    study = RepricingStudy(args.data_dir, args.dnt_dir)
    lines = ["# Held-cost repricing: conditional long-only replay", "",
             f"Frozen sample: {len(study.universe)} players observed before {study.opening_day}; fixed rosters also use only pre-opening projections.",
             "Quote = trailing 10 prior games (minimum 3), otherwise first observed projection. Every actual add pays $10K; all costs have a $25K floor; rate $20K/NP.",
             "Weekly updates occur before that week's roster changes and games. Gross holder leak excludes fees; net P&L includes fees.",
             "This isolates repricing. It excludes short expiry, demand impact, bankroll limits, prior-season anchors, and strategic drop/re-sign responses. It cannot select a production cap or rate.", "",
             "| Regime | Scout net | Star hold net | Balanced hold net | Random mean net | Gross holder leak/held game |",
             "|---|---:|---:|---:|---:|---:|"]
    runs = {}
    for regime, cap in REGIMES.items():
        fixed = [study.run(cap, study.picker(kind)) for kind in ("scout", "star hold", "balanced")]
        random_runs = [study.run(cap, study.picker("random", seed)) for seed in SEEDS]
        all_runs = fixed + random_runs
        gross = sum(r.gross_dollars for r in all_runs)
        held = sum(r.held_games for r in all_runs)
        values = [r.net_dollars for r in fixed] + [fmean([r.net_dollars for r in random_runs]), gross / held if held else math.nan]
        lines.append("| " + regime + " | " + " | ".join(f"${v:+,.0f}" for v in values) + " |")
        runs[regime] = (fixed, random_runs)
    lines += ["", "## Seed variation and actual opening counts", "",
              "These are descriptive comparisons across ten seeded rosters, not significance tests or proof of player skill.", "",
              "| Regime | Scout minus random mean | Random SD | Random min | Random max | Random seeds beaten by scout | Scout adds | Random mean adds |",
              "|---|---:|---:|---:|---:|---:|---:|---:|"]
    for regime, (fixed, random_runs) in runs.items():
        values = [r.net_dollars for r in random_runs]
        scout = fixed[0]
        lines.append(f"| {regime} | ${scout.net_dollars - fmean(values):+,.0f} | ${statistics.stdev(values):,.0f} | ${min(values):+,.0f} | ${max(values):+,.0f} | {sum(scout.net_dollars > v for v in values)}/{len(values)} | {scout.opens} | {fmean([r.opens for r in random_runs]):.1f} |")
    lines += ["", "Fixed-holder losses are forced-hold scenarios. Positive excess over a random mean on this sample does not validate stable skill or the complete game economy.", ""]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
