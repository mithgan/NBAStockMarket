from __future__ import annotations

import math
import unittest

from nba_stock_market.engine import Market, Player, TradeError, TradeSide, User
from nba_stock_market.simulation import SimulationConfig, build_sample_market, run_simulation, run_strategy_comparison


class PricingEngineTest(unittest.TestCase):
    def test_buy_increases_and_sell_decreases_price(self) -> None:
        market = Market([Player("p", "Test Player", "mid", 100.0, 120.0)], [User("u")], grace_days=0)
        buy = market.execute_trade("u", "p", TradeSide.BUY, 5)
        self.assertGreater(buy.new_price, buy.execution_price)
        sell = market.execute_trade("u", "p", TradeSide.SELL, 3)
        self.assertLess(sell.new_price, buy.new_price)

    def test_doc_price_impact_examples(self) -> None:
        shallow = Market([Player("p", "Example Player", "mid", 100.0, 100.0)], [User("u")])
        trade = shallow.execute_trade("u", "p", TradeSide.BUY, 20)
        self.assertAlmostEqual(trade.new_price, 100.60, places=2)

        deep_player = Player("p", "Deep Player", "mid", 100.0, 100.0, volume_30d=80.0)
        deep = Market([deep_player], [User("u")])
        trade = deep.execute_trade("u", "p", TradeSide.BUY, 20)
        self.assertAlmostEqual(trade.new_price, 100.12, places=2)

    def test_zero_trade_day_with_no_reversion_preserves_price(self) -> None:
        market = Market([Player("p", "Static Player", "mid", 100.0, 140.0)], reversion_rate=0.0)
        market.advance_day(apply_idle_fee=False)
        self.assertEqual(market.players["p"].current_price, 100.0)

    def test_listing_grace_skips_fair_value_reversion(self) -> None:
        market = Market([Player("p", "New Listing", "star", 100.0, 200.0)], reversion_rate=1.0)
        for _ in range(7):
            market.advance_day(apply_idle_fee=False)
        self.assertEqual(market.players["p"].current_price, 100.0)
        market.advance_day(apply_idle_fee=False)
        self.assertEqual(market.players["p"].current_price, 200.0)

    def test_fair_value_gravity_moves_up_and_down(self) -> None:
        market = Market(
            [
                Player("cheap", "Underpriced", "mid", 100.0, 150.0),
                Player("rich", "Overpriced", "mid", 150.0, 100.0),
            ],
            reversion_rate=0.10,
            grace_days=0,
        )
        market.advance_day(apply_idle_fee=False)
        self.assertGreater(market.players["cheap"].current_price, 100.0)
        self.assertLess(market.players["rich"].current_price, 150.0)

    def test_high_reversion_respects_live_floor(self) -> None:
        market = Market([Player("p", "Floor Player", "bench", 200.0, 10.0)], reversion_rate=1.0, grace_days=0)
        market.advance_day(apply_idle_fee=False)
        self.assertEqual(market.players["p"].current_price, 25.0)

    def test_all_buy_pressure_moves_market_up(self) -> None:
        market = Market([Player("p", "Demand Player", "star", 100.0, 100.0)], [User(f"u{i}") for i in range(20)])
        for idx in range(20):
            market.execute_trade(f"u{idx}", "p", TradeSide.BUY, 1)
        self.assertGreater(market.players["p"].current_price, 100.0)

    def test_all_sell_pressure_moves_market_down(self) -> None:
        market = Market([Player("p", "Supply Player", "star", 100.0, 100.0)], [User(f"u{i}") for i in range(20)])
        for idx in range(20):
            market.execute_trade(f"u{idx}", "p", TradeSide.BUY, 1)
        after_buy = market.players["p"].current_price
        for idx in range(20):
            market.execute_trade(f"u{idx}", "p", TradeSide.SELL, 1)
        self.assertLess(market.players["p"].current_price, after_buy)

    def test_invalid_trades_are_rejected(self) -> None:
        market = Market([Player("p", "Strict Player", "mid", 100.0, 100.0)], [User("u", cash=50.0)])
        with self.assertRaises(TradeError):
            market.execute_trade("u", "p", TradeSide.BUY, 1)
        with self.assertRaises(TradeError):
            market.execute_trade("u", "p", TradeSide.SELL, 1)

    def test_invalid_quantities_are_rejected_before_mutation(self) -> None:
        market = Market([Player("p", "Quantity Player", "mid", 100.0, 100.0)], [User("u")])
        before_cash = market.users["u"].cash
        before_price = market.players["p"].current_price
        for bad_quantity in (0, -1, 1.5, math.nan, True):
            with self.assertRaises(TradeError):
                market.execute_trade("u", "p", TradeSide.BUY, bad_quantity)  # type: ignore[arg-type]
            self.assertEqual(market.users["u"].cash, before_cash)
            self.assertEqual(market.users["u"].shares("p"), 0)
            self.assertEqual(market.players["p"].current_price, before_price)
            self.assertEqual(market.players["p"].volume_30d, 0.0)

    def test_unknown_player_is_rejected_before_user_creation(self) -> None:
        market = Market([Player("p", "Known Player", "mid", 100.0, 100.0)])
        with self.assertRaises(TradeError):
            market.execute_trade("new_user", "missing", TradeSide.BUY, 1)
        self.assertNotIn("new_user", market.users)

    def test_raw_side_values_are_normalized_before_accounting(self) -> None:
        market = Market([Player("p", "Raw Side Player", "mid", 100.0, 100.0)], [User("u")])
        trade = market.execute_trade("u", "p", 1, 1)
        self.assertEqual(trade.side, TradeSide.BUY)
        self.assertEqual(market.users["u"].shares("p"), 1)
        cash_after_buy = market.users["u"].cash
        shares_after_buy = market.users["u"].shares("p")
        with self.assertRaises(TradeError):
            market.execute_trade("u", "p", 99, 1)
        self.assertEqual(market.users["u"].cash, cash_after_buy)
        self.assertEqual(market.users["u"].shares("p"), shares_after_buy)

    def test_ownership_cap_rejects_oversized_position(self) -> None:
        market = Market([Player("p", "Cap Player", "star", 10.0, 10.0)], [User("u")])
        with self.assertRaises(TradeError):
            market.execute_trade("u", "p", TradeSide.BUY, 41)

    def test_aggregate_float_cannot_be_oversubscribed(self) -> None:
        market = Market([Player("p", "Float Player", "star", 10.0, 10.0)], [User("u1"), User("u2"), User("u3")])
        market.execute_trade("u1", "p", TradeSide.BUY, 40)
        market.execute_trade("u2", "p", TradeSide.BUY, 40)
        market.execute_trade("u3", "p", TradeSide.BUY, 20)
        self.assertEqual(market.total_held_shares("p"), 100)
        with self.assertRaises(TradeError):
            market.execute_trade("u3", "p", TradeSide.BUY, 1)

    def test_flip_penalty_adds_extra_fee(self) -> None:
        market = Market([Player("p", "Churn Player", "mid", 10.0, 10.0)], [User("u")])
        market.execute_trade("u", "p", TradeSide.BUY, 10)
        sell = market.execute_trade("u", "p", TradeSide.SELL, 1)
        self.assertGreater(sell.fee, sell.execution_price * 0.01)

    def test_flip_penalty_roundtrip_count_expires_after_seven_days(self) -> None:
        market = Market([Player("p", "Rolling Penalty Player", "mid", 10.0, 10.0)], [User("u")], reversion_rate=0.0)
        market.execute_trade("u", "p", TradeSide.BUY, 10)
        market.execute_trade("u", "p", TradeSide.SELL, 1)
        for _ in range(8):
            market.advance_day(apply_idle_fee=False)
        market.execute_trade("u", "p", TradeSide.BUY, 1)
        sell = market.execute_trade("u", "p", TradeSide.SELL, 1)
        self.assertAlmostEqual(sell.fee, sell.execution_price * 0.03, places=8)

    def test_portfolio_value_is_cash_plus_holdings(self) -> None:
        market = Market([Player("p", "Portfolio Player", "mid", 100.0, 100.0)], [User("u")])
        market.execute_trade("u", "p", TradeSide.BUY, 2)
        user = market.users["u"]
        expected = user.cash + user.shares("p") * market.players["p"].current_price
        self.assertAlmostEqual(market.portfolio_value("u"), expected)

    def test_dividend_formulas_are_data_driven(self) -> None:
        market = Market([Player("p", "Dividend Player", "star", 100.0, 100.0)])
        self.assertEqual(market.award_dividend_per_share("mvp"), 15.0)
        self.assertEqual(market.award_dividend_per_share("mvp_3"), 5.0)
        self.assertEqual(market.award_dividend_per_share("mvp_5"), 3.0)
        self.assertEqual(market.award_dividend_per_share("dpoy_3"), 3.0)
        self.assertEqual(market.award_dividend_per_share("mip_3"), 2.0)
        self.assertEqual(market.award_dividend_per_share("roy_3"), 2.0)
        self.assertEqual(market.award_dividend_per_share("player_of_week"), 1.0)
        self.assertAlmostEqual(market.season_dividend_per_share(warp=8.0, minutes=2500), 12.95, places=2)

    def test_sample_simulation_has_finite_positive_prices(self) -> None:
        result = run_simulation(SimulationConfig(seed=42, days=20, traders=12, trades_per_day=24))
        self.assertGreater(result["total_trades"], 0)
        for row in result["players"].values():
            price = row["price"]
            self.assertIsInstance(price, float)
            self.assertTrue(math.isfinite(price))
            self.assertGreater(price, 0)

    def test_gravity_variant_reduces_gap_to_fair_value(self) -> None:
        result = run_strategy_comparison(seed=7, days=40)
        summary = result["summary"]
        self.assertLess(summary["gravity_gap"], summary["pure_gap"])
        self.assertLess(summary["high_gravity_gap"], summary["pure_gap"])

    def test_simulation_is_reproducible_with_fixed_seed(self) -> None:
        first = run_strategy_comparison(seed=2026, days=15)
        second = run_strategy_comparison(seed=2026, days=15)
        self.assertEqual(first["summary"], second["summary"])
        self.assertEqual(first["crowd_plus_gravity"]["players"], second["crowd_plus_gravity"]["players"])

    def test_sample_market_uses_nine_real_players_across_tiers(self) -> None:
        market = build_sample_market()
        self.assertEqual(len(market.players), 9)
        tiers = {player.tier for player in market.players.values()}
        self.assertEqual(tiers, {"star", "mid", "bench"})


if __name__ == "__main__":
    unittest.main()
