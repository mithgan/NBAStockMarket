from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_generator_emits_full_season_real_games_for_snapshot_players(tmp_path: Path) -> None:
    output = tmp_path / "trends.ts"
    debug_json = tmp_path / "trends.json"

    result = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts/generate_app_trends.py"),
            "--output",
            str(output),
            "--json-output",
            str(debug_json),
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
    ] == 1_335_090.36
    assert generated["spot_checks"]["3112335"]["2025-12-25"]["np"] == 59.35
    metadata = generated["metadata"]
    assert metadata["cold_start_bias_net_points"] == 1.002
    assert metadata["rolling_window_days"] == 30
    assert metadata["rolling_minimum_games"] == 300
    assert metadata["calibration_universe_size"] == 150
    assert metadata["calibration_projection_count"] == 10_689
    assert metadata["bias_corrections"]["2025-10-21"] == 1.002
    assert metadata["bias_corrections"]["2025-12-25"] == 0.42548589
    assert len(set(metadata["bias_corrections"].values())) > 100

    first = output.read_bytes()
    subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts/generate_app_trends.py"),
            "--output",
            str(output),
            "--json-output",
            str(debug_json),
        ],
        cwd=ROOT,
        check=True,
    )
    assert output.read_bytes() == first
