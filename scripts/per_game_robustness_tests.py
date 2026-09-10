"""Cross-season descriptive quote and gross residual diagnostics.

Retrospective cohorts are explicitly identified. Fixed-roster decisions use only
prior observations. Dollar figures are illustrative conversions, not validated
rates or full-policy user P&L; no fees, floor, cash budget or price impact is run.
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
from scripts.per_game_margin_study import prior_only_locks, prior_rosters

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
        if not games:
            raise ValueError(f"no historical games for {label}")
        counts: dict[str, int] = defaultdict(int)
        for g in games:
            if g.saved_projection_net_points is not None:
                counts[g.player_id] += 1
        self.universe = {
            p for p, _ in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:UNIVERSE_SIZE]
        }
        if not counts:
            raise ValueError(f"no saved pregame projections for {label}; projection diagnostics unavailable")
        self.projection_count = sum(counts.values())
        self.all_dated_series = defaultdict(list)
        self.full_by_date = defaultdict(list)
        self.series: dict[str, list[tuple[date, float, float | None]]] = defaultdict(list)
        self.all_series: dict[str, list[float]] = defaultdict(list)
        for g in sorted(games, key=lambda g: (g.game_date, g.game_id, g.player_id)):
            self.all_series[g.player_id].append(g.actual_net_points)
            self.all_dated_series[g.player_id].append((g.game_date, g.actual_net_points, g.saved_projection_net_points))
            self.full_by_date[g.game_date].append((g.player_id, g.actual_net_points, g.saved_projection_net_points))
            if g.player_id in self.universe:
                self.series[g.player_id].append(
                    (g.game_date, g.actual_net_points, g.saved_projection_net_points)
                )
        self.by_date: dict[date, list[tuple[str, float, float | None]]] = defaultdict(list)
        for pid, s in self.series.items():
            for d, a, p in s:
                self.by_date[d].append((pid, a, p))
        self.dates = sorted(self.full_by_date)
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
        for day in s.dates:
            for pid, actual, proj in s.by_date[day]:
                trailing = s.trailing_at(pid, day)
                if trailing is not None:
                    trail_edges.append(actual - trailing)
                if proj is not None:
                    proj_edges.append(actual - proj)
        lines.append(
            f"| {s.label} | {len(trail_edges):,} | {fmean(trail_edges):+.3f} "
            f"(${fmean(trail_edges)*RATE:+,.0f}) | {fmean(proj_edges):+.3f} "
            f"(${fmean(proj_edges)*RATE:+,.0f}) |"
        )
    lines.append("")
    return lines


def r2_true_last_season(seasons: list[SeasonData]) -> list[str]:
    lines = ["## R2. Prior-season mean residuals in the retrospective cohort", ""]
    lines.append(
        "Lock every listed player at his PRIOR season's produced NP/game (20+ games "
        "played there), then measure mean(actual − locked) per observed game. Tiers use the prior mean. Current-season cohort is retrospective; this is not a full game ledger."
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
            tier = next((name for name, low, high in TIERS if lock is not None and (low is None or lock >= low) and (high is None or lock < high)), None)
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
        "a separately evaluated entry rule; no premium is selected here."
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
        daily.append(sum(a - roster[pid] for pid, a, _ in s.full_by_date[day] if pid in roster))
    return daily


def r3_user_bands(seasons: list[SeasonData]) -> tuple[list[str], dict[str, dict[str, list[float]]]]:
    lines = ["## R3. Prior-only fixed-roster gross residuals ($20K illustration)", ""]
    lines.append("Pool, rankings and fixed mean-cost proxies use only dates before entry (the 11th observed game date; at least three prior observations). No final-season means, projections after entry, signing fees, floors or later trades enter this diagnostic.")
    lines.append("")
    lines.append("| Season | Roster | Season residual | Night SD | Night abs-p95 | Week SD | Week abs-p95 |")
    lines.append("|---|---|---:|---:|---:|---:|---:|")
    paths = {}
    for s in seasons:
        if len(s.dates) <= 10:
            raise ValueError(f"not enough game dates for fixed-roster replay: {s.label}")
        lock_day = s.dates[10]
        actual_series = {pid: [(day, actual) for day, actual, _ in values]
                         for pid, values in s.all_dated_series.items()}
        locks = prior_only_locks(actual_series, lock_day)
        rosters = prior_rosters(locks)
        season_paths = {}
        def active_values(daily, held):
            return [v for day, v in zip(s.dates, daily) if day >= lock_day
                    and any(pid in held for pid, _, _ in s.full_by_date[day])]
        def weeks_after_entry(daily):
            pairs = [(day, value) for day, value in zip(s.dates, daily) if day >= lock_day]
            return _weekly_totals([d for d, _ in pairs], [v for _, v in pairs])
        for key, name in (("balanced", "middle prior mean"), ("stars", "high prior mean")):
            roster = {pid: locks[pid] for pid in rosters[name]}
            daily = _replay_fixed(s, roster, lock_day)
            season_paths[key] = daily
            active = active_values(daily, roster)
            weeks = weeks_after_entry(daily)
            lines.append(f"| {s.label} | {name} | ${sum(daily)*RATE:+,.0f} | ${pstdev(active)*RATE:,.0f} | ${pct([abs(v) for v in active],.95)*RATE:,.0f} | ${pstdev(weeks)*RATE:,.0f} | ${pct([abs(v) for v in weeks],.95)*RATE:,.0f} |")
        rand_daily_all = []
        random_active = []
        for seed in SEEDS:
            rng = random.Random(seed)
            pool = sorted(pid for pid, value in locks.items() if value > 0)
            rng.shuffle(pool)
            roster = {pid: locks[pid] for pid in pool[:SLOTS]}
            daily = _replay_fixed(s, roster, lock_day)
            rand_daily_all.append(daily)
            random_active.extend(active_values(daily, roster))
        totals = [sum(values) for values in rand_daily_all]
        weeks = [value for values in rand_daily_all for value in weeks_after_entry(values)]
        season_paths["random"] = rand_daily_all[0]
        season_paths["__random_totals__"] = totals
        paths[s.label] = season_paths
        lines.append(f"| {s.label} | random x{len(SEEDS)} | mean ${fmean(totals)*RATE:+,.0f} (SD ${pstdev(totals)*RATE:,.0f}) | ${pstdev(random_active)*RATE:,.0f} | ${pct([abs(v) for v in random_active],.95)*RATE:,.0f} | ${pstdev(weeks)*RATE:,.0f} | ${pct([abs(v) for v in weeks],.95)*RATE:,.0f} |")
    lines.append("")
    return lines, paths


def r4_shorts(seasons: list[SeasonData]) -> list[str]:
    lines = ["## R4. Gross inverse residuals at prior trailing/projected quotes (7-calendar-day windows)", ""]
    lines.append("| Season | Windows | Mean P&L | SD | Win rate | Prior quote at least 20 NP after January 15 mean | its win rate |")
    lines.append("|---|---:|---:|---:|---:|---:|---:|")
    for s in seasons:
        jan15 = date(s.dates[0].year + 1, 1, 15)
        all_pnl: list[float] = []
        fade_pnl: list[float] = []
        for pid, series in s.series.items():
            index = 0
            while index < len(series):
                start_day = series[index][0]
                quote = s.trailing_at(pid, start_day)
                if quote is None:
                    index += 1
                    continue
                end = start_day + timedelta(days=6)
                if end > s.dates[-1]:
                    break
                total = 0.0
                scan = index
                while scan < len(series) and series[scan][0] <= end:
                    total += quote - series[scan][1]
                    scan += 1
                all_pnl.append(total)
                if quote >= 20.0 and start_day >= jan15:
                    fade_pnl.append(total)
                index = scan
        win = sum(1 for v in all_pnl if v > 0) / len(all_pnl) if all_pnl else math.nan
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
        "These enumerate complete seven-calendar-day player windows in a retrospective cohort, not random or capacity-limited user portfolios. Quotes use earlier actuals once three exist, otherwise the first available dated pregame projection. The high-quote subset is classified at window entry, not from the final season. Means and win shares are observed gross residuals; no statistical edge, zero-EV guarantee or net-of-fee strategy is established."
    )
    lines.append("")
    return lines


def r5_cadence(seasons: list[SeasonData]) -> list[str]:
    lines = ["## R5. Quote-cadence gross residuals after first available projection", ""]
    lines.append("| Season | Observations | frozen at entry | weekly full | half-step each league game date | full each league game date |")
    lines.append("|---|---:|---:|---:|---:|---:|")
    for s in seasons:
        leaks = {key: [] for key in ("frozen", "weekly", "half", "full")}
        slate_dates = getattr(s, "dates", sorted({day for values in s.series.values() for day, _, _ in values}))
        for pid, series in s.series.items():
            quotes = None
            last_week = None
            by_day = defaultdict(list)
            for day, actual, projection in series:
                by_day[day].append((actual, projection))
            for day in slate_dates:
                week = day.isocalendar()[:2]
                weekly_update_day = week != last_week
                # The schedule advances even without a quote or enough history.
                # Warmup becoming ready later cannot move this week's update.
                last_week = week
                today = by_day[day]
                available = [projection for _, projection in today if projection is not None]
                if quotes is None and available:
                    quotes = dict.fromkeys(leaks, available[0])
                prior = [actual for observed, actual, _ in series if observed < day]
                if quotes is None:
                    continue
                if len(prior) >= TRAIL_MIN:
                    trailing = fmean(prior[-TRAIL:])
                    quotes["full"] = trailing
                    quotes["half"] = .5*quotes["half"] + .5*trailing
                    if weekly_update_day:
                        quotes["weekly"] = trailing
                for actual, _ in today:
                    for key in leaks:
                        leaks[key].append(actual-quotes[key])
        cells = " | ".join(f"{fmean(leaks[key]):+.3f} (${fmean(leaks[key])*RATE:+,.0f})" for key in leaks)
        lines.append(f"| {s.label} | {len(leaks['frozen'])} | {cells} |")
    lines += ["", "A saved projection is available only on its recorded pregame date; earlier games are excluded rather than backfilled. Updates occur on league game dates even when this player has no game; weekly updates occur on the first such date of an ISO week. If no quote or fewer than three prior actuals are available then, the weekly update is skipped until the next week; warmup completion does not trigger a midweek update. Residual means are descriptive and can change sign or size by season. This does not establish a money-printer claim, quote fairness, or a preferred cadence.", ""]
    return lines


def max_drawdown(daily):
    total = peak = worst = 0.0
    for value in daily:
        total += value
        peak = max(peak, total)
        worst = max(worst, peak-total)
    return worst


def path_risk(dates, daily, start):
    if len(dates) != len(daily) or not dates:
        raise ValueError("risk path needs matching nonempty dates and values")
    by_date = defaultdict(float)
    for day, value in zip(dates, daily):
        if day >= start:
            by_date[day] += value
    end = max(dates)
    calendar = [start + timedelta(days=i) for i in range(max(0, (end-start).days+1))]
    values = [by_date[day] for day in calendar]
    def at(days):
        return sum(values[:days]) if len(values) >= days else None
    # Each complete window starts from a zero baseline, preserving an initial loss.
    windows = [max_drawdown(values[i:i+28]) for i in range(0, max(0,len(values)-27),14)]
    return {"day7":at(7), "day28":at(28), "max_drawdown":max_drawdown(values), "window_drawdowns":windows}


def r6_retention(seasons: list[SeasonData], paths: dict[str, dict[str, list[float]]]) -> list[str]:
    lines = ["## R6. Realized path risk ($20K illustration; not retention probability)", ""]
    lines.append("| Season | Roster | Down after 7 calendar days? | Down after 28 calendar days? | Full-path max drawdown | 28-day window p50 | p95 |")
    lines.append("|---|---|---|---|---:|---:|---:|")
    for s in seasons:
        for name in ("balanced", "stars"):
            risk = path_risk(s.dates, paths[s.label][name], s.dates[10])
            flag = lambda value: "not observed" if value is None else ("yes" if value < 0 else "no")
            windows = risk["window_drawdowns"]
            cells = (f"${pct(windows,.5)*RATE:,.0f} | ${pct(windows,.95)*RATE:,.0f}" if windows else "not observed | not observed")
            lines.append(f"| {s.label} | {name} | {flag(risk['day7'])} | {flag(risk['day28'])} | ${risk['max_drawdown']*RATE:,.0f} | {cells} |")
    lines += ["", "Days are elapsed calendar days from entry, including dates without games. Each drawdown includes loss from the zero starting balance. Quantiles describe complete rolling 28-calendar-day windows sampled every 14 days; overlapping windows are not independent trials or retention probabilities.", ""]
    return lines


def main() -> int:
    seasons = [SeasonData(label, d, dnt) for label, d, dnt in SEASONS]
    lines = [
        "# Per-game economy v2 — cross-season robustness battery",
        "",
        f"Descriptive cohorts: retrospective top {UNIVERSE_SIZE} per season by full-season projected-game count "
        f"({', '.join(f'{s.label}: {len(s.series)} players / {sum(len(v) for v in s.series.values()):,} games' for s in seasons)}). "
        f"Dollar figures at ${RATE/1000:.0f}K/NP are illustrative, not rate recommendations. R3 uses a separate prior-only cohort. Saved projections are assumed available on their dated game; cache retrieval does not independently prove historical publication time.",
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
