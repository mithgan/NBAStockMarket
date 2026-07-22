from __future__ import annotations

import copy
import hashlib
import json
import math
import threading
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from typing import Literal
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from nba_stock_market.api.auth import Principal
from nba_stock_market.api.database import (
    AccountRow,
    BoostRow,
    Database,
    DividendRow,
    GAME_STATE_ID,
    GameStateRow,
    HoldingRow,
    InstrumentCommandRow,
    PlayerListingRow,
    ReplayEventRow,
    SettlementRow,
    TradeRow,
    WeeklyShortRow,
    utcnow,
)
from nba_stock_market.engine import (
    FEE_PCT,
    FLIP_SURCHARGE_CAP_PCT,
    FLIP_SURCHARGE_PCT,
    IMPACT_K,
    STARTING_CASH,
)
from nba_stock_market.instruments import (
    BOOST_FEE_PCT,
    BOOST_SLOTS,
    DOLLARS_PER_NET_POINT,
    MAX_WEEKLY_SHORTS_PER_PLAYER,
    SHORT_FEE_PCT,
    SHORT_MIN_FEE,
    WEEKLY_GAME_CLAMP_NP,
    WEEKLY_SHORT_COLLATERAL,
    WEEKLY_SHORT_SLOTS,
    WEEKLY_TOTAL_CLAMP_NP,
)


WEEKLY_SHORT_COLLATERAL_CENTS = round(WEEKLY_SHORT_COLLATERAL * 100)
SHORT_MIN_FEE_CENTS = round(SHORT_MIN_FEE * 100)
WEEKLY_GAME_CLAMP_MICROS = round(WEEKLY_GAME_CLAMP_NP * 1_000_000)
WEEKLY_TOTAL_CLAMP_MICROS = round(WEEKLY_TOTAL_CLAMP_NP * 1_000_000)
DOLLARS_PER_NET_POINT_MICRO_CENTS = round(
    DOLLARS_PER_NET_POINT * 100 / 1_000_000
)


def week_start_for(value: date) -> date:
    return value - timedelta(days=value.weekday())


class ApiProblem(ValueError):
    def __init__(self, *, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


class KeyedLockRegistry:
    """Serialize conflicts through a fixed lock stripe set.

    PostgreSQL row locks remain authoritative across processes. Fixed striping
    prevents untrusted account or player identifiers from growing local memory.
    """

    def __init__(self, *, stripe_count: int = 256) -> None:
        if stripe_count <= 0:
            raise ValueError("stripe_count must be positive")
        self._locks = tuple(threading.RLock() for _ in range(stripe_count))

    @property
    def stripe_count(self) -> int:
        return len(self._locks)

    def _stripe(self, key: str) -> int:
        digest = hashlib.blake2b(key.encode("utf-8"), digest_size=8).digest()
        return int.from_bytes(digest, "big") % self.stripe_count

    @contextmanager
    def acquire(self, *keys: str):
        indices = sorted({self._stripe(key) for key in keys})
        locks = [self._locks[index] for index in indices]
        for lock in locks:
            lock.acquire()
        try:
            yield
        finally:
            for lock in reversed(locks):
                lock.release()


class MarketService:
    def __init__(self, database: Database, locks: KeyedLockRegistry | None = None) -> None:
        self.database = database
        self.locks = locks or KeyedLockRegistry()

    def market(self, principal: Principal) -> list[dict[str, object]]:
        with self.database.session() as session, session.begin():
            self._ensure_account(session, principal)
            cutoff = utcnow() - timedelta(days=30)
            volumes = (
                select(
                    TradeRow.player_id.label("player_id"),
                    func.count(TradeRow.id).label("volume_30d"),
                )
                .where(TradeRow.created_at >= cutoff)
                .group_by(TradeRow.player_id)
                .subquery()
            )
            rows = session.execute(
                select(
                    PlayerListingRow,
                    func.coalesce(volumes.c.volume_30d, 0),
                )
                .outerjoin(volumes, volumes.c.player_id == PlayerListingRow.id)
                .order_by(PlayerListingRow.name)
            ).all()
            return [
                self._listing_payload(player, volume_30d=int(volume_30d))
                for player, volume_30d in rows
            ]

    def portfolio(self, principal: Principal) -> dict[str, object]:
        with self.locks.acquire(f"account:{principal.id}"):
            with self.database.session() as session, session.begin():
                account = self._ensure_account(session, principal, for_update=True)
                return self._portfolio_payload(session, account)

    def instruments(self, principal: Principal) -> dict[str, object]:
        with self.locks.acquire(f"account:{principal.id}"):
            with self.database.session() as session, session.begin():
                account = self._ensure_account(session, principal, for_update=True)
                return self._instrument_summary(session, account)

    def arm_weekly_short(
        self,
        principal: Principal,
        *,
        player_id: str,
        idempotency_key: str,
    ) -> dict[str, object]:
        fingerprint = self._instrument_fingerprint(
            "weekly_short",
            {"player_id": player_id},
        )
        with self.locks.acquire(f"account:{principal.id}", f"player:{player_id}"):
            with self.database.market_write_transaction(
                settlement_exclusive=False
            ) as session:
                account = self._ensure_account(session, principal, for_update=True)
                replay = self._instrument_replay(
                    session,
                    account_id=account.id,
                    idempotency_key=idempotency_key,
                    fingerprint=fingerprint,
                )
                if replay is not None:
                    return replay

                state = self._available_game_state(session)
                assert state.next_game_date is not None
                current_date = state.next_game_date
                week_start = week_start_for(current_date)
                week_end = week_start + timedelta(days=7)
                player = session.scalar(
                    select(PlayerListingRow)
                    .where(PlayerListingRow.id == player_id)
                    .with_for_update()
                )
                if player is None:
                    raise ApiProblem(
                        status_code=404,
                        code="player_not_found",
                        message="Player is not listed.",
                    )
                holding = session.get(HoldingRow, (account.id, player_id))
                if holding is not None:
                    raise ApiProblem(
                        status_code=409,
                        code="player_held",
                        message="You cannot short a player you hold.",
                    )
                prior_game = session.scalar(
                    select(func.count())
                    .select_from(ReplayEventRow)
                    .where(
                        ReplayEventRow.player_id == player_id,
                        ReplayEventRow.game_date >= week_start,
                        ReplayEventRow.game_date < current_date,
                    )
                )
                if prior_game:
                    raise ApiProblem(
                        status_code=409,
                        code="player_already_played",
                        message="This player has already played in the current week.",
                    )
                future_projection = session.scalar(
                    select(func.count())
                    .select_from(ReplayEventRow)
                    .where(
                        ReplayEventRow.player_id == player_id,
                        ReplayEventRow.game_date >= current_date,
                        ReplayEventRow.game_date < week_end,
                        ReplayEventRow.projected_minutes_micros.is_not(None),
                    )
                )
                if not future_projection:
                    raise ApiProblem(
                        status_code=409,
                        code="projection_unavailable",
                        message="No published projection is available this week.",
                    )
                boost_conflict = session.scalar(
                    select(func.count())
                    .select_from(BoostRow)
                    .where(
                        BoostRow.account_id == account.id,
                        BoostRow.player_id == player_id,
                        BoostRow.week_start == week_start,
                        BoostRow.status != "refunded",
                    )
                )
                if boost_conflict:
                    raise ApiProblem(
                        status_code=409,
                        code="boost_conflict",
                        message="You already boosted this player this week.",
                    )
                existing_position = session.scalar(
                    select(func.count())
                    .select_from(WeeklyShortRow)
                    .where(
                        WeeklyShortRow.account_id == account.id,
                        WeeklyShortRow.player_id == player_id,
                        WeeklyShortRow.week_start == week_start,
                    )
                )
                if existing_position:
                    raise ApiProblem(
                        status_code=409,
                        code="active_short",
                        message="You already used a short on this player this week.",
                    )
                user_slots = session.scalar(
                    select(func.count())
                    .select_from(WeeklyShortRow)
                    .where(
                        WeeklyShortRow.account_id == account.id,
                        WeeklyShortRow.week_start == week_start,
                        WeeklyShortRow.status == "active",
                    )
                ) or 0
                if user_slots >= WEEKLY_SHORT_SLOTS:
                    raise ApiProblem(
                        status_code=409,
                        code="short_slots_full",
                        message="All weekly short slots are in use.",
                    )
                player_slots = session.scalar(
                    select(func.count())
                    .select_from(WeeklyShortRow)
                    .where(
                        WeeklyShortRow.player_id == player_id,
                        WeeklyShortRow.week_start == week_start,
                        WeeklyShortRow.status == "active",
                    )
                ) or 0
                if player_slots >= MAX_WEEKLY_SHORTS_PER_PLAYER:
                    raise ApiProblem(
                        status_code=409,
                        code="player_short_cap",
                        message="This player has reached the league-wide short cap.",
                    )

                fee_cents = max(
                    SHORT_MIN_FEE_CENTS,
                    round(player.current_price_cents * SHORT_FEE_PCT),
                )
                free_cash = self._free_cash_cents(session, account)
                if free_cash < fee_cents + WEEKLY_SHORT_COLLATERAL_CENTS:
                    raise ApiProblem(
                        status_code=409,
                        code="insufficient_cash",
                        message="Not enough free cash for the fee and collateral.",
                    )

                now = utcnow()
                account.cash_cents -= fee_cents
                account.version += 1
                position = WeeklyShortRow(
                    id=str(uuid4()),
                    account_id=account.id,
                    player_id=player.id,
                    week_start=week_start,
                    status="active",
                    opening_price_cents=player.current_price_cents,
                    fee_cents=fee_cents,
                    collateral_cents=WEEKLY_SHORT_COLLATERAL_CENTS,
                    accrued_net_points_micros=0,
                    qualifying_games=0,
                    created_at=now,
                    updated_at=now,
                )
                session.add(position)
                session.flush()
                payload: dict[str, object] = {
                    "replayed": False,
                    "position": self._weekly_short_payload(position),
                    "portfolio": self._portfolio_payload(session, account),
                }
                self._record_instrument_command(
                    session,
                    account_id=account.id,
                    kind="weekly_short",
                    position_id=position.id,
                    idempotency_key=idempotency_key,
                    fingerprint=fingerprint,
                    payload=payload,
                    now=now,
                )
                return payload

    def arm_boost(
        self,
        principal: Principal,
        *,
        player_id: str,
        game_date: date,
        idempotency_key: str,
    ) -> dict[str, object]:
        fingerprint = self._instrument_fingerprint(
            "boost",
            {"player_id": player_id, "game_date": game_date.isoformat()},
        )
        with self.locks.acquire(f"account:{principal.id}", f"player:{player_id}"):
            with self.database.market_write_transaction(
                settlement_exclusive=False
            ) as session:
                account = self._ensure_account(session, principal, for_update=True)
                replay = self._instrument_replay(
                    session,
                    account_id=account.id,
                    idempotency_key=idempotency_key,
                    fingerprint=fingerprint,
                )
                if replay is not None:
                    return replay

                state = self._available_game_state(session)
                assert state.next_game_date is not None
                current_date = state.next_game_date
                week_start = week_start_for(current_date)
                if game_date < current_date or week_start_for(game_date) != week_start:
                    raise ApiProblem(
                        status_code=409,
                        code="invalid_boost_date",
                        message="Boosts must target an unsettled game this week.",
                    )
                player = session.scalar(
                    select(PlayerListingRow)
                    .where(PlayerListingRow.id == player_id)
                    .with_for_update()
                )
                if player is None:
                    raise ApiProblem(
                        status_code=404,
                        code="player_not_found",
                        message="Player is not listed.",
                    )
                event = session.scalar(
                    select(ReplayEventRow).where(
                        ReplayEventRow.player_id == player_id,
                        ReplayEventRow.game_date == game_date,
                    )
                )
                if event is None or event.projected_minutes_micros is None:
                    raise ApiProblem(
                        status_code=409,
                        code="projection_unavailable",
                        message="No published projection is available for that game.",
                    )
                holding = session.get(HoldingRow, (account.id, player_id))
                if holding is None:
                    raise ApiProblem(
                        status_code=409,
                        code="player_not_held",
                        message="Boosts require holding the player.",
                    )
                short_conflict = session.scalar(
                    select(func.count())
                    .select_from(WeeklyShortRow)
                    .where(
                        WeeklyShortRow.account_id == account.id,
                        WeeklyShortRow.player_id == player_id,
                        WeeklyShortRow.week_start == week_start,
                        WeeklyShortRow.status == "active",
                    )
                )
                if short_conflict:
                    raise ApiProblem(
                        status_code=409,
                        code="short_conflict",
                        message="You are shorting this player this week.",
                    )
                existing_position = session.scalar(
                    select(func.count())
                    .select_from(BoostRow)
                    .where(
                        BoostRow.account_id == account.id,
                        BoostRow.player_id == player_id,
                        BoostRow.status == "armed",
                    )
                )
                if existing_position:
                    raise ApiProblem(
                        status_code=409,
                        code="active_boost",
                        message="You already have an armed boost for this player.",
                    )
                boosts_used = session.scalar(
                    select(func.count())
                    .select_from(BoostRow)
                    .where(
                        BoostRow.account_id == account.id,
                        BoostRow.week_start == week_start,
                        BoostRow.status != "refunded",
                    )
                ) or 0
                if boosts_used >= BOOST_SLOTS:
                    raise ApiProblem(
                        status_code=409,
                        code="boost_slots_full",
                        message="All boost slots are used this week.",
                    )

                fee_cents = round(player.current_price_cents * BOOST_FEE_PCT)
                if self._free_cash_cents(session, account) < fee_cents:
                    raise ApiProblem(
                        status_code=409,
                        code="insufficient_cash",
                        message="Not enough free cash for the boost fee.",
                    )

                now = utcnow()
                account.cash_cents -= fee_cents
                account.version += 1
                position = BoostRow(
                    id=str(uuid4()),
                    account_id=account.id,
                    player_id=player.id,
                    week_start=week_start,
                    target_game_date=game_date,
                    status="armed",
                    opening_price_cents=player.current_price_cents,
                    fee_cents=fee_cents,
                    created_at=now,
                    updated_at=now,
                )
                session.add(position)
                session.flush()
                payload = {
                    "replayed": False,
                    "position": self._boost_payload(position),
                    "portfolio": self._portfolio_payload(session, account),
                }
                self._record_instrument_command(
                    session,
                    account_id=account.id,
                    kind="boost",
                    position_id=position.id,
                    idempotency_key=idempotency_key,
                    fingerprint=fingerprint,
                    payload=payload,
                    now=now,
                )
                return payload

    def game_state(self, principal: Principal) -> dict[str, object]:
        with self.database.session() as session, session.begin():
            self._ensure_account(session, principal)
            state = session.get(GameStateRow, GAME_STATE_ID)
            if state is None:
                raise ApiProblem(
                    status_code=503,
                    code="game_unavailable",
                    message="Historical replay data is not available.",
                )
            return self._game_state_payload(state)

    def settlement_history(
        self,
        principal: Principal,
        *,
        limit: int,
    ) -> list[dict[str, object]]:
        with self.database.session() as session, session.begin():
            self._ensure_account(session, principal)
            settlements = session.scalars(
                select(SettlementRow)
                .order_by(SettlementRow.game_date.desc())
                .limit(limit)
            ).all()
            history: list[dict[str, object]] = []
            for settlement in settlements:
                user_dividend = session.scalar(
                    select(func.coalesce(func.sum(DividendRow.amount_cents), 0)).where(
                        DividendRow.account_id == principal.id,
                        DividendRow.game_date == settlement.game_date,
                    )
                )
                history.append(
                    {
                        "game_date": settlement.game_date.isoformat(),
                        "event_count": settlement.event_count,
                        "payout_count": settlement.payout_count,
                        "net_cash_cents": settlement.net_cash_cents,
                        "current_user_dividend_cents": int(user_dividend or 0),
                        "settled_at": settlement.settled_at.isoformat() + "Z",
                    }
                )
            return history

    def settle_next(
        self,
        *,
        expected_game_date: date,
        idempotency_key: str,
    ) -> dict[str, object]:
        fingerprint = hashlib.sha256(
            json.dumps(
                {"expected_game_date": expected_game_date.isoformat()},
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()
        with self.locks.acquire("settlement:global"):
            with self.database.market_write_transaction(
                settlement_exclusive=True
            ) as session:
                state = session.scalar(
                    select(GameStateRow)
                    .where(GameStateRow.id == GAME_STATE_ID)
                    .with_for_update()
                )
                if state is None:
                    raise ApiProblem(
                        status_code=503,
                        code="game_unavailable",
                        message="Historical replay data is not available.",
                    )

                existing = session.scalar(
                    select(SettlementRow).where(
                        SettlementRow.idempotency_key == idempotency_key
                    )
                )
                if existing is not None:
                    if existing.request_fingerprint != fingerprint:
                        raise ApiProblem(
                            status_code=409,
                            code="idempotency_conflict",
                            message="Idempotency key was already used for another request.",
                        )
                    replay = copy.deepcopy(existing.response_payload)
                    replay["replayed"] = True
                    return replay

                if state.next_game_date is None:
                    raise ApiProblem(
                        status_code=409,
                        code="replay_complete",
                        message="The historical replay is complete.",
                    )
                if state.next_game_date != expected_game_date:
                    raise ApiProblem(
                        status_code=409,
                        code="clock_conflict",
                        message="Expected game date does not match the server clock.",
                    )

                events = session.scalars(
                    select(ReplayEventRow)
                    .where(ReplayEventRow.game_date == expected_game_date)
                    .order_by(ReplayEventRow.player_id)
                ).all()
                if not events:
                    raise ApiProblem(
                        status_code=503,
                        code="replay_data_missing",
                        message="No replay events exist for the server clock date.",
                    )
                next_game_date = session.scalar(
                    select(func.min(ReplayEventRow.game_date)).where(
                        ReplayEventRow.game_date > expected_game_date
                    )
                )
                now = utcnow()
                settlement = SettlementRow(
                    game_date=expected_game_date,
                    season_id=state.season_id,
                    idempotency_key=idempotency_key,
                    request_fingerprint=fingerprint,
                    event_count=len(events),
                    payout_count=0,
                    net_cash_cents=0,
                    response_payload={},
                    settled_at=now,
                )
                session.add(settlement)
                session.flush()
                cash_result = self._apply_dividends(
                    session,
                    game_date=expected_game_date,
                    next_game_date=next_game_date,
                    events=events,
                    now=now,
                )

                state.last_settled_date = expected_game_date
                state.next_game_date = next_game_date
                state.version += 1
                settlement.payout_count = cash_result["payout_count"]
                settlement.net_cash_cents = cash_result["net_cash_cents"]
                payload: dict[str, object] = {
                    "replayed": False,
                    "game_date": expected_game_date.isoformat(),
                    "next_game_date": (
                        next_game_date.isoformat() if next_game_date is not None else None
                    ),
                    "is_complete": next_game_date is None,
                    "event_count": len(events),
                    "payout_count": cash_result["payout_count"],
                    "net_cash_cents": cash_result["net_cash_cents"],
                    "cash_breakdown_cents": cash_result["cash_breakdown_cents"],
                }
                settlement.response_payload = copy.deepcopy(payload)
                return payload

    def _apply_dividends(
        self,
        session: Session,
        *,
        game_date: date,
        next_game_date: date | None,
        events: list[ReplayEventRow],
        now: datetime,
    ) -> dict[str, object]:
        event_by_player = {event.player_id: event for event in events}
        player_ids = sorted(event_by_player)
        current_week = week_start_for(game_date)
        closes_week = (
            next_game_date is None
            or week_start_for(next_game_date) != current_week
        )

        holding_account_ids = set(
            session.scalars(
                select(HoldingRow.account_id).where(
                    HoldingRow.player_id.in_(player_ids)
                )
            )
        )
        short_query = select(WeeklyShortRow.account_id).where(
            WeeklyShortRow.week_start == current_week,
            WeeklyShortRow.status == "active",
        )
        if not closes_week:
            short_query = short_query.where(
                WeeklyShortRow.player_id.in_(player_ids)
            )
        short_account_ids = set(session.scalars(short_query))
        boost_query = select(BoostRow.account_id).where(
            BoostRow.status == "armed",
            BoostRow.target_game_date == game_date,
        )
        if closes_week:
            boost_query = select(BoostRow.account_id).where(
                BoostRow.status == "armed",
                BoostRow.week_start == current_week,
            )
        boost_account_ids = set(session.scalars(boost_query))
        affected_account_ids = sorted(
            holding_account_ids | short_account_ids | boost_account_ids
        )
        accounts = {
            account.id: account
            for account in session.scalars(
                select(AccountRow)
                .where(AccountRow.id.in_(affected_account_ids))
                .order_by(AccountRow.id)
                .with_for_update()
            )
        }

        holding_rows = session.scalars(
            select(HoldingRow)
            .where(HoldingRow.player_id.in_(player_ids))
            .order_by(HoldingRow.account_id, HoldingRow.player_id)
        ).all()
        account_totals: dict[str, int] = {}
        dividend_total = 0
        for holding in holding_rows:
            event = event_by_player[holding.player_id]
            session.add(
                DividendRow(
                    account_id=holding.account_id,
                    game_date=game_date,
                    player_id=event.player_id,
                    amount_cents=event.dividend_cents,
                    created_at=now,
                )
            )
            account_totals[holding.account_id] = (
                account_totals.get(holding.account_id, 0) + event.dividend_cents
            )
            dividend_total += event.dividend_cents

        weekly_shorts = session.scalars(
            select(WeeklyShortRow)
            .where(
                WeeklyShortRow.week_start == current_week,
                WeeklyShortRow.status == "active",
            )
            .order_by(WeeklyShortRow.account_id, WeeklyShortRow.player_id)
            .with_for_update()
        ).all()
        for position in weekly_shorts:
            event = event_by_player.get(position.player_id)
            if event is None or not event.qualifies_for_instruments:
                continue
            surprise_micros = (
                event.actual_net_points_micros
                - event.expected_net_points_micros
            )
            position.accrued_net_points_micros += -max(
                -WEEKLY_GAME_CLAMP_MICROS,
                min(WEEKLY_GAME_CLAMP_MICROS, surprise_micros),
            )
            position.qualifying_games += 1
            position.updated_at = now

        boosts = session.scalars(
            select(BoostRow)
            .where(
                BoostRow.status == "armed",
                BoostRow.week_start == current_week,
            )
            .order_by(BoostRow.account_id, BoostRow.player_id)
            .with_for_update()
        ).all()
        boost_total = 0
        boost_settlement_count = 0
        for boost in boosts:
            if boost.target_game_date != game_date:
                continue
            event = event_by_player.get(boost.player_id)
            if event is not None and event.qualifies_for_instruments:
                cash_delta_cents = event.dividend_cents
                payout_cents = event.dividend_cents
                boost.status = "consumed"
            else:
                cash_delta_cents = boost.fee_cents
                payout_cents = 0
                boost.status = "refunded"
            boost.payout_cents = payout_cents
            boost.settled_game_date = game_date
            boost.updated_at = now
            account_totals[boost.account_id] = (
                account_totals.get(boost.account_id, 0) + cash_delta_cents
            )
            boost_total += cash_delta_cents
            boost_settlement_count += 1

        short_total = 0
        short_settlement_count = 0
        if closes_week:
            for boost in boosts:
                if boost.status != "armed":
                    continue
                boost.status = "refunded"
                boost.payout_cents = 0
                boost.settled_game_date = game_date
                boost.updated_at = now
                account_totals[boost.account_id] = (
                    account_totals.get(boost.account_id, 0) + boost.fee_cents
                )
                boost_total += boost.fee_cents
                boost_settlement_count += 1

            for position in weekly_shorts:
                if position.qualifying_games == 0:
                    payout_cents = position.fee_cents
                    position.status = "voided"
                else:
                    clamped_micros = max(
                        -WEEKLY_TOTAL_CLAMP_MICROS,
                        min(
                            WEEKLY_TOTAL_CLAMP_MICROS,
                            position.accrued_net_points_micros,
                        ),
                    )
                    payout_cents = (
                        clamped_micros * DOLLARS_PER_NET_POINT_MICRO_CENTS
                    )
                    position.status = "settled"
                position.payout_cents = payout_cents if position.status == "settled" else 0
                position.settled_game_date = game_date
                position.updated_at = now
                account_totals[position.account_id] = (
                    account_totals.get(position.account_id, 0) + payout_cents
                )
                short_total += payout_cents
                short_settlement_count += 1

        for account_id, amount_cents in account_totals.items():
            account = accounts[account_id]
            account.cash_cents += amount_cents
            account.version += 1
        return {
            "payout_count": (
                len(holding_rows)
                + boost_settlement_count
                + short_settlement_count
            ),
            "net_cash_cents": sum(account_totals.values()),
            "cash_breakdown_cents": {
                "dividends": dividend_total,
                "boosts": boost_total,
                "weekly_shorts": short_total,
            },
        }

    def leaderboard(
        self,
        principal: Principal,
        *,
        limit: int,
    ) -> list[dict[str, object]]:
        with self.database.session() as session, session.begin():
            self._ensure_account(session, principal)
            holding_value = func.coalesce(
                func.sum(HoldingRow.shares * PlayerListingRow.current_price_cents),
                0,
            )
            rows = session.execute(
                select(
                    AccountRow.id,
                    AccountRow.display_name,
                    (AccountRow.cash_cents + holding_value).label("total_value_cents"),
                )
                .outerjoin(HoldingRow, HoldingRow.account_id == AccountRow.id)
                .outerjoin(
                    PlayerListingRow,
                    PlayerListingRow.id == HoldingRow.player_id,
                )
                .group_by(
                    AccountRow.id,
                    AccountRow.display_name,
                    AccountRow.cash_cents,
                )
            ).all()
            ordered = sorted(
                (
                    (account_id, display_name, int(total_value_cents))
                    for account_id, display_name, total_value_cents in rows
                ),
                key=lambda row: (-row[2], row[0]),
            )[:limit]
            return [
                {
                    "rank": index,
                    "account_id": account_id,
                    "display_name": display_name,
                    "total_value_cents": total_value,
                    "return_bps": round(
                        (total_value - round(STARTING_CASH * 100))
                        * 10_000
                        / round(STARTING_CASH * 100)
                    ),
                    "is_current_user": account_id == principal.id,
                }
                for index, (account_id, display_name, total_value) in enumerate(
                    ordered,
                    start=1,
                )
            ]

    def execute_trade(
        self,
        principal: Principal,
        *,
        player_id: str,
        side: Literal["buy", "sell"],
        idempotency_key: str,
    ) -> dict[str, object]:
        fingerprint = hashlib.sha256(
            json.dumps(
                {"player_id": player_id, "side": side},
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()
        with self.locks.acquire(f"account:{principal.id}", f"player:{player_id}"):
            with self.database.market_write_transaction(
                settlement_exclusive=False
            ) as session:
                account = self._ensure_account(session, principal, for_update=True)
                existing = session.scalar(
                    select(TradeRow).where(
                        TradeRow.account_id == account.id,
                        TradeRow.idempotency_key == idempotency_key,
                    )
                )
                if existing is not None:
                    if existing.request_fingerprint != fingerprint:
                        raise ApiProblem(
                            status_code=409,
                            code="idempotency_conflict",
                            message="Idempotency key was already used for another request.",
                        )
                    replay = copy.deepcopy(existing.response_payload)
                    replay["replayed"] = True
                    return replay

                player = session.scalar(
                    select(PlayerListingRow)
                    .where(PlayerListingRow.id == player_id)
                    .with_for_update()
                )
                if player is None:
                    raise ApiProblem(
                        status_code=404,
                        code="player_not_found",
                        message="Player is not listed.",
                    )
                holding = session.scalar(
                    select(HoldingRow)
                    .where(
                        HoldingRow.account_id == account.id,
                        HoldingRow.player_id == player_id,
                    )
                    .with_for_update()
                )
                active_short = session.scalar(
                    select(func.count())
                    .select_from(WeeklyShortRow)
                    .where(
                        WeeklyShortRow.account_id == account.id,
                        WeeklyShortRow.player_id == player_id,
                        WeeklyShortRow.status == "active",
                    )
                )
                armed_boost = session.scalar(
                    select(func.count())
                    .select_from(BoostRow)
                    .where(
                        BoostRow.account_id == account.id,
                        BoostRow.player_id == player_id,
                        BoostRow.status == "armed",
                    )
                )

                now = utcnow()
                volume_30d = session.scalar(
                    select(func.count(TradeRow.id)).where(
                        TradeRow.player_id == player_id,
                        TradeRow.created_at >= now - timedelta(days=30),
                    )
                ) or 0
                last_trade = session.scalar(
                    select(TradeRow)
                    .where(
                        TradeRow.account_id == account.id,
                        TradeRow.player_id == player_id,
                    )
                    .order_by(TradeRow.created_at.desc(), TradeRow.id.desc())
                    .limit(1)
                )
                is_roundtrip = bool(
                    last_trade
                    and last_trade.side != side
                    and now - last_trade.created_at <= timedelta(days=1)
                )
                roundtrips = 0
                if is_roundtrip:
                    roundtrips = session.scalar(
                        select(func.count(TradeRow.id)).where(
                            TradeRow.account_id == account.id,
                            TradeRow.player_id == player_id,
                            TradeRow.is_roundtrip.is_(True),
                            TradeRow.created_at >= now - timedelta(days=7),
                        )
                    ) or 0

                execution_price = player.current_price_cents
                fee_rate = FEE_PCT
                if is_roundtrip:
                    fee_rate += min(
                        FLIP_SURCHARGE_PCT * (1 + roundtrips),
                        FLIP_SURCHARGE_CAP_PCT,
                    )
                fee_cents = round(execution_price * fee_rate)

                if side == "buy":
                    if active_short:
                        raise ApiProblem(
                            status_code=409,
                            code="active_short",
                            message="You cannot buy a player you are shorting.",
                        )
                    if holding is not None:
                        raise ApiProblem(
                            status_code=409,
                            code="holding_cap",
                            message="You already own this player.",
                        )
                    if player.held_shares >= player.shares_outstanding:
                        raise ApiProblem(
                            status_code=409,
                            code="float_exhausted",
                            message="No shares remain for this player.",
                        )
                    if (
                        self._free_cash_cents(session, account)
                        < execution_price + fee_cents
                    ):
                        raise ApiProblem(
                            status_code=409,
                            code="insufficient_cash",
                            message="Not enough cash for this trade and fee.",
                        )
                else:
                    if holding is None:
                        raise ApiProblem(
                            status_code=409,
                            code="not_owned",
                            message="You do not own this player.",
                        )
                    if armed_boost:
                        raise ApiProblem(
                            status_code=409,
                            code="active_boost",
                            message="You cannot sell a player with an armed boost.",
                        )

                ownership_pct = 100 * player.held_shares / player.shares_outstanding
                depth = 1.0 + 0.05 * volume_30d + 0.10 * ownership_pct
                direction = 1 if side == "buy" else -1
                new_price = max(
                    35_000_000,
                    round(execution_price * math.exp(IMPACT_K * direction / depth)),
                )

                if side == "buy":
                    account.cash_cents -= execution_price + fee_cents
                    player.held_shares += 1
                    session.add(
                        HoldingRow(
                            account_id=account.id,
                            player_id=player.id,
                            shares=1,
                            average_cost_cents=execution_price + fee_cents,
                        )
                    )
                else:
                    account.cash_cents += execution_price - fee_cents
                    player.held_shares -= 1
                    session.delete(holding)

                player.current_price_cents = new_price
                player.version += 1
                account.version += 1
                trade = TradeRow(
                    id=str(uuid4()),
                    account_id=account.id,
                    player_id=player.id,
                    side=side,
                    execution_price_cents=execution_price,
                    fee_cents=fee_cents,
                    new_price_cents=new_price,
                    idempotency_key=idempotency_key,
                    request_fingerprint=fingerprint,
                    is_roundtrip=is_roundtrip,
                    response_payload={},
                    created_at=now,
                )
                session.add(trade)
                session.flush()
                payload = {
                    "replayed": False,
                    "trade": self._trade_payload(trade),
                    "portfolio": self._portfolio_payload(session, account),
                }
                trade.response_payload = copy.deepcopy(payload)
                return payload

    def _ensure_account(
        self,
        session: Session,
        principal: Principal,
        *,
        for_update: bool = False,
    ) -> AccountRow:
        query = select(AccountRow).where(AccountRow.id == principal.id)
        if for_update:
            query = query.with_for_update()
        account = session.scalar(query)
        if account is not None:
            return account
        account = AccountRow(
            id=principal.id,
            display_name=principal.display_name,
            cash_cents=round(STARTING_CASH * 100),
        )
        try:
            with session.begin_nested():
                session.add(account)
                session.flush()
        except IntegrityError:
            account = session.scalar(query)
            if account is None:
                raise
        return account

    @staticmethod
    def _instrument_fingerprint(
        kind: str,
        body: dict[str, object],
    ) -> str:
        return hashlib.sha256(
            json.dumps(
                {"kind": kind, **body},
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()

    @staticmethod
    def _instrument_replay(
        session: Session,
        *,
        account_id: str,
        idempotency_key: str,
        fingerprint: str,
    ) -> dict[str, object] | None:
        command = session.scalar(
            select(InstrumentCommandRow).where(
                InstrumentCommandRow.account_id == account_id,
                InstrumentCommandRow.idempotency_key == idempotency_key,
            )
        )
        if command is None:
            return None
        if command.request_fingerprint != fingerprint:
            raise ApiProblem(
                status_code=409,
                code="idempotency_conflict",
                message="Idempotency key was already used for another request.",
            )
        replay = copy.deepcopy(command.response_payload)
        replay["replayed"] = True
        return replay

    @staticmethod
    def _record_instrument_command(
        session: Session,
        *,
        account_id: str,
        kind: str,
        position_id: str,
        idempotency_key: str,
        fingerprint: str,
        payload: dict[str, object],
        now: datetime,
    ) -> None:
        session.add(
            InstrumentCommandRow(
                id=str(uuid4()),
                account_id=account_id,
                kind=kind,
                position_id=position_id,
                idempotency_key=idempotency_key,
                request_fingerprint=fingerprint,
                response_payload=copy.deepcopy(payload),
                created_at=now,
            )
        )

    @staticmethod
    def _available_game_state(session: Session) -> GameStateRow:
        state = session.get(GameStateRow, GAME_STATE_ID)
        if state is None:
            raise ApiProblem(
                status_code=503,
                code="game_unavailable",
                message="Historical replay data is not available.",
            )
        if state.next_game_date is None:
            raise ApiProblem(
                status_code=409,
                code="replay_complete",
                message="The historical replay is complete.",
            )
        return state

    @staticmethod
    def _reserved_collateral_cents(
        session: Session,
        account_id: str,
    ) -> int:
        reserved = session.scalar(
            select(func.coalesce(func.sum(WeeklyShortRow.collateral_cents), 0)).where(
                WeeklyShortRow.account_id == account_id,
                WeeklyShortRow.status == "active",
            )
        )
        return int(reserved or 0)

    def _free_cash_cents(self, session: Session, account: AccountRow) -> int:
        return account.cash_cents - self._reserved_collateral_cents(
            session,
            account.id,
        )

    def _instrument_summary(
        self,
        session: Session,
        account: AccountRow,
    ) -> dict[str, object]:
        state = session.get(GameStateRow, GAME_STATE_ID)
        reference_date = None
        if state is not None:
            reference_date = state.next_game_date or state.last_settled_date
        week_start = week_start_for(reference_date) if reference_date is not None else None
        shorts = session.scalars(
            select(WeeklyShortRow)
            .where(WeeklyShortRow.account_id == account.id)
            .order_by(WeeklyShortRow.created_at.desc(), WeeklyShortRow.id.desc())
        ).all()
        boosts = session.scalars(
            select(BoostRow)
            .where(BoostRow.account_id == account.id)
            .order_by(BoostRow.created_at.desc(), BoostRow.id.desc())
        ).all()
        current_shorts = (
            sum(
                position.week_start == week_start and position.status == "active"
                for position in shorts
            )
            if week_start is not None
            else 0
        )
        current_boosts = (
            sum(
                position.week_start == week_start and position.status != "refunded"
                for position in boosts
            )
            if week_start is not None
            else 0
        )
        reserved = sum(
            position.collateral_cents
            for position in shorts
            if position.status == "active"
        )
        return {
            "week_start": week_start.isoformat() if week_start is not None else None,
            "reserved_collateral_cents": reserved,
            "free_cash_cents": account.cash_cents - reserved,
            "weekly_short_slots": {
                "limit": WEEKLY_SHORT_SLOTS,
                "used": current_shorts,
                "remaining": max(0, WEEKLY_SHORT_SLOTS - current_shorts),
            },
            "boost_slots": {
                "limit": BOOST_SLOTS,
                "used": current_boosts,
                "remaining": max(0, BOOST_SLOTS - current_boosts),
            },
            "weekly_shorts": [
                self._weekly_short_payload(position) for position in shorts
            ],
            "boosts": [self._boost_payload(position) for position in boosts],
        }

    @staticmethod
    def _weekly_short_payload(position: WeeklyShortRow) -> dict[str, object]:
        return {
            "id": position.id,
            "player_id": position.player_id,
            "week_start": position.week_start.isoformat(),
            "status": position.status,
            "opening_price_cents": position.opening_price_cents,
            "fee_cents": position.fee_cents,
            "collateral_cents": position.collateral_cents,
            "accrued_net_points_micros": position.accrued_net_points_micros,
            "qualifying_games": position.qualifying_games,
            "payout_cents": position.payout_cents,
            "settled_game_date": (
                position.settled_game_date.isoformat()
                if position.settled_game_date is not None
                else None
            ),
            "created_at": position.created_at.isoformat() + "Z",
        }

    @staticmethod
    def _boost_payload(position: BoostRow) -> dict[str, object]:
        return {
            "id": position.id,
            "player_id": position.player_id,
            "week_start": position.week_start.isoformat(),
            "game_date": position.target_game_date.isoformat(),
            "status": position.status,
            "opening_price_cents": position.opening_price_cents,
            "fee_cents": position.fee_cents,
            "payout_cents": position.payout_cents,
            "settled_game_date": (
                position.settled_game_date.isoformat()
                if position.settled_game_date is not None
                else None
            ),
            "created_at": position.created_at.isoformat() + "Z",
        }

    @staticmethod
    def _game_state_payload(state: GameStateRow) -> dict[str, object]:
        return {
            "season_id": state.season_id,
            "last_settled_date": (
                state.last_settled_date.isoformat()
                if state.last_settled_date is not None
                else None
            ),
            "next_game_date": (
                state.next_game_date.isoformat()
                if state.next_game_date is not None
                else None
            ),
            "is_complete": state.next_game_date is None,
            "version": state.version,
        }

    @staticmethod
    def _listing_payload(
        player: PlayerListingRow,
        *,
        volume_30d: int,
    ) -> dict[str, object]:
        return {
            "id": player.id,
            "name": player.name,
            "tier": player.tier,
            "current_price_cents": player.current_price_cents,
            "opening_price_cents": player.opening_price_cents,
            "actual_salary_cents": player.actual_salary_cents,
            "shares_outstanding": player.shares_outstanding,
            "available_shares": player.shares_outstanding - player.held_shares,
            "ownership_bps": round(
                player.held_shares * 10_000 / player.shares_outstanding
            ),
            "volume_30d": volume_30d,
        }

    def _portfolio_payload(
        self,
        session: Session,
        account: AccountRow,
    ) -> dict[str, object]:
        rows = session.execute(
            select(HoldingRow, PlayerListingRow)
            .join(PlayerListingRow, PlayerListingRow.id == HoldingRow.player_id)
            .where(HoldingRow.account_id == account.id)
            .order_by(PlayerListingRow.name)
        ).all()
        holdings = [
            {
                "player_id": player.id,
                "player_name": player.name,
                "shares": holding.shares,
                "average_cost_cents": holding.average_cost_cents,
                "current_price_cents": player.current_price_cents,
                "market_value_cents": holding.shares * player.current_price_cents,
                "unrealized_pnl_cents": (
                    holding.shares * player.current_price_cents
                    - holding.average_cost_cents
                ),
            }
            for holding, player in rows
        ]
        recent = session.scalars(
            select(TradeRow)
            .where(TradeRow.account_id == account.id)
            .order_by(TradeRow.created_at.desc(), TradeRow.id.desc())
            .limit(20)
        ).all()
        market_value = sum(int(row["market_value_cents"]) for row in holdings)
        instruments = self._instrument_summary(session, account)
        return {
            "account_id": account.id,
            "display_name": account.display_name,
            "cash_cents": account.cash_cents,
            "free_cash_cents": instruments["free_cash_cents"],
            "reserved_collateral_cents": instruments[
                "reserved_collateral_cents"
            ],
            "market_value_cents": market_value,
            "total_value_cents": account.cash_cents + market_value,
            "holdings": holdings,
            "recent_trades": [self._trade_payload(trade) for trade in recent],
            "instruments": instruments,
        }

    @staticmethod
    def _trade_payload(trade: TradeRow) -> dict[str, object]:
        return {
            "id": trade.id,
            "player_id": trade.player_id,
            "side": trade.side,
            "execution_price_cents": trade.execution_price_cents,
            "fee_cents": trade.fee_cents,
            "new_price_cents": trade.new_price_cents,
            "created_at": trade.created_at.isoformat() + "Z",
        }
