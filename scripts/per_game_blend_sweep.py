"""Blend dial: old NetPoints vs margin-fit box weights.

NP_blend(alpha) = alpha * old_NetPoints + (1 - alpha) * margin_fit_box.

For each alpha, measure the four things that decide the dividend basis:
 1. Team-margin correlation (out-of-sample 2025-26): does the metric actually
    capture scoring-margin impact? (Russ's requirement.)
 2. Split-half reliability: can users predict what they pay for? (skill game)
 3. Listed players with <=0 expected value: floor/unholdable problem. (product)
 4. Top-5 players by the metric: ranking sanity check. (product)
"""
from __future__ import annotations

import csv
import math
import statistics
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, ".")

from nba_stock_market.engine import NetPointsCoefficients

MARGIN_WEIGHTS = {
    "pts": 0.877, "fga": -1.438, "fta": -0.681, "oreb": 1.471, "dreb": 1.516,
    "ast": -0.012, "stl": 1.755, "blk": 0.421, "tov": -1.386, "three_pm": 0.017,
}
_ENGINE = NetPointsCoefficients()
# The exact engine weights, mapped to this script's CSV column keys.
OLD_WEIGHTS = {
    "pts": _ENGINE.pts, "oreb": _ENGINE.offensive_rebounds,
    "dreb": _ENGINE.defensive_rebounds, "ast": _ENGINE.ast, "stl": _ENGINE.stl,
    "blk": _ENGINE.blk, "tov": _ENGINE.tov, "fga": _ENGINE.fga,
    "fgm": _ENGINE.fgm, "three_pa": _ENGINE.three_pa, "three_pm": _ENGINE.three_pm,
    "fta": _ENGINE.fta, "ftm": _ENGINE.ftm,
}
ALPHAS = (1.0, 0.75, 0.5, 0.25, 0.0)
UNIVERSE_SIZE = 150


def fmean(v):
    return statistics.fmean(v) if v else float("nan")


def pstdev(v):
    return statistics.pstdev(v) if len(v) > 1 else float("nan")


def corr(a, b):
    ma, mb = fmean(a), fmean(b)
    cov = fmean([(x - ma) * (y - mb) for x, y in zip(a, b)])
    return cov / (pstdev(a) * pstdev(b))


def load(season):
    rows = []
    with Path(f"data/raw/{season}/player_game_logs.csv").open(newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            rows.append({
                "game_id": r["game_id"], "date": date.fromisoformat(r["game_date"]),
                "pid": r["player_id"], "name": r["player_name"], "team": r["team"],
                "pts": float(r["pts"]), "fga": float(r["fga"]), "fta": float(r["fta"]),
                "oreb": float(r["offensive_rebounds"]), "dreb": float(r["defensive_rebounds"]),
                "ast": float(r["ast"]), "stl": float(r["stl"]), "blk": float(r["blk"]),
                "tov": float(r["tov"]), "three_pm": float(r["three_pm"]),
                "three_pa": float(r["three_pa"]), "fgm": float(r["fgm"]),
                "ftm": float(r["ftm"]), "minutes": float(r["minutes"]),
            })
    return rows


def blend_score(row, alpha):
    old = sum(float(row.get(k, 0.0)) * w for k, w in OLD_WEIGHTS.items())
    margin = sum(float(row.get(k, 0.0)) * w for k, w in MARGIN_WEIGHTS.items())
    return alpha * old + (1 - alpha) * margin


def main() -> int:
    rows = load("2025-26")
    counts = defaultdict(int)
    for r in rows:
        counts[str(r["pid"])] += 1
    universe = {p for p, _ in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:UNIVERSE_SIZE]}
    names = {str(r["pid"]): str(r["name"]) for r in rows}

    team_pts: dict[tuple[str, str], float] = defaultdict(float)
    for r in rows:
        team_pts[(str(r["game_id"]), str(r["team"]))] += float(r["pts"])
    teams_by_game = defaultdict(list)
    for gid, team in team_pts:
        teams_by_game[gid].append(team)

    lines = [
        "# Blend dial: alpha*oldNP + (1-alpha)*marginFit (2025-26 out-of-sample)",
        "",
        "| alpha | Team-margin r | Split-half reliability | Players <=0 EV | Top 5 |",
        "|---|---:|---:|---:|---|",
    ]
    for alpha in ALPHAS:
        team_metric: dict[tuple[str, str], float] = defaultdict(float)
        for r in rows:
            team_metric[(str(r["game_id"]), str(r["team"]))] += blend_score(r, alpha)
        diffs, margins = [], []
        for gid, teams in teams_by_game.items():
            if len(teams) != 2:
                continue
            a, b = teams
            diffs.append(team_metric[(gid, a)] - team_metric[(gid, b)])
            margins.append(team_pts[(gid, a)] - team_pts[(gid, b)])
        margin_r = corr(diffs, margins)

        per_player: dict[str, list[float]] = defaultdict(list)
        for r in sorted(rows, key=lambda r: (r["date"], r["game_id"], r["pid"])):
            if r["pid"] in universe:
                per_player[str(r["pid"])].append(blend_score(r, alpha))
        odd, even, season_means = [], [], {}
        for pid, vals in per_player.items():
            if len(vals) >= 20:
                odd.append(fmean(vals[0::2]))
                even.append(fmean(vals[1::2]))
                season_means[pid] = fmean(vals)
        reliability = corr(odd, even)
        negatives = sum(1 for v in season_means.values() if v <= 0)
        top5 = ", ".join(
            names[p] for p, _ in sorted(season_means.items(), key=lambda kv: -kv[1])[:5]
        )
        lines.append(
            f"| {alpha:.2f} | {margin_r:.3f} | {reliability:.3f} | "
            f"{negatives}/{len(season_means)} | {top5} |"
        )
    lines.append("")
    lines.append(
        "alpha=1 is the old formula; alpha=0 is the pure margin fit. Team-margin r "
        "for raw on-court +/- team sums is 1.000 by construction but its per-player "
        "split-half reliability is only 0.678 (see per-game-plusminus-study.md)."
    )
    lines.append("")
    out = Path("output/per-game-blend-sweep.md")
    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
