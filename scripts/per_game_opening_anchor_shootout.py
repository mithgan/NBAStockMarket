"""Opening-anchor shootout: which formula prices season-openers fairly?

R2 measured that locking at raw prior-season NP/game leaks +0.64/+0.86 NP per
game (league YoY growth + listed-player selection). Candidates tested on both
season pairs, scored by pooled drift and worst per-tier drift of a full-season
hold from opening day:

  last            prior-season produced NP/game (baseline)
  last+0.75       flat uplift equal to the mean measured YoY drift
  last*1.08       proportional uplift
  proj            mean of the player's first-week saved D&T projections
  blend           0.5*last + 0.5*proj
  blend+0.4       blend plus half the flat uplift
"""
from __future__ import annotations

import statistics
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, ".")
from nba_stock_market.per_game_simulation import load_historical_games

SEASONS = (
    ("2023-24", Path("data/raw/2023-24"), Path("data/raw/dnt-2023-24")),
    ("2024-25", Path("data/raw/2024-25"), Path("data/raw/dnt-2024-25")),
    ("2025-26", Path("data/raw/2025-26"), Path("data/raw/dnt")),
)
UNIVERSE_SIZE = 150
RATE = 20_000
TIERS = (
    ("Superstar", 20.0, None),
    ("Star", 14.0, 20.0),
    ("Starter", 9.0, 14.0),
    ("Rotation", 5.0, 9.0),
    ("Bench", None, 5.0),
)


def fmean(v):
    return statistics.fmean(v) if v else float("nan")


def load(label, data_dir, dnt_dir):
    games = load_historical_games(data_dir, dnt_dir)
    counts = defaultdict(int)
    for g in games:
        if g.saved_projection_net_points is not None:
            counts[g.player_id] += 1
    universe = {p for p, _ in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:UNIVERSE_SIZE]}
    series = defaultdict(list)
    all_series = defaultdict(list)
    for g in sorted(games, key=lambda g: (g.game_date, g.game_id, g.player_id)):
        all_series[g.player_id].append(g.actual_net_points)
        if g.player_id in universe:
            series[g.player_id].append((g.game_date, g.actual_net_points, g.saved_projection_net_points))
    return series, all_series


def main() -> int:
    loaded = [(label, *load(label, d, dnt)) for label, d, dnt in SEASONS]
    lines = ["# Opening-anchor shootout (full-season hold drift, NP per game)", ""]
    formulas = ("last", "last+0.75", "last*1.08", "proj", "blend", "blend+0.4")
    tier_names = [t for t, _, _ in TIERS]

    pooled_by_formula: dict[str, list[float]] = defaultdict(list)
    for (p_label, _, prior_all), (c_label, cur_series, _) in zip(loaded, loaded[1:]):
        prior_np = {pid: fmean(v) for pid, v in prior_all.items() if len(v) >= 20}
        season_mean = {pid: fmean([a for _, a, _ in s]) for pid, s in cur_series.items() if len(s) >= 20}

        def tier_of(pid):
            m = season_mean.get(pid)
            if m is None:
                return None
            for name, low, high in TIERS:
                if (low is None or m >= low) and (high is None or m < high):
                    return name
            return None

        drift: dict[str, dict[str, list[float]]] = {f: defaultdict(list) for f in formulas}
        pooled: dict[str, list[float]] = {f: [] for f in formulas}
        covered = 0
        for pid, s in cur_series.items():
            last = prior_np.get(pid)
            tier = tier_of(pid)
            if last is None or tier is None:
                continue
            first_day = s[0][0]
            week1 = [p for d, _, p in s if p is not None and (d - first_day).days <= 7]
            proj = fmean(week1) if week1 else None
            anchors = {
                "last": last,
                "last+0.75": last + 0.75,
                "last*1.08": last * 1.08,
                "proj": proj,
                "blend": 0.5 * last + 0.5 * proj if proj is not None else None,
                "blend+0.4": 0.5 * last + 0.5 * proj + 0.4 if proj is not None else None,
            }
            covered += 1
            for _, actual, _ in s:
                for f, anchor in anchors.items():
                    if anchor is not None:
                        drift[f][tier].append(actual - anchor)
                        pooled[f].append(actual - anchor)
        lines.append(f"## {p_label} → {c_label} ({covered} players)")
        lines.append("")
        lines.append("| Formula | " + " | ".join(tier_names) + " | Pooled | at $20K | worst tier |")
        lines.append("|---|" + "---:|" * (len(tier_names) + 3))
        for f in formulas:
            cells = []
            worst = 0.0
            for t in tier_names:
                vals = drift[f].get(t, [])
                m = fmean(vals) if vals else float("nan")
                cells.append(f"{m:+.2f}" if vals else "—")
                if vals and abs(m) > abs(worst):
                    worst = m
            pooled_mean = fmean(pooled[f])
            pooled_by_formula[f].append(pooled_mean)
            lines.append(
                f"| {f} | " + " | ".join(cells)
                + f" | {pooled_mean:+.3f} | ${pooled_mean*RATE:+,.0f} | {worst:+.2f} |"
            )
        lines.append("")

    lines.append("## Both pairs pooled")
    lines.append("")
    lines.append("| Formula | Mean pooled drift (NP) | at $20K/game |")
    lines.append("|---|---:|---:|")
    for f in formulas:
        m = fmean(pooled_by_formula[f])
        lines.append(f"| {f} | {m:+.3f} | ${m*RATE:+,.0f} |")
    lines.append("")
    out = Path("output/per-game-opening-anchor.md")
    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
