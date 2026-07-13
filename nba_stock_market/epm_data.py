"""Dunks & Threes EPM snapshots: fetch, cache, and load as ImpactRows.

The `/api/v1/epm` endpoint returns one row per player per game day (each row
carries the player's EPM rating as of that date) and accepts `?date=`.
To build an end-of-season talent snapshot we sweep the final week of the
regular season and keep each player's most recent row.

Auth: the raw key in an ``Authorization`` header, read from ``DNT_API_KEY``
(environment variable, or a line in the repo-root ``.env``).  The key never
appears in cached files or logs.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import time
import urllib.request
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Callable

from nba_stock_market.opening_prices import ImpactRow


class NotConfigured(RuntimeError):
    """Raised when the Dunks & Threes API key is missing for EPM fetches."""


EPM_ENDPOINT = "https://dunksandthrees.com/api/v1/epm"
DEFAULT_CACHE_DIR = Path("data/raw/opening")

# Final week of each regular season: sweeping several days catches players
# who rested on any single day.
SEASON_END_SWEEPS: dict[int, tuple[str, str]] = {
    2026: ("2026-04-06", "2026-04-12"),
    2025: ("2025-04-07", "2025-04-13"),
    2024: ("2024-04-08", "2024-04-14"),
    2023: ("2023-04-03", "2023-04-09"),
    2022: ("2022-04-04", "2022-04-10"),
}

RequestJSON = Callable[[str], list[dict[str, Any]]]


@dataclass(frozen=True)
class EPMRow:
    player_id: str
    player_name: str
    game_dt: str
    epm: float
    oepm: float
    depm: float


def _load_key() -> str:
    key = os.getenv("DNT_API_KEY")
    if not key:
        env_path = Path(".env")
        if env_path.exists():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                name, _, value = line.partition("=")
                if name.strip() == "DNT_API_KEY" and value.strip():
                    key = value.strip()
                    break
    if not key or key == "paste-your-key-here":
        raise NotConfigured("DNT_API_KEY is required for Dunks & Threes EPM fetches")
    return key


def _default_request_json(url: str) -> list[dict[str, Any]]:
    request = urllib.request.Request(url, headers={"Authorization": _load_key()})
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, list):
        raise ValueError(f"unexpected EPM payload for {url}: {str(payload)[:120]}")
    return payload


def fetch_season_snapshot(
    season_year: int,
    *,
    request_json: RequestJSON | None = None,
    pause_seconds: float = 0.4,
) -> list[EPMRow]:
    """Sweep the season's final week; keep each player's latest row."""

    if season_year not in SEASON_END_SWEEPS:
        raise ValueError(f"no sweep window configured for season year {season_year}")
    request_json = request_json or _default_request_json
    start_text, end_text = SEASON_END_SWEEPS[season_year]
    current = date.fromisoformat(start_text)
    end = date.fromisoformat(end_text)

    latest: dict[str, EPMRow] = {}
    while current <= end:
        rows = request_json(f"{EPM_ENDPOINT}?date={current.isoformat()}")
        for raw in rows:
            if raw.get("epm") in (None, ""):
                continue
            row = EPMRow(
                player_id=str(raw["player_id"]),
                player_name=str(raw["player_name"]).strip(),
                game_dt=str(raw["game_dt"])[:10],
                epm=float(raw["epm"]),
                oepm=float(raw.get("oepm") or 0.0),
                depm=float(raw.get("depm") or 0.0),
            )
            existing = latest.get(row.player_id)
            if existing is None or row.game_dt >= existing.game_dt:
                latest[row.player_id] = row
        current += timedelta(days=1)
        if pause_seconds and current <= end:
            time.sleep(pause_seconds)

    if not latest:
        raise ValueError(f"EPM sweep for {season_year} returned no rows")
    return sorted(latest.values(), key=lambda row: row.player_id)


def snapshot_path(season_year: int, cache_dir: Path = DEFAULT_CACHE_DIR) -> Path:
    return cache_dir / f"epm_{season_year}.csv"


def write_snapshot(rows: list[EPMRow], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["player_id", "player_name", "game_dt", "epm", "oepm", "depm"])
        for row in rows:
            writer.writerow(
                [row.player_id, row.player_name, row.game_dt, row.epm, row.oepm, row.depm]
            )


def load_epm_rows(path: Path) -> list[ImpactRow]:
    """Load a cached snapshot as ImpactRows (EPM is pre-shrunk; minutes=0)."""

    rows: list[ImpactRow] = []
    with path.open(encoding="utf-8", newline="") as handle:
        for raw in csv.DictReader(handle):
            name = (raw.get("player_name") or "").strip()
            epm = raw.get("epm")
            if not name or epm in (None, ""):
                continue
            rows.append(
                ImpactRow(
                    player=name,
                    team="",
                    position="",
                    age=0.0,
                    minutes=0.0,
                    games=0.0,
                    rating=float(epm),
                    war=0.0,
                )
            )
    if not rows:
        raise ValueError(f"no EPM rows in {path}")
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch Dunks & Threes EPM season snapshots.")
    parser.add_argument(
        "--seasons",
        type=int,
        nargs="+",
        default=sorted(SEASON_END_SWEEPS),
        help="Season end-years to fetch (default: all configured)",
    )
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIR)
    args = parser.parse_args()

    for season_year in args.seasons:
        rows = fetch_season_snapshot(season_year)
        path = snapshot_path(season_year, args.cache_dir)
        write_snapshot(rows, path)
        print(f"{season_year}: {len(rows)} players -> {path}")


if __name__ == "__main__":
    main()
