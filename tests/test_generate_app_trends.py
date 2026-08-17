from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INSTRUMENT_MIGRATION = (
    ROOT / "supabase/migrations/20260723010000_seed_replay_instrument_metadata.sql"
)


def test_routine_generation_does_not_rewrite_versioned_migration(tmp_path: Path) -> None:
    before = INSTRUMENT_MIGRATION.stat()
    result = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts/generate_app_trends.py"),
            "--output",
            str(tmp_path / "trends.ts"),
            "--api-output",
            str(tmp_path / "replay-seed.json"),
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    after = INSTRUMENT_MIGRATION.stat()
    assert after.st_mtime_ns == before.st_mtime_ns
    assert after.st_size == before.st_size


def test_generator_emits_full_season_real_games_for_snapshot_players(tmp_path: Path) -> None:
    output = tmp_path / "trends.ts"
    debug_json = tmp_path / "trends.json"
    api_seed = tmp_path / "replay-seed.json"
    api_seed_sql = tmp_path / "replay-seed.sql"
    api_instruments_sql = tmp_path / "replay-instruments.sql"
    api_economy_sql = tmp_path / "rebase-market-economy.sql"

    result = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts/generate_app_trends.py"),
            "--output",
            str(output),
            "--json-output",
            str(debug_json),
            "--api-output",
            str(api_seed),
            "--api-sql-output",
            str(api_seed_sql),
            "--api-instruments-sql-output",
            str(api_instruments_sql),
            "--api-economy-sql-output",
            str(api_economy_sql),
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    generated = json.loads(debug_json.read_text(encoding="utf-8"))
    assert len(generated["player_trends"]) == 30
    assert min(len(series) for series in generated["player_trends"].values()) > 15
    jokic = generated["player_trends"]["3112335"]
    assert len(jokic) > 50
    assert [point["date"] for point in jokic] == sorted(point["date"] for point in jokic)
    assert next(point for point in jokic if point["date"] == "2025-12-25")["np"] == 59.35
    assert next(point for point in jokic if point["date"] == "2025-12-25")[
        "expected_np"
    ] == 25.97274
    assert next(point for point in jokic if point["date"] == "2025-12-25")[
        "dividend_per_holder"
    ] == 2_670_180.73
    assert generated["spot_checks"]["3112335"]["2025-12-25"]["np"] == 59.35
    metadata = generated["metadata"]
    assert metadata["cold_start_bias_net_points"] == 1.002
    assert metadata["rolling_window_days"] == 30
    assert metadata["rolling_minimum_games"] == 300
    assert metadata["calibration_universe_size"] == 150
    assert metadata["calibration_projection_count"] == 10_689
    assert metadata["instrument_void_event_count"] == 3
    assert metadata["bias_corrections"]["2025-10-21"] == 1.002
    assert metadata["bias_corrections"]["2025-12-25"] == 0.42548589
    assert len(set(metadata["bias_corrections"].values())) > 100

    replay = json.loads(api_seed.read_text(encoding="utf-8"))
    assert replay["schema_version"] == 1
    assert replay["season_id"] == "2025-26"
    assert [day["date"] for day in replay["days"]] == sorted(
        day["date"] for day in replay["days"]
    )
    assert len(replay["days"]) > 150
    assert all(
        [event["player_id"] for event in day["events"]]
        == sorted(event["player_id"] for event in day["events"])
        for day in replay["days"]
    )
    events = [event for day in replay["days"] for event in day["events"]]
    assert len(events) == (
        sum(len(series) for series in generated["player_trends"].values())
        + len(generated["instrument_void_events"])
    )
    assert len({(event["game_date"], event["player_id"]) for event in events}) == len(events)
    christmas = next(
        event
        for event in events
        if event["player_id"] == "3112335" and event["game_date"] == "2025-12-25"
    )
    assert christmas == {
        "player_id": "3112335",
        "game_date": "2025-12-25",
        "actual_net_points_micros": 59_350_000,
        "expected_net_points_micros": 25_972_740,
        "dividend_cents": 267_018_073,
        "actual_minutes_micros": 43_000_000,
        "projected_minutes_micros": 32_308_300,
        "qualifies_for_instruments": True,
    }
    assert any(
        event["projected_minutes_micros"] is not None
        and event["qualifies_for_instruments"] is False
        for event in events
    )
    assert {
        (event["player_id"], event["game_date"])
        for event in events
        if event["actual_minutes_micros"] == 0
        and event["projected_minutes_micros"] is not None
    } == {
        ("4433621", "2025-11-12"),
        ("5105565", "2025-12-05"),
        ("3917376", "2025-12-20"),
    }
    seed_sql = api_seed_sql.read_text(encoding="utf-8")
    assert seed_sql.count("\n    ('20") == len(events)
    assert "where actual_minutes_micros > 0" in seed_sql
    assert "where not exists (" in seed_sql
    assert "seed.player_id = event.player_id" in seed_sql
    assert "('2025-11-12', '4433621'" in seed_sql
    assert (
        "('2025-12-25', '3112335', 59350000, 25972740, 267018073, 43000000)"
        in seed_sql
    )
    assert "create temporary table market_replay_event_seed" in seed_sql
    assert "lock table public.market_replay_events in share row exclusive mode" in (
        seed_sql
    )
    assert "raise exception 'canonical replay event conflict'" in seed_sql
    assert "event.dividend_cents" in seed_sql
    assert "is distinct from seed.dividend_cents" in seed_sql
    assert "from market_replay_event_seed" in seed_sql
    assert "on conflict (game_date, player_id) do nothing" in seed_sql
    assert seed_sql.index("raise exception 'canonical replay event conflict'") < (
        seed_sql.index("insert into public.market_replay_events")
    )
    assert "'historical-2025-26', '2025-26', null" in seed_sql
    instruments_sql = api_instruments_sql.read_text(encoding="utf-8")
    assert instruments_sql.count("\n    ('20") == len(events)
    assert (
        "('2025-12-25', '3112335', 59350000, 25972740, 267018073, "
        "43000000, 32308300, true)"
        in instruments_sql
    )
    assert "create temporary table market_replay_instrument_seed" in instruments_sql
    assert "lock table public.market_replay_events in share row exclusive mode" in (
        instruments_sql
    )
    assert "raise exception 'canonical replay event conflict'" in instruments_sql
    assert "from market_replay_instrument_seed as seed" in instruments_sql
    assert "seed.player_id = event.player_id" in instruments_sql
    assert instruments_sql.index("raise exception 'canonical replay event conflict'") < (
        instruments_sql.index("insert into public.market_replay_events")
    )
    assert "qualifies_for_instruments = excluded.qualifies_for_instruments" in (
        instruments_sql
    )
    economy_sql = api_economy_sql.read_text(encoding="utf-8")
    assert "alter column cash_cents set default 20782400000" in economy_sql
    assert "cash_cents = cash_cents + 6782400000" in economy_sql
    assert "before insert on public.market_accounts" in economy_sql
    assert "if new.cash_cents = 14000000000 then" in economy_sql
    assert "message = 'legacy $140M market worker rejected'" in economy_sql
    assert "when version = 0 then 0" in economy_sql
    assert "else version + 1" in economy_sql
    assert (
        "cannot rebase market economy after historical settlements exist"
        in economy_sql
    )
    assert "update public.market_replay_events as event" in economy_sql
    assert "where version = '20260815000000'" in economy_sql
    assert "insert into supabase_migrations.schema_migrations" not in economy_sql
    assert not economy_sql.startswith("begin;")
    assert not economy_sql.rstrip().endswith("commit;")
    assert "is distinct from seed.projected_minutes_micros" in economy_sql
    assert "event.qualifies_for_instruments" in economy_sql
    assert (
        "('2025-12-25', '3112335', 59350000, 25972740, 267018073, "
        "43000000, 32308300, true)"
        in economy_sql
    )

    first = output.read_bytes()
    first_api_seed = api_seed.read_bytes()
    first_api_seed_sql = api_seed_sql.read_bytes()
    first_api_instruments_sql = api_instruments_sql.read_bytes()
    first_api_economy_sql = api_economy_sql.read_bytes()
    subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts/generate_app_trends.py"),
            "--output",
            str(output),
            "--json-output",
            str(debug_json),
            "--api-output",
            str(api_seed),
            "--api-sql-output",
            str(api_seed_sql),
            "--api-instruments-sql-output",
            str(api_instruments_sql),
            "--api-economy-sql-output",
            str(api_economy_sql),
        ],
        cwd=ROOT,
        check=True,
    )
    assert output.read_bytes() == first
    assert api_seed.read_bytes() == first_api_seed
    assert api_seed_sql.read_bytes() == first_api_seed_sql
    assert api_instruments_sql.read_bytes() == first_api_instruments_sql
    assert api_economy_sql.read_bytes() == first_api_economy_sql
