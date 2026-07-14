"""Compare impact metrics for opening prices and backtest their predictive power.

Two questions, answered offline from cached CSVs:

1. **Metric comparison** — do LEBRON (site_Data), DARKO (darko.app public
   sheet), and EPM (Dunks & Threes API) agree on 2026-27 opening prices, and
   where do they disagree most?
2. **FV backtest** — a listing model is good if prices built ONLY from season
   N-1 data rank-predict realized value (WAR) in season N.  We replay that
   protocol across historical season pairs for LEBRON and EPM (DARKO's public
   sheet is a current snapshot only) against a naive carry-forward-WAR
   baseline.
"""

from __future__ import annotations

import argparse
import csv
import math
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from nba_stock_market.backtest import normalize_player_name
from nba_stock_market.epm_data import load_epm_rows, snapshot_path
from nba_stock_market.opening_prices import (
    ImpactRow,
    OpeningPriceModel,
    PlayerFeatures,
    ProjectedWarModel,
    UNIVERSE_SIZE,
    build_player_features,
    load_impact_rows,
)


DARKO_SHEET_URL = (
    "https://docs.google.com/spreadsheets/d/"
    "1mhwOLqPu2F9026EQiVxFPIN1t9RGafGpl-dokaIsm9c/export?format=csv"
)

DEFAULT_LEBRON_FILE = Path("data/raw/opening/lebron.csv")
DEFAULT_DARKO_FILE = Path("data/raw/opening/darko_current.csv")
DEFAULT_EPM_CACHE = Path("data/raw/opening")
DEFAULT_REPORT_FILE = Path("output/fv-validation.md")

BACKTEST_SEASON_PAIRS = ((2022, 2023), (2023, 2024), (2024, 2025), (2025, 2026))

# LEBRON rows carry real minutes, so the shrinkage prior applies.  DARKO and
# EPM are already regularized model outputs, so they price without shrinkage.
SHRUNK_MODEL = OpeningPriceModel()
PRESHRUNK_MODEL = OpeningPriceModel(shrinkage_minutes=0.0)


@dataclass(frozen=True)
class MetricComparison:
    label_a: str
    label_b: str
    joined_players: int
    rating_spearman: float
    price_spearman: float
    mean_abs_price_delta: float
    disagreements: tuple[tuple[str, float, float, float, float], ...]


@dataclass(frozen=True)
class SeasonBacktest:
    train_year: int
    test_year: int
    players: int
    price_spearman: float
    naive_war_spearman: float
    deciles: tuple[tuple[int, float, float], ...]


@dataclass(frozen=True)
class ExternalBacktest:
    label: str
    train_year: int
    test_year: int
    players: int
    price_spearman: float
    naive_war_spearman: float | None = None


@dataclass(frozen=True)
class WarCalibration:
    players: int
    intercept: float
    slope: float


def spearman(xs: list[float], ys: list[float]) -> float:
    """Spearman rank correlation with average ranks for ties (no scipy)."""

    if len(xs) != len(ys):
        raise ValueError("series must be the same length")
    if len(xs) < 3:
        raise ValueError("need at least three points")

    def ranks(values: list[float]) -> list[float]:
        order = sorted(range(len(values)), key=values.__getitem__)
        result = [0.0] * len(values)
        index = 0
        while index < len(order):
            tie_end = index
            while (
                tie_end + 1 < len(order)
                and values[order[tie_end + 1]] == values[order[index]]
            ):
                tie_end += 1
            average_rank = (index + tie_end) / 2 + 1
            for position in range(index, tie_end + 1):
                result[order[position]] = average_rank
            index = tie_end + 1
        return result

    rank_x, rank_y = ranks(xs), ranks(ys)
    mean_x = sum(rank_x) / len(rank_x)
    mean_y = sum(rank_y) / len(rank_y)
    cov = sum((a - mean_x) * (b - mean_y) for a, b in zip(rank_x, rank_y))
    var_x = sum((a - mean_x) ** 2 for a in rank_x)
    var_y = sum((b - mean_y) ** 2 for b in rank_y)
    if var_x == 0 or var_y == 0:
        raise ValueError("cannot correlate a constant series")
    return cov / math.sqrt(var_x * var_y)


def fit_war_calibration(blends: list[float], realized_wars: list[float]) -> WarCalibration:
    """OLS map from a standardized blend to realized next-season WAR."""

    if len(blends) != len(realized_wars) or len(blends) < 2:
        raise ValueError("calibration series must have equal length and at least two rows")
    if any(not math.isfinite(value) for value in blends + realized_wars):
        raise ValueError("calibration values must be finite")
    mean_blend = sum(blends) / len(blends)
    mean_war = sum(realized_wars) / len(realized_wars)
    variance = sum((value - mean_blend) ** 2 for value in blends)
    if variance == 0:
        raise ValueError("cannot calibrate a constant blend")
    slope = sum(
        (blend - mean_blend) * (war - mean_war)
        for blend, war in zip(blends, realized_wars)
    ) / variance
    return WarCalibration(
        players=len(blends),
        intercept=mean_war - slope * mean_blend,
        slope=slope,
    )


def load_darko_rows(path: Path) -> list[ImpactRow]:
    """Load the public DARKO sheet (current talent snapshot, DPM units)."""

    rows: list[ImpactRow] = []
    with path.open(encoding="utf-8", newline="") as handle:
        for raw in csv.DictReader(handle):
            name = (raw.get("Player Name") or "").strip()
            dpm = raw.get("DPM")
            if not name or dpm in (None, ""):
                continue
            rows.append(
                ImpactRow(
                    player=name,
                    team="",
                    position=(raw.get("Position") or "").strip(),
                    age=float(raw.get("Age") or 0.0),
                    minutes=0.0,
                    games=0.0,
                    rating=float(dpm),
                    war=0.0,
                )
            )
    if not rows:
        raise ValueError(f"no DARKO rows in {path}")
    return rows


def compare_metrics(
    rows_a: list[ImpactRow],
    rows_b: list[ImpactRow],
    *,
    label_a: str = "LEBRON",
    label_b: str = "DARKO",
    model_a: OpeningPriceModel = SHRUNK_MODEL,
    model_b: OpeningPriceModel = PRESHRUNK_MODEL,
    top_n: int = 15,
) -> MetricComparison:
    by_name_a = {normalize_player_name(row.player): row for row in rows_a}
    by_name_b = {normalize_player_name(row.player): row for row in rows_b}
    shared = sorted(by_name_a.keys() & by_name_b.keys())
    if len(shared) < 3:
        raise ValueError("too few shared players between metrics")

    ratings_a, ratings_b, prices_a, prices_b = [], [], [], []
    rows: list[tuple[str, float, float, float, float]] = []
    for key in shared:
        row_a, row_b = by_name_a[key], by_name_b[key]
        price_a = model_a.opening_price(row_a.rating, row_a.minutes or 1.0, None)
        price_b = model_b.opening_price(row_b.rating, row_b.minutes or 1.0, None)
        ratings_a.append(row_a.rating)
        ratings_b.append(row_b.rating)
        prices_a.append(price_a)
        prices_b.append(price_b)
        rows.append((row_a.player, row_a.rating, row_b.rating, price_a, price_b))

    rows.sort(key=lambda row: -abs(row[3] - row[4]))
    mean_abs_delta = sum(abs(a - b) for a, b in zip(prices_a, prices_b)) / len(rows)
    return MetricComparison(
        label_a=label_a,
        label_b=label_b,
        joined_players=len(rows),
        rating_spearman=spearman(ratings_a, ratings_b),
        price_spearman=spearman(prices_a, prices_b),
        mean_abs_price_delta=mean_abs_delta,
        disagreements=tuple(rows[:top_n]),
    )


def backtest_season_pair(
    all_rows_by_year: dict[int, list[ImpactRow]],
    train_year: int,
    test_year: int,
    *,
    decile_count: int = 10,
    eligible_keys: tuple[str, ...] | None = None,
) -> SeasonBacktest:
    train = {normalize_player_name(row.player): row for row in all_rows_by_year[train_year]}
    test = {normalize_player_name(row.player): row for row in all_rows_by_year[test_year]}
    eligible = list(eligible_keys) if eligible_keys is not None else sorted(train)
    if any(key not in train for key in eligible):
        raise ValueError("eligible cohort contains a player absent from the train season")
    if len(eligible) < decile_count:
        raise ValueError(
            f"only {len(eligible)} eligible players in train season {train_year}"
        )

    prices, prior_wars, realized_wars = [], [], []
    for key in eligible:
        row = train[key]
        prices.append(SHRUNK_MODEL.opening_price(row.rating, row.minutes, None))
        prior_wars.append(row.war)
        realized_wars.append(test[key].war if key in test else 0.0)

    ordered = sorted(range(len(eligible)), key=lambda i: -prices[i])
    deciles: list[tuple[int, float, float]] = []
    for decile in range(decile_count):
        start = decile * len(ordered) // decile_count
        end = (decile + 1) * len(ordered) // decile_count
        bucket = ordered[start:end]
        deciles.append(
            (
                decile + 1,
                sum(prices[i] for i in bucket) / len(bucket),
                sum(realized_wars[i] for i in bucket) / len(bucket),
            )
        )

    return SeasonBacktest(
        train_year=train_year,
        test_year=test_year,
        players=len(eligible),
        price_spearman=spearman(prices, realized_wars),
        naive_war_spearman=spearman(prior_wars, realized_wars),
        deciles=tuple(deciles),
    )


def backtest_external_rows(
    label: str,
    train_rows: list[ImpactRow],
    test_rows: list[ImpactRow],
    train_year: int,
    test_year: int,
    *,
    model: OpeningPriceModel = PRESHRUNK_MODEL,
    eligible_keys: tuple[str, ...] | None = None,
) -> ExternalBacktest:
    """Score an external metric snapshot (e.g. EPM) against realized WAR."""

    train = {normalize_player_name(row.player): row for row in train_rows}
    test = {normalize_player_name(row.player): row for row in test_rows}
    eligible = list(eligible_keys) if eligible_keys is not None else sorted(train)
    if any(key not in train for key in eligible):
        raise ValueError(f"eligible cohort contains a player absent from {label}")
    if len(eligible) < 10:
        raise ValueError(f"only {len(eligible)} eligible train players for {label}")
    prices = [
        model.opening_price(train[key].rating, train[key].minutes or 1.0, None)
        for key in eligible
    ]
    realized = [test[key].war if key in test else 0.0 for key in eligible]
    return ExternalBacktest(
        label=label,
        train_year=train_year,
        test_year=test_year,
        players=len(eligible),
        price_spearman=spearman(prices, realized),
    )


def backtest_projected_war_model(
    train_rows: list[ImpactRow],
    train_epm_rows: list[ImpactRow],
    test_rows: list[ImpactRow],
    train_year: int,
    test_year: int,
    *,
    model: ProjectedWarModel | None = None,
    eligible_keys: tuple[str, ...] | None = None,
) -> ExternalBacktest:
    """Score the v2 fair-value component on a train-defined player cohort."""

    model = model or ProjectedWarModel()
    epm_by_name = {
        normalize_player_name(row.player): row.rating for row in train_epm_rows
    }
    features, _ = build_player_features(train_rows, epm_by_name)
    if len(features) < 10:
        raise ValueError(
            f"only {len(features)} eligible train players for Projected WAR FV"
        )
    projected_wars = model.projected_wars(features)
    selected = _select_projected_cohort(features, projected_wars, eligible_keys)
    prices = [
        model.opening_price(model.fair_value(projected_war), None)
        for _, projected_war in selected
    ]
    test = {normalize_player_name(row.player): row for row in test_rows}
    realized = [
        test[key].war if key in test else 0.0
        for key in (normalize_player_name(row.player) for row, _ in selected)
    ]
    return ExternalBacktest(
        label="Projected WAR FV",
        train_year=train_year,
        test_year=test_year,
        players=len(selected),
        price_spearman=spearman(prices, realized),
        naive_war_spearman=spearman(
            [row.prior_war for row, _ in selected],
            realized,
        ),
    )


def projected_war_calibration_rows(
    train_rows: list[ImpactRow],
    train_epm_rows: list[ImpactRow],
    test_rows: list[ImpactRow],
    *,
    eligible_keys: tuple[str, ...] | None = None,
) -> tuple[list[float], list[float]]:
    """Return uncalibrated blend scores and realized WAR for one season pair."""

    epm_by_name = {
        normalize_player_name(row.player): row.rating for row in train_epm_rows
    }
    features, _ = build_player_features(train_rows, epm_by_name)
    blend_model = ProjectedWarModel(war_intercept=0.0, war_slope=1.0)
    blends = blend_model.projected_wars(features)
    selected = _select_projected_cohort(features, blends, eligible_keys)
    test = {normalize_player_name(row.player): row for row in test_rows}
    realized = [
        test[key].war if key in test else 0.0
        for key in (normalize_player_name(row.player) for row, _ in selected)
    ]
    return [blend for _, blend in selected], realized


def listing_cohort_keys(
    train_rows: list[ImpactRow],
    train_epm_rows: list[ImpactRow],
    *,
    universe_size: int = UNIVERSE_SIZE,
) -> tuple[str, ...]:
    """The production listing cohort: top-minute players with both input sources."""

    if universe_size <= 0:
        raise ValueError("universe_size must be positive")
    epm_keys = {normalize_player_name(row.player) for row in train_epm_rows}
    shared = [
        row for row in train_rows if normalize_player_name(row.player) in epm_keys
    ]
    cohort = sorted(shared, key=lambda row: (-row.minutes, row.player))[:universe_size]
    if len(cohort) < 10:
        raise ValueError("too few players shared by LEBRON and EPM")
    return tuple(normalize_player_name(row.player) for row in cohort)


def _select_projected_cohort(
    features: list[PlayerFeatures],
    projected: list[float],
    eligible_keys: tuple[str, ...] | None,
) -> list[tuple[PlayerFeatures, float]]:
    if eligible_keys is None:
        eligible_keys = tuple(
            normalize_player_name(row.player)
            for row in sorted(features, key=lambda row: (-row.minutes, row.player))[
                :UNIVERSE_SIZE
            ]
        )
    projected_by_key = {
        normalize_player_name(row.player): (row, value)
        for row, value in zip(features, projected)
    }
    missing = [key for key in eligible_keys if key not in projected_by_key]
    if missing:
        raise ValueError("eligible cohort contains a player absent from projected features")
    return [projected_by_key[key] for key in eligible_keys]


def load_all_seasons(path: Path, years: set[int]) -> dict[int, list[ImpactRow]]:
    rows_by_year: dict[int, list[ImpactRow]] = defaultdict(list)
    for year in years:
        rows_by_year[year] = load_impact_rows(path, season_year=year)
    return dict(rows_by_year)


def _season_label(train_year: int, test_year: int) -> str:
    return (
        f"{train_year - 1}-{str(train_year)[2:]} → {test_year - 1}-{str(test_year)[2:]}"
    )


def write_report(
    comparisons: list[MetricComparison],
    backtests: list[SeasonBacktest],
    epm_backtests: list[ExternalBacktest],
    projected_backtests: list[ExternalBacktest],
    calibration: WarCalibration,
    path: Path,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# FV Validation — metric comparison and predictive backtest",
        "",
        "Generated by `python -m nba_stock_market.fv_validation`. Inputs: LEBRON history",
        "(`gabriel1200/site_Data`), current DARKO DPM (public darko.app sheet), and EPM",
        "season-end snapshots (Dunks & Threes API, cached under `data/raw/opening/`).",
        "",
        "## 1. Metric agreement on 2026-27 openings",
        "",
        "| Pair | Players | Rating rho | Price rho | Mean abs price delta |",
        "|---|---:|---:|---:|---:|",
    ]
    for comparison in comparisons:
        lines.append(
            f"| {comparison.label_a} vs {comparison.label_b} | {comparison.joined_players} "
            f"| {comparison.rating_spearman:.3f} | {comparison.price_spearman:.3f} "
            f"| ${comparison.mean_abs_price_delta:,.0f} |"
        )
    lines += [
        "",
        "Impact-only prices (no salary blend) isolate the metric difference. LEBRON is",
        "priced with minutes shrinkage; DARKO and EPM are already shrunk model outputs.",
        "",
    ]
    for comparison in comparisons:
        lines += [
            f"### Largest disagreements — {comparison.label_a} vs {comparison.label_b}",
            "",
            f"| Player | {comparison.label_a} | {comparison.label_b} "
            f"| Price ({comparison.label_a}) | Price ({comparison.label_b}) | Delta |",
            "|---|---:|---:|---:|---:|---:|",
        ]
        for player, rating_a, rating_b, price_a, price_b in comparison.disagreements[:10]:
            lines.append(
                f"| {player} | {rating_a:+.2f} | {rating_b:+.2f} | ${price_a:,.0f} "
                f"| ${price_b:,.0f} | ${abs(price_a - price_b):,.0f} |"
            )
        lines.append("")
    lines += [
        "## 2. Predictive backtest — can season N-1 listings rank season N value?",
        "",
        "Models use season N-1 data only and are scored against realized season-N",
        "**WAR** (production including minutes, from the LEBRON file). Eligibility is",
        "defined by the train season; players absent in season N receive zero WAR.",
        "The Projected WAR column validates the model's fair-value ranking before the 10%",
        "salary blend; its baseline uses the exact same LEBRON/EPM player cohort.",
        "These are retrospective model-selection windows, not untouched holdouts. The WAR",
        f"mapping was refit on all {calibration.players:,} corrected player-seasons:",
        f"`projected_WAR = {calibration.intercept:.4f} + {calibration.slope:.4f} × blend`",
        "",
        "| Train → Test | LEBRON rate-only rho (n) | EPM rate-only rho (n) "
        "| Projected WAR FV rho (n) | Same-cohort prior WAR rho (n) |",
        "|---|---:|---:|---:|---:|",
    ]
    epm_by_pair = {(result.train_year, result.test_year): result for result in epm_backtests}
    projected_by_pair = {
        (result.train_year, result.test_year): result for result in projected_backtests
    }
    for result in backtests:
        epm_result = epm_by_pair.get((result.train_year, result.test_year))
        projected_result = projected_by_pair.get((result.train_year, result.test_year))
        epm_cell = (
            f"{epm_result.price_spearman:.3f} ({epm_result.players})"
            if epm_result
            else "—"
        )
        projected_cell = (
            f"{projected_result.price_spearman:.3f} ({projected_result.players})"
            if projected_result
            else "—"
        )
        projected_baseline_cell = (
            f"{projected_result.naive_war_spearman:.3f} ({projected_result.players})"
            if projected_result and projected_result.naive_war_spearman is not None
            else "—"
        )
        lines.append(
            f"| {_season_label(result.train_year, result.test_year)} "
            f"| {result.price_spearman:.3f} ({result.players}) | {epm_cell} | {projected_cell} "
            f"| {projected_baseline_cell} |"
        )
    latest = backtests[-1]
    lines += [
        "",
        f"### Decile check ({_season_label(latest.train_year, latest.test_year)}, LEBRON prices)",
        "",
        "| Price decile | Mean opening price | Mean realized WAR |",
        "|---:|---:|---:|",
    ]
    for decile, mean_price, mean_war in latest.deciles:
        lines.append(f"| {decile} | ${mean_price:,.0f} | {mean_war:.2f} |")
    lines += [
        "",
        "Reading: decile 1 = the ten percent of players listed most expensive. A good FV",
        "model shows monotonically falling realized WAR down the deciles and a price→WAR",
        "correlation at or above the naive baseline (which gets minutes information for",
        "free via prior WAR; clearing it with a rate-based price is the bar).",
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate opening-price fair values.")
    parser.add_argument("--lebron-file", type=Path, default=DEFAULT_LEBRON_FILE)
    parser.add_argument("--darko-file", type=Path, default=DEFAULT_DARKO_FILE)
    parser.add_argument("--epm-cache", type=Path, default=DEFAULT_EPM_CACHE)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT_FILE)
    args = parser.parse_args()

    lebron_current = load_impact_rows(args.lebron_file, season_year=2026)
    darko_current = load_darko_rows(args.darko_file)
    epm_current = load_epm_rows(snapshot_path(2026, args.epm_cache))

    comparisons = [
        compare_metrics(lebron_current, darko_current, label_a="LEBRON", label_b="DARKO"),
        compare_metrics(lebron_current, epm_current, label_a="LEBRON", label_b="EPM"),
        compare_metrics(
            darko_current,
            epm_current,
            label_a="DARKO",
            label_b="EPM",
            model_a=PRESHRUNK_MODEL,
        ),
    ]

    years = {year for pair in BACKTEST_SEASON_PAIRS for year in pair}
    rows_by_year = load_all_seasons(args.lebron_file, years)
    pair_inputs: list[tuple[int, int, list[ImpactRow], tuple[str, ...]]] = []
    calibration_blends: list[float] = []
    calibration_realized: list[float] = []
    for train_year, test_year in BACKTEST_SEASON_PAIRS:
        train_path = snapshot_path(train_year, args.epm_cache)
        if not train_path.exists():
            continue
        train_epm_rows = load_epm_rows(train_path)
        eligible_keys = listing_cohort_keys(
            rows_by_year[train_year],
            train_epm_rows,
        )
        pair_inputs.append((train_year, test_year, train_epm_rows, eligible_keys))
        pair_blends, pair_realized = projected_war_calibration_rows(
            rows_by_year[train_year],
            train_epm_rows,
            rows_by_year[test_year],
            eligible_keys=eligible_keys,
        )
        calibration_blends.extend(pair_blends)
        calibration_realized.extend(pair_realized)

    calibration = fit_war_calibration(calibration_blends, calibration_realized)
    calibrated_model = ProjectedWarModel(
        war_intercept=calibration.intercept,
        war_slope=calibration.slope,
    )
    backtests: list[SeasonBacktest] = []
    epm_backtests: list[ExternalBacktest] = []
    projected_backtests: list[ExternalBacktest] = []
    for train_year, test_year, train_epm_rows, eligible_keys in pair_inputs:
        backtests.append(
            backtest_season_pair(
                rows_by_year,
                train_year,
                test_year,
                eligible_keys=eligible_keys,
            )
        )
        epm_backtests.append(
            backtest_external_rows(
                "EPM",
                train_epm_rows,
                rows_by_year[test_year],
                train_year,
                test_year,
                eligible_keys=eligible_keys,
            )
        )
        projected_backtests.append(
            backtest_projected_war_model(
                rows_by_year[train_year],
                train_epm_rows,
                rows_by_year[test_year],
                train_year,
                test_year,
                model=calibrated_model,
                eligible_keys=eligible_keys,
            )
        )
    write_report(
        comparisons,
        backtests,
        epm_backtests,
        projected_backtests,
        calibration,
        args.report,
    )
    print(f"wrote {args.report}")
    for comparison in comparisons:
        print(
            f"{comparison.label_a} vs {comparison.label_b}: rating rho="
            f"{comparison.rating_spearman:.3f} over {comparison.joined_players} players"
        )
    for result, epm_result, projected_result in zip(
        backtests, epm_backtests, projected_backtests
    ):
        print(
            f"{result.train_year}->{result.test_year}: LEBRON rho={result.price_spearman:.3f} "
            f"| EPM rho={epm_result.price_spearman:.3f} "
            f"| FV rho={projected_result.price_spearman:.3f} "
            f"| same-cohort WAR rho={projected_result.naive_war_spearman:.3f}"
        )


if __name__ == "__main__":
    main()
