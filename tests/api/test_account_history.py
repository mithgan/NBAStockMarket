from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import delete, func, inspect, select, text

from nba_stock_market.api.auth import Principal
from nba_stock_market.api.database import (
    AccountActivityRow,
    AccountRow,
    AccountResetCommandRow,
    AccountSettlementMembershipRow,
    Base,
    BoostRow,
    Database,
    HoldingRow,
    PortfolioSnapshotRow,
    SeedReplayEvent,
    SettlementRow,
    WeeklyShortRow,
    utcnow,
)
from nba_stock_market.api.service import MarketService


def test_account_history_schema_has_authoritative_read_models(database: Database) -> None:
    tables = Base.metadata.tables

    assert {
        "market_account_activity",
        "market_account_settlement_memberships",
        "market_portfolio_snapshots",
        "market_account_reset_commands",
    } <= set(tables)
    assert "reset_at" in tables["market_accounts"].columns

    activity = tables["market_account_activity"]
    assert {"account_id", "source_key"} == {
        column.name
        for constraint in activity.constraints
        if constraint.name == "uq_market_account_activity_source"
        for column in constraint.columns
    }

    snapshots = tables["market_portfolio_snapshots"]
    assert [column.name for column in snapshots.primary_key.columns] == [
        "account_id",
        "game_date",
    ]

    reset_commands = tables["market_account_reset_commands"]
    assert {"account_id", "idempotency_key"} == {
        column.name
        for constraint in reset_commands.constraints
        if constraint.name == "uq_market_reset_account_idempotency"
        for column in constraint.columns
    }

    inspector = inspect(database.engine)
    assert {
        "market_account_activity",
        "market_account_settlement_memberships",
        "market_portfolio_snapshots",
        "market_account_reset_commands",
    } <= set(inspector.get_table_names())


def test_new_account_records_reset_boundary(database: Database) -> None:
    before = utcnow()
    MarketService(database).portfolio(Principal(id="alice", display_name="Alice"))
    after = utcnow()

    with database.session() as session:
        account = session.scalar(select(AccountRow).where(AccountRow.id == "alice"))

    assert account is not None
    assert before <= account.reset_at <= after


def test_trade_and_instrument_retries_create_one_activity_each(
    client,
    database: Database,
    alice_headers: dict[str, str],
) -> None:
    buy_headers = {**alice_headers, "Idempotency-Key": "history-buy-sga"}
    buy = client.post(
        "/api/v1/trades",
        headers=buy_headers,
        json={"player_id": "sga", "side": "buy"},
    )
    buy_replay = client.post(
        "/api/v1/trades",
        headers=buy_headers,
        json={"player_id": "sga", "side": "buy"},
    )
    boost_headers = {**alice_headers, "Idempotency-Key": "history-boost-sga"}
    boost = client.post(
        "/api/v1/instruments/boosts",
        headers=boost_headers,
        json={"player_id": "sga", "game_date": "2025-10-21"},
    )
    boost_replay = client.post(
        "/api/v1/instruments/boosts",
        headers=boost_headers,
        json={"player_id": "sga", "game_date": "2025-10-21"},
    )
    short_headers = {
        "Authorization": "Bearer bob-token",
        "Idempotency-Key": "history-short-sga",
    }
    short = client.post(
        "/api/v1/instruments/weekly-shorts",
        headers=short_headers,
        json={"player_id": "sga"},
    )
    short_replay = client.post(
        "/api/v1/instruments/weekly-shorts",
        headers=short_headers,
        json={"player_id": "sga"},
    )

    assert [response.status_code for response in (buy, boost, short)] == [201, 201, 201]
    assert [response.status_code for response in (buy_replay, boost_replay, short_replay)] == [
        200,
        200,
        200,
    ]

    buy_payload = buy.json()["data"]
    boost_payload = boost.json()["data"]
    short_payload = short.json()["data"]
    with database.session() as session:
        rows = session.scalars(
            select(AccountActivityRow).order_by(
                AccountActivityRow.account_id,
                AccountActivityRow.kind,
            )
        ).all()

    assert [(row.account_id, row.kind, row.player_id) for row in rows] == [
        ("alice", "boost_armed", "sga"),
        ("alice", "trade_buy", "sga"),
        ("bob", "weekly_short_opened", "sga"),
    ]
    by_kind = {row.kind: row for row in rows}
    trade = buy_payload["trade"]
    assert by_kind["trade_buy"].amount_cents == -(
        trade["execution_price_cents"] + trade["fee_cents"]
    )
    assert by_kind["trade_buy"].source_key == f"trade:{trade['id']}"
    assert by_kind["trade_buy"].details == {
        "side": "buy",
        "execution_price_cents": trade["execution_price_cents"],
        "fee_cents": trade["fee_cents"],
        "new_price_cents": trade["new_price_cents"],
    }
    assert by_kind["boost_armed"].amount_cents == -boost_payload["position"][
        "fee_cents"
    ]
    assert by_kind["boost_armed"].source_key == (
        f"boost:{boost_payload['position']['id']}:armed"
    )
    assert by_kind["weekly_short_opened"].amount_cents == -short_payload["position"][
        "fee_cents"
    ]
    assert by_kind["weekly_short_opened"].details["collateral_cents"] == 200_000_000


def test_activity_writer_reuses_a_compatibility_trigger_row(
    database: Database,
) -> None:
    service = MarketService(database)
    service.portfolio(Principal(id="alice", display_name="Alice"))
    occurred_at = utcnow()
    with database.session() as session, session.begin():
        session.add(
            AccountActivityRow(
                id="00000000-0000-0000-0000-000000000001",
                account_id="alice",
                kind="trade_buy",
                player_id="sga",
                game_date=None,
                amount_cents=-100,
                source_key="trade:compat-trigger",
                details={"writer": "trigger"},
                occurred_at=occurred_at,
            )
        )
        session.flush()
        service._record_activity(
            session,
            account_id="alice",
            kind="trade_buy",
            player_id="sga",
            game_date=None,
            amount_cents=-200,
            source_key="trade:compat-trigger",
            details={"writer": "application"},
            occurred_at=occurred_at,
        )

    with database.session() as session:
        rows = session.scalars(
            select(AccountActivityRow).where(
                AccountActivityRow.source_key == "trade:compat-trigger"
            )
        ).all()

    assert len(rows) == 1
    assert rows[0].amount_cents == -100
    assert rows[0].details == {"writer": "trigger"}


def test_settlement_records_cash_activity_and_closing_snapshots(
    client,
    database: Database,
    alice_headers: dict[str, str],
) -> None:
    buy = client.post(
        "/api/v1/trades",
        headers={**alice_headers, "Idempotency-Key": "settle-history-buy"},
        json={"player_id": "sga", "side": "buy"},
    )
    boost = client.post(
        "/api/v1/instruments/boosts",
        headers={**alice_headers, "Idempotency-Key": "settle-history-boost"},
        json={"player_id": "sga", "game_date": "2025-10-21"},
    )
    short = client.post(
        "/api/v1/instruments/weekly-shorts",
        headers={
            "Authorization": "Bearer bob-token",
            "Idempotency-Key": "settle-history-short",
        },
        json={"player_id": "sga"},
    )
    assert buy.status_code == boost.status_code == short.status_code == 201

    service: MarketService = client.app.state.market_service
    first = service.settle_next(
        expected_game_date=date(2025, 10, 21),
        idempotency_key="history-settle-once",
    )
    replay = service.settle_next(
        expected_game_date=date(2025, 10, 21),
        idempotency_key="history-settle-once",
    )
    assert first["replayed"] is False
    assert replay["replayed"] is True

    alice_portfolio = client.get(
        "/api/v1/portfolio",
        headers=alice_headers,
    ).json()["data"]
    bob_portfolio = client.get(
        "/api/v1/portfolio",
        headers={"Authorization": "Bearer bob-token"},
    ).json()["data"]
    with database.session() as session:
        settlement_activity = session.scalars(
            select(AccountActivityRow)
            .where(
                AccountActivityRow.game_date == date(2025, 10, 21),
                AccountActivityRow.kind.in_(
                    (
                        "dividend",
                        "boost_consumed",
                        "boost_refunded",
                        "weekly_short_settled",
                        "weekly_short_voided",
                    )
                ),
            )
            .order_by(AccountActivityRow.account_id, AccountActivityRow.kind)
        ).all()
        snapshots = session.scalars(
            select(PortfolioSnapshotRow).order_by(PortfolioSnapshotRow.account_id)
        ).all()

    assert [(row.account_id, row.kind, row.amount_cents) for row in settlement_activity] == [
        ("alice", "boost_consumed", 80_000_000),
        ("alice", "dividend", 80_000_000),
        ("bob", "weekly_short_settled", -80_000_000),
    ]
    assert len({row.source_key for row in settlement_activity}) == 3
    assert [(row.account_id, row.game_date) for row in snapshots] == [
        ("alice", date(2025, 10, 21)),
        ("bob", date(2025, 10, 21)),
    ]
    snapshots_by_account = {row.account_id: row for row in snapshots}
    for account_id, portfolio in (
        ("alice", alice_portfolio),
        ("bob", bob_portfolio),
    ):
        snapshot = snapshots_by_account[account_id]
        assert snapshot.cash_cents == portfolio["cash_cents"]
        assert snapshot.free_cash_cents == portfolio["free_cash_cents"]
        assert snapshot.reserved_collateral_cents == portfolio[
            "reserved_collateral_cents"
        ]
        assert snapshot.market_value_cents == portfolio["market_value_cents"]
        assert snapshot.total_value_cents == portfolio["total_value_cents"]


def test_account_created_after_a_settlement_only_gets_future_history(
    database: Database,
) -> None:
    database.seed_replay_events(
        season_id="2025-26",
        events=[
            SeedReplayEvent(
                game_date=date(2025, 10, 22),
                player_id="sga",
                actual_net_points_micros=5_000_000,
                expected_net_points_micros=20_000_000,
                dividend_cents=-60_000_000,
            )
        ],
    )
    service = MarketService(database)
    service.portfolio(Principal(id="alice", display_name="Alice"))
    service.settle_next(
        expected_game_date=date(2025, 10, 21),
        idempotency_key="history-before-bob",
    )
    service.portfolio(Principal(id="bob", display_name="Bob"))
    assert service.settlement_history(
        Principal(id="bob", display_name="Bob"),
        limit=10,
    ) == []
    service.settle_next(
        expected_game_date=date(2025, 10, 22),
        idempotency_key="history-after-bob",
    )

    with database.session() as session:
        rows = session.scalars(
            select(PortfolioSnapshotRow).order_by(
                PortfolioSnapshotRow.account_id,
                PortfolioSnapshotRow.game_date,
            )
        ).all()

    assert [(row.account_id, row.game_date) for row in rows] == [
        ("alice", date(2025, 10, 21)),
        ("alice", date(2025, 10, 22)),
        ("bob", date(2025, 10, 22)),
    ]
    assert [
        row["game_date"]
        for row in service.settlement_history(
            Principal(id="bob", display_name="Bob"),
            limit=10,
        )
    ] == ["2025-10-22"]


def test_snapshot_account_scan_does_not_lock_every_account(
    database: Database,
    monkeypatch,
) -> None:
    service = MarketService(database)
    service.portfolio(Principal(id="alice", display_name="Alice"))
    session = database.session()
    transaction = session.begin()
    statements = []
    scalars = session.scalars

    def record_scalars(statement, *args, **kwargs):
        statements.append(statement)
        return scalars(statement, *args, **kwargs)

    monkeypatch.setattr(session, "scalars", record_scalars)
    try:
        service._record_portfolio_snapshots(
            session,
            game_date=date(2025, 10, 21),
            created_at=utcnow(),
        )
        assert len(statements) == 1
        assert statements[0]._for_update_arg is None
    finally:
        transaction.rollback()
        session.close()


def test_settlement_history_preserves_legacy_rows_without_snapshots(
    client,
    database: Database,
    alice_headers: dict[str, str],
) -> None:
    client.get("/api/v1/portfolio", headers=alice_headers)
    client.app.state.market_service.settle_next(
        expected_game_date=date(2025, 10, 21),
        idempotency_key="legacy-settlement-before-history-migration",
    )
    with database.session() as session, session.begin():
        session.execute(
            delete(PortfolioSnapshotRow).where(
                PortfolioSnapshotRow.account_id == "alice"
            )
        )
        session.add(
            AccountSettlementMembershipRow(
                account_id="alice",
                game_date=date(2025, 10, 21),
            )
        )

    history = client.get("/api/v1/settlements", headers=alice_headers)

    assert history.status_code == 200
    assert [row["game_date"] for row in history.json()["data"]] == ["2025-10-21"]


def test_sqlite_upgrade_backfills_existing_account_activity(
    client,
    database: Database,
    alice_headers: dict[str, str],
) -> None:
    assert client.post(
        "/api/v1/trades",
        headers={**alice_headers, "Idempotency-Key": "upgrade-buy"},
        json={"player_id": "sga", "side": "buy"},
    ).status_code == 201
    assert client.post(
        "/api/v1/instruments/boosts",
        headers={**alice_headers, "Idempotency-Key": "upgrade-boost"},
        json={"player_id": "sga", "game_date": "2025-10-21"},
    ).status_code == 201
    assert client.post(
        "/api/v1/instruments/weekly-shorts",
        headers={
            "Authorization": "Bearer bob-token",
            "Idempotency-Key": "upgrade-short",
        },
        json={"player_id": "sga"},
    ).status_code == 201
    client.app.state.market_service.settle_next(
        expected_game_date=date(2025, 10, 21),
        idempotency_key="upgrade-settlement",
    )

    with database.engine.begin() as connection:
        connection.execute(text("DROP TABLE market_account_activity"))

    database.create_schema()
    with database.session() as session:
        rows = session.scalars(
            select(AccountActivityRow).order_by(
                AccountActivityRow.account_id,
                AccountActivityRow.kind,
            )
        ).all()

    assert [(row.account_id, row.kind) for row in rows] == [
        ("alice", "boost_armed"),
        ("alice", "boost_consumed"),
        ("alice", "dividend"),
        ("alice", "trade_buy"),
        ("bob", "weekly_short_opened"),
        ("bob", "weekly_short_settled"),
    ]
    assert len({row.source_key for row in rows}) == 6
    database.create_schema()
    with database.session() as session:
        assert session.scalar(select(func.count(AccountActivityRow.id))) == 6


def test_sqlite_membership_upgrade_is_retryable_and_clock_free(
    client,
    database: Database,
    alice_headers: dict[str, str],
) -> None:
    client.get("/api/v1/portfolio", headers=alice_headers)
    client.get(
        "/api/v1/portfolio",
        headers={"Authorization": "Bearer bob-token"},
    )
    client.app.state.market_service.settle_next(
        expected_game_date=date(2025, 10, 21),
        idempotency_key="membership-upgrade-settlement",
    )
    with database.session() as session, session.begin():
        settlement = session.get(SettlementRow, date(2025, 10, 21))
        alice = session.get(AccountRow, "alice")
        assert settlement is not None and alice is not None
        settlement.settled_at = utcnow() - timedelta(days=1)
        alice.created_at = utcnow() + timedelta(days=1)
        session.execute(delete(PortfolioSnapshotRow))
        session.execute(delete(AccountSettlementMembershipRow))
        session.add(
            AccountSettlementMembershipRow(
                account_id="alice",
                game_date=date(2025, 10, 21),
            )
        )
        session.execute(
            text(
                "DELETE FROM market_local_schema_migrations "
                "WHERE version = '20260724000000_settlement_memberships'"
            )
        )

    database.create_schema()
    database.create_schema()
    with database.session() as session:
        rows = session.scalars(
            select(AccountSettlementMembershipRow).order_by(
                AccountSettlementMembershipRow.account_id,
                AccountSettlementMembershipRow.game_date,
            )
        ).all()

    assert [(row.account_id, row.game_date) for row in rows] == [
        ("alice", date(2025, 10, 21)),
        ("bob", date(2025, 10, 21)),
    ]


def test_history_apis_are_authenticated_paginated_and_account_scoped(
    client,
    database: Database,
    alice_headers: dict[str, str],
) -> None:
    for path in (
        "/api/v1/activity",
        "/api/v1/dividends",
        "/api/v1/portfolio/history",
    ):
        assert client.get(path).status_code == 401
        empty = client.get(path, headers=alice_headers)
        assert empty.status_code == 200
        assert empty.json() == {"data": {"items": [], "next_cursor": None}}

    actions = [
        ("buy", "history-page-buy-1"),
        ("sell", "history-page-sell"),
        ("buy", "history-page-buy-2"),
    ]
    for side, key in actions:
        response = client.post(
            "/api/v1/trades",
            headers={**alice_headers, "Idempotency-Key": key},
            json={"player_id": "sga", "side": side},
        )
        assert response.status_code == 201

    first = client.get("/api/v1/activity?limit=2", headers=alice_headers)
    assert first.status_code == 200
    first_payload = first.json()["data"]
    assert len(first_payload["items"]) == 2
    assert isinstance(first_payload["next_cursor"], str)
    second = client.get(
        "/api/v1/activity",
        headers=alice_headers,
        params={"limit": 2, "cursor": first_payload["next_cursor"]},
    )
    second_payload = second.json()["data"]
    assert second.status_code == 200
    assert len(second_payload["items"]) == 1
    assert second_payload["next_cursor"] is None
    ids = [item["id"] for item in first_payload["items"] + second_payload["items"]]
    assert len(ids) == len(set(ids)) == 3
    assert {item["kind"] for item in first_payload["items"] + second_payload["items"]} == {
        "trade_buy",
        "trade_sell",
    }
    assert all(item["occurred_at"].endswith("Z") for item in first_payload["items"])

    invalid = client.get(
        "/api/v1/activity",
        headers=alice_headers,
        params={"cursor": "not-a-valid-cursor"},
    )
    foreign = client.get(
        "/api/v1/activity",
        headers={"Authorization": "Bearer bob-token"},
        params={"cursor": first_payload["next_cursor"]},
    )
    wrong_resource = client.get(
        "/api/v1/portfolio/history",
        headers=alice_headers,
        params={"cursor": first_payload["next_cursor"]},
    )
    service: MarketService = client.app.state.market_service
    malformed_id_cursor = service._encode_cursor(
        {
            "v": 1,
            "resource": "activity",
            "account_id": "alice",
            "occurred_at": "2025-10-21T00:00:00",
            "id": "\x00",
        }
    )
    malformed_id = client.get(
        "/api/v1/activity",
        headers=alice_headers,
        params={"cursor": malformed_id_cursor},
    )
    non_ascii = client.get(
        "/api/v1/activity",
        headers=alice_headers,
        params={"cursor": "é"},
    )
    for response in (invalid, foreign, wrong_resource, malformed_id, non_ascii):
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "invalid_cursor"

    service.settle_next(
        expected_game_date=date(2025, 10, 21),
        idempotency_key="history-api-settlement",
    )
    dividends = client.get("/api/v1/dividends", headers=alice_headers)
    history = client.get("/api/v1/portfolio/history", headers=alice_headers)

    assert dividends.status_code == 200
    assert dividends.json()["data"]["next_cursor"] is None
    assert dividends.json()["data"]["items"][0]["kind"] == "dividend"
    assert dividends.json()["data"]["items"][0]["amount_cents"] == 80_000_000
    assert history.status_code == 200
    assert history.json()["data"]["next_cursor"] is None
    assert history.json()["data"]["items"] == [
        {
            "game_date": "2025-10-21",
            "cash_cents": history.json()["data"]["items"][0]["cash_cents"],
            "free_cash_cents": history.json()["data"]["items"][0][
                "free_cash_cents"
            ],
            "reserved_collateral_cents": 0,
            "market_value_cents": history.json()["data"]["items"][0][
                "market_value_cents"
            ],
            "total_value_cents": history.json()["data"]["items"][0][
                "total_value_cents"
            ],
            "created_at": history.json()["data"]["items"][0]["created_at"],
        }
    ]
    assert history.json()["data"]["items"][0]["created_at"].endswith("Z")


def test_account_reset_is_one_time_pristine_transition_and_isolated(
    client,
    database: Database,
    alice_headers: dict[str, str],
) -> None:
    bob_headers = {"Authorization": "Bearer bob-token"}
    client.get("/api/v1/portfolio", headers=alice_headers)
    client.get("/api/v1/portfolio", headers=bob_headers)
    client.app.state.market_service.settle_next(
        expected_game_date=date(2025, 10, 21),
        idempotency_key="reset-history-settlement",
    )
    with database.session() as session, session.begin():
        settlement = session.get(SettlementRow, date(2025, 10, 21))
        assert settlement is not None
        settlement.settled_at = utcnow() + timedelta(days=1)
        session.add(
            AccountSettlementMembershipRow(
                account_id="alice",
                game_date=date(2025, 10, 21),
            )
        )
    before = client.get("/api/v1/portfolio", headers=alice_headers).json()["data"]
    bob_before = client.get("/api/v1/portfolio", headers=bob_headers).json()["data"]
    assert before["version"] == 0
    assert before["holdings"] == []
    assert client.get("/api/v1/activity", headers=alice_headers).json()["data"] == {
        "items": [],
        "next_cursor": None,
    }
    assert client.get(
        "/api/v1/portfolio/history",
        headers=alice_headers,
    ).json()["data"]["items"]

    missing_confirmation = client.post(
        "/api/v1/account/reset",
        headers={**alice_headers, "Idempotency-Key": "reset-missing-confirm"},
        json={"confirmation": "reset", "expected_account_version": before["version"]},
    )
    stale = client.post(
        "/api/v1/account/reset",
        headers={**alice_headers, "Idempotency-Key": "reset-stale-version"},
        json={
            "confirmation": "RESET",
            "expected_account_version": before["version"] + 1,
        },
    )
    assert missing_confirmation.status_code == 422
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "account_version_conflict"

    reset_headers = {**alice_headers, "Idempotency-Key": "reset-account-once"}
    reset_body = {
        "confirmation": "RESET",
        "expected_account_version": before["version"],
    }
    first = client.post(
        "/api/v1/account/reset",
        headers=reset_headers,
        json=reset_body,
    )
    replay = client.post(
        "/api/v1/account/reset",
        headers=reset_headers,
        json=reset_body,
    )
    conflict = client.post(
        "/api/v1/account/reset",
        headers=reset_headers,
        json={**reset_body, "expected_account_version": before["version"] + 1},
    )

    assert first.status_code == 201
    assert replay.status_code == 200
    assert replay.json()["data"] == {**first.json()["data"], "replayed": True}
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "idempotency_conflict"
    second_reset = client.post(
        "/api/v1/account/reset",
        headers={**alice_headers, "Idempotency-Key": "reset-account-twice"},
        json={
            "confirmation": "RESET",
            "expected_account_version": before["version"] + 1,
        },
    )
    assert second_reset.status_code == 409
    assert second_reset.json()["error"]["code"] == "reset_not_eligible"

    reset = first.json()["data"]
    assert reset["replayed"] is False
    assert reset["portfolio"]["cash_cents"] == 14_000_000_000
    assert reset["portfolio"]["free_cash_cents"] == 14_000_000_000
    assert reset["portfolio"]["market_value_cents"] == 0
    assert reset["portfolio"]["total_value_cents"] == 14_000_000_000
    assert reset["portfolio"]["holdings"] == []
    assert reset["portfolio"]["recent_trades"] == []
    assert reset["portfolio"]["version"] == before["version"] + 1
    assert reset["portfolio"]["reset_at"] == reset["reset_at"]
    assert reset["reset_at"].endswith("Z")

    assert client.get("/api/v1/activity", headers=alice_headers).json()["data"] == {
        "items": [],
        "next_cursor": None,
    }
    assert client.get("/api/v1/dividends", headers=alice_headers).json()["data"] == {
        "items": [],
        "next_cursor": None,
    }
    assert client.get(
        "/api/v1/portfolio/history",
        headers=alice_headers,
    ).json()["data"] == {"items": [], "next_cursor": None}
    assert client.get("/api/v1/settlements", headers=alice_headers).json() == {
        "data": []
    }

    market = client.get("/api/v1/market", headers=alice_headers).json()["data"]
    assert next(row for row in market if row["id"] == "sga")["available_shares"] == 100
    bob_after = client.get("/api/v1/portfolio", headers=bob_headers).json()["data"]
    assert bob_after == bob_before

    database.create_schema()
    with database.session() as session:
        assert session.scalar(
            select(func.count(HoldingRow.account_id)).where(
                HoldingRow.account_id == "alice"
            )
        ) == 0
        assert session.scalar(
            select(func.count(WeeklyShortRow.id)).where(
                WeeklyShortRow.account_id == "alice"
            )
        ) == 0
        assert session.scalar(
            select(func.count(BoostRow.id)).where(BoostRow.account_id == "alice")
        ) == 0
        assert session.scalar(
            select(func.count(AccountActivityRow.id)).where(
                AccountActivityRow.account_id == "alice"
            )
        ) == 0
        assert session.scalar(
            select(func.count(PortfolioSnapshotRow.account_id)).where(
                PortfolioSnapshotRow.account_id == "alice"
            )
        ) == 0
        assert session.scalar(
            select(func.count(AccountSettlementMembershipRow.account_id)).where(
                AccountSettlementMembershipRow.account_id == "alice"
            )
        ) == 0
        assert session.scalar(
            select(func.count(AccountResetCommandRow.id)).where(
                AccountResetCommandRow.account_id == "alice"
            )
        ) == 1


def test_reset_timestamp_is_not_used_to_order_later_commands(
    client,
    database: Database,
    alice_headers: dict[str, str],
) -> None:
    before = client.get("/api/v1/portfolio", headers=alice_headers).json()["data"]
    reset = client.post(
        "/api/v1/account/reset",
        headers={**alice_headers, "Idempotency-Key": "reset-before-clock-skew"},
        json={
            "confirmation": "RESET",
            "expected_account_version": before["version"],
        },
    )
    assert reset.status_code == 201
    with database.session() as session, session.begin():
        account = session.get(AccountRow, "alice")
        assert account is not None
        account.reset_at = utcnow() + timedelta(days=1)

    trade_headers = {**alice_headers, "Idempotency-Key": "trade-after-clock-skew"}
    trade = client.post(
        "/api/v1/trades",
        headers=trade_headers,
        json={"player_id": "sga", "side": "buy"},
    )
    retry = client.post(
        "/api/v1/trades",
        headers=trade_headers,
        json={"player_id": "sga", "side": "buy"},
    )

    assert trade.status_code == 201
    assert retry.status_code == 200
    assert retry.json()["data"] == {**trade.json()["data"], "replayed": True}
    portfolio = client.get("/api/v1/portfolio", headers=alice_headers).json()["data"]
    assert [row["id"] for row in portfolio["recent_trades"]] == [
        trade.json()["data"]["trade"]["id"]
    ]
    activity = client.get("/api/v1/activity", headers=alice_headers).json()["data"]
    assert [row["kind"] for row in activity["items"]] == ["trade_buy"]


def test_account_reset_rejects_account_after_trade_without_changing_market(
    client,
    database: Database,
    alice_headers: dict[str, str],
) -> None:
    buy = client.post(
        "/api/v1/trades",
        headers={**alice_headers, "Idempotency-Key": "reset-exploit-buy"},
        json={"player_id": "sga", "side": "buy"},
    )
    assert buy.status_code == 201
    before = buy.json()["data"]["portfolio"]
    market_before = next(
        row
        for row in client.get("/api/v1/market", headers=alice_headers).json()["data"]
        if row["id"] == "sga"
    )

    reset = client.post(
        "/api/v1/account/reset",
        headers={**alice_headers, "Idempotency-Key": "reset-after-trade"},
        json={
            "confirmation": "RESET",
            "expected_account_version": before["version"],
        },
    )

    assert reset.status_code == 409
    assert reset.json()["error"]["code"] == "reset_not_eligible"
    assert client.get("/api/v1/portfolio", headers=alice_headers).json()["data"] == before
    market_after = next(
        row
        for row in client.get("/api/v1/market", headers=alice_headers).json()["data"]
        if row["id"] == "sga"
    )
    assert market_after == market_before
    with database.session() as session:
        assert session.scalar(
            select(func.count(HoldingRow.account_id)).where(
                HoldingRow.account_id == "alice"
            )
        ) == 1
        assert session.scalar(
            select(func.count(AccountResetCommandRow.id)).where(
                AccountResetCommandRow.account_id == "alice"
            )
        ) == 0


def test_account_reset_rejects_active_instrument_without_releasing_collateral(
    client,
    database: Database,
    alice_headers: dict[str, str],
) -> None:
    short_headers = {**alice_headers, "Idempotency-Key": "reset-protected-short"}
    armed = client.post(
        "/api/v1/instruments/weekly-shorts",
        headers=short_headers,
        json={"player_id": "sga"},
    )
    assert armed.status_code == 201
    before = armed.json()["data"]["portfolio"]
    assert before["reserved_collateral_cents"] == 200_000_000

    reset = client.post(
        "/api/v1/account/reset",
        headers={**alice_headers, "Idempotency-Key": "reset-after-short"},
        json={
            "confirmation": "RESET",
            "expected_account_version": before["version"],
        },
    )

    assert reset.status_code == 409
    assert reset.json()["error"]["code"] == "reset_not_eligible"
    assert client.get("/api/v1/portfolio", headers=alice_headers).json()["data"] == before
    with database.session() as session:
        assert session.scalar(
            select(func.count(WeeklyShortRow.id)).where(
                WeeklyShortRow.account_id == "alice",
                WeeklyShortRow.status == "active",
            )
        ) == 1
        assert session.scalar(
            select(func.count(AccountResetCommandRow.id)).where(
                AccountResetCommandRow.account_id == "alice"
            )
        ) == 0
