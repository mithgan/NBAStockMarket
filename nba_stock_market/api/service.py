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
    Database,
    DividendRow,
    GAME_STATE_ID,
    GameStateRow,
    HoldingRow,
    PlayerListingRow,
    ReplayEventRow,
    SettlementRow,
    TradeRow,
    utcnow,
)
from nba_stock_market.engine import (
    FEE_PCT,
    FLIP_SURCHARGE_CAP_PCT,
    FLIP_SURCHARGE_PCT,
    IMPACT_K,
    STARTING_CASH,
)


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
                payout_count, net_cash_cents = self._apply_dividends(
                    session,
                    game_date=expected_game_date,
                    now=now,
                )

                state.last_settled_date = expected_game_date
                state.next_game_date = next_game_date
                state.version += 1
                settlement.payout_count = payout_count
                settlement.net_cash_cents = net_cash_cents
                payload: dict[str, object] = {
                    "replayed": False,
                    "game_date": expected_game_date.isoformat(),
                    "next_game_date": (
                        next_game_date.isoformat() if next_game_date is not None else None
                    ),
                    "is_complete": next_game_date is None,
                    "event_count": len(events),
                    "payout_count": payout_count,
                    "net_cash_cents": net_cash_cents,
                }
                settlement.response_payload = copy.deepcopy(payload)
                return payload

    def _apply_dividends(
        self,
        session: Session,
        *,
        game_date: date,
        now: datetime,
    ) -> tuple[int, int]:
        rows = session.execute(
            select(AccountRow, ReplayEventRow)
            .join(HoldingRow, HoldingRow.account_id == AccountRow.id)
            .join(
                ReplayEventRow,
                ReplayEventRow.player_id == HoldingRow.player_id,
            )
            .where(ReplayEventRow.game_date == game_date)
            .order_by(AccountRow.id, ReplayEventRow.player_id)
            .with_for_update(of=AccountRow)
        ).all()
        account_totals: dict[str, int] = {}
        accounts: dict[str, AccountRow] = {}
        for account, event in rows:
            session.add(
                DividendRow(
                    account_id=account.id,
                    game_date=game_date,
                    player_id=event.player_id,
                    amount_cents=event.dividend_cents,
                    created_at=now,
                )
            )
            accounts[account.id] = account
            account_totals[account.id] = (
                account_totals.get(account.id, 0) + event.dividend_cents
            )

        for account_id, amount_cents in account_totals.items():
            account = accounts[account_id]
            account.cash_cents += amount_cents
            account.version += 1
        return len(rows), sum(account_totals.values())

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
                    if account.cash_cents < execution_price + fee_cents:
                        raise ApiProblem(
                            status_code=409,
                            code="insufficient_cash",
                            message="Not enough cash for this trade and fee.",
                        )
                elif holding is None:
                    raise ApiProblem(
                        status_code=409,
                        code="not_owned",
                        message="You do not own this player.",
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
        return {
            "account_id": account.id,
            "display_name": account.display_name,
            "cash_cents": account.cash_cents,
            "market_value_cents": market_value,
            "total_value_cents": account.cash_cents + market_value,
            "holdings": holdings,
            "recent_trades": [self._trade_payload(trade) for trade in recent],
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
