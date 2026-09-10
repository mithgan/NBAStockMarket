"""Chronological user-P&L replay using actual previous-season production anchors.

Previous-season means are computed from a separately supplied historical season;
current-year future games are never a substitute. Initial costs use that mean
(without an assumed policy markup), otherwise the first observed projection.
Later adds use trailing production. Dollar replays apply the $25K floor and $10K
fee at each candidate rate; fees and floors therefore are not scaled linearly.
"""
from __future__ import annotations

import argparse
import sys
import statistics
from collections import defaultdict
from datetime import date
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from nba_stock_market.engine import NetPointsModel
from nba_stock_market.historical_data import load_game_records
from scripts.per_game_rate_study import fmean, pct, pstdev
from scripts.per_game_repricing_test import RepricingStudy, FLOOR_DOLLARS, SEEDS

RATES = (15_000, 20_000, 25_000)


def previous_season_anchors(records, opening_day):
    """Reject mixed/current-season input, even if it precedes the first trade."""
    start_year = opening_day.year if opening_day.month >= 7 else opening_day.year - 1
    earliest = date(start_year - 1, 7, 1)
    latest = date(start_year, 7, 1)
    if not records:
        raise ValueError("previous-season game records are empty")
    if any(not earliest <= record.game_date < latest for record in records):
        raise ValueError("prior anchors require only actual previous-season games")
    model = NetPointsModel()
    values = defaultdict(list)
    for record in sorted(records, key=lambda r: (r.game_date, r.game_id, r.player_id)):
        values[record.player_id].append(model.score(record.box_score))
    return {pid: fmean(actuals) for pid, actuals in values.items()}


class PriorAnchorStudy(RepricingStudy):
    def __init__(self, *args, prior_records, **kwargs):
        super().__init__(*args, **kwargs)
        self.prior_anchors = previous_season_anchors(prior_records, self.opening_day)

    def quote_dollars(self, pid, day):
        if day == self.opening_day:
            anchor = self.prior_anchors.get(pid)
            if anchor is None:
                projections = [r["proj"] for r in self.by_player[pid] if r["date"] < day and r["proj"] is not None]
                anchor = projections[0] if projections else None
            return max(FLOOR_DOLLARS, anchor * self.rate) if anchor is not None else None
        return super().quote_dollars(pid, day)


def daily_and_weekly(study, result):
    daily = {day: 0.0 for day in study.dates}
    for event in result.events:
        if event["kind"] == "open":
            daily[event["date"]] -= event["fee"]
        elif event["kind"] == "game":
            daily[event["date"]] += event["dividend"] - event["cost"]
    weeks = defaultdict(float)
    for day, value in daily.items():
        weeks[day.isocalendar()[:2]] += value
    return list(daily.values()), list(weeks.values())


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=Path("data/raw/2025-26"))
    parser.add_argument("--prior-data-dir", type=Path, default=Path("data/raw/2024-25"))
    parser.add_argument("--dnt-dir", type=Path, default=Path("data/raw/dnt"))
    parser.add_argument("--output", type=Path, default=Path("output/per-game-user-pnl-corrected.md"))
    args = parser.parse_args(argv)
    # Missing historical data is an explicit failure, never a same-season oracle.
    prior_records = load_game_records(args.prior_data_dir / "player_game_logs.csv")
    lines = ["# User P&L with actual previous-season opening anchors", "",
             "Long-only, forced-hold/weekly-random diagnostic. Sample and fixed rosters are frozen before trading. Opening anchor is actual previous-season mean, without a policy markup; missing players use first observed projection. Later adds use trailing 10 prior games.",
             "Each rate is replayed separately with a $25K floor and $10K fee per actual add. Retained positions keep their locked costs and do not incur another fee. Calendar-day statistics include zero-return days.",
             "No bankroll constraints, demand impact, short lifecycle, rookie adjustment or strategic drop/re-signing are modeled. This does not select a rate or validate the complete economy.", ""]
    for rate in RATES:
        study = PriorAnchorStudy(args.data_dir, args.dnt_dir, prior_records=prior_records, rate=rate)
        coverage = len(study.universe & study.prior_anchors.keys())
        if coverage == 0:
            raise ValueError("previous-season anchors match none of the observed players")
        lines += [f"## Rate ${rate:,}/NP; opening {study.opening_day}; prior coverage {coverage}/{len(study.universe)}", "",
                  "| Archetype | Mean season net | Actual mean adds | Calendar-day SD | Weekly SD | Absolute night p95 | Absolute week p95 |",
                  "|---|---:|---:|---:|---:|---:|---:|"]
        for kind in ("star hold", "balanced", "bench hold", "random"):
            seeds = SEEDS if kind == "random" else (None,)
            runs = [study.run(None, study.picker(kind, seed), record_events=True) for seed in seeds]
            daily = []
            weekly = []
            for run in runs:
                d, w = daily_and_weekly(study, run)
                if abs(sum(d) - run.net_dollars) > 0.0001:
                    raise AssertionError("daily ledger does not reconcile")
                daily.extend(d)
                weekly.extend(w)
            totals = [r.net_dollars for r in runs]
            lines.append(f"| {kind} | ${fmean(totals):+,.0f} | {fmean([r.opens for r in runs]):.1f} | ${pstdev(daily):,.0f} | ${pstdev(weekly):,.0f} | ${pct([abs(v) for v in daily], .95):,.0f} | ${pct([abs(v) for v in weekly], .95):,.0f} |")
            if kind == "random":
                lines += ["", f"Random season totals: min ${min(totals):+,.0f}, max ${max(totals):+,.0f}, sample SD ${statistics.stdev(totals):,.0f} across {len(totals)} seeds. This is observed strategy variability, not a confidence interval or a calibrated luck band.", ""]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
