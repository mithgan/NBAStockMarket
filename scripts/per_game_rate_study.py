"""Rate study for per-game economy v2: $/NP, fair costs, and normal-user P&L.

Six deterministic tests over the cached 2025-26 season (top-150 listed universe):

A. Production landscape — produced NP per game by tier; the fair-cost table.
B. Noise anatomy — per-game surprise SD by tier; how many roster games land per
   night; the analytic night/week swing a fair-priced 10-slot roster must expect.
C. Archetype replay — seven user archetypes (star holder, balanced holder,
   bench holder, 10x random fixed, weekly random rebalancer, nightly streamer,
   momentum chaser) run through the season with costs LOCKED at the trailing
   production anchor on add date. Daily and weekly P&L distributions in NP.
D. Rate sweep — tests A-C expressed in dollars at candidate rates, against
   explicit legibility bands, plus the quote-floor constraint at the bottom of
   the listed universe.
E. Skill separation — does a full season separate skill from luck (rate-free).
F. Aggregate flow — gross dividend flow per user-night (economy "money supply").

Costs lock at add; dividends pay raw produced NP. Fees excluded here (see
output/per-game-balance-study.md section 3). No network, no RNG outside the
seeded random archetypes.
"""
from __future__ import annotations

import argparse
import math
import random
import statistics
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
from typing import Callable, Sequence

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


class Study:
    def __init__(self, data_dir: Path, dnt_dir: Path) -> None:
        games = load_historical_games(data_dir, dnt_dir)
        counts: dict[str, int] = defaultdict(int)
        for g in games:
            if g.saved_projection_net_points is not None:
                counts[g.player_id] += 1
        ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
        self.universe = {pid for pid, _ in ranked[:UNIVERSE_SIZE]}
        self.names: dict[str, str] = {}
        ordered = sorted(games, key=lambda g: (g.game_date, g.game_id, g.player_id))
        self.rows: list[dict[str, object]] = []
        first_proj: dict[str, float] = {}
        history: dict[str, list[float]] = defaultdict(list)
        for g in ordered:
            if g.player_id not in self.universe:
                continue
            self.names.setdefault(g.player_id, g.player_name)
            proj = g.saved_projection_net_points
            if proj is not None and g.player_id not in first_proj:
                first_proj[g.player_id] = proj
            prior = history[g.player_id]
            trailing = (
                fmean(prior[-TRAILING_WINDOW:]) if len(prior) >= TRAILING_MIN else None
            )
            anchor = trailing if trailing is not None else (
                proj if proj is not None else first_proj.get(g.player_id)
            )
            self.rows.append(
                {
                    "pid": g.player_id,
                    "date": g.game_date,
                    "actual": g.actual_net_points,
                    "proj": proj,
                    "anchor": anchor,
                }
            )
            history[g.player_id].append(g.actual_net_points)
        self.by_date: dict[date, list[dict[str, object]]] = defaultdict(list)
        for row in self.rows:
            self.by_date[row["date"]].append(row)  # type: ignore[index]
        self.dates = sorted(self.by_date)
        self.season_np: dict[str, float] = {}
        by_player: dict[str, list[float]] = defaultdict(list)
        for row in self.rows:
            by_player[str(row["pid"])].append(float(row["actual"]))  # type: ignore[arg-type]
        for pid, vals in by_player.items():
            if len(vals) >= 20:
                self.season_np[pid] = fmean(vals)
        self.games_played = {pid: len(v) for pid, v in by_player.items()}

    # ---- anchors -----------------------------------------------------------
    def anchor_on(self, pid: str, day: date) -> float | None:
        """Anchor quote (NP) for pid as of day: trailing before that date."""
        prior = [
            float(r["actual"])  # type: ignore[arg-type]
            for r in self.rows
            if r["pid"] == pid and r["date"] < day  # type: ignore[operator]
        ]
        if len(prior) >= TRAILING_MIN:
            return fmean(prior[-TRAILING_WINDOW:])
        projs = [
            float(r["proj"])  # type: ignore[arg-type]
            for r in self.rows
            if r["pid"] == pid and r["date"] <= day and r["proj"] is not None  # type: ignore[operator]
        ]
        return projs[0] if projs else None


# ---- Test A: production landscape ---------------------------------------
def test_a(study: Study) -> list[str]:
    lines = ["## A. Production landscape and the fair-cost table", ""]
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
            return f"${max(lows,0)*rate/1000:,.0f}K-${highs*rate/1000:,.0f}K"
        lines.append(
            f"| {name} | {band} | {len(members)} | {mean_np:.1f} | {cb(15_000)} | {cb(20_000)} | {cb(25_000)} |"
        )
    lines.append("")
    top = sorted(study.season_np.items(), key=lambda kv: -kv[1])[:8]
    lines.append("Example fair per-game costs (season produced NP × rate):")
    lines.append("")
    lines.append("| Player | NP/game | at $15K | at $20K | at $25K | at $40K |")
    lines.append("|---|---:|---:|---:|---:|---:|")
    for pid, np_pg in top:
        cells = " | ".join(f"${np_pg * r:,.0f}" for r in (15_000, 20_000, 25_000, 40_000))
        lines.append(f"| {study.names[pid]} | {np_pg:.2f} | {cells} |")
    floor_np = pct(sorted(study.season_np.values()), 0.05)
    lines.append("")
    lines.append(
        f"Bottom of the listed universe (p05 season NP/game): {floor_np:.2f} NP. "
        f"The ${QUOTE_FLOOR_DOLLARS/1000:.0f}K quote floor stops distorting the bench "
        f"only when rate ≥ ${QUOTE_FLOOR_DOLLARS / max(floor_np, 0.01):,.0f}/NP."
    )
    lines.append("")
    return lines


# ---- Test B: noise anatomy ------------------------------------------------
def test_b(study: Study) -> list[str]:
    lines = ["## B. Noise anatomy: what one night of a fair roster must swing", ""]
    surprises_by_tier: dict[str, list[float]] = {name: [] for name, _, _ in TIERS}
    all_edges: list[float] = []
    for row in study.rows:
        if row["anchor"] is None:
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
    per_night = [len(v) for v in study.by_date.values()]
    density = fmean(per_night) / UNIVERSE_SIZE
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
    start_index: int = 10,
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
                for pid in want:
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
    early_days = study.dates[:14]
    early_proj: dict[str, list[float]] = defaultdict(list)
    for day in early_days:
        for row in study.by_date[day]:
            if row["proj"] is not None:
                early_proj[str(row["pid"])].append(float(row["proj"]))  # type: ignore[arg-type]
    ranked_early = sorted(early_proj, key=lambda pid: -fmean(early_proj[pid]))
    star_roster = set(ranked_early[:SLOTS])
    mid_start = len(ranked_early) // 2 - SLOTS // 2
    balanced_roster = set(ranked_early[mid_start:mid_start + SLOTS])
    bench_roster = set(ranked_early[-SLOTS - 10:-10])

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
                for r in study.rows
                if r["pid"] == pid and r["date"] < day  # type: ignore[operator]
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
        ("nightly streamer", streamer),
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

    lines.append("| Archetype | Adds | Season P&L (NP) | Daily mean | Daily SD | Daily p05 | Daily p95 |")
    lines.append("|---|---:|---:|---:|---:|---:|---:|")
    for label, daily in results.items():
        active = [d for d in daily if d != 0.0]
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
def test_d(study: Study, results: dict[str, list[float]]) -> list[str]:
    lines = ["## D. Rate sweep against legibility bands", ""]
    balanced = [d for d in results["balanced holder"] if d != 0.0]
    star = [d for d in results["star holder"] if d != 0.0]
    weekly_bal = results["__weekly__"]
    night_p95 = pct([abs(v) for v in balanced], 0.95)
    night_p99_star = pct([abs(v) for v in star], 0.99)
    week_p95 = pct([abs(v) for v in weekly_bal], 0.95)
    season_spread = pstdev([sum(v) for k, v in results.items() if not k.startswith("__") and "pooled" not in k])
    floor_np = pct(sorted(study.season_np.values()), 0.05)
    top_np = max(study.season_np.values())
    lines.append(
        "Bands: a normal night p95 should land between $150K and $750K; a normal "
        "week p95 between $500K and $2M; the season archetype spread in single-digit "
        "$M; the whole listed universe priced above the $25K floor; a superstar "
        "cost under $1M/game so the anchor column stays readable."
    )
    lines.append("")
    lines.append("| Rate | Star cost/game | p05 player cost | Night p95 (balanced) | Worst star night p99 | Week p95 | Season archetype SD | Floor OK | Verdict |")
    lines.append("|---|---:|---:|---:|---:|---:|---:|:---:|---|")
    for rate in RATES:
        floor_ok = floor_np * rate >= QUOTE_FLOOR_DOLLARS
        night = night_p95 * rate
        week = week_p95 * rate
        star_cost = top_np * rate
        verdict_bits = []
        if not floor_ok:
            verdict_bits.append("floor distorts bench")
        if night < 150_000:
            verdict_bits.append("nights feel flat")
        if night > 750_000:
            verdict_bits.append("nights too violent")
        if week > 2_000_000:
            verdict_bits.append("weeks too violent")
        if star_cost > 1_000_000:
            verdict_bits.append("star cost 7 figures")
        verdict = "; ".join(verdict_bits) if verdict_bits else "**in band**"
        lines.append(
            f"| ${rate/1000:.0f}K | ${star_cost:,.0f} | ${floor_np*rate:,.0f} "
            f"| ±${night:,.0f} | ±${night_p99_star*rate:,.0f} | ±${week:,.0f} "
            f"| ${season_spread*rate:,.0f} | {'yes' if floor_ok else 'no'} | {verdict} |"
        )
    lines.append("")
    return lines


# ---- Test E: skill separation ---------------------------------------------
def test_e(results: dict[str, list[float]]) -> list[str]:
    lines = ["## E. Skill separation over one season (rate-free)", ""]
    star = sum(results["star holder"])
    bench = sum(results["bench holder"])
    streamer = sum(results["nightly streamer"])
    momentum = sum(results["momentum chaser"])
    pooled_daily = results["weekly random (10 seeds pooled)"]
    per_seed_totals: list[float] = []
    chunk = len(pooled_daily) // len(RANDOM_SEEDS)
    for i in range(len(RANDOM_SEEDS)):
        per_seed_totals.append(sum(pooled_daily[i * chunk:(i + 1) * chunk]))
    rand_mean = fmean(per_seed_totals)
    rand_sd = pstdev(per_seed_totals)
    lines.append(
        f"Weekly-random season P&L across 10 seeds: mean {rand_mean:+.0f} NP, "
        f"SD {rand_sd:.0f} NP. Archetype season totals (NP): star {star:+.0f}, "
        f"bench {bench:+.0f}, streamer {streamer:+.0f}, momentum {momentum:+.0f}."
    )
    lines.append("")
    lines.append(
        "Distance from random in random-SDs: "
        f"star {abs(star - rand_mean) / rand_sd:.1f}σ, "
        f"bench {abs(bench - rand_mean) / rand_sd:.1f}σ, "
        f"streamer {abs(streamer - rand_mean) / rand_sd:.1f}σ, "
        f"momentum {abs(momentum - rand_mean) / rand_sd:.1f}σ."
    )
    lines.append("")
    return lines


# ---- Test F: aggregate flow -------------------------------------------------
def test_f(study: Study) -> list[str]:
    lines = ["## F. Aggregate dividend flow (the money supply per user)", ""]
    nightly_np = [sum(float(r["actual"]) for r in rows) for rows in study.by_date.values()]  # type: ignore[arg-type]
    per_night = fmean(nightly_np)
    lines.append("| Rate | League-wide dividend flow/night (150 listed) | One full roster's gross flow/night |")
    lines.append("|---|---:|---:|")
    density = fmean([len(v) for v in study.by_date.values()]) / UNIVERSE_SIZE
    roster_np = pct(sorted(study.season_np.values()), 0.75) * SLOTS * density
    for rate in RATES:
        lines.append(
            f"| ${rate/1000:.0f}K | ${per_night*rate:,.0f} | ≈ ${roster_np*rate:,.0f} in, "
            f"≈ the same out in costs |"
        )
    lines.append("")
    lines.append(
        "Under fair pricing the two columns net to ≈ zero per user; the gross flow "
        "is what the product surfaces every night, so it must read as real money "
        "without dwarfing the costs users click on."
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
        f"Universe: top {UNIVERSE_SIZE} players by projected-game count; "
        f"{len(study.rows):,} settled player-games; {len(study.dates)} game dates. "
        f"Costs lock at the trailing-{TRAILING_WINDOW} produced-NP anchor on add "
        f"date ({TRAILING_MIN}+ prior games, else the saved pregame projection). "
        "All P&L computed in NP first; dollars are linear in the rate.",
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
