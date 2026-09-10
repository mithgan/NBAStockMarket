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
import sys
import math
import statistics
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
from typing import Sequence

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.per_game_rate_study import asof_universe, opening_date

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


def build_universe(games: Sequence[HistoricalPlayerGame], cutoff: date | None = None) -> set[str]:
    """Freeze an availability-ordered sample before evaluation, without future counts."""
    universe = asof_universe(games, cutoff if cutoff is not None else opening_date(games), UNIVERSE_SIZE)
    if len(universe) < LONG_SLOTS:
        raise ValueError("fewer than 10 observed players before calibration ends")
    return universe


def quote_streams(
    games: Sequence[HistoricalPlayerGame],
    universe: set[str],
) -> list[dict[str, object]]:
    """Per settled game: actual NP and the quote (in NP) under each policy."""
    ordered = sorted(games, key=lambda g: (g.game_date, g.game_id, g.player_id))
    first_proj: dict[str, float] = {}
    history = defaultdict(list)
    rows: list[dict[str, object]] = []
    for game in ordered:
        if game.player_id not in universe:
            continue
        proj = game.saved_projection_net_points
        if proj is not None and game.player_id not in first_proj:
            first_proj[game.player_id] = proj
        anchor_first = first_proj.get(game.player_id)
        prior = [actual for day, actual in history[game.player_id] if day < game.game_date]
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
        history[game.player_id].append((game.game_date, game.actual_net_points))
    return rows


def describe(values: Sequence[float]) -> tuple[int, float, float]:
    n = len(values)
    mean = statistics.fmean(values) if values else float("nan")
    sd = statistics.pstdev(values) if len(values) > 1 else float("nan")
    return n, mean, sd


def anchor_study(rows: Sequence[dict[str, object]]) -> list[str]:
    # Compare anchors on the same eligible games, not different missingness subsets.
    rows = [r for r in rows if all(r[p] is not None for p in ("first_proj", "gameday_proj", "trailing", "blend"))]
    if not rows:
        raise ValueError("no matched games with every quote anchor")
    lines = ["## 1. Quote anchor: long EV per settled game (net points)", ""]
    lines.append(
        "Matched-game gross residual = (actual − quote) × rate, before fees/floors. This is a quote-error diagnostic, not a held-position replay."
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
    if not season_means:
        raise ValueError("no players have 20 evaluation games for the scale diagnostic")
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
        f"| Retrospective top 10 roster, hypothetical turnover if all 10 play | {roster_np:.1f} "
        f"| ${roster_np * 20_000:,.0f} | ${roster_np * 40_000:,.0f} |"
    )
    night_sd = surprise_sd * math.sqrt(LONG_SLOTS)
    lines.append(
        f"| Independence approximation, 10 games (not observed nightly risk) | ±{night_sd:.1f} "
        f"| ±${night_sd * 20_000:,.0f} | ±${night_sd * 40_000:,.0f} |"
    )
    lines.append("")
    return lines


def incremental_break_even_fee(premium, streamer_adds, holder_adds):
    extra = streamer_adds - holder_adds
    return premium / extra if extra > 0 else float("nan")


def streaming_study(rows: Sequence[dict[str, object]], trade_day: date | None = None) -> list[str]:
    """Hold a fixed top-10 vs re-pick tonight's top-10 every date, per anchor."""
    lines = ["## 3. Churn: streaming premium and the neutralizing fee", ""]
    by_date: dict[date, list[dict[str, object]]] = defaultdict(list)
    for row in rows:
        by_date[row["date"]].append(row)  # type: ignore[index]
    dates = sorted(by_date)

    trade_day = trade_day if trade_day is not None else dates[14]
    early_cutoff = trade_day - timedelta(days=1)
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
            key=lambda item: (-item[1], item[0]),
        )[:LONG_SLOTS]
    }

    lines.append(
        f"Evaluation starts {trade_day}, after fixed-roster selection. Both rosters are repriced every played game in this diagnostic (not locked-position policy). The streamer knows realized participation, so it is a participation oracle. Quotes are unfloored and fees are omitted until the break-even calculation."
    )
    lines.append("")
    lines.append(
        "| Anchor | Hold season P&L @20K | Streamer season P&L @20K | Premium | "
        "Streamer adds | Holder adds | Hold games | Stream games | Breakeven fee/incremental add |"
    )
    lines.append("|---|---:|---:|---:|---:|---:|---:|---:|---:|")
    for policy in ("gameday_proj", "trailing", "blend"):
        hold_pnl = 0.0
        hold_games = 0
        stream_games = 0
        for row in rows:
            if row["date"] >= trade_day and row["player_id"] in hold_roster and row[policy] is not None:
                hold_games += 1
                hold_pnl += (float(row["actual"]) - float(row[policy])) * 20_000  # type: ignore[arg-type]
        streamer_pnl = 0.0
        adds = 0
        current: set[str] = set()
        for day in dates:
            if day < trade_day:
                continue
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
                stream_games += 1
                streamer_pnl += (float(row["actual"]) - float(row[policy])) * 20_000  # type: ignore[arg-type]
        premium = streamer_pnl - hold_pnl
        fee = incremental_break_even_fee(premium, adds, len(hold_roster))
        lines.append(
            f"| {policy} | ${hold_pnl:+,.0f} | ${streamer_pnl:+,.0f} | ${premium:+,.0f} "
            f"| {adds:,} | {len(hold_roster)} | {hold_games} | {stream_games} | ${fee:,.0f} |"
        )
    lines.append("")
    lines.append(
        "The break-even fee solves equal after-fee returns for these traces: gross premium divided by (streamer adds minus holder adds). Negative values mean the streamer already underperforms before fees. Exposure counts are shown explicitly. This oracle/continuous-requote diagnostic cannot choose the live churn fee."
    )
    lines.append("")
    return lines


def window_average_sd(totals, counts):
    if len(totals) != len(counts) or any(c <= 0 for c in counts):
        raise ValueError("one positive game count is required per window")
    averages = [total / count for total, count in zip(totals, counts)]
    return statistics.pstdev(averages) if averages else float("nan")


def short_study(rows: Sequence[dict[str, object]], *, observation_end: date | None = None) -> list[str]:
    """Compare complete calendar windows within one global observation horizon.

    The caller should supply the complete league data endpoint. When omitted,
    the latest date across the supplied rows is the global endpoint; an
    individual player's final appearance never sets their observation horizon.
    """
    if not rows:
        raise ValueError("no observations for short-window diagnostics")
    last_row_date = max(row["date"] for row in rows)
    observation_end = observation_end if observation_end is not None else last_row_date
    if observation_end < last_row_date:
        raise ValueError("observation horizon precedes supplied game rows")
    lines = ["## 4. Shorts: duration windows and calendar cost", ""]
    usable = [row for row in rows if row["gameday_proj"] is not None]
    lines.append(f"Global league observation horizon: {observation_end}. Windows ending after this date are omitted and counted, including incomplete final fragments. Player inactivity does not shorten this horizon.")
    if not usable:
        lines.append("No observed games have saved projections; window statistics are unavailable.")
    lines.append("")
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
        "| Window | Complete windows | Incomplete omitted | Mean games caught | SD of window P&L @20K | Per-game SD vs 1 game |"
    )
    lines.append("|---|---:|---:|---:|---:|---:|")
    single_sd = None
    for window_days in (1, 3, 7, 14):
        totals: list[float] = []
        counts: list[int] = []
        incomplete = 0
        for series in by_player.values():
            series.sort()
            index = 0
            while index < len(series):
                start = series[index][0]
                end = start + timedelta(days=window_days - 1)
                if end > observation_end:
                    incomplete += 1
                    break
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
        if not totals:
            mean_games = sd_text = relative_sd = "unavailable"
        else:
            mean_games = f"{statistics.fmean(counts):.2f}"
            if len(totals) < 2:
                sd_text = relative_sd = "unavailable (one window)"
            else:
                sd_text = f"±${statistics.pstdev(totals):,.0f}"
                per_game_sd = window_average_sd(totals, counts)
                if window_days == 1:
                    single_sd = per_game_sd
                relative_sd = (f"{per_game_sd / single_sd:.2f}×" if single_sd is not None and single_sd > 0 else
                               "undefined (zero baseline SD)" if single_sd == 0 else
                               "unavailable (baseline SD)")
        lines.append(
            f"| {window_days} day{'s' if window_days > 1 else ''} | {len(totals):,} | {incomplete:,} | {mean_games} "
            f"| {sd_text} | {relative_sd} |"
        )
    lines.append("")
    lines.append(
        "Per-game SD is computed across each complete window's actual average, not SD(total)/mean(games). Variability is unavailable with fewer than two complete windows. Windows start at played games and have no fees, expiry ordering or demand impact. These residual diagnostics do not validate a seven-day short policy or isolate skill from noise."
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
    trade_day = opening_date(games)
    universe = build_universe(games, trade_day)
    rows = quote_streams(games, universe)
    evaluation_rows = [r for r in rows if r["date"] >= trade_day]

    lines = [
        "# Per-game economy v2 — balance study",
        "",
        f"Sample: {len(universe)} players observed strictly before {trade_day}; "
        f"{len(rows):,} settled player-games. Trailing anchor = mean of last "
        f"{TRAILING_WINDOW} produced NP (needs {TRAILING_MIN_GAMES}+ prior games, else "
        "game-day projection). Gross, unfloored diagnostics only; not a rate, fee or full-policy recommendation. Evaluation starts after calibration; no synthetic order flow.",
        "",
    ]
    lines += anchor_study(evaluation_rows)
    lines += rate_scale_study(evaluation_rows)
    lines += streaming_study(rows, trade_day)
    lines += short_study(evaluation_rows, observation_end=max(game.game_date for game in games))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
