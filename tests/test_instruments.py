from __future__ import annotations

import unittest
from datetime import date

from nba_stock_market.engine import Market, Player, TradeSide, User
from nba_stock_market.instruments import (
    BOOST_FEE_PCT,
    DOLLARS_PER_NET_POINT,
    InstrumentError,
    InstrumentsBook,
    MAX_WEEKLY_SHORTS_PER_PLAYER,
    PRICE_SHORT_BORROW_DAILY,
    PRICE_SHORT_COLLATERAL_PCT,
    PRICE_SHORT_STOP_OUT,
    SHORT_FEE_PCT,
    SHORT_MIN_FEE,
    WEEKLY_SHORT_COLLATERAL,
    week_of,
)


MONDAY = date(2026, 1, 5)
TUESDAY = date(2026, 1, 6)
WEDNESDAY = date(2026, 1, 7)


def make_book(*, users: int = 3, price: float = 40_000_000.0) -> InstrumentsBook:
    players = [
        Player("star", "Star Player", "star", price, price),
        Player("mid", "Mid Player", "mid", 15_000_000.0, 15_000_000.0),
        Player("bench", "Bench Player", "bench", 3_000_000.0, 3_000_000.0),
    ]
    market = Market(
        players,
        [User(f"u{i}") for i in range(users)],
        inactivity_decay_rate=0.0,
    )
    return InstrumentsBook(market)


class WeeklyShortTest(unittest.TestCase):
    def test_arm_charges_percent_fee_and_reserves_collateral(self) -> None:
        book = make_book()
        cash_before = book.market.users["u0"].cash
        position = book.arm_weekly_short("u0", "star", MONDAY)
        expected_fee = SHORT_FEE_PCT * 40_000_000.0
        self.assertAlmostEqual(cash_before - book.market.users["u0"].cash, expected_fee)
        self.assertAlmostEqual(book.reserved["u0"], WEEKLY_SHORT_COLLATERAL)
        self.assertEqual(position.week, week_of(MONDAY))

    def test_min_fee_applies_to_cheap_players(self) -> None:
        book = make_book()
        cash_before = book.market.users["u0"].cash
        book.arm_weekly_short("u0", "bench", MONDAY)
        self.assertAlmostEqual(cash_before - book.market.users["u0"].cash, SHORT_MIN_FEE)

    def test_cannot_short_held_player(self) -> None:
        book = make_book()
        book.market.execute_trade("u0", "star", TradeSide.BUY, 1)
        with self.assertRaises(InstrumentError):
            book.arm_weekly_short("u0", "star", MONDAY)

    def test_slot_limit_is_three_per_week(self) -> None:
        book = make_book()
        extra = Player("extra", "Extra Player", "mid", 10_000_000.0, 10_000_000.0)
        book.market.players["extra"] = extra
        for pid in ("star", "mid", "bench"):
            book.arm_weekly_short("u0", pid, MONDAY)
        with self.assertRaises(InstrumentError):
            book.arm_weekly_short("u0", "extra", MONDAY)

    def test_league_wide_player_cap(self) -> None:
        book = make_book(users=MAX_WEEKLY_SHORTS_PER_PLAYER + 1)
        for index in range(MAX_WEEKLY_SHORTS_PER_PLAYER):
            book.arm_weekly_short(f"u{index}", "star", MONDAY)
        with self.assertRaises(InstrumentError):
            book.arm_weekly_short(f"u{MAX_WEEKLY_SHORTS_PER_PLAYER}", "star", MONDAY)

    def test_accrual_clamps_per_game_and_week(self) -> None:
        book = make_book()
        book.arm_weekly_short("u0", "star", MONDAY)
        for day, surprise in ((MONDAY, 60.0), (TUESDAY, 40.0), (WEDNESDAY, 10.0)):
            book.record_game(
                "star", day, surprise_np=surprise, dividend_per_share=0.0,
                actual_minutes=34.0, projected_minutes=34.0,
            )
        cash_before = book.market.users["u0"].cash
        (settled,) = book.settle_week(week_of(MONDAY))
        self.assertAlmostEqual(settled.accrued_np, 25.0 + 25.0 + 10.0)
        self.assertAlmostEqual(settled.pnl, -50.0 * DOLLARS_PER_NET_POINT)
        self.assertAlmostEqual(book.market.users["u0"].cash - cash_before, settled.pnl)
        self.assertEqual(book.reserved["u0"], 0.0)

    def test_short_profits_when_player_underperforms(self) -> None:
        book = make_book()
        book.arm_weekly_short("u0", "star", MONDAY)
        book.record_game(
            "star", MONDAY, surprise_np=-12.0, dividend_per_share=-480_000.0,
            actual_minutes=30.0, projected_minutes=32.0,
        )
        (settled,) = book.settle_week(week_of(MONDAY))
        self.assertAlmostEqual(settled.pnl, 12.0 * DOLLARS_PER_NET_POINT)

    def test_dnp_games_accrue_nothing_and_empty_week_refunds(self) -> None:
        book = make_book()
        position = book.arm_weekly_short("u0", "star", MONDAY)
        cash_after_fee = book.market.users["u0"].cash
        book.record_game(
            "star", MONDAY, surprise_np=-20.0, dividend_per_share=0.0,
            actual_minutes=5.0, projected_minutes=34.0,
        )
        book.settle_week(week_of(MONDAY))
        self.assertTrue(position.voided)
        self.assertAlmostEqual(
            book.market.users["u0"].cash, cash_after_fee + position.fee_paid
        )


class PriceShortTest(unittest.TestCase):
    def test_open_reserves_collateral_and_applies_sell_impact(self) -> None:
        book = make_book()
        price_before = book.market.players["star"].current_price
        position = book.open_price_short("u0", "star")
        self.assertLess(book.market.players["star"].current_price, price_before)
        self.assertAlmostEqual(position.open_price, price_before)
        self.assertAlmostEqual(
            book.reserved["u0"], PRICE_SHORT_COLLATERAL_PCT * price_before
        )

    def test_close_pays_price_decline(self) -> None:
        book = make_book()
        position = book.open_price_short("u0", "star")
        book.market.players["star"].current_price = position.open_price * 0.8
        cash_before = book.market.users["u0"].cash
        closed = book.close_price_short("u0")
        self.assertAlmostEqual(closed.pnl, position.open_price * 0.2, delta=1.0)
        self.assertGreater(book.market.users["u0"].cash, cash_before)
        self.assertEqual(book.reserved["u0"], 0.0)

    def test_gap_past_stop_still_caps_loss_at_collateral(self) -> None:
        book = make_book()
        position = book.open_price_short("u0", "star")
        book.market.players["star"].current_price = position.open_price * 1.6
        closed = book.close_price_short("u0", reason="stop-out")
        self.assertAlmostEqual(
            closed.settle_price, PRICE_SHORT_STOP_OUT * position.open_price
        )
        self.assertAlmostEqual(
            closed.pnl, -PRICE_SHORT_COLLATERAL_PCT * position.open_price, delta=1.0
        )

    def test_daily_pass_stops_out_and_pauses_decay(self) -> None:
        book = make_book()
        position = book.open_price_short("u0", "star")
        book.market.day = 40
        book.market.players["star"].current_price = position.open_price * 1.35
        book.daily_pass()
        self.assertNotIn("u0", book.price_shorts)
        self.assertEqual(book.closed_price_shorts[-1].close_reason, "stop-out")
        self.assertEqual(book.market.players["star"].last_trade_day, 40)

    def test_borrow_insolvency_force_closes(self) -> None:
        book = make_book()
        book.open_price_short("u0", "star")
        user = book.market.users["u0"]
        user.cash = book.reserved["u0"] + 1.0
        book.daily_pass()
        self.assertNotIn("u0", book.price_shorts)
        self.assertEqual(book.closed_price_shorts[-1].close_reason, "insolvency")
        self.assertGreaterEqual(user.cash, 0.0)

    def test_one_slot_and_league_cap(self) -> None:
        book = make_book()
        book.open_price_short("u0", "star")
        with self.assertRaises(InstrumentError):
            book.open_price_short("u0", "mid")
        book2 = make_book(users=12, price=10_000_000.0)
        for index in range(10):
            book2.open_price_short(f"u{index}", "star")
        with self.assertRaises(InstrumentError):
            book2.open_price_short("u10", "star")


class BoostTest(unittest.TestCase):
    def make_owned(self) -> InstrumentsBook:
        book = make_book()
        book.market.execute_trade("u0", "star", TradeSide.BUY, 1)
        return book

    def test_boost_requires_ownership(self) -> None:
        book = make_book()
        with self.assertRaises(InstrumentError):
            book.arm_boost("u0", "star", MONDAY)

    def test_boost_doubles_dividend(self) -> None:
        book = self.make_owned()
        book.arm_boost("u0", "star", MONDAY)
        cash_before = book.market.users["u0"].cash
        book.record_game(
            "star", MONDAY, surprise_np=8.0, dividend_per_share=320_000.0,
            actual_minutes=34.0, projected_minutes=34.0,
        )
        self.assertAlmostEqual(
            book.market.users["u0"].cash - cash_before, 320_000.0
        )

    def test_two_slots_per_week_and_void_returns_slot(self) -> None:
        book = self.make_owned()
        book.market.execute_trade("u0", "mid", TradeSide.BUY, 1)
        book.market.execute_trade("u0", "bench", TradeSide.BUY, 1)
        book.arm_boost("u0", "star", MONDAY)
        book.arm_boost("u0", "mid", MONDAY)
        with self.assertRaises(InstrumentError):
            book.arm_boost("u0", "bench", TUESDAY)
        book.expire_boosts(MONDAY)
        book.arm_boost("u0", "bench", TUESDAY)

    def test_void_refunds_fee(self) -> None:
        book = self.make_owned()
        boost = book.arm_boost("u0", "star", MONDAY)
        cash_after_fee = book.market.users["u0"].cash
        book.record_game(
            "star", MONDAY, surprise_np=10.0, dividend_per_share=400_000.0,
            actual_minutes=3.0, projected_minutes=34.0,
        )
        book.expire_boosts(MONDAY)
        self.assertTrue(boost.refunded)
        self.assertAlmostEqual(
            book.market.users["u0"].cash, cash_after_fee + boost.fee_paid
        )

    def test_boost_fee_is_percent_of_price(self) -> None:
        book = self.make_owned()
        cash_before = book.market.users["u0"].cash
        book.arm_boost("u0", "star", MONDAY)
        expected = BOOST_FEE_PCT * book.market.players["star"].current_price
        self.assertAlmostEqual(cash_before - book.market.users["u0"].cash, expected)

    def test_short_boost_exclusivity(self) -> None:
        book = self.make_owned()
        book.arm_boost("u0", "star", MONDAY)
        with self.assertRaises(InstrumentError):
            book.arm_weekly_short("u0", "star", TUESDAY)
        book2 = make_book()
        book2.arm_weekly_short("u0", "mid", MONDAY)
        book2.market.execute_trade("u0", "mid", TradeSide.BUY, 1)
        with self.assertRaises(InstrumentError):
            book2.arm_boost("u0", "mid", TUESDAY)


class NetLiquidationTest(unittest.TestCase):
    def test_marks_open_short_with_bust_cap(self) -> None:
        book = make_book()
        base = book.market.portfolio_value("u0")
        position = book.open_price_short("u0", "star")
        book.market.players["star"].current_price = position.open_price * 2.0
        value = book.net_liquidation("u0")
        self.assertAlmostEqual(
            base - value,
            PRICE_SHORT_COLLATERAL_PCT * position.open_price
            + SHORT_FEE_PCT * position.open_price,
            delta=position.open_price * 0.01,
        )


if __name__ == "__main__":
    unittest.main()
