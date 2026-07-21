from __future__ import annotations

import json

from fastapi.testclient import TestClient

from tests.api.conftest import FixtureTokenVerifier
from nba_stock_market.api.app import create_app
from nba_stock_market.api.auth import Principal
from nba_stock_market.api.settings import ApiSettings


def test_local_bootstrap_creates_schema_and_loads_seed_file(tmp_path) -> None:
    seed_file = tmp_path / "market-seed.json"
    seed_file.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "players": [
                    {
                        "id": "sga",
                        "name": "Shai Gilgeous-Alexander",
                        "tier": "star",
                        "current_price_cents": 5_000_000_000,
                        "opening_price_cents": 5_000_000_000,
                        "actual_salary_cents": 4_080_615_000,
                        "shares_outstanding": 100,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    settings = ApiSettings(
        environment="test",
        database_url=f"sqlite+pysqlite:///{tmp_path / 'bootstrap.db'}",
        auto_create_schema=True,
        seed_file=seed_file,
    )
    app = create_app(
        settings=settings,
        token_verifier=FixtureTokenVerifier(
            {"alice-token": Principal(id="alice", display_name="Alice")}
        ),
    )

    with TestClient(app) as client:
        response = client.get(
            "/api/v1/market",
            headers={"Authorization": "Bearer alice-token"},
        )

    assert response.status_code == 200
    assert response.json()["data"][0]["id"] == "sga"
