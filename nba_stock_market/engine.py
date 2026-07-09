from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import IntEnum


STARTING_CASH = 10_000.0
FEE_PCT = 0.01
SHARES_OUT = 100
IMPACT_K = 0.0003
REVERSION_RATE = 0.03
OWNERSHIP_CAP = 0.40
IDLE_CASH_FEE = 0.0002
MIN_PRICE_FLOOR = 25.0
GRACE_DAYS = 7
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


@dataclass
class Player:
    id: str
    name: str
    tier: str
    current_price: float
    fair_value: float
    opening_price: float | None = None
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
        return max(0.5 * self.fair_value, MIN_PRICE_FLOOR)

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


class Market:
    def __init__(
        self,
        players: list[Player],
        users: list[User] | None = None,
        *,
        impact_k: float = IMPACT_K,
        reversion_rate: float = REVERSION_RATE,
        fee_pct: float = FEE_PCT,
        ownership_cap: float = OWNERSHIP_CAP,
        idle_cash_fee: float = IDLE_CASH_FEE,
        grace_days: int = GRACE_DAYS,
    ) -> None:
        if not players:
            raise ValueError("market requires at least one player")
        self.players = {player.id: player for player in players}
        self.users = {user.id: user for user in users or []}
        self.day = 0
        self.impact_k = impact_k
        self.reversion_rate = reversion_rate
        self.fee_pct = fee_pct
        self.ownership_cap = ownership_cap
        self.idle_cash_fee = idle_cash_fee
        self.grace_days = grace_days
        self.trade_log: list[Position] = []

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
            fee += notional * 0.02 * (1 + self._roundtrips_last_7d(user, player_id))

        if normalized_side is TradeSide.BUY:
            max_user_shares = int(self.ownership_cap * player.shares_outstanding)
            if user.shares(player_id) + quantity > max_user_shares:
                raise TradeError("ownership cap exceeded")
            if self.total_held_shares(player_id) + quantity > player.shares_outstanding:
                raise TradeError("not enough remaining float")
            if user.cash < notional + fee:
                raise TradeError("insufficient cash")
            user.cash -= notional + fee
            user.holdings[player_id] = user.shares(player_id) + quantity
        else:
            if user.shares(player_id) < quantity:
                raise TradeError("not enough shares")
            user.cash += notional - fee
            user.holdings[player_id] = user.shares(player_id) - quantity

        player.current_price *= math.exp(self.impact_k * int(normalized_side) * quantity / depth)
        player.current_price = max(player.current_price, player.floor)
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

    def daily_idle_cash_sink(self) -> None:
        for user in self.users.values():
            user.cash *= 1 - self.idle_cash_fee

    def advance_day(self, *, apply_reversion: bool = True, apply_idle_fee: bool = True) -> None:
        self.day += 1
        if apply_reversion:
            self.daily_fair_value_pass()
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
