from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
import json
from pathlib import Path

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    UniqueConstraint,
    create_engine,
    event,
    select,
)
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from nba_stock_market.api.auth import MAX_DISPLAY_NAME_LENGTH
from nba_stock_market.engine import STARTING_CASH


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass


class AccountRow(Base):
    __tablename__ = "market_accounts"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    display_name: Mapped[str] = mapped_column(
        String(MAX_DISPLAY_NAME_LENGTH),
        nullable=False,
    )
    cash_cents: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
        default=round(STARTING_CASH * 100),
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=utcnow,
        onupdate=utcnow,
    )


class PlayerListingRow(Base):
    __tablename__ = "market_players"
    __table_args__ = (
        CheckConstraint("current_price_cents > 0", name="ck_market_player_price"),
        CheckConstraint("shares_outstanding > 0", name="ck_market_player_float"),
        CheckConstraint(
            "held_shares >= 0 AND held_shares <= shares_outstanding",
            name="ck_market_player_held_shares",
        ),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    tier: Mapped[str] = mapped_column(String(32), nullable=False)
    current_price_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    opening_price_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    actual_salary_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    shares_outstanding: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    held_shares: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=utcnow,
        onupdate=utcnow,
    )


class HoldingRow(Base):
    __tablename__ = "market_holdings"
    __table_args__ = (
        CheckConstraint("shares = 1", name="ck_market_holding_whole_player"),
    )

    account_id: Mapped[str] = mapped_column(
        ForeignKey("market_accounts.id", ondelete="CASCADE"),
        primary_key=True,
    )
    player_id: Mapped[str] = mapped_column(
        ForeignKey("market_players.id", ondelete="CASCADE"),
        primary_key=True,
    )
    shares: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    average_cost_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)


class TradeRow(Base):
    __tablename__ = "market_trades"
    __table_args__ = (
        UniqueConstraint(
            "account_id",
            "idempotency_key",
            name="uq_market_trade_account_idempotency",
        ),
        Index("ix_market_trades_account_created", "account_id", "created_at"),
        Index("ix_market_trades_account_player", "account_id", "player_id", "created_at"),
        Index("ix_market_trades_player_created", "player_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    account_id: Mapped[str] = mapped_column(
        ForeignKey("market_accounts.id", ondelete="CASCADE"),
        nullable=False,
    )
    player_id: Mapped[str] = mapped_column(
        ForeignKey("market_players.id", ondelete="RESTRICT"),
        nullable=False,
    )
    side: Mapped[str] = mapped_column(String(4), nullable=False)
    execution_price_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    fee_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    new_price_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    is_roundtrip: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    response_payload: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)


@dataclass(frozen=True)
class SeedPlayer:
    id: str
    name: str
    tier: str
    current_price_cents: int
    opening_price_cents: int
    actual_salary_cents: int
    shares_outstanding: int = 100


class Database:
    def __init__(self, url: str) -> None:
        self.url = url
        connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
        self.engine: Engine = create_engine(
            url,
            connect_args=connect_args,
            pool_pre_ping=True,
        )
        if url.startswith("sqlite"):
            event.listen(self.engine, "connect", self._configure_sqlite)
        self._sessions = sessionmaker(
            bind=self.engine,
            class_=Session,
            expire_on_commit=False,
        )

    @staticmethod
    def _configure_sqlite(dbapi_connection, connection_record) -> None:
        del connection_record
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()

    def session(self) -> Session:
        return self._sessions()

    def create_schema(self) -> None:
        Base.metadata.create_all(self.engine)

    def seed_players(self, players: Sequence[SeedPlayer]) -> None:
        if not players:
            return
        with self.session() as session, session.begin():
            existing_ids = set(
                session.scalars(
                    select(PlayerListingRow.id).where(
                        PlayerListingRow.id.in_([player.id for player in players])
                    )
                )
            )
            for player in players:
                if player.id in existing_ids:
                    continue
                session.add(
                    PlayerListingRow(
                        id=player.id,
                        name=player.name,
                        tier=player.tier,
                        current_price_cents=player.current_price_cents,
                        opening_price_cents=player.opening_price_cents,
                        actual_salary_cents=player.actual_salary_cents,
                        shares_outstanding=player.shares_outstanding,
                    )
                )

    def seed_from_file(self, path: Path) -> None:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict) or payload.get("schema_version") != 1:
            raise ValueError("market seed must use schema_version 1")
        raw_players = payload.get("players")
        if not isinstance(raw_players, list) or not raw_players:
            raise ValueError("market seed must include players")
        players = []
        for raw in raw_players:
            if not isinstance(raw, dict):
                raise ValueError("market seed player must be an object")
            try:
                player = SeedPlayer(**raw)
            except TypeError as exc:
                raise ValueError("market seed player has invalid fields") from exc
            if (
                not player.id
                or not player.name
                or player.current_price_cents <= 0
                or player.opening_price_cents <= 0
                or player.actual_salary_cents < 0
                or player.shares_outstanding <= 0
            ):
                raise ValueError("market seed player has invalid values")
            players.append(player)
        if len({player.id for player in players}) != len(players):
            raise ValueError("market seed player ids must be unique")
        self.seed_players(players)

    def dispose(self) -> None:
        self.engine.dispose()
