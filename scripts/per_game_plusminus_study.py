"""Descriptive historical on-court plus-minus and prior-only residual studies.

Odd/even season means measure repeatability, not a trading-skill ceiling. Raw
plus-minus also includes teammate/opponent context and does not isolate causal
individual impact. Dollar sensitivities do not select a production rate.
"""
from __future__ import annotations

import csv
import json
import math
import statistics
import sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, ".")

SEASONS = ("2023-24", "2024-25", "2025-26")
UNIVERSE_SIZE = 150
TRAIL = 10
TRAIL_MIN = 3
SLOTS = 10
CAND_RATES = (10_000, 15_000, 20_000, 25_000, 40_000)
QUOTE_FLOOR = 25_000

MARGIN_WEIGHTS = {
    "pts": 0.877, "fga": -1.438, "fta": -0.681, "oreb": 1.471, "dreb": 1.516,
    "ast": -0.012, "stl": 1.755, "blk": 0.421, "tov": -1.386, "three_pm": 0.017,
}
from nba_stock_market.engine import NetPointsCoefficients
from scripts.per_game_margin_study import prior_only_locks, prior_rosters, fixed_roster_bands, quote_residuals
from scripts.per_game_blend_sweep import corr

_ENGINE = NetPointsCoefficients()
# The exact engine weights, mapped to this script's CSV column keys.
OLD_WEIGHTS = {
    "pts": _ENGINE.pts, "oreb": _ENGINE.offensive_rebounds,
    "dreb": _ENGINE.defensive_rebounds, "ast": _ENGINE.ast, "stl": _ENGINE.stl,
    "blk": _ENGINE.blk, "tov": _ENGINE.tov, "fga": _ENGINE.fga,
    "fgm": _ENGINE.fgm, "three_pa": _ENGINE.three_pa, "three_pm": _ENGINE.three_pm,
    "fta": _ENGINE.fta, "ftm": _ENGINE.ftm, "minutes": _ENGINE.minutes,
}


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


def extract_plusminus(season: str) -> dict[tuple[str, str], float]:
    """(game_id, player_id) -> on-court plus-minus."""
    out: dict[tuple[str, str], float] = {}
    for path in sorted((Path(f"data/raw/{season}/espn/summaries")).glob("*.json")):
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        game_id = path.stem
        for team in doc.get("boxscore", {}).get("players", []):
            for block in team.get("statistics", []):
                names = block.get("names", [])
                if "+/-" not in names:
                    continue
                pm_index = names.index("+/-")
                for entry in block.get("athletes", []):
                    if entry.get("didNotPlay"):
                        continue
                    stats = entry.get("stats", [])
                    if len(stats) <= pm_index:
                        continue
                    raw = str(stats[pm_index]).replace("+", "").strip()
                    try:
                        value = float(raw)
                    except ValueError:
                        continue
                    pid = str(entry.get("athlete", {}).get("id", ""))
                    if pid and math.isfinite(value):
                        key = (game_id, pid)
                        if key in out and out[key] != value:
                            raise ValueError(f"conflicting plus-minus for {key}")
                        out[key] = value
    return out


def load_csv(season: str) -> list[dict[str, object]]:
    rows = []
    with Path(f"data/raw/{season}/player_game_logs.csv").open(newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            rows.append(
                {
                    "game_id": r["game_id"],
                    "date": date.fromisoformat(r["game_date"]),
                    "pid": r["player_id"],
                    "name": r["player_name"],
                    "pts": float(r["pts"]),
                    "fga": float(r["fga"]),
                    "fgm": float(r["fgm"]),
                    "fta": float(r["fta"]),
                    "ftm": float(r["ftm"]),
                    "oreb": float(r["offensive_rebounds"]),
                    "dreb": float(r["defensive_rebounds"]),
                    "ast": float(r["ast"]),
                    "stl": float(r["stl"]),
                    "blk": float(r["blk"]),
                    "tov": float(r["tov"]),
                    "three_pm": float(r["three_pm"]),
                    "three_pa": float(r["three_pa"]),
                    "minutes": float(r["minutes"]),
                }
            )
    return rows


def score(row, weights):
    return sum(float(row.get(k, 0.0)) * w for k, w in weights.items())


def main() -> int:
    lines = ["# Descriptive on-court plus-minus diagnostics", ""]
    per_season = {}
    for season in SEASONS:
        pm = extract_plusminus(season)
        rows = sorted(load_csv(season), key=lambda r: (r["date"], r["game_id"], r["pid"]))
        if not rows:
            raise ValueError(f"no player-game rows for {season}")
        joined = 0
        for r in rows:
            key = (str(r["game_id"]), str(r["pid"]))
            r["pm"] = pm.get(key)
            if r["pm"] is not None:
                joined += 1
        if joined != len(rows):
            raise ValueError(f"incomplete plus-minus coverage for {season}: {joined}/{len(rows)}; no full report written")
        counts: dict[str, int] = defaultdict(int)
        for r in rows:
            counts[str(r["pid"])] += 1
        universe = {p for p, _ in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:UNIVERSE_SIZE]}
        per_season[season] = {"rows": rows, "universe": universe, "extracted": len(pm), "joined": joined}
        lines.append(
            f"- {season}: extracted {len(pm):,} player-game +/- values, joined "
            f"{joined:,}/{len(rows):,} log rows ({joined/len(rows):.1%})."
        )
    lines.append("")

    cur = per_season["2025-26"]
    metrics = {
        "old NetPoints": lambda r: score(r, OLD_WEIGHTS),
        "margin-fit box": lambda r: score(r, MARGIN_WEIGHTS),
        "raw +/-": lambda r: r["pm"],
    }

    lines.append("## 1. Odd/even season-mean repeatability (2025-26 retrospective cohort)")
    lines.append("")
    lines.append("Correlation between each player's odd-game and even-game season mean measures repeatability of aggregates.")
    lines.append("This is not next-game prediction accuracy or a skill ceiling. Cohort uses final-season appearance counts, and each metric is measured on the same joined player-game rows.")
    lines.append("")
    lines.append("| Metric | Split-half r | Per-game SD around player mean |")
    lines.append("|---|---:|---:|")
    rel_results = {}
    for label, fn in metrics.items():
        odd_means, even_means, noise = [], [], []
        for pid in cur["universe"]:
            vals = [fn(r) for r in cur["rows"] if r["pid"] == pid and (label != "raw +/-" or r["pm"] is not None)]
            vals = [v for v in vals if v is not None]
            if len(vals) < 20:
                continue
            odd = vals[0::2]
            even = vals[1::2]
            odd_means.append(fmean(odd))
            even_means.append(fmean(even))
            m = fmean(vals)
            noise.extend(v - m for v in vals)
        r_val = corr(odd_means, even_means)
        rel_results[label] = r_val
        lines.append(f"| {label} | {r_val:.3f} | {pstdev(noise):.2f} |")
    lines.append("")

    season_pm = {}
    for pid in cur["universe"]:
        vals = [r["pm"] for r in cur["rows"] if r["pid"] == pid and r["pm"] is not None]
        if len(vals) >= 20:
            season_pm[pid] = fmean(vals)
    negative = sum(1 for v in season_pm.values() if v <= 0)
    names = {str(r["pid"]): str(r["name"]) for r in cur["rows"]}
    ranked = sorted(season_pm.items(), key=lambda kv: -kv[1])
    lines.append("## 2. Observed player means and scale (raw +/-)")
    lines.append("")
    lines.append(
        f"Listed players with a season mean: {len(season_pm)}. **{negative} "
        f"({negative/len(season_pm):.0%}) have nonpositive observed season means**. "
        f"Season-mean SD {pstdev(list(season_pm.values())):.2f}; top of market: "
        + ", ".join(f"{names[p]} {m:+.1f}" for p, m in ranked[:5]) + "."
    )
    lines.append(f"Observed player means range from {min(season_pm.values()):+.2f} to {max(season_pm.values()):+.2f}, a width of {max(season_pm.values())-min(season_pm.values()):.2f}. Residual SD around a full-season mean is not a decomposition of irreducible noise.")
    lines.append("")

    lines.append("## 3. Gross quote residuals after three strictly prior games")
    lines.append("")
    lines.append("Warmup games are not scored against their own mean. Retrospective cohort; no fees or price floor applied.")
    lines.append("")
    lines.append("| Season | frozen at open | weekly requote | nightly full |")
    lines.append("|---|---:|---:|---:|")
    for season in SEASONS:
        data = per_season[season]
        series: dict[str, list[tuple[date, float]]] = defaultdict(list)
        for r in sorted(data["rows"], key=lambda r: (r["date"], r["game_id"], r["pid"])):
            if r["pid"] in data["universe"] and r["pm"] is not None:
                series[str(r["pid"])].append((r["date"], float(r["pm"])))
        leaks = {k: [] for k in ("frozen", "weekly", "full")}
        for pid, s in series.items():
            if len(s) < 5:
                continue
            residuals = quote_residuals(s)
            for key in leaks:
                leaks[key].extend(residuals[key])
        lines.append(
            f"| {season} | {fmean(leaks['frozen']):+.3f} | {fmean(leaks['weekly']):+.3f} "
            f"| {fmean(leaks['full']):+.3f} |"
        )
    lines.append("")

    lines.append("## 4. YoY opening drift (lock at prior-season mean +/-)")
    lines.append("")
    for prior, current in zip(SEASONS, SEASONS[1:]):
        prior_mean: dict[str, float] = {}
        by_pid: dict[str, list[float]] = defaultdict(list)
        for r in per_season[prior]["rows"]:
            if r["pm"] is not None:
                by_pid[str(r["pid"])].append(float(r["pm"]))
        for pid, vals in by_pid.items():
            if len(vals) >= 20:
                prior_mean[pid] = fmean(vals)
        drifts = []
        for r in per_season[current]["rows"]:
            if r["pid"] in per_season[current]["universe"] and r["pm"] is not None:
                lock = prior_mean.get(str(r["pid"]))
                if lock is not None:
                    drifts.append(float(r["pm"]) - lock)
        lines.append(f"- {prior} → {current}: {fmean(drifts):+.3f} margin-pts/game over {len(drifts):,} games.")
    lines.append("")

    all_series = defaultdict(list)
    for row in cur["rows"]:
        if row["pm"] is not None:
            all_series[str(row["pid"])].append((row["date"], float(row["pm"])))
    dates = sorted({row["date"] for row in cur["rows"]})
    if len(dates) <= 10:
        raise ValueError("need more than ten game dates for fixed-roster replay")
    lock_day = dates[10]
    locks = prior_only_locks(all_series, lock_day)
    rosters = prior_rosters(locks)
    bands = fixed_roster_bands(all_series, dates, lock_day, locks, rosters)
    lines.append("## 5. Prior-only fixed-roster gross residuals and dollar sensitivity")
    lines.append("")
    lines.append(f"Entry date {lock_day}. Pool uses appearances before entry; ranking and fixed cost proxies use strictly earlier means with at least three observations. No full-season mean or rank sets these locks.")
    lines.append("No signing fees, price floor, budget, market impact or subsequent trading is simulated. These are research residuals, not full-policy user P&L or a recommended rate.")
    lines.append("")
    for name, values in bands.items():
        nsd, np95, wsd, wp95, total = values
        lines.append(f"- {name}: night SD {nsd:.1f} / abs-p95 {np95:.1f}; week SD {wsd:.1f} / abs-p95 {wp95:.1f}; season {total:+.1f} (score units).")
    lines.append("")
    positive_locks = sorted(value for value in locks.values() if value > 0)
    star_np = max(positive_locks)
    floor_np_val = pct(positive_locks, .05)
    _, np95, _, wp95, _ = bands["middle prior mean"]
    lines.append("| Rate | Highest prior cost proxy | Night abs-p95 | Week abs-p95 | p05 positive prior cost | p05 at least $25K? |")
    lines.append("|---|---:|---:|---:|---:|:---:|")
    for rate in CAND_RATES:
        lines.append(f"| ${rate/1000:.0f}K | ${star_np*rate:,.0f} | ${np95*rate:,.0f} | ${wp95*rate:,.0f} | ${floor_np_val*rate:,.0f} | {'yes' if floor_np_val*rate >= QUOTE_FLOOR else 'no'} |")
    lines.append("")

    lines.append("## 6. Gross inverse-score residuals (7-calendar-day windows)")
    lines.append("")
    lines.append("Independent player windows in the retrospective cohort; not a short-roster strategy. Fees, floors, slot limits, DNP rules and early-close policy are absent.")
    lines.append("")
    pnl = []
    series26: dict[str, list[tuple[date, float]]] = defaultdict(list)
    for r in sorted(cur["rows"], key=lambda r: (r["date"], r["game_id"], r["pid"])):
        if r["pid"] in cur["universe"] and r["pm"] is not None:
            series26[str(r["pid"])].append((r["date"], float(r["pm"])))
    for pid, s in series26.items():
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
                break
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

    out = Path("output/per-game-plusminus-study.md")
    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
