"""Pure domain model for the additive per-game roster economy.

This module deliberately has no persistence, network, clock, or random dependencies.
Callers provide stable identifiers and monotonic event sequences so every outcome can
be reproduced by the simulator and, later, persisted by the API layer.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, replace
from decimal import Decimal, ROUND_HALF_UP
from enum import Enum


JAVASCRIPT_MAX_SAFE_INTEGER = 9_007_199_254_740_991
MAX_PER_GAME_QUOTE_DOLLARS = 1_000_000_000_000


class EconomyRuleError(ValueError):
    """Raised when a roster action violates an economy invariant."""


class RevisionConflictError(EconomyRuleError):
    """Raised when an existing result revision is reused with different data."""


class DividendBasis(str, Enum):
    RAW_NET_POINTS = "raw_net_points"
    SURPRISE_VS_PROJECTION = "surprise_vs_projection"


class PositionSide(str, Enum):
    LONG = "long"
    SHORT = "short"


class LedgerEntryKind(str, Enum):
    GAME_COST = "game_cost"
    GAME_DIVIDEND = "game_dividend"
    DIVIDEND_CORRECTION = "dividend_correction"
    OPEN_FEE = "open_fee"
    DROP_FEE = "drop_fee"


class SettlementStatus(str, Enum):
    SETTLED = "settled"
    UNSETTLED_MISSING_PROJECTION = "unsettled_missing_projection"


def _nonempty_id(name: str, value: object) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a non-empty string")
    return value


def _integer(
    name: str,
    value: object,
    *,
    minimum: int = 0,
    maximum: int | None = None,
) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError(f"{name} must be an integer greater than or equal to {minimum}")
    if maximum is not None and value > maximum:
        raise ValueError(f"{name} must be less than or equal to {maximum}")
    return value


def _finite_number(name: str, value: object) -> float:
    if isinstance(value, bool):
        raise ValueError(f"{name} must be finite")
    try:
        normalized = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be finite") from exc
    if not math.isfinite(normalized):
        raise ValueError(f"{name} must be finite")
    return normalized


@dataclass(frozen=True)
class EconomyPolicy:
    """Configurable simulation policy; defaults are not production decisions."""

    ruleset_id: str = "per-game-v2"
    dividend_basis: DividendBasis = DividendBasis.RAW_NET_POINTS
    dividend_dollars_per_net_point: int = 40_000
    max_long_positions: int = 10
    max_short_positions: int = 5
    allow_opposing_positions: bool = False
    open_quote_impact_bps: int = 0
    drop_quote_impact_bps: int = 0
    minimum_quote_dollars: int = 1
    open_fee_dollars: int = 0
    drop_fee_dollars: int = 0

    def __post_init__(self) -> None:
        _nonempty_id("ruleset_id", self.ruleset_id)
        if not isinstance(self.dividend_basis, DividendBasis):
            raise ValueError("dividend_basis must be a DividendBasis")
        _integer(
            "dividend_dollars_per_net_point",
            self.dividend_dollars_per_net_point,
            minimum=0,
            maximum=JAVASCRIPT_MAX_SAFE_INTEGER,
        )
        _integer(
            "max_long_positions",
            self.max_long_positions,
            minimum=0,
            maximum=JAVASCRIPT_MAX_SAFE_INTEGER,
        )
        _integer(
            "max_short_positions",
            self.max_short_positions,
            minimum=0,
            maximum=JAVASCRIPT_MAX_SAFE_INTEGER,
        )
        if not isinstance(self.allow_opposing_positions, bool):
            raise ValueError("allow_opposing_positions must be a boolean")
        _integer(
            "open_quote_impact_bps",
            self.open_quote_impact_bps,
            minimum=0,
            maximum=JAVASCRIPT_MAX_SAFE_INTEGER,
        )
        _integer(
            "drop_quote_impact_bps",
            self.drop_quote_impact_bps,
            minimum=0,
            maximum=JAVASCRIPT_MAX_SAFE_INTEGER,
        )
        _integer(
            "minimum_quote_dollars",
            self.minimum_quote_dollars,
            minimum=1,
            maximum=MAX_PER_GAME_QUOTE_DOLLARS,
        )
        _integer(
            "open_fee_dollars",
            self.open_fee_dollars,
            minimum=0,
            maximum=JAVASCRIPT_MAX_SAFE_INTEGER,
        )
        _integer(
            "drop_fee_dollars",
            self.drop_fee_dollars,
            minimum=0,
            maximum=JAVASCRIPT_MAX_SAFE_INTEGER,
        )


@dataclass(frozen=True)
class PlayerQuote:
    player_id: str
    current_per_game_cost_dollars: int
    prior_season_value_per_game_dollars: int | None = None

    def __post_init__(self) -> None:
        _nonempty_id("player_id", self.player_id)
        _integer(
            "current_per_game_cost_dollars",
            self.current_per_game_cost_dollars,
            minimum=1,
            maximum=MAX_PER_GAME_QUOTE_DOLLARS,
        )
        if self.prior_season_value_per_game_dollars is not None:
            _integer(
                "prior_season_value_per_game_dollars",
                self.prior_season_value_per_game_dollars,
                minimum=0,
                maximum=MAX_PER_GAME_QUOTE_DOLLARS,
            )


@dataclass(frozen=True)
class RosterPosition:
    position_id: str
    account_id: str
    player_id: str
    side: PositionSide
    locked_per_game_cost_dollars: int
    opened_sequence: int
    closed_sequence: int | None = None

    def is_exposed(self, game_sequence: int) -> bool:
        return self.opened_sequence <= game_sequence and (
            self.closed_sequence is None or game_sequence < self.closed_sequence
        )


@dataclass(frozen=True)
class PlayerGameResult:
    game_id: str
    player_id: str
    sequence: int
    revision: int
    actual_net_points: float
    saved_projection_net_points: float | None = None

    def __post_init__(self) -> None:
        _nonempty_id("game_id", self.game_id)
        _nonempty_id("player_id", self.player_id)
        _integer("sequence", self.sequence, minimum=0)
        _integer("revision", self.revision, minimum=1)
        object.__setattr__(
            self,
            "actual_net_points",
            _finite_number("actual_net_points", self.actual_net_points),
        )
        if self.saved_projection_net_points is not None:
            object.__setattr__(
                self,
                "saved_projection_net_points",
                _finite_number(
                    "saved_projection_net_points", self.saved_projection_net_points
                ),
            )


@dataclass(frozen=True)
class LedgerEntry:
    entry_id: str
    ruleset_id: str
    account_id: str
    position_id: str
    player_id: str
    kind: LedgerEntryKind
    amount_dollars: int
    game_id: str | None = None
    result_revision: int | None = None
    adjusts_revision: int | None = None


@dataclass(frozen=True)
class SettlementOutcome:
    game_id: str
    player_id: str
    sequence: int
    revision: int
    status: SettlementStatus
    dividend_dollars: int | None
    ledger_entry_ids: tuple[str, ...]
    base_revision: int | None
    adjusts_revision: int | None = None


class PerGameEconomy:
    """In-memory aggregate enforcing the per-game economy invariants."""

    def __init__(
        self,
        quotes: list[PlayerQuote],
        *,
        policy: EconomyPolicy | None = None,
    ) -> None:
        if not quotes:
            raise ValueError("economy requires at least one player quote")
        if len({quote.player_id for quote in quotes}) != len(quotes):
            raise ValueError("player quote ids must be unique")
        self.policy = policy or EconomyPolicy()
        self._quotes = {quote.player_id: quote for quote in quotes}
        self._accounts: set[str] = set()
        self._positions: dict[str, RosterPosition] = {}
        self._ledger: list[LedgerEntry] = []
        self._ledger_ids: set[str] = set()
        self._results: dict[tuple[str, str, int], PlayerGameResult] = {}
        self._outcomes: dict[tuple[str, str, int], SettlementOutcome] = {}
        self._game_sequences: dict[str, int] = {}
        self._player_game_exposure_snapshots: dict[
            tuple[str, str], tuple[str, ...]
        ] = {}
        self._player_game_base_revision: dict[tuple[str, str], int] = {}
        self._player_game_last_settled_revision: dict[tuple[str, str], int] = {}
        self._player_game_settled_dividend: dict[tuple[str, str], int] = {}
        self._settled_sequences_by_position: dict[str, set[int]] = {}

    def register_account(self, account_id: str) -> None:
        account_id = _nonempty_id("account_id", account_id)
        if account_id in self._accounts:
            raise EconomyRuleError(f"account {account_id} is already registered")
        self._accounts.add(account_id)

    def quote(self, player_id: str) -> PlayerQuote:
        try:
            return self._quotes[player_id]
        except KeyError as exc:
            raise EconomyRuleError(f"unknown player {player_id}") from exc

    def position(self, position_id: str) -> RosterPosition:
        try:
            return self._positions[position_id]
        except KeyError as exc:
            raise EconomyRuleError(f"unknown position {position_id}") from exc

    def active_positions(
        self,
        *,
        account_id: str | None = None,
        side: PositionSide | None = None,
    ) -> tuple[RosterPosition, ...]:
        return tuple(
            position
            for position in self._positions.values()
            if position.closed_sequence is None
            and (account_id is None or position.account_id == account_id)
            and (side is None or position.side is side)
        )

    def open_position(
        self,
        *,
        position_id: str,
        account_id: str,
        player_id: str,
        side: PositionSide,
        sequence: int,
    ) -> RosterPosition:
        position_id = _nonempty_id("position_id", position_id)
        account_id = _nonempty_id("account_id", account_id)
        player_id = _nonempty_id("player_id", player_id)
        sequence = _integer("sequence", sequence, minimum=0)
        if not isinstance(side, PositionSide):
            raise ValueError("side must be a PositionSide")
        if position_id in self._positions:
            raise EconomyRuleError(f"position id {position_id} already exists")
        if account_id not in self._accounts:
            raise EconomyRuleError(f"unknown account {account_id}")
        quote = self.quote(player_id)

        active = self.active_positions(account_id=account_id)
        if any(position.player_id == player_id and position.side is side for position in active):
            raise EconomyRuleError(
                f"account {account_id} already has an active {side.value} position in {player_id}"
            )
        if not self.policy.allow_opposing_positions and any(
            position.player_id == player_id and position.side is not side
            for position in active
        ):
            raise EconomyRuleError(
                f"account {account_id} cannot open an opposing position in {player_id}"
            )

        side_positions = [position for position in active if position.side is side]
        limit = (
            self.policy.max_long_positions
            if side is PositionSide.LONG
            else self.policy.max_short_positions
        )
        if len(side_positions) >= limit:
            raise EconomyRuleError(f"{side.value} roster is full at {limit} positions")

        position = RosterPosition(
            position_id=position_id,
            account_id=account_id,
            player_id=player_id,
            side=side,
            locked_per_game_cost_dollars=quote.current_per_game_cost_dollars,
            opened_sequence=sequence,
        )
        self._positions[position_id] = position
        if self.policy.open_fee_dollars:
            self._append_lifecycle_entry(
                entry_id=f"{self.policy.ruleset_id}:{position_id}:open-fee",
                position=position,
                kind=LedgerEntryKind.OPEN_FEE,
                amount_dollars=-self.policy.open_fee_dollars,
            )
        self._move_quote(
            player_id,
            impact_bps=self.policy.open_quote_impact_bps,
            direction=1 if side is PositionSide.LONG else -1,
        )
        return position

    def close_position(self, position_id: str, *, sequence: int) -> RosterPosition:
        position = self.position(position_id)
        sequence = _integer("sequence", sequence, minimum=0)
        if position.closed_sequence is not None:
            raise EconomyRuleError(f"position {position_id} is already closed")
        if sequence < position.opened_sequence:
            raise EconomyRuleError("close sequence cannot precede the open sequence")
        settled_sequences = self._settled_sequences_by_position.get(position_id, set())
        if any(game_sequence >= sequence for game_sequence in settled_sequences):
            raise EconomyRuleError(
                "close sequence would remove an already-settled exposure"
            )

        closed = replace(position, closed_sequence=sequence)
        self._positions[position_id] = closed
        if self.policy.drop_fee_dollars:
            self._append_lifecycle_entry(
                entry_id=f"{self.policy.ruleset_id}:{position_id}:drop-fee",
                position=position,
                kind=LedgerEntryKind.DROP_FEE,
                amount_dollars=-self.policy.drop_fee_dollars,
            )
        self._move_quote(
            position.player_id,
            impact_bps=self.policy.drop_quote_impact_bps,
            direction=-1 if position.side is PositionSide.LONG else 1,
        )
        return closed

    def settle_player_game(self, result: PlayerGameResult) -> SettlementOutcome:
        if not isinstance(result, PlayerGameResult):
            raise TypeError("result must be a PlayerGameResult")
        self.quote(result.player_id)
        game_sequence = self._game_sequences.get(result.game_id)
        if game_sequence is None:
            self._game_sequences[result.game_id] = result.sequence
        elif result.sequence != game_sequence:
            raise RevisionConflictError(
                f"game sequence cannot change from {game_sequence} to {result.sequence}"
            )
        player_game_key = (result.game_id, result.player_id)
        result_key = (*player_game_key, result.revision)
        if result_key in self._results:
            existing = self._results[result_key]
            if existing != result:
                raise RevisionConflictError(
                    f"result {result.game_id} revision {result.revision} conflicts with prior payload"
                )
            return self._outcomes[result_key]
        prior_results = sorted(
            (
                prior
                for (game_id, player_id, _), prior in self._results.items()
                if (game_id, player_id) == player_game_key
            ),
            key=lambda prior: prior.revision,
        )
        if prior_results:
            latest = prior_results[-1]
            if result.revision <= latest.revision:
                raise RevisionConflictError(
                    f"result {result.game_id} revision must be greater than {latest.revision}"
                )
            if result.sequence != latest.sequence:
                raise RevisionConflictError(
                    "a correction cannot change the game sequence"
                )

        if player_game_key not in self._player_game_exposure_snapshots:
            self._player_game_exposure_snapshots[player_game_key] = tuple(
                position.position_id
                for position in self._positions.values()
                if position.player_id == result.player_id
                and position.is_exposed(result.sequence)
            )

        effective_projection = result.saved_projection_net_points
        prior_projection = next(
            (
                prior.saved_projection_net_points
                for prior in prior_results
                if prior.saved_projection_net_points is not None
            ),
            None,
        )
        if (
            prior_projection is not None
            and effective_projection is not None
            and effective_projection != prior_projection
        ):
            raise RevisionConflictError("saved pregame projection cannot change")
        if effective_projection is None:
            effective_projection = prior_projection

        dividend_dollars = self._dividend_dollars(
            actual_net_points=result.actual_net_points,
            saved_projection_net_points=effective_projection,
        )
        if dividend_dollars is None:
            outcome = SettlementOutcome(
                game_id=result.game_id,
                player_id=result.player_id,
                sequence=result.sequence,
                revision=result.revision,
                status=SettlementStatus.UNSETTLED_MISSING_PROJECTION,
                dividend_dollars=None,
                ledger_entry_ids=(),
                base_revision=None,
            )
            self._results[result_key] = result
            self._outcomes[result_key] = outcome
            return outcome

        if player_game_key in self._player_game_base_revision:
            return self._settle_correction(
                result=result,
                dividend_dollars=dividend_dollars,
                player_game_key=player_game_key,
                result_key=result_key,
            )

        exposed = tuple(
            self._positions[position_id]
            for position_id in self._player_game_exposure_snapshots[player_game_key]
        )
        entry_ids: list[str] = []
        for position in exposed:
            direction = 1 if position.side is PositionSide.LONG else -1
            cost = self._append_entry(
                entry_id=self._player_game_entry_id(position, result, "cost"),
                position=position,
                kind=LedgerEntryKind.GAME_COST,
                amount_dollars=-direction * position.locked_per_game_cost_dollars,
                result=result,
            )
            dividend = self._append_entry(
                entry_id=self._player_game_entry_id(position, result, "dividend"),
                position=position,
                kind=LedgerEntryKind.GAME_DIVIDEND,
                amount_dollars=direction * dividend_dollars,
                result=result,
            )
            entry_ids.extend((cost.entry_id, dividend.entry_id))
            self._settled_sequences_by_position.setdefault(
                position.position_id, set()
            ).add(result.sequence)

        outcome = SettlementOutcome(
            game_id=result.game_id,
            player_id=result.player_id,
            sequence=result.sequence,
            revision=result.revision,
            status=SettlementStatus.SETTLED,
            dividend_dollars=dividend_dollars,
            ledger_entry_ids=tuple(entry_ids),
            base_revision=result.revision,
        )
        self._results[result_key] = result
        self._outcomes[result_key] = outcome
        self._player_game_base_revision[player_game_key] = result.revision
        self._player_game_last_settled_revision[player_game_key] = result.revision
        self._player_game_settled_dividend[player_game_key] = dividend_dollars
        return outcome

    def ledger_entries(self, *, account_id: str | None = None) -> tuple[LedgerEntry, ...]:
        if account_id is not None and account_id not in self._accounts:
            raise EconomyRuleError(f"unknown account {account_id}")
        return tuple(
            entry
            for entry in self._ledger
            if account_id is None or entry.account_id == account_id
        )

    def account_pnl_dollars(self, account_id: str) -> int:
        if account_id not in self._accounts:
            raise EconomyRuleError(f"unknown account {account_id}")
        return sum(entry.amount_dollars for entry in self._ledger if entry.account_id == account_id)

    def _move_quote(self, player_id: str, *, impact_bps: int, direction: int) -> None:
        if impact_bps == 0:
            return
        quote = self._quotes[player_id]
        if direction > 0:
            current = quote.current_per_game_cost_dollars
            room_to_cap = MAX_PER_GAME_QUOTE_DOLLARS - current
            minimum_impact_to_saturate = max(
                0,
                (room_to_cap * 10_000 - 5_000 + current - 1) // current,
            )
            if impact_bps >= minimum_impact_to_saturate:
                moved = MAX_PER_GAME_QUOTE_DOLLARS
            else:
                moved = current + (current * impact_bps + 5_000) // 10_000
        else:
            multiplier = 10_000 + impact_bps
            moved = (
                quote.current_per_game_cost_dollars * 10_000 + multiplier // 2
            ) // multiplier
        self._quotes[player_id] = replace(
            quote,
            current_per_game_cost_dollars=min(
                MAX_PER_GAME_QUOTE_DOLLARS,
                max(self.policy.minimum_quote_dollars, moved),
            ),
        )

    def _dividend_dollars(
        self,
        *,
        actual_net_points: float,
        saved_projection_net_points: float | None,
    ) -> int | None:
        if self.policy.dividend_basis is DividendBasis.RAW_NET_POINTS:
            dividend_net_points = Decimal(str(actual_net_points))
        elif saved_projection_net_points is None:
            return None
        else:
            dividend_net_points = Decimal(str(actual_net_points)) - Decimal(
                str(saved_projection_net_points)
            )
        raw = dividend_net_points * self.policy.dividend_dollars_per_net_point
        return int(raw.quantize(Decimal("1"), rounding=ROUND_HALF_UP))

    def _settle_correction(
        self,
        *,
        result: PlayerGameResult,
        dividend_dollars: int,
        player_game_key: tuple[str, str],
        result_key: tuple[str, str, int],
    ) -> SettlementOutcome:
        previous_revision = self._player_game_last_settled_revision[player_game_key]
        prior_dividend = self._player_game_settled_dividend[player_game_key]
        dividend_delta = dividend_dollars - prior_dividend
        entry_ids: list[str] = []
        for position_id in self._player_game_exposure_snapshots[player_game_key]:
            position = self._positions[position_id]
            direction = 1 if position.side is PositionSide.LONG else -1
            entry = self._append_entry(
                entry_id=self._player_game_entry_id(
                    position, result, "correction"
                ),
                position=position,
                kind=LedgerEntryKind.DIVIDEND_CORRECTION,
                amount_dollars=direction * dividend_delta,
                result=result,
                adjusts_revision=previous_revision,
            )
            entry_ids.append(entry.entry_id)

        outcome = SettlementOutcome(
            game_id=result.game_id,
            player_id=result.player_id,
            sequence=result.sequence,
            revision=result.revision,
            status=SettlementStatus.SETTLED,
            dividend_dollars=dividend_dollars,
            ledger_entry_ids=tuple(entry_ids),
            base_revision=self._player_game_base_revision[player_game_key],
            adjusts_revision=previous_revision,
        )
        self._results[result_key] = result
        self._outcomes[result_key] = outcome
        self._player_game_last_settled_revision[player_game_key] = result.revision
        self._player_game_settled_dividend[player_game_key] = dividend_dollars
        return outcome

    def _player_game_entry_id(
        self,
        position: RosterPosition,
        result: PlayerGameResult,
        suffix: str,
    ) -> str:
        return (
            f"{self.policy.ruleset_id}:{position.position_id}:{result.game_id}:"
            f"{result.player_id}:r{result.revision}:{suffix}"
        )

    def _append_entry(
        self,
        *,
        entry_id: str,
        position: RosterPosition,
        kind: LedgerEntryKind,
        amount_dollars: int,
        result: PlayerGameResult,
        adjusts_revision: int | None = None,
    ) -> LedgerEntry:
        if entry_id in self._ledger_ids:
            raise EconomyRuleError(f"ledger entry id {entry_id} already exists")
        entry = LedgerEntry(
            entry_id=entry_id,
            ruleset_id=self.policy.ruleset_id,
            account_id=position.account_id,
            position_id=position.position_id,
            player_id=position.player_id,
            kind=kind,
            amount_dollars=amount_dollars,
            game_id=result.game_id,
            result_revision=result.revision,
            adjusts_revision=adjusts_revision,
        )
        self._ledger.append(entry)
        self._ledger_ids.add(entry_id)
        return entry

    def _append_lifecycle_entry(
        self,
        *,
        entry_id: str,
        position: RosterPosition,
        kind: LedgerEntryKind,
        amount_dollars: int,
    ) -> LedgerEntry:
        if entry_id in self._ledger_ids:
            raise EconomyRuleError(f"ledger entry id {entry_id} already exists")
        entry = LedgerEntry(
            entry_id=entry_id,
            ruleset_id=self.policy.ruleset_id,
            account_id=position.account_id,
            position_id=position.position_id,
            player_id=position.player_id,
            kind=kind,
            amount_dollars=amount_dollars,
        )
        self._ledger.append(entry)
        self._ledger_ids.add(entry_id)
        return entry
