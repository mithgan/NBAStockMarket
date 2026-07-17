"""Production shorting/boost instruments per docs/shorting-spec.md v1.0.

The :class:`InstrumentsBook` wraps a :class:`~nba_stock_market.engine.Market`
and manages the three instruments on top of the roster economy:

- 3 weekly performance shorts (Mon-Sun dividend mirrors)
- 1 season price short (collateralised, gap-capped stop-out)
- 2 weekly boost slots (one-game 2x dividend on an owned player)

Collateral is tracked as *reservations* against user cash: the cash never
moves, but ``free_cash`` excludes reserved amounts and every spend routed
through the book checks it.  Game settlement is driven by the caller (the
daily replay / game ingest) via :meth:`record_game`, :meth:`expire_boosts`,
:meth:`settle_week`, and :meth:`daily_pass`.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path  # noqa: F401  (kept for parity with sibling modules)

from nba_stock_market.engine import Market, TradeError


WEEKLY_SHORT_SLOTS = 3
WEEKLY_GAME_CLAMP_NP = 25.0
WEEKLY_TOTAL_CLAMP_NP = 50.0
WEEKLY_SHORT_COLLATERAL = 2_000_000.0
SHORT_FEE_PCT = 0.0025
SHORT_MIN_FEE = 10_000.0
DNP_MINUTES_THRESHOLD = 0.40
DOLLARS_PER_NET_POINT = 40_000.0

PRICE_SHORT_COLLATERAL_PCT = 0.30
PRICE_SHORT_STOP_OUT = 1.30
PRICE_SHORT_BORROW_DAILY = 0.0005
BORROW_BUFFER_DAYS = 14

BOOST_SLOTS = 2
BOOST_MULTIPLIER = 2.0
BOOST_FEE_PCT = 0.0025

MAX_WEEKLY_SHORTS_PER_PLAYER = 25
MAX_PRICE_SHORTS_PER_PLAYER = 10


class InstrumentError(ValueError):
    """Raised when an instrument action violates the spec."""


def week_of(game_date: date) -> str:
    iso = game_date.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


@dataclass
class WeeklyShort:
    user_id: str
    player_id: str
    week: str
    fee_paid: float
    accrued_np: float = 0.0
    qualifying_games: int = 0
    settled: bool = False
    pnl: float | None = None
    voided: bool = False


@dataclass
class PriceShort:
    user_id: str
    player_id: str
    open_price: float
    open_day: int
    closed: bool = False
    close_reason: str = ""
    settle_price: float = 0.0
    pnl: float = 0.0


@dataclass
class Boost:
    user_id: str
    player_id: str
    week: str
    game_date: date
    fee_paid: float
    consumed: bool = False
    refunded: bool = False
    payout: float = 0.0


@dataclass
class InstrumentsBook:
    market: Market
    weekly_shorts: list[WeeklyShort] = field(default_factory=list)
    price_shorts: dict[str, PriceShort] = field(default_factory=dict)
    closed_price_shorts: list[PriceShort] = field(default_factory=list)
    boosts: list[Boost] = field(default_factory=list)
    reserved: dict[str, float] = field(default_factory=dict)

    # ------------------------------------------------------------------ util

    def free_cash(self, user_id: str) -> float:
        user = self.market.ensure_user(user_id)
        return user.cash - self.reserved.get(user_id, 0.0)

    def _reserve(self, user_id: str, amount: float) -> None:
        self.reserved[user_id] = self.reserved.get(user_id, 0.0) + amount

    def _release(self, user_id: str, amount: float) -> None:
        remaining = self.reserved.get(user_id, 0.0) - amount
        if remaining < -1e-6:
            raise InstrumentError("collateral release exceeds reservation")
        self.reserved[user_id] = max(0.0, remaining)

    def _player_or_error(self, player_id: str):
        try:
            return self.market.players[player_id]
        except KeyError as exc:
            raise InstrumentError(f"unknown player: {player_id}") from exc

    def _apply_price_impact(self, player_id: str, side: int) -> None:
        player = self.market.players[player_id]
        depth = self.market.liquidity(player_id)
        player.current_price *= math.exp(self.market.impact_k * side / depth)
        player.current_price = max(player.current_price, player.floor)

    @staticmethod
    def _short_fee(price: float) -> float:
        return max(SHORT_MIN_FEE, SHORT_FEE_PCT * price)

    # -------------------------------------------------------- weekly shorts

    def active_weekly_shorts(
        self, *, user_id: str | None = None, player_id: str | None = None, week: str | None = None
    ) -> list[WeeklyShort]:
        return [
            position
            for position in self.weekly_shorts
            if not position.settled
            and (user_id is None or position.user_id == user_id)
            and (player_id is None or position.player_id == player_id)
            and (week is None or position.week == week)
        ]

    def arm_weekly_short(self, user_id: str, player_id: str, game_date: date) -> WeeklyShort:
        player = self._player_or_error(player_id)
        user = self.market.ensure_user(user_id)
        week = week_of(game_date)
        if user.shares(player_id) > 0:
            raise InstrumentError("cannot short a player you hold")
        if any(
            boost
            for boost in self.boosts
            if boost.user_id == user_id
            and boost.player_id == player_id
            and boost.week == week
            and not boost.refunded
        ):
            raise InstrumentError("cannot short a player you boosted this week")
        if self.active_weekly_shorts(user_id=user_id, player_id=player_id):
            raise InstrumentError("already shorting this player")
        if len(self.active_weekly_shorts(user_id=user_id, week=week)) >= WEEKLY_SHORT_SLOTS:
            raise InstrumentError("all weekly short slots are armed")
        if len(self.active_weekly_shorts(player_id=player_id)) >= MAX_WEEKLY_SHORTS_PER_PLAYER:
            raise InstrumentError("league-wide short cap reached for this player")
        fee = self._short_fee(player.current_price)
        if self.free_cash(user_id) < fee + WEEKLY_SHORT_COLLATERAL:
            raise InstrumentError("insufficient free cash for fee plus collateral")
        user.cash -= fee
        self._reserve(user_id, WEEKLY_SHORT_COLLATERAL)
        position = WeeklyShort(user_id, player_id, week, fee)
        self.weekly_shorts.append(position)
        return position

    def settle_week(self, week: str) -> list[WeeklyShort]:
        settled = []
        for position in self.active_weekly_shorts(week=week):
            user = self.market.ensure_user(position.user_id)
            self._release(position.user_id, WEEKLY_SHORT_COLLATERAL)
            if position.qualifying_games == 0:
                user.cash += position.fee_paid
                position.voided = True
                position.pnl = 0.0
            else:
                total = max(-WEEKLY_TOTAL_CLAMP_NP, min(WEEKLY_TOTAL_CLAMP_NP, position.accrued_np))
                position.pnl = -total * DOLLARS_PER_NET_POINT
                user.cash += position.pnl
            position.settled = True
            settled.append(position)
        return settled

    # ---------------------------------------------------------- price short

    def open_price_short(self, user_id: str, player_id: str) -> PriceShort:
        player = self._player_or_error(player_id)
        user = self.market.ensure_user(user_id)
        if user_id in self.price_shorts:
            raise InstrumentError("price short slot already in use")
        if user.shares(player_id) > 0:
            raise InstrumentError("cannot price-short a player you hold")
        open_on_player = sum(
            1 for position in self.price_shorts.values() if position.player_id == player_id
        )
        if open_on_player >= MAX_PRICE_SHORTS_PER_PLAYER:
            raise InstrumentError("league-wide price-short cap reached for this player")
        entry_price = player.current_price
        fee = SHORT_FEE_PCT * entry_price
        collateral = PRICE_SHORT_COLLATERAL_PCT * entry_price
        borrow_buffer = BORROW_BUFFER_DAYS * PRICE_SHORT_BORROW_DAILY * entry_price
        if self.free_cash(user_id) < fee + collateral + borrow_buffer:
            raise InstrumentError("insufficient free cash for fee, collateral, and borrow buffer")
        user.cash -= fee
        self._reserve(user_id, collateral)
        self._apply_price_impact(player_id, side=-1)
        position = PriceShort(user_id, player_id, entry_price, self.market.day)
        self.price_shorts[user_id] = position
        return position

    def close_price_short(self, user_id: str, *, reason: str = "manual") -> PriceShort:
        if user_id not in self.price_shorts:
            raise InstrumentError("no open price short")
        position = self.price_shorts.pop(user_id)
        player = self.market.players[position.player_id]
        user = self.market.ensure_user(user_id)
        close_price = player.current_price
        self._apply_price_impact(position.player_id, side=+1)
        bust_price = PRICE_SHORT_STOP_OUT * position.open_price
        position.settle_price = min(close_price, bust_price)
        position.pnl = position.open_price - position.settle_price
        self._release(user_id, PRICE_SHORT_COLLATERAL_PCT * position.open_price)
        loss_applied = position.pnl if position.pnl >= 0 else max(position.pnl, -max(0.0, user.cash))
        user.cash += loss_applied
        position.closed = True
        position.close_reason = reason
        self.closed_price_shorts.append(position)
        return position

    def daily_pass(self) -> None:
        """Run once per day: borrow fees, insolvency, stop-outs, decay pause."""

        for user_id, position in list(self.price_shorts.items()):
            player = self.market.players[position.player_id]
            player.last_trade_day = self.market.day
            user = self.market.ensure_user(user_id)
            borrow = PRICE_SHORT_BORROW_DAILY * position.open_price
            if self.free_cash(user_id) < borrow:
                self.close_price_short(user_id, reason="insolvency")
                user.cash -= min(borrow, max(0.0, user.cash))
                continue
            user.cash -= borrow
            if player.current_price >= PRICE_SHORT_STOP_OUT * position.open_price:
                self.close_price_short(user_id, reason="stop-out")

    def check_stop_outs(self) -> None:
        """Call after any trade tick to minimise gap risk."""

        for user_id, position in list(self.price_shorts.items()):
            player = self.market.players[position.player_id]
            if player.current_price >= PRICE_SHORT_STOP_OUT * position.open_price:
                self.close_price_short(user_id, reason="stop-out")

    # --------------------------------------------------------------- boosts

    def _boosts_used(self, user_id: str, week: str) -> int:
        return sum(
            1
            for boost in self.boosts
            if boost.user_id == user_id and boost.week == week and not boost.refunded
        )

    def arm_boost(self, user_id: str, player_id: str, game_date: date) -> Boost:
        player = self._player_or_error(player_id)
        user = self.market.ensure_user(user_id)
        week = week_of(game_date)
        if user.shares(player_id) <= 0:
            raise InstrumentError("boosts require holding the player")
        if self.active_weekly_shorts(user_id=user_id, player_id=player_id, week=week):
            raise InstrumentError("cannot boost a player you shorted this week")
        if any(
            boost
            for boost in self.boosts
            if boost.user_id == user_id
            and boost.player_id == player_id
            and boost.game_date == game_date
            and not boost.refunded
        ):
            raise InstrumentError("already boosting this player for this game")
        if self._boosts_used(user_id, week) >= BOOST_SLOTS:
            raise InstrumentError("all boost slots used this week")
        fee = BOOST_FEE_PCT * player.current_price
        if self.free_cash(user_id) < fee:
            raise InstrumentError("insufficient free cash for boost fee")
        user.cash -= fee
        boost = Boost(user_id, player_id, week, game_date, fee)
        self.boosts.append(boost)
        return boost

    def expire_boosts(self, game_date: date) -> list[Boost]:
        """After all of a date's games settle: refund boosts whose game voided."""

        refunded = []
        for boost in self.boosts:
            if boost.game_date == game_date and not boost.consumed and not boost.refunded:
                self.market.ensure_user(boost.user_id).cash += boost.fee_paid
                boost.refunded = True
                refunded.append(boost)
        return refunded

    # ----------------------------------------------------------- settlement

    def record_game(
        self,
        player_id: str,
        game_date: date,
        *,
        surprise_np: float,
        dividend_per_share: float,
        actual_minutes: float,
        projected_minutes: float,
    ) -> None:
        """Feed one settled player-game into the book.

        ``surprise_np`` is the bias-corrected actual-minus-expected net points
        (uncapped); ``dividend_per_share`` is the engine's dividend for this
        game.  Non-qualifying games (DNP rule) accrue nothing and leave boosts
        to be refunded by :meth:`expire_boosts`.
        """

        self._player_or_error(player_id)
        if not (math.isfinite(surprise_np) and math.isfinite(dividend_per_share)):
            raise TradeError("instrument settlement inputs must be finite")
        qualifying = (
            projected_minutes > 0
            and actual_minutes >= DNP_MINUTES_THRESHOLD * projected_minutes
        )
        if not qualifying:
            return
        week = week_of(game_date)
        capped = max(-WEEKLY_GAME_CLAMP_NP, min(WEEKLY_GAME_CLAMP_NP, surprise_np))
        for position in self.active_weekly_shorts(player_id=player_id, week=week):
            position.accrued_np += capped
            position.qualifying_games += 1
        for boost in self.boosts:
            if (
                boost.player_id == player_id
                and boost.game_date == game_date
                and not boost.consumed
                and not boost.refunded
            ):
                extra = (BOOST_MULTIPLIER - 1.0) * dividend_per_share
                self.market.ensure_user(boost.user_id).cash += extra
                boost.payout = extra
                boost.consumed = True

    # -------------------------------------------------------------- reports

    def net_liquidation(self, user_id: str) -> float:
        """Portfolio value plus unrealized price-short P&L (reservations are
        not losses and are therefore not subtracted)."""

        value = self.market.portfolio_value(user_id)
        position = self.price_shorts.get(user_id)
        if position is not None:
            player = self.market.players[position.player_id]
            marked = min(player.current_price, PRICE_SHORT_STOP_OUT * position.open_price)
            value += position.open_price - marked
        return value
