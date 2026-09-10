"""Rate study for per-game economy v2: $/NP, fair costs, and normal-user P&L.

Six descriptive diagnostics over a sample fixed from information available before trading:

A. Production landscape — produced NP per game by tier; the fair-cost table.
B. Noise anatomy — per-game surprise SD by tier; how many roster games land per
   night; the analytic night/week swing a fair-priced 10-slot roster must expect.
C. Archetype replay — star holder, balanced holder,
   bench holder, weekly random rebalancer, participation-oracle streamer,
   momentum chaser) run through the season with costs LOCKED at the trailing
   production anchor on add date. Daily and weekly P&L distributions in NP.
D. Rate sweep — tests A-C expressed in dollars at candidate rates, against
   explicit legibility bands, plus the quote-floor constraint at the bottom of
   the listed universe.
E. Descriptive strategy separation (rate-free; not a skill significance test).
F. Aggregate flow — gross dividend scale, without a net-money-supply claim.

Costs lock at add; dividends pay raw produced NP. These rate-free diagnostics
exclude fees and the monetary quote floor; dollar values are a linear scale
illustration, not a full-policy replay or a validated rate recommendation. The
participation-oracle streamer is excluded from the legibility gate. No network.
"""
from __future__ import annotations

import argparse
import sys
import math
import random
import statistics
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
from typing import Callable, Sequence

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from nba_stock_market.per_game_simulation import load_historical_games

RATES = (10_000, 15_000, 20_000, 25_000, 30_000, 40_000)
UNIVERSE_SIZE = 150
TRAILING_WINDOW = 10
TRAILING_MIN = 3
SLOTS = 10
RANDOM_SEEDS = tuple(range(1, 11))
QUOTE_FLOOR_DOLLARS = 25_000

TIERS = (
    ("Superstar", 20.0, None),
    ("Star", 14.0, 20.0),
    ("Starter", 9.0, 14.0),
    ("Rotation", 5.0, 9.0),
    ("Bench", None, 5.0),
)


def fmean(values: Sequence[float]) -> float:
    return statistics.fmean(values) if values else float("nan")


def pstdev(values: Sequence[float]) -> float:
    return statistics.pstdev(values) if len(values) > 1 else float("nan")


def pct(values: Sequence[float], q: float) -> float:
    if not values:
        return float("nan")
    ordered = sorted(values)
    pos = q * (len(ordered) - 1)
    low = int(math.floor(pos))
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (pos - low)


def money(np_value: float, rate: int) -> str:
    return f"${np_value * rate:+,.0f}"


def opening_date(games, calibration_dates: int = 14) -> date:
    """Trade only after the complete calibration window has been observed."""
    dates = sorted({game.game_date for game in games})
    if len(dates) <= calibration_dates:
        raise ValueError("need more than 14 game dates for the calibration and evaluation windows")
    return dates[calibration_dates]


def asof_universe(games, cutoff: date, limit: int = UNIVERSE_SIZE) -> set[str]:
    """Canonical availability ordering, frozen strictly before the trade date.

    This is a research sample, not a claim about the production listed market.
    Adding future rows cannot change its membership.
    """
    first = {}
    for game in sorted(games, key=lambda g: (g.game_date, g.game_id, g.player_id)):
        if game.game_date < cutoff and game.saved_projection_net_points is not None:
            first.setdefault(game.player_id, game.game_date)
    return {pid for pid, _ in sorted(first.items(), key=lambda item: (item[1], item[0]))[:limit]}


class Study:
    def __init__(self, data_dir: Path | None = None, dnt_dir: Path | None = None,
                 *, games=None, trade_day: date | None = None) -> None:
        games = list(games) if games is not None else load_historical_games(data_dir, dnt_dir)
        if any(not math.isfinite(g.actual_net_points) or
               (g.saved_projection_net_points is not None and not math.isfinite(g.saved_projection_net_points)) for g in games):
            raise ValueError("nonfinite actual or projection in study data")
        self.opening_day = trade_day if trade_day is not None else opening_date(games)
        self.universe = asof_universe(games, self.opening_day)
        if len(self.universe) < SLOTS:
            raise ValueError("fewer than 10 observed players before the trading cutoff")
        self.names: dict[str, str] = {}
        ordered = sorted(games, key=lambda g: (g.game_date, g.game_id, g.player_id))
        self.rows: list[dict[str, object]] = []
        first_proj: dict[str, float] = {}
        history = defaultdict(list)
        for g in ordered:
            if g.player_id not in self.universe:
                continue
            self.names.setdefault(g.player_id, g.player_name)
            proj = g.saved_projection_net_points
            if proj is not None:
                first_proj.setdefault(g.player_id, proj)
            # Strict dates also exclude an earlier same-day record from the quote.
            prior = [actual for day, actual in history[g.player_id] if day < g.game_date]
            trailing = fmean(prior[-TRAILING_WINDOW:]) if len(prior) >= TRAILING_MIN else None
            anchor = trailing if trailing is not None else first_proj.get(g.player_id)
            self.rows.append({"pid": g.player_id, "date": g.game_date,
                              "actual": g.actual_net_points, "proj": proj, "anchor": anchor})
            history[g.player_id].append((g.game_date, g.actual_net_points))
        self.by_date = defaultdict(list)
        self.by_player = defaultdict(list)
        for row in self.rows:
            self.by_date[row["date"]].append(row)
            self.by_player[row["pid"]].append(row)
        end = max(row["date"] for row in self.rows)
        self.dates = [self.opening_day + timedelta(days=i) for i in range((end - self.opening_day).days + 1)]
        if not self.dates:
            raise ValueError("no evaluation dates after calibration")
        self.season_np = {pid: fmean([float(r["actual"]) for r in rows]) for pid, rows in self.by_player.items()}
        self.games_played = {pid: len(rows) for pid, rows in self.by_player.items()}

    # ---- anchors -----------------------------------------------------------
    def anchor_on(self, pid: str, day: date) -> float | None:
        """Anchor quote (NP) for pid as of day: trailing before that date."""
        prior = [
            float(r["actual"])  # type: ignore[arg-type]
            for r in self.by_player.get(pid, [])
            if r["date"] < day  # type: ignore[operator]
        ]
        if len(prior) >= TRAILING_MIN:
            return fmean(prior[-TRAILING_WINDOW:])
        projs = [
            float(r["proj"])  # type: ignore[arg-type]
            for r in self.by_player.get(pid, [])
            if r["date"] <= day and r["proj"] is not None  # type: ignore[operator]
        ]
        return projs[0] if projs else None


# ---- Test A: production landscape ---------------------------------------
def test_a(study: Study) -> list[str]:
    lines = ["## A. Retrospective production landscape (not opening prices)", ""]
    tiered: dict[str, list[tuple[str, float]]] = {name: [] for name, _, _ in TIERS}
    for pid, mean_np in study.season_np.items():
        for name, low, high in TIERS:
            if (low is None or mean_np >= low) and (high is None or mean_np < high):
                tiered[name].append((pid, mean_np))
                break
    lines.append("| Tier | NP/game band | Players | Mean NP | Fair cost band at $15K | at $20K | at $25K |")
    lines.append("|---|---|---:|---:|---|---|---|")
    for name, low, high in TIERS:
        members = tiered[name]
        if not members:
            continue
        band = f"{low if low is not None else 0:.0f}-{high if high is not None else 30:.0f}"
        mean_np = fmean([m for _, m in members])
        lows = min(m for _, m in members)
        highs = max(m for _, m in members)
        def cb(rate: int) -> str:
            return f"${lows*rate/1000:,.0f}K-${highs*rate/1000:,.0f}K"
        lines.append(
            f"| {name} | {band} | {len(members)} | {mean_np:.1f} | {cb(15_000)} | {cb(20_000)} | {cb(25_000)} |"
        )
    lines.append("")
    top = sorted(study.season_np.items(), key=lambda kv: (-kv[1], kv[0]))[:8]
    lines.append("Example fair per-game costs (season produced NP × rate):")
    lines.append("")
    lines.append("| Player | NP/game | at $15K | at $20K | at $25K | at $40K |")
    lines.append("|---|---:|---:|---:|---:|---:|")
    for pid, np_pg in top:
        cells = " | ".join(f"${np_pg * r:,.0f}" for r in (15_000, 20_000, 25_000, 40_000))
        lines.append(f"| {study.names[pid]} | {np_pg:.2f} | {cells} |")
    floor_np = pct(sorted(study.season_np.values()), 0.05)
    lines.append("")
    requirement = (f"p05 alone reaches the $25K floor at ${QUOTE_FLOOR_DOLLARS / floor_np:,.0f}/NP"
                   if floor_np > 0 else "no positive rate lifts this nonpositive p05 mean above the floor")
    lines.append(f"Retrospective p05 production is {floor_np:.2f} NP; {requirement}. Test D checks the minimum player, not p05.")
    lines.append("")
    return lines


# ---- Test B: noise anatomy ------------------------------------------------
def test_b(study: Study) -> list[str]:
    lines = ["## B. Descriptive noise anatomy and an independence approximation", ""]
    surprises_by_tier: dict[str, list[float]] = {name: [] for name, _, _ in TIERS}
    all_edges: list[float] = []
    for row in study.rows:
        if row["date"] < study.opening_day or row["anchor"] is None:
            continue
        edge = float(row["actual"]) - float(row["anchor"])  # type: ignore[arg-type]
        all_edges.append(edge)
        mean_np = study.season_np.get(str(row["pid"]))
        if mean_np is None:
            continue
        for name, low, high in TIERS:
            if (low is None or mean_np >= low) and (high is None or mean_np < high):
                surprises_by_tier[name].append(edge)
                break
    lines.append("| Tier | Games | Per-game edge SD (NP) | SD at $20K |")
    lines.append("|---|---:|---:|---:|")
    for name, _, _ in TIERS:
        vals = surprises_by_tier[name]
        if not vals:
            continue
        lines.append(f"| {name} | {len(vals):,} | {pstdev(vals):.2f} | ±${pstdev(vals)*20_000:,.0f} |")
    sd1 = pstdev(all_edges)
    lines.append(f"| **All listed** | {len(all_edges):,} | {sd1:.2f} | ±${sd1*20_000:,.0f} |")
    lines.append("")
    per_night = [len(study.by_date[day]) for day in study.dates]
    density = fmean(per_night) / len(study.universe)
    exp_games = SLOTS * density
    lines.append(
        f"Schedule density: a listed player plays {density:.2f} games per calendar "
        f"night → a full 10-slot roster catches ≈ {exp_games:.1f} games/night and "
        f"≈ {exp_games * 7:.0f} games/week."
    )
    night_sd = sd1 * math.sqrt(exp_games)
    week_sd = sd1 * math.sqrt(exp_games * 7)
    lines.append("")
    lines.append(
        f"Analytic fair-roster swing: night SD ≈ {night_sd:.1f} NP, week SD ≈ "
        f"{week_sd:.1f} NP (dollar values in test D)."
    )
    lines.append("")
    return lines


# ---- Test C: archetype replay ---------------------------------------------
def replay(
    study: Study,
    pick: Callable[[date, set[str]], set[str] | None],
    start_index: int = 0,
) -> tuple[list[float], int]:
    """Replay a roster policy; returns per-date P&L in NP and add count."""
    roster: dict[str, float] = {}
    daily: list[float] = []
    adds = 0
    for index, day in enumerate(study.dates):
        if index >= start_index:
            want = pick(day, set(roster))
            if want is not None and want != set(roster):
                for pid in list(roster):
                    if pid not in want:
                        del roster[pid]
                for pid in sorted(want):
                    if pid not in roster:
                        anchor = study.anchor_on(pid, day)
                        if anchor is not None:
                            roster[pid] = anchor
                            adds += 1
        pnl = 0.0
        for row in study.by_date[day]:
            pid = str(row["pid"])
            if pid in roster:
                pnl += float(row["actual"]) - roster[pid]  # type: ignore[arg-type]
        daily.append(pnl)
    return daily, adds


def test_c(study: Study) -> tuple[list[str], dict[str, list[float]]]:
    lines = ["## C. Archetype replay: a season of daily P&L (costs locked at add)", ""]
    early_days = sorted(day for day in study.by_date if day < study.opening_day)
    early_proj: dict[str, list[float]] = defaultdict(list)
    for day in early_days:
        for row in study.by_date[day]:
            if row["proj"] is not None:
                early_proj[str(row["pid"])].append(float(row["proj"]))  # type: ignore[arg-type]
    ranked_early = sorted(early_proj, key=lambda pid: (-fmean(early_proj[pid]), pid))
    star_roster = set(ranked_early[:SLOTS])
    mid_start = len(ranked_early) // 2 - SLOTS // 2
    balanced_roster = set(ranked_early[mid_start:mid_start + SLOTS])
    bench_roster = set(ranked_early[-SLOTS - 10:-10] if len(ranked_early) >= SLOTS + 10 else ranked_early[-SLOTS:])

    def fixed(roster: set[str]) -> Callable[[date, set[str]], set[str] | None]:
        state = {"done": False}
        def pick(day: date, current: set[str]) -> set[str] | None:
            if state["done"]:
                return None
            state["done"] = True
            return roster
        return pick

    def weekly_random(seed: int) -> Callable[[date, set[str]], set[str] | None]:
        rng = random.Random(seed)
        state = {"week": None}
        def pick(day: date, current: set[str]) -> set[str] | None:
            wk = day.isocalendar()[:2]
            if state["week"] == wk:
                return None
            state["week"] = wk
            pool = sorted(pid for pid in study.universe if study.anchor_on(pid, day) is not None)
            rng.shuffle(pool)
            return set(pool[:SLOTS])
        return pick

    def streamer(day: date, current: set[str]) -> set[str] | None:
        tonight = sorted(
            (r for r in study.by_date[day] if r["proj"] is not None),
            key=lambda r: (-float(r["proj"]), str(r["pid"])),  # type: ignore[arg-type]
        )
        want = {str(r["pid"]) for r in tonight[:SLOTS]}
        return want or None

    momentum_state: dict[str, object] = {"week": None}
    def momentum(day: date, current: set[str]) -> set[str] | None:
        wk = day.isocalendar()[:2]
        if momentum_state["week"] == wk:
            return None
        momentum_state["week"] = wk
        scored: list[tuple[float, str]] = []
        for pid in study.universe:
            prior = [
                float(r["actual"])  # type: ignore[arg-type]
                for r in study.by_player.get(pid, [])
                if r["date"] < day  # type: ignore[operator]
            ]
            if len(prior) >= 6:
                hot = fmean(prior[-3:]) - fmean(prior[-TRAILING_WINDOW:])
                scored.append((hot, pid))
        scored.sort(key=lambda t: (-t[0], t[1]))
        return {pid for _, pid in scored[:SLOTS]}

    results: dict[str, list[float]] = {}
    add_counts: dict[str, float] = {}
    for label, policy in (
        ("star holder", fixed(star_roster)),
        ("balanced holder", fixed(balanced_roster)),
        ("bench holder", fixed(bench_roster)),
        ("participation-oracle streamer", streamer),
        ("momentum chaser", momentum),
    ):
        daily, adds = replay(study, policy)
        results[label] = daily
        add_counts[label] = adds
    random_daily: list[list[float]] = []
    random_adds: list[int] = []
    for seed in RANDOM_SEEDS:
        daily, adds = replay(study, weekly_random(seed))
        random_daily.append(daily)
        random_adds.append(adds)
    pooled = [v for daily in random_daily for v in daily]
    results["weekly random (10 seeds pooled)"] = pooled
    add_counts["weekly random (10 seeds pooled)"] = fmean([float(a) for a in random_adds])

    lines.append("Calendar-day observations include zero-return days. The streamer knows realized participation; it is an oracle diagnostic, not an executable policy.")
    lines.append("")
    lines.append("| Archetype | Adds | Season P&L (NP) | Daily mean | Daily SD | Daily p05 | Daily p95 |")
    lines.append("|---|---:|---:|---:|---:|---:|---:|")
    for label, daily in results.items():
        active = daily
        season = sum(daily) if "pooled" not in label else sum(daily) / len(RANDOM_SEEDS)
        lines.append(
            f"| {label} | {add_counts[label]:.0f} | {season:+.0f} | {fmean(active):+.2f} "
            f"| {pstdev(active):.1f} | {pct(active, 0.05):+.1f} | {pct(active, 0.95):+.1f} |"
        )
    lines.append("")
    lines.append(
        "Random-seed season spread (weekly random, NP): "
        + ", ".join(f"{sum(d):+.0f}" for d in random_daily)
    )
    lines.append("")

    weekly: dict[str, list[float]] = {}
    for label, daily in results.items():
        if "pooled" in label:
            per_seed = random_daily
            buckets: list[float] = []
            for daily_seed in per_seed:
                acc: dict[tuple[int, int], float] = defaultdict(float)
                for day, v in zip(study.dates, daily_seed):
                    acc[day.isocalendar()[:2]] += v
                buckets.extend(acc.values())
            weekly[label] = buckets
        else:
            acc = defaultdict(float)
            for day, v in zip(study.dates, daily):
                acc[day.isocalendar()[:2]] += v
            weekly[label] = list(acc.values())
    lines.append("| Archetype | Weekly mean (NP) | Weekly SD | Weekly p05 | Weekly p95 |")
    lines.append("|---|---:|---:|---:|---:|")
    for label, buckets in weekly.items():
        lines.append(
            f"| {label} | {fmean(buckets):+.2f} | {pstdev(buckets):.1f} "
            f"| {pct(buckets, 0.05):+.1f} | {pct(buckets, 0.95):+.1f} |"
        )
    lines.append("")
    return lines, {**{k: v for k, v in results.items()}, "__weekly__": weekly["balanced holder"], "__weekly_star__": weekly["star holder"]}


# ---- Test D: rate sweep ----------------------------------------------------
def rate_band_failures(night, week, season_sd, minimum_cost, star_cost):
    failures = []
    if minimum_cost < QUOTE_FLOOR_DOLLARS:
        failures.append("floor binds")
    if not 150_000 <= night <= 750_000:
        failures.append("night outside band")
    if not 500_000 <= week <= 2_000_000:
        failures.append("week outside band")
    if not 0 <= season_sd < 10_000_000:
        failures.append("season spread outside band")
    if star_cost >= 1_000_000:
        failures.append("star cost not under $1M")
    if not all(math.isfinite(v) for v in (night, week, season_sd, minimum_cost, star_cost)):
        failures.append("nonfinite input")
    return failures


def test_d(study: Study, results: dict[str, list[float]]) -> list[str]:
    lines = ["## D. Rate sweep against legibility bands", ""]
    balanced = results["balanced holder"]
    star = results["star holder"]
    weekly_bal = results["__weekly__"]
    night_p95 = pct([abs(v) for v in balanced], 0.95)
    night_p99_star = pct([abs(v) for v in star], 0.99)
    week_p95 = pct([abs(v) for v in weekly_bal], 0.95)
    season_spread = pstdev([sum(v) for k, v in results.items() if not k.startswith("__") and "pooled" not in k and "oracle" not in k])
    floor_np = min(study.season_np.values())
    top_np = max(study.season_np.values())
    lines.append(
        "Bands: a normal night p95 should land between $150K and $750K; a normal "
        "week p95 between $500K and $2M; the non-oracle season archetype SD below $10M; "
        "the minimum retrospective player mean above the $25K floor; a superstar "
        "cost under $1M/game so the anchor column stays readable."
    )
    lines.append("")
    lines.append("| Rate | Star cost/game | Minimum player cost | Night p95 (balanced) | Worst star night p99 | Week p95 | Season archetype SD | Floor OK | Verdict |")
    lines.append("|---|---:|---:|---:|---:|---:|---:|:---:|---|")
    for rate in RATES:
        floor_ok = floor_np * rate >= QUOTE_FLOOR_DOLLARS
        night = night_p95 * rate
        week = week_p95 * rate
        star_cost = top_np * rate
        verdict_bits = rate_band_failures(night, week, season_spread * rate, floor_np * rate, star_cost)
        verdict = "; ".join(verdict_bits) if verdict_bits else "bands pass (diagnostic only)"
        lines.append(
            f"| ${rate/1000:.0f}K | ${star_cost:,.0f} | ${floor_np*rate:,.0f} "
            f"| ±${night:,.0f} | ±${night_p99_star*rate:,.0f} | ±${week:,.0f} "
            f"| ${season_spread*rate:,.0f} | {'yes' if floor_ok else 'no'} | {verdict} |"
        )
    lines.append("")
    return lines


# ---- Test E: skill separation ---------------------------------------------
def test_e(results: dict[str, list[float]]) -> list[str]:
    lines = ["## E. Descriptive strategy differences (rate-free; not a skill test)", ""]
    star = sum(results["star holder"])
    bench = sum(results["bench holder"])
    streamer = sum(results["participation-oracle streamer"])
    momentum = sum(results["momentum chaser"])
    pooled_daily = results["weekly random (10 seeds pooled)"]
    per_seed_totals: list[float] = []
    chunk = len(pooled_daily) // len(RANDOM_SEEDS)
    for i in range(len(RANDOM_SEEDS)):
        per_seed_totals.append(sum(pooled_daily[i * chunk:(i + 1) * chunk]))
    rand_mean = fmean(per_seed_totals)
    rand_sd = pstdev(per_seed_totals)
    def distance(value):
        return f"{(value - rand_mean) / rand_sd:+.1f}σ" if rand_sd > 0 else "undefined (zero seed variance)"
    lines.append(
        f"Weekly-random season P&L across 10 seeds: mean {rand_mean:+.0f} NP, "
        f"SD {rand_sd:.0f} NP. Archetype season totals (NP): star {star:+.0f}, "
        f"bench {bench:+.0f}, streamer {streamer:+.0f}, momentum {momentum:+.0f}."
    )
    lines.append("")
    lines.append(
        "Distance from random in random-SDs: "
        f"star {distance(star)}, bench {distance(bench)}, "
        f"oracle streamer {distance(streamer)}, momentum {distance(momentum)}. "
        "These signed distances are descriptive, not significance tests."
    )
    lines.append("")
    return lines


# ---- Test F: aggregate flow -------------------------------------------------
def test_f(study: Study) -> list[str]:
    lines = ["## F. Gross dividend scale (not net money supply)", ""]
    nightly_np = [sum(float(r["actual"]) for r in study.by_date[day]) for day in study.dates]  # type: ignore[arg-type]
    per_night = fmean(nightly_np)
    lines.append(f"| Rate | Sample dividend flow/calendar night ({len(study.universe)} players) | Illustrative p75 roster gross flow/night |")
    lines.append("|---|---:|---:|")
    density = fmean([len(study.by_date[day]) for day in study.dates]) / len(study.universe)
    roster_np = pct(sorted(study.season_np.values()), 0.75) * SLOTS * density
    for rate in RATES:
        lines.append(
            f"| ${rate/1000:.0f}K | ${per_night*rate:,.0f} | ≈ ${roster_np*rate:,.0f} |"
        )
    lines.append("")
    lines.append(
        "The illustrative roster uses the retrospective p75 player mean and average schedule density. "
        "Gross dividend totals alone do not estimate net money creation; that requires actual costs, fees and position counts."
    )
    lines.append("")
    return lines


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=Path("data/raw/2025-26"))
    parser.add_argument("--dnt-dir", type=Path, default=Path("data/raw/dnt"))
    parser.add_argument("--output", type=Path, default=Path("output/per-game-rate-study.md"))
    args = parser.parse_args(argv)

    study = Study(args.data_dir, args.dnt_dir)
    lines = [
        "# Per-game economy v2 — rate, fair-cost, and user-P&L study",
        "",
        f"Sample: {len(study.universe)} players selected by first projection availability strictly before {study.opening_day}; "
        f"{len(study.rows):,} total player-games including calibration; {len(study.dates)} evaluation calendar days. "
        f"Costs lock at the trailing-{TRAILING_WINDOW} produced-NP anchor on add "
        f"date ({TRAILING_MIN}+ prior games, else the saved pregame projection). "
        "Gross P&L excludes fees and quote floors; linear dollar views are diagnostics only. "
        "This partial-policy study cannot approve a rate, cap, or skill claim.",
        "",
    ]
    lines += test_a(study)
    lines += test_b(study)
    c_lines, results = test_c(study)
    lines += c_lines
    lines += test_d(study, results)
    lines += test_e(results)
    lines += test_f(study)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
