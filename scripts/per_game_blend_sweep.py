"""Blend dial: old NetPoints vs margin-fit box weights.

NP_blend(alpha) = alpha * old_NetPoints + (1 - alpha) * margin_fit_box.

Report same-game team association, odd/even repeatability, observed player means,
and ranking in a retrospective cohort. None alone identifies individual causal
impact, a score zero point, next-game predictability, or a dollar conversion rate.
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
    "fta": _ENGINE.fta, "ftm": _ENGINE.ftm, "minutes": _ENGINE.minutes,
}
ALPHAS = (1.0, 0.75, 0.5, 0.25, 0.0)
UNIVERSE_SIZE = 150


def fmean(v):
    return statistics.fmean(v) if v else float("nan")


def pstdev(v):
    return statistics.pstdev(v) if len(v) > 1 else float("nan")


def corr(a, b):
    if len(a) != len(b) or len(a) < 2:
        raise ValueError("correlation needs equally sized samples with at least two values")
    ma, mb = fmean(a), fmean(b)
    cov = fmean([(x - ma) * (y - mb) for x, y in zip(a, b)])
    denominator = pstdev(a) * pstdev(b)
    return cov / denominator if denominator else math.nan


def association_diagnostics(scores, margins):
    r = corr(scores, margins)
    variance = pstdev(scores) ** 2
    mean_score, mean_margin = fmean(scores), fmean(margins)
    covariance = fmean([(s-mean_score)*(m-mean_margin) for s,m in zip(scores,margins)])
    return {"r": r, "slope": covariance / variance if variance else math.nan,
            "rmse": math.sqrt(fmean([(s-m)**2 for s,m in zip(scores,margins)]))}


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
        "# Blend diagnostics: alpha * engine NP + (1 - alpha) * uncentered margin fit (2025-26)",
        "",
        "Final same-game box scores are inputs, not pregame predictions. The top-150 player cohort uses final-season appearance counts; it is descriptive, not an implementable selection rule. The margin component omits the fitted team intercept and does not identify a player-score baseline.",
        "",
        "| alpha | Team-margin r | Unscaled team-diff RMSE | Margin-on-score slope | Odd/even mean r | Players with mean <=0 | Sample top 5 |",
        "|---|---:|---:|---:|---:|---:|---|",
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
        association = association_diagnostics(diffs, margins)

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
            f"| {alpha:.2f} | {association['r']:.3f} | {association['rmse']:.3f} | {association['slope']:.3f} | {reliability:.3f} | "
            f"{negatives}/{len(season_means)} | {top5} |"
        )
    lines.append("")
    lines.append(
        "A points-only control has r = 1 and RMSE = 0 by construction: the team difference "
        "of player PTS is the target itself. Positive scaling preserves correlation "
        "while changing dividends; subtracting the same total from both teams also "
        "preserves every margin difference while changing player baselines. These "
        "diagnostics therefore do not validate individual attribution, a rate, or "
        "statistical equivalence. Odd/even season means measure repeatability of "
        "aggregates, not a skill ceiling or next-game forecast accuracy."
    )
    lines.append("")
    out = Path("output/per-game-blend-sweep.md")
    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
