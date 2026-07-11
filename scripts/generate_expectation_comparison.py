"""Generate the deterministic four-model expectation comparison from cached data."""

from __future__ import annotations

import tempfile
from collections import defaultdict
from datetime import date
from pathlib import Path

from nba_stock_market.backtest import (
    _money,
    build_synthetic_users,
    load_salary_by_name,
    replay_game_records,
    run_backtest,
    select_universe,
)
from nba_stock_market.engine import NET_POINTS_TO_DOLLARS, Market, Player
from nba_stock_market.expectations import (
    DunksAndThreesExpectation,
    ProductionExpectation,
    SalaryProjectionExpectation,
    TrailingMeanExpectation,
)
from nba_stock_market.historical_data import load_game_records


DATA_DIR = Path("data/raw/2025-26")
OUTPUT_PATH = Path("output/expectation-comparison.md")
MODEL_LABELS = {
    "trailing": "Trailing",
    "projection": "Salary-projection",
    "dnt": "D&T",
    "production": "Production",
}


def _source(model: str) -> object:
    if model == "trailing":
        return TrailingMeanExpectation(window=10)
    if model == "projection":
        return SalaryProjectionExpectation()
    if model == "dnt":
        return DunksAndThreesExpectation(cache_dir=DATA_DIR.parent / "dnt")
    return ProductionExpectation()


def _replays() -> tuple[list[object], dict[str, object]]:
    games = load_game_records(DATA_DIR / "player_game_logs.csv")
    salaries = load_salary_by_name(
        [DATA_DIR / "salaries.csv", DATA_DIR / "salaries-fallback.csv"]
    )
    universe = select_universe(games, salaries, size=150)
    universe_ids = {player.player_id for player in universe}
    selected_games = [game for game in games if game.player_id in universe_ids]
    replays = {}
    for model in MODEL_LABELS:
        source = _source(model)
        market = Market(
            [
                Player(player.player_id, player.name, player.tier, player.salary, player.salary)
                for player in universe
            ],
            build_synthetic_users(universe, count=100, seed=2026),
            expectation_source=source,
            reversion_rate=0.0,
            inactivity_decay_rate=0.0,
            impact_k=0.0,
            net_points_to_dollars=NET_POINTS_TO_DOLLARS,
        )
        replays[model] = replay_game_records(market, selected_games, source)
    return universe, replays


def _top_table(rows: list[dict[str, object]]) -> list[str]:
    lines = [
        "| Rank | Player | Tier | Salary | Games | Season / share | Full float |",
        "|---:|---|---|---:|---:|---:|---:|",
    ]
    for rank, row in enumerate(rows, 1):
        lines.append(
            f"| {rank} | {row['name']} | {row['tier']} | {_money(row['salary'])} | "
            f"{row['games']} | {_money(row['season_dividend_per_share'])} | "
            f"{_money(row['season_dividend_full_float'])} |"
        )
    return lines


def generate() -> str:
    with tempfile.TemporaryDirectory() as directory:
        reports = {
            model: run_backtest(
                DATA_DIR, Path(directory) / model, expectation_model=model
            )
            for model in MODEL_LABELS
        }
    universe, replays = _replays()

    lines = [
        "# Four-Way Expectation Model Comparison",
        "",
        "This deterministic comparison replays the same cached 2025-26 season, "
        "150-player universe, 100 synthetic portfolios, and unchanged $100,000-per-net-point "
        "full-float constant under `trailing`, `salary-projection`, `dnt`, and `production`. "
        "No network calls are made; D&T uses the 164 cached game dates in `data/raw/dnt`.",
        "",
        "## Net season inflation",
        "",
        "| Model | Gross positive faucet | Net inflation | Initial wealth | Net inflation rate |",
        "|---|---:|---:|---:|---:|",
    ]
    for model, label in MODEL_LABELS.items():
        money = reports[model]["money_supply"]
        lines.append(
            f"| {label} | {_money(money['gross_positive_dividends'])} | "
            f"{_money(money['net_inflation'])} | {_money(money['initial_portfolio_wealth'])} | "
            f"{money['net_inflation_pct']:.4f}% |"
        )
    production_faucet = reports["production"]["money_supply"]["gross_positive_dividends"]
    dnt_faucet = reports["dnt"]["money_supply"]["gross_positive_dividends"]
    lines.extend(
        [
            "",
            f"Production is explicitly the much larger faucet: {_money(production_faucet)} "
            f"of gross positive payouts, versus {_money(dnt_faucet)} under D&T, because no "
            "expected value is subtracted from positive game-log production.",
        ]
    )

    for model, label in MODEL_LABELS.items():
        lines.extend(
            [
                "",
                f"## Top 10 season earners — {label}",
                "",
                *_top_table(reports[model]["distribution"]["top_10"]),
            ]
        )

    lines.extend(
        [
            "",
            "## Nikola Jokic on Christmas 2025",
            "",
            "ESPN game `401809242` on 2025-12-25 produced 59.35 actual net points.",
            "",
            "| Model | Expected NP | Dividend NP | Payout / share | Full-float payout |",
            "|---|---:|---:|---:|---:|",
        ]
    )
    jokic_date = date(2025, 12, 25)
    for model, label in MODEL_LABELS.items():
        evaluation = next(
            item
            for item in replays[model].evaluations
            if item.game.player_name == "Nikola Jokic"
            and item.game.game_date == jokic_date
        )
        dividend_np = evaluation.actual_net_points - evaluation.expected_net_points
        lines.append(
            f"| {label} | {evaluation.expected_net_points:.2f} | {dividend_np:+.2f} | "
            f"{_money(evaluation.dividend_per_share)} | "
            f"{_money(evaluation.dividend_per_share * 100)} |"
        )

    production_totals: defaultdict[str, float] = defaultdict(float)
    for evaluation in replays["production"].evaluations:
        production_totals[evaluation.game.player_id] += evaluation.dividend_per_share
    yield_ranked = sorted(
        universe,
        key=lambda player: (
            -production_totals[player.player_id] / player.salary,
            player.player_id,
        ),
    )[:10]
    lines.extend(
        [
            "",
            "## Production-only: top 10 season yield",
            "",
            "Yield is season production dividends per share divided by the salary-listing "
            "price. This exposes the cheap-producer, or ‘Sexton over Luka,’ effect in Russ's model.",
            "",
            "| Rank | Player | Salary-listing price | Production dividends / share | Season yield |",
            "|---:|---|---:|---:|---:|",
        ]
    )
    for rank, player in enumerate(yield_ranked, 1):
        dividends = production_totals[player.player_id]
        lines.append(
            f"| {rank} | {player.name} | {_money(player.salary)} | {_money(dividends)} | "
            f"{100 * dividends / player.salary:.2f}% |"
        )

    lines.extend(
        [
            "",
            "## Neutral takeaway",
            "",
            "Production is simple and effectively always-positive (except genuinely negative "
            "net-points games), but its much larger faucet needs a smaller dollars-per-net-point "
            "constant; with salary-listing prices unchanged, the market prices that inflation "
            "through yield-hunting for cheap producers. "
            "Surprise-based D&T is closer to zero-sum, riskier and spicier, and makes projection "
            "quality part of the forecasting game. This comparison makes no recommendation; the "
            "team decides which dividend design it wants.",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> None:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(generate(), encoding="utf-8")
    print(f"Wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
