"""Exploratory opening-anchor residuals on a common, prior-defined population.

Existing constants are historical candidates, not independently preregistered
parameters. Evaluate the projection known for the player's first recorded game,
never a mean of the following week's forecasts. No game rules or rates are set.
"""
from __future__ import annotations

import math
import statistics
import sys
from collections import defaultdict
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
    ("Superstar", 20.0, None), ("Star", 14.0, 20.0),
    ("Starter", 9.0, 14.0), ("Rotation", 5.0, 9.0), ("Bench", None, 5.0),
)
FORMULAS = ("last", "last+0.75", "last*1.08", "proj", "blend", "blend+0.4")


def fmean(values):
    return statistics.fmean(values) if values else math.nan


def load(label, data_dir, dnt_dir):
    games = load_historical_games(data_dir, dnt_dir)
    if not games:
        raise ValueError(f"no player-game inputs for {label}")
    series = defaultdict(list)
    all_series = defaultdict(list)
    for game in sorted(games, key=lambda g: (g.game_date, g.game_id, g.player_id)):
        all_series[game.player_id].append(game.actual_net_points)
        series[game.player_id].append((game.game_date, game.actual_net_points, game.saved_projection_net_points))
    return series, all_series


def first_game_projection(series):
    if not series:
        return None
    first_day = min(day for day, _, _ in series)
    available = [p for day, _, p in series if day == first_day and p is not None]
    if not available:
        return None
    if any(not math.isfinite(value) for value in available):
        raise ValueError("opening projection must be finite")
    if len(set(available)) != 1:
        raise ValueError("conflicting first-game projections")
    return available[0]


def prior_pair_choices(histories):
    """Illustrate formula selection from earlier completed pairs only."""
    choices = []
    pooled = defaultdict(list)
    for current in histories:
        available = {name: values for name, values in pooled.items() if values}
        choices.append(min(available, key=lambda name: (abs(fmean(available[name])), name)) if available else None)
        for name, values in current.items():
            pooled[name].extend(values)
    return choices


def main() -> int:
    loaded = [(label, *load(label, data_dir, dnt_dir)) for label, data_dir, dnt_dir in SEASONS]
    if len(loaded) < 2:
        raise ValueError("opening-anchor comparison requires at least two seasons")
    lines = ["# Exploratory opening-anchor residuals (gross NP per observed game)", "",
             "Candidate constants were proposed from historical exploration, not a sealed holdout. No winner, uplift, rate or live-price rule is approved here. Fees, floors, portfolio constraints and market impact are absent.", "",
             "Before each season, the pool is the prior season's top 150 by appearances with at least 20 games. A player enters on their first recorded game only when that game's saved projection exists; the following week's projections are never used. All formulas use the same eligible player-games. Projection cache dates are assumed pregame and do not independently prove original publication time.", ""]
    tier_names = [name for name, _, _ in TIERS]
    all_pooled = defaultdict(list)
    pair_histories = []
    pair_names = []
    for (prior_label, _, prior_all), (current_label, current_series, _) in zip(loaded, loaded[1:]):
        candidates = sorted((pid for pid, values in prior_all.items() if len(values) >= 20),
                            key=lambda pid: (-len(prior_all[pid]), pid))[:UNIVERSE_SIZE]
        drift = {formula: defaultdict(list) for formula in FORMULAS}
        pooled = {formula: [] for formula in FORMULAS}
        covered = 0
        missing_current = 0
        missing_projection = 0
        for pid in candidates:
            series = current_series.get(pid, [])
            if not series:
                missing_current += 1
                continue
            projection = first_game_projection(series)
            if projection is None:
                missing_projection += 1
                continue
            last = fmean(prior_all[pid])
            tier = next(name for name, low, high in TIERS
                        if (low is None or last >= low) and (high is None or last < high))
            anchors = {"last": last, "last+0.75": last+.75, "last*1.08": last*1.08,
                       "proj": projection, "blend": .5*(last+projection), "blend+0.4": .5*(last+projection)+.4}
            covered += 1
            for _, actual, _ in series:
                for formula, anchor in anchors.items():
                    residual = actual-anchor
                    drift[formula][tier].append(residual)
                    pooled[formula].append(residual)
        if not covered:
            raise ValueError(f"no common first-game projection coverage for {prior_label}->{current_label}; cannot compare candidates")
        pair_names.append(f"{prior_label} -> {current_label}")
        pair_histories.append(pooled)
        lines += [f"## {prior_label} -> {current_label}", "",
                  f"Prior-defined pool {len(candidates)}; common covered players {covered}; no current games {missing_current}; no first-game projection {missing_projection}. Tiers use prior-season means. Common observed player-games {len(pooled['last']):,}.", "",
                  "| Formula | " + " | ".join(tier_names) + " | Pooled | at $20K | Worst observed tier |",
                  "|---|" + "---:|"*(len(tier_names)+3)]
        for formula in FORMULAS:
            cells = [f"{fmean(drift[formula][tier]):+.2f}" if drift[formula][tier] else "not observed" for tier in tier_names]
            observed = [fmean(values) for values in drift[formula].values() if values]
            worst = max(observed, key=abs)
            mean = fmean(pooled[formula])
            all_pooled[formula].extend(pooled[formula])
            lines.append(f"| {formula} | " + " | ".join(cells) + f" | {mean:+.3f} | ${mean*RATE:+,.0f} | {worst:+.2f} |")
        lines.append("")
    lines += ["## Combined observed player-games (weighted by observation count)", "",
              "| Formula | Player-games | Mean gross residual | at $20K/game |", "|---|---:|---:|---:|"]
    for formula in FORMULAS:
        mean = fmean(all_pooled[formula])
        lines.append(f"| {formula} | {len(all_pooled[formula]):,} | {mean:+.3f} | ${mean*RATE:+,.0f} |")
    lines += ["", "## Earlier-pair selection illustration", "",
              "Selection minimizes absolute pooled drift on completed earlier pairs only. The current pair never selects its own formula. Because the candidate set itself was historically explored, this is not independent validation.", "",
              "| Evaluated pair | Formula chosen from earlier pairs | Current-pair residual |", "|---|---|---:|"]
    for pair, values, choice in zip(pair_names, pair_histories, prior_pair_choices(pair_histories)):
        lines.append(f"| {pair} | " + ("calibration only | not evaluated |" if choice is None else f"{choice} | {fmean(values[choice]):+.3f} |"))
    lines.append("")
    output = Path("output/per-game-opening-anchor.md")
    output.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
