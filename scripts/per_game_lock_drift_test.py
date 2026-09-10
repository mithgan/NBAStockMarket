"""Retrospective lock-anchor drift diagnostic with explicit causal/oracle labels.

Causal anchors use only prior games/projections or an actual previous season.
Oracle rows deliberately use future outcomes and are benchmarks, never candidate
opening policies. Tiers use whole-season outcomes only to summarize results.
"""
from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from nba_stock_market.historical_data import load_game_records
from scripts.per_game_rate_study import Study, TIERS, fmean
from scripts.per_game_user_pnl_corrected import previous_season_anchors


def lock_anchors(rows, lock_day, prior_season_mean=None):
    prior = [r for r in rows if r["date"] < lock_day]
    actuals = [r["actual"] for r in prior]
    if len(actuals) < 3:
        return {}
    # This is the latest observed projection, not a same-day projection.
    projection = next((r["proj"] for r in reversed(prior) if r["proj"] is not None), None)
    non_october = [r["actual"] for r in rows if r["date"].month != 10]
    return {
        "trailing5": fmean(actuals[-5:]),
        "trailing10": fmean(actuals[-10:]),
        "trailing20": fmean(actuals[-20:]),
        "latest_prior_projection": projection,
        "blend": (fmean(actuals[-10:]) + projection) / 2 if projection is not None else None,
        "actual_previous_season": prior_season_mean,
        "ORACLE future_non_October": fmean(non_october) if non_october else None,
        "ORACLE whole_season": fmean([r["actual"] for r in rows]),
    }


def weighted_mean(values):
    """Each item is(player mean drift, future game count)."""
    total = sum(count for _, count in values)
    return sum(value * count for value, count in values) / total if total else float("nan")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=Path("data/raw/2025-26"))
    parser.add_argument("--prior-data-dir", type=Path, default=Path("data/raw/2024-25"))
    parser.add_argument("--dnt-dir", type=Path, default=Path("data/raw/dnt"))
    parser.add_argument("--output", type=Path, default=Path("output/per-game-lock-drift.md"))
    args = parser.parse_args(argv)
    study = Study(args.data_dir, args.dnt_dir)
    prior = previous_season_anchors(load_game_records(args.prior_data_dir / "player_game_logs.csv"), study.opening_day)
    if not set(prior) & study.universe:
        raise ValueError("previous-season anchors match none of the observed players")
    all_dates = sorted(study.by_date)
    checkpoints = [study.opening_day] + [all_dates[i] for i in (40, 80, 120) if i < len(all_dates) and all_dates[i] > study.opening_day]
    lines = ["# Lock-anchor drift: causal anchors and explicit oracle benchmarks", "",
             f"Sample: {len(study.universe)} players observed before {study.opening_day}. Tiers are retrospective outcome groups; they do not select opening rosters.",
             "Gross, unfloored NP quote-error diagnostic. Every displayed mean is weighted by actual future game count. No fees, demand impact, short lifecycle or bankroll limits. No rate or anchor recommendation follows from oracle rows.", ""]
    for lock_day in checkpoints:
        drift = defaultdict(lambda: defaultdict(list))
        for pid, rows in study.by_player.items():
            future = [r["actual"] for r in rows if r["date"] >= lock_day]
            if len(future) < 10:
                continue
            mean = study.season_np[pid]
            tier = next(name for name, low, high in TIERS if (low is None or mean >= low) and (high is None or mean < high))
            for name, anchor in lock_anchors(rows, lock_day, prior.get(pid)).items():
                if anchor is not None:
                    drift[name][tier].append((fmean(future) - anchor, len(future)))
        if not drift:
            raise ValueError(f"no eligible lock-drift cohort at {lock_day}")
        lines += [f"## Lock on {lock_day}", "", "| Anchor | " + " | ".join(name for name, _, _ in TIERS) + " | All (per game, NP) | Players | Games |",
                  "|---|" + "---:|" * (len(TIERS) + 3)]
        for name, groups in drift.items():
            pooled = [item for group in groups.values() for item in group]
            cells = [f"{weighted_mean(groups[tier]):+.2f}" if groups[tier] else "—" for tier, _, _ in TIERS]
            lines.append("| " + name + " | " + " | ".join(cells) + f" | {weighted_mean(pooled):+.2f} | {len(pooled)} | {sum(count for _, count in pooled)} |")
        lines.append("")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
