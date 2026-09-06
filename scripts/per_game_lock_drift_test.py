"""Lock-anchor drift test: which cost anchor is fair to lock for a season hold?

For every listed player, lock a cost on the 10th game date of the season using
each candidate anchor, then measure mean(actual - locked) over every game the
player plays for the REST of the season. A fair lock anchor shows ~0 drift in
every tier; a biased one silently taxes one kind of holder.

Anchors tested:
  trailing5 / trailing10 / trailing20  - mean of last N produced NP before lock
  gameday_proj                         - saved pregame D&T projection at lock
  blend                                - 0.5*trailing10 + 0.5*gameday_proj
  last_season_proxy                    - full-season mean MINUS October games
                                         (oracle-ish stand-in for a stable prior)
  oracle                               - full-season mean (pure-noise benchmark)

Also reports the same drift when locking at three later checkpoints, because
the product lets users lock any day, not just opening week.
"""
from __future__ import annotations

import statistics
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, ".")
from nba_stock_market.per_game_simulation import load_historical_games

UNIVERSE_SIZE = 150
TIERS = (
    ("Superstar", 20.0, None),
    ("Star", 14.0, 20.0),
    ("Starter", 9.0, 14.0),
    ("Rotation", 5.0, 9.0),
    ("Bench", None, 5.0),
)


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
            series[g.player_id].append(
                (g.game_date, g.actual_net_points, g.saved_projection_net_points)
            )
    all_dates = sorted({d for s in series.values() for d, _, _ in s})
    season_mean = {p: fmean([a for _, a, _ in s]) for p, s in series.items() if len(s) >= 20}

    def tier_of(pid: str) -> str | None:
        m = season_mean.get(pid)
        if m is None:
            return None
        for name, low, high in TIERS:
            if (low is None or m >= low) and (high is None or m < high):
                return name
        return None

    checkpoints = [10, 40, 80, 120]
    lines = ["# Lock-anchor drift test", ""]
    for cp in checkpoints:
        if cp >= len(all_dates):
            continue
        lock_day = all_dates[cp]
        drift: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
        weights: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        for pid, s in series.items():
            tier = tier_of(pid)
            if tier is None:
                continue
            prior = [(d, a, p) for d, a, p in s if d < lock_day]
            future = [a for d, a, _ in s if d >= lock_day]
            if len(prior) < 3 or len(future) < 10:
                continue
            prior_actuals = [a for _, a, _ in prior]
            last_proj = next((p for _, _, p in reversed(prior) if p is not None), None)
            oct_free = [a for d, a, _ in s if d.month != 10]
            anchors = {
                "trailing5": fmean(prior_actuals[-5:]),
                "trailing10": fmean(prior_actuals[-10:]),
                "trailing20": fmean(prior_actuals[-20:]),
                "gameday_proj": last_proj,
                "blend": (
                    0.5 * fmean(prior_actuals[-10:]) + 0.5 * last_proj
                    if last_proj is not None
                    else None
                ),
                "last_season_proxy": fmean(oct_free) if len(oct_free) >= 20 else None,
                "oracle": season_mean[pid],
            }
            future_mean = fmean(future)
            for name, anchor in anchors.items():
                if anchor is None:
                    continue
                drift[name][tier].append(future_mean - anchor)
                weights[name][tier] += len(future)
        lines.append(f"## Lock at game date #{cp + 1} ({lock_day.isoformat()})")
        lines.append("")
        tier_names = [t for t, _, _ in TIERS]
        lines.append("| Anchor | " + " | ".join(tier_names) + " | All (per game, NP) |")
        lines.append("|---|" + "---:|" * (len(tier_names) + 1))
        for name in ("trailing5", "trailing10", "trailing20", "gameday_proj", "blend", "last_season_proxy", "oracle"):
            cells = []
            pooled: list[float] = []
            for tier in tier_names:
                vals = drift[name].get(tier, [])
                cells.append(f"{fmean(vals):+.2f}" if vals else "—")
                pooled.extend(vals)
            lines.append(f"| {name} | " + " | ".join(cells) + f" | {fmean(pooled):+.2f} |")
        lines.append("")

    out = Path("output/per-game-lock-drift.md")
    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
