from __future__ import annotations

import base64
import binascii
import copy
import hashlib
import json
import math
import threading
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from typing import Literal
from uuid import UUID, uuid4

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from nba_stock_market.api.auth import Principal
from nba_stock_market.api.database import (
    AccountActivityRow,
    AccountRow,
    AccountResetCommandRow,
    AccountSettlementMembershipRow,
    BoostRow,
    Database,
    DividendRow,
    GAME_STATE_ID,
    GameStateRow,
    HoldingRow,
    InstrumentCommandRow,
    PlayerListingRow,
    PortfolioSnapshotRow,
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
            account = self._ensure_account(session, principal)
            now = utcnow()
            cutoff = now - timedelta(days=30)
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
            recent_trades_by_player: dict[str, list[TradeRow]] = {}
            recent_trades = session.scalars(
                select(TradeRow)
                .where(
                    TradeRow.account_id == account.id,
                    TradeRow.created_at >= now - timedelta(days=7),
                )
                .order_by(TradeRow.created_at.desc(), TradeRow.id.desc())
            ).all()
            for trade in recent_trades:
                recent_trades_by_player.setdefault(trade.player_id, []).append(trade)
            return [
                self._listing_payload(
                    player,
                    volume_30d=int(volume_30d),
                    buy_fee_cents=self._trade_fee_quote(
                        recent_trades_by_player.get(player.id, []),
                        side="buy",
                        execution_price_cents=player.current_price_cents,
                        now=now,
                    )[0],
                )
                for player, volume_30d in rows
            ]

    def portfolio(self, principal: Principal) -> dict[str, object]:
        with self.locks.acquire(f"account:{principal.id}"):
            with self.database.session() as session, session.begin():
                account = self._ensure_account(session, principal, for_update=True)
                return self._portfolio_payload(session, account)

    def bootstrap(self, principal: Principal) -> dict[str, object]:
        """Return one authoritative, settled-only application snapshot."""
        with self.locks.acquire(f"account:{principal.id}"):
            # Account creation is the only write in this read path. Commit it
            # before opening the repeatable-read snapshot used for all payloads.
            with self.database.session() as session, session.begin():
                self._ensure_account(session, principal, for_update=True)

            with self.database.snapshot_session() as session:
                account = session.get(AccountRow, principal.id)
                if account is None:
                    raise ApiProblem(
                        status_code=503,
                        code="account_unavailable",
                        message="Your account could not be loaded.",
                    )
                state = self._game_state(session)
                return {
                    "market": self._bootstrap_market(session, account),
                    "portfolio": self._portfolio_payload(session, account),
                    "game": self._game_state_payload(state),
                    "activity": self._bootstrap_activity(session, account),
                    "portfolio_history": self._bootstrap_portfolio_history(
                        session,
                        account,
                    ),
                    "settlements": self._bootstrap_settlements(session, account),
                    "leaderboard": self._bootstrap_leaderboard(
                        session,
                        principal,
                    ),
                    "settled_results": self._bootstrap_settled_results(
                        session,
                        state,
                    ),
                }

    def activity_history(
        self,
        principal: Principal,
        *,
        limit: int,
        cursor: str | None,
    ) -> dict[str, object]:
        return self._activity_page(
            principal,
            limit=limit,
            cursor=cursor,
            resource="activity",
            kind=None,
        )

    def dividend_history(
        self,
        principal: Principal,
        *,
        limit: int,
        cursor: str | None,
    ) -> dict[str, object]:
        return self._activity_page(
            principal,
            limit=limit,
            cursor=cursor,
            resource="dividends",
            kind="dividend",
        )

    def portfolio_history(
        self,
        principal: Principal,
        *,
        limit: int,
        cursor: str | None,
    ) -> dict[str, object]:
        with self.database.session() as session, session.begin():
            account = self._ensure_account(session, principal)
            cursor_date = self._decode_portfolio_cursor(
                cursor,
                account_id=account.id,
            )
            query = select(PortfolioSnapshotRow).where(
                PortfolioSnapshotRow.account_id == account.id
            )
            if cursor_date is not None:
                query = query.where(PortfolioSnapshotRow.game_date < cursor_date)
            rows = session.scalars(
                query.order_by(PortfolioSnapshotRow.game_date.desc()).limit(limit + 1)
            ).all()
            page = rows[:limit]
            next_cursor = None
            if len(rows) > limit:
                next_cursor = self._encode_cursor(
                    {
                        "v": 1,
                        "resource": "portfolio_history",
                        "account_id": account.id,
                        "game_date": page[-1].game_date.isoformat(),
                    }
                )
            return {
                "items": [self._portfolio_snapshot_payload(row) for row in page],
                "next_cursor": next_cursor,
            }

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
                self._record_activity(
                    session,
                    account_id=account.id,
                    kind="weekly_short_opened",
                    player_id=player.id,
                    game_date=None,
                    amount_cents=-fee_cents,
                    source_key=f"weekly_short:{position.id}:opened",
                    details={
                        "opening_price_cents": player.current_price_cents,
                        "fee_cents": fee_cents,
                        "collateral_cents": WEEKLY_SHORT_COLLATERAL_CENTS,
                        "week_start": week_start.isoformat(),
                    },
                    occurred_at=now,
                )
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
                self._record_activity(
                    session,
                    account_id=account.id,
                    kind="boost_armed",
                    player_id=player.id,
                    game_date=game_date,
                    amount_cents=-fee_cents,
                    source_key=f"boost:{position.id}:armed",
                    details={
                        "opening_price_cents": player.current_price_cents,
                        "fee_cents": fee_cents,
                        "week_start": week_start.isoformat(),
                        "target_game_date": game_date.isoformat(),
                    },
                    occurred_at=now,
                )
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
            state = self._game_state(session)
            return self._game_state_payload(state)

    def settlement_history(
        self,
        principal: Principal,
        *,
        limit: int,
    ) -> list[dict[str, object]]:
        with self.database.session() as session, session.begin():
            account = self._ensure_account(session, principal)
            settlements = session.scalars(
                select(SettlementRow)
                .outerjoin(
                    PortfolioSnapshotRow,
                    and_(
                        PortfolioSnapshotRow.game_date == SettlementRow.game_date,
                        PortfolioSnapshotRow.account_id == account.id,
                    ),
                )
                .outerjoin(
                    AccountSettlementMembershipRow,
                    and_(
                        AccountSettlementMembershipRow.game_date
                        == SettlementRow.game_date,
                        AccountSettlementMembershipRow.account_id == account.id,
                    ),
                )
                .where(
                    or_(
                        PortfolioSnapshotRow.account_id.is_not(None),
                        AccountSettlementMembershipRow.account_id.is_not(None),
                    )
                )
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
            self._record_activity(
                session,
                account_id=holding.account_id,
                kind="dividend",
                player_id=event.player_id,
                game_date=game_date,
                amount_cents=event.dividend_cents,
                source_key=f"dividend:{game_date.isoformat()}:{event.player_id}",
                details={
                    "actual_net_points_micros": event.actual_net_points_micros,
                    "expected_net_points_micros": event.expected_net_points_micros,
                },
                occurred_at=now,
            )

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
            self._record_activity(
                session,
                account_id=boost.account_id,
                kind=(
                    "boost_consumed"
                    if boost.status == "consumed"
                    else "boost_refunded"
                ),
                player_id=boost.player_id,
                game_date=game_date,
                amount_cents=cash_delta_cents,
                source_key=f"boost:{boost.id}:{boost.status}",
                details={
                    "fee_cents": boost.fee_cents,
                    "payout_cents": payout_cents,
                    "target_game_date": boost.target_game_date.isoformat(),
                },
                occurred_at=now,
            )

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
                self._record_activity(
                    session,
                    account_id=boost.account_id,
                    kind="boost_refunded",
                    player_id=boost.player_id,
                    game_date=game_date,
                    amount_cents=boost.fee_cents,
                    source_key=f"boost:{boost.id}:refunded",
                    details={
                        "fee_cents": boost.fee_cents,
                        "payout_cents": 0,
                        "target_game_date": boost.target_game_date.isoformat(),
                    },
                    occurred_at=now,
                )

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
                self._record_activity(
                    session,
                    account_id=position.account_id,
                    kind=(
                        "weekly_short_settled"
                        if position.status == "settled"
                        else "weekly_short_voided"
                    ),
                    player_id=position.player_id,
                    game_date=game_date,
                    amount_cents=payout_cents,
                    source_key=f"weekly_short:{position.id}:{position.status}",
                    details={
                        "fee_cents": position.fee_cents,
                        "collateral_cents": position.collateral_cents,
                        "qualifying_games": position.qualifying_games,
                        "accrued_net_points_micros": (
                            position.accrued_net_points_micros
                        ),
                    },
                    occurred_at=now,
                )

        for account_id, amount_cents in account_totals.items():
            account = accounts[account_id]
            account.cash_cents += amount_cents
            account.version += 1
        self._record_portfolio_snapshots(
            session,
            game_date=game_date,
            created_at=now,
        )
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
                recent_trades = session.scalars(
                    select(TradeRow)
                    .where(
                        TradeRow.account_id == account.id,
                        TradeRow.player_id == player_id,
                        TradeRow.created_at >= now - timedelta(days=7),
                    )
                    .order_by(TradeRow.created_at.desc(), TradeRow.id.desc())
                ).all()

                execution_price = player.current_price_cents
                fee_cents, is_roundtrip = self._trade_fee_quote(
                    recent_trades,
                    side=side,
                    execution_price_cents=execution_price,
                    now=now,
                )

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
                cash_delta_cents = (
                    -(execution_price + fee_cents)
                    if side == "buy"
                    else execution_price - fee_cents
                )
                self._record_activity(
                    session,
                    account_id=account.id,
                    kind=f"trade_{side}",
                    player_id=player.id,
                    game_date=None,
                    amount_cents=cash_delta_cents,
                    source_key=f"trade:{trade.id}",
                    details={
                        "side": side,
                        "execution_price_cents": execution_price,
                        "fee_cents": fee_cents,
                        "new_price_cents": new_price,
                    },
                    occurred_at=now,
                )
                payload = {
                    "replayed": False,
                    "trade": self._trade_payload(trade),
                    "portfolio": self._portfolio_payload(session, account),
                }
                trade.response_payload = copy.deepcopy(payload)
                return payload

    def reset_account(
        self,
        principal: Principal,
        *,
        expected_account_version: int,
        idempotency_key: str,
    ) -> dict[str, object]:
        fingerprint = hashlib.sha256(
            json.dumps(
                {
                    "confirmation": "RESET",
                    "expected_account_version": expected_account_version,
                },
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()
        with self.locks.acquire(f"account:{principal.id}"):
            with self.database.market_write_transaction(
                settlement_exclusive=False
            ) as session:
                account = self._ensure_account(session, principal, for_update=True)
                existing = session.scalar(
                    select(AccountResetCommandRow).where(
                        AccountResetCommandRow.account_id == account.id,
                        AccountResetCommandRow.idempotency_key == idempotency_key,
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

                if account.version != expected_account_version:
                    raise ApiProblem(
                        status_code=409,
                        code="account_version_conflict",
                        message="Account changed. Refresh before resetting it.",
                    )

                participation_queries = (
                    select(HoldingRow.account_id).where(
                        HoldingRow.account_id == account.id
                    ),
                    select(TradeRow.id).where(TradeRow.account_id == account.id),
                    select(InstrumentCommandRow.id).where(
                        InstrumentCommandRow.account_id == account.id
                    ),
                    select(WeeklyShortRow.id).where(
                        WeeklyShortRow.account_id == account.id
                    ),
                    select(BoostRow.id).where(BoostRow.account_id == account.id),
                    select(DividendRow.account_id).where(
                        DividendRow.account_id == account.id
                    ),
                    select(AccountActivityRow.id).where(
                        AccountActivityRow.account_id == account.id
                    ),
                    select(AccountResetCommandRow.id).where(
                        AccountResetCommandRow.account_id == account.id
                    ),
                )
                has_started = (
                    account.version != 0
                    or account.cash_cents != round(STARTING_CASH * 100)
                    or any(
                        session.scalar(query.limit(1)) is not None
                        for query in participation_queries
                    )
                )
                if has_started:
                    raise ApiProblem(
                        status_code=409,
                        code="reset_not_eligible",
                        message=(
                            "Account reset is only available before the first "
                            "server-side trade or instrument."
                        ),
                    )

                # Idle accounts can accumulate daily snapshots before the client
                # completes its one-time local-save transition.
                session.execute(
                    delete(PortfolioSnapshotRow).where(
                        PortfolioSnapshotRow.account_id == account.id
                    )
                )
                session.execute(
                    delete(AccountSettlementMembershipRow).where(
                        AccountSettlementMembershipRow.account_id == account.id
                    )
                )

                now = utcnow()
                account.cash_cents = round(STARTING_CASH * 100)
                account.version += 1
                account.reset_at = now
                account.updated_at = now
                session.flush()
                payload: dict[str, object] = {
                    "replayed": False,
                    "reset_at": now.isoformat() + "Z",
                    "portfolio": self._portfolio_payload(session, account),
                }
                session.add(
                    AccountResetCommandRow(
                        id=str(uuid4()),
                        account_id=account.id,
                        idempotency_key=idempotency_key,
                        request_fingerprint=fingerprint,
                        response_payload=copy.deepcopy(payload),
                        created_at=now,
                    )
                )
                return payload

    def _bootstrap_market(
        self,
        session: Session,
        account: AccountRow,
    ) -> list[dict[str, object]]:
        now = utcnow()
        cutoff = now - timedelta(days=30)
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
        recent_trades_by_player: dict[str, list[TradeRow]] = {}
        recent_trades = session.scalars(
            select(TradeRow)
            .where(
                TradeRow.account_id == account.id,
                TradeRow.created_at >= now - timedelta(days=7),
            )
            .order_by(TradeRow.created_at.desc(), TradeRow.id.desc())
        ).all()
        for trade in recent_trades:
            recent_trades_by_player.setdefault(trade.player_id, []).append(trade)
        return [
            self._listing_payload(
                player,
                volume_30d=int(volume_30d),
                buy_fee_cents=self._trade_fee_quote(
                    recent_trades_by_player.get(player.id, []),
                    side="buy",
                    execution_price_cents=player.current_price_cents,
                    now=now,
                )[0],
            )
            for player, volume_30d in rows
        ]

    def _bootstrap_activity(
        self,
        session: Session,
        account: AccountRow,
        *,
        limit: int = 100,
    ) -> dict[str, object]:
        rows = session.scalars(
            select(AccountActivityRow)
            .where(AccountActivityRow.account_id == account.id)
            .order_by(
                AccountActivityRow.occurred_at.desc(),
                AccountActivityRow.id.desc(),
            )
            .limit(limit + 1)
        ).all()
        page = rows[:limit]
        next_cursor = None
        if len(rows) > limit:
            last = page[-1]
            next_cursor = self._encode_cursor(
                {
                    "v": 1,
                    "resource": "activity",
                    "account_id": account.id,
                    "occurred_at": last.occurred_at.isoformat(),
                    "id": last.id,
                }
            )
        return {
            "items": [self._activity_payload(row) for row in page],
            "next_cursor": next_cursor,
        }

    def _bootstrap_portfolio_history(
        self,
        session: Session,
        account: AccountRow,
        *,
        limit: int = 100,
    ) -> dict[str, object]:
        rows = session.scalars(
            select(PortfolioSnapshotRow)
            .where(PortfolioSnapshotRow.account_id == account.id)
            .order_by(PortfolioSnapshotRow.game_date.desc())
            .limit(limit + 1)
        ).all()
        page = rows[:limit]
        next_cursor = None
        if len(rows) > limit:
            next_cursor = self._encode_cursor(
                {
                    "v": 1,
                    "resource": "portfolio_history",
                    "account_id": account.id,
                    "game_date": page[-1].game_date.isoformat(),
                }
            )
        return {
            "items": [self._portfolio_snapshot_payload(row) for row in page],
            "next_cursor": next_cursor,
        }

    def _bootstrap_settlements(
        self,
        session: Session,
        account: AccountRow,
        *,
        limit: int = 30,
    ) -> list[dict[str, object]]:
        settlements = session.scalars(
            select(SettlementRow)
            .outerjoin(
                PortfolioSnapshotRow,
                and_(
                    PortfolioSnapshotRow.game_date == SettlementRow.game_date,
                    PortfolioSnapshotRow.account_id == account.id,
                ),
            )
            .outerjoin(
                AccountSettlementMembershipRow,
                and_(
                    AccountSettlementMembershipRow.game_date
                    == SettlementRow.game_date,
                    AccountSettlementMembershipRow.account_id == account.id,
                ),
            )
            .where(
                or_(
                    PortfolioSnapshotRow.account_id.is_not(None),
                    AccountSettlementMembershipRow.account_id.is_not(None),
                )
            )
            .order_by(SettlementRow.game_date.desc())
            .limit(limit)
        ).all()
        dividends = dict(
            session.execute(
                select(
                    DividendRow.game_date,
                    func.coalesce(func.sum(DividendRow.amount_cents), 0),
                )
                .where(
                    DividendRow.account_id == account.id,
                    DividendRow.game_date.in_(
                        [settlement.game_date for settlement in settlements]
                    ),
                )
                .group_by(DividendRow.game_date)
            ).all()
        ) if settlements else {}
        return [
            {
                "game_date": settlement.game_date.isoformat(),
                "event_count": settlement.event_count,
                "payout_count": settlement.payout_count,
                "net_cash_cents": settlement.net_cash_cents,
                "current_user_dividend_cents": int(
                    dividends.get(settlement.game_date, 0)
                ),
                "settled_at": settlement.settled_at.isoformat() + "Z",
            }
            for settlement in settlements
        ]

    def _bootstrap_leaderboard(
        self,
        session: Session,
        principal: Principal,
        *,
        limit: int = 100,
    ) -> list[dict[str, object]]:
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

    @staticmethod
    def _bootstrap_settled_results(
        session: Session,
        state: GameStateRow,
    ) -> list[dict[str, object]]:
        if state.last_settled_date is None:
            return []
        rows = session.scalars(
            select(ReplayEventRow)
            .where(
                ReplayEventRow.game_date <= state.last_settled_date,
                ReplayEventRow.actual_minutes_micros > 0,
            )
            .order_by(ReplayEventRow.game_date, ReplayEventRow.player_id)
        ).all()
        return [
            {
                "player_id": row.player_id,
                "game_date": row.game_date.isoformat(),
                "actual_net_points_micros": row.actual_net_points_micros,
                "expected_net_points_micros": row.expected_net_points_micros,
                "dividend_cents": row.dividend_cents,
            }
            for row in rows
        ]

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

    def _activity_page(
        self,
        principal: Principal,
        *,
        limit: int,
        cursor: str | None,
        resource: str,
        kind: str | None,
    ) -> dict[str, object]:
        with self.database.session() as session, session.begin():
            account = self._ensure_account(session, principal)
            position = self._decode_activity_cursor(
                cursor,
                resource=resource,
                account_id=account.id,
            )
            query = select(AccountActivityRow).where(
                AccountActivityRow.account_id == account.id
            )
            if kind is not None:
                query = query.where(AccountActivityRow.kind == kind)
            if position is not None:
                occurred_at, row_id = position
                query = query.where(
                    or_(
                        AccountActivityRow.occurred_at < occurred_at,
                        and_(
                            AccountActivityRow.occurred_at == occurred_at,
                            AccountActivityRow.id < row_id,
                        ),
                    )
                )
            rows = session.scalars(
                query.order_by(
                    AccountActivityRow.occurred_at.desc(),
                    AccountActivityRow.id.desc(),
                ).limit(limit + 1)
            ).all()
            page = rows[:limit]
            next_cursor = None
            if len(rows) > limit:
                last = page[-1]
                next_cursor = self._encode_cursor(
                    {
                        "v": 1,
                        "resource": resource,
                        "account_id": account.id,
                        "occurred_at": last.occurred_at.isoformat(),
                        "id": last.id,
                    }
                )
            return {
                "items": [self._activity_payload(row) for row in page],
                "next_cursor": next_cursor,
            }

    @staticmethod
    def _encode_cursor(payload: dict[str, object]) -> str:
        raw = json.dumps(
            payload,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")

    @staticmethod
    def _decode_cursor(cursor: str | None) -> dict[str, object] | None:
        if cursor is None:
            return None
        try:
            padding = "=" * (-len(cursor) % 4)
            raw = base64.b64decode(
                cursor + padding,
                altchars=b"-_",
                validate=True,
            )
            payload = json.loads(raw.decode("utf-8"))
        except (
            binascii.Error,
            UnicodeDecodeError,
            json.JSONDecodeError,
            ValueError,
        ) as exc:
            raise ApiProblem(
                status_code=400,
                code="invalid_cursor",
                message="The pagination cursor is invalid.",
            ) from exc
        if not isinstance(payload, dict):
            raise ApiProblem(
                status_code=400,
                code="invalid_cursor",
                message="The pagination cursor is invalid.",
            )
        return payload

    def _decode_activity_cursor(
        self,
        cursor: str | None,
        *,
        resource: str,
        account_id: str,
    ) -> tuple[datetime, str] | None:
        payload = self._decode_cursor(cursor)
        if payload is None:
            return None
        if (
            set(payload) != {"v", "resource", "account_id", "occurred_at", "id"}
            or payload.get("v") != 1
            or payload.get("resource") != resource
            or payload.get("account_id") != account_id
            or not isinstance(payload.get("occurred_at"), str)
            or not isinstance(payload.get("id"), str)
            or not payload["id"]
            or len(payload["id"]) > 36
        ):
            raise ApiProblem(
                status_code=400,
                code="invalid_cursor",
                message="The pagination cursor is invalid.",
            )
        try:
            occurred_at = datetime.fromisoformat(payload["occurred_at"])
        except ValueError as exc:
            raise ApiProblem(
                status_code=400,
                code="invalid_cursor",
                message="The pagination cursor is invalid.",
            ) from exc
        if occurred_at.tzinfo is not None:
            raise ApiProblem(
                status_code=400,
                code="invalid_cursor",
                message="The pagination cursor is invalid.",
            )
        try:
            row_id = UUID(payload["id"])
        except ValueError as exc:
            raise ApiProblem(
                status_code=400,
                code="invalid_cursor",
                message="The pagination cursor is invalid.",
            ) from exc
        if str(row_id) != payload["id"]:
            raise ApiProblem(
                status_code=400,
                code="invalid_cursor",
                message="The pagination cursor is invalid.",
            )
        return occurred_at, str(row_id)

    def _decode_portfolio_cursor(
        self,
        cursor: str | None,
        *,
        account_id: str,
    ) -> date | None:
        payload = self._decode_cursor(cursor)
        if payload is None:
            return None
        if (
            set(payload) != {"v", "resource", "account_id", "game_date"}
            or payload.get("v") != 1
            or payload.get("resource") != "portfolio_history"
            or payload.get("account_id") != account_id
            or not isinstance(payload.get("game_date"), str)
        ):
            raise ApiProblem(
                status_code=400,
                code="invalid_cursor",
                message="The pagination cursor is invalid.",
            )
        try:
            return date.fromisoformat(payload["game_date"])
        except ValueError as exc:
            raise ApiProblem(
                status_code=400,
                code="invalid_cursor",
                message="The pagination cursor is invalid.",
            ) from exc

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
    def _record_activity(
        session: Session,
        *,
        account_id: str,
        kind: str,
        player_id: str | None,
        game_date: date | None,
        amount_cents: int,
        source_key: str,
        details: dict[str, object],
        occurred_at: datetime,
    ) -> None:
        # PostgreSQL compatibility triggers bridge rolling deployments from an
        # older worker. SQLite and trigger-free databases still write here.
        existing = session.scalar(
            select(AccountActivityRow.id)
            .where(
                AccountActivityRow.account_id == account_id,
                AccountActivityRow.source_key == source_key,
            )
            .limit(1)
        )
        if existing is not None:
            return
        session.add(
            AccountActivityRow(
                id=str(uuid4()),
                account_id=account_id,
                kind=kind,
                player_id=player_id,
                game_date=game_date,
                amount_cents=amount_cents,
                source_key=source_key,
                details=copy.deepcopy(details),
                occurred_at=occurred_at,
            )
        )

    def _record_portfolio_snapshots(
        self,
        session: Session,
        *,
        game_date: date,
        created_at: datetime,
    ) -> None:
        market_values = {
            account_id: int(value or 0)
            for account_id, value in session.execute(
                select(
                    HoldingRow.account_id,
                    func.sum(
                        HoldingRow.shares * PlayerListingRow.current_price_cents
                    ),
                )
                .join(
                    PlayerListingRow,
                    PlayerListingRow.id == HoldingRow.player_id,
                )
                .group_by(HoldingRow.account_id)
            )
        }
        reserved_values = {
            account_id: int(value or 0)
            for account_id, value in session.execute(
                select(
                    WeeklyShortRow.account_id,
                    func.sum(WeeklyShortRow.collateral_cents),
                )
                .where(WeeklyShortRow.status == "active")
                .group_by(WeeklyShortRow.account_id)
            )
        }
        accounts = session.scalars(select(AccountRow).order_by(AccountRow.id)).all()
        for account in accounts:
            market_value = market_values.get(account.id, 0)
            reserved = reserved_values.get(account.id, 0)
            session.add(
                PortfolioSnapshotRow(
                    account_id=account.id,
                    game_date=game_date,
                    cash_cents=account.cash_cents,
                    free_cash_cents=account.cash_cents - reserved,
                    reserved_collateral_cents=reserved,
                    market_value_cents=market_value,
                    total_value_cents=account.cash_cents + market_value,
                    created_at=created_at,
                )
            )

    @staticmethod
    def _game_state(session: Session) -> GameStateRow:
        state = session.get(GameStateRow, GAME_STATE_ID)
        if state is None:
            raise ApiProblem(
                status_code=503,
                code="game_unavailable",
                message="Historical replay data is not available.",
            )
        return state

    @classmethod
    def _available_game_state(cls, session: Session) -> GameStateRow:
        state = cls._game_state(session)
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
        weekly_short_targets: list[dict[str, object]] = []
        boost_targets: list[dict[str, object]] = []
        if state is not None and state.next_game_date is not None:
            current_date = state.next_game_date
            current_week = week_start_for(current_date)
            week_end = current_week + timedelta(days=7)
            listings = session.scalars(
                select(PlayerListingRow).order_by(PlayerListingRow.name)
            ).all()
            held_ids = set(
                session.scalars(
                    select(HoldingRow.player_id).where(
                        HoldingRow.account_id == account.id
                    )
                )
            )
            prior_game_ids = set(
                session.scalars(
                    select(ReplayEventRow.player_id)
                    .where(
                        ReplayEventRow.game_date >= current_week,
                        ReplayEventRow.game_date < current_date,
                    )
                    .distinct()
                )
            )
            next_projected_games = dict(
                session.execute(
                    select(
                        ReplayEventRow.player_id,
                        func.min(ReplayEventRow.game_date),
                    )
                    .where(
                        ReplayEventRow.game_date >= current_date,
                        ReplayEventRow.game_date < week_end,
                        ReplayEventRow.projected_minutes_micros.is_not(None),
                    )
                    .group_by(ReplayEventRow.player_id)
                ).all()
            )
            account_short_ids = {
                position.player_id
                for position in shorts
                if position.week_start == current_week
            }
            active_short_ids = {
                position.player_id
                for position in shorts
                if position.week_start == current_week
                and position.status == "active"
            }
            current_boost_ids = {
                position.player_id
                for position in boosts
                if position.week_start == current_week
                and position.status != "refunded"
            }
            armed_boost_ids = {
                position.player_id
                for position in boosts
                if position.status == "armed"
            }
            league_short_counts = dict(
                session.execute(
                    select(WeeklyShortRow.player_id, func.count(WeeklyShortRow.id))
                    .where(
                        WeeklyShortRow.week_start == current_week,
                        WeeklyShortRow.status == "active",
                    )
                    .group_by(WeeklyShortRow.player_id)
                ).all()
            )
            free_cash = account.cash_cents - reserved
            for listing in listings:
                next_game = next_projected_games.get(listing.id)
                if next_game is None:
                    continue
                short_fee = max(
                    SHORT_MIN_FEE_CENTS,
                    round(listing.current_price_cents * SHORT_FEE_PCT),
                )
                if (
                    current_shorts < WEEKLY_SHORT_SLOTS
                    and listing.id not in held_ids
                    and listing.id not in current_boost_ids
                    and listing.id not in account_short_ids
                    and listing.id not in prior_game_ids
                    and int(league_short_counts.get(listing.id, 0))
                    < MAX_WEEKLY_SHORTS_PER_PLAYER
                    and free_cash >= short_fee + WEEKLY_SHORT_COLLATERAL_CENTS
                ):
                    weekly_short_targets.append(
                        {
                            "player_id": listing.id,
                            "game_date": next_game.isoformat(),
                            "fee_cents": short_fee,
                        }
                    )
                boost_fee = round(listing.current_price_cents * BOOST_FEE_PCT)
                if (
                    current_boosts < BOOST_SLOTS
                    and listing.id in held_ids
                    and listing.id not in active_short_ids
                    and listing.id not in armed_boost_ids
                    and free_cash >= boost_fee
                ):
                    boost_targets.append(
                        {
                            "player_id": listing.id,
                            "game_date": next_game.isoformat(),
                            "fee_cents": boost_fee,
                        }
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
            "weekly_short_targets": weekly_short_targets,
            "boost_targets": boost_targets,
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
    def _trade_fee_quote(
        recent_trades: list[TradeRow],
        *,
        side: Literal["buy", "sell"],
        execution_price_cents: int,
        now: datetime,
    ) -> tuple[int, bool]:
        last_trade = recent_trades[0] if recent_trades else None
        is_roundtrip = bool(
            last_trade
            and last_trade.side != side
            and now - last_trade.created_at <= timedelta(days=1)
        )
        fee_rate = FEE_PCT
        if is_roundtrip:
            roundtrips = sum(trade.is_roundtrip for trade in recent_trades)
            fee_rate += min(
                FLIP_SURCHARGE_PCT * (1 + roundtrips),
                FLIP_SURCHARGE_CAP_PCT,
            )
        return round(execution_price_cents * fee_rate), is_roundtrip

    @staticmethod
    def _listing_payload(
        player: PlayerListingRow,
        *,
        volume_30d: int,
        buy_fee_cents: int,
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
            "buy_fee_cents": buy_fee_cents,
            "ownership_bps": round(
                player.held_shares * 10_000 / player.shares_outstanding
            ),
            "volume_30d": volume_30d,
        }

    @staticmethod
    def _activity_payload(row: AccountActivityRow) -> dict[str, object]:
        return {
            "id": row.id,
            "kind": row.kind,
            "player_id": row.player_id,
            "game_date": (
                row.game_date.isoformat() if row.game_date is not None else None
            ),
            "amount_cents": row.amount_cents,
            "details": copy.deepcopy(row.details),
            "occurred_at": row.occurred_at.isoformat() + "Z",
        }

    @staticmethod
    def _portfolio_snapshot_payload(
        row: PortfolioSnapshotRow,
    ) -> dict[str, object]:
        return {
            "game_date": row.game_date.isoformat(),
            "cash_cents": row.cash_cents,
            "free_cash_cents": row.free_cash_cents,
            "reserved_collateral_cents": row.reserved_collateral_cents,
            "market_value_cents": row.market_value_cents,
            "total_value_cents": row.total_value_cents,
            "created_at": row.created_at.isoformat() + "Z",
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
            "version": account.version,
            "reset_at": account.reset_at.isoformat() + "Z",
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
