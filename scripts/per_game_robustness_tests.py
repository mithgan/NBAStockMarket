"""Cross-season robustness battery for per-game economy v2.

Six test families over all three cached seasons (2023-24, 2024-25, 2025-26):

R1. Anchor leak, cross-season - does the trailing-10 requote stay fair in every
    season, or was 2025-26 lucky?
R2. TRUE last-season opening lock - lock a season's opening costs at the PRIOR
    season's actually-produced NP/game (the real product mechanic, not the
    same-season proxy used before) and measure rest-of-season drift by tier.
R3. Normal-user P&L bands, cross-season - is night ±$250K / week ±$610K stable?
R4. Shorts under fair quotes - random weekly short EV, win rates, and the
    predicted meta: shorting superstars after mid-January.
R5. Requote cadence - how much leak each server implementation choice leaves:
    nightly full, nightly half-step, weekly full, frozen.
R6. Retention risk - probability a fair user is down after week 1 / month 1,
    and max-drawdown distribution, at $20K/NP.

Deterministic except the seeded random rosters in R3/R6.
"""
from __future__ import annotations

import math
import random
import statistics
import sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, ".")
from nba_stock_market.per_game_simulation import load_historical_games

SEASONS = (
    ("2023-24", Path("data/raw/2023-24"), Path("data/raw/dnt-2023-24")),
    ("2024-25", Path("data/raw/2024-25"), Path("data/raw/dnt-2024-25")),
    ("2025-26", Path("data/raw/2025-26"), Path("data/raw/dnt")),
)
UNIVERSE_SIZE = 150
TRAIL = 10
TRAIL_MIN = 3
SLOTS = 10
RATE = 20_000
SEEDS = tuple(range(1, 11))
TIERS = (
    ("Superstar", 20.0, None),
    ("Star", 14.0, 20.0),
    ("Starter", 9.0, 14.0),
    ("Rotation", 5.0, 9.0),
    ("Bench", None, 5.0),
)


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


class SeasonData:
    def __init__(self, label: str, data_dir: Path, dnt_dir: Path) -> None:
        self.label = label
        games = load_historical_games(data_dir, dnt_dir)
        counts: dict[str, int] = defaultdict(int)
        for g in games:
            if g.saved_projection_net_points is not None:
                counts[g.player_id] += 1
        self.universe = {
            p for p, _ in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:UNIVERSE_SIZE]
        }
        self.series: dict[str, list[tuple[date, float, float | None]]] = defaultdict(list)
        self.all_series: dict[str, list[float]] = defaultdict(list)
        for g in sorted(games, key=lambda g: (g.game_date, g.game_id, g.player_id)):
            self.all_series[g.player_id].append(g.actual_net_points)
            if g.player_id in self.universe:
                self.series[g.player_id].append(
                    (g.game_date, g.actual_net_points, g.saved_projection_net_points)
                )
        self.by_date: dict[date, list[tuple[str, float, float | None]]] = defaultdict(list)
        for pid, s in self.series.items():
            for d, a, p in s:
                self.by_date[d].append((pid, a, p))
        self.dates = sorted(self.by_date)
        self.season_mean = {
            pid: fmean([a for _, a, _ in s])
            for pid, s in self.series.items()
            if len(s) >= 20
        }

    def tier_of(self, pid: str) -> str | None:
        m = self.season_mean.get(pid)
        if m is None:
            return None
        for name, low, high in TIERS:
            if (low is None or m >= low) and (high is None or m < high):
                return name
        return None

    def trailing_at(self, pid: str, day: date) -> float | None:
        prior = [a for d, a, _ in self.series[pid] if d < day]
        if len(prior) >= TRAIL_MIN:
            return fmean(prior[-TRAIL:])
        projs = [p for d, _, p in self.series[pid] if d <= day and p is not None]
        return projs[0] if projs else None


def r1_anchor_leak(seasons: list[SeasonData]) -> list[str]:
    lines = ["## R1. Anchor leak per settled game, all seasons (NP)", ""]
    lines.append("| Season | Games | trailing-10 requote | game-day projection |")
    lines.append("|---|---:|---:|---:|")
    for s in seasons:
        trail_edges: list[float] = []
        proj_edges: list[float] = []
        history: dict[str, list[float]] = defaultdict(list)
        first_proj: dict[str, float] = {}
        for day in s.dates:
            for pid, actual, proj in s.by_date[day]:
                if proj is not None and pid not in first_proj:
                    first_proj[pid] = proj
                prior = history[pid]
                trailing = (
                    fmean(prior[-TRAIL:]) if len(prior) >= TRAIL_MIN
                    else (proj if proj is not None else first_proj.get(pid))
                )
                if trailing is not None:
                    trail_edges.append(actual - trailing)
                if proj is not None:
                    proj_edges.append(actual - proj)
                history[pid].append(actual)
        lines.append(
            f"| {s.label} | {len(trail_edges):,} | {fmean(trail_edges):+.3f} "
            f"(${fmean(trail_edges)*RATE:+,.0f}) | {fmean(proj_edges):+.3f} "
            f"(${fmean(proj_edges)*RATE:+,.0f}) |"
        )
    lines.append("")
    return lines


def r2_true_last_season(seasons: list[SeasonData]) -> list[str]:
    lines = ["## R2. TRUE last-season opening lock (the product mechanic)", ""]
    lines.append(
        "Lock every listed player at his PRIOR season's produced NP/game (20+ games "
        "played there), hold all season, measure mean(actual − locked) per game."
    )
    lines.append("")
    tier_names = [t for t, _, _ in TIERS]
    lines.append("| Season pair | Players covered | " + " | ".join(tier_names) + " | All (NP) | All at $20K |")
    lines.append("|---|---:|" + "---:|" * (len(tier_names) + 2))
    for prior, current in zip(seasons, seasons[1:]):
        prior_np = {
            pid: fmean(vals)
            for pid, vals in prior.all_series.items()
            if len(vals) >= 20
        }
        drift: dict[str, list[float]] = defaultdict(list)
        pooled: list[float] = []
        covered = 0
        for pid, s in current.series.items():
            lock = prior_np.get(pid)
            tier = current.tier_of(pid)
            if lock is None or tier is None:
                continue
            covered += 1
            for _, actual, _ in s:
                drift[tier].append(actual - lock)
                pooled.append(actual - lock)
        cells = " | ".join(
            f"{fmean(drift[t]):+.2f}" if drift[t] else "—" for t in tier_names
        )
        lines.append(
            f"| {prior.label} → {current.label} | {covered}/{len(current.series)} "
            f"| {cells} | {fmean(pooled):+.3f} | ${fmean(pooled)*RATE:+,.0f}/game |"
        )
    lines.append("")
    lines.append(
        "Coverage gap = rookies/returners without a 20-game prior season; they need "
        "the projection+premium path."
    )
    lines.append("")
    return lines


def _weekly_totals(dates: list[date], daily: list[float]) -> list[float]:
    acc: dict[tuple[int, int], float] = defaultdict(float)
    for day, v in zip(dates, daily):
        acc[day.isocalendar()[:2]] += v
    return list(acc.values())


def _replay_fixed(s: SeasonData, roster: dict[str, float], start: date) -> list[float]:
    daily = []
    for day in s.dates:
        if day < start:
            daily.append(0.0)
            continue
        daily.append(sum(a - roster[pid] for pid, a, _ in s.by_date[day] if pid in roster))
    return daily


def r3_user_bands(seasons: list[SeasonData]) -> tuple[list[str], dict[str, dict[str, list[float]]]]:
    lines = ["## R3. Normal-user P&L bands, cross-season ($20K, fair locks)", ""]
    lines.append("| Season | Roster | Season P&L | Night SD | Night p95 | Week SD | Week p95 |")
    lines.append("|---|---|---:|---:|---:|---:|---:|")
    paths: dict[str, dict[str, list[float]]] = {}
    for s in seasons:
        lock_day = s.dates[10]
        early: dict[str, list[float]] = defaultdict(list)
        for day in s.dates[:14]:
            for pid, _, p in s.by_date[day]:
                if p is not None:
                    early[pid].append(p)
        ranked = sorted(early, key=lambda pid: -fmean(early[pid]))
        mid = len(ranked) // 2

        def build(pids: list[str]) -> dict[str, float]:
            roster = {}
            for pid in pids:
                anchor = (
                    fmean([a for d, a, _ in s.series[pid] if d.month != 10 and d < s.dates[-1]])
                    if len(s.series[pid]) >= 20
                    else s.trailing_at(pid, lock_day)
                )
                if anchor is not None and not math.isnan(anchor):
                    roster[pid] = anchor
            return roster

        season_paths: dict[str, list[float]] = {}
        for name, pids in (
            ("balanced", ranked[mid - 5:mid + 5]),
            ("stars", ranked[:SLOTS]),
        ):
            daily = _replay_fixed(s, build(pids), lock_day)
            season_paths[name] = daily
            active = [v for v in daily if v != 0.0]
            weeks = _weekly_totals(s.dates, daily)
            lines.append(
                f"| {s.label} | {name} | ${sum(daily)*RATE:+,.0f} "
                f"| ±${pstdev(active)*RATE:,.0f} | ±${pct([abs(v) for v in active],0.95)*RATE:,.0f} "
                f"| ±${pstdev(weeks)*RATE:,.0f} | ±${pct([abs(v) for v in weeks],0.95)*RATE:,.0f} |"
            )
        rand_daily_all: list[list[float]] = []
        for seed in SEEDS:
            rng = random.Random(seed)
            pool = sorted(pid for pid in s.season_mean)
            rng.shuffle(pool)
            daily = _replay_fixed(s, build(pool[:SLOTS]), lock_day)
            rand_daily_all.append(daily)
        totals = [sum(d) for d in rand_daily_all]
        active = [v for d in rand_daily_all for v in d if v != 0.0]
        weeks = [w for d in rand_daily_all for w in _weekly_totals(s.dates, d)]
        season_paths["random"] = rand_daily_all[0]
        season_paths["__random_totals__"] = totals
        paths[s.label] = season_paths
        lines.append(
            f"| {s.label} | random ×10 | mean ${fmean(totals)*RATE:+,.0f} (SD ${pstdev(totals)*RATE:,.0f}) "
            f"| ±${pstdev(active)*RATE:,.0f} | ±${pct([abs(v) for v in active],0.95)*RATE:,.0f} "
            f"| ±${pstdev(weeks)*RATE:,.0f} | ±${pct([abs(v) for v in weeks],0.95)*RATE:,.0f} |"
        )
    lines.append("")
    return lines, paths


def r4_shorts(seasons: list[SeasonData]) -> list[str]:
    lines = ["## R4. Shorts under fair trailing quotes (7-day windows, $20K)", ""]
    lines.append("| Season | Windows | Mean P&L | SD | Win rate | Superstar-after-Jan15 mean | its win rate |")
    lines.append("|---|---:|---:|---:|---:|---:|---:|")
    for s in seasons:
        jan15 = date(s.dates[0].year + 1, 1, 15)
        all_pnl: list[float] = []
        fade_pnl: list[float] = []
        for pid, series in s.series.items():
            tier = s.tier_of(pid)
            index = 0
            while index < len(series):
                start_day = series[index][0]
                quote = s.trailing_at(pid, start_day)
                if quote is None:
                    index += 1
                    continue
                end = start_day + timedelta(days=6)
                total = 0.0
                scan = index
                while scan < len(series) and series[scan][0] <= end:
                    total += quote - series[scan][1]
                    scan += 1
                all_pnl.append(total)
                if tier == "Superstar" and start_day >= jan15:
                    fade_pnl.append(total)
                index = scan
        win = sum(1 for v in all_pnl if v > 0) / len(all_pnl)
        fade_win = (
            sum(1 for v in fade_pnl if v > 0) / len(fade_pnl) if fade_pnl else float("nan")
        )
        lines.append(
            f"| {s.label} | {len(all_pnl):,} | ${fmean(all_pnl)*RATE:+,.0f} "
            f"| ±${pstdev(all_pnl)*RATE:,.0f} | {win:.1%} "
            f"| ${fmean(fade_pnl)*RATE:+,.0f} ({len(fade_pnl)} windows) | {fade_win:.1%} |"
        )
    lines.append("")
    lines.append(
        "Random shorting is ≈ zero-EV before fees in every season (as designed); the "
        "superstar-fade meta is the structural positive-EV short."
    )
    lines.append("")
    return lines


def r5_cadence(seasons: list[SeasonData]) -> list[str]:
    lines = ["## R5. Requote cadence: leak left by each server implementation", ""]
    lines.append("| Season | frozen at open | weekly full requote | nightly half-step | nightly full |")
    lines.append("|---|---:|---:|---:|---:|")
    for s in seasons:
        leaks: dict[str, list[float]] = {k: [] for k in ("frozen", "weekly", "half", "full")}
        for pid, series in s.series.items():
            opening = None
            projs = [p for _, _, p in series if p is not None]
            if projs:
                opening = projs[0]
            if opening is None:
                continue
            quotes = {k: opening for k in leaks}
            history: list[float] = []
            last_week = None
            for d, actual, _ in series:
                trailing = fmean(history[-TRAIL:]) if len(history) >= TRAIL_MIN else None
                if trailing is not None:
                    quotes["full"] = trailing
                    quotes["half"] = 0.5 * quotes["half"] + 0.5 * trailing
                    wk = d.isocalendar()[:2]
                    if wk != last_week:
                        quotes["weekly"] = trailing
                        last_week = wk
                for k in leaks:
                    leaks[k].append(actual - quotes[k])
                history.append(actual)
        cells = " | ".join(
            f"{fmean(leaks[k]):+.3f} (${fmean(leaks[k])*RATE:+,.0f})"
            for k in ("frozen", "weekly", "half", "full")
        )
        lines.append(f"| {s.label} | {cells} |")
    lines.append("")
    lines.append(
        "Leak = mean(actual − market quote) per settled game: what a NEW lock at the "
        "prevailing quote earns for free. Frozen quotes are the money printer; any "
        "trailing requote (weekly is enough) kills ~all of it."
    )
    lines.append("")
    return lines


def r6_retention(seasons: list[SeasonData], paths: dict[str, dict[str, list[float]]]) -> list[str]:
    lines = ["## R6. Retention risk for a fair user ($20K)", ""]
    lines.append("| Season | Roster | P(down after 7 days) | P(down after 28 days) | Max drawdown p50 | p95 |")
    lines.append("|---|---|---:|---:|---:|---:|")
    for s in seasons:
        for name in ("balanced", "stars"):
            daily = paths[s.label][name]
            cum: list[float] = []
            total = 0.0
            for v in daily:
                total += v
                cum.append(total)
            active_start = next(i for i, v in enumerate(daily) if v != 0.0)
            day7 = cum[min(active_start + 6, len(cum) - 1)]
            day28 = cum[min(active_start + 27, len(cum) - 1)]
            peak = -math.inf
            drawdowns: list[float] = []
            worst = 0.0
            for v in cum:
                peak = max(peak, v)
                worst = min(worst, v - peak)
                drawdowns.append(worst)
            window_downs: list[float] = []
            for start in range(active_start, len(cum) - 28, 14):
                seg = cum[start:start + 28]
                seg_peak = -math.inf
                seg_worst = 0.0
                for v in seg:
                    seg_peak = max(seg_peak, v)
                    seg_worst = min(seg_worst, v - seg_peak)
                window_downs.append(seg_worst)
            lines.append(
                f"| {s.label} | {name} | {'yes' if day7 < 0 else 'no'} "
                f"| {'yes' if day28 < 0 else 'no'} "
                f"| ${pct([abs(v) for v in window_downs],0.5)*RATE:,.0f} "
                f"| ${pct([abs(v) for v in window_downs],0.95)*RATE:,.0f} |"
            )
    lines.append("")
    lines.append(
        "Single-path down/up flags are one draw each; the drawdown columns are "
        "rolling 28-day windows (peak-to-trough inside the window)."
    )
    lines.append("")
    return lines


def main() -> int:
    seasons = [SeasonData(label, d, dnt) for label, d, dnt in SEASONS]
    lines = [
        "# Per-game economy v2 — cross-season robustness battery",
        "",
        f"Universes: top {UNIVERSE_SIZE} per season by projected-game count "
        f"({', '.join(f'{s.label}: {len(s.series)} players / {sum(len(v) for v in s.series.values()):,} games' for s in seasons)}). "
        f"Dollar figures at ${RATE/1000:.0f}K/NP.",
        "",
    ]
    lines += r1_anchor_leak(seasons)
    lines += r2_true_last_season(seasons)
    r3_lines, paths = r3_user_bands(seasons)
    lines += r3_lines
    lines += r4_shorts(seasons)
    lines += r5_cadence(seasons)
    lines += r6_retention(seasons, paths)
    out = Path("output/per-game-robustness.md")
    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
