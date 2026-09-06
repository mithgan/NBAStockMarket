"""Balance study for the per-game economy v2 knobs.

Answers, from the cached 2025-26 season (actuals + saved pregame D&T projections):

1. Quote-anchor policy: how much long EV leaks per game when the per-game cost is
   (a) frozen at the first preseason projection, (b) requoted to the game-day
   projection, (c) requoted to trailing produced net points, (d) a 50/50 blend.
2. $/NP rate scale: what a night and a season feel like at $20K vs $40K per NP.
3. Churn fee: the streaming-vs-hold premium under each quote anchor and the
   per-add fee that neutralizes mindless nightly streaming.
4. Short duration: how per-game luck shrinks as a short's window widens, and
   random-short EV by month (the calendar bias a short eats).

Pure replay arithmetic on the same loader as per_game_simulation; no RNG.
"""
from __future__ import annotations

import argparse
import math
import statistics
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
from typing import Sequence

from nba_stock_market.per_game_simulation import (
    HistoricalPlayerGame,
    load_historical_games,
)

RATES = (20_000, 40_000)
UNIVERSE_SIZE = 150
TRAILING_WINDOW = 10
TRAILING_MIN_GAMES = 3
LONG_SLOTS = 10


def month_key(day: date) -> str:
    return f"{day.year}-{day.month:02d}"


def build_universe(games: Sequence[HistoricalPlayerGame]) -> set[str]:
    """Top players by count of projected games — proxy for the listed market."""
    counts: dict[str, int] = defaultdict(int)
    for game in games:
        if game.saved_projection_net_points is not None:
            counts[game.player_id] += 1
    ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    return {player_id for player_id, _ in ranked[:UNIVERSE_SIZE]}


def quote_streams(
    games: Sequence[HistoricalPlayerGame],
    universe: set[str],
) -> list[dict[str, object]]:
    """Per settled game: actual NP and the quote (in NP) under each policy."""
    ordered = sorted(games, key=lambda g: (g.game_date, g.game_id, g.player_id))
    first_proj: dict[str, float] = {}
    history: dict[str, list[float]] = defaultdict(list)
    rows: list[dict[str, object]] = []
    for game in ordered:
        if game.player_id not in universe:
            continue
        proj = game.saved_projection_net_points
        if proj is not None and game.player_id not in first_proj:
            first_proj[game.player_id] = proj
        anchor_first = first_proj.get(game.player_id)
        prior = history[game.player_id]
        trailing = (
            statistics.fmean(prior[-TRAILING_WINDOW:])
            if len(prior) >= TRAILING_MIN_GAMES
            else None
        )
        if proj is not None:
            gameday = proj
        else:
            gameday = None
        trailing_quote = trailing if trailing is not None else gameday
        blend = (
            0.5 * trailing_quote + 0.5 * gameday
            if trailing_quote is not None and gameday is not None
            else None
        )
        rows.append(
            {
                "player_id": game.player_id,
                "date": game.game_date,
                "actual": game.actual_net_points,
                "first_proj": anchor_first,
                "gameday_proj": gameday,
                "trailing": trailing_quote,
                "blend": blend,
            }
        )
        history[game.player_id].append(game.actual_net_points)
    return rows


def describe(values: Sequence[float]) -> tuple[int, float, float]:
    n = len(values)
    mean = statistics.fmean(values) if values else float("nan")
    sd = statistics.pstdev(values) if len(values) > 1 else float("nan")
    return n, mean, sd


def anchor_study(rows: Sequence[dict[str, object]]) -> list[str]:
    lines = ["## 1. Quote anchor: long EV per settled game (net points)", ""]
    lines.append(
        "Long game P&L = (actual − quote) × rate. A fair anchor has mean ≈ 0."
    )
    lines.append("")
    lines.append(
        "| Anchor | Games | Mean NP edge | SD | $/game at $20K | $/game at $40K |"
    )
    lines.append("|---|---:|---:|---:|---:|---:|")
    policies = ("first_proj", "gameday_proj", "trailing", "blend")
    monthly: dict[str, dict[str, list[float]]] = {p: defaultdict(list) for p in policies}
    for policy in policies:
        edges = [
            float(row["actual"]) - float(row[policy])  # type: ignore[arg-type]
            for row in rows
            if row[policy] is not None
        ]
        n, mean, sd = describe(edges)
        lines.append(
            f"| {policy} | {n:,} | {mean:+.3f} | {sd:.2f} "
            f"| ${mean * 20_000:+,.0f} | ${mean * 40_000:+,.0f} |"
        )
        for row in rows:
            if row[policy] is None:
                continue
            monthly[policy][month_key(row['date'])].append(  # type: ignore[arg-type]
                float(row["actual"]) - float(row[policy])  # type: ignore[arg-type]
            )
    lines.append("")
    lines.append("Monthly mean NP edge (the calendar curve each anchor leaves behind):")
    lines.append("")
    months = sorted({month_key(row["date"]) for row in rows})  # type: ignore[arg-type]
    lines.append("| Month | " + " | ".join(policies) + " |")
    lines.append("|---|" + "---:|" * len(policies))
    for month in months:
        cells = []
        for policy in policies:
            values = monthly[policy].get(month, [])
            cells.append(f"{statistics.fmean(values):+.3f}" if values else "—")
        lines.append(f"| {month} | " + " | ".join(cells) + " |")
    lines.append("")
    return lines


def rate_scale_study(rows: Sequence[dict[str, object]]) -> list[str]:
    lines = ["## 2. Rate scale: what a night and a season feel like", ""]
    by_player: dict[str, list[float]] = defaultdict(list)
    for row in rows:
        by_player[str(row["player_id"])].append(float(row["actual"]))  # type: ignore[arg-type]
    season_means = sorted(
        ((statistics.fmean(v), len(v), pid) for pid, v in by_player.items() if len(v) >= 20),
        reverse=True,
    )
    top10 = season_means[:LONG_SLOTS]
    surprise_sd = statistics.pstdev(
        [
            float(row["actual"]) - float(row["gameday_proj"])  # type: ignore[arg-type]
            for row in rows
            if row["gameday_proj"] is not None
        ]
    )
    lines.append("| Quantity | value in NP | at $20K/NP | at $40K/NP |")
    lines.append("|---|---:|---:|---:|")
    star_np = top10[0][0]
    mid_np = season_means[len(season_means) // 2][0]
    lines.append(
        f"| Top listed player, produced NP/game | {star_np:.2f} "
        f"| ${star_np * 20_000:,.0f} | ${star_np * 40_000:,.0f} |"
    )
    lines.append(
        f"| Median listed player, produced NP/game | {mid_np:.2f} "
        f"| ${mid_np * 20_000:,.0f} | ${mid_np * 40_000:,.0f} |"
    )
    lines.append(
        f"| One-game surprise SD vs game-day projection | {surprise_sd:.2f} "
        f"| ±${surprise_sd * 20_000:,.0f} | ±${surprise_sd * 40_000:,.0f} |"
    )
    roster_np = sum(mean for mean, _, _ in top10)
    lines.append(
        f"| Full 10-slot star roster, cost turnover per played night | {roster_np:.1f} "
        f"| ${roster_np * 20_000:,.0f} | ${roster_np * 40_000:,.0f} |"
    )
    night_sd = surprise_sd * math.sqrt(LONG_SLOTS)
    lines.append(
        f"| Typical full-roster night swing (10 independent games) | ±{night_sd:.1f} "
        f"| ±${night_sd * 20_000:,.0f} | ±${night_sd * 40_000:,.0f} |"
    )
    lines.append("")
    return lines


def streaming_study(rows: Sequence[dict[str, object]]) -> list[str]:
    """Hold a fixed top-10 vs re-pick tonight's top-10 every date, per anchor."""
    lines = ["## 3. Churn: streaming premium and the neutralizing fee", ""]
    by_date: dict[date, list[dict[str, object]]] = defaultdict(list)
    for row in rows:
        by_date[row["date"]].append(row)  # type: ignore[index]
    dates = sorted(by_date)

    early_cutoff = dates[0] + timedelta(days=14)
    early_proj: dict[str, list[float]] = defaultdict(list)
    for day in dates:
        if day > early_cutoff:
            break
        for row in by_date[day]:
            if row["gameday_proj"] is not None:
                early_proj[str(row["player_id"])].append(float(row["gameday_proj"]))  # type: ignore[arg-type]
    hold_roster = {
        pid
        for pid, _ in sorted(
            ((pid, statistics.fmean(v)) for pid, v in early_proj.items()),
            key=lambda item: -item[1],
        )[:LONG_SLOTS]
    }

    lines.append(
        "Hold = fix the 10 best players by first-two-weeks projection and never touch "
        "them. Streamer = every date, hold the 10 players *playing tonight* with the "
        "highest game-day projection (drop/re-add as needed, no fee). Same anchor "
        "prices for both."
    )
    lines.append("")
    lines.append(
        "| Anchor | Hold season P&L @20K | Streamer season P&L @20K | Premium | "
        "Streamer adds | Breakeven fee/add |"
    )
    lines.append("|---|---:|---:|---:|---:|---:|")
    for policy in ("gameday_proj", "trailing", "blend"):
        hold_pnl = 0.0
        for row in rows:
            if row["player_id"] in hold_roster and row[policy] is not None:
                hold_pnl += (float(row["actual"]) - float(row[policy])) * 20_000  # type: ignore[arg-type]
        streamer_pnl = 0.0
        adds = 0
        current: set[str] = set()
        for day in dates:
            tonight = [
                row
                for row in by_date[day]
                if row[policy] is not None and row["gameday_proj"] is not None
            ]
            tonight.sort(key=lambda row: (-float(row["gameday_proj"]), str(row["player_id"])))  # type: ignore[arg-type]
            want = {str(row["player_id"]) for row in tonight[:LONG_SLOTS]}
            adds += len(want - current)
            current = want if want else current
            for row in tonight[:LONG_SLOTS]:
                streamer_pnl += (float(row["actual"]) - float(row[policy])) * 20_000  # type: ignore[arg-type]
        premium = streamer_pnl - hold_pnl
        fee = premium / adds if adds else float("nan")
        lines.append(
            f"| {policy} | ${hold_pnl:+,.0f} | ${streamer_pnl:+,.0f} | ${premium:+,.0f} "
            f"| {adds:,} | ${fee:,.0f} |"
        )
    lines.append("")
    lines.append(
        "The streamer above plays ~2.5× the games of the holder, so most of the premium "
        "is *exposure volume* under a mispriced anchor, not skill. The breakeven fee is "
        "the per-add charge that erases the entire mindless premium at $20K/NP; scale "
        "it linearly for other rates."
    )
    lines.append("")
    return lines


def short_study(rows: Sequence[dict[str, object]]) -> list[str]:
    lines = ["## 4. Shorts: duration windows and calendar cost", ""]
    usable = [row for row in rows if row["gameday_proj"] is not None]
    monthly: dict[str, list[float]] = defaultdict(list)
    for row in usable:
        monthly[month_key(row["date"])].append(  # type: ignore[arg-type]
            -(float(row["actual"]) - float(row["gameday_proj"]))  # type: ignore[arg-type]
        )
    lines.append("Random-short EV by month, game-day-projection anchor (NP and $ at $20K):")
    lines.append("")
    lines.append("| Month | Games | Mean short NP edge | $/game |")
    lines.append("|---|---:|---:|---:|")
    for month in sorted(monthly):
        values = monthly[month]
        mean = statistics.fmean(values)
        lines.append(f"| {month} | {len(values):,} | {mean:+.3f} | ${mean * 20_000:+,.0f} |")
    lines.append("")

    by_player: dict[str, list[tuple[date, float]]] = defaultdict(list)
    for row in usable:
        by_player[str(row["player_id"])].append(
            (row["date"], float(row["actual"]) - float(row["gameday_proj"]))  # type: ignore[arg-type]
        )
    lines.append(
        "| Window | Mean games caught | SD of window P&L @20K | Per-game luck SD vs 1 game |"
    )
    lines.append("|---|---:|---:|---:|")
    single_sd = None
    for window_days in (1, 3, 7, 14):
        totals: list[float] = []
        counts: list[int] = []
        for series in by_player.values():
            series.sort()
            index = 0
            while index < len(series):
                start = series[index][0]
                end = start + timedelta(days=window_days - 1)
                total = 0.0
                caught = 0
                scan = index
                while scan < len(series) and series[scan][0] <= end:
                    total += series[scan][1]
                    caught += 1
                    scan += 1
                totals.append(total * 20_000)
                counts.append(caught)
                index = scan
        sd = statistics.pstdev(totals)
        mean_games = statistics.fmean(counts)
        per_game_sd = sd / mean_games if mean_games else float("nan")
        if single_sd is None:
            single_sd = per_game_sd
        lines.append(
            f"| {window_days} day{'s' if window_days > 1 else ''} | {mean_games:.2f} "
            f"| ±${sd:,.0f} | {per_game_sd / single_sd:.2f}× |"
        )
    lines.append("")
    lines.append(
        "Luck per game of exposure shrinks as the window catches more games; the "
        "7-day window keeps the v1 finding that one game is mostly noise while a "
        "week is a real opinion."
    )
    lines.append("")
    return lines


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=Path("data/raw/2025-26"))
    parser.add_argument("--dnt-dir", type=Path, default=Path("data/raw/dnt"))
    parser.add_argument(
        "--output", type=Path, default=Path("output/per-game-balance-study.md")
    )
    args = parser.parse_args(argv)

    games = load_historical_games(args.data_dir, args.dnt_dir)
    universe = build_universe(games)
    rows = quote_streams(games, universe)

    lines = [
        "# Per-game economy v2 — balance study",
        "",
        f"Universe: top {UNIVERSE_SIZE} players by projected-game count, 2025-26 cache; "
        f"{len(rows):,} settled player-games. Trailing anchor = mean of last "
        f"{TRAILING_WINDOW} produced NP (needs {TRAILING_MIN_GAMES}+ prior games, else "
        "game-day projection). Deterministic replay arithmetic; no synthetic order flow.",
        "",
    ]
    lines += anchor_study(rows)
    lines += rate_scale_study(rows)
    lines += streaming_study(rows)
    lines += short_study(rows)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
