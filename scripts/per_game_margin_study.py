"""Descriptive box-score fit to same-game team margin and pricing residuals.

The team regression does not identify individual causal impact or a player-score
zero point. Its uncentered player component is a research statistic, not a new
game rule. Historical cohorts are retrospective; explicitly marked fixed-roster
replays select players and prices using only observations before their start.
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
                    "three_pa": float(r["three_pa"]),
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
        three_pa=float(row["three_pa"]),
        three_pm=float(row["three_pm"]),
        fta=float(row["fta"]),
        ftm=float(row["ftm"]),
        minutes=float(row["minutes"]),
    )
    return NetPointsModel().score(line)


def prior_only_locks(series, start: date, *, limit: int = UNIVERSE_SIZE):
    """Select a fixed pool and mean-cost proxy from strictly earlier game dates."""
    prior = {pid: [value for day, value in values if day < start]
             for pid, values in series.items()}
    eligible = [pid for pid, values in prior.items() if len(values) >= TRAIL_MIN]
    selected = sorted(eligible, key=lambda pid: (-len(prior[pid]), pid))[:limit]
    return {pid: fmean(prior[pid]) for pid in selected}


def prior_rosters(locks, slots: int = SLOTS):
    positive = sorted((pid for pid, cost in locks.items() if cost > 0),
                      key=lambda pid: (-locks[pid], pid))
    if len(positive) < slots:
        raise ValueError(f"need {slots} positive prior-only cost proxies; found {len(positive)}")
    mid = len(positive) // 2
    start = max(0, min(mid - slots // 2, len(positive) - slots))
    return {"high prior mean": positive[:slots], "middle prior mean": positive[start:start + slots]}


def quote_residuals(series):
    """Gross residuals after three prior observations; never price the warmup."""
    residuals = {key: [] for key in ("frozen", "weekly", "full")}
    history = []
    quotes = None
    last_week = None
    for day, value in sorted(series, key=lambda item: item[0]):
        prior = [v for d, v in history if d < day]
        if len(prior) >= TRAIL_MIN:
            trailing = fmean(prior[-TRAIL:])
            if quotes is None:
                quotes = dict.fromkeys(residuals, trailing)
            quotes["full"] = trailing
            week = day.isocalendar()[:2]
            if week != last_week:
                quotes["weekly"] = trailing
                last_week = week
            for key in residuals:
                residuals[key].append(value - quotes[key])
        history.append((day, value))
    return residuals


def prior_transition_uplifts(raw_drifts):
    """The first transition calibrates only; later ones use completed transitions."""
    return [None if index == 0 else fmean(raw_drifts[:index])
            for index in range(len(raw_drifts))]


def fixed_roster_bands(series, dates, start, locks, rosters):
    """Gross fixed-roster residuals, including zero-net nights with game exposure."""
    by_date = defaultdict(list)
    for pid, values in series.items():
        for day, value in values:
            by_date[day].append((pid, value))
    bands = {}
    for name, pids in rosters.items():
        held = set(pids)
        active = []
        weeks = defaultdict(float)
        total = 0.0
        for day in dates:
            if day < start:
                continue
            exposed = [(pid, value) for pid, value in by_date[day] if pid in held]
            net = sum(value - locks[pid] for pid, value in exposed)
            if exposed:
                active.append(net)
            weeks[day.isocalendar()[:2]] += net
            total += net
        if not active:
            raise ValueError(f"roster {name} has no post-entry observations")
        bands[name] = (pstdev(active), pct([abs(v) for v in active], .95),
                       pstdev(list(weeks.values())), pct([abs(v) for v in weeks.values()], .95), total)
    return bands


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
        "# Team-margin fit and descriptive pricing diagnostics",
        "",
        "This regression uses final box scores to describe same-game team margin; "
        "it is not a pregame forecast or identified individual impact estimator. "
        "ESPN's saved summaries separately contain raw player plus-minus. "
        "No dollar rate, price floor, fees, roster policy or live provider capability is validated here.",
        "",
        f"## 1. Fitted margin weights (train 2023-24 + 2024-25, {len(train):,} team-games)",
        "",
        "| Stat | Weight (margin pts per unit) | Old NetPoints weight |",
        "|---|---:|---:|",
    ]
    from nba_stock_market.engine import NetPointsCoefficients

    _engine = NetPointsCoefficients()
    old_weights = {
        "pts": _engine.pts, "fga": _engine.fga, "fta": _engine.fta,
        "oreb": _engine.offensive_rebounds, "dreb": _engine.defensive_rebounds,
        "ast": _engine.ast, "stl": _engine.stl, "blk": _engine.blk,
        "tov": _engine.tov, "three_pm": _engine.three_pm,
    }
    for stat in REGRESSORS:
        lines.append(f"| {stat} | {weights[stat]:+.3f} | {old_weights.get(stat, 0):+.2f} |")
    lines.append(f"| intercept (fit only, not applied) | {intercept:+.2f} | — |")
    lines.append("")
    lines.append("Only the fitted regressors are tabulated; the complete engine comparison also includes FGM, FTM, three-point attempts and minutes.")
    lines.append("The intercept is used in the team prediction. The player tables below use only the uncentered linear component; its zero point is not calibrated individual margin impact.")
    lines.append("")
    lines.append(
        f"Held-season same-game association (2025-26, {len(test):,} team-games): fitted "
        f"vs actual margin correlation **r = {corr:.3f}**, "
        f"RMSE {math.sqrt(fmean([(p-a)**2 for p,a in zip(predicted, actual)])):.3f} points. "
        "Correlation alone does not establish calibration, attribution or statistical equivalence to another metric."
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
    lines.append("## 2. Retrospective player means and uncentered score scale")
    lines.append("")
    lines.append("The top-150 cohort uses completed-season appearance counts. It describes this sample and is not a pregame listing rule or unrestricted league ranking.")
    lines.append("")
    lines.append(
        f"Player-season means (2025-26, {len(season_mean)} listed players): metric SD "
        f"{pstdev(list(season_mean.values())):.2f} margin-pts vs old-NP SD "
        f"{pstdev(list(old_mean.values())):.2f}; Pearson correlation between player means "
        f"**r = {corr2:.3f}** (not a rank correlation)."
    )
    lines.append("")
    lines.append(f"**{len(negative)} of {len(season_mean)} sampled players have nonpositive uncentered season means**; engine means: {sum(value <= 0 for value in old_mean.values())} nonpositive. These are observed means, not expected causal impact or a validated floor policy.")
    lines.append("")
    lines.append("| Player | Margin-NP/game | Old NP/game |")
    lines.append("|---|---:|---:|")
    for pid, m in ranked[:8]:
        lines.append(f"| {cur['names'][pid]} | {m:+.2f} | {old_mean[pid]:.2f} |")
    lines.append("")

    lines.append("## 3. Gross quote residuals after a three-game warmup (uncentered score)")
    lines.append("")
    lines.append("Prices use strictly prior dates. Warmup games are excluded. No fees or floor are applied; training-season rows are in-sample diagnostics under the fitted weights.")
    lines.append("")
    lines.append("| Season | frozen at open | weekly requote | nightly full |")
    lines.append("|---|---:|---:|---:|")
    leak_results: dict[str, dict[str, float]] = {}
    for label, data in per_season.items():
        leaks: dict[str, list[float]] = {k: [] for k in ("frozen", "weekly", "full")}
        for pid, s in data["series"].items():
            if len(s) < 5:
                continue
            residuals = quote_residuals(s)
            for key in leaks:
                leaks[key].extend(residuals[key])
        leak_results[label] = {k: fmean(v) for k, v in leaks.items()}
        lines.append(
            f"| {label} | {leak_results[label]['frozen']:+.3f} | "
            f"{leak_results[label]['weekly']:+.3f} | {leak_results[label]['full']:+.3f} |"
        )
    lines.append("")

    lines.append("## 4. Prior-season mean residual and chronological uplift diagnostic")
    lines.append("")
    lines.append("| Season pair | Raw drift/game | Uplift from earlier transitions | Residual after earlier uplift |")
    lines.append("|---|---:|---:|---:|")
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
        prior_uplift = prior_transition_uplifts([*uplifts, raw])[-1]
        lines.append(f"| {pl} → {cl} | {raw:+.3f} | " + ("not available | calibration only |" if prior_uplift is None else f"{prior_uplift:+.3f} | {raw-prior_uplift:+.3f} |"))
        uplifts.append(raw)
    lines.append("")
    lines.append("The current transition never enters its own uplift. Historical cohorts remain retrospective and the first transition is within the model's fitting period; these two pairs do not validate a production uplift or a multiplicative alternative.")
    lines.append("")

    # The executable diagnostic pool includes all players observed before entry,
    # not the retrospective top-150 population used in the descriptive tables.
    full_series = defaultdict(list)
    for row in sorted(cur["rows"], key=lambda r: (r["date"], r["game_id"], r["pid"])):
        full_series[str(row["pid"])].append((row["date"], margin_np(row, weights)))
    dates = sorted({day for values in full_series.values() for day, _ in values})
    if len(dates) <= 10:
        raise ValueError("need more than ten observed game dates for fixed-roster replay")
    lock_day = dates[10]
    locks = prior_only_locks(full_series, lock_day)
    rosters = prior_rosters(locks)
    band_rows = fixed_roster_bands(full_series, dates, lock_day, locks, rosters)
    lines.append("## 5. Prior-only fixed-roster residuals and dollar sensitivity")
    lines.append("")
    lines.append(f"Entry date {lock_day}: pool chosen by prior appearances, ranking and fixed cost proxies from strictly earlier mean scores (at least three games). No final-season ranking or mean sets these locks.")
    lines.append("These are gross research residuals, not the full game ledger: no signing fees, price floor, market impact, roster changes or budget constraint. Dollar rows only multiply the same path by a rate; none is approved.")
    lines.append("")
    lines.append("| Roster | Night SD | Night abs-p95 | Week SD | Week abs-p95 | Season total (score units) |")
    lines.append("|---|---:|---:|---:|---:|---:|")
    for name, (nsd, np95, wsd, wp95, total) in band_rows.items():
        lines.append(f"| {name} | {nsd:.1f} | {np95:.1f} | {wsd:.1f} | {wp95:.1f} | {total:+.1f} |")
    lines.append("")
    positive_locks = sorted(value for value in locks.values() if value > 0)
    star_cost = max(positive_locks)
    floor_np_val = pct(positive_locks, .05)
    _, np95, _, wp95, _ = band_rows["middle prior mean"]
    lines.append("| Rate | Highest prior cost proxy | Night abs-p95 | Week abs-p95 | p05 positive prior cost | p05 at least $25K? |")
    lines.append("|---|---:|---:|---:|---:|:---:|")
    for rate in CAND_RATES:
        lines.append(f"| ${rate/1000:.0f}K | ${star_cost*rate:,.0f} | ${np95*rate:,.0f} | ${wp95*rate:,.0f} | ${floor_np_val*rate:,.0f} | {'yes' if floor_np_val*rate >= QUOTE_FLOOR else 'no'} |")
    lines.append("")

    lines.append("## 6. Gross inverse-score residuals (7-calendar-day windows)")
    lines.append("")
    lines.append("Retrospective player cohort; each window uses prior-date trailing means. These are independent player windows, not a short-roster strategy; fees, floors, slot limits, DNP rules and early-close policy are absent.")
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
            if end > dates[-1]:
                break  # Right-censored windows are not complete seven-day observations.
            total = 0.0
            scan = index
            while scan < len(s) and s[scan][0] <= end:
                total += quote - s[scan][1]
                scan += 1
            pnl.append(total)
            index = scan
    lines.append(
        f"{len(pnl):,} windows: mean {fmean(pnl):+.2f}, SD {pstdev(pnl):.1f} margin-pts, "
        f"win rate {(sum(1 for v in pnl if v > 0)/len(pnl) if pnl else math.nan):.1%}."
    )
    lines.append("")

    out = Path("output/per-game-margin-study.md")
    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
