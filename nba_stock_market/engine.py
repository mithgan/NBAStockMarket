from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date
from enum import IntEnum
from typing import Protocol, Union, runtime_checkable


STARTING_CASH = 207_824_000.0
# NBA-17 fee calibration: 0.25% base plus a repeat-flip surcharge that
# increases by 0.5 percentage points and stops at 1.5%.
FEE_PCT = 0.0025
FLIP_SURCHARGE_PCT = 0.005
FLIP_SURCHARGE_CAP_PCT = 0.015
SHARES_OUT = 100
MAX_SHARES_PER_USER_PER_PLAYER = 1
# Calibrated by the NBA-9 deterministic trader sweep. This remains a
# prototype setting until real order-flow distributions are available.
IMPACT_K = 0.003
REVERSION_RATE = 0.0
IDLE_CASH_FEE = 0.0002
MIN_PRICE_FLOOR = 350_000.0
GRACE_DAYS = 7
INACTIVITY_DECAY_RATE = 0.005

# Selected by the 2025-26 deterministic economy replay on 2026-08-15. This is
# the lowest candidate satisfying the four product calibration constraints.
DOLLARS_PER_NET_POINT = 80_000.0
NET_POINTS_TO_DOLLARS = DOLLARS_PER_NET_POINT * SHARES_OUT
# The deterministic D&T replay's league-mean actual-minus-expected surprise.
# Adding it to expectations removes the systematic projection faucet.
EXPECTATION_BIAS_NET_POINTS = 0.43586494964917194

DIVIDEND_OFFSET = 2.15
DIVIDEND_SCALE = 0.0005102

AWARD_DIVIDENDS = {
    "mvp": 15.0,
    "all_nba_1": 10.0,
    "dpoy": 10.0,
    "all_nba_2": 7.0,
    "mvp_2": 7.0,
    "mip": 6.0,
    "roy": 6.0,
    "all_nba_3": 5.0,
    "all_star": 5.0,
    "all_defense_1": 5.0,
    "dpoy_2": 5.0,
    "mvp_3": 5.0,
    "all_rookie_1": 4.0,
    "all_defense_2": 3.0,
    "dpoy_3": 3.0,
    "mip_2": 3.0,
    "roy_2": 3.0,
    "mvp_4": 3.0,
    "mvp_5": 3.0,
    "all_rookie_2": 2.0,
    "mip_3": 2.0,
    "player_of_month": 2.0,
    "roy_3": 2.0,
    "player_of_week": 1.0,
}


class TradeError(ValueError):
    """Raised when a trade violates market rules."""


class TradeSide(IntEnum):
    SELL = -1
    BUY = 1


@dataclass(frozen=True)
class BoxScoreLine:
    """Immutable inputs needed by the default net-points model."""

    pts: float
    offensive_rebounds: float
    defensive_rebounds: float
    ast: float
    stl: float
    blk: float
    tov: float
    fga: float
    fgm: float
    three_pa: float
    three_pm: float
    fta: float
    ftm: float
    minutes: float

    def __post_init__(self) -> None:
        for name, value in self.__dict__.items():
            if isinstance(value, bool):
                raise ValueError(f"box score {name} must be finite")
            try:
                normalized = float(value)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"box score {name} must be finite") from exc
            if not math.isfinite(normalized):
                raise ValueError(f"box score {name} must be finite")
            object.__setattr__(self, name, normalized)


@dataclass(frozen=True)
class NetPointsCoefficients:
    """Public, swappable linear weights for :class:`NetPointsModel`.

    The defaults are a deliberately simple BPM-style v1 approximation.  The
    made/missed-shot terms are represented linearly (for example, +0.7 FGM
    and -0.7 FGA), which keeps every coefficient explicit and calibratable.
    """

    pts: float = 1.0
    offensive_rebounds: float = 0.7
    defensive_rebounds: float = 0.3
    ast: float = 0.7
    stl: float = 1.5
    blk: float = 1.0
    tov: float = -1.0
    fga: float = -0.7
    fgm: float = 0.7
    three_pa: float = -0.05
    three_pm: float = 0.10
    fta: float = -0.4
    ftm: float = 0.4
    minutes: float = -0.15

    def __post_init__(self) -> None:
        for name, value in self.__dict__.items():
            if isinstance(value, bool):
                raise ValueError(f"net-points coefficient {name} must be finite")
            try:
                normalized = float(value)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"net-points coefficient {name} must be finite") from exc
            if not math.isfinite(normalized):
                raise ValueError(f"net-points coefficient {name} must be finite")
            object.__setattr__(self, name, normalized)


class NetPointsModel:
    """Convert a box score into one transparent linear performance score."""

    def __init__(self, coefficients: NetPointsCoefficients | None = None) -> None:
        self.coefficients = coefficients or NetPointsCoefficients()

    def score(self, line: BoxScoreLine) -> float:
        if not isinstance(line, BoxScoreLine):
            raise TypeError("net-points scoring requires a BoxScoreLine")
        result = sum(
            getattr(line, name) * getattr(self.coefficients, name)
            for name in line.__dataclass_fields__
        )
        if not math.isfinite(result):
            raise ValueError("net-points score must be finite")
        return result


ExpectedPerformance = Union[BoxScoreLine, float]


@runtime_checkable
class ExpectationSource(Protocol):
    """Provider boundary for projected box scores or projected net points."""

    def expected_performance(self, player: "Player", game_date: date) -> ExpectedPerformance:
        ...


@dataclass
class Player:
    id: str
    name: str
    tier: str
    current_price: float
    fair_value: float
    opening_price: float | None = None
    actual_salary: float | None = field(default=None, kw_only=True)
    shares_outstanding: int = SHARES_OUT
    volume_30d: float = 0.0
    listed_day: int = 0
    last_trade_day: int = 0
    price_history: list[float] = field(default_factory=list)
    fair_value_history: list[float] = field(default_factory=list)

    def __post_init__(self) -> None:
        if self.opening_price is None:
            self.opening_price = self.current_price
        self._assert_valid()
        self.price_history.append(self.current_price)
        self.fair_value_history.append(self.fair_value)

    @property
    def floor(self) -> float:
        # Engine v2's floor is an economy safeguard, not a fair-value signal.
        # Tying it to fair value would reintroduce the reversion behavior that
        # daily performance dividends replaced.
        return MIN_PRICE_FLOOR

    def mark_day(self) -> None:
        self._assert_valid()
        self.price_history.append(self.current_price)
        self.fair_value_history.append(self.fair_value)

    def _assert_valid(self) -> None:
        values = [self.current_price, self.fair_value, self.shares_outstanding, self.volume_30d]
        if not all(math.isfinite(float(value)) for value in values):
            raise ValueError(f"{self.name} has non-finite market values")
        if self.current_price <= 0:
            raise ValueError(f"{self.name} price must be positive")
        if self.fair_value <= 0:
            raise ValueError(f"{self.name} fair value must be positive")
        if self.shares_outstanding <= 0:
            raise ValueError(f"{self.name} shares outstanding must be positive")


@dataclass
class User:
    id: str
    cash: float = STARTING_CASH
    holdings: dict[str, int] = field(default_factory=dict)
    last_side_by_player: dict[str, TradeSide] = field(default_factory=dict)
    last_trade_day_by_player: dict[str, int] = field(default_factory=dict)
    roundtrip_days_by_player: dict[str, list[int]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if isinstance(self.cash, bool) or not math.isfinite(float(self.cash)):
            raise ValueError("user cash must be finite")
        self.cash = float(self.cash)
        for player_id, shares in self.holdings.items():
            if type(shares) is not int or shares < 0:
                raise ValueError(f"holding for {player_id} must be a non-negative integer")

    def shares(self, player_id: str) -> int:
        return self.holdings.get(player_id, 0)


@dataclass(frozen=True)
class Position:
    user_id: str
    player_id: str
    side: TradeSide
    quantity: int
    execution_price: float
    fee: float
    new_price: float


@dataclass(frozen=True)
class DividendEvent:
    """Immutable record of one daily performance payout."""

    player_id: str
    game_date: date | None
    actual_net_points: float
    expected_net_points: float
    dividend_per_share: float
    total_cash_change: float


class Market:
    def __init__(
        self,
        players: list[Player],
        users: list[User] | None = None,
        *,
        impact_k: float = IMPACT_K,
        reversion_rate: float = REVERSION_RATE,
        fee_pct: float = FEE_PCT,
        max_shares_per_user_per_player: int = MAX_SHARES_PER_USER_PER_PLAYER,
        idle_cash_fee: float = IDLE_CASH_FEE,
        grace_days: int = GRACE_DAYS,
        inactivity_decay_rate: float = INACTIVITY_DECAY_RATE,
        net_points_model: NetPointsModel | None = None,
        expectation_source: ExpectationSource | None = None,
        net_points_to_dollars: float = NET_POINTS_TO_DOLLARS,
        expectation_bias: float = EXPECTATION_BIAS_NET_POINTS,
    ) -> None:
        if not players:
            raise ValueError("market requires at least one player")
        if len({player.id for player in players}) != len(players):
            raise ValueError("player ids must be unique")
        self.players = {player.id: player for player in players}
        self.users = {user.id: user for user in users or []}
        self.day = 0
        self.impact_k = self._finite_value("impact_k", impact_k)
        self.reversion_rate = self._rate("reversion_rate", reversion_rate)
        self.fee_pct = self._rate("fee_pct", fee_pct)
        if (
            type(max_shares_per_user_per_player) is not int
            or max_shares_per_user_per_player <= 0
        ):
            raise ValueError("max_shares_per_user_per_player must be a positive integer")
        self.max_shares_per_user_per_player = max_shares_per_user_per_player
        aggregate_holdings = {player_id: 0 for player_id in self.players}
        for user in self.users.values():
            for player_id, shares in user.holdings.items():
                if player_id not in self.players:
                    raise ValueError(
                        f"holding for unknown player {player_id}: user {user.id}"
                    )
                if shares > self.max_shares_per_user_per_player:
                    raise ValueError(
                        f"holding for {player_id} exceeds per-user holding cap of "
                        f"{self.max_shares_per_user_per_player}"
                    )
                aggregate_holdings[player_id] += shares
        for player_id, held_shares in aggregate_holdings.items():
            shares_outstanding = self.players[player_id].shares_outstanding
            if held_shares > shares_outstanding:
                raise ValueError(
                    f"aggregate holding for {player_id} exceeds "
                    f"{shares_outstanding} shares outstanding"
                )
        self.idle_cash_fee = self._rate("idle_cash_fee", idle_cash_fee)
        self.inactivity_decay_rate = self._rate("inactivity_decay_rate", inactivity_decay_rate)
        if type(grace_days) is not int or grace_days < 0:
            raise ValueError("grace_days must be a non-negative integer")
        self.grace_days = grace_days
        self.net_points_model = net_points_model or NetPointsModel()
        self.expectation_source = expectation_source
        self.net_points_to_dollars = self._finite_value(
            "net_points_to_dollars", net_points_to_dollars
        )
        if self.net_points_to_dollars < 0:
            raise ValueError("net_points_to_dollars must be non-negative")
        self.expectation_bias = self._finite_value(
            "expectation_bias", expectation_bias
        )
        self.trade_log: list[Position] = []
        self.dividend_events: list[DividendEvent] = []
        # Compatibility-friendly name for consumers that treat this as a log.
        self.dividend_log = self.dividend_events
        self._settled_dividends: dict[tuple[str, str], DividendEvent] = {}

    def ensure_user(self, user_id: str) -> User:
        user = self.users.get(user_id)
        if user is None:
            user = User(user_id)
            self.users[user_id] = user
        return user

    def liquidity(self, player_id: str) -> float:
        player = self.players[player_id]
        return 1.0 + 0.05 * player.volume_30d + 0.10 * self.ownership_pct(player_id)

    def ownership_pct(self, player_id: str) -> float:
        player = self.players[player_id]
        held = self.total_held_shares(player_id)
        return min(100.0, 100.0 * held / player.shares_outstanding)

    def total_held_shares(self, player_id: str) -> int:
        return sum(max(0, user.shares(player_id)) for user in self.users.values())

    def execute_trade(self, user_id: str, player_id: str, side: TradeSide | int, quantity: int) -> Position:
        try:
            normalized_side = TradeSide(side)
        except ValueError as exc:
            raise TradeError(f"invalid trade side: {side}") from exc
        if type(quantity) is not int or quantity <= 0:
            raise TradeError("quantity must be a positive integer")
        if player_id not in self.players:
            raise TradeError(f"unknown player: {player_id}")
        user = self.ensure_user(user_id)
        player = self.players[player_id]
        price = player.current_price
        notional = quantity * price
        fee = notional * self.fee_pct
        depth = self.liquidity(player_id)
        is_roundtrip = self._is_fast_roundtrip(user, player_id, normalized_side)
        if is_roundtrip:
            recent_roundtrips = self._roundtrips_last_7d(user, player_id)
            surcharge_rate = min(
                FLIP_SURCHARGE_PCT * (1 + recent_roundtrips),
                FLIP_SURCHARGE_CAP_PCT,
            )
            fee += notional * surcharge_rate

        if normalized_side is TradeSide.BUY:
            if (
                user.shares(player_id) + quantity
                > self.max_shares_per_user_per_player
            ):
                raise TradeError(
                    "per-user holding cap exceeded: "
                    f"maximum {self.max_shares_per_user_per_player} share(s) per player"
                )
            if self.total_held_shares(player_id) + quantity > player.shares_outstanding:
                raise TradeError("not enough remaining float")
            if user.cash < notional + fee:
                raise TradeError("insufficient cash")
        else:
            if user.shares(player_id) < quantity:
                raise TradeError("not enough shares")

        try:
            impacted_price = price * math.exp(
                self.impact_k * int(normalized_side) * quantity / depth
            )
        except OverflowError as exc:
            raise TradeError("price impact overflow") from exc
        new_price = max(impacted_price, player.floor)
        if not math.isfinite(new_price):
            raise TradeError("price impact produced a non-finite price")

        if normalized_side is TradeSide.BUY:
            user.cash -= notional + fee
            user.holdings[player_id] = user.shares(player_id) + quantity
        else:
            user.cash += notional - fee
            user.holdings[player_id] = user.shares(player_id) - quantity

        player.current_price = new_price
        player.last_trade_day = self.day
        player.volume_30d += quantity
        player._assert_valid()

        if is_roundtrip:
            user.roundtrip_days_by_player.setdefault(player_id, []).append(self.day)
        user.last_side_by_player[player_id] = normalized_side
        user.last_trade_day_by_player[player_id] = self.day

        position = Position(user_id, player_id, normalized_side, quantity, price, fee, player.current_price)
        self.trade_log.append(position)
        return position

    def daily_fair_value_pass(self) -> None:
        for player in self.players.values():
            if self.day - player.listed_day <= self.grace_days:
                continue
            player.current_price += self.reversion_rate * (player.fair_value - player.current_price)
            player.current_price = max(player.current_price, player.floor)
            player._assert_valid()

    def daily_inactivity_decay_pass(self) -> None:
        """Apply the 0.5% default decay only after a player's trade grace."""

        for player in self.players.values():
            if self.day - player.last_trade_day <= self.grace_days:
                continue
            player.current_price *= 1 - self.inactivity_decay_rate
            player.current_price = max(player.current_price, player.floor)
            player._assert_valid()

    def daily_idle_cash_sink(self) -> None:
        for user in self.users.values():
            if user.cash > 0:
                user.cash *= 1 - self.idle_cash_fee

    def advance_day(self, *, apply_reversion: bool = True, apply_idle_fee: bool = True) -> None:
        self.day += 1
        if apply_reversion:
            self.daily_fair_value_pass()
        self.daily_inactivity_decay_pass()
        if apply_idle_fee:
            self.daily_idle_cash_sink()
        for player in self.players.values():
            player.volume_30d *= 29.0 / 30.0
            player.mark_day()
        for user in self.users.values():
            for player_id in list(user.roundtrip_days_by_player):
                self._roundtrips_last_7d(user, player_id)

    def portfolio_value(self, user_id: str) -> float:
        user = self.ensure_user(user_id)
        holdings_value = sum(self.players[player_id].current_price * shares for player_id, shares in user.holdings.items())
        return user.cash + holdings_value

    def pay_daily_performance_dividend(
        self,
        player_id: str,
        *,
        actual_net_points: float,
        expected_net_points: float,
        game_date: date | None = None,
        settlement_key: str | None = None,
    ) -> DividendEvent:
        """Pay holders for actual performance relative to expectation.

        Negative surprises intentionally debit holder cash.  Prices are not
        touched: daily performance enters the economy only through this cash
        event, leaving prices to supply/demand (plus optional experiments).

        A settlement key is scoped to the player. Reusing it returns the
        original event object without changing cash or appending another event.
        """

        self._player_or_error(player_id)
        scoped_key = (
            (player_id, settlement_key) if settlement_key is not None else None
        )
        if scoped_key is not None and scoped_key in self._settled_dividends:
            return self._settled_dividends[scoped_key]
        actual = self._finite_value("actual_net_points", actual_net_points, TradeError)
        expected = self._finite_value("expected_net_points", expected_net_points, TradeError)
        expected += self.expectation_bias
        if not math.isfinite(expected):
            raise TradeError("biased expected_net_points must be finite")
        dividend_per_share = (
            (actual - expected) * self.net_points_to_dollars / SHARES_OUT
        )
        if not math.isfinite(dividend_per_share):
            raise TradeError("dividend_per_share must be finite")

        payouts: list[tuple[User, float]] = []
        for user in self.users.values():
            cash_change = max(0, user.shares(player_id)) * dividend_per_share
            if not math.isfinite(cash_change) or not math.isfinite(user.cash + cash_change):
                raise TradeError("dividend cash change must be finite")
            payouts.append((user, cash_change))
        total_cash_change = sum(cash_change for _, cash_change in payouts)
        if not math.isfinite(total_cash_change):
            raise TradeError("total dividend cash change must be finite")
        for user, cash_change in payouts:
            user.cash += cash_change

        event = DividendEvent(
            player_id=player_id,
            game_date=game_date,
            actual_net_points=actual,
            expected_net_points=expected,
            dividend_per_share=dividend_per_share,
            total_cash_change=total_cash_change,
        )
        self.dividend_events.append(event)
        if scoped_key is not None:
            self._settled_dividends[scoped_key] = event
        return event

    def apply_game_result(
        self,
        player_id: str,
        *,
        actual: ExpectedPerformance,
        expected: ExpectedPerformance | None = None,
        game_date: date | None = None,
        settlement_key: str | None = None,
    ) -> DividendEvent:
        """Resolve inputs and apply an optionally idempotent daily dividend."""

        player = self._player_or_error(player_id)
        scoped_key = (
            (player_id, settlement_key) if settlement_key is not None else None
        )
        if scoped_key is not None and scoped_key in self._settled_dividends:
            return self._settled_dividends[scoped_key]
        if expected is None:
            if self.expectation_source is None:
                raise TradeError("expected performance or expectation source is required")
            if game_date is None:
                raise TradeError("game_date is required when using an expectation source")
            expected = self.expectation_source.expected_performance(player, game_date)

        actual_net_points = self._resolve_net_points("actual", actual)
        expected_net_points = self._resolve_net_points("expected", expected)
        return self.pay_daily_performance_dividend(
            player_id,
            actual_net_points=actual_net_points,
            expected_net_points=expected_net_points,
            game_date=game_date,
            settlement_key=settlement_key,
        )

    def season_dividend_per_share(self, *, warp: float, minutes: float) -> float:
        return (warp + DIVIDEND_OFFSET) * minutes * DIVIDEND_SCALE

    def award_dividend_per_share(self, award: str) -> float:
        try:
            return AWARD_DIVIDENDS[award]
        except KeyError as exc:
            raise TradeError(f"unknown award dividend: {award}") from exc

    def snapshot(self) -> dict[str, dict[str, float | str]]:
        return {
            player.id: {
                "name": player.name,
                "tier": player.tier,
                "price": round(player.current_price, 2),
                "fair_value": round(player.fair_value, 2),
                "gap": round(player.fair_value - player.current_price, 2),
                "volume_30d": round(player.volume_30d, 2),
                "ownership_pct": round(self.ownership_pct(player.id), 2),
            }
            for player in self.players.values()
        }

    def _is_fast_roundtrip(self, user: User, player_id: str, side: TradeSide) -> bool:
        last_side = user.last_side_by_player.get(player_id)
        last_day = user.last_trade_day_by_player.get(player_id)
        return last_side is not None and last_side != side and last_day is not None and self.day - last_day <= 1

    def _roundtrips_last_7d(self, user: User, player_id: str) -> int:
        recent = [day for day in user.roundtrip_days_by_player.get(player_id, []) if self.day - day <= 7]
        if recent:
            user.roundtrip_days_by_player[player_id] = recent
        else:
            user.roundtrip_days_by_player.pop(player_id, None)
        return len(recent)

    def _player_or_error(self, player_id: str) -> Player:
        try:
            return self.players[player_id]
        except KeyError as exc:
            raise TradeError(f"unknown player: {player_id}") from exc

    def _resolve_net_points(self, label: str, performance: ExpectedPerformance) -> float:
        if isinstance(performance, BoxScoreLine):
            return self.net_points_model.score(performance)
        return self._finite_value(f"{label} net points", performance, TradeError)

    @staticmethod
    def _finite_value(
        name: str,
        value: float,
        error_type: type[ValueError] = ValueError,
    ) -> float:
        if isinstance(value, bool):
            raise error_type(f"{name} must be finite")
        try:
            normalized = float(value)
        except (TypeError, ValueError) as exc:
            raise error_type(f"{name} must be finite") from exc
        if not math.isfinite(normalized):
            raise error_type(f"{name} must be finite")
        return normalized

    @classmethod
    def _rate(cls, name: str, value: float) -> float:
        rate = cls._finite_value(name, value)
        if not 0 <= rate <= 1:
            raise ValueError(f"{name} must be between 0 and 1")
        return rate
