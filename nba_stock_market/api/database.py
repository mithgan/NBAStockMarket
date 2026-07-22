from __future__ import annotations

from collections.abc import Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, date, datetime
import hashlib
import json
from pathlib import Path
from threading import Event as ThreadEvent
from threading import Lock as ThreadLock
from threading import Thread

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    UniqueConstraint,
    create_engine,
    event,
    func,
    inspect,
    select,
    text,
)
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from nba_stock_market.api.auth import MAX_DISPLAY_NAME_LENGTH
from nba_stock_market.engine import STARTING_CASH


DATABASE_CONNECT_TIMEOUT_SECONDS = 5
DATABASE_TCP_USER_TIMEOUT_MS = 5_000
DATABASE_STATEMENT_TIMEOUT_MS = 5_000
DATABASE_LOCK_TIMEOUT_MS = 3_000
DATABASE_READINESS_TIMEOUT_SECONDS = 6.0
MARKET_SETTLEMENT_ADVISORY_LOCK_ID = 1_846_237_911
EXPECTED_MARKET_MIGRATIONS = {
    "20260721000000",
    "20260721010000",
    "20260722000000",
    "20260722010000",
}
GAME_STATE_ID = "historical-2025-26"
EXPECTED_REPLAY_EVENT_COUNT = 2_123
EXPECTED_REPLAY_SEED_SHA256 = (
    "7442b6f6f7fdab45892f118b192c3a1f9e61de1963a1df113785da0652b7e352"
)


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def replay_seed_digest(
    rows: Sequence[tuple[date, str, int, int, int]],
) -> str:
    digest = hashlib.sha256()
    for game_date, player_id, actual, expected, dividend in rows:
        digest.update(
            (
                f"{game_date.isoformat()}|{player_id}|{actual}|{expected}|{dividend}\n"
            ).encode("utf-8")
        )
    return digest.hexdigest()


class Base(DeclarativeBase):
    pass


class AccountRow(Base):
    __tablename__ = "market_accounts"
    __table_args__ = (
        CheckConstraint("version >= 0", name="ck_market_account_version"),
    )

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
        CheckConstraint(
            "opening_price_cents > 0",
            name="ck_market_player_opening_price",
        ),
        CheckConstraint(
            "actual_salary_cents >= 0",
            name="ck_market_player_salary",
        ),
        CheckConstraint("shares_outstanding > 0", name="ck_market_player_float"),
        CheckConstraint(
            "held_shares >= 0 AND held_shares <= shares_outstanding",
            name="ck_market_player_held_shares",
        ),
        CheckConstraint("version >= 0", name="ck_market_player_version"),
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
        CheckConstraint(
            "average_cost_cents > 0",
            name="ck_market_holding_cost",
        ),
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
        CheckConstraint("side IN ('buy', 'sell')", name="ck_market_trade_side"),
        CheckConstraint(
            "execution_price_cents > 0",
            name="ck_market_trade_execution_price",
        ),
        CheckConstraint("fee_cents >= 0", name="ck_market_trade_fee"),
        CheckConstraint(
            "new_price_cents > 0",
            name="ck_market_trade_new_price",
        ),
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


class ReplayEventRow(Base):
    __tablename__ = "market_replay_events"
    __table_args__ = (
        CheckConstraint(
            "actual_net_points_micros >= -1000000000 AND "
            "actual_net_points_micros <= 1000000000",
            name="ck_market_replay_actual_range",
        ),
        CheckConstraint(
            "expected_net_points_micros >= -1000000000 AND "
            "expected_net_points_micros <= 1000000000",
            name="ck_market_replay_expected_range",
        ),
        Index("ix_market_replay_events_player_date", "player_id", "game_date"),
    )

    game_date: Mapped[date] = mapped_column(Date, primary_key=True)
    player_id: Mapped[str] = mapped_column(
        ForeignKey("market_players.id", ondelete="RESTRICT"),
        primary_key=True,
    )
    actual_net_points_micros: Mapped[int] = mapped_column(BigInteger, nullable=False)
    expected_net_points_micros: Mapped[int] = mapped_column(BigInteger, nullable=False)
    dividend_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)


class GameStateRow(Base):
    __tablename__ = "market_game_state"
    __table_args__ = (
        CheckConstraint("version >= 0", name="ck_market_game_state_version"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    season_id: Mapped[str] = mapped_column(String(32), nullable=False)
    last_settled_date: Mapped[date | None] = mapped_column(Date)
    next_game_date: Mapped[date | None] = mapped_column(Date)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=utcnow,
        onupdate=utcnow,
    )


class SettlementRow(Base):
    __tablename__ = "market_settlements"
    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_market_settlement_idempotency"),
        CheckConstraint("event_count >= 0", name="ck_market_settlement_event_count"),
        CheckConstraint("payout_count >= 0", name="ck_market_settlement_payout_count"),
        Index("ix_market_settlements_settled_at", "settled_at"),
    )

    game_date: Mapped[date] = mapped_column(Date, primary_key=True)
    season_id: Mapped[str] = mapped_column(String(32), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    event_count: Mapped[int] = mapped_column(Integer, nullable=False)
    payout_count: Mapped[int] = mapped_column(Integer, nullable=False)
    net_cash_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    response_payload: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False)
    settled_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)


class DividendRow(Base):
    __tablename__ = "market_dividends"
    __table_args__ = (
        Index("ix_market_dividends_account_date", "account_id", "game_date"),
        CheckConstraint(
            "amount_cents >= -100000000000 AND amount_cents <= 100000000000",
            name="ck_market_dividend_amount_range",
        ),
    )

    account_id: Mapped[str] = mapped_column(
        ForeignKey("market_accounts.id", ondelete="CASCADE"),
        primary_key=True,
    )
    game_date: Mapped[date] = mapped_column(
        ForeignKey("market_settlements.game_date", ondelete="CASCADE"),
        primary_key=True,
    )
    player_id: Mapped[str] = mapped_column(
        ForeignKey("market_players.id", ondelete="RESTRICT"),
        primary_key=True,
    )
    amount_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
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


@dataclass(frozen=True)
class SeedReplayEvent:
    game_date: date
    player_id: str
    actual_net_points_micros: int
    expected_net_points_micros: int
    dividend_cents: int


@dataclass
class _ReadinessAttempt:
    event: ThreadEvent
    error: RuntimeError | None = None
    worker: Thread | None = None


# These fields are immutable after listing; current price and held shares are not.
EXPECTED_MARKET_SEED: dict[str, tuple[str, str, int, int, int]] = {
    "3112335": ("Nikola Jokic", "star", 5166832600, 5903311400, 100),
    "4278073": ("Shai Gilgeous-Alexander", "star", 5035523300, 4080615000, 100),
    "5104157": ("Victor Wembanyama", "star", 4713443300, 1686824600, 100),
    "3945274": ("Luka Doncic", "star", 4701275300, 4896738000, 100),
    "6450": ("Kawhi Leonard", "star", 4262628700, 5030000000, 100),
    "4432166": ("Cade Cunningham", "star", 4089871100, 5010562800, 100),
    "3078576": ("Derrick White", "star", 3919545700, 3034800000, 100),
    "3908809": ("Donovan Mitchell", "star", 3727209300, 5010562800, 100),
    "4066261": ("Bam Adebayo", "star", 3713927900, 5103360000, 100),
    "4433255": ("Chet Holmgren", "star", 3701047800, 1373136800, 100),
    "4431678": ("Tyrese Maxey", "star", 3617501800, 4077052000, 100),
    "4433134": ("Scottie Barnes", "star", 3603916000, 4175463600, 100),
    "3136195": ("Karl-Anthony Towns", "star", 3501292700, 5707872800, 100),
    "4432816": ("LaMelo Ball", "star", 3454288300, 4077052000, 100),
    "4684740": ("Amen Thompson", "star", 3426507400, 1225860900, 100),
    "3202": ("Kevin Durant", "star", 3417004300, 5470860900, 100),
    "3136193": ("Devin Booker", "star", 3301146100, 5707872800, 100),
    "3032977": ("Giannis Antetokounmpo", "star", 3223577500, 5845649000, 100),
    "4869342": ("Dyson Daniels", "star", 3172946100, 770770900, 100),
    "4432158": ("Evan Mobley", "star", 3163204400, 5010562800, 100),
    "3936299": ("Jamal Murray", "star", 3134881200, 5010562800, 100),
    "4433621": ("Jalen Duren", "star", 3131619200, 648314400, 100),
    "3934672": ("Jalen Brunson", "star", 3107064500, 3773952100, 100),
    "4066320": ("Desmond Bane", "star", 3031027700, 3944609000, 100),
    "5105565": ("Donovan Clingan", "mid", 2948609100, 751992000, 100),
    "3917376": ("Jaylen Brown", "mid", 2920583500, 5707872800, 100),
    "5061575": ("Kon Knueppel", "mid", 2896002500, 0, 100),
    "4066259": ("De'Aaron Fox", "mid", 2837693600, 3709662000, 100),
    "3934719": ("OG Anunoby", "mid", 2829196300, 4250000000, 100),
    "4278585": ("Collin Gillespie", "mid", 2815221000, 0, 100),
}


def database_connect_args(url: str) -> dict[str, object]:
    if url.startswith("sqlite"):
        return {"check_same_thread": False}

    parsed_url = make_url(url)
    connect_args: dict[str, object] = {}
    if parsed_url.drivername == "postgresql+psycopg":
        connect_args.update(
            {
                "connect_timeout": DATABASE_CONNECT_TIMEOUT_SECONDS,
                "keepalives": 1,
                "keepalives_idle": 5,
                "keepalives_interval": 2,
                "keepalives_count": 2,
                "tcp_user_timeout": DATABASE_TCP_USER_TIMEOUT_MS,
            }
        )
    if parsed_url.drivername == "postgresql+psycopg" and parsed_url.port == 6543:
        # Supabase's transaction pooler may switch server sessions between queries.
        connect_args["prepare_threshold"] = None
    return connect_args


class Database:
    def __init__(self, url: str) -> None:
        self.url = url
        engine_options: dict[str, object] = {
            "connect_args": database_connect_args(url),
            "pool_pre_ping": True,
        }
        if make_url(url).drivername == "postgresql+psycopg":
            engine_options["pool_timeout"] = DATABASE_CONNECT_TIMEOUT_SECONDS
        self.engine: Engine = create_engine(url, **engine_options)
        if url.startswith("sqlite"):
            event.listen(self.engine, "connect", self._configure_sqlite)
        elif make_url(url).drivername == "postgresql+psycopg":
            event.listen(self.engine, "begin", self._configure_postgres_transaction)
        self._sessions = sessionmaker(
            bind=self.engine,
            class_=Session,
            expire_on_commit=False,
        )
        self._readiness_lock = ThreadLock()
        self._readiness_attempt: _ReadinessAttempt | None = None
        self._sqlite_market_write_lock = ThreadLock()

    @staticmethod
    def _configure_sqlite(dbapi_connection, connection_record) -> None:
        del connection_record
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()

    @staticmethod
    def _configure_postgres_transaction(connection) -> None:
        connection.exec_driver_sql(
            f"SET LOCAL statement_timeout = {DATABASE_STATEMENT_TIMEOUT_MS}"
        )
        connection.exec_driver_sql(
            f"SET LOCAL lock_timeout = {DATABASE_LOCK_TIMEOUT_MS}"
        )

    def session(self) -> Session:
        return self._sessions()

    @contextmanager
    def market_write_transaction(
        self,
        *,
        settlement_exclusive: bool,
    ):
        sqlite_lock = (
            self._sqlite_market_write_lock
            if self.engine.dialect.name == "sqlite"
            else None
        )
        if sqlite_lock is not None:
            sqlite_lock.acquire()
        try:
            with self.session() as session, session.begin():
                if session.bind is not None and session.bind.dialect.name == "postgresql":
                    function = (
                        "pg_advisory_xact_lock"
                        if settlement_exclusive
                        else "pg_advisory_xact_lock_shared"
                    )
                    session.execute(
                        text(f"SELECT {function}(:lock_id)"),
                        {"lock_id": MARKET_SETTLEMENT_ADVISORY_LOCK_ID},
                    )
                yield session
        finally:
            if sqlite_lock is not None:
                sqlite_lock.release()

    def create_schema(self) -> None:
        Base.metadata.create_all(self.engine)
        if self.engine.dialect.name == "sqlite":
            self._migrate_sqlite_account_cash_constraint()

    def _migrate_sqlite_account_cash_constraint(self) -> None:
        raw_connection = self.engine.raw_connection()
        cursor = raw_connection.cursor()
        try:
            row = cursor.execute(
                "SELECT sql FROM sqlite_master "
                "WHERE type = 'table' AND name = 'market_accounts'"
            ).fetchone()
            table_sql = str(row[0]) if row is not None else ""
            if "ck_market_account_cash" not in table_sql:
                return

            cursor.execute("PRAGMA foreign_keys=OFF")
            cursor.execute("BEGIN IMMEDIATE")
            cursor.execute(
                """
                CREATE TABLE market_accounts_without_cash_check (
                    id VARCHAR(128) NOT NULL,
                    display_name VARCHAR(80) NOT NULL,
                    cash_cents BIGINT NOT NULL,
                    version INTEGER NOT NULL,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL,
                    PRIMARY KEY (id),
                    CONSTRAINT ck_market_account_version CHECK (version >= 0)
                )
                """
            )
            cursor.execute(
                """
                INSERT INTO market_accounts_without_cash_check (
                    id, display_name, cash_cents, version, created_at, updated_at
                )
                SELECT id, display_name, cash_cents, version, created_at, updated_at
                FROM market_accounts
                """
            )
            cursor.execute("DROP TABLE market_accounts")
            cursor.execute(
                "ALTER TABLE market_accounts_without_cash_check "
                "RENAME TO market_accounts"
            )
            raw_connection.commit()
        except Exception:
            raw_connection.rollback()
            raise
        finally:
            try:
                cursor.execute("PRAGMA foreign_keys=ON")
            finally:
                cursor.close()
                raw_connection.close()

    def assert_ready(
        self,
        timeout_seconds: float = DATABASE_READINESS_TIMEOUT_SECONDS,
    ) -> None:
        with self._readiness_lock:
            attempt = self._readiness_attempt
            worker = attempt.worker if attempt is not None else None
            if attempt is None or worker is None or not worker.is_alive():
                attempt = _ReadinessAttempt(event=ThreadEvent())
                worker = Thread(
                    target=self._run_readiness_check,
                    args=(attempt,),
                    name="market-database-readiness",
                    daemon=True,
                )
                attempt.worker = worker
                self._readiness_attempt = attempt
                worker.start()

        if not attempt.event.wait(timeout=timeout_seconds):
            raise RuntimeError("market database readiness check timed out")
        if attempt.error is not None:
            raise attempt.error

    def _run_readiness_check(self, attempt: _ReadinessAttempt) -> None:
        readiness_error: RuntimeError | None = None
        try:
            self._assert_ready_sync()
        except RuntimeError as exc:
            readiness_error = exc
        except Exception as exc:
            readiness_error = RuntimeError("market database readiness check failed")
            readiness_error.__cause__ = exc
        finally:
            with self._readiness_lock:
                attempt.error = readiness_error
            attempt.event.set()

    def _assert_ready_sync(self) -> None:
        seed_count: int | None = None
        replay_event_count: int | None = None
        replay_digest: str | None = None
        replay_state: tuple[str, str] | None = None
        try:
            with self.engine.connect() as connection:
                existing_tables = set(inspect(connection).get_table_names())
                expected_tables = {table.name for table in Base.metadata.sorted_tables}
                missing_tables = expected_tables - existing_tables
                if missing_tables:
                    raise RuntimeError(
                        "market database is missing required tables: "
                        + ", ".join(sorted(missing_tables))
                    )

                if connection.dialect.name == "postgresql":
                    migration_versions = {
                        str(version)
                        for version in connection.scalars(
                            text(
                                "SELECT version "
                                "FROM supabase_migrations.schema_migrations"
                            )
                        )
                    }
                    missing_migrations = (
                        EXPECTED_MARKET_MIGRATIONS - migration_versions
                    )
                    if missing_migrations:
                        raise RuntimeError(
                            "market database is missing required migrations: "
                            + ", ".join(sorted(missing_migrations))
                        )

                    seed_rows = connection.execute(
                        select(
                            PlayerListingRow.id,
                            PlayerListingRow.name,
                            PlayerListingRow.tier,
                            PlayerListingRow.opening_price_cents,
                            PlayerListingRow.actual_salary_cents,
                            PlayerListingRow.shares_outstanding,
                        )
                    )
                    actual_seed = {
                        row.id: (
                            row.name,
                            row.tier,
                            row.opening_price_cents,
                            row.actual_salary_cents,
                            row.shares_outstanding,
                        )
                        for row in seed_rows
                    }
                    if actual_seed != EXPECTED_MARKET_SEED:
                        raise RuntimeError(
                            "market database canonical player seed is incomplete or invalid"
                        )
                else:
                    seed_count = connection.scalar(
                        select(func.count()).select_from(PlayerListingRow)
                    )
                replay_event_count = connection.scalar(
                    select(func.count()).select_from(ReplayEventRow)
                )
                if connection.dialect.name == "postgresql":
                    replay_rows = [
                        (
                            row.game_date,
                            row.player_id,
                            row.actual_net_points_micros,
                            row.expected_net_points_micros,
                            row.dividend_cents,
                        )
                        for row in connection.execute(
                            select(
                                ReplayEventRow.game_date,
                                ReplayEventRow.player_id,
                                ReplayEventRow.actual_net_points_micros,
                                ReplayEventRow.expected_net_points_micros,
                                ReplayEventRow.dividend_cents,
                            ).order_by(
                                ReplayEventRow.game_date,
                                ReplayEventRow.player_id,
                            )
                        )
                    ]
                    replay_digest = replay_seed_digest(replay_rows)
                replay_state_row = connection.execute(
                    select(GameStateRow.id, GameStateRow.season_id).where(
                        GameStateRow.id == GAME_STATE_ID
                    )
                ).one_or_none()
                if replay_state_row is not None:
                    replay_state = (replay_state_row.id, replay_state_row.season_id)
        except SQLAlchemyError as exc:
            raise RuntimeError("market database is unavailable or not migrated") from exc
        if self.engine.dialect.name != "postgresql" and (
            not isinstance(seed_count, int) or seed_count < 1
        ):
            raise RuntimeError("market database has no seeded player listings")
        if self.engine.dialect.name == "postgresql":
            if replay_event_count != EXPECTED_REPLAY_EVENT_COUNT:
                raise RuntimeError(
                    "market database canonical replay seed is incomplete or invalid"
                )
            if replay_digest != EXPECTED_REPLAY_SEED_SHA256:
                raise RuntimeError(
                    "market database canonical replay seed is incomplete or invalid"
                )
        elif not isinstance(replay_event_count, int) or replay_event_count < 1:
            raise RuntimeError("market database has no seeded replay events")
        if replay_state != (GAME_STATE_ID, "2025-26"):
            raise RuntimeError("market database replay clock is missing or invalid")

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

    def seed_replay_events(
        self,
        *,
        season_id: str,
        events: Sequence[SeedReplayEvent],
    ) -> None:
        if not season_id or len(season_id) > 32:
            raise ValueError("replay season id is invalid")
        if not events:
            raise ValueError("replay seed must include events")
        event_keys = {(event.game_date, event.player_id) for event in events}
        if len(event_keys) != len(events):
            raise ValueError("replay event keys must be unique")

        with self.session() as session, session.begin():
            player_ids = {event.player_id for event in events}
            known_player_ids = set(
                session.scalars(
                    select(PlayerListingRow.id).where(PlayerListingRow.id.in_(player_ids))
                )
            )
            if known_player_ids != player_ids:
                raise ValueError("replay seed references an unknown player")

            existing_events = {
                (row.game_date, row.player_id): (
                    row.actual_net_points_micros,
                    row.expected_net_points_micros,
                    row.dividend_cents,
                )
                for row in session.scalars(
                    select(ReplayEventRow).where(
                        ReplayEventRow.player_id.in_(player_ids)
                    )
                )
            }
            for event in events:
                existing = existing_events.get((event.game_date, event.player_id))
                expected = (
                    event.actual_net_points_micros,
                    event.expected_net_points_micros,
                    event.dividend_cents,
                )
                if existing is not None:
                    if existing != expected:
                        raise ValueError("replay seed conflicts with an existing event")
                    continue
                session.add(
                    ReplayEventRow(
                        game_date=event.game_date,
                        player_id=event.player_id,
                        actual_net_points_micros=event.actual_net_points_micros,
                        expected_net_points_micros=event.expected_net_points_micros,
                        dividend_cents=event.dividend_cents,
                    )
                )

            state = session.get(GameStateRow, GAME_STATE_ID)
            if state is None:
                session.add(
                    GameStateRow(
                        id=GAME_STATE_ID,
                        season_id=season_id,
                        next_game_date=min(event.game_date for event in events),
                    )
                )
            elif state.season_id != season_id:
                raise ValueError("replay seed season conflicts with game state")

    def seed_replay_from_file(self, path: Path) -> None:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict) or payload.get("schema_version") != 1:
            raise ValueError("replay seed must use schema_version 1")
        season_id = payload.get("season_id")
        raw_days = payload.get("days")
        if not isinstance(season_id, str) or not isinstance(raw_days, list):
            raise ValueError("replay seed is missing season metadata")

        events: list[SeedReplayEvent] = []
        for raw_day in raw_days:
            if not isinstance(raw_day, dict) or not isinstance(raw_day.get("events"), list):
                raise ValueError("replay seed day is invalid")
            raw_day_date = raw_day.get("date")
            if not isinstance(raw_day_date, str):
                raise ValueError("replay seed day is missing its date")
            for raw_event in raw_day["events"]:
                if not isinstance(raw_event, dict):
                    raise ValueError("replay seed event is invalid")
                try:
                    event_date = str(raw_event["game_date"])
                    if event_date != raw_day_date:
                        raise ValueError("replay event date does not match its day")
                    events.append(
                        SeedReplayEvent(
                            game_date=date.fromisoformat(event_date),
                            player_id=str(raw_event["player_id"]),
                            actual_net_points_micros=int(
                                raw_event["actual_net_points_micros"]
                            ),
                            expected_net_points_micros=int(
                                raw_event["expected_net_points_micros"]
                            ),
                            dividend_cents=int(raw_event["dividend_cents"]),
                        )
                    )
                except (KeyError, TypeError, ValueError) as exc:
                    raise ValueError("replay seed event has invalid fields") from exc
        self.seed_replay_events(season_id=season_id, events=events)

    def dispose(self) -> None:
        self.engine.dispose()
