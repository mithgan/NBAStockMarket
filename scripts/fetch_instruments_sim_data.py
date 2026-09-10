#!/usr/bin/env python3
"""Cache the inputs for the instruments simulator (docs/data-regeneration.md).

Fetches, per season:
  - ESPN player game logs  -> data/raw/<season>/player_game_logs.csv
    (2025-26 is EXCLUDED here: use scripts/fetch_backtest_data.py, which also
    caches salaries and writes the validated manifest)
  - Dunks & Threes pregame box predictions -> data/raw/dnt[-<season>]/<date>.json
    (requires DNT_API_KEY in the environment or repo-root .env)

All caches are immutable once written: existing files are never re-downloaded,
so a completed cache is stable across reruns. Deleting a file re-fetches it.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from nba_stock_market.historical_data import parse_espn_summary, write_game_records

ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard"
ESPN_SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary"
DNT_PREDICTIONS = "https://dunksandthrees.com/api/v1/game-predictions-box"

# season end-year -> (regular-season start, end, expected game count, espn needed)
SEASONS = {
    2024: (date(2023, 10, 24), date(2024, 4, 14), 1230, True),
    2025: (date(2024, 10, 22), date(2025, 4, 13), 1230, True),
    2026: (date(2025, 10, 21), date(2026, 4, 12), 1230, False),
}


def season_label(year: int) -> str:
    return f"{year - 1}-{str(year)[2:]}"


def dnt_dir_for(year: int) -> Path:
    # 2025-26 predates the multi-season layout and keeps its original name.
    return ROOT / "data/raw" / ("dnt" if year == 2026 else f"dnt-{season_label(year)}")


def load_dnt_key() -> str:
    import os

    key = os.getenv("DNT_API_KEY")
    if not key:
        env_path = ROOT / ".env"
        if env_path.exists():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                name, _, value = line.partition("=")
                if name.strip() == "DNT_API_KEY" and value.strip():
                    key = value.strip()
    if not key:
        raise SystemExit("DNT_API_KEY is required (environment or repo-root .env)")
    return key


def download_json(url: str, path: Path, *, retries: int = 5) -> dict | list:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    path.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(retries):
        try:
            payload = subprocess.run(
                ["curl", "--location", "--fail", "--silent", "--show-error",
                 "--max-time", "30", url],
                check=True, stdout=subprocess.PIPE,
            ).stdout
            parsed = json.loads(payload)
            temporary = path.with_suffix(path.suffix + ".tmp")
            temporary.write_bytes(payload)
            temporary.replace(path)
            return parsed
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError("unreachable")


def fetch_espn_season(year: int, workers: int) -> None:
    start, end, expected_games, _ = SEASONS[year]
    label = season_label(year)
    raw_root = ROOT / "data/raw" / label
    logs_path = raw_root / "player_game_logs.csv"
    if logs_path.exists():
        print(f"{label}: player_game_logs.csv present, skipping ESPN fetch", flush=True)
        return
    days = [start + timedelta(days=offset) for offset in range((end - start).days + 1)]
    events: dict[str, date] = {}
    for day in days:
        compact = day.strftime("%Y%m%d")
        payload = download_json(
            f"{ESPN_SCOREBOARD}?dates={compact}&limit=100",
            raw_root / "espn" / "scoreboards" / f"{compact}.json",
        )
        for event in payload.get("events", []):
            season = event.get("season", {})
            competition = event.get("competitions", [{}])[0]
            status = event.get("status", {}).get("type", {})
            if (
                season.get("year") == year
                and season.get("type") == 2
                and competition.get("type", {}).get("abbreviation") == "STD"
                and status.get("completed") is True
                and re.fullmatch(r"[0-9]{1,20}", str(event["id"]))
            ):
                events[str(event["id"])] = day
    if len(events) != expected_games:
        raise SystemExit(
            f"{label}: expected {expected_games} final regular-season games, found {len(events)}"
        )
    print(f"{label}: {len(events)} games; fetching summaries...", flush=True)
    records = []
    done = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(
                download_json,
                f"{ESPN_SUMMARY}?event={game_id}",
                raw_root / "espn" / "summaries" / f"{game_id}.json",
            ): (game_id, day)
            for game_id, day in events.items()
        }
        for future in as_completed(futures):
            _, day = futures[future]
            records.extend(parse_espn_summary(future.result(), day))
            done += 1
            if done % 250 == 0:
                print(f"  {done}/{len(events)} summaries", flush=True)
    write_game_records(
        logs_path,
        sorted(records, key=lambda r: (r.game_date, r.game_id, r.player_id)),
    )
    print(f"{label}: wrote {len(records)} player-games", flush=True)


def fetch_dnt_season(year: int, key: str, pause_seconds: float = 0.25) -> None:
    start, end, _, _ = SEASONS[year]
    target = dnt_dir_for(year)
    target.mkdir(parents=True, exist_ok=True)
    fetched = skipped = 0
    current = start
    while current <= end:
        path = target / f"{current.isoformat()}.json"
        if path.exists():
            skipped += 1
        else:
            url = f"{DNT_PREDICTIONS}?date={current.isoformat()}"
            request = urllib.request.Request(url, headers={"Authorization": key})
            for attempt in range(3):
                try:
                    with urllib.request.urlopen(request, timeout=30) as response:
                        payload = json.loads(response.read().decode("utf-8"))
                    break
                except Exception:
                    if attempt == 2:
                        raise
                    time.sleep(2.0)
            if not isinstance(payload, list):
                raise SystemExit(f"bad D&T payload for {current}: {str(payload)[:100]}")
            path.write_text(json.dumps(payload), encoding="utf-8")
            fetched += 1
            time.sleep(pause_seconds)
        current += timedelta(days=1)
    print(
        f"{season_label(year)} D&T predictions: {fetched} fetched, {skipped} already cached "
        f"-> {target}", flush=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--seasons", type=int, nargs="+", default=sorted(SEASONS),
        help="Season end-years (default: 2024 2025 2026)",
    )
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--skip-espn", action="store_true")
    parser.add_argument("--skip-dnt", action="store_true")
    args = parser.parse_args()

    for year in args.seasons:
        if year not in SEASONS:
            raise SystemExit(f"unsupported season end-year {year} (known: {sorted(SEASONS)})")

    if not args.skip_espn:
        for year in args.seasons:
            if SEASONS[year][3]:
                fetch_espn_season(year, args.workers)
            else:
                print(
                    f"{season_label(year)}: ESPN logs come from scripts/fetch_backtest_data.py "
                    "(salaries + validated manifest); not fetched here", flush=True,
                )
    if not args.skip_dnt:
        key = load_dnt_key()
        for year in args.seasons:
            fetch_dnt_season(year, key)


if __name__ == "__main__":
    main()
