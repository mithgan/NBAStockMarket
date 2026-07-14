from __future__ import annotations

import json
from pathlib import Path

from scripts.generate_app_snapshot import generate_snapshot


def test_snapshot_uses_canonical_ids_prices_and_bias_corrected_examples(
    tmp_path: Path,
) -> None:
    openings = tmp_path / "openings.csv"
    openings.write_text(
        "player,tier,opening_price,actual_salary\n"
        "nikola jokic,star,51823282,59033114\n"
        "de'aaron fox,mid,25107123,37096620\n",
        encoding="utf-8",
    )
    game_log = tmp_path / "games.csv"
    game_log.write_text(
        "player_id,player_name\n"
        "3112335,Nikola Jokic\n"
        "4066259,De'Aaron Fox\n",
        encoding="utf-8",
    )
    backtest = tmp_path / "backtest.json"
    backtest.write_text(
        json.dumps(
            {
                "examples": [
                    {
                        "player": "Nikola Jokic",
                        "game_date": "2025-12-25",
                        "actual_net_points": 59.35,
                        "expected_net_points": 25.9831,
                        "payout_per_share": 1_334_675.2,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    rendered = generate_snapshot(openings, backtest, game_log, limit=2)

    assert 'id: "3112335", name: "Nikola Jokic"' in rendered
    assert 'id: "4066259", name: "De\'Aaron Fox"' in rendered
    assert "listing_price: 51823282" in rendered
    assert "expected_net_points: 25.9831" in rendered
    assert "dividend_per_holder: 1334675.2" in rendered
    assert "Demo opponents until the multiplayer leaderboard API is wired" in rendered
