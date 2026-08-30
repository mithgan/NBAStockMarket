from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timezone
from enum import Enum
import hashlib
import json
import math
import re
from typing import TYPE_CHECKING, Protocol, runtime_checkable

if TYPE_CHECKING:
    from nba_stock_market.bdl_live import (
        BDLFinalPlayerResult,
        BDLProviderGame,
        BDLSlate,
    )


_SETTLEMENT_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")
_FINAL_STATUS = "final"
_IN_PROGRESS_STATUS = "in_progress"
_TERMINAL_STATUSES = frozenset({_FINAL_STATUS, "postponed", "cancelled"})


class CoordinatorContractError(ValueError):
    """Raised when a provider or sink violates the coordinator contract."""


class StaleSettlementFenceError(RuntimeError):
    """Raised by a sink when the caller no longer owns the scheduler lease."""


class RetryableSettlementProviderError(RuntimeError):
    """Base class for provider failures that a later scheduler tick may retry."""


@runtime_checkable
class LeaseFence(Protocol):
    """Structural view of the existing scheduler's fenced lease identity."""

    owner_id: str
    fencing_token: int


@dataclass(frozen=True)
class GameSettlementBoundary:
    """Sink-prepared, immutable v2 identity shared by every game result."""

    provider: str
    provider_game_id: str
    game_id: str
    game_date: date
    game_started_at: datetime | None
    next_game_date: date | None
    event_sequence: int

    def __post_init__(self) -> None:
        _require_text(self.provider, "provider")
        _require_text(self.provider_game_id, "provider_game_id")
        _require_settlement_id(self.game_id, "game_id", max_length=96)
        _require_date(self.game_date, "game_date")
        if self.next_game_date is not None:
            _require_date(self.next_game_date, "next_game_date")
            if self.next_game_date <= self.game_date:
                raise CoordinatorContractError(
                    "next_game_date must be later than game_date"
                )
        if (
            not isinstance(self.event_sequence, int)
            or isinstance(self.event_sequence, bool)
            or self.event_sequence < 0
        ):
            raise CoordinatorContractError("event_sequence must be nonnegative")
        if self.game_started_at is not None:
            if (
                not isinstance(self.game_started_at, datetime)
                or self.game_started_at.utcoffset() is None
            ):
                raise CoordinatorContractError("game_started_at must be timezone-aware")
            object.__setattr__(
                self,
                "game_started_at",
                self.game_started_at.astimezone(timezone.utc),
            )


@dataclass(frozen=True)
class PreparedGame:
    """A normalized provider game paired with its durable sink boundary."""

    provider_game: BDLProviderGame
    boundary: GameSettlementBoundary

    def __post_init__(self) -> None:
        provider_game_id = _required_identity(self.provider_game, "game_id")
        if provider_game_id != self.boundary.provider_game_id:
            raise CoordinatorContractError(
                "prepared game identity does not match its boundary"
            )
        provider_game_date = getattr(self.provider_game, "game_date", None)
        if provider_game_date != self.boundary.game_date:
            raise CoordinatorContractError(
                "prepared game date does not match its boundary"
            )


@dataclass(frozen=True)
class PreparedSlate:
    """The sink's durable date manifest and stable prepared game boundaries."""

    game_date: date
    games: tuple[PreparedGame, ...]
    schedule_complete: bool
    requires_lock: bool = False

    def __post_init__(self) -> None:
        _require_date(self.game_date, "game_date")
        if not isinstance(self.schedule_complete, bool):
            raise CoordinatorContractError("schedule_complete must be boolean")
        if not isinstance(self.requires_lock, bool):
            raise CoordinatorContractError("requires_lock must be boolean")
        object.__setattr__(self, "games", tuple(self.games))
        identities: set[str] = set()
        next_game_dates: set[date | None] = set()
        for game in self.games:
            if game.boundary.game_date != self.game_date:
                raise CoordinatorContractError(
                    "prepared slate contains a boundary for another date"
                )
            identity = game.boundary.provider_game_id
            if identity in identities:
                raise CoordinatorContractError(
                    f"prepared slate contains duplicate game {identity}"
                )
            identities.add(identity)
            next_game_dates.add(game.boundary.next_game_date)
        if len(next_game_dates) > 1:
            raise CoordinatorContractError(
                "prepared slate boundaries disagree on next_game_date"
            )

    @property
    def authoritative_next_game_date(self) -> date | None:
        if not self.games:
            return None
        return self.games[0].boundary.next_game_date


@dataclass(frozen=True)
class RosterLockCommand:
    """An exact-date idempotent roster lock transition."""

    game_date: date
    locked: bool

    def __post_init__(self) -> None:
        _require_date(self.game_date, "game_date")
        if not isinstance(self.locked, bool):
            raise CoordinatorContractError("locked must be boolean")

    @property
    def idempotency_key(self) -> str:
        operation = "lock" if self.locked else "unlock"
        return f"v2-live:{operation}:{self.game_date.isoformat()}"

    @property
    def payload(self) -> dict[str, object]:
        return {"locked": self.locked, "game_date": self.game_date}


@dataclass(frozen=True)
class DateCompletionCommand:
    """An idempotent date boundary after every terminal result is durable."""

    game_date: date
    next_game_date: date | None
    next_event_sequence: int

    def __post_init__(self) -> None:
        _require_date(self.game_date, "game_date")
        if self.next_game_date is not None:
            _require_date(self.next_game_date, "next_game_date")
            if self.next_game_date <= self.game_date:
                raise CoordinatorContractError(
                    "next_game_date must be later than game_date"
                )
        if (
            not isinstance(self.next_event_sequence, int)
            or isinstance(self.next_event_sequence, bool)
            or self.next_event_sequence < 0
        ):
            raise CoordinatorContractError("next_event_sequence must be nonnegative")

    @property
    def idempotency_key(self) -> str:
        return f"v2-live:complete-date:{self.game_date.isoformat()}"

    @property
    def payload(self) -> dict[str, object]:
        return {
            "game_date": self.game_date,
            "next_game_date": self.next_game_date,
            "next_event_sequence": self.next_event_sequence,
        }


@dataclass(frozen=True)
class PlayerSettlementCommand:
    """A sink-persisted command that can be replayed byte-for-byte."""

    boundary: GameSettlementBoundary
    provider_player_id: str
    player_id: str
    result_fingerprint: str
    previous_revision: int | None
    actual_net_points: float

    def __post_init__(self) -> None:
        _require_text(self.provider_player_id, "provider_player_id")
        _require_settlement_id(self.player_id, "player_id", max_length=64)
        _require_text(self.result_fingerprint, "result_fingerprint")
        if self.previous_revision is not None and (
            not isinstance(self.previous_revision, int)
            or isinstance(self.previous_revision, bool)
            or self.previous_revision < 1
        ):
            raise CoordinatorContractError(
                "previous_revision must be a positive integer"
            )
        if isinstance(self.actual_net_points, bool):
            raise CoordinatorContractError("actual_net_points must be finite")
        try:
            normalized_points = float(self.actual_net_points)
        except (TypeError, ValueError) as exc:
            raise CoordinatorContractError("actual_net_points must be finite") from exc
        if not math.isfinite(normalized_points):
            raise CoordinatorContractError("actual_net_points must be finite")
        if not -1000 <= normalized_points <= 1000:
            raise CoordinatorContractError(
                "actual_net_points must be between -1000 and 1000"
            )
        object.__setattr__(self, "actual_net_points", normalized_points)

    @property
    def result_revision(self) -> int:
        if self.previous_revision is None:
            return 1
        return self.previous_revision + 1

    @property
    def idempotency_key(self) -> str:
        identity = {
            "provider": self.boundary.provider,
            "game_id": self.boundary.game_id,
            "player_id": self.player_id,
            "revision": self.result_revision,
        }
        digest = hashlib.sha256(
            json.dumps(identity, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        return f"v2-live:settle:{digest}"

    @property
    def payload(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "game_id": self.boundary.game_id,
            "player_id": self.player_id,
            "game_date": self.boundary.game_date,
            "next_game_date": self.boundary.next_game_date,
            "event_sequence": self.boundary.event_sequence,
            "result_revision": self.result_revision,
            "actual_net_points": self.actual_net_points,
        }
        if self.boundary.game_started_at is not None:
            payload["game_started_at"] = self.boundary.game_started_at
        return payload


class PlayerPreparationStatus(str, Enum):
    READY = "ready"
    UNCHANGED = "unchanged"
    UNRESOLVED = "unresolved"


@dataclass(frozen=True)
class PlayerPreparation:
    """Durable result of comparing one provider result with sink state."""

    status: PlayerPreparationStatus
    command: PlayerSettlementCommand | None = None
    error_code: str | None = None

    def __post_init__(self) -> None:
        if self.status is PlayerPreparationStatus.READY:
            if self.command is None or self.error_code is not None:
                raise CoordinatorContractError(
                    "ready preparation requires only a command"
                )
        elif self.command is not None:
            raise CoordinatorContractError(
                "non-ready preparation cannot contain a command"
            )
        elif self.status is PlayerPreparationStatus.UNRESOLVED:
            _require_text(self.error_code, "error_code")
        elif self.error_code is not None:
            raise CoordinatorContractError(
                "unchanged preparation cannot contain an error"
            )

    @classmethod
    def ready(cls, command: PlayerSettlementCommand) -> PlayerPreparation:
        return cls(PlayerPreparationStatus.READY, command=command)

    @classmethod
    def unchanged(cls) -> PlayerPreparation:
        return cls(PlayerPreparationStatus.UNCHANGED)

    @classmethod
    def unresolved(cls, error_code: str) -> PlayerPreparation:
        return cls(PlayerPreparationStatus.UNRESOLVED, error_code=error_code)


class DispatchStatus(str, Enum):
    SUCCEEDED = "succeeded"
    RETRYABLE_FAILURE = "retryable_failure"
    PERMANENT_FAILURE = "permanent_failure"


@dataclass(frozen=True)
class CommandDispatch:
    """A sink-recorded command outcome; failures always remain unresolved."""

    status: DispatchStatus
    error_code: str | None = None

    def __post_init__(self) -> None:
        if self.status is DispatchStatus.SUCCEEDED:
            if self.error_code is not None:
                raise CoordinatorContractError(
                    "successful dispatch cannot contain an error"
                )
        else:
            _require_text(self.error_code, "error_code")

    @property
    def succeeded(self) -> bool:
        return self.status is DispatchStatus.SUCCEEDED

    @classmethod
    def success(cls) -> CommandDispatch:
        return cls(DispatchStatus.SUCCEEDED)

    @classmethod
    def retryable_failure(cls, error_code: str) -> CommandDispatch:
        return cls(DispatchStatus.RETRYABLE_FAILURE, error_code=error_code)

    @classmethod
    def permanent_failure(cls, error_code: str) -> CommandDispatch:
        return cls(DispatchStatus.PERMANENT_FAILURE, error_code=error_code)


@runtime_checkable
class LiveSettlementProvider(Protocol):
    """Transport-neutral view of the frozen BDL provider interface."""

    def fetch_slate(self, game_date: date) -> BDLSlate: ...

    def fetch_final_results(
        self, game: BDLProviderGame
    ) -> Sequence[BDLFinalPlayerResult]: ...


@runtime_checkable
class DurableSettlementSink(Protocol):
    """Fence-checked durable authority used by the stateless coordinator.

    ``prepare_slate`` must atomically preserve the complete known manifest,
    one authoritative next game date, and one immutable boundary per game.
    ``prepare_player_settlement`` must resolve a stable player crosswalk,
    durably ingest each newly observed fingerprint, and return the oldest
    pending command for that player. If there is no pending command, it must
    return ``unchanged`` for a delivered equal fingerprint or allocate the
    next contiguous revision. A dispatch may report success only after that
    outcome is durable.
    """

    def prepare_slate(self, slate: BDLSlate, fence: LeaseFence) -> PreparedSlate: ...

    def requires_roster_lock(
        self,
        game_date: date,
        observed_at: datetime,
        fence: LeaseFence,
    ) -> bool:
        """Use persisted tipoffs/status to decide before the provider is polled."""
        ...

    def dispatch_roster_lock(
        self, command: RosterLockCommand, fence: LeaseFence
    ) -> CommandDispatch: ...

    def prepare_player_settlement(
        self,
        game: PreparedGame,
        result: BDLFinalPlayerResult,
        fence: LeaseFence,
    ) -> PlayerPreparation: ...

    def dispatch_player_settlement(
        self, command: PlayerSettlementCommand, fence: LeaseFence
    ) -> CommandDispatch: ...

    def dispatch_date_completion(
        self, slate: PreparedSlate, fence: LeaseFence
    ) -> CommandDispatch:
        """Advance the durable date boundary before releasing its roster lock."""
        ...

    def can_unlock(self, slate: PreparedSlate, fence: LeaseFence) -> bool:
        """Return true only when the held date is ready for completion."""
        ...


@dataclass(frozen=True)
class LiveSettlementRun:
    game_date: date
    games_seen: int
    final_games_seen: int
    results_seen: int
    commands_attempted: int
    commands_succeeded: int
    unchanged_results: int
    unresolved_items: int
    lock_attempted: bool
    lock_acquired: bool
    unlock_attempted: bool
    unlocked: bool


class LiveSettlementCoordinator:
    """Coordinate one provider date while keeping all authority in the sink."""

    def __init__(
        self,
        provider: LiveSettlementProvider,
        sink: DurableSettlementSink,
        *,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._provider = provider
        self._sink = sink
        self._clock = clock or (lambda: datetime.now(timezone.utc))

    def run(self, game_date: date, fence: LeaseFence) -> LiveSettlementRun:
        _require_date(game_date, "game_date")
        results_seen = 0
        commands_attempted = 0
        commands_succeeded = 0
        unchanged_results = 0
        unresolved_items = 0
        lock_attempted = False
        lock_acquired = False
        lock_failed = False
        unlock_attempted = False
        unlocked = False

        def ensure_lock() -> bool:
            nonlocal lock_attempted, lock_acquired, lock_failed, unresolved_items
            if lock_acquired:
                return True
            if lock_failed:
                return False
            lock_attempted = True
            outcome = self._sink.dispatch_roster_lock(
                RosterLockCommand(game_date=game_date, locked=True), fence
            )
            if outcome.succeeded:
                lock_acquired = True
                return True
            lock_failed = True
            unresolved_items += 1
            return False

        if self._sink.requires_roster_lock(
            game_date,
            self._observed_at(),
            fence,
        ):
            if not ensure_lock():
                return LiveSettlementRun(
                    game_date=game_date,
                    games_seen=0,
                    final_games_seen=0,
                    results_seen=0,
                    commands_attempted=0,
                    commands_succeeded=0,
                    unchanged_results=0,
                    unresolved_items=unresolved_items,
                    lock_attempted=lock_attempted,
                    lock_acquired=lock_acquired,
                    unlock_attempted=False,
                    unlocked=False,
                )

        try:
            slate = self._provider.fetch_slate(game_date)
        except RetryableSettlementProviderError:
            unresolved_items += 1
            if self._sink.requires_roster_lock(
                game_date,
                self._observed_at(),
                fence,
            ):
                ensure_lock()
            return LiveSettlementRun(
                game_date=game_date,
                games_seen=0,
                final_games_seen=0,
                results_seen=0,
                commands_attempted=0,
                commands_succeeded=0,
                unchanged_results=0,
                unresolved_items=unresolved_items,
                lock_attempted=lock_attempted,
                lock_acquired=lock_acquired,
                unlock_attempted=False,
                unlocked=False,
            )
        except Exception:
            if self._sink.requires_roster_lock(
                game_date,
                self._observed_at(),
                fence,
            ):
                ensure_lock()
            raise

        try:
            prepared_slate = self._sink.prepare_slate(slate, fence)
        except RetryableSettlementProviderError:
            unresolved_items += 1
            if self._sink.requires_roster_lock(
                game_date,
                self._observed_at(),
                fence,
            ):
                ensure_lock()
            return LiveSettlementRun(
                game_date=game_date,
                games_seen=0,
                final_games_seen=0,
                results_seen=0,
                commands_attempted=0,
                commands_succeeded=0,
                unchanged_results=0,
                unresolved_items=unresolved_items,
                lock_attempted=lock_attempted,
                lock_acquired=lock_acquired,
                unlock_attempted=False,
                unlocked=False,
            )
        except Exception:
            if self._sink.requires_roster_lock(
                game_date,
                self._observed_at(),
                fence,
            ):
                ensure_lock()
            raise
        if prepared_slate.game_date != game_date:
            raise CoordinatorContractError(
                "prepared slate date does not match the requested date"
            )

        if (
            prepared_slate.requires_lock
            or self._sink.requires_roster_lock(
                game_date,
                self._observed_at(),
                fence,
            )
            or any(
                _status_value(game.provider_game) == _IN_PROGRESS_STATUS
                for game in prepared_slate.games
            )
        ):
            ensure_lock()

        if lock_acquired and not prepared_slate.schedule_complete:
            try:
                prepared_slate = self._sink.prepare_slate(slate, fence)
            except RetryableSettlementProviderError:
                unresolved_items += 1
                return LiveSettlementRun(
                    game_date=game_date,
                    games_seen=0,
                    final_games_seen=0,
                    results_seen=0,
                    commands_attempted=0,
                    commands_succeeded=0,
                    unchanged_results=0,
                    unresolved_items=unresolved_items,
                    lock_attempted=lock_attempted,
                    lock_acquired=lock_acquired,
                    unlock_attempted=False,
                    unlocked=False,
                )
            except Exception:
                if self._sink.requires_roster_lock(
                    game_date,
                    self._observed_at(),
                    fence,
                ):
                    ensure_lock()
                raise
            if prepared_slate.game_date != game_date:
                raise CoordinatorContractError(
                    "re-prepared slate date does not match the requested date"
                )

        games = tuple(
            sorted(
                prepared_slate.games,
                key=lambda game: game.boundary.provider_game_id,
            )
        )
        final_games = tuple(
            game for game in games if _status_value(game.provider_game) == _FINAL_STATUS
        )

        for game in final_games:
            try:
                provider_results = tuple(
                    self._provider.fetch_final_results(game.provider_game)
                )
            except RetryableSettlementProviderError:
                unresolved_items += 1
                continue

            results_seen += len(provider_results)
            try:
                expected_player_ids = _expected_player_ids(game.provider_game)
            except CoordinatorContractError:
                unresolved_items += 1
                continue

            valid_results: list[tuple[str, BDLFinalPlayerResult]] = []
            observed_player_ids: set[str] = set()
            result_contract_failed = False
            for result in provider_results:
                try:
                    result_game_id = _required_identity(result, "game_id")
                    provider_player_id = _required_identity(result, "player_id")
                except CoordinatorContractError:
                    result_contract_failed = True
                    continue
                if result_game_id != game.boundary.provider_game_id:
                    result_contract_failed = True
                    continue
                if (
                    provider_player_id not in expected_player_ids
                    or provider_player_id in observed_player_ids
                ):
                    result_contract_failed = True
                    continue
                observed_player_ids.add(provider_player_id)
                valid_results.append((provider_player_id, result))

            if observed_player_ids != expected_player_ids or result_contract_failed:
                unresolved_items += 1

            for provider_player_id, result in sorted(valid_results):
                preparation = self._sink.prepare_player_settlement(game, result, fence)
                if preparation.status is PlayerPreparationStatus.UNCHANGED:
                    unchanged_results += 1
                    continue
                if preparation.status is PlayerPreparationStatus.UNRESOLVED:
                    unresolved_items += 1
                    continue
                command = preparation.command
                if command is None:
                    raise CoordinatorContractError(
                        "ready preparation omitted its command"
                    )
                if (
                    command.boundary != game.boundary
                    or command.provider_player_id != provider_player_id
                ):
                    raise CoordinatorContractError(
                        "prepared player command changed provider identity or boundary"
                    )
                if command.result_revision == 1 and not ensure_lock():
                    unresolved_items += 1
                    continue
                commands_attempted += 1
                outcome = self._sink.dispatch_player_settlement(command, fence)
                if outcome.succeeded:
                    commands_succeeded += 1
                else:
                    unresolved_items += 1

        all_games_terminal = all(
            _status_value(game.provider_game) in _TERMINAL_STATUSES for game in games
        )
        if (
            prepared_slate.schedule_complete
            and all_games_terminal
            and unresolved_items == 0
            and self._sink.can_unlock(prepared_slate, fence)
        ):
            completion = self._sink.dispatch_date_completion(prepared_slate, fence)
            if completion.succeeded:
                unlock_attempted = True
                outcome = self._sink.dispatch_roster_lock(
                    RosterLockCommand(game_date=game_date, locked=False), fence
                )
                if outcome.succeeded:
                    unlocked = True
                else:
                    unresolved_items += 1
            else:
                unresolved_items += 1

        return LiveSettlementRun(
            game_date=game_date,
            games_seen=len(games),
            final_games_seen=len(final_games),
            results_seen=results_seen,
            commands_attempted=commands_attempted,
            commands_succeeded=commands_succeeded,
            unchanged_results=unchanged_results,
            unresolved_items=unresolved_items,
            lock_attempted=lock_attempted,
            lock_acquired=lock_acquired,
            unlock_attempted=unlock_attempted,
            unlocked=unlocked,
        )

    def settle_date(self, game_date: date, fence: LeaseFence) -> LiveSettlementRun:
        """Alias for runtime adapters that name the operation explicitly."""
        return self.run(game_date, fence)

    def _observed_at(self) -> datetime:
        observed_at = self._clock()
        if not isinstance(observed_at, datetime) or observed_at.utcoffset() is None:
            raise CoordinatorContractError(
                "settlement clock must return a timezone-aware datetime"
            )
        return observed_at.astimezone(timezone.utc)


def _require_text(value: object, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise CoordinatorContractError(f"{field_name} must be a non-empty string")
    return value


def _require_settlement_id(value: object, field_name: str, *, max_length: int) -> str:
    text = _require_text(value, field_name)
    if len(text) > max_length or _SETTLEMENT_ID_PATTERN.fullmatch(text) is None:
        raise CoordinatorContractError(f"{field_name} is not a valid settlement id")
    return text


def _require_date(value: object, field_name: str) -> date:
    if type(value) is not date:
        raise CoordinatorContractError(f"{field_name} must be a date")
    return value


def _required_identity(value: object, attribute: str) -> str:
    identity = getattr(value, attribute, None)
    if isinstance(identity, bool):
        raise CoordinatorContractError(f"{attribute} must be a stable identity")
    return _require_text(str(identity) if identity is not None else None, attribute)


def _expected_player_ids(game: object) -> frozenset[str]:
    raw_player_ids = getattr(game, "expected_player_ids", None)
    if isinstance(raw_player_ids, (str, bytes)) or raw_player_ids is None:
        raise CoordinatorContractError(
            "expected_player_ids must be a collection of stable identities"
        )
    try:
        player_ids = tuple(raw_player_ids)
    except TypeError as exc:
        raise CoordinatorContractError(
            "expected_player_ids must be a collection of stable identities"
        ) from exc
    normalized = frozenset(
        _require_text(
            str(player_id) if not isinstance(player_id, bool) else None,
            "expected_player_id",
        )
        for player_id in player_ids
    )
    if len(normalized) != len(player_ids):
        raise CoordinatorContractError("expected_player_ids contains duplicates")
    return normalized


def _status_value(game: object) -> str:
    status = getattr(game, "status", None)
    if isinstance(status, Enum):
        status = status.value
    if not isinstance(status, str) or not status.strip():
        return "unknown"
    return status.strip().lower().replace("-", "_").replace(" ", "_")


LiveSettlementSink = DurableSettlementSink
SettlementCoordinator = LiveSettlementCoordinator
SettlementProvider = LiveSettlementProvider
SettlementSink = DurableSettlementSink


__all__ = [
    "CommandDispatch",
    "CoordinatorContractError",
    "DateCompletionCommand",
    "DispatchStatus",
    "DurableSettlementSink",
    "GameSettlementBoundary",
    "LeaseFence",
    "LiveSettlementCoordinator",
    "LiveSettlementProvider",
    "LiveSettlementRun",
    "LiveSettlementSink",
    "PlayerPreparation",
    "PlayerPreparationStatus",
    "PlayerSettlementCommand",
    "PreparedGame",
    "PreparedSlate",
    "RosterLockCommand",
    "RetryableSettlementProviderError",
    "SettlementCoordinator",
    "SettlementProvider",
    "SettlementSink",
    "StaleSettlementFenceError",
]
