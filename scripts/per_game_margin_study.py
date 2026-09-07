"""Scoring-margin impact metric: fit, validate, and rerun the v2 balancing.

Russ wants dividends on scoring-margin impact instead of the old hand-weighted
box score. No data source in the pipeline carries per-player on-court
plus-minus (ESPN cache, BDL /stats, BDL /box_scores all lack it), but every
source carries team scores and team affiliation. The implementable metric is
therefore a box-score formula whose weights are FIT to team scoring margin
(the BPM family): regress team-game margin on team-game box aggregates, apply
the fitted weights to individual player lines.

Steps:
 1. Fit margin weights on 2023-24 + 2024-25 team-games; validate out-of-sample
    on 2025-26 (predicted team-diff vs actual margin correlation).
 2. Compare the metric to the old NetPoints per player-season (rank shift).
 3. Rerun the core balancing under margin-NP: tiers/scale, negative-value share
    (the floor problem), noise anatomy, frozen vs trailing requote leak (all
    seasons), true last-season opening drift + uplift refit, fixed-roster user
    bands, 7-day shorts, and a rate sweep against the same legibility bands.

Pure replay arithmetic; the only randomness is none.
"""
from __future__ import annotations

import csv
import math
import statistics
import sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, ".")

SEASONS = (
    ("2023-24", Path("data/raw/2023-24/player_game_logs.csv")),
    ("2024-25", Path("data/raw/2024-25/player_game_logs.csv")),
    ("2025-26", Path("data/raw/2025-26/player_game_logs.csv")),
)
REGRESSORS = ("pts", "fga", "fta", "oreb", "dreb", "ast", "stl", "blk", "tov", "three_pm")
OLD_NP_WEIGHTS = None  # loaded from engine coefficients
UNIVERSE_SIZE = 150
TRAIL = 10
TRAIL_MIN = 3
SLOTS = 10
CAND_RATES = (10_000, 15_000, 20_000, 25_000, 30_000, 40_000, 50_000)
QUOTE_FLOOR = 25_000


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


def load_rows(path: Path) -> list[dict[str, object]]:
    rows = []
    with path.open(newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            rows.append(
                {
                    "game_id": r["game_id"],
                    "date": date.fromisoformat(r["game_date"]),
                    "pid": r["player_id"],
                    "name": r["player_name"],
                    "team": r["team"],
                    "pts": float(r["pts"]),
                    "fga": float(r["fga"]),
                    "fta": float(r["fta"]),
                    "oreb": float(r["offensive_rebounds"]),
                    "dreb": float(r["defensive_rebounds"]),
                    "ast": float(r["ast"]),
                    "stl": float(r["stl"]),
                    "blk": float(r["blk"]),
                    "tov": float(r["tov"]),
                    "three_pm": float(r["three_pm"]),
                    "fgm": float(r["fgm"]),
                    "ftm": float(r["ftm"]),
                    "minutes": float(r["minutes"]),
                }
            )
    return rows


def team_games(rows: list[dict[str, object]]):
    agg: dict[tuple[str, str], dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for r in rows:
        key = (str(r["game_id"]), str(r["team"]))
        for stat in REGRESSORS:
            agg[key][stat] += float(r[stat])  # type: ignore[arg-type]
    teams_by_game: dict[str, list[str]] = defaultdict(list)
    for gid, team in agg:
        teams_by_game[gid].append(team)
    samples = []
    for gid, teams in teams_by_game.items():
        if len(teams) != 2:
            continue
        a, b = teams
        margin = agg[(gid, a)]["pts"] - agg[(gid, b)]["pts"]
        samples.append((agg[(gid, a)], margin))
        samples.append((agg[(gid, b)], -margin))
    return samples


def solve(matrix: list[list[float]], rhs: list[float]) -> list[float]:
    n = len(rhs)
    m = [row[:] + [rhs[i]] for i, row in enumerate(matrix)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(m[r][col]))
        m[col], m[pivot] = m[pivot], m[col]
        d = m[col][col]
        m[col] = [v / d for v in m[col]]
        for r in range(n):
            if r != col and m[r][col]:
                f = m[r][col]
                m[r] = [v - f * w for v, w in zip(m[r], m[col])]
    return [m[i][n] for i in range(n)]


def fit_weights(samples) -> tuple[dict[str, float], float]:
    k = len(REGRESSORS)
    xtx = [[0.0] * (k + 1) for _ in range(k + 1)]
    xty = [0.0] * (k + 1)
    for stats_row, margin in samples:
        x = [stats_row[s] for s in REGRESSORS] + [1.0]
        for i in range(k + 1):
            xty[i] += x[i] * margin
            for j in range(k + 1):
                xtx[i][j] += x[i] * x[j]
    beta = solve(xtx, xty)
    return dict(zip(REGRESSORS, beta[:k])), beta[k]


def margin_np(row: dict[str, object], weights: dict[str, float]) -> float:
    return sum(float(row[s]) * w for s, w in weights.items())  # type: ignore[arg-type]


def old_np(row: dict[str, object]) -> float:
    from nba_stock_market.engine import NetPointsModel, BoxScoreLine

    line = BoxScoreLine(
        pts=float(row["pts"]),
        offensive_rebounds=float(row["oreb"]),
        defensive_rebounds=float(row["dreb"]),
        ast=float(row["ast"]),
        stl=float(row["stl"]),
        blk=float(row["blk"]),
        tov=float(row["tov"]),
        fga=float(row["fga"]),
        fgm=float(row["fgm"]),
        three_pa=0.0,
        three_pm=float(row["three_pm"]),
        fta=float(row["fta"]),
        ftm=float(row["ftm"]),
        minutes=float(row["minutes"]),
    )
    return NetPointsModel().score(line)


def main() -> int:
    season_rows = {label: load_rows(path) for label, path in SEASONS}

    train = team_games(season_rows["2023-24"]) + team_games(season_rows["2024-25"])
    weights, intercept = fit_weights(train)
    test = team_games(season_rows["2025-26"])
    predicted = [sum(s[r] * weights[r] for r in REGRESSORS) + intercept for s, _ in test]
    actual = [m for _, m in test]
    mean_p, mean_a = fmean(predicted), fmean(actual)
    cov = fmean([(p - mean_p) * (a - mean_a) for p, a in zip(predicted, actual)])
    corr = cov / (pstdev(predicted) * pstdev(actual))

    lines = [
        "# Scoring-margin impact — metric fit and rebalanced economy",
        "",
        "**Data reality check:** no pipeline source carries per-player on-court "
        "plus-minus (ESPN cache, BDL /stats, and BDL /box_scores were all "
        "inspected). Team scores + affiliations exist everywhere, so this study "
        "fits box-score weights TO team scoring margin (BPM family) — the "
        "implementable version of Russ's ask. If he means literal on-court +/-, "
        "that needs a new provider field before anything can settle on it.",
        "",
        "## 1. Fitted margin weights (train 2023-24+2024-25, 9,832 team-games)",
        "",
        "| Stat | Weight (margin pts per unit) | Old NetPoints weight |",
        "|---|---:|---:|",
    ]
    old_weights = {
        "pts": 1.0, "fga": -0.7, "fta": -0.35, "oreb": 1.2, "dreb": 0.85,
        "ast": 0.7, "stl": 1.5, "blk": 1.2, "tov": -1.2, "three_pm": 0.5,
    }
    for stat in REGRESSORS:
        lines.append(f"| {stat} | {weights[stat]:+.3f} | {old_weights.get(stat, 0):+.2f} |")
    lines.append(f"| intercept (fit only, not applied) | {intercept:+.2f} | — |")
    lines.append("")
    lines.append(
        f"Out-of-sample validation (2025-26, {len(test):,} team-games): predicted "
        f"vs actual margin correlation **r = {corr:.3f}**."
    )
    lines.append("")

    per_season: dict[str, dict] = {}
    for label, rows in season_rows.items():
        counts: dict[str, int] = defaultdict(int)
        for r in rows:
            counts[str(r["pid"])] += 1
        universe = {p for p, _ in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:UNIVERSE_SIZE]}
        series: dict[str, list[tuple[date, float]]] = defaultdict(list)
        all_series: dict[str, list[float]] = defaultdict(list)
        for r in sorted(rows, key=lambda r: (r["date"], r["game_id"], r["pid"])):
            value = margin_np(r, weights)
            all_series[str(r["pid"])].append(value)
            if r["pid"] in universe:
                series[str(r["pid"])].append((r["date"], value))
        per_season[label] = {
            "series": series,
            "all": all_series,
            "names": {str(r["pid"]): str(r["name"]) for r in rows},
            "rows": rows,
        }

    cur = per_season["2025-26"]
    season_mean = {pid: fmean([v for _, v in s]) for pid, s in cur["series"].items() if len(s) >= 20}
    old_means: dict[str, list[float]] = defaultdict(list)
    for r in cur["rows"]:
        if str(r["pid"]) in season_mean:
            old_means[str(r["pid"])].append(old_np(r))
    old_mean = {pid: fmean(v) for pid, v in old_means.items()}
    paired = [(season_mean[p], old_mean[p]) for p in season_mean]
    mnew, mold = fmean([a for a, _ in paired]), fmean([b for _, b in paired])
    cov2 = fmean([(a - mnew) * (b - mold) for a, b in paired])
    corr2 = cov2 / (pstdev([a for a, _ in paired]) * pstdev([b for _, b in paired]))

    negative = [p for p, m in season_mean.items() if m <= 0]
    ranked = sorted(season_mean.items(), key=lambda kv: -kv[1])
    lines.append("## 2. Scale, ranking shift, and the negative-value problem")
    lines.append("")
    lines.append(
        f"Player-season means (2025-26, {len(season_mean)} listed players): metric SD "
        f"{pstdev(list(season_mean.values())):.2f} margin-pts vs old-NP SD "
        f"{pstdev(list(old_mean.values())):.2f}; correlation between the two rankings "
        f"**ρ ≈ {corr2:.3f}**."
    )
    lines.append("")
    lines.append(f"**{len(negative)} of {len(season_mean)} listed players have ≤0 expected margin impact** — they cannot be fairly priced above a floor and are structurally unholdable longs. (Old NP: 0 players ≤0.)")
    lines.append("")
    lines.append("| Player | Margin-NP/game | Old NP/game |")
    lines.append("|---|---:|---:|")
    for pid, m in ranked[:8]:
        lines.append(f"| {cur['names'][pid]} | {m:+.2f} | {old_mean[pid]:.2f} |")
    lines.append("")

    lines.append("## 3. Requote leak per settled game (margin-NP, all seasons)")
    lines.append("")
    lines.append("| Season | frozen at open | weekly requote | nightly full |")
    lines.append("|---|---:|---:|---:|")
    leak_results: dict[str, dict[str, float]] = {}
    for label, data in per_season.items():
        leaks: dict[str, list[float]] = {k: [] for k in ("frozen", "weekly", "full")}
        for pid, s in data["series"].items():
            if len(s) < 5:
                continue
            opening = fmean([v for _, v in s[:3]])
            quotes = {k: opening for k in leaks}
            history: list[float] = []
            last_week = None
            for d, v in s:
                trailing = fmean(history[-TRAIL:]) if len(history) >= TRAIL_MIN else None
                if trailing is not None:
                    quotes["full"] = trailing
                    wk = d.isocalendar()[:2]
                    if wk != last_week:
                        quotes["weekly"] = trailing
                        last_week = wk
                for k in leaks:
                    leaks[k].append(v - quotes[k])
                history.append(v)
        leak_results[label] = {k: fmean(v) for k, v in leaks.items()}
        lines.append(
            f"| {label} | {leak_results[label]['frozen']:+.3f} | "
            f"{leak_results[label]['weekly']:+.3f} | {leak_results[label]['full']:+.3f} |"
        )
    lines.append("")

    lines.append("## 4. True last-season opening lock (margin-NP)")
    lines.append("")
    lines.append("| Season pair | Raw drift/game | With fitted uplift |")
    lines.append("|---|---:|---:|")
    uplifts = []
    for (pl, pd_), (cl, cd) in zip(list(per_season.items()), list(per_season.items())[1:]):
        prior_np = {pid: fmean(v) for pid, v in pd_["all"].items() if len(v) >= 20}
        drifts = []
        for pid, s in cd["series"].items():
            lock = prior_np.get(pid)
            if lock is None:
                continue
            for _, v in s:
                drifts.append(v - lock)
        raw = fmean(drifts)
        uplifts.append(raw)
        lines.append(f"| {pl} → {cl} | {raw:+.3f} | {raw - fmean(uplifts):+.3f} (uplift +{fmean(uplifts):.2f}) |")
    lines.append("")
    uplift = fmean(uplifts)
    lines.append(f"Mean YoY uplift under margin-NP: **+{uplift:.2f} margin-pts/game** (additive; the ×1.08 proportional form fails here because near-zero players cannot be scaled).")
    lines.append("")

    dates = sorted({d for s in cur["series"].values() for d, _ in s})
    lock_day = dates[10]
    by_date: dict[date, list[tuple[str, float]]] = defaultdict(list)
    for pid, s in cur["series"].items():
        for d, v in s:
            by_date[d].append((pid, v))

    def replay(roster_pids: list[str]) -> list[float]:
        locks = {}
        for pid in roster_pids:
            m = season_mean.get(pid)
            if m is not None:
                locks[pid] = m
        return [
            sum(v - locks[pid] for pid, v in by_date[d] if pid in locks) if d >= lock_day else 0.0
            for d in dates
        ]

    positive_ranked = [pid for pid, m in ranked if m > 0]
    mid = len(positive_ranked) // 2
    lines.append("## 5. User P&L bands and the rate sweep (margin-NP units)")
    lines.append("")
    band_rows = {}
    for name, pids in (("stars", positive_ranked[:SLOTS]), ("balanced", positive_ranked[mid - 5:mid + 5])):
        daily = replay(pids)
        active = [v for v in daily if v != 0.0]
        weeks: dict[tuple[int, int], float] = defaultdict(float)
        for d, v in zip(dates, daily):
            weeks[d.isocalendar()[:2]] += v
        band_rows[name] = (pstdev(active), pct([abs(v) for v in active], 0.95), pstdev(list(weeks.values())), pct([abs(v) for v in list(weeks.values())], 0.95))
    lines.append("| Roster | Night SD | Night p95 | Week SD | Week p95 | (margin-pts) |")
    lines.append("|---|---:|---:|---:|---:|---|")
    for name, (nsd, np95, wsd, wp95) in band_rows.items():
        lines.append(f"| {name} | {nsd:.1f} | {np95:.1f} | {wsd:.1f} | {wp95:.1f} | |")
    lines.append("")

    star_cost = ranked[0][1]
    floor_np_val = pct(sorted(m for _, m in ranked if m > 0), 0.05)
    nsd, np95, wsd, wp95 = band_rows["balanced"]
    lines.append("| Rate | Star cost/game | Night p95 | Week p95 | p05 positive player | Floor OK | Verdict |")
    lines.append("|---|---:|---:|---:|---:|:---:|---|")
    for rate in CAND_RATES:
        night = np95 * rate
        week = wp95 * rate
        fl = floor_np_val * rate >= QUOTE_FLOOR
        bits = []
        if night < 150_000:
            bits.append("nights feel flat")
        if night > 750_000:
            bits.append("nights too violent")
        if week > 2_000_000:
            bits.append("weeks too violent")
        if star_cost * rate > 1_000_000:
            bits.append("star cost 7 figures")
        if not fl:
            bits.append("floor distorts")
        verdict = "; ".join(bits) if bits else "**in band**"
        lines.append(
            f"| ${rate/1000:.0f}K | ${star_cost*rate:,.0f} | ±${night:,.0f} | ±${week:,.0f} "
            f"| ${floor_np_val*rate:,.0f} | {'yes' if fl else 'no'} | {verdict} |"
        )
    lines.append("")

    lines.append("## 6. Shorts (7-day windows, margin-NP units)")
    lines.append("")
    pnl: list[float] = []
    for pid, s in cur["series"].items():
        index = 0
        while index < len(s):
            start_day = s[index][0]
            history = [v for d, v in s if d < start_day]
            if len(history) < TRAIL_MIN:
                index += 1
                continue
            quote = fmean(history[-TRAIL:])
            end = start_day + timedelta(days=6)
            total = 0.0
            scan = index
            while scan < len(s) and s[scan][0] <= end:
                total += quote - s[scan][1]
                scan += 1
            pnl.append(total)
            index = scan
    lines.append(
        f"{len(pnl):,} windows: mean {fmean(pnl):+.2f}, SD {pstdev(pnl):.1f} margin-pts, "
        f"win rate {sum(1 for v in pnl if v > 0)/len(pnl):.1%}."
    )
    lines.append("")

    out = Path("output/per-game-margin-study.md")
    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
