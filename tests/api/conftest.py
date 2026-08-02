from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import pytest
from fastapi.testclient import TestClient

from nba_stock_market.api.app import create_app
from nba_stock_market.api.auth import Principal, TokenVerifier
from nba_stock_market.api.database import Database, SeedPlayer, SeedReplayEvent
from nba_stock_market.api.settings import ApiSettings


@dataclass(frozen=True)
class FixtureTokenVerifier(TokenVerifier):
    users: dict[str, Principal]

    def verify(self, token: str) -> Principal:
        try:
            return self.users[token]
        except KeyError as exc:
            raise ValueError("invalid token") from exc


@pytest.fixture
def players() -> list[SeedPlayer]:
    return [
        SeedPlayer(
            id="sga",
            name="Shai Gilgeous-Alexander",
            tier="star",
            current_price_cents=5_000_000_000,
            opening_price_cents=5_000_000_000,
            actual_salary_cents=4_080_615_000,
            shares_outstanding=100,
        ),
        SeedPlayer(
            id="jokic",
            name="Nikola Jokic",
            tier="star",
            current_price_cents=10_000_000_000,
            opening_price_cents=10_000_000_000,
            actual_salary_cents=5_903_311_400,
            shares_outstanding=100,
        ),
        SeedPlayer(
            id="one-share",
            name="One Share Player",
            tier="bench",
            current_price_cents=500_000_000,
            opening_price_cents=500_000_000,
            actual_salary_cents=500_000_000,
            shares_outstanding=1,
        ),
    ]


@pytest.fixture
def database(tmp_path, players: list[SeedPlayer]) -> Database:
    db = Database(f"sqlite+pysqlite:///{tmp_path / 'api.db'}")
    db.create_schema()
    db.seed_players(players)
    db.seed_replay_events(
        season_id="2025-26",
        events=[
            SeedReplayEvent(
                game_date=date(2025, 10, 21),
                player_id="sga",
                actual_net_points_micros=40_000_000,
                expected_net_points_micros=20_000_000,
                dividend_cents=80_000_000,
            )
        ],
    )
    yield db
    db.dispose()


@pytest.fixture
def client(database: Database) -> TestClient:
    verifier = FixtureTokenVerifier(
        {
            "alice-token": Principal(id="alice", display_name="Alice"),
            "bob-token": Principal(id="bob", display_name="Bob"),
        }
    )
    app = create_app(
        settings=ApiSettings(database_url=database.url, environment="test"),
        database=database,
        token_verifier=verifier,
    )
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def alice_headers() -> dict[str, str]:
    return {"Authorization": "Bearer alice-token"}
