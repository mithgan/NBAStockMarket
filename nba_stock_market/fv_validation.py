"""Compare impact metrics for opening prices and backtest their predictive power.

Two questions, answered offline from cached CSVs:

1. **Metric comparison** — do LEBRON (site_Data) and DARKO (darko.app public
   sheet) agree on 2026-27 opening prices, and where do they disagree most?
   EPM is stubbed pending the Dunks & Threes API key.
2. **FV backtest** — a listing model is good if prices built ONLY from season
   N-1 data rank-predict realized value (WAR) in season N.  We replay that
   protocol across historical season pairs and compare against a naive
   carry-last-season's-WAR baseline.
"""

from __future__ import annotations

import argparse
import csv
import math
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from nba_stock_market.backtest import normalize_player_name
from nba_stock_market.expectations import NotConfigured
from nba_stock_market.opening_prices import ImpactRow, OpeningPriceModel, load_impact_rows


DARKO_SHEET_URL = (
    "https://docs.google.com/spreadsheets/d/"
    "1mhwOLqPu2F9026EQiVxFPIN1t9RGafGpl-dokaIsm9c/export?format=csv"
)
EPM_ENDPOINT = "https://dunksandthrees.com/epm"

DEFAULT_LEBRON_FILE = Path("data/raw/opening/lebron.csv")
DEFAULT_DARKO_FILE = Path("data/raw/opening/darko_current.csv")
DEFAULT_REPORT_FILE = Path("output/fv-validation.md")

BACKTEST_SEASON_PAIRS = ((2022, 2023), (2023, 2024), (2024, 2025), (2025, 2026))


@dataclass(frozen=True)
class MetricComparison:
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


def load_darko_rows(path: Path) -> list[ImpactRow]:
    """Load the public DARKO sheet (current talent snapshot, DPM units).

    DARKO is a Bayesian estimate that already shrinks small samples, so rows
    carry no minutes and should be priced with ``shrinkage_minutes=0``.
    """

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


def load_epm_rows(path: Path | None = None) -> list[ImpactRow]:
    """EPM adapter placeholder: blocked on the Dunks & Threes API key."""

    del path
    raise NotConfigured(
        f"EPM requires the Dunks & Threes API key (endpoint: {EPM_ENDPOINT}); "
        "re-run with --metric epm once DNT_API_KEY is available"
    )


def compare_metrics(
    lebron_rows: list[ImpactRow],
    darko_rows: list[ImpactRow],
    *,
    top_n: int = 15,
) -> MetricComparison:
    lebron_model = OpeningPriceModel()
    darko_model = OpeningPriceModel(shrinkage_minutes=0.0)
    lebron_by_name = {normalize_player_name(row.player): row for row in lebron_rows}
    darko_by_name = {normalize_player_name(row.player): row for row in darko_rows}
    shared = sorted(lebron_by_name.keys() & darko_by_name.keys())
    if len(shared) < 3:
        raise ValueError("too few shared players between metrics")

    lebron_ratings, darko_ratings = [], []
    lebron_prices, darko_prices = [], []
    rows: list[tuple[str, float, float, float, float]] = []
    for key in shared:
        lebron_row, darko_row = lebron_by_name[key], darko_by_name[key]
        lebron_price = lebron_model.opening_price(lebron_row.rating, lebron_row.minutes, None)
        darko_price = darko_model.opening_price(darko_row.rating, 1.0, None)
        lebron_ratings.append(lebron_row.rating)
        darko_ratings.append(darko_row.rating)
        lebron_prices.append(lebron_price)
        darko_prices.append(darko_price)
        rows.append(
            (lebron_row.player, lebron_row.rating, darko_row.rating, lebron_price, darko_price)
        )

    rows.sort(key=lambda row: -abs(row[3] - row[4]))
    mean_abs_delta = sum(abs(a - b) for a, b in zip(lebron_prices, darko_prices)) / len(rows)
    return MetricComparison(
        joined_players=len(rows),
        rating_spearman=spearman(lebron_ratings, darko_ratings),
        price_spearman=spearman(lebron_prices, darko_prices),
        mean_abs_price_delta=mean_abs_delta,
        disagreements=tuple(rows[:top_n]),
    )


def backtest_season_pair(
    all_rows_by_year: dict[int, list[ImpactRow]],
    train_year: int,
    test_year: int,
    *,
    decile_count: int = 10,
) -> SeasonBacktest:
    train = {normalize_player_name(row.player): row for row in all_rows_by_year[train_year]}
    test = {normalize_player_name(row.player): row for row in all_rows_by_year[test_year]}
    shared = sorted(train.keys() & test.keys())
    if len(shared) < decile_count:
        raise ValueError(
            f"only {len(shared)} shared players between {train_year} and {test_year}"
        )

    model = OpeningPriceModel()
    prices, prior_wars, realized_wars = [], [], []
    for key in shared:
        row = train[key]
        prices.append(model.opening_price(row.rating, row.minutes, None))
        prior_wars.append(row.war)
        realized_wars.append(test[key].war)

    ordered = sorted(range(len(shared)), key=lambda i: -prices[i])
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
        players=len(shared),
        price_spearman=spearman(prices, realized_wars),
        naive_war_spearman=spearman(prior_wars, realized_wars),
        deciles=tuple(deciles),
    )


def load_all_seasons(path: Path, years: set[int]) -> dict[int, list[ImpactRow]]:
    rows_by_year: dict[int, list[ImpactRow]] = defaultdict(list)
    for year in years:
        rows_by_year[year] = load_impact_rows(path, season_year=year)
    return dict(rows_by_year)


def write_report(
    comparison: MetricComparison,
    backtests: list[SeasonBacktest],
    path: Path,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# FV Validation — metric comparison and predictive backtest",
        "",
        "Generated by `python -m nba_stock_market.fv_validation`. Inputs: LEBRON history",
        "(`gabriel1200/site_Data`), current DARKO DPM (public darko.app sheet). EPM is",
        "blocked on the Dunks & Threes API key and will slot into the same protocol.",
        "",
        "## 1. LEBRON vs DARKO on 2026-27 openings",
        "",
        f"- Shared players: **{comparison.joined_players}**",
        f"- Rating rank agreement (Spearman): **{comparison.rating_spearman:.3f}**",
        f"- Price rank agreement (Spearman): **{comparison.price_spearman:.3f}**",
        f"- Mean absolute price difference: **${comparison.mean_abs_price_delta:,.0f}**",
        "",
        "Impact-only prices (no salary blend) so the metric difference is isolated.",
        "DARKO is priced without shrinkage because it is already a shrunk Bayesian estimate.",
        "",
        "### Largest price disagreements",
        "",
        "| Player | LEBRON | DARKO DPM | Price (LEBRON) | Price (DARKO) | Delta |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for player, lebron, darko, lebron_price, darko_price in comparison.disagreements:
        lines.append(
            f"| {player} | {lebron:+.2f} | {darko:+.2f} | ${lebron_price:,.0f} "
            f"| ${darko_price:,.0f} | ${abs(lebron_price - darko_price):,.0f} |"
        )
    lines += [
        "",
        "## 2. Predictive backtest — can season N-1 listings rank season N value?",
        "",
        "Opening prices built from season N-1 LEBRON + minutes only (impact-only, no",
        "salary), scored against realized season-N **WAR** (production including",
        "minutes). Baseline: naively carrying forward last season's WAR.",
        "",
        "| Train → Test | Players | Price → WAR (Spearman) | Naive WAR baseline |",
        "|---|---:|---:|---:|",
    ]
    for result in backtests:
        lines.append(
            f"| {result.train_year - 1}-{str(result.train_year)[2:]} → "
            f"{result.test_year - 1}-{str(result.test_year)[2:]} | {result.players} "
            f"| {result.price_spearman:.3f} | {result.naive_war_spearman:.3f} |"
        )
    latest = backtests[-1]
    lines += [
        "",
        f"### Decile check ({latest.train_year - 1}-{str(latest.train_year)[2:]} prices → "
        f"{latest.test_year - 1}-{str(latest.test_year)[2:]} realized WAR)",
        "",
        "| Price decile | Mean opening price | Mean realized WAR |",
        "|---:|---:|---:|",
    ]
    for decile, mean_price, mean_war in latest.deciles:
        lines.append(f"| {decile} | ${mean_price:,.0f} | {mean_war:.2f} |")
    lines += [
        "",
        "Reading: decile 1 = the ten percent of players our model lists most expensive.",
        "A good FV model shows monotonically falling realized WAR down the deciles and a",
        "price→WAR correlation at or above the naive baseline (the naive baseline gets",
        "minutes information for free via prior WAR; matching it with a rate-based price",
        "is the bar to clear).",
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate opening-price fair values.")
    parser.add_argument("--lebron-file", type=Path, default=DEFAULT_LEBRON_FILE)
    parser.add_argument("--darko-file", type=Path, default=DEFAULT_DARKO_FILE)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT_FILE)
    args = parser.parse_args()

    lebron_current = load_impact_rows(args.lebron_file, season_year=2026)
    darko_current = load_darko_rows(args.darko_file)
    comparison = compare_metrics(lebron_current, darko_current)

    years = {year for pair in BACKTEST_SEASON_PAIRS for year in pair}
    rows_by_year = load_all_seasons(args.lebron_file, years)
    backtests = [
        backtest_season_pair(rows_by_year, train_year, test_year)
        for train_year, test_year in BACKTEST_SEASON_PAIRS
    ]

    write_report(comparison, backtests, args.report)
    print(f"wrote {args.report}")
    print(
        f"metric agreement: rating rho={comparison.rating_spearman:.3f} "
        f"across {comparison.joined_players} players"
    )
    for result in backtests:
        print(
            f"{result.train_year}->{result.test_year}: price rho={result.price_spearman:.3f} "
            f"vs naive WAR rho={result.naive_war_spearman:.3f} (n={result.players})"
        )


if __name__ == "__main__":
    main()
