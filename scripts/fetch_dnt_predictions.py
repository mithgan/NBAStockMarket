#!/usr/bin/env python3
"""Cache Dunks & Threes projections for each game day in the backtest schedule."""

from __future__ import annotations

import argparse
import csv
import json
import os
import ssl
import time
import urllib.parse
import urllib.request
from pathlib import Path

from nba_stock_market.expectations import DUNKS_AND_THREES_ENDPOINT


REQUIRED_FIELDS = {
    "game_id", "player_id", "player_name", "p_mp", "p_pts", "p_fg2m",
    "p_fg2a", "p_fg3m", "p_fg3a", "p_ftm", "p_fta", "p_ast", "p_tov",
    "p_orb", "p_drb", "p_stl", "p_blk",
}


def _load_env_key(path: Path) -> str:
    if key := os.getenv("DNT_API_KEY"):
        return key
    if path.exists():
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, value = line.split("=", 1)
            if name.strip() == "DNT_API_KEY":
                return value.strip().strip("\"'")
    raise RuntimeError("DNT_API_KEY is required in the environment or .env")


def _validate(payload: object, game_date: str) -> list[dict[str, object]]:
    if not isinstance(payload, list):
        raise ValueError(f"D&T response for {game_date} is not a JSON list")
    for row in payload:
        if not isinstance(row, dict) or not REQUIRED_FIELDS <= row.keys():
            raise ValueError(f"D&T response for {game_date} has an invalid row")
    return payload


def _game_dates(game_log: Path) -> list[str]:
    with game_log.open(encoding="utf-8", newline="") as handle:
        return sorted({row["game_date"] for row in csv.DictReader(handle)})


def fetch_all(game_log: Path, cache_dir: Path, *, spacing: float = 0.75) -> tuple[int, int]:
    api_key = _load_env_key(Path(".env"))
    cache_dir.mkdir(parents=True, exist_ok=True)
    fetched = 0
    skipped = 0
    system_ca = Path("/etc/ssl/cert.pem")
    tls_context = ssl.create_default_context(
        cafile=str(system_ca) if system_ca.exists() else None
    )
    for game_date in _game_dates(game_log):
        destination = cache_dir / f"{game_date}.json"
        if destination.exists():
            _validate(json.loads(destination.read_text(encoding="utf-8")), game_date)
            skipped += 1
            continue
        url = f"{DUNKS_AND_THREES_ENDPOINT}?{urllib.parse.urlencode({'date': game_date})}"
        request = urllib.request.Request(url, headers={"Authorization": api_key})
        with urllib.request.urlopen(request, timeout=30, context=tls_context) as response:
            payload = _validate(json.load(response), game_date)
        temporary = destination.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        temporary.replace(destination)
        fetched += 1
        print(f"cached {game_date} ({len(payload)} projections)")
        time.sleep(spacing)
    return fetched, skipped


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game-log", type=Path, default=Path("data/raw/2025-26/player_game_logs.csv"))
    parser.add_argument("--cache-dir", type=Path, default=Path("data/raw/dnt"))
    parser.add_argument("--spacing", type=float, default=0.75)
    args = parser.parse_args()
    fetched, skipped = fetch_all(args.game_log, args.cache_dir, spacing=args.spacing)
    print(f"D&T cache complete: {fetched} fetched, {skipped} already cached")


if __name__ == "__main__":
    main()
