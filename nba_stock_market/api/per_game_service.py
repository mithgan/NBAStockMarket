from __future__ import annotations

import copy
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import json
from typing import Callable, Literal
from uuid import uuid4

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from nba_stock_market.api.auth import Principal
from nba_stock_market.api.database import (
    GAME_STATE_ID,
    Database,
    GameStateRow,
    PerGameAccountRow,
    PerGameAccrualRow,
    PerGameCommandRow,
    PerGameGameBoundaryRow,
    PerGameLedgerEntryRow,
    PerGamePnlSnapshotRow,
    PerGamePositionRow,
    PerGameProjectionRow,
    PerGameQuoteRow,
    PerGameResultRow,
    PerGameRulesetRow,
    PlayerListingRow,
    utcnow,
)
from nba_stock_market.api.service import ApiProblem
from nba_stock_market.per_game import (
    DividendBasis,
    EconomyPolicy,
    JAVASCRIPT_MAX_SAFE_INTEGER,
    PerGameEconomy,
    PlayerGameResult,
    PlayerQuote,
    PositionSide,
    SettlementStatus,
)


DEFAULT_RULESET_ID = "per-game-v2-staging"
DEFAULT_SEASON_ID = "2025-26"
DEFAULT_GAMES_PER_SEASON = 82
ADMIN_ACCOUNT_ID = "__admin__"
SCHEMA_VERSION = 2
MAX_LEDGER_PAGE_SIZE = 100


def api_problem(status_code: int, code: str, message: str) -> ApiProblem:
    return ApiProblem(status_code=status_code, code=code, message=message)


class PerGameService:
    """Transactional persistence and read models for the additive v2 economy."""

    def __init__(self, database: Database, *, ruleset_id: str | None = None) -> None:
        if ruleset_id is not None and (
            not isinstance(ruleset_id, str)
            or not ruleset_id.strip()
            or len(ruleset_id) > 64
        ):
            raise ValueError("ruleset_id must be a non-empty identifier")
        self.database = database
        self._ruleset_id = ruleset_id

    def bootstrap(
        self,
        principal: Principal,
        *,
        after_event_cursor: int | None = None,
        ledger_limit: int = 50,
    ) -> dict[str, object]:
        if after_event_cursor is not None and after_event_cursor < 0:
            raise api_problem(
                422, "validation_error", "Event cursor cannot be negative."
            )
        if ledger_limit < 1 or ledger_limit > MAX_LEDGER_PAGE_SIZE:
            raise api_problem(422, "validation_error", "Ledger limit is out of range.")

        with self.database.snapshot_session() as session:
            ruleset = session.scalar(self._ruleset_query())
            if ruleset is not None:
                account = session.get(
                    PerGameAccountRow,
                    {"ruleset_id": ruleset.id, "account_id": principal.id},
                )
                quote_count = int(
                    session.scalar(
                        select(func.count())
                        .select_from(PerGameQuoteRow)
                        .where(PerGameQuoteRow.ruleset_id == ruleset.id)
                    )
                    or 0
                )
                player_count = int(
                    session.scalar(select(func.count()).select_from(PlayerListingRow))
                    or 0
                )
                if (
                    account is not None
                    and account.display_name == principal.display_name
                    and quote_count == player_count
                ):
                    return self._bootstrap_payload(
                        session,
                        ruleset,
                        account,
                        after_event_cursor=after_event_cursor,
                        ledger_limit=ledger_limit,
                        current_account_id=principal.id,
                    )

        with self.database.market_write_transaction(
            settlement_exclusive=True
        ) as session:
            ruleset = self._ensure_environment(session)
            self._ensure_account(session, ruleset, principal)

        with self.database.snapshot_session() as session:
            ruleset = self._active_ruleset(session)
            account = session.get(
                PerGameAccountRow,
                {"ruleset_id": ruleset.id, "account_id": principal.id},
            )
            if account is None:
                raise api_problem(
                    503,
                    "account_unavailable",
                    "Your per-game account could not be loaded.",
                )
            return self._bootstrap_payload(
                session,
                ruleset,
                account,
                after_event_cursor=after_event_cursor,
                ledger_limit=ledger_limit,
                current_account_id=principal.id,
            )

    def open_position(
        self,
        principal: Principal,
        *,
        player_id: str,
        side: Literal["long", "short"],
        expected_account_version: int,
        expected_quote_version: int,
        idempotency_key: str,
    ) -> dict[str, object]:
        command_payload = {
            "player_id": player_id,
            "side": side,
            "expected_account_version": expected_account_version,
            "expected_quote_version": expected_quote_version,
        }
        fingerprint = self._fingerprint("open_position", command_payload)

        with self.database.market_write_transaction(
            settlement_exclusive=True
        ) as session:
            ruleset = self._ensure_environment(session, for_update=True)
            account = self._ensure_account(session, ruleset, principal, for_update=True)
            replay = self._command_replay(
                session,
                ruleset_id=ruleset.id,
                account_id=account.account_id,
                command_kind="open_position",
                idempotency_key=idempotency_key,
                fingerprint=fingerprint,
            )
            if replay is not None:
                return replay
            self._require_account_version(account, expected_account_version)
            self._require_roster_mutations_open(ruleset)

            quote = session.scalar(
                select(PerGameQuoteRow)
                .where(
                    PerGameQuoteRow.ruleset_id == ruleset.id,
                    PerGameQuoteRow.player_id == player_id,
                )
                .with_for_update()
            )
            if quote is None:
                raise api_problem(404, "unknown_player", "That player is not listed.")
            if quote.version != expected_quote_version:
                raise api_problem(
                    409,
                    "quote_conflict",
                    "That player's market cost changed. Review the latest quote and try again.",
                )

            active_positions = session.scalars(
                select(PerGamePositionRow)
                .where(
                    PerGamePositionRow.ruleset_id == ruleset.id,
                    PerGamePositionRow.account_id == account.account_id,
                    PerGamePositionRow.status == "active",
                )
                .with_for_update()
            ).all()
            same_player = [
                position
                for position in active_positions
                if position.player_id == player_id
            ]
            if any(position.side == side for position in same_player):
                raise api_problem(
                    409,
                    "position_exists",
                    f"You already have an active {side} position in this player.",
                )
            if not ruleset.allow_opposing_positions and same_player:
                raise api_problem(
                    409,
                    "opposing_position",
                    "Close the opposing position before opening this one.",
                )
            side_count = sum(position.side == side for position in active_positions)
            side_limit = (
                ruleset.long_slot_limit if side == "long" else ruleset.short_slot_limit
            )
            if side_count >= side_limit:
                raise api_problem(
                    409,
                    "roster_full",
                    f"Your {side} roster is full at {side_limit} positions.",
                )

            position_id = str(uuid4())
            expires_on = (
                self._short_expires_on(ruleset)
                if side == PositionSide.SHORT.value
                else None
            )
            economy = PerGameEconomy(
                [self._domain_quote(quote)], policy=self._domain_policy(ruleset)
            )
            economy.register_account(account.account_id)
            domain_position = economy.open_position(
                position_id=position_id,
                account_id=account.account_id,
                player_id=player_id,
                side=PositionSide(side),
                sequence=ruleset.current_sequence,
            )
            moved_quote = economy.quote(player_id)

            event_cursor = self._next_event_cursor(ruleset)
            position = PerGamePositionRow(
                id=position_id,
                ruleset_id=ruleset.id,
                account_id=account.account_id,
                player_id=player_id,
                side=side,
                status="active",
                locked_game_cost_dollars=(domain_position.locked_per_game_cost_dollars),
                opened_event_sequence=ruleset.current_sequence,
                expires_on=expires_on,
            )
            session.add(position)
            session.flush([position])
            if (
                moved_quote.current_per_game_cost_dollars
                != quote.current_game_cost_dollars
            ):
                quote.current_game_cost_dollars = (
                    moved_quote.current_per_game_cost_dollars
                )
                quote.version += 1

            fee_delta = -ruleset.transaction_fee_dollars
            if fee_delta:
                self._append_ledger(
                    session,
                    ruleset_id=ruleset.id,
                    account_id=account.account_id,
                    position_id=position.id,
                    player_id=position.player_id,
                    kind="open_fee",
                    amount_dollars=fee_delta,
                    source_key=f"position:{position.id}:open-fee",
                    event_cursor=event_cursor,
                )
                account.cumulative_pnl_dollars = self._safe_money(
                    account.cumulative_pnl_dollars + fee_delta,
                    field_name="Account P&L",
                )
            account.version += 1
            account.updated_at = utcnow()
            self._add_snapshot(session, account, event_cursor=event_cursor)
            session.flush()

            response = {
                "schema_version": SCHEMA_VERSION,
                "replayed": False,
                "account_version": account.version,
                "position_id": position.id,
                "player_id": position.player_id,
                "side": position.side,
                "locked_game_cost_dollars": position.locked_game_cost_dollars,
                "quote_version": quote.version,
                "current_game_cost_dollars": quote.current_game_cost_dollars,
                "account": self._account_payload(
                    session,
                    ruleset,
                    account,
                    active_override=active_positions + [position],
                ),
                "position": self._position_payload(session, position),
                "quote": self._quote_payload(session, quote),
            }
            self._store_command(
                session,
                ruleset_id=ruleset.id,
                account_id=account.account_id,
                command_kind="open_position",
                idempotency_key=idempotency_key,
                fingerprint=fingerprint,
                response=response,
            )
            return response

    def close_position(
        self,
        principal: Principal,
        *,
        position_id: str,
        expected_account_version: int,
        idempotency_key: str,
    ) -> dict[str, object]:
        command_payload = {
            "position_id": position_id,
            "expected_account_version": expected_account_version,
        }
        fingerprint = self._fingerprint("close_position", command_payload)

        with self.database.market_write_transaction(
            settlement_exclusive=True
        ) as session:
            ruleset = self._ensure_environment(session, for_update=True)
            account = self._ensure_account(session, ruleset, principal, for_update=True)
            replay = self._command_replay(
                session,
                ruleset_id=ruleset.id,
                account_id=account.account_id,
                command_kind="close_position",
                idempotency_key=idempotency_key,
                fingerprint=fingerprint,
            )
            if replay is not None:
                return replay
            self._require_account_version(account, expected_account_version)
            self._require_roster_mutations_open(ruleset)

            position = session.scalar(
                select(PerGamePositionRow)
                .where(
                    PerGamePositionRow.id == position_id,
                    PerGamePositionRow.ruleset_id == ruleset.id,
                    PerGamePositionRow.account_id == account.account_id,
                )
                .with_for_update()
            )
            if position is None:
                raise api_problem(
                    404, "unknown_position", "That position does not exist."
                )
            if position.status != "active":
                raise api_problem(
                    409, "position_closed", "That position is already closed."
                )
            quote = session.scalar(
                select(PerGameQuoteRow)
                .where(
                    PerGameQuoteRow.ruleset_id == ruleset.id,
                    PerGameQuoteRow.player_id == position.player_id,
                )
                .with_for_update()
            )
            if quote is None:
                raise api_problem(
                    503, "quote_unavailable", "The player quote is unavailable."
                )

            close_policy = replace(
                self._domain_policy(ruleset),
                open_quote_impact_bps=0,
                max_long_positions=max(1, ruleset.long_slot_limit),
                max_short_positions=max(1, ruleset.short_slot_limit),
            )
            economy = PerGameEconomy([self._domain_quote(quote)], policy=close_policy)
            economy.register_account(account.account_id)
            economy.open_position(
                position_id=position.id,
                account_id=account.account_id,
                player_id=position.player_id,
                side=PositionSide(position.side),
                sequence=position.opened_event_sequence,
            )
            economy.close_position(position.id, sequence=ruleset.current_sequence)
            moved_quote = economy.quote(position.player_id)

            event_cursor = self._next_event_cursor(ruleset)
            position.status = "closed"
            position.closed_event_sequence = ruleset.current_sequence
            position.closed_at = utcnow()
            if (
                moved_quote.current_per_game_cost_dollars
                != quote.current_game_cost_dollars
            ):
                quote.current_game_cost_dollars = (
                    moved_quote.current_per_game_cost_dollars
                )
                quote.version += 1

            fee_delta = -ruleset.transaction_fee_dollars
            if fee_delta:
                self._append_ledger(
                    session,
                    ruleset_id=ruleset.id,
                    account_id=account.account_id,
                    position_id=position.id,
                    player_id=position.player_id,
                    kind="drop_fee",
                    amount_dollars=fee_delta,
                    source_key=f"position:{position.id}:drop-fee",
                    event_cursor=event_cursor,
                )
                account.cumulative_pnl_dollars = self._safe_money(
                    account.cumulative_pnl_dollars + fee_delta,
                    field_name="Account P&L",
                )
            account.version += 1
            account.updated_at = utcnow()
            self._add_snapshot(session, account, event_cursor=event_cursor)
            session.flush()

            response = {
                "schema_version": SCHEMA_VERSION,
                "replayed": False,
                "account_version": account.version,
                "position_id": position.id,
                "player_id": position.player_id,
                "side": position.side,
                "closed_event_sequence": position.closed_event_sequence,
                "quote_version": quote.version,
                "current_game_cost_dollars": quote.current_game_cost_dollars,
                "account": self._account_payload(session, ruleset, account),
                "position": self._position_payload(session, position),
                "quote": self._quote_payload(session, quote),
            }
            self._store_command(
                session,
                ruleset_id=ruleset.id,
                account_id=account.account_id,
                command_kind="close_position",
                idempotency_key=idempotency_key,
                fingerprint=fingerprint,
                response=response,
            )
            return response

    def set_roster_mutation_lock(
        self,
        *,
        locked: bool,
        game_date: date,
        idempotency_key: str,
        write_guard: Callable[[Session], None] | None = None,
    ) -> dict[str, object]:
        request_payload = {
            "locked": locked,
            "game_date": game_date.isoformat(),
        }
        fingerprint = self._fingerprint("set_roster_mutation_lock", request_payload)

        with self.database.market_write_transaction(
            settlement_exclusive=True
        ) as session:
            if write_guard is not None:
                write_guard(session)
            ruleset = self._ensure_environment(session, for_update=True)
            replay = self._command_replay(
                session,
                ruleset_id=ruleset.id,
                account_id=ADMIN_ACCOUNT_ID,
                command_kind="set_roster_mutation_lock",
                idempotency_key=idempotency_key,
                fingerprint=fingerprint,
            )
            if replay is not None:
                return replay

            changed = False
            if locked:
                if (
                    ruleset.last_roster_lock_game_date is not None
                    and game_date < ruleset.last_roster_lock_game_date
                ):
                    raise api_problem(
                        409,
                        "stale_roster_lock",
                        "A roster lock cannot move backward to an older game date.",
                    )
                if (
                    ruleset.roster_mutations_locked
                    and ruleset.roster_lock_game_date not in (None, game_date)
                ):
                    raise api_problem(
                        409,
                        "roster_lock_conflict",
                        "Another game date already owns the roster lock.",
                    )
                changed = not (
                    ruleset.roster_mutations_locked
                    and ruleset.roster_lock_game_date == game_date
                )
                ruleset.roster_mutations_locked = True
                ruleset.roster_lock_game_date = game_date
                ruleset.last_roster_lock_game_date = game_date
            else:
                if (
                    ruleset.roster_mutations_locked
                    and ruleset.roster_lock_game_date != game_date
                ):
                    raise api_problem(
                        409,
                        "roster_lock_conflict",
                        "The unlock date does not match the active roster lock.",
                    )
                changed = ruleset.roster_mutations_locked
                ruleset.roster_mutations_locked = False
                ruleset.roster_lock_game_date = None

            event_cursor = (
                self._next_event_cursor(ruleset) if changed else ruleset.event_cursor
            )
            ruleset.updated_at = utcnow()
            response = {
                "schema_version": SCHEMA_VERSION,
                "replayed": False,
                "changed": changed,
                "event_cursor": event_cursor,
                "roster_mutations_locked": ruleset.roster_mutations_locked,
                "roster_lock_game_date": (
                    ruleset.roster_lock_game_date.isoformat()
                    if ruleset.roster_lock_game_date is not None
                    else None
                ),
            }
            self._store_command(
                session,
                ruleset_id=ruleset.id,
                account_id=ADMIN_ACCOUNT_ID,
                command_kind="set_roster_mutation_lock",
                idempotency_key=idempotency_key,
                fingerprint=fingerprint,
                response=response,
            )
            return response

    def complete_game_date(
        self,
        *,
        game_date: date,
        next_game_date: date | None,
        next_event_sequence: int,
        idempotency_key: str,
        write_guard: Callable[[Session], None] | None = None,
    ) -> dict[str, object]:
        """Advance one fully processed game date, even when no player settled."""

        if type(game_date) is not date:
            raise api_problem(422, "validation_error", "Game date must be a date.")
        if next_game_date is not None and (
            type(next_game_date) is not date or next_game_date <= game_date
        ):
            raise api_problem(
                422,
                "next_game_date_invalid",
                "The next game date must be later than the completed game date.",
            )
        if (
            type(next_event_sequence) is not int
            or next_event_sequence < 0
            or next_event_sequence > 2_147_483_647
        ):
            raise api_problem(
                422,
                "validation_error",
                "Next event sequence must be a nonnegative 32-bit integer.",
            )

        request_payload = {
            "game_date": game_date.isoformat(),
            "next_game_date": (
                next_game_date.isoformat() if next_game_date is not None else None
            ),
            "next_event_sequence": next_event_sequence,
        }
        fingerprint = self._fingerprint("complete_game_date", request_payload)

        with self.database.market_write_transaction(
            settlement_exclusive=True
        ) as session:
            if write_guard is not None:
                write_guard(session)
            ruleset = self._ensure_environment(session, for_update=True)
            replay = self._command_replay(
                session,
                ruleset_id=ruleset.id,
                account_id=ADMIN_ACCOUNT_ID,
                command_kind="complete_game_date",
                idempotency_key=idempotency_key,
                fingerprint=fingerprint,
            )
            if replay is not None:
                return replay
            if ruleset.enforce_roster_lock and (
                not ruleset.roster_mutations_locked
                or ruleset.roster_lock_game_date != game_date
            ):
                raise api_problem(
                    409,
                    "roster_lock_required",
                    "Keep roster changes locked while completing this game date.",
                )
            if (
                ruleset.last_settled_date is not None
                and game_date < ruleset.last_settled_date
            ):
                raise api_problem(
                    409,
                    "stale_game_date_completion",
                    "A completed game date cannot move the market schedule backward.",
                )

            previous_last_settled_date = ruleset.last_settled_date
            previous_next_game_date = ruleset.next_game_date
            previous_sequence = ruleset.current_sequence
            self._expire_short_positions(
                session,
                ruleset=ruleset,
                game_date=game_date,
                close_sequence=max(0, next_event_sequence - 1),
            )
            ruleset.last_settled_date = game_date
            ruleset.next_game_date = next_game_date
            ruleset.current_sequence = max(
                ruleset.current_sequence,
                next_event_sequence,
            )
            event_cursor = self._next_event_cursor(ruleset)
            ruleset.updated_at = utcnow()
            response = {
                "schema_version": SCHEMA_VERSION,
                "replayed": False,
                "changed": (
                    previous_last_settled_date != game_date
                    or previous_next_game_date != next_game_date
                    or previous_sequence != ruleset.current_sequence
                ),
                "event_cursor": event_cursor,
                "last_settled_date": game_date.isoformat(),
                "next_game_date": (
                    next_game_date.isoformat() if next_game_date is not None else None
                ),
                "current_sequence": ruleset.current_sequence,
            }
            self._store_command(
                session,
                ruleset_id=ruleset.id,
                account_id=ADMIN_ACCOUNT_ID,
                command_kind="complete_game_date",
                idempotency_key=idempotency_key,
                fingerprint=fingerprint,
                response=response,
            )
            return response

    def settle_player_game(
        self,
        *,
        game_id: str,
        player_id: str,
        game_date: date,
        game_started_at: datetime | None,
        next_game_date: date | None,
        event_sequence: int,
        result_revision: int,
        actual_net_points: float,
        saved_projection_net_points: float | None,
        projection_model: str | None,
        projection_version: str | None,
        projection_captured_at: datetime | None,
        idempotency_key: str,
        enforce_tipoff_exposure: bool = False,
        write_guard: Callable[[Session], None] | None = None,
    ) -> dict[str, object]:
        if type(enforce_tipoff_exposure) is not bool:
            raise TypeError("enforce_tipoff_exposure must be boolean")
        if next_game_date is not None and next_game_date <= game_date:
            raise api_problem(
                422,
                "next_game_date_invalid",
                "The next game date must be later than the completed game date.",
            )
        request_payload = {
            "game_id": game_id,
            "player_id": player_id,
            "game_date": game_date.isoformat(),
            "game_started_at": (
                game_started_at.isoformat() if game_started_at is not None else None
            ),
            "next_game_date": (
                next_game_date.isoformat() if next_game_date is not None else None
            ),
            "event_sequence": event_sequence,
            "result_revision": result_revision,
            "actual_net_points": str(actual_net_points),
            "saved_projection_net_points": (
                str(saved_projection_net_points)
                if saved_projection_net_points is not None
                else None
            ),
            "projection_model": projection_model,
            "projection_version": projection_version,
            "projection_captured_at": (
                projection_captured_at.isoformat()
                if projection_captured_at is not None
                else None
            ),
        }
        if enforce_tipoff_exposure:
            request_payload["enforce_tipoff_exposure"] = True
        fingerprint = self._fingerprint("settle_player_game", request_payload)

        with self.database.market_write_transaction(
            settlement_exclusive=True
        ) as session:
            if write_guard is not None:
                write_guard(session)
            ruleset = self._ensure_environment(session, for_update=True)
            replay = self._command_replay(
                session,
                ruleset_id=ruleset.id,
                account_id=ADMIN_ACCOUNT_ID,
                command_kind="settle_player_game",
                idempotency_key=idempotency_key,
                fingerprint=fingerprint,
            )
            if replay is not None:
                return replay
            quote = session.get(
                PerGameQuoteRow,
                {"ruleset_id": ruleset.id, "player_id": player_id},
            )
            if quote is None:
                raise api_problem(404, "unknown_player", "That player is not listed.")
            existing_revision = session.get(
                PerGameResultRow,
                {
                    "ruleset_id": ruleset.id,
                    "game_id": game_id,
                    "player_id": player_id,
                    "revision": result_revision,
                },
            )
            if existing_revision is not None:
                if existing_revision.request_fingerprint != fingerprint:
                    raise api_problem(
                        409,
                        "result_revision_conflict",
                        "That result revision already has a different payload.",
                    )
                response = copy.deepcopy(existing_revision.response_payload)
                response["replayed"] = True
                self._store_command(
                    session,
                    ruleset_id=ruleset.id,
                    account_id=ADMIN_ACCOUNT_ID,
                    command_kind="settle_player_game",
                    idempotency_key=idempotency_key,
                    fingerprint=fingerprint,
                    response=response,
                )
                return response

            prior_results = session.scalars(
                select(PerGameResultRow)
                .where(
                    PerGameResultRow.ruleset_id == ruleset.id,
                    PerGameResultRow.game_id == game_id,
                    PerGameResultRow.player_id == player_id,
                )
                .order_by(PerGameResultRow.revision)
                .with_for_update()
            ).all()
            latest_result = prior_results[-1] if prior_results else None
            boundary = self._ensure_game_boundary(
                session,
                ruleset_id=ruleset.id,
                game_id=game_id,
                game_date=game_date,
                game_started_at=game_started_at,
                next_game_date=next_game_date,
                event_sequence=event_sequence,
                enforce_next_game_date=latest_result is None,
            )
            if (
                latest_result is None
                and ruleset.enforce_roster_lock
                and (
                    not ruleset.roster_mutations_locked
                    or ruleset.roster_lock_game_date != game_date
                )
            ):
                raise api_problem(
                    409,
                    "roster_lock_required",
                    "Keep roster changes locked for this game date while settling results.",
                )
            if latest_result is not None:
                if result_revision <= latest_result.revision:
                    raise api_problem(
                        409,
                        "result_revision_conflict",
                        "Result revisions must increase monotonically.",
                    )
                if (
                    latest_result.event_sequence != event_sequence
                    or latest_result.game_date != game_date
                ):
                    raise api_problem(
                        409,
                        "result_identity_conflict",
                        "A correction cannot change the game date or event sequence.",
                    )

            result_dividend_basis = (
                prior_results[0].dividend_basis
                if prior_results
                else ruleset.dividend_basis
            )
            result_dividend_rate = (
                prior_results[0].dividend_dollars_per_net_point
                if prior_results
                else ruleset.dividend_dollars_per_net_point
            )

            projection_micros = self._save_or_load_projection(
                session,
                ruleset_id=ruleset.id,
                game_id=game_id,
                player_id=player_id,
                saved_projection_net_points=saved_projection_net_points,
                projection_model=projection_model,
                projection_version=projection_version,
                projection_captured_at=projection_captured_at,
                game_started_at=boundary.started_at,
            )
            if (
                latest_result is not None
                and latest_result.saved_projection_net_points_micros is not None
                and projection_micros
                != latest_result.saved_projection_net_points_micros
            ):
                raise api_problem(
                    409,
                    "projection_conflict",
                    "The saved pregame projection cannot change after a result.",
                )

            actual_micros = self._net_points_micros(actual_net_points)
            result_policy = replace(
                self._domain_policy(ruleset),
                dividend_basis=DividendBasis(result_dividend_basis),
                dividend_dollars_per_net_point=result_dividend_rate,
            )
            domain = PerGameEconomy([self._domain_quote(quote)], policy=result_policy)
            if latest_result is not None:
                domain.settle_player_game(
                    self._domain_result(latest_result, projection_micros)
                )
            domain_outcome = domain.settle_player_game(
                PlayerGameResult(
                    game_id=game_id,
                    player_id=player_id,
                    sequence=event_sequence,
                    revision=result_revision,
                    actual_net_points=actual_micros / 1_000_000,
                    saved_projection_net_points=(
                        projection_micros / 1_000_000
                        if projection_micros is not None
                        else None
                    ),
                )
            )
            status = domain_outcome.status.value
            dividend_dollars = domain_outcome.dividend_dollars
            prior_settled = next(
                (row for row in reversed(prior_results) if row.status == "settled"),
                None,
            )
            kind = "correction" if prior_settled is not None else "base"
            self._expire_short_positions(
                session,
                ruleset=ruleset,
                game_date=game_date,
                close_sequence=event_sequence,
            )
            event_cursor = self._next_event_cursor(ruleset)

            result = PerGameResultRow(
                ruleset_id=ruleset.id,
                game_id=game_id,
                player_id=player_id,
                revision=result_revision,
                game_date=game_date,
                event_sequence=event_sequence,
                actual_net_points_micros=actual_micros,
                saved_projection_net_points_micros=projection_micros,
                dividend_basis=result_dividend_basis,
                dividend_dollars_per_net_point=result_dividend_rate,
                status=status,
                kind=kind,
                dividend_dollars=dividend_dollars,
                adjusts_result_revision=(
                    prior_settled.revision if kind == "correction" else None
                ),
                event_cursor=event_cursor,
                request_fingerprint=fingerprint,
                response_payload={},
            )
            session.add(result)
            session.flush()

            accruals = session.scalars(
                select(PerGameAccrualRow)
                .where(
                    PerGameAccrualRow.ruleset_id == ruleset.id,
                    PerGameAccrualRow.game_id == game_id,
                    PerGameAccrualRow.player_id == player_id,
                )
                .with_for_update()
            ).all()
            if not accruals:
                exposure_filters = [
                    PerGamePositionRow.ruleset_id == ruleset.id,
                    PerGamePositionRow.player_id == player_id,
                    or_(
                        PerGamePositionRow.side != PositionSide.SHORT.value,
                        PerGamePositionRow.expires_on.is_(None),
                        PerGamePositionRow.expires_on >= game_date,
                    ),
                ]
                if enforce_tipoff_exposure and boundary.started_at is not None:
                    exposure_filters.extend(
                        [
                            PerGamePositionRow.opened_at <= boundary.started_at,
                            or_(
                                PerGamePositionRow.closed_at.is_(None),
                                PerGamePositionRow.closed_at > boundary.started_at,
                            ),
                        ]
                    )
                else:
                    exposure_filters.extend(
                        [
                            PerGamePositionRow.opened_event_sequence <= event_sequence,
                            or_(
                                PerGamePositionRow.closed_event_sequence.is_(None),
                                PerGamePositionRow.closed_event_sequence
                                > event_sequence,
                            ),
                        ]
                    )
                exposures = session.scalars(
                    select(PerGamePositionRow)
                    .where(*exposure_filters)
                    .with_for_update()
                ).all()
                accruals = [
                    PerGameAccrualRow(
                        ruleset_id=ruleset.id,
                        position_id=position.id,
                        game_id=game_id,
                        account_id=position.account_id,
                        player_id=player_id,
                        game_date=game_date,
                        event_sequence=event_sequence,
                        side=position.side,
                        locked_game_cost_dollars=position.locked_game_cost_dollars,
                        status=status,
                        base_result_revision=None,
                        latest_result_revision=result_revision,
                        game_cost_dollars=0,
                        dividend_dollars=None,
                        cumulative_pnl_dollars=0,
                        event_cursor=event_cursor,
                    )
                    for position in exposures
                ]
                session.add_all(accruals)
                session.flush()

            affected_accounts: dict[str, PerGameAccountRow] = {}
            event_deltas: dict[str, int] = {}
            if status == SettlementStatus.SETTLED.value:
                if dividend_dollars is None:
                    raise RuntimeError("settled result is missing its domain dividend")
                if kind == "base":
                    self._post_base_settlement(
                        session,
                        ruleset=ruleset,
                        result=result,
                        accruals=accruals,
                        dividend_dollars=dividend_dollars,
                        account_deltas=event_deltas,
                    )
                else:
                    if prior_settled is None or prior_settled.dividend_dollars is None:
                        raise RuntimeError(
                            "correction is missing a settled prior dividend"
                        )
                    self._post_correction(
                        session,
                        ruleset=ruleset,
                        result=result,
                        accruals=accruals,
                        dividend_delta=(
                            dividend_dollars - prior_settled.dividend_dollars
                        ),
                        account_deltas=event_deltas,
                    )
                event_cursor = ruleset.event_cursor
                result.event_cursor = event_cursor
                affected_accounts = self._apply_account_deltas(
                    session,
                    ruleset=ruleset,
                    game_id=game_id,
                    game_date=game_date,
                    event_cursor=event_cursor,
                    account_deltas=event_deltas,
                )
                if (
                    ruleset.last_settled_date is None
                    or game_date > ruleset.last_settled_date
                ):
                    ruleset.last_settled_date = game_date
            else:
                for accrual in accruals:
                    accrual.status = status
                    accrual.latest_result_revision = result_revision
                    accrual.event_cursor = event_cursor

            if latest_result is None:
                ruleset.current_sequence = max(
                    ruleset.current_sequence, event_sequence + 1
                )
                if (
                    ruleset.last_settled_date is None
                    or game_date >= ruleset.last_settled_date
                ):
                    ruleset.next_game_date = next_game_date
            ruleset.updated_at = utcnow()
            session.flush()

            settlement_payloads = [
                self._settled_result_payload(session, accrual)
                for accrual in sorted(accruals, key=lambda row: row.position_id)
            ]
            response = {
                "schema_version": SCHEMA_VERSION,
                "replayed": False,
                "event_cursor": event_cursor,
                "result": self._result_payload(result),
                "settlements": settlement_payloads,
                "accounts": [
                    self._account_payload(session, ruleset, account)
                    for account in sorted(
                        affected_accounts.values(), key=lambda row: row.account_id
                    )
                ],
            }
            result.response_payload = copy.deepcopy(response)
            self._store_command(
                session,
                ruleset_id=ruleset.id,
                account_id=ADMIN_ACCOUNT_ID,
                command_kind="settle_player_game",
                idempotency_key=idempotency_key,
                fingerprint=fingerprint,
                response=response,
            )
            return response

    def _post_base_settlement(
        self,
        session: Session,
        *,
        ruleset: PerGameRulesetRow,
        result: PerGameResultRow,
        accruals: list[PerGameAccrualRow],
        dividend_dollars: int,
        account_deltas: dict[str, int],
    ) -> None:
        for accrual in accruals:
            if accrual.base_result_revision is not None:
                raise api_problem(
                    409,
                    "base_settlement_conflict",
                    "This position-game already has a base settlement.",
                )
            direction = 1 if accrual.side == "long" else -1
            cost_amount = -direction * accrual.locked_game_cost_dollars
            dividend_amount = direction * dividend_dollars
            cost_cursor = self._next_event_cursor(ruleset)
            self._append_ledger(
                session,
                ruleset_id=ruleset.id,
                account_id=accrual.account_id,
                position_id=accrual.position_id,
                player_id=accrual.player_id,
                game_id=accrual.game_id,
                game_date=accrual.game_date,
                result_revision=result.revision,
                kind="game_cost",
                amount_dollars=cost_amount,
                source_key=(f"base:{accrual.position_id}:{accrual.game_id}:game-cost"),
                event_cursor=cost_cursor,
            )
            dividend_cursor = self._next_event_cursor(ruleset)
            self._append_ledger(
                session,
                ruleset_id=ruleset.id,
                account_id=accrual.account_id,
                position_id=accrual.position_id,
                player_id=accrual.player_id,
                game_id=accrual.game_id,
                game_date=accrual.game_date,
                result_revision=result.revision,
                kind="game_dividend",
                amount_dollars=dividend_amount,
                source_key=(f"base:{accrual.position_id}:{accrual.game_id}:dividend"),
                event_cursor=dividend_cursor,
            )
            pnl_delta = self._safe_money(
                cost_amount + dividend_amount,
                field_name="Game P&L",
            )
            accrual.status = "settled"
            accrual.base_result_revision = result.revision
            accrual.latest_result_revision = result.revision
            accrual.game_cost_dollars = accrual.locked_game_cost_dollars
            accrual.dividend_dollars = dividend_dollars
            accrual.cumulative_pnl_dollars = pnl_delta
            accrual.event_cursor = dividend_cursor
            accrual.updated_at = utcnow()
            account_deltas[accrual.account_id] = self._safe_money(
                account_deltas.get(accrual.account_id, 0) + pnl_delta,
                field_name="Settlement account delta",
            )

    def _post_correction(
        self,
        session: Session,
        *,
        ruleset: PerGameRulesetRow,
        result: PerGameResultRow,
        accruals: list[PerGameAccrualRow],
        dividend_delta: int,
        account_deltas: dict[str, int],
    ) -> None:
        for accrual in accruals:
            if accrual.base_result_revision is None:
                raise api_problem(
                    409,
                    "correction_without_base",
                    "A correction cannot post before the base settlement.",
                )
            prior_entry = session.scalar(
                select(PerGameLedgerEntryRow)
                .where(
                    PerGameLedgerEntryRow.ruleset_id == ruleset.id,
                    PerGameLedgerEntryRow.position_id == accrual.position_id,
                    PerGameLedgerEntryRow.game_id == accrual.game_id,
                    PerGameLedgerEntryRow.kind.in_(
                        ("game_dividend", "dividend_correction")
                    ),
                )
                .order_by(
                    PerGameLedgerEntryRow.result_revision.desc(),
                    PerGameLedgerEntryRow.created_at.desc(),
                )
            )
            if prior_entry is None:
                raise RuntimeError("settled accrual has no dividend ledger entry")
            direction = 1 if accrual.side == "long" else -1
            adjustment = direction * dividend_delta
            adjustment_cursor = self._next_event_cursor(ruleset)
            self._append_ledger(
                session,
                ruleset_id=ruleset.id,
                account_id=accrual.account_id,
                position_id=accrual.position_id,
                player_id=accrual.player_id,
                game_id=accrual.game_id,
                game_date=accrual.game_date,
                result_revision=result.revision,
                kind="dividend_correction",
                amount_dollars=adjustment,
                source_key=(
                    f"correction:{accrual.position_id}:{accrual.game_id}:"
                    f"r{result.revision}"
                ),
                adjusts_entry_id=prior_entry.id,
                event_cursor=adjustment_cursor,
            )
            accrual.latest_result_revision = result.revision
            accrual.dividend_dollars = result.dividend_dollars
            accrual.cumulative_pnl_dollars = self._safe_money(
                accrual.cumulative_pnl_dollars + adjustment,
                field_name="Position-game P&L",
            )
            accrual.event_cursor = adjustment_cursor
            accrual.updated_at = utcnow()
            account_deltas[accrual.account_id] = self._safe_money(
                account_deltas.get(accrual.account_id, 0) + adjustment,
                field_name="Correction account delta",
            )

    def _apply_account_deltas(
        self,
        session: Session,
        *,
        ruleset: PerGameRulesetRow,
        game_id: str,
        game_date: date,
        event_cursor: int,
        account_deltas: dict[str, int],
    ) -> dict[str, PerGameAccountRow]:
        accounts: dict[str, PerGameAccountRow] = {}
        for account_id, delta in account_deltas.items():
            account = session.scalar(
                select(PerGameAccountRow)
                .where(
                    PerGameAccountRow.ruleset_id == ruleset.id,
                    PerGameAccountRow.account_id == account_id,
                )
                .with_for_update()
            )
            if account is None:
                raise RuntimeError("position references a missing v2 account")
            account.cumulative_pnl_dollars = self._safe_money(
                account.cumulative_pnl_dollars + delta,
                field_name="Account P&L",
            )
            account.version += 1
            session.flush()
            latest_game_date = session.scalar(
                select(func.max(PerGameAccrualRow.game_date)).where(
                    PerGameAccrualRow.ruleset_id == ruleset.id,
                    PerGameAccrualRow.account_id == account_id,
                    PerGameAccrualRow.status == SettlementStatus.SETTLED.value,
                )
            )
            account.latest_game_pnl_dollars = self._safe_money(
                int(
                    session.scalar(
                        select(
                            func.coalesce(
                                func.sum(PerGameAccrualRow.cumulative_pnl_dollars), 0
                            )
                        ).where(
                            PerGameAccrualRow.ruleset_id == ruleset.id,
                            PerGameAccrualRow.account_id == account_id,
                            PerGameAccrualRow.status == SettlementStatus.SETTLED.value,
                            PerGameAccrualRow.game_date == latest_game_date,
                        )
                    )
                    or 0
                ),
                field_name="Latest game P&L",
            )
            account.updated_at = utcnow()
            self._add_snapshot(
                session,
                account,
                event_cursor=event_cursor,
                game_id=game_id,
                game_date=game_date,
            )
            accounts[account_id] = account
        return accounts

    def _bootstrap_payload(
        self,
        session: Session,
        ruleset: PerGameRulesetRow,
        account: PerGameAccountRow,
        *,
        after_event_cursor: int | None,
        ledger_limit: int,
        current_account_id: str,
    ) -> dict[str, object]:
        quotes = session.execute(
            select(PerGameQuoteRow, PlayerListingRow)
            .join(PlayerListingRow, PlayerListingRow.id == PerGameQuoteRow.player_id)
            .where(PerGameQuoteRow.ruleset_id == ruleset.id)
            .order_by(PlayerListingRow.name)
        ).all()
        positions = session.scalars(
            select(PerGamePositionRow)
            .where(
                PerGamePositionRow.ruleset_id == ruleset.id,
                PerGamePositionRow.account_id == account.account_id,
            )
            .order_by(PerGamePositionRow.opened_at, PerGamePositionRow.id)
        ).all()
        ledger_cursor_query = select(
            PerGameLedgerEntryRow.event_cursor.label("event_cursor")
        ).where(
            PerGameLedgerEntryRow.ruleset_id == ruleset.id,
            PerGameLedgerEntryRow.account_id == account.account_id,
        )
        accrual_cursor_query = select(
            PerGameAccrualRow.event_cursor.label("event_cursor")
        ).where(
            PerGameAccrualRow.ruleset_id == ruleset.id,
            PerGameAccrualRow.account_id == account.account_id,
        )
        if after_event_cursor is not None:
            ledger_cursor_query = ledger_cursor_query.where(
                PerGameLedgerEntryRow.event_cursor > after_event_cursor
            )
            accrual_cursor_query = accrual_cursor_query.where(
                PerGameAccrualRow.event_cursor > after_event_cursor
            )
        history_cursor_query = ledger_cursor_query.union(
            accrual_cursor_query
        ).subquery()
        history_cursors = list(
            session.scalars(
                select(history_cursor_query.c.event_cursor)
                .order_by(history_cursor_query.c.event_cursor)
                .limit(ledger_limit + 1)
            )
        )
        has_more = len(history_cursors) > ledger_limit
        page_cursors = history_cursors[:ledger_limit]
        next_cursor = page_cursors[-1] if has_more and page_cursors else None
        if page_cursors:
            ledger_rows = session.scalars(
                select(PerGameLedgerEntryRow)
                .where(
                    PerGameLedgerEntryRow.ruleset_id == ruleset.id,
                    PerGameLedgerEntryRow.account_id == account.account_id,
                    PerGameLedgerEntryRow.event_cursor.in_(page_cursors),
                )
                .order_by(
                    PerGameLedgerEntryRow.event_cursor,
                    PerGameLedgerEntryRow.id,
                )
            ).all()
            accruals = session.scalars(
                select(PerGameAccrualRow)
                .where(
                    PerGameAccrualRow.ruleset_id == ruleset.id,
                    PerGameAccrualRow.account_id == account.account_id,
                    PerGameAccrualRow.event_cursor.in_(page_cursors),
                )
                .order_by(
                    PerGameAccrualRow.event_cursor,
                    PerGameAccrualRow.position_id,
                )
            ).all()
        else:
            ledger_rows = []
            accruals = []
        leaderboard_order = (
            PerGameAccountRow.cumulative_pnl_dollars.desc(),
            PerGameAccountRow.created_at,
            PerGameAccountRow.account_id,
        )
        ranked_accounts = (
            select(PerGameAccountRow)
            .with_only_columns(
                PerGameAccountRow.account_id.label("account_id"),
                PerGameAccountRow.display_name.label("display_name"),
                PerGameAccountRow.cumulative_pnl_dollars.label(
                    "cumulative_pnl_dollars"
                ),
                func.row_number().over(order_by=leaderboard_order).label("rank"),
            )
            .where(PerGameAccountRow.ruleset_id == ruleset.id)
            .subquery()
        )
        leaderboard_accounts = session.execute(
            select(ranked_accounts)
            .where(
                or_(
                    ranked_accounts.c.rank <= 50,
                    ranked_accounts.c.account_id == current_account_id,
                )
            )
            .order_by(ranked_accounts.c.rank)
        ).all()
        active_positions = [
            position for position in positions if position.status == "active"
        ]
        long_used = sum(position.side == "long" for position in active_positions)
        short_used = sum(position.side == "short" for position in active_positions)

        return {
            "schema_version": SCHEMA_VERSION,
            "ruleset": self._ruleset_payload(ruleset),
            "market": [
                self._quote_payload(session, quote, player=player)
                for quote, player in quotes
            ],
            "account": self._account_payload(
                session, ruleset, account, active_override=active_positions
            ),
            "positions": [
                self._position_payload(session, position) for position in positions
            ],
            "game": {
                "season_id": ruleset.season_id,
                "last_settled_date": (
                    ruleset.last_settled_date.isoformat()
                    if ruleset.last_settled_date is not None
                    else None
                ),
                "next_game_date": (
                    ruleset.next_game_date.isoformat()
                    if ruleset.next_game_date is not None
                    else None
                ),
                "event_cursor": ruleset.event_cursor,
                "event_sequence": ruleset.current_sequence,
            },
            "ledger": {
                "items": [self._ledger_payload(row) for row in ledger_rows],
                "next_cursor": next_cursor,
            },
            "settled_results": [
                self._settled_result_payload(session, accrual) for accrual in accruals
            ],
            "leaderboard": [
                {
                    "rank": row.rank,
                    "account_id": row.account_id,
                    "display_name": row.display_name,
                    "cumulative_pnl_dollars": row.cumulative_pnl_dollars,
                    "is_current_user": row.account_id == current_account_id,
                }
                for row in leaderboard_accounts
            ],
            "capabilities": {
                "can_open_long": (
                    not ruleset.roster_mutations_locked
                    and long_used < ruleset.long_slot_limit
                ),
                "can_open_short": (
                    not ruleset.roster_mutations_locked
                    and short_used < ruleset.short_slot_limit
                    and self._short_schedule_available(ruleset)
                ),
                "can_advance_replay": False,
            },
        }

    def _ensure_environment(
        self,
        session: Session,
        *,
        for_update: bool = False,
    ) -> PerGameRulesetRow:
        query = self._ruleset_query()
        if for_update:
            query = query.with_for_update()
        ruleset = session.scalar(query)
        if ruleset is None:
            if self._ruleset_id is not None:
                raise api_problem(
                    503,
                    "ruleset_unavailable",
                    "The configured per-game ruleset is not active.",
                )
            inactive_default = session.get(PerGameRulesetRow, DEFAULT_RULESET_ID)
            if inactive_default is not None:
                raise api_problem(
                    503,
                    "ruleset_unavailable",
                    "The per-game ruleset is not active.",
                )
            if session.bind is None or session.bind.dialect.name != "sqlite":
                raise api_problem(
                    503,
                    "ruleset_unavailable",
                    "The per-game ruleset has not been activated.",
                )
            game_state = session.get(GameStateRow, GAME_STATE_ID)
            ruleset = PerGameRulesetRow(
                id=DEFAULT_RULESET_ID,
                version=1,
                season_id=(game_state.season_id if game_state else DEFAULT_SEASON_ID),
                dividend_basis=DividendBasis.RAW_NET_POINTS.value,
                dividend_dollars_per_net_point=40_000,
                long_slot_limit=10,
                short_slot_limit=5,
                allow_opposing_positions=False,
                enforce_roster_lock=False,
                roster_mutations_locked=False,
                roster_lock_game_date=None,
                last_roster_lock_game_date=None,
                quote_add_impact_bps=25,
                quote_drop_impact_bps=25,
                transaction_fee_dollars=0,
                short_term_days=7,
                current_sequence=0,
                last_settled_date=None,
                next_game_date=(game_state.next_game_date if game_state else None),
                event_cursor=0,
                is_active=True,
            )
            session.add(ruleset)
            session.flush()

        existing_player_ids = set(
            session.scalars(
                select(PerGameQuoteRow.player_id).where(
                    PerGameQuoteRow.ruleset_id == ruleset.id
                )
            )
        )
        player_ids = set(session.scalars(select(PlayerListingRow.id)))
        missing_player_ids = player_ids - existing_player_ids
        if session.bind is not None and session.bind.dialect.name != "sqlite":
            if not player_ids or missing_player_ids:
                raise api_problem(
                    503,
                    "quotes_unavailable",
                    "Per-game player quotes are not fully provisioned.",
                )
            return ruleset

        missing_players = session.scalars(
            select(PlayerListingRow)
            .where(PlayerListingRow.id.in_(missing_player_ids))
            .order_by(PlayerListingRow.id)
        ).all()
        session.add_all(
            PerGameQuoteRow(
                ruleset_id=ruleset.id,
                player_id=player.id,
                current_game_cost_dollars=self._season_price_to_game_cost(
                    player.current_price_cents
                ),
                prior_season_value_per_game_dollars=self._season_price_to_game_cost(
                    player.opening_price_cents
                ),
                version=0,
            )
            for player in missing_players
        )
        if missing_players:
            session.flush()
        return ruleset

    def _ensure_account(
        self,
        session: Session,
        ruleset: PerGameRulesetRow,
        principal: Principal,
        *,
        for_update: bool = False,
    ) -> PerGameAccountRow:
        query = select(PerGameAccountRow).where(
            PerGameAccountRow.ruleset_id == ruleset.id,
            PerGameAccountRow.account_id == principal.id,
        )
        if for_update:
            query = query.with_for_update()
        account = session.scalar(query)
        if account is None:
            account = PerGameAccountRow(
                ruleset_id=ruleset.id,
                account_id=principal.id,
                display_name=principal.display_name,
                version=0,
                cumulative_pnl_dollars=0,
                latest_game_pnl_dollars=0,
            )
            session.add(account)
            session.flush()
        elif account.display_name != principal.display_name:
            account.display_name = principal.display_name
        return account

    def _active_ruleset(self, session: Session) -> PerGameRulesetRow:
        ruleset = session.scalar(self._ruleset_query())
        if ruleset is None:
            raise api_problem(
                503, "ruleset_unavailable", "The per-game ruleset is unavailable."
            )
        return ruleset

    def _ruleset_query(self):
        query = select(PerGameRulesetRow).where(PerGameRulesetRow.is_active.is_(True))
        if self._ruleset_id is not None:
            return query.where(PerGameRulesetRow.id == self._ruleset_id)
        return query.order_by(PerGameRulesetRow.created_at.desc())

    @staticmethod
    def _require_account_version(
        account: PerGameAccountRow, expected_version: int
    ) -> None:
        if account.version != expected_version:
            raise api_problem(
                409,
                "stale_account_version",
                "Your account changed. Refresh and try again.",
            )

    @staticmethod
    def _require_roster_mutations_open(ruleset: PerGameRulesetRow) -> None:
        if ruleset.roster_mutations_locked:
            lock_date = (
                f" for {ruleset.roster_lock_game_date.isoformat()}"
                if ruleset.roster_lock_game_date is not None
                else ""
            )
            raise api_problem(
                423,
                "roster_locked",
                f"Roster changes are locked{lock_date} while games settle.",
            )

    @staticmethod
    def _safe_money(value: int, *, field_name: str) -> int:
        if abs(value) > JAVASCRIPT_MAX_SAFE_INTEGER:
            raise api_problem(
                409,
                "economy_limit_reached",
                f"{field_name} reached the supported economy limit.",
            )
        return value

    @staticmethod
    def _next_event_cursor(ruleset: PerGameRulesetRow) -> int:
        ruleset.event_cursor += 1
        return ruleset.event_cursor

    @staticmethod
    def _season_price_to_game_cost(price_cents: int) -> int:
        return max(1, (price_cents + 4_100) // (100 * DEFAULT_GAMES_PER_SEASON))

    @staticmethod
    def _net_points_micros(value: float) -> int:
        return int(
            (Decimal(str(value)) * Decimal("1000000")).quantize(
                Decimal("1"), rounding=ROUND_HALF_UP
            )
        )

    @staticmethod
    def _fingerprint(command_kind: str, payload: dict[str, object]) -> str:
        encoded = json.dumps(
            {
                "schema_version": SCHEMA_VERSION,
                "command_kind": command_kind,
                "payload": payload,
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()

    @staticmethod
    def _command_replay(
        session: Session,
        *,
        ruleset_id: str,
        account_id: str,
        command_kind: str,
        idempotency_key: str,
        fingerprint: str,
    ) -> dict[str, object] | None:
        command = session.scalar(
            select(PerGameCommandRow)
            .where(
                PerGameCommandRow.ruleset_id == ruleset_id,
                PerGameCommandRow.account_id == account_id,
                PerGameCommandRow.command_kind == command_kind,
                PerGameCommandRow.idempotency_key == idempotency_key,
            )
            .with_for_update()
        )
        if command is None:
            return None
        if command.request_fingerprint != fingerprint:
            raise api_problem(
                409,
                "idempotency_conflict",
                "That idempotency key was already used for another request.",
            )
        if command.schema_version != SCHEMA_VERSION:
            raise api_problem(
                409,
                "idempotency_schema_conflict",
                "That command belongs to another API contract version.",
            )
        response = copy.deepcopy(command.response_payload)
        response["replayed"] = True
        return response

    @staticmethod
    def _store_command(
        session: Session,
        *,
        ruleset_id: str,
        account_id: str,
        command_kind: str,
        idempotency_key: str,
        fingerprint: str,
        response: dict[str, object],
    ) -> None:
        stored_response = copy.deepcopy(response)
        stored_response["replayed"] = False
        session.add(
            PerGameCommandRow(
                id=str(uuid4()),
                ruleset_id=ruleset_id,
                account_id=account_id,
                command_kind=command_kind,
                idempotency_key=idempotency_key,
                request_fingerprint=fingerprint,
                schema_version=SCHEMA_VERSION,
                response_payload=stored_response,
            )
        )

    @staticmethod
    def _short_schedule_available(ruleset: PerGameRulesetRow) -> bool:
        return ruleset.short_term_days is None or (
            ruleset.next_game_date is not None
            and (
                ruleset.last_settled_date is None
                or ruleset.next_game_date > ruleset.last_settled_date
            )
        )

    @classmethod
    def _short_expires_on(cls, ruleset: PerGameRulesetRow) -> date | None:
        if ruleset.short_term_days is None:
            return None
        term_start = ruleset.next_game_date
        if not cls._short_schedule_available(ruleset):
            raise api_problem(
                503,
                "short_schedule_unavailable",
                "The next market date is unavailable, so a timed inverse position cannot open.",
            )
        return term_start + timedelta(days=ruleset.short_term_days - 1)

    def _expire_short_positions(
        self,
        session: Session,
        *,
        ruleset: PerGameRulesetRow,
        game_date: date,
        close_sequence: int,
    ) -> None:
        expired = session.scalars(
            select(PerGamePositionRow)
            .where(
                PerGamePositionRow.ruleset_id == ruleset.id,
                PerGamePositionRow.side == PositionSide.SHORT.value,
                PerGamePositionRow.status == "active",
                PerGamePositionRow.opened_event_sequence <= close_sequence,
                PerGamePositionRow.expires_on.is_not(None),
                PerGamePositionRow.expires_on < game_date,
            )
            .order_by(
                PerGamePositionRow.player_id,
                PerGamePositionRow.opened_at,
                PerGamePositionRow.id,
            )
            .with_for_update()
        ).all()
        if not expired:
            return

        player_ids = sorted({position.player_id for position in expired})
        quotes = session.scalars(
            select(PerGameQuoteRow)
            .where(
                PerGameQuoteRow.ruleset_id == ruleset.id,
                PerGameQuoteRow.player_id.in_(player_ids),
            )
            .order_by(PerGameQuoteRow.player_id)
            .with_for_update()
        ).all()
        quote_by_player = {quote.player_id: quote for quote in quotes}
        if set(quote_by_player) != set(player_ids):
            raise api_problem(
                503, "quote_unavailable", "A player quote is unavailable."
            )

        close_policy = replace(
            self._domain_policy(ruleset),
            open_quote_impact_bps=0,
            max_short_positions=max(1, ruleset.short_slot_limit),
        )
        for position in expired:
            quote = quote_by_player[position.player_id]
            economy = PerGameEconomy([self._domain_quote(quote)], policy=close_policy)
            economy.register_account(position.account_id)
            economy.open_position(
                position_id=position.id,
                account_id=position.account_id,
                player_id=position.player_id,
                side=PositionSide.SHORT,
                sequence=position.opened_event_sequence,
            )
            economy.close_position(position.id, sequence=close_sequence)
            moved_quote = economy.quote(position.player_id)
            if (
                moved_quote.current_per_game_cost_dollars
                != quote.current_game_cost_dollars
            ):
                quote.current_game_cost_dollars = (
                    moved_quote.current_per_game_cost_dollars
                )
                quote.version += 1

            position.status = "closed"
            position.closed_event_sequence = close_sequence
            position.closed_at = utcnow()
            account = session.scalar(
                select(PerGameAccountRow)
                .where(
                    PerGameAccountRow.ruleset_id == ruleset.id,
                    PerGameAccountRow.account_id == position.account_id,
                )
                .with_for_update()
            )
            if account is None:
                raise RuntimeError("expired position references a missing v2 account")
            event_cursor = self._next_event_cursor(ruleset)
            fee_delta = -ruleset.transaction_fee_dollars
            if fee_delta:
                self._append_ledger(
                    session,
                    ruleset_id=ruleset.id,
                    account_id=account.account_id,
                    position_id=position.id,
                    player_id=position.player_id,
                    kind="drop_fee",
                    amount_dollars=fee_delta,
                    source_key=f"position:{position.id}:drop-fee",
                    event_cursor=event_cursor,
                )
                account.cumulative_pnl_dollars = self._safe_money(
                    account.cumulative_pnl_dollars + fee_delta,
                    field_name="Account P&L",
                )
            account.version += 1
            account.updated_at = utcnow()
            self._add_snapshot(session, account, event_cursor=event_cursor)
        session.flush()

    @staticmethod
    def _utc_naive(value: datetime, *, field_name: str) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise api_problem(
                422,
                "timezone_required",
                f"{field_name} must include a timezone offset.",
            )
        return value.astimezone(UTC).replace(tzinfo=None)

    def _save_or_load_projection(
        self,
        session: Session,
        *,
        ruleset_id: str,
        game_id: str,
        player_id: str,
        saved_projection_net_points: float | None,
        projection_model: str | None,
        projection_version: str | None,
        projection_captured_at: datetime | None,
        game_started_at: datetime | None,
    ) -> int | None:
        projection = session.get(
            PerGameProjectionRow,
            {
                "ruleset_id": ruleset_id,
                "game_id": game_id,
                "player_id": player_id,
            },
        )
        requested_micros = (
            self._net_points_micros(saved_projection_net_points)
            if saved_projection_net_points is not None
            else None
        )
        captured_at: datetime | None = None
        if requested_micros is not None:
            if (
                not projection_model
                or not projection_version
                or projection_captured_at is None
            ):
                raise api_problem(
                    422,
                    "projection_metadata_required",
                    "A saved projection requires its model, version, and capture time.",
                )
            if game_started_at is None:
                raise api_problem(
                    422,
                    "game_start_required",
                    "A saved projection requires the authoritative game start time.",
                )
            captured_at = self._utc_naive(
                projection_captured_at,
                field_name="Projection capture time",
            )
            if captured_at >= game_started_at:
                raise api_problem(
                    422,
                    "projection_not_pregame",
                    "The saved projection must have been captured before the game started.",
                )
        if projection is not None:
            if requested_micros is not None and (
                requested_micros != projection.projected_net_points_micros
                or (
                    projection_model is not None
                    and projection_model != projection.model_name
                )
                or (
                    projection_version is not None
                    and projection_version != projection.model_version
                )
                or captured_at != projection.captured_at
            ):
                raise api_problem(
                    409,
                    "projection_conflict",
                    "The saved pregame projection already has different data.",
                )
            return projection.projected_net_points_micros
        if requested_micros is None:
            return None
        if (
            projection_model is None
            or projection_version is None
            or captured_at is None
        ):
            raise RuntimeError("validated projection metadata is missing")
        session.add(
            PerGameProjectionRow(
                ruleset_id=ruleset_id,
                game_id=game_id,
                player_id=player_id,
                projected_net_points_micros=requested_micros,
                model_name=projection_model,
                model_version=projection_version,
                captured_at=captured_at,
            )
        )
        session.flush()
        return requested_micros

    @staticmethod
    def _ensure_game_boundary(
        session: Session,
        *,
        ruleset_id: str,
        game_id: str,
        game_date: date,
        game_started_at: datetime | None,
        next_game_date: date | None,
        event_sequence: int,
        enforce_next_game_date: bool,
    ) -> PerGameGameBoundaryRow:
        normalized_start = (
            PerGameService._utc_naive(
                game_started_at,
                field_name="Game start time",
            )
            if game_started_at is not None
            else None
        )
        boundary = session.scalar(
            select(PerGameGameBoundaryRow)
            .where(
                PerGameGameBoundaryRow.ruleset_id == ruleset_id,
                PerGameGameBoundaryRow.game_id == game_id,
            )
            .with_for_update()
        )
        if boundary is None:
            boundary = PerGameGameBoundaryRow(
                ruleset_id=ruleset_id,
                game_id=game_id,
                game_date=game_date,
                started_at=normalized_start,
                next_game_date=next_game_date,
                event_sequence=event_sequence,
            )
            session.add(boundary)
            session.flush()
            return boundary
        if (
            boundary.game_date != game_date
            or boundary.event_sequence != event_sequence
            or (enforce_next_game_date and boundary.next_game_date != next_game_date)
            or (
                normalized_start is not None
                and boundary.started_at is not None
                and boundary.started_at != normalized_start
            )
        ):
            raise api_problem(
                409,
                "game_boundary_conflict",
                "That game already has a different date, schedule, start time, or event sequence.",
            )
        if boundary.started_at is None and normalized_start is not None:
            boundary.started_at = normalized_start
            session.flush()
        return boundary

    @staticmethod
    def _domain_policy(ruleset: PerGameRulesetRow) -> EconomyPolicy:
        return EconomyPolicy(
            ruleset_id=ruleset.id,
            dividend_basis=DividendBasis(ruleset.dividend_basis),
            dividend_dollars_per_net_point=(ruleset.dividend_dollars_per_net_point),
            max_long_positions=ruleset.long_slot_limit,
            max_short_positions=ruleset.short_slot_limit,
            allow_opposing_positions=ruleset.allow_opposing_positions,
            open_quote_impact_bps=ruleset.quote_add_impact_bps,
            drop_quote_impact_bps=ruleset.quote_drop_impact_bps,
            open_fee_dollars=ruleset.transaction_fee_dollars,
            drop_fee_dollars=ruleset.transaction_fee_dollars,
        )

    @staticmethod
    def _domain_quote(quote: PerGameQuoteRow) -> PlayerQuote:
        return PlayerQuote(
            player_id=quote.player_id,
            current_per_game_cost_dollars=quote.current_game_cost_dollars,
            prior_season_value_per_game_dollars=(
                quote.prior_season_value_per_game_dollars
            ),
        )

    @staticmethod
    def _domain_result(
        row: PerGameResultRow,
        fallback_projection_micros: int | None,
    ) -> PlayerGameResult:
        projection = row.saved_projection_net_points_micros
        if projection is None:
            projection = fallback_projection_micros
        return PlayerGameResult(
            game_id=row.game_id,
            player_id=row.player_id,
            sequence=row.event_sequence,
            revision=row.revision,
            actual_net_points=row.actual_net_points_micros / 1_000_000,
            saved_projection_net_points=(
                projection / 1_000_000 if projection is not None else None
            ),
        )

    @staticmethod
    def _append_ledger(
        session: Session,
        *,
        ruleset_id: str,
        account_id: str,
        position_id: str,
        player_id: str,
        kind: str,
        amount_dollars: int,
        source_key: str,
        event_cursor: int,
        game_id: str | None = None,
        game_date: date | None = None,
        result_revision: int | None = None,
        adjusts_entry_id: str | None = None,
    ) -> PerGameLedgerEntryRow:
        safe_amount = PerGameService._safe_money(
            amount_dollars,
            field_name="Ledger amount",
        )
        entry = PerGameLedgerEntryRow(
            id=str(uuid4()),
            ruleset_id=ruleset_id,
            account_id=account_id,
            position_id=position_id,
            player_id=player_id,
            game_id=game_id,
            game_date=game_date,
            result_revision=result_revision,
            kind=kind,
            amount_dollars=safe_amount,
            source_key=source_key,
            adjusts_entry_id=adjusts_entry_id,
            event_cursor=event_cursor,
        )
        session.add(entry)
        return entry

    @staticmethod
    def _add_snapshot(
        session: Session,
        account: PerGameAccountRow,
        *,
        event_cursor: int,
        game_id: str | None = None,
        game_date: date | None = None,
    ) -> None:
        session.add(
            PerGamePnlSnapshotRow(
                ruleset_id=account.ruleset_id,
                account_id=account.account_id,
                event_cursor=event_cursor,
                game_id=game_id,
                game_date=game_date,
                cumulative_pnl_dollars=account.cumulative_pnl_dollars,
                latest_game_pnl_dollars=account.latest_game_pnl_dollars,
            )
        )

    @staticmethod
    def _ruleset_payload(ruleset: PerGameRulesetRow) -> dict[str, object]:
        return {
            "id": ruleset.id,
            "version": ruleset.version,
            "dividend_basis": ruleset.dividend_basis,
            "dividend_dollars_per_net_point": (ruleset.dividend_dollars_per_net_point),
            "long_slot_limit": ruleset.long_slot_limit,
            "short_slot_limit": ruleset.short_slot_limit,
            "allow_opposing_positions": ruleset.allow_opposing_positions,
            "roster_mutations_locked": ruleset.roster_mutations_locked,
            "roster_lock_game_date": (
                ruleset.roster_lock_game_date.isoformat()
                if ruleset.roster_lock_game_date is not None
                else None
            ),
            "quote_add_impact_bps": ruleset.quote_add_impact_bps,
            "quote_drop_impact_bps": ruleset.quote_drop_impact_bps,
            "transaction_fee_dollars": ruleset.transaction_fee_dollars,
            "short_term_days": ruleset.short_term_days,
        }

    @staticmethod
    def _quote_payload(
        session: Session,
        quote: PerGameQuoteRow,
        *,
        player: PlayerListingRow | None = None,
    ) -> dict[str, object]:
        if player is None:
            player = session.get(PlayerListingRow, quote.player_id)
        return {
            "player_id": quote.player_id,
            "name": player.name if player is not None else quote.player_id,
            "tier": player.tier if player is not None else "unknown",
            "quote_version": quote.version,
            "current_game_cost_dollars": quote.current_game_cost_dollars,
            "prior_season_value_per_game_dollars": (
                quote.prior_season_value_per_game_dollars
            ),
        }

    def _account_payload(
        self,
        session: Session,
        ruleset: PerGameRulesetRow,
        account: PerGameAccountRow,
        *,
        active_override: list[PerGamePositionRow] | None = None,
    ) -> dict[str, object]:
        active_positions = active_override
        if active_positions is None:
            active_positions = session.scalars(
                select(PerGamePositionRow).where(
                    PerGamePositionRow.ruleset_id == ruleset.id,
                    PerGamePositionRow.account_id == account.account_id,
                    PerGamePositionRow.status == "active",
                )
            ).all()
        long_used = sum(position.side == "long" for position in active_positions)
        short_used = sum(position.side == "short" for position in active_positions)
        return {
            "account_id": account.account_id,
            "display_name": account.display_name,
            "version": account.version,
            "cumulative_pnl_dollars": account.cumulative_pnl_dollars,
            "latest_game_pnl_dollars": account.latest_game_pnl_dollars,
            "long_slots": {
                "used": long_used,
                "limit": ruleset.long_slot_limit,
                "remaining": max(0, ruleset.long_slot_limit - long_used),
            },
            "short_slots": {
                "used": short_used,
                "limit": ruleset.short_slot_limit,
                "remaining": max(0, ruleset.short_slot_limit - short_used),
            },
        }

    def _position_payload(
        self, session: Session, position: PerGamePositionRow
    ) -> dict[str, object]:
        player = session.get(PlayerListingRow, position.player_id)
        accrual_totals = session.execute(
            select(
                func.coalesce(func.sum(PerGameAccrualRow.game_cost_dollars), 0),
                func.coalesce(func.sum(PerGameAccrualRow.dividend_dollars), 0),
                func.coalesce(func.sum(PerGameAccrualRow.cumulative_pnl_dollars), 0),
            ).where(
                PerGameAccrualRow.ruleset_id == position.ruleset_id,
                PerGameAccrualRow.position_id == position.id,
            )
        ).one()
        lifecycle_fees = int(
            session.scalar(
                select(
                    func.coalesce(func.sum(PerGameLedgerEntryRow.amount_dollars), 0)
                ).where(
                    PerGameLedgerEntryRow.ruleset_id == position.ruleset_id,
                    PerGameLedgerEntryRow.position_id == position.id,
                    PerGameLedgerEntryRow.kind.in_(("open_fee", "drop_fee")),
                )
            )
            or 0
        )
        cumulative_game_cost = self._safe_money(
            int(accrual_totals[0]),
            field_name="Position game costs",
        )
        cumulative_dividend = self._safe_money(
            int(accrual_totals[1]),
            field_name="Position dividends",
        )
        cumulative_pnl = self._safe_money(
            int(accrual_totals[2]) + lifecycle_fees,
            field_name="Position P&L",
        )
        return {
            "position_id": position.id,
            "player_id": position.player_id,
            "player_name": player.name if player is not None else position.player_id,
            "side": position.side,
            "status": position.status,
            "locked_game_cost_dollars": position.locked_game_cost_dollars,
            "opened_event_sequence": position.opened_event_sequence,
            "closed_event_sequence": position.closed_event_sequence,
            "expires_on": (
                position.expires_on.isoformat()
                if position.expires_on is not None
                else None
            ),
            "cumulative_game_cost_dollars": cumulative_game_cost,
            "cumulative_dividend_dollars": cumulative_dividend,
            "cumulative_pnl_dollars": cumulative_pnl,
        }

    @staticmethod
    def _ledger_payload(row: PerGameLedgerEntryRow) -> dict[str, object]:
        return {
            "event_cursor": row.event_cursor,
            "entry_id": row.id,
            "position_id": row.position_id,
            "player_id": row.player_id,
            "game_id": row.game_id,
            "game_date": row.game_date.isoformat() if row.game_date else None,
            "result_revision": row.result_revision,
            "kind": row.kind,
            "amount_dollars": row.amount_dollars,
            "adjusts_entry_id": row.adjusts_entry_id,
            "created_at": row.created_at.isoformat() + "Z",
        }

    @staticmethod
    def _result_payload(row: PerGameResultRow) -> dict[str, object]:
        return {
            "event_cursor": row.event_cursor,
            "game_id": row.game_id,
            "player_id": row.player_id,
            "game_date": row.game_date.isoformat(),
            "event_sequence": row.event_sequence,
            "result_revision": row.revision,
            "kind": row.kind,
            "status": row.status,
            "actual_net_points_micros": row.actual_net_points_micros,
            "saved_projection_net_points_micros": (
                row.saved_projection_net_points_micros
            ),
            "dividend_basis": row.dividend_basis,
            "dividend_dollars_per_net_point": (row.dividend_dollars_per_net_point),
            "dividend_dollars": row.dividend_dollars,
            "adjusts_result_revision": row.adjusts_result_revision,
        }

    def _settled_result_payload(
        self, session: Session, accrual: PerGameAccrualRow
    ) -> dict[str, object]:
        result = session.get(
            PerGameResultRow,
            {
                "ruleset_id": accrual.ruleset_id,
                "game_id": accrual.game_id,
                "player_id": accrual.player_id,
                "revision": accrual.latest_result_revision,
            },
        )
        return {
            "event_cursor": accrual.event_cursor,
            "position_id": accrual.position_id,
            "player_id": accrual.player_id,
            "game_id": accrual.game_id,
            "game_date": accrual.game_date.isoformat(),
            "result_revision": accrual.latest_result_revision,
            "side": accrual.side,
            "kind": result.kind if result is not None else "base",
            "status": accrual.status,
            "locked_game_cost_dollars": accrual.locked_game_cost_dollars,
            "dividend_dollars": accrual.dividend_dollars,
            "net_pnl_dollars": (
                accrual.cumulative_pnl_dollars if accrual.status == "settled" else None
            ),
            "adjusts_result_revision": (
                result.adjusts_result_revision if result is not None else None
            ),
        }
