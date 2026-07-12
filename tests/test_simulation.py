from __future__ import annotations

import math

import pytest

from nba_stock_market.engine import IMPACT_K
from nba_stock_market.simulation import (
    SimulationConfig,
    _price_metrics,
    build_sample_market,
    render_impact_report,
    run_impact_sweep,
    run_simulation,
    run_strategy_comparison,
)


def test_sample_market_accepts_explicit_price_impact() -> None:
    market = build_sample_market(impact_k=0.01, trader_count=12)

    assert market.impact_k == 0.01
    assert market.reversion_rate == 0.0


def test_default_market_uses_calibrated_prototype_price_impact() -> None:
    assert IMPACT_K == 0.003
    assert build_sample_market().impact_k == IMPACT_K


def test_simulation_reports_orders_price_behavior_and_invariants() -> None:
    result = run_simulation(
        SimulationConfig(
            seed=42,
            days=20,
            traders=24,
            trades_per_day=48,
            impact_k=0.01,
            scenario="balanced",
        )
    )

    orders = result["order_metrics"]
    assert orders["attempted"] > 0
    assert 0 < orders["executed"] <= orders["attempted"]
    assert 0.75 <= orders["execution_rate"] <= 1
    assert orders["fees_paid"] > 0

    health = result["market_health"]
    assert health["all_invariants_hold"] is True
    assert health["minimum_cash"] >= 0
    assert health["maximum_user_player_holding"] <= 1
    assert health["maximum_player_ownership_pct"] <= 100

    prices = result["price_metrics"]
    for key in (
        "median_abs_return_pct",
        "max_abs_return_pct",
        "max_drawdown_pct",
        "max_daily_move_pct",
        "max_price_multiple",
    ):
        assert math.isfinite(prices[key])
        assert prices[key] >= 0

    economy = result["economy_metrics"]
    assert economy["starting_wealth"] > 0
    assert economy["ending_wealth"] > 0
    assert economy["fees_paid_per_trader"] > 0
    assert math.isfinite(economy["wealth_change_pct"])


def test_stress_scenarios_preserve_market_invariants() -> None:
    for scenario in ("balanced", "hype", "boom_bust"):
        result = run_simulation(
            SimulationConfig(
                seed=2026,
                days=30,
                traders=36,
                trades_per_day=72,
                games_per_day=0,
                impact_k=0.01,
                scenario=scenario,
            )
        )
        assert result["market_health"]["all_invariants_hold"] is True


def test_impact_sweep_is_reproducible_and_never_enables_reversion() -> None:
    kwargs = {
        "candidates": (0.0003, 0.003, 0.01),
        "seeds": (7, 42),
        "days": 15,
        "traders": 24,
        "trades_per_day": 48,
    }

    first = run_impact_sweep(**kwargs)
    second = run_impact_sweep(**kwargs)

    assert first == second
    assert first["recommended_impact_k"] in kwargs["candidates"]
    assert {row["scenario"] for row in first["runs"]} == {
        "balanced",
        "hype",
        "boom_bust",
    }
    assert all(row["reversion_rate"] == 0.0 for row in first["runs"])
    assert all(row["all_invariants_hold"] for row in first["runs"])
    assert all(row["order_metrics"]["execution_rate"] >= 0.75 for row in first["runs"])
    assert isinstance(first["ready_for_production"], bool)


def test_impact_report_explains_recommendation_and_safety() -> None:
    sweep = run_impact_sweep(
        candidates=(0.0003, 0.01),
        seeds=(11,),
        days=8,
        traders=12,
        trades_per_day=24,
    )

    report = render_impact_report(sweep)

    assert "# Trader Simulation: Price-Impact Calibration" in report
    assert "Recommended `IMPACT_K`" in report
    assert "balanced" in report
    assert "hype" in report
    assert "boom_bust" in report
    assert "fair-value reversion remains off" in report
    assert "Economy finding" in report
    assert "production-ready" in report


def test_sweep_rejects_runs_without_real_trade_evidence() -> None:
    with pytest.raises(ValueError, match="days must be positive"):
        run_impact_sweep(days=0)
    with pytest.raises(ValueError, match="trades_per_day must be positive"):
        run_impact_sweep(trades_per_day=0)


def test_sweep_refuses_to_recommend_when_every_candidate_is_unsafe() -> None:
    with pytest.raises(ValueError, match="no impact candidate passed"):
        run_impact_sweep(
            candidates=(1.0,),
            seeds=(7,),
            days=8,
            traders=12,
            trades_per_day=24,
        )


def test_price_safety_metrics_include_intraday_trade_extrema() -> None:
    market = build_sample_market(impact_k=0.2, trader_count=1)
    player = market.players["pritchard"]
    opening = player.current_price
    buy = market.execute_trade("trader_000", player.id, 1, 1)
    sell = market.execute_trade("trader_000", player.id, -1, 1)

    metrics = _price_metrics(
        market,
        {player_id: row.opening_price for player_id, row in market.players.items()},
        {
            player_id: (
                [row.opening_price, buy.new_price, sell.new_price]
                if player_id == player.id
                else [row.opening_price]
            )
            for player_id, row in market.players.items()
        },
    )

    assert metrics["max_price_multiple"] == pytest.approx(buy.new_price / opening, rel=1e-6)
    assert metrics["max_drawdown_pct"] > 0


def test_generic_simulation_preserves_explicit_reversion_experiments() -> None:
    result = run_simulation(
        SimulationConfig(
            seed=3,
            days=3,
            traders=4,
            trades_per_day=4,
            games_per_day=0,
            reversion_rate=0.03,
        )
    )

    assert result["config"]["reversion_rate"] == 0.03


def test_legacy_strategy_comparison_preserves_full_variant_schema() -> None:
    comparison = run_strategy_comparison(seed=3, days=3)

    for variant in ("pure_crowd", "crowd_plus_gravity", "high_gravity"):
        assert {
            "config",
            "total_trades",
            "daily_dividend_events",
            "players",
            "leaderboard_top_5",
        } <= comparison[variant].keys()


def test_game_only_simulation_supports_zero_traders() -> None:
    result = run_simulation(
        SimulationConfig(
            seed=3,
            days=3,
            traders=0,
            trades_per_day=0,
            games_per_day=2,
        )
    )

    assert result["total_trades"] == 0
    assert result["economy_metrics"]["fees_paid_per_trader"] == 0
    assert result["economy_metrics"]["notional_per_trader"] == 0


def test_overflowing_impact_candidate_is_reported_as_unsafe() -> None:
    with pytest.raises(ValueError, match="no impact candidate passed"):
        run_impact_sweep(
            candidates=(1000.0,),
            seeds=(7,),
            days=2,
            traders=4,
            trades_per_day=4,
        )
