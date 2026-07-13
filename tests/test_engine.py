from __future__ import annotations

import math
import unittest
from datetime import date

from nba_stock_market.engine import (
    FEE_PCT,
    MAX_SHARES_PER_USER_PER_PLAYER,
    MIN_PRICE_FLOOR,
    NET_POINTS_TO_DOLLARS,
    REVERSION_RATE,
    SHARES_OUT,
    STARTING_CASH,
    BoxScoreLine,
    Market,
    NetPointsModel,
    Player,
    TradeError,
    TradeSide,
    User,
)
from nba_stock_market.simulation import (
    SimulatedGameResult,
    SimulationConfig,
    build_sample_market,
    run_simulation,
    run_strategy_comparison,
)


class PricingEngineTest(unittest.TestCase):
    def test_expectation_bias_shifts_expected_net_points_before_dividend(self) -> None:
        player = Player("p1", "Bias Player", "star", 10_000_000, 10_000_000)
        holder = User("holder", cash=0, holdings={"p1": 1})
        market = Market(
            [player],
            [holder],
            expectation_bias=2.5,
            net_points_to_dollars=100.0,
        )

        event = market.pay_daily_performance_dividend(
            "p1", actual_net_points=15.0, expected_net_points=10.0
        )

        self.assertEqual(event.expected_net_points, 12.5)
        self.assertEqual(event.dividend_per_share, 2.5)
        self.assertEqual(holder.cash, 2.5)

    def test_player_preserves_legacy_positional_optional_arguments(self) -> None:
        player = Player(
            "p",
            "Positional Player",
            "mid",
            20_000_000,
            21_000_000,
            19_000_000,
            77,
        )

        self.assertEqual(player.opening_price, 19_000_000)
        self.assertEqual(player.shares_outstanding, 77)
        self.assertIsNone(player.actual_salary)

    def test_engine_v2_uses_salary_cap_bankroll(self) -> None:
        self.assertEqual(STARTING_CASH, 140_000_000.0)
        self.assertEqual(User("new_user").cash, 140_000_000.0)
        self.assertEqual(SHARES_OUT, 100)
        self.assertEqual(MAX_SHARES_PER_USER_PER_PLAYER, 1)
        self.assertEqual(FEE_PCT, 0.0025)

    def test_second_share_of_same_player_is_rejected_but_sell_and_rebuy_is_legal(self) -> None:
        market = Market(
            [Player("jokic", "Nikola Jokic", "star", 68_000_000.0, 68_000_000.0)],
            [User("holder")],
        )
        market.execute_trade("holder", "jokic", TradeSide.BUY, 1)
        with self.assertRaisesRegex(TradeError, "per-user holding cap"):
            market.execute_trade("holder", "jokic", TradeSide.BUY, 1)
        market.execute_trade("holder", "jokic", TradeSide.SELL, 1)
        market.execute_trade("holder", "jokic", TradeSide.BUY, 1)
        self.assertEqual(market.users["holder"].shares("jokic"), 1)

    def test_reversion_is_off_by_default(self) -> None:
        market = Market(
            [Player("p", "Unanchored Player", "star", 50_000_000.0, 70_000_000.0)],
            inactivity_decay_rate=0.0,
            grace_days=0,
        )
        self.assertEqual(REVERSION_RATE, 0.0)
        self.assertEqual(market.reversion_rate, 0.0)
        market.advance_day(apply_idle_fee=False)
        self.assertEqual(market.players["p"].current_price, 50_000_000.0)

    def test_rescaled_minimum_price_floor(self) -> None:
        self.assertGreaterEqual(MIN_PRICE_FLOOR, 100_000.0)
        player = Player("p", "Floor Player", "bench", 2_000_000.0, 500_000.0)
        self.assertEqual(player.floor, MIN_PRICE_FLOOR)

    def test_inactive_price_decays_after_grace_period(self) -> None:
        market = Market(
            [Player("p", "Inactive Player", "mid", 20_000_000.0, 20_000_000.0)],
            idle_cash_fee=0.0,
            grace_days=2,
            inactivity_decay_rate=0.005,
        )
        market.advance_day()
        market.advance_day()
        self.assertEqual(market.players["p"].current_price, 20_000_000.0)
        market.advance_day()
        self.assertEqual(market.players["p"].current_price, 19_900_000.0)

    def test_net_points_model_uses_transparent_box_score_inputs(self) -> None:
        line = BoxScoreLine(
            pts=30,
            offensive_rebounds=2,
            defensive_rebounds=8,
            ast=7,
            stl=2,
            blk=1,
            tov=3,
            fga=20,
            fgm=11,
            three_pa=8,
            three_pm=4,
            fta=6,
            ftm=4,
            minutes=36,
        )
        model = NetPointsModel()
        self.assertTrue(math.isfinite(model.score(line)))
        self.assertGreater(model.score(line), 0.0)

    def test_daily_dividend_is_zero_at_exact_expectation(self) -> None:
        market = Market([Player("p", "Expected Player", "star", 50_000_000.0, 50_000_000.0)])
        event = market.pay_daily_performance_dividend(
            "p", actual_net_points=17.25, expected_net_points=17.25
        )
        self.assertAlmostEqual(event.dividend_per_share, 0.0)
        self.assertAlmostEqual(event.total_cash_change, 0.0)

    def test_provisional_dividend_pays_800k_for_twenty_point_surprise(self) -> None:
        holder = User("holder", holdings={"p": 1})
        market = Market(
            [Player("p", "Holder Player", "star", 50_000_000.0, 50_000_000.0)],
            [holder],
        )
        event = market.pay_daily_performance_dividend(
            "p", actual_net_points=40.0, expected_net_points=20.0
        )
        self.assertEqual(event.dividend_per_share, 800_000.0)
        self.assertEqual(holder.cash - STARTING_CASH, 800_000.0)

    def test_duplicate_settlement_returns_prior_event_without_changing_cash(self) -> None:
        holder = User("holder", holdings={"p": 1})
        market = Market(
            [Player("p", "Holder Player", "star", 50_000_000.0, 50_000_000.0)],
            [holder],
        )
        first = market.pay_daily_performance_dividend(
            "p",
            actual_net_points=40.0,
            expected_net_points=20.0,
            settlement_key="game-1",
        )
        cash_after_first = holder.cash

        duplicate = market.pay_daily_performance_dividend(
            "p",
            actual_net_points=40.0,
            expected_net_points=20.0,
            settlement_key="game-1",
        )

        self.assertIs(duplicate, first)
        self.assertEqual(holder.cash, cash_after_first)
        self.assertEqual(market.dividend_events, [first])

    def test_distinct_settlement_keys_each_pay_dividends(self) -> None:
        holder = User("holder", holdings={"p": 1})
        market = Market(
            [Player("p", "Holder Player", "star", 50_000_000.0, 50_000_000.0)],
            [holder],
        )

        for settlement_key in ("game-1", "game-2"):
            market.pay_daily_performance_dividend(
                "p",
                actual_net_points=40.0,
                expected_net_points=20.0,
                settlement_key=settlement_key,
            )

        self.assertEqual(holder.cash - STARTING_CASH, 1_600_000.0)
        self.assertEqual(len(market.dividend_events), 2)

    def test_daily_dividend_positive_and_negative_results_are_symmetric(self) -> None:
        holder = User("holder", holdings={"p": 4})
        market = Market(
            [Player("p", "Symmetry Player", "star", 50_000_000.0, 50_000_000.0)],
            [holder],
            max_shares_per_user_per_player=4,
        )
        opening_cash = holder.cash
        positive = market.pay_daily_performance_dividend(
            "p", actual_net_points=20.0, expected_net_points=15.0
        )
        negative = market.pay_daily_performance_dividend(
            "p", actual_net_points=10.0, expected_net_points=15.0
        )
        self.assertEqual(positive.dividend_per_share, -negative.dividend_per_share)
        self.assertEqual(positive.total_cash_change, -negative.total_cash_change)
        self.assertAlmostEqual(holder.cash, opening_cash)

    def test_daily_dividend_is_proportional_to_surprise_and_shares(self) -> None:
        one_share = User("one", holdings={"p": 1})
        three_shares = User("three", holdings={"p": 3})
        market = Market(
            [Player("p", "Proportional Player", "star", 50_000_000.0, 50_000_000.0)],
            [one_share, three_shares],
            max_shares_per_user_per_player=3,
        )
        event = market.pay_daily_performance_dividend(
            "p", actual_net_points=22.0, expected_net_points=20.0
        )
        expected_per_share = 2.0 * NET_POINTS_TO_DOLLARS / SHARES_OUT
        self.assertEqual(event.dividend_per_share, expected_per_share)
        self.assertEqual(one_share.cash - STARTING_CASH, expected_per_share)
        self.assertEqual(three_shares.cash - STARTING_CASH, 3 * expected_per_share)
        self.assertEqual(event.total_cash_change, 4 * expected_per_share)

    def test_game_result_can_resolve_box_score_expectation_from_injected_source(self) -> None:
        expected_line = BoxScoreLine(20, 1, 5, 6, 1, 1, 2, 15, 8, 5, 2, 4, 2, 32)

        class FixedExpectationSource:
            def expected_performance(self, player: Player, game_date: date) -> BoxScoreLine:
                self.call = (player.id, game_date)
                return expected_line

        source = FixedExpectationSource()
        market = Market(
            [Player("p", "Projected Player", "star", 50_000_000.0, 50_000_000.0)],
            expectation_source=source,
        )
        event = market.apply_game_result("p", actual=expected_line, game_date=date(2026, 1, 15))
        self.assertEqual(source.call, ("p", date(2026, 1, 15)))
        self.assertAlmostEqual(event.dividend_per_share, 0.0)

    def test_game_result_forwards_settlement_key(self) -> None:
        holder = User("holder", holdings={"p": 1})
        market = Market(
            [Player("p", "Result Player", "star", 50_000_000.0, 50_000_000.0)],
            [holder],
        )

        first = market.apply_game_result(
            "p", actual=40.0, expected=20.0, settlement_key="game-1"
        )
        duplicate = market.apply_game_result(
            "p", actual=40.0, expected=20.0, settlement_key="game-1"
        )

        self.assertIs(duplicate, first)
        self.assertEqual(holder.cash - STARTING_CASH, 800_000.0)

    def test_market_rejects_preloaded_holdings_beyond_player_float(self) -> None:
        player = Player("p", "Finite Float", "star", 50_000_000.0, 50_000_000.0)
        users = [User(f"holder-{index}", holdings={"p": 1}) for index in range(101)]

        with self.assertRaisesRegex(ValueError, "shares outstanding"):
            Market([player], users)

    def test_market_rejects_preloaded_holdings_for_unknown_player(self) -> None:
        player = Player("p", "Known Player", "star", 50_000_000.0, 50_000_000.0)

        with self.assertRaisesRegex(ValueError, "unknown player"):
            Market([player], [User("holder", holdings={"missing": 1})])

    def test_buy_increases_and_sell_decreases_price(self) -> None:
        market = Market(
            [Player("p", "Test Player", "mid", 10_000_000.0, 12_000_000.0)],
            [User("u")],
            grace_days=0,
        )
        buy = market.execute_trade("u", "p", TradeSide.BUY, 1)
        self.assertGreater(buy.new_price, buy.execution_price)
        sell = market.execute_trade("u", "p", TradeSide.SELL, 1)
        self.assertLess(sell.new_price, buy.new_price)

    def test_price_impact_overflow_rejects_trade_without_mutating_user(self) -> None:
        market = Market(
            [Player("p", "Overflow Player", "mid", 10_000_000.0, 10_000_000.0)],
            [User("u")],
            impact_k=1000.0,
        )
        starting_cash = market.users["u"].cash

        with self.assertRaisesRegex(TradeError, "price impact"):
            market.execute_trade("u", "p", TradeSide.BUY, 1)

        self.assertEqual(market.users["u"].cash, starting_cash)
        self.assertEqual(market.users["u"].shares("p"), 0)
        self.assertEqual(market.players["p"].current_price, 10_000_000.0)

    def test_doc_price_impact_examples(self) -> None:
        shallow = Market(
            [Player("p", "Example Player", "mid", 10_000_000.0, 10_000_000.0)],
            [User("u")],
        )
        trade = shallow.execute_trade("u", "p", TradeSide.BUY, 1)
        self.assertAlmostEqual(trade.new_price, 10_030_045.05, places=2)

        deep_player = Player("p", "Deep Player", "mid", 10_000_000.0, 10_000_000.0, volume_30d=80.0)
        deep = Market(
            [deep_player],
            [User("u")],
        )
        trade = deep.execute_trade("u", "p", TradeSide.BUY, 1)
        self.assertAlmostEqual(trade.new_price, 10_006_001.80, places=2)

    def test_zero_trade_day_with_no_reversion_preserves_price(self) -> None:
        market = Market([Player("p", "Static Player", "mid", 10_000_000.0, 14_000_000.0)], reversion_rate=0.0)
        market.advance_day(apply_idle_fee=False)
        self.assertEqual(market.players["p"].current_price, 10_000_000.0)

    def test_listing_grace_skips_fair_value_reversion(self) -> None:
        market = Market(
            [Player("p", "New Listing", "star", 10_000_000.0, 20_000_000.0)],
            reversion_rate=1.0,
            inactivity_decay_rate=0.0,
        )
        for _ in range(7):
            market.advance_day(apply_idle_fee=False)
        self.assertEqual(market.players["p"].current_price, 10_000_000.0)
        market.advance_day(apply_idle_fee=False)
        self.assertEqual(market.players["p"].current_price, 20_000_000.0)

    def test_fair_value_gravity_moves_up_and_down(self) -> None:
        market = Market(
            [
                Player("cheap", "Underpriced", "mid", 10_000_000.0, 15_000_000.0),
                Player("rich", "Overpriced", "mid", 15_000_000.0, 10_000_000.0),
            ],
            reversion_rate=0.10,
            grace_days=0,
        )
        market.advance_day(apply_idle_fee=False)
        self.assertGreater(market.players["cheap"].current_price, 10_000_000.0)
        self.assertLess(market.players["rich"].current_price, 15_000_000.0)

    def test_high_reversion_respects_live_floor(self) -> None:
        market = Market(
            [Player("p", "Floor Player", "bench", 2_000_000.0, 50_000.0)],
            reversion_rate=1.0,
            grace_days=0,
            inactivity_decay_rate=0.0,
        )
        market.advance_day(apply_idle_fee=False)
        self.assertEqual(market.players["p"].current_price, MIN_PRICE_FLOOR)

    def test_all_buy_pressure_moves_market_up(self) -> None:
        market = Market(
            [Player("p", "Demand Player", "star", 10_000_000.0, 10_000_000.0)],
            [User(f"u{i}") for i in range(20)],
        )
        for idx in range(20):
            market.execute_trade(f"u{idx}", "p", TradeSide.BUY, 1)
        self.assertGreater(market.players["p"].current_price, 10_000_000.0)

    def test_all_sell_pressure_moves_market_down(self) -> None:
        market = Market(
            [Player("p", "Supply Player", "star", 10_000_000.0, 10_000_000.0)],
            [User(f"u{i}") for i in range(20)],
        )
        for idx in range(20):
            market.execute_trade(f"u{idx}", "p", TradeSide.BUY, 1)
        after_buy = market.players["p"].current_price
        for idx in range(20):
            market.execute_trade(f"u{idx}", "p", TradeSide.SELL, 1)
        self.assertLess(market.players["p"].current_price, after_buy)

    def test_invalid_trades_are_rejected(self) -> None:
        market = Market(
            [Player("p", "Strict Player", "mid", 10_000_000.0, 10_000_000.0)],
            [User("u", cash=5_000_000.0)],
        )
        with self.assertRaises(TradeError):
            market.execute_trade("u", "p", TradeSide.BUY, 1)
        with self.assertRaises(TradeError):
            market.execute_trade("u", "p", TradeSide.SELL, 1)

    def test_invalid_quantities_are_rejected_before_mutation(self) -> None:
        market = Market([Player("p", "Quantity Player", "mid", 10_000_000.0, 10_000_000.0)], [User("u")])
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
        market = Market([Player("p", "Known Player", "mid", 10_000_000.0, 10_000_000.0)])
        with self.assertRaises(TradeError):
            market.execute_trade("new_user", "missing", TradeSide.BUY, 1)
        self.assertNotIn("new_user", market.users)

    def test_raw_side_values_are_normalized_before_accounting(self) -> None:
        market = Market([Player("p", "Raw Side Player", "mid", 10_000_000.0, 10_000_000.0)], [User("u")])
        trade = market.execute_trade("u", "p", 1, 1)
        self.assertEqual(trade.side, TradeSide.BUY)
        self.assertEqual(market.users["u"].shares("p"), 1)
        cash_after_buy = market.users["u"].cash
        shares_after_buy = market.users["u"].shares("p")
        with self.assertRaises(TradeError):
            market.execute_trade("u", "p", 99, 1)
        self.assertEqual(market.users["u"].cash, cash_after_buy)
        self.assertEqual(market.users["u"].shares("p"), shares_after_buy)

    def test_per_user_holding_cap_rejects_second_share(self) -> None:
        market = Market([Player("p", "Cap Player", "star", 2_000_000.0, 2_000_000.0)], [User("u")])
        with self.assertRaises(TradeError):
            market.execute_trade("u", "p", TradeSide.BUY, 2)

    def test_aggregate_float_cannot_be_oversubscribed(self) -> None:
        market = Market(
            [Player("p", "Float Player", "star", 2_000_000.0, 2_000_000.0)],
            [User("u1"), User("u2"), User("u3")],
            max_shares_per_user_per_player=40,
        )
        market.execute_trade("u1", "p", TradeSide.BUY, 40)
        market.execute_trade("u2", "p", TradeSide.BUY, 40)
        market.execute_trade("u3", "p", TradeSide.BUY, 20)
        self.assertEqual(market.total_held_shares("p"), 100)
        with self.assertRaises(TradeError):
            market.execute_trade("u3", "p", TradeSide.BUY, 1)

    def test_base_trade_fee_is_quarter_percent_of_notional(self) -> None:
        market = Market([Player("p", "Fee Player", "mid", 2_000_000.0, 2_000_000.0)], [User("u")])

        buy = market.execute_trade("u", "p", TradeSide.BUY, 1)

        self.assertAlmostEqual(buy.fee, buy.execution_price * 0.0025, places=8)

    def test_flip_penalty_adds_half_percent_surcharge(self) -> None:
        market = Market([Player("p", "Churn Player", "mid", 2_000_000.0, 2_000_000.0)], [User("u")])
        market.execute_trade("u", "p", TradeSide.BUY, 1)
        sell = market.execute_trade("u", "p", TradeSide.SELL, 1)
        self.assertAlmostEqual(sell.fee, sell.execution_price * 0.0075, places=8)

    def test_flip_penalty_surcharge_caps_at_one_and_a_half_percent(self) -> None:
        market = Market([Player("p", "Capped Churn Player", "mid", 2_000_000.0, 2_000_000.0)], [User("u")])
        market.execute_trade("u", "p", TradeSide.BUY, 1)
        market.execute_trade("u", "p", TradeSide.SELL, 1)
        market.execute_trade("u", "p", TradeSide.BUY, 1)
        first_capped_trade = market.execute_trade("u", "p", TradeSide.SELL, 1)
        next_capped_trade = market.execute_trade("u", "p", TradeSide.BUY, 1)

        expected_total_fee_rate = FEE_PCT + 0.015
        self.assertAlmostEqual(
            first_capped_trade.fee,
            first_capped_trade.execution_price * expected_total_fee_rate,
            places=8,
        )
        self.assertAlmostEqual(
            next_capped_trade.fee,
            next_capped_trade.execution_price * expected_total_fee_rate,
            places=8,
        )

    def test_flip_penalty_roundtrip_count_expires_after_seven_days(self) -> None:
        market = Market(
            [Player("p", "Rolling Penalty Player", "mid", 2_000_000.0, 2_000_000.0)],
            [User("u")],
            reversion_rate=0.0,
        )
        market.execute_trade("u", "p", TradeSide.BUY, 1)
        market.execute_trade("u", "p", TradeSide.SELL, 1)
        for _ in range(8):
            market.advance_day(apply_idle_fee=False)
        market.execute_trade("u", "p", TradeSide.BUY, 1)
        sell = market.execute_trade("u", "p", TradeSide.SELL, 1)
        self.assertAlmostEqual(sell.fee, sell.execution_price * 0.0075, places=8)

    def test_portfolio_value_is_cash_plus_holdings(self) -> None:
        market = Market([Player("p", "Portfolio Player", "mid", 10_000_000.0, 10_000_000.0)], [User("u")])
        market.execute_trade("u", "p", TradeSide.BUY, 1)
        user = market.users["u"]
        expected = user.cash + user.shares("p") * market.players["p"].current_price
        self.assertAlmostEqual(market.portfolio_value("u"), expected)

    def test_dividend_formulas_are_data_driven(self) -> None:
        market = Market([Player("p", "Dividend Player", "star", 10_000_000.0, 10_000_000.0)])
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
        self.assertGreater(result["daily_dividend_events"], 0)
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
        self.assertEqual(market.reversion_rate, 0.0)
        for player in market.players.values():
            self.assertGreaterEqual(player.current_price, 2_000_000.0)
            self.assertLessEqual(player.current_price, 70_000_000.0)

    def test_simulation_accepts_per_day_game_results_hook(self) -> None:
        calls: list[int] = []

        def fixed_games(market: Market, day: int, _rng: object) -> list[SimulatedGameResult]:
            calls.append(day)
            return [SimulatedGameResult("jokic", actual_net_points=25.0, expected_net_points=20.0)]

        result = run_simulation(
            SimulationConfig(seed=9, days=3, traders=4, trades_per_day=0, games_per_day=0),
            game_results_hook=fixed_games,
        )
        self.assertEqual(calls, [0, 1, 2])
        self.assertEqual(result["daily_dividend_events"], 3)


if __name__ == "__main__":
    unittest.main()
