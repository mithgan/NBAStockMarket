from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, date, datetime
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import json
import re
import unicodedata
from typing import Protocol

from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from nba_stock_market.api.database import (
    Database,
    PerGameLiveGameRow,
    PerGameLiveResultCommandRow,
    PerGameLiveSlateRow,
    PerGameProviderPlayerMapRow,
    PerGameQuoteRow,
    PerGameRulesetRow,
    PlayerListingRow,
    utcnow,
)
from nba_stock_market.api.per_game_service import PerGameService
from nba_stock_market.api.service import ApiProblem
from nba_stock_market.live_settlement import (
    CommandDispatch,
    CoordinatorContractError,
    DateCompletionCommand,
    GameSettlementBoundary,
    LeaseFence,
    PlayerPreparation,
    PlayerSettlementCommand,
    PreparedGame,
    PreparedSlate,
    RetryableSettlementProviderError,
    RosterLockCommand,
    StaleSettlementFenceError,
)


LIVE_PROVIDER = "bdl"
_LIVE_DIVIDEND_BASIS = "raw_net_points"
_TERMINAL_STATUSES = frozenset({"final", "postponed", "cancelled"})
_ALLOWED_STATUS_TRANSITIONS = {
    "scheduled": frozenset(
        {"scheduled", "in_progress", "final", "postponed", "cancelled"}
    ),
    "in_progress": frozenset({"in_progress", "final", "postponed", "cancelled"}),
    "final": frozenset({"final"}),
    "postponed": frozenset(
        {"scheduled", "in_progress", "final", "postponed", "cancelled"}
    ),
    "cancelled": frozenset(
        {"scheduled", "in_progress", "final", "postponed", "cancelled"}
    ),
}
_REMOVABLE_MANIFEST_STATUSES = frozenset({"scheduled", "postponed", "cancelled"})
_NAME_SUFFIXES = frozenset({"jr", "sr", "ii", "iii", "iv", "v"})
_ERROR_CODE_PATTERN = re.compile(r"[^a-z0-9_]+")
_RETRYABLE_API_PROBLEM_CODES = frozenset(
    {"roster_lock_conflict", "roster_lock_required"}
)


class FenceValidator(Protocol):
    def __call__(self, session: Session, fence: LeaseFence) -> bool: ...


class NextGameDateResolver(Protocol):
    def __call__(self, game_date: date) -> date | None: ...


class PerGameCommandTarget(Protocol):
    def set_roster_lock(
        self,
        command: RosterLockCommand,
        *,
        write_guard: Callable[[Session], None],
    ) -> object: ...

    def settle_player(
        self,
        command: PlayerSettlementCommand,
        *,
        write_guard: Callable[[Session], None],
    ) -> object: ...

    def complete_date(
        self,
        command: DateCompletionCommand,
        *,
        write_guard: Callable[[Session], None],
    ) -> object: ...


class InProcessPerGameCommandTarget:
    """Deliver coordinator commands through the authoritative v2 service."""

    def __init__(self, service: PerGameService) -> None:
        self._service = service

    def set_roster_lock(
        self,
        command: RosterLockCommand,
        *,
        write_guard: Callable[[Session], None],
    ) -> dict[str, object]:
        return self._service.set_roster_mutation_lock(
            locked=command.locked,
            game_date=command.game_date,
            idempotency_key=command.idempotency_key,
            write_guard=write_guard,
        )

    def settle_player(
        self,
        command: PlayerSettlementCommand,
        *,
        write_guard: Callable[[Session], None],
    ) -> dict[str, object]:
        boundary = command.boundary
        return self._service.settle_player_game(
            game_id=boundary.game_id,
            player_id=command.player_id,
            game_date=boundary.game_date,
            game_started_at=boundary.game_started_at,
            next_game_date=boundary.next_game_date,
            event_sequence=boundary.event_sequence,
            result_revision=command.result_revision,
            actual_net_points=command.actual_net_points,
            saved_projection_net_points=None,
            projection_model=None,
            projection_version=None,
            projection_captured_at=None,
            idempotency_key=command.idempotency_key,
            enforce_tipoff_exposure=True,
            write_guard=write_guard,
        )

    def complete_date(
        self,
        command: DateCompletionCommand,
        *,
        write_guard: Callable[[Session], None],
    ) -> dict[str, object]:
        return self._service.complete_game_date(
            game_date=command.game_date,
            next_game_date=command.next_game_date,
            next_event_sequence=command.next_event_sequence,
            idempotency_key=command.idempotency_key,
            write_guard=write_guard,
        )


class DatabaseLiveSettlementSink:
    """Durable BDL state and fenced command delivery for per-game v2.

    The sink stores provider observations before delivery. A crash after the v2
    service commits but before this sink marks success is safe: the next owner
    retries the same immutable command and idempotency key.
    """

    def __init__(
        self,
        database: Database,
        *,
        fence_validator: FenceValidator,
        next_game_date_resolver: NextGameDateResolver,
        expected_ruleset_id: str,
        expected_ruleset_version: int,
        expected_ruleset_season_id: str,
        expected_dividend_dollars_per_net_point: int,
        expected_provider_season_id: str,
        command_target: PerGameCommandTarget | None = None,
        provider: str = LIVE_PROVIDER,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        if not provider or len(provider) > 32:
            raise ValueError("provider must be a non-empty identifier")
        if not expected_ruleset_id or len(expected_ruleset_id) > 64:
            raise ValueError("expected_ruleset_id must be a non-empty identifier")
        for field, value in (
            ("expected_ruleset_season_id", expected_ruleset_season_id),
            ("expected_provider_season_id", expected_provider_season_id),
        ):
            if not value or len(value) > 32:
                raise ValueError(f"{field} must be a non-empty season identifier")
        if (
            isinstance(expected_ruleset_version, bool)
            or not isinstance(expected_ruleset_version, int)
            or expected_ruleset_version < 1
        ):
            raise ValueError("expected_ruleset_version must be positive")
        if (
            isinstance(expected_dividend_dollars_per_net_point, bool)
            or not isinstance(expected_dividend_dollars_per_net_point, int)
            or not 0 <= expected_dividend_dollars_per_net_point <= 1_000_000_000
        ):
            raise ValueError("expected_dividend_dollars_per_net_point is out of range")
        self._database = database
        self._fence_validator = fence_validator
        self._next_game_date_resolver = next_game_date_resolver
        self._provider = provider
        self._expected_ruleset_id = expected_ruleset_id
        self._expected_ruleset_version = expected_ruleset_version
        self._expected_ruleset_season_id = expected_ruleset_season_id
        self._expected_dividend_dollars_per_net_point = (
            expected_dividend_dollars_per_net_point
        )
        self._expected_provider_season_id = expected_provider_season_id
        self._clock = clock or (lambda: datetime.now(UTC))
        self._target = command_target or InProcessPerGameCommandTarget(
            PerGameService(database, ruleset_id=expected_ruleset_id)
        )

    def prepare_slate(self, slate: object, fence: LeaseFence) -> PreparedSlate:
        game_date = getattr(slate, "game_date", None)
        if type(game_date) is not date:
            raise CoordinatorContractError("provider slate must have an exact date")
        source_games = tuple(getattr(slate, "games", ()))
        schedule_complete = getattr(slate, "schedule_complete", None)
        if type(schedule_complete) is not bool:
            raise CoordinatorContractError(
                "provider slate must declare schedule completeness"
            )
        provider_ids = tuple(self._provider_game_id(game) for game in source_games)
        if len(provider_ids) != len(set(provider_ids)):
            raise CoordinatorContractError("provider slate contains duplicate games")
        if any(getattr(game, "game_date", None) != game_date for game in source_games):
            raise CoordinatorContractError("provider slate contains a wrong game date")
        if any(
            self._required_text(game, "season_id", max_length=32)
            != self._expected_provider_season_id
            for game in source_games
        ):
            raise CoordinatorContractError(
                "provider slate season does not match the configured live season"
            )

        sorted_games = tuple(
            sorted(
                source_games,
                key=lambda game: (
                    self._provider_tipoff(game),
                    self._provider_game_id(game),
                ),
            )
        )
        observed_statuses = {
            self._provider_game_id(game): self._provider_status(game)
            for game in sorted_games
        }
        expected_game_ids = [
            self._provider_game_id(game)
            for game in sorted_games
            if observed_statuses[self._provider_game_id(game)]
            not in {"postponed", "cancelled"}
        ]
        expected_game_id_set = set(expected_game_ids)

        # Once settlement begins, the persisted next date is part of every
        # immutable game boundary. Corrections reuse it instead of consulting
        # a future schedule that may have changed since the original payout.
        with self._database.market_write_transaction(
            settlement_exclusive=True
        ) as session:
            self._assert_fence(session, fence)
            ruleset = self._bound_active_ruleset(session, for_update=True)
            slate_key = {
                "ruleset_id": ruleset.id,
                "provider": self._provider,
                "game_date": game_date,
            }
            persisted_slate = session.get(PerGameLiveSlateRow, slate_key)
            if persisted_slate is None and not sorted_games:
                raise RetryableSettlementProviderError(
                    "provider returned an empty uncorroborated slate"
                )
            if (
                persisted_slate is None
                and ruleset.next_game_date is not None
                and game_date != ruleset.next_game_date
            ):
                raise CoordinatorContractError(
                    "a new provider slate must match the ruleset next game date"
                )
            persisted_next_game_date = (
                persisted_slate.next_game_date if persisted_slate is not None else None
            )
            persisted_next_game_date_resolved = bool(
                persisted_slate is not None and persisted_slate.next_game_date_resolved
            )
            reuse_frozen_next_game_date = bool(
                persisted_slate is not None
                and persisted_slate.next_game_date_resolved
                and (
                    persisted_slate.lock_succeeded
                    or persisted_slate.completion_next_event_sequence is not None
                    or persisted_slate.completion_succeeded
                    or persisted_slate.unlock_succeeded
                )
            )
            lock_succeeded = bool(
                persisted_slate is not None
                and persisted_slate.lock_succeeded
                and ruleset.roster_mutations_locked
                and ruleset.roster_lock_game_date == game_date
            )

        next_resolution_error: Exception | None = None
        if reuse_frozen_next_game_date:
            resolved_next_game_date = persisted_next_game_date
            next_game_date_resolved = True
        elif not lock_succeeded:
            # Persist the current slate and tipoffs before consulting another
            # network endpoint. The coordinator acquires any due roster lock,
            # then calls prepare_slate again to resolve the future boundary.
            resolved_next_game_date = persisted_next_game_date
            next_game_date_resolved = persisted_next_game_date_resolved
        else:
            try:
                resolved_next_game_date = self._next_game_date_resolver(game_date)
            except Exception as exc:
                next_resolution_error = exc
                resolved_next_game_date = persisted_next_game_date
                next_game_date_resolved = persisted_next_game_date_resolved
            else:
                if resolved_next_game_date is not None and (
                    type(resolved_next_game_date) is not date
                    or resolved_next_game_date <= game_date
                ):
                    next_resolution_error = CoordinatorContractError(
                        "the resolved next game date must be later than the slate date"
                    )
                    resolved_next_game_date = persisted_next_game_date
                    next_game_date_resolved = persisted_next_game_date_resolved
                else:
                    next_game_date_resolved = True

        with self._database.market_write_transaction(
            settlement_exclusive=True
        ) as session:
            self._assert_fence(session, fence)
            ruleset = self._bound_active_ruleset(session, for_update=True)
            slate_key = {
                "ruleset_id": ruleset.id,
                "provider": self._provider,
                "game_date": game_date,
            }
            slate_row = session.get(PerGameLiveSlateRow, slate_key)
            if slate_row is None:
                if not sorted_games:
                    raise RetryableSettlementProviderError(
                        "provider returned an empty uncorroborated slate"
                    )
                slate_row = PerGameLiveSlateRow(
                    **slate_key,
                    next_game_date=resolved_next_game_date,
                    next_game_date_resolved=next_game_date_resolved,
                    schedule_complete=schedule_complete,
                    expected_game_ids=expected_game_ids,
                    manifest_fingerprint="",
                    lock_succeeded=False,
                    completion_succeeded=False,
                    completion_next_event_sequence=None,
                    unlock_succeeded=False,
                )
                session.add(slate_row)
                resolving_next_game_date = False
            else:
                if next_resolution_error is not None:
                    resolved_next_game_date = slate_row.next_game_date
                    next_game_date_resolved = slate_row.next_game_date_resolved
                resolving_next_game_date = bool(
                    not slate_row.next_game_date_resolved and next_game_date_resolved
                )
                persisted_ids = tuple(
                    str(value) for value in slate_row.expected_game_ids
                )
                if (
                    slate_row.next_game_date != resolved_next_game_date
                    or resolving_next_game_date
                ):
                    self._assert_slate_boundary_revisable(
                        session,
                        ruleset_id=ruleset.id,
                        slate_row=slate_row,
                        provider_game_ids=set(persisted_ids).union(expected_game_ids),
                        resolving_next_game_date=resolving_next_game_date,
                    )
                if slate_row.schedule_complete and not schedule_complete:
                    raise CoordinatorContractError(
                        "a complete provider slate cannot become incomplete"
                    )
                self._reconcile_slate_manifest(
                    session,
                    ruleset_id=ruleset.id,
                    slate_row=slate_row,
                    persisted_ids=persisted_ids,
                    expected_ids=tuple(expected_game_ids),
                    observed_at=self._observed_at(),
                    observed_statuses=observed_statuses,
                )
                slate_row.next_game_date = resolved_next_game_date
                slate_row.next_game_date_resolved = next_game_date_resolved
                slate_row.schedule_complete = (
                    slate_row.schedule_complete or schedule_complete
                )
                slate_row.expected_game_ids = expected_game_ids
                slate_row.updated_at = utcnow()

            slate_row.manifest_fingerprint = self._fingerprint(
                {
                    "provider": self._provider,
                    "game_date": game_date.isoformat(),
                    "next_game_date": (
                        resolved_next_game_date.isoformat()
                        if resolved_next_game_date is not None
                        else None
                    ),
                    "next_game_date_resolved": next_game_date_resolved,
                    "schedule_complete": slate_row.schedule_complete,
                    "expected_game_ids": expected_game_ids,
                }
            )

            max_sequence = session.scalar(
                select(func.max(PerGameLiveGameRow.event_sequence)).where(
                    PerGameLiveGameRow.ruleset_id == ruleset.id
                )
            )
            next_sequence = max(
                ruleset.current_sequence,
                (int(max_sequence) + 1) if max_sequence is not None else 0,
            )
            prepared_games: list[PreparedGame] = []
            for source_game in sorted_games:
                provider_game_id = self._provider_game_id(source_game)
                game_key = {
                    "ruleset_id": ruleset.id,
                    "provider": self._provider,
                    "provider_game_id": provider_game_id,
                }
                row = session.get(PerGameLiveGameRow, game_key)
                if row is None:
                    row = self._new_game_row(
                        ruleset_id=ruleset.id,
                        source_game=source_game,
                        next_game_date=resolved_next_game_date,
                        event_sequence=next_sequence,
                    )
                    next_sequence += 1
                    session.add(row)
                    session.flush([row])
                else:
                    boundary_frozen = self._game_boundary_frozen(
                        session,
                        ruleset_id=ruleset.id,
                        row=row,
                    )
                    rescheduled = row.game_date != game_date
                    self._update_game_row(
                        row,
                        source_game=source_game,
                        next_game_date=resolved_next_game_date,
                        boundary_frozen=boundary_frozen,
                        allow_next_game_date_resolution=resolving_next_game_date,
                    )
                    if rescheduled:
                        row.event_sequence = next_sequence
                        next_sequence += 1
                        row.updated_at = utcnow()
                if provider_game_id not in expected_game_id_set:
                    continue
                prepared_games.append(
                    PreparedGame(
                        provider_game=source_game,
                        boundary=self._boundary_from_row(row),
                    )
                )
            session.flush()
            requires_lock = self._requires_lock(
                session,
                ruleset_id=ruleset.id,
                games=prepared_games,
            )
            prepared_slate = PreparedSlate(
                game_date=game_date,
                games=tuple(prepared_games),
                schedule_complete=(
                    slate_row.schedule_complete and slate_row.next_game_date_resolved
                ),
                requires_lock=requires_lock,
            )

        if next_resolution_error is not None:
            raise next_resolution_error
        return prepared_slate

    def requires_roster_lock(
        self,
        game_date: date,
        observed_at: datetime,
        fence: LeaseFence,
    ) -> bool:
        if type(game_date) is not date:
            raise CoordinatorContractError("game_date must be an exact date")
        if (
            not isinstance(observed_at, datetime)
            or observed_at.tzinfo is None
            or observed_at.utcoffset() is None
        ):
            raise CoordinatorContractError("observed_at must be timezone-aware")
        observed_at = observed_at.astimezone(UTC)

        with self._database.market_write_transaction(
            settlement_exclusive=True
        ) as session:
            self._assert_fence(session, fence)
            ruleset = self._bound_active_ruleset(session, for_update=True)
            slate_row = session.get(
                PerGameLiveSlateRow,
                {
                    "ruleset_id": ruleset.id,
                    "provider": self._provider,
                    "game_date": game_date,
                },
            )
            if slate_row is None or slate_row.unlock_succeeded:
                return False
            if self._persisted_unlock_already_committed(
                session,
                ruleset=ruleset,
                slate_row=slate_row,
            ):
                return False
            if (
                ruleset.roster_mutations_locked
                and ruleset.roster_lock_game_date == game_date
            ):
                return True
            expected_game_ids = tuple(
                str(value) for value in slate_row.expected_game_ids
            )
            if not expected_game_ids:
                return (
                    slate_row.schedule_complete and not slate_row.completion_succeeded
                )
            games = tuple(
                session.scalars(
                    select(PerGameLiveGameRow).where(
                        PerGameLiveGameRow.ruleset_id == ruleset.id,
                        PerGameLiveGameRow.provider == self._provider,
                        PerGameLiveGameRow.provider_game_id.in_(expected_game_ids),
                    )
                )
            )
            for game in games:
                if game.status in {"in_progress", "final"}:
                    return True
                if game.status == "scheduled" and (
                    self._aware_db_datetime(game.started_at) <= observed_at
                ):
                    return True
            return False

    def dispatch_roster_lock(
        self, command: RosterLockCommand, fence: LeaseFence
    ) -> CommandDispatch:
        with self._database.market_write_transaction(
            settlement_exclusive=True
        ) as session:
            self._assert_fence(session, fence)
            ruleset = self._bound_active_ruleset(session, for_update=True)
            ruleset_id = ruleset.id
            slate_row = session.get(
                PerGameLiveSlateRow,
                {
                    "ruleset_id": ruleset_id,
                    "provider": self._provider,
                    "game_date": command.game_date,
                },
            )
            if slate_row is None:
                raise CoordinatorContractError(
                    "a roster command requires a prepared provider slate"
                )
            if command.locked and slate_row.unlock_succeeded:
                return CommandDispatch.permanent_failure("slate_already_unlocked")
            if not command.locked:
                if self._persisted_unlock_already_committed(
                    session,
                    ruleset=ruleset,
                    slate_row=slate_row,
                ):
                    slate_row.unlock_succeeded = True
                    slate_row.updated_at = utcnow()
                    return CommandDispatch.success()
                if not self._persisted_slate_can_complete(
                    session,
                    ruleset=ruleset,
                    slate_row=slate_row,
                ):
                    return CommandDispatch.retryable_failure(
                        "unlock_preconditions_not_met"
                    )
                if not slate_row.completion_succeeded:
                    return CommandDispatch.retryable_failure("date_completion_required")

        try:
            self._target.set_roster_lock(
                command,
                write_guard=self._write_guard(
                    fence,
                    expected_ruleset_id=ruleset_id,
                ),
            )
        except StaleSettlementFenceError:
            raise
        except Exception as exc:
            return self._dispatch_failure(exc)

        with self._database.market_write_transaction(
            settlement_exclusive=True
        ) as session:
            self._assert_fence(session, fence)
            slate_row = session.get(
                PerGameLiveSlateRow,
                {
                    "ruleset_id": ruleset_id,
                    "provider": self._provider,
                    "game_date": command.game_date,
                },
            )
            if slate_row is None:
                raise CoordinatorContractError(
                    "a roster command requires a prepared provider slate"
                )
            if command.locked:
                slate_row.lock_succeeded = True
                slate_row.unlock_succeeded = False
            else:
                slate_row.unlock_succeeded = True
            slate_row.updated_at = utcnow()
        return CommandDispatch.success()

    def prepare_player_settlement(
        self,
        game: PreparedGame,
        result: object,
        fence: LeaseFence,
    ) -> PlayerPreparation:
        provider_game_id = self._provider_game_id(result)
        provider_player_id = self._provider_player_id(result)
        result_fingerprint = getattr(result, "scoring_fingerprint", None)
        if not isinstance(result_fingerprint, str) or len(result_fingerprint) != 64:
            raise CoordinatorContractError("result fingerprint must be a sha256 digest")
        if provider_game_id != game.boundary.provider_game_id:
            raise CoordinatorContractError(
                "result game identity changed before staging"
            )
        actual_net_points_micros = self._net_points_micros(
            self._actual_net_points(result)
        )
        actual_net_points = actual_net_points_micros / 1_000_000
        player_name = self._provider_player_name(result)

        with self._database.market_write_transaction(
            settlement_exclusive=True
        ) as session:
            self._assert_fence(session, fence)
            ruleset = self._bound_active_ruleset(session, for_update=True)
            live_game = session.get(
                PerGameLiveGameRow,
                {
                    "ruleset_id": ruleset.id,
                    "provider": self._provider,
                    "provider_game_id": provider_game_id,
                },
            )
            if live_game is None or self._boundary_from_row(live_game) != game.boundary:
                raise CoordinatorContractError(
                    "settlement result has no matching durable game boundary"
                )
            ignored_player_ids = {str(value) for value in live_game.ignored_player_ids}
            if provider_player_id in ignored_player_ids:
                return PlayerPreparation.unchanged()
            resolution, player_id = self._resolve_player(
                session,
                ruleset_id=ruleset.id,
                provider_player_id=provider_player_id,
                player_name=player_name,
            )
            if resolution == "ignore":
                ignored_player_ids.add(provider_player_id)
                live_game.ignored_player_ids = sorted(ignored_player_ids)
                live_game.updated_at = utcnow()
                session.flush([live_game])
                return PlayerPreparation.unchanged()
            if resolution == "unresolved" or player_id is None:
                return PlayerPreparation.unresolved("unmapped_player")

            rows = list(
                session.scalars(
                    select(PerGameLiveResultCommandRow)
                    .where(
                        PerGameLiveResultCommandRow.ruleset_id == ruleset.id,
                        PerGameLiveResultCommandRow.provider == self._provider,
                        PerGameLiveResultCommandRow.provider_game_id
                        == provider_game_id,
                        PerGameLiveResultCommandRow.provider_player_id
                        == provider_player_id,
                    )
                    .order_by(PerGameLiveResultCommandRow.revision)
                    .with_for_update()
                )
            )
            latest = rows[-1] if rows else None
            if (
                latest is None
                or latest.result_fingerprint != result_fingerprint
                or latest.actual_net_points_micros != actual_net_points_micros
            ):
                previous_revision = latest.revision if latest is not None else None
                staged = PlayerSettlementCommand(
                    boundary=game.boundary,
                    provider_player_id=provider_player_id,
                    player_id=player_id,
                    result_fingerprint=result_fingerprint,
                    previous_revision=previous_revision,
                    actual_net_points=actual_net_points,
                )
                row = PerGameLiveResultCommandRow(
                    ruleset_id=ruleset.id,
                    provider=self._provider,
                    provider_game_id=provider_game_id,
                    provider_player_id=provider_player_id,
                    revision=staged.result_revision,
                    game_id=game.boundary.game_id,
                    player_id=player_id,
                    result_fingerprint=result_fingerprint,
                    actual_net_points_micros=actual_net_points_micros,
                    idempotency_key=staged.idempotency_key,
                    request_payload=self._json_payload(staged.payload),
                    status="pending",
                    error_code=None,
                    attempt_count=0,
                )
                session.add(row)
                session.flush([row])
                rows.append(row)

            for row in rows:
                if row.status == "succeeded":
                    continue
                if row.status == "permanent_failure":
                    return PlayerPreparation.unresolved(
                        row.error_code or "permanent_delivery_failure"
                    )
                return PlayerPreparation.ready(self._command_from_row(live_game, row))
            return PlayerPreparation.unchanged()

    def dispatch_player_settlement(
        self, command: PlayerSettlementCommand, fence: LeaseFence
    ) -> CommandDispatch:
        with self._database.market_write_transaction(
            settlement_exclusive=True
        ) as session:
            self._assert_fence(session, fence)
            ruleset = self._bound_active_ruleset(session, for_update=True)
            ruleset_id = ruleset.id
            row_key = self._command_row_key(ruleset_id, command)
            row = session.get(PerGameLiveResultCommandRow, row_key)
            if row is None:
                raise CoordinatorContractError(
                    "settlement command was not durably staged"
                )
            self._assert_stored_command(row, command)
            if row.status == "succeeded":
                return CommandDispatch.success()
            if row.status == "permanent_failure":
                return CommandDispatch.permanent_failure(
                    row.error_code or "permanent_delivery_failure"
                )
            row.attempt_count += 1
            row.error_code = None
            row.updated_at = utcnow()

        try:
            self._target.settle_player(
                command,
                write_guard=self._write_guard(
                    fence,
                    expected_ruleset_id=ruleset_id,
                ),
            )
        except StaleSettlementFenceError:
            raise
        except Exception as exc:
            outcome = self._dispatch_failure(exc)
            self._record_delivery_outcome(row_key, outcome, fence)
            return outcome

        outcome = CommandDispatch.success()
        self._record_delivery_outcome(row_key, outcome, fence)
        return outcome

    def dispatch_date_completion(
        self, slate: PreparedSlate, fence: LeaseFence
    ) -> CommandDispatch:
        with self._database.market_write_transaction(
            settlement_exclusive=True
        ) as session:
            self._assert_fence(session, fence)
            ruleset = self._bound_active_ruleset(session, for_update=True)
            ruleset_id = ruleset.id
            slate_row = session.get(
                PerGameLiveSlateRow,
                {
                    "ruleset_id": ruleset_id,
                    "provider": self._provider,
                    "game_date": slate.game_date,
                },
            )
            if slate_row is None:
                raise CoordinatorContractError(
                    "date completion requires a prepared provider slate"
                )
            prepared_ids = tuple(game.boundary.provider_game_id for game in slate.games)
            if tuple(slate_row.expected_game_ids) != prepared_ids:
                return CommandDispatch.retryable_failure(
                    "date_completion_manifest_mismatch"
                )
            if slate_row.completion_succeeded:
                return CommandDispatch.success()
            if not self._persisted_slate_can_complete(
                session,
                ruleset=ruleset,
                slate_row=slate_row,
            ):
                return CommandDispatch.retryable_failure(
                    "date_completion_preconditions_not_met"
                )
            if slate_row.completion_next_event_sequence is None:
                max_date_sequence = session.scalar(
                    select(func.max(PerGameLiveGameRow.event_sequence)).where(
                        PerGameLiveGameRow.ruleset_id == ruleset_id,
                        PerGameLiveGameRow.provider == self._provider,
                        PerGameLiveGameRow.game_date == slate.game_date,
                    )
                )
                slate_row.completion_next_event_sequence = max(
                    ruleset.current_sequence,
                    (
                        int(max_date_sequence) + 1
                        if max_date_sequence is not None
                        else ruleset.current_sequence
                    ),
                )
                slate_row.updated_at = utcnow()
                session.flush([slate_row])
            next_event_sequence = slate_row.completion_next_event_sequence
            if next_event_sequence is None:
                raise CoordinatorContractError(
                    "date completion did not persist its event sequence"
                )
            command = DateCompletionCommand(
                game_date=slate.game_date,
                next_game_date=slate_row.next_game_date,
                next_event_sequence=next_event_sequence,
            )

        try:
            self._target.complete_date(
                command,
                write_guard=self._write_guard(
                    fence,
                    expected_ruleset_id=ruleset_id,
                ),
            )
        except StaleSettlementFenceError:
            raise
        except Exception as exc:
            return self._dispatch_failure(exc)

        with self._database.market_write_transaction(
            settlement_exclusive=True
        ) as session:
            self._assert_fence(session, fence)
            ruleset = self._bound_active_ruleset(session, for_update=True)
            if ruleset.id != ruleset_id:
                raise StaleSettlementFenceError(
                    "the active per-game ruleset changed after date completion"
                )
            slate_row = session.get(
                PerGameLiveSlateRow,
                {
                    "ruleset_id": ruleset_id,
                    "provider": self._provider,
                    "game_date": command.game_date,
                },
            )
            if slate_row is None:
                raise CoordinatorContractError(
                    "date completion lost its prepared provider slate"
                )
            if slate_row.next_game_date != command.next_game_date:
                raise CoordinatorContractError(
                    "date completion changed its authoritative next game date"
                )
            if slate_row.completion_next_event_sequence != command.next_event_sequence:
                raise CoordinatorContractError(
                    "date completion changed its persisted event sequence"
                )
            slate_row.completion_succeeded = True
            slate_row.updated_at = utcnow()
        return CommandDispatch.success()

    def can_unlock(self, slate: PreparedSlate, fence: LeaseFence) -> bool:
        with self._database.market_write_transaction(
            settlement_exclusive=True
        ) as session:
            self._assert_fence(session, fence)
            ruleset = self._bound_active_ruleset(session, for_update=True)
            slate_row = session.get(
                PerGameLiveSlateRow,
                {
                    "ruleset_id": ruleset.id,
                    "provider": self._provider,
                    "game_date": slate.game_date,
                },
            )
            if slate_row is None:
                return False
            prepared_ids = tuple(game.boundary.provider_game_id for game in slate.games)
            if tuple(slate_row.expected_game_ids) != prepared_ids:
                return False
            return self._persisted_slate_can_complete(
                session,
                ruleset=ruleset,
                slate_row=slate_row,
            ) or self._persisted_unlock_already_committed(
                session,
                ruleset=ruleset,
                slate_row=slate_row,
            )

    def _new_game_row(
        self,
        *,
        ruleset_id: str,
        source_game: object,
        next_game_date: date | None,
        event_sequence: int,
    ) -> PerGameLiveGameRow:
        provider_game_id = self._provider_game_id(source_game)
        status = self._provider_status(source_game)
        expected_player_ids = self._expected_player_ids(source_game)
        if status == "final" and not expected_player_ids:
            raise CoordinatorContractError("a final game must list expected players")
        return PerGameLiveGameRow(
            ruleset_id=ruleset_id,
            provider=self._provider,
            provider_game_id=provider_game_id,
            game_id=f"{self._provider}:{provider_game_id}",
            season_id=self._required_text(source_game, "season_id", max_length=32),
            game_date=getattr(source_game, "game_date"),
            started_at=self._db_datetime(self._provider_tipoff(source_game)),
            next_game_date=next_game_date,
            event_sequence=event_sequence,
            status=status,
            home_team_id=self._required_text(
                source_game, "home_team_id", max_length=32
            ),
            away_team_id=self._required_text(
                source_game, "away_team_id", max_length=32
            ),
            expected_player_ids=list(expected_player_ids),
            ignored_player_ids=[],
            schedule_history=[],
            source_fingerprint=self._source_fingerprint(source_game),
        )

    def _update_game_row(
        self,
        row: PerGameLiveGameRow,
        *,
        source_game: object,
        next_game_date: date | None,
        boundary_frozen: bool,
        allow_next_game_date_resolution: bool,
    ) -> None:
        immutable = {
            "season_id": self._required_text(source_game, "season_id", max_length=32),
            "home_team_id": self._required_text(
                source_game, "home_team_id", max_length=32
            ),
            "away_team_id": self._required_text(
                source_game, "away_team_id", max_length=32
            ),
        }
        for field, value in immutable.items():
            if getattr(row, field) != value:
                raise CoordinatorContractError(
                    f"provider game changed its stable {field} boundary"
                )
        observed_started_at = self._db_datetime(self._provider_tipoff(source_game))
        if not self._provider_tipoff_known(source_game):
            observed_started_at = row.started_at
        revisable = {
            "game_date": getattr(source_game, "game_date", None),
            "started_at": observed_started_at,
            "next_game_date": next_game_date,
        }
        changed_boundaries = [
            field for field, value in revisable.items() if getattr(row, field) != value
        ]
        if changed_boundaries:
            resolving_only_next_date = bool(
                allow_next_game_date_resolution
                and changed_boundaries == ["next_game_date"]
                and row.next_game_date is None
            )
            if boundary_frozen and not resolving_only_next_date:
                raise CoordinatorContractError(
                    "provider game changed its frozen "
                    f"{changed_boundaries[0]} boundary"
                )
            if not resolving_only_next_date:
                history = list(row.schedule_history)
                if len(history) >= 32:
                    raise CoordinatorContractError(
                        "provider game exceeded the schedule revision limit"
                    )
                history.append(
                    {
                        "game_date": row.game_date.isoformat(),
                        "started_at": self._aware_db_datetime(
                            row.started_at
                        ).isoformat(),
                        "next_game_date": (
                            row.next_game_date.isoformat()
                            if row.next_game_date is not None
                            else None
                        ),
                        "event_sequence": row.event_sequence,
                        "status": row.status,
                        "source_fingerprint": row.source_fingerprint,
                    }
                )
                row.schedule_history = history
        for field, value in revisable.items():
            if getattr(row, field) == value:
                continue
            setattr(row, field, value)
        status = self._provider_status(source_game)
        if status not in _ALLOWED_STATUS_TRANSITIONS.get(row.status, frozenset()):
            raise CoordinatorContractError(
                f"provider game status regressed from {row.status} to {status}"
            )
        expected_player_ids = self._expected_player_ids(source_game)
        persisted_players = tuple(str(value) for value in row.expected_player_ids)
        if (
            boundary_frozen
            and persisted_players
            and expected_player_ids != persisted_players
        ):
            raise CoordinatorContractError(
                "a final provider game cannot change its expected-player manifest"
            )
        if status == "final" and not expected_player_ids:
            raise CoordinatorContractError("a final game must list expected players")
        row.status = status
        row.expected_player_ids = list(expected_player_ids)
        row.ignored_player_ids = [
            str(provider_player_id)
            for provider_player_id in row.ignored_player_ids
            if str(provider_player_id) in expected_player_ids
        ]
        row.source_fingerprint = self._source_fingerprint(source_game)
        row.updated_at = utcnow()

    def _reconcile_slate_manifest(
        self,
        session: Session,
        *,
        ruleset_id: str,
        slate_row: PerGameLiveSlateRow,
        persisted_ids: tuple[str, ...],
        expected_ids: tuple[str, ...],
        observed_at: datetime,
        observed_statuses: dict[str, str],
    ) -> None:
        if persisted_ids == expected_ids:
            return
        persisted_set = set(persisted_ids)
        expected_set = set(expected_ids)
        if persisted_set == expected_set:
            return
        manifest_additions_frozen = bool(
            slate_row.completion_next_event_sequence is not None
            or slate_row.completion_succeeded
            or slate_row.unlock_succeeded
        )
        if manifest_additions_frozen and expected_set.difference(persisted_set):
            raise CoordinatorContractError(
                "a completed provider slate cannot add games"
            )
        for provider_game_id in sorted(persisted_set.difference(expected_set)):
            row = session.get(
                PerGameLiveGameRow,
                {
                    "ruleset_id": ruleset_id,
                    "provider": self._provider,
                    "provider_game_id": provider_game_id,
                },
            )
            if row is None:
                raise CoordinatorContractError(
                    "a persisted provider manifest is missing its durable game"
                )
            observed_status = observed_statuses.get(provider_game_id)
            explicitly_terminal = observed_status in {"postponed", "cancelled"}
            if slate_row.unlock_succeeded and not explicitly_terminal:
                raise CoordinatorContractError(
                    "an unlocked provider slate cannot change its game manifest"
                )
            effective_status = observed_status or row.status
            if effective_status not in _REMOVABLE_MANIFEST_STATUSES:
                raise CoordinatorContractError(
                    f"provider cannot remove {effective_status} game {provider_game_id}"
                )
            if (
                row.status == "scheduled"
                and self._aware_db_datetime(row.started_at) <= observed_at
                and not explicitly_terminal
            ):
                raise CoordinatorContractError(
                    "provider cannot remove a scheduled game at or after tipoff"
                )
            if self._game_has_result_commands(
                session,
                ruleset_id=ruleset_id,
                provider_game_id=provider_game_id,
            ):
                raise CoordinatorContractError(
                    "provider cannot remove a game with durable result commands"
                )
            if slate_row.lock_succeeded and not explicitly_terminal:
                raise CoordinatorContractError(
                    "a locked provider slate cannot remove a game without an "
                    "explicit postponed or cancelled status"
                )

    def _assert_slate_boundary_revisable(
        self,
        session: Session,
        *,
        ruleset_id: str,
        slate_row: PerGameLiveSlateRow,
        provider_game_ids: set[str],
        resolving_next_game_date: bool,
    ) -> None:
        if (
            slate_row.unlock_succeeded
            or slate_row.completion_succeeded
            or slate_row.completion_next_event_sequence is not None
            or (slate_row.lock_succeeded and not resolving_next_game_date)
        ):
            raise CoordinatorContractError(
                "a locked provider slate cannot change its next game date"
            )
        if resolving_next_game_date and slate_row.next_game_date_resolved:
            raise CoordinatorContractError(
                "a resolved provider slate cannot resolve its next date again"
            )
        for provider_game_id in provider_game_ids:
            if self._game_has_result_commands(
                session,
                ruleset_id=ruleset_id,
                provider_game_id=provider_game_id,
            ):
                raise CoordinatorContractError(
                    "a provider slate with durable results cannot change its next date"
                )

    def _game_boundary_frozen(
        self,
        session: Session,
        *,
        ruleset_id: str,
        row: PerGameLiveGameRow,
    ) -> bool:
        if self._game_has_result_commands(
            session,
            ruleset_id=ruleset_id,
            provider_game_id=row.provider_game_id,
        ):
            return True
        slate = session.get(
            PerGameLiveSlateRow,
            {
                "ruleset_id": ruleset_id,
                "provider": self._provider,
                "game_date": row.game_date,
            },
        )
        if slate is None:
            return False
        included = row.provider_game_id in {
            str(value) for value in slate.expected_game_ids
        }
        if included:
            return bool(slate.lock_succeeded or slate.unlock_succeeded)
        return bool(slate.lock_succeeded and not slate.unlock_succeeded)

    def _game_has_result_commands(
        self,
        session: Session,
        *,
        ruleset_id: str,
        provider_game_id: str,
    ) -> bool:
        count = session.scalar(
            select(func.count())
            .select_from(PerGameLiveResultCommandRow)
            .where(
                PerGameLiveResultCommandRow.ruleset_id == ruleset_id,
                PerGameLiveResultCommandRow.provider == self._provider,
                PerGameLiveResultCommandRow.provider_game_id == provider_game_id,
            )
        )
        return bool(count)

    def _observed_at(self) -> datetime:
        observed_at = self._clock()
        if (
            not isinstance(observed_at, datetime)
            or observed_at.tzinfo is None
            or observed_at.utcoffset() is None
        ):
            raise CoordinatorContractError(
                "live settlement clock must return a timezone-aware datetime"
            )
        return observed_at.astimezone(UTC)

    def _resolve_player(
        self,
        session: Session,
        *,
        ruleset_id: str,
        provider_player_id: str,
        player_name: str,
    ) -> tuple[str, str | None]:
        mapping = session.get(
            PerGameProviderPlayerMapRow,
            {
                "provider": self._provider,
                "provider_player_id": provider_player_id,
            },
        )
        if mapping is not None:
            listing = session.get(PlayerListingRow, mapping.player_id)
            if listing is None or self._normalize_name(
                listing.name
            ) != self._normalize_name(player_name):
                return "unresolved", None
            quote = session.get(
                PerGameQuoteRow,
                {"ruleset_id": ruleset_id, "player_id": mapping.player_id},
            )
            if quote is None:
                return "unresolved", None
            return "settle", mapping.player_id

        normalized = self._normalize_name(player_name)
        candidates = [
            row
            for row in session.scalars(select(PlayerListingRow))
            if self._normalize_name(row.name) == normalized
        ]
        if not candidates:
            return "ignore", None
        if len(candidates) != 1:
            return "unresolved", None
        candidate = candidates[0]
        quote = session.get(
            PerGameQuoteRow,
            {"ruleset_id": ruleset_id, "player_id": candidate.id},
        )
        session.add(
            PerGameProviderPlayerMapRow(
                provider=self._provider,
                provider_player_id=provider_player_id,
                player_id=candidate.id,
                player_name=player_name,
            )
        )
        session.flush()
        if quote is None:
            return "unresolved", None
        return "settle", candidate.id

    def _requires_lock(
        self,
        session: Session,
        *,
        ruleset_id: str,
        games: list[PreparedGame],
    ) -> bool:
        for prepared in games:
            status = self._provider_status(prepared.provider_game)
            if status == "in_progress":
                return True
            if status != "final":
                continue
            persisted = session.get(
                PerGameLiveGameRow,
                {
                    "ruleset_id": ruleset_id,
                    "provider": self._provider,
                    "provider_game_id": prepared.boundary.provider_game_id,
                },
            )
            if persisted is None:
                return True
            expected_player_ids = set(self._expected_player_ids(prepared.provider_game))
            ignored_player_ids = {str(value) for value in persisted.ignored_player_ids}
            if not ignored_player_ids.issubset(expected_player_ids):
                return True
            for provider_player_id in sorted(
                expected_player_ids.difference(ignored_player_ids)
            ):
                base = session.get(
                    PerGameLiveResultCommandRow,
                    {
                        "ruleset_id": ruleset_id,
                        "provider": self._provider,
                        "provider_game_id": prepared.boundary.provider_game_id,
                        "provider_player_id": provider_player_id,
                        "revision": 1,
                    },
                )
                if base is None or base.status != "succeeded":
                    return True
        return False

    def _record_delivery_outcome(
        self,
        row_key: dict[str, object],
        outcome: CommandDispatch,
        fence: LeaseFence,
    ) -> None:
        with self._database.market_write_transaction(
            settlement_exclusive=True
        ) as session:
            self._assert_fence(session, fence)
            row = session.get(PerGameLiveResultCommandRow, row_key)
            if row is None:
                raise CoordinatorContractError(
                    "durable settlement command disappeared during delivery"
                )
            if outcome.succeeded:
                row.status = "succeeded"
                row.error_code = None
            elif outcome.status.value == "permanent_failure":
                row.status = "permanent_failure"
                row.error_code = outcome.error_code
            else:
                row.status = "pending"
                row.error_code = outcome.error_code
            row.updated_at = utcnow()

    def _write_guard(
        self,
        fence: LeaseFence,
        *,
        expected_ruleset_id: str,
    ) -> Callable[[Session], None]:
        def guard(session: Session) -> None:
            self._assert_fence(session, fence)
            ruleset = self._bound_active_ruleset(session, for_update=True)
            if ruleset.id != expected_ruleset_id:
                raise StaleSettlementFenceError(
                    "the active per-game ruleset changed before delivery"
                )

        return guard

    def _persisted_slate_can_complete(
        self,
        session: Session,
        *,
        ruleset: PerGameRulesetRow,
        slate_row: PerGameLiveSlateRow,
    ) -> bool:
        if not self._persisted_slate_results_complete(
            session,
            ruleset=ruleset,
            slate_row=slate_row,
        ):
            return False
        return (
            ruleset.roster_mutations_locked
            and ruleset.roster_lock_game_date == slate_row.game_date
        )

    def _persisted_unlock_already_committed(
        self,
        session: Session,
        *,
        ruleset: PerGameRulesetRow,
        slate_row: PerGameLiveSlateRow,
    ) -> bool:
        if (
            not slate_row.completion_succeeded
            or not self._persisted_slate_results_complete(
                session,
                ruleset=ruleset,
                slate_row=slate_row,
            )
        ):
            return False
        last_lock_date = ruleset.last_roster_lock_game_date
        if last_lock_date is None or last_lock_date < slate_row.game_date:
            return False
        if last_lock_date == slate_row.game_date:
            return (
                not ruleset.roster_mutations_locked
                and ruleset.roster_lock_game_date is None
            )
        return (
            ruleset.roster_mutations_locked
            and ruleset.roster_lock_game_date == last_lock_date
        ) or (
            not ruleset.roster_mutations_locked
            and ruleset.roster_lock_game_date is None
        )

    def _persisted_slate_results_complete(
        self,
        session: Session,
        *,
        ruleset: PerGameRulesetRow,
        slate_row: PerGameLiveSlateRow,
    ) -> bool:
        if (
            not slate_row.schedule_complete
            or not slate_row.next_game_date_resolved
            or not slate_row.lock_succeeded
            or slate_row.unlock_succeeded
        ):
            return False
        expected_game_ids = tuple(str(value) for value in slate_row.expected_game_ids)
        if expected_game_ids:
            games = list(
                session.scalars(
                    select(PerGameLiveGameRow).where(
                        PerGameLiveGameRow.ruleset_id == ruleset.id,
                        PerGameLiveGameRow.provider == self._provider,
                        PerGameLiveGameRow.provider_game_id.in_(expected_game_ids),
                    )
                )
            )
        else:
            games = []
        if {row.provider_game_id for row in games} != set(expected_game_ids):
            return False
        for game in games:
            if game.status not in _TERMINAL_STATUSES:
                return False
            if game.status != "final":
                continue
            expected_players = tuple(str(value) for value in game.expected_player_ids)
            if not expected_players:
                return False
            expected_player_set = set(expected_players)
            ignored_players = {str(value) for value in game.ignored_player_ids}
            if not ignored_players.issubset(expected_player_set):
                return False
            classified_players = set(ignored_players)
            for provider_player_id in expected_player_set.difference(ignored_players):
                base = session.get(
                    PerGameLiveResultCommandRow,
                    {
                        "ruleset_id": ruleset.id,
                        "provider": self._provider,
                        "provider_game_id": game.provider_game_id,
                        "provider_player_id": provider_player_id,
                        "revision": 1,
                    },
                )
                if base is None or base.status != "succeeded":
                    return False
                classified_players.add(provider_player_id)
            if classified_players != expected_player_set:
                return False
        return True

    def _assert_fence(self, session: Session, fence: LeaseFence) -> None:
        owner_id = getattr(fence, "owner_id", None)
        token = getattr(fence, "fencing_token", None)
        if (
            not isinstance(owner_id, str)
            or not owner_id.strip()
            or isinstance(token, bool)
            or not isinstance(token, int)
            or token < 0
        ):
            raise StaleSettlementFenceError("settlement lease identity is invalid")
        accepted = self._fence_validator(session, fence)
        if accepted is not True:
            raise StaleSettlementFenceError("settlement lease is stale")

    def _bound_active_ruleset(
        self,
        session: Session,
        *,
        for_update: bool,
    ) -> PerGameRulesetRow:
        query = select(PerGameRulesetRow).where(
            PerGameRulesetRow.id == self._expected_ruleset_id,
            PerGameRulesetRow.is_active.is_(True),
        )
        if for_update:
            query = query.with_for_update()
        ruleset = session.scalar(query)
        if ruleset is None:
            raise CoordinatorContractError("the configured live ruleset is not active")
        if ruleset.version != self._expected_ruleset_version:
            raise CoordinatorContractError(
                "active ruleset version does not match the configured live version"
            )
        if ruleset.season_id != self._expected_ruleset_season_id:
            raise CoordinatorContractError(
                "active ruleset season does not match the configured live season"
            )
        if ruleset.dividend_basis != _LIVE_DIVIDEND_BASIS:
            raise CoordinatorContractError(
                "live settlement requires a raw-net-points ruleset"
            )
        if (
            ruleset.dividend_dollars_per_net_point
            != self._expected_dividend_dollars_per_net_point
        ):
            raise CoordinatorContractError(
                "active ruleset dividend rate does not match live configuration"
            )
        if not ruleset.enforce_roster_lock:
            raise CoordinatorContractError(
                "live settlement requires roster-lock enforcement"
            )
        return ruleset

    @staticmethod
    def _dispatch_failure(exc: Exception) -> CommandDispatch:
        if isinstance(exc, ApiProblem):
            code = DatabaseLiveSettlementSink._error_code(exc.code)
            if exc.status_code >= 500 or code in _RETRYABLE_API_PROBLEM_CODES:
                return CommandDispatch.retryable_failure(code)
            return CommandDispatch.permanent_failure(code)
        if isinstance(exc, (TimeoutError, ConnectionError, OSError, SQLAlchemyError)):
            return CommandDispatch.retryable_failure(
                DatabaseLiveSettlementSink._error_code(type(exc).__name__)
            )
        raise exc

    @staticmethod
    def _error_code(value: str) -> str:
        normalized = _ERROR_CODE_PATTERN.sub("_", value.strip().lower()).strip("_")
        return (normalized or "delivery_failure")[:64]

    def _command_row_key(
        self,
        ruleset_id: str,
        command: PlayerSettlementCommand,
    ) -> dict[str, object]:
        return {
            "ruleset_id": ruleset_id,
            "provider": self._provider,
            "provider_game_id": command.boundary.provider_game_id,
            "provider_player_id": command.provider_player_id,
            "revision": command.result_revision,
        }

    @staticmethod
    def _assert_stored_command(
        row: PerGameLiveResultCommandRow,
        command: PlayerSettlementCommand,
    ) -> None:
        if (
            row.game_id != command.boundary.game_id
            or row.player_id != command.player_id
            or row.result_fingerprint != command.result_fingerprint
            or row.actual_net_points_micros
            != DatabaseLiveSettlementSink._net_points_micros(command.actual_net_points)
            or row.idempotency_key != command.idempotency_key
        ):
            raise CoordinatorContractError(
                "settlement command does not match its durable payload"
            )

    @staticmethod
    def _command_from_row(
        game: PerGameLiveGameRow,
        row: PerGameLiveResultCommandRow,
    ) -> PlayerSettlementCommand:
        command = PlayerSettlementCommand(
            boundary=DatabaseLiveSettlementSink._boundary_from_row(game),
            provider_player_id=row.provider_player_id,
            player_id=row.player_id,
            result_fingerprint=row.result_fingerprint,
            previous_revision=row.revision - 1 if row.revision > 1 else None,
            actual_net_points=row.actual_net_points_micros / 1_000_000,
        )
        if command.idempotency_key != row.idempotency_key:
            raise CoordinatorContractError("stored command idempotency key is invalid")
        return command

    @staticmethod
    def _boundary_from_row(row: PerGameLiveGameRow) -> GameSettlementBoundary:
        started_at = DatabaseLiveSettlementSink._aware_db_datetime(row.started_at)
        return GameSettlementBoundary(
            provider=row.provider,
            provider_game_id=row.provider_game_id,
            game_id=row.game_id,
            game_date=row.game_date,
            game_started_at=started_at,
            next_game_date=row.next_game_date,
            event_sequence=row.event_sequence,
        )

    @staticmethod
    def _db_datetime(value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise CoordinatorContractError("provider tipoff must be timezone-aware")
        return value.astimezone(UTC).replace(tzinfo=None)

    @staticmethod
    def _aware_db_datetime(value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)

    @staticmethod
    def _provider_tipoff(game: object) -> datetime:
        value = getattr(game, "tipoff_at", None)
        if (
            not isinstance(value, datetime)
            or value.tzinfo is None
            or value.utcoffset() is None
        ):
            raise CoordinatorContractError("provider game has no aware tipoff")
        return value.astimezone(UTC)

    @staticmethod
    def _provider_tipoff_known(game: object) -> bool:
        value = getattr(game, "tipoff_known", True)
        if type(value) is not bool:
            raise CoordinatorContractError("provider tipoff_known must be a boolean")
        return value

    @staticmethod
    def _provider_game_id(value: object) -> str:
        game_id = getattr(value, "game_id", None)
        if not isinstance(game_id, str) or not game_id or len(game_id) > 96:
            raise CoordinatorContractError("provider game id is invalid")
        return game_id

    @staticmethod
    def _provider_player_id(value: object) -> str:
        player_id = getattr(value, "player_id", None)
        if not isinstance(player_id, str) or not player_id or len(player_id) > 96:
            raise CoordinatorContractError("provider player id is invalid")
        return player_id

    @staticmethod
    def _provider_status(game: object) -> str:
        status = getattr(game, "status", None)
        if status not in _ALLOWED_STATUS_TRANSITIONS:
            raise CoordinatorContractError("provider game status is invalid")
        return status

    @staticmethod
    def _expected_player_ids(game: object) -> tuple[str, ...]:
        raw = getattr(game, "expected_player_ids", None)
        if isinstance(raw, (str, bytes)) or raw is None:
            raise CoordinatorContractError("expected player ids must be a collection")
        values = tuple(str(value) for value in raw)
        if any(not value or len(value) > 96 for value in values):
            raise CoordinatorContractError("expected player id is invalid")
        if len(values) != len(set(values)):
            raise CoordinatorContractError("expected player ids contain duplicates")
        return tuple(sorted(values, key=lambda value: (len(value), value)))

    @staticmethod
    def _source_fingerprint(game: object) -> str:
        value = getattr(game, "source_fingerprint", None)
        if not isinstance(value, str) or len(value) != 64:
            raise CoordinatorContractError("game source fingerprint must be sha256")
        return value

    @staticmethod
    def _provider_player_name(result: object) -> str:
        game_line = getattr(result, "game_line", None)
        name = getattr(game_line, "player_name", None)
        if not isinstance(name, str) or not name.strip() or len(name) > 120:
            raise CoordinatorContractError("provider result has no stable player name")
        return name.strip()

    @staticmethod
    def _actual_net_points(result: object) -> float:
        value = getattr(result, "raw_net_points", None)
        if isinstance(value, bool):
            raise CoordinatorContractError("actual net points must be numeric")
        try:
            normalized = float(value)
        except (TypeError, ValueError) as exc:
            raise CoordinatorContractError("actual net points must be numeric") from exc
        if not -1000 <= normalized <= 1000:
            raise CoordinatorContractError("actual net points are out of range")
        return normalized

    @staticmethod
    def _required_text(value: object, attribute: str, *, max_length: int) -> str:
        text = getattr(value, attribute, None)
        if not isinstance(text, str) or not text or len(text) > max_length:
            raise CoordinatorContractError(f"provider {attribute} is invalid")
        return text

    @staticmethod
    def _normalize_name(value: str) -> str:
        ascii_value = (
            unicodedata.normalize("NFKD", value)
            .encode("ascii", "ignore")
            .decode("ascii")
        )
        tokens = re.findall(r"[a-z0-9]+", ascii_value.lower())
        while tokens and tokens[-1] in _NAME_SUFFIXES:
            tokens.pop()
        return "".join(tokens)

    @staticmethod
    def _net_points_micros(value: float) -> int:
        return int(
            (Decimal(str(value)) * Decimal("1000000")).quantize(
                Decimal("1"), rounding=ROUND_HALF_UP
            )
        )

    @staticmethod
    def _json_payload(payload: dict[str, object]) -> dict[str, object]:
        result: dict[str, object] = {}
        for key, value in payload.items():
            if isinstance(value, (date, datetime)):
                result[key] = value.isoformat()
            else:
                result[key] = value
        return result

    @staticmethod
    def _fingerprint(value: dict[str, object]) -> str:
        return hashlib.sha256(
            json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()


__all__ = [
    "DatabaseLiveSettlementSink",
    "FenceValidator",
    "InProcessPerGameCommandTarget",
    "NextGameDateResolver",
    "PerGameCommandTarget",
]
