#!/usr/bin/env python3
"""Cache the public inputs for the deterministic 2025-26 backtest."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from nba_stock_market.historical_data import parse_espn_summary, write_game_records


RAW_ROOT = ROOT / "data" / "raw" / "2025-26"
SITE_DATA_DIR = ROOT / "data" / "raw" / "site_Data"
GAMES_CSV = RAW_ROOT / "player_game_logs.csv"
SALARIES_CSV = RAW_ROOT / "salaries.csv"
SALARIES_FALLBACK_CSV = RAW_ROOT / "salaries-fallback.csv"
MANIFEST_JSON = RAW_ROOT / "manifest.json"
SCOREBOARD_DIR = RAW_ROOT / "espn" / "scoreboards"
SUMMARY_DIR = RAW_ROOT / "espn" / "summaries"

SITE_DATA_URL = "https://github.com/gabriel1200/site_Data"
SITE_DATA_COMMIT = "bc583cb0188a6d5ae59d052d08ac0d6efe1b14fd"
FALLBACK_SALARY_URL = (
    "https://raw.githubusercontent.com/Baileyd18/"
    "NBA-Player-Impact-and-Value-Dashboard-2025-26/"
    "3b10978c55d993116964ac3ee0afce69a8f4c4e5/Data/raw_salary.csv"
)
ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard"
ESPN_SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary"
SEASON_START = date(2025, 10, 21)
SEASON_END = date(2026, 4, 12)
EXPECTED_REGULAR_SEASON_GAMES = 1230


def _validated_game_id(value: object) -> str:
    game_id = str(value)
    if re.fullmatch(r"[0-9]{1,20}", game_id) is None:
        raise ValueError(f"invalid ESPN game id: {game_id!r}")
    return game_id


def _download_json(url: str, path: Path, *, retries: int = 5) -> dict[str, object]:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    path.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(retries):
        try:
            payload = subprocess.run(
                [
                    "curl",
                    "--location",
                    "--fail",
                    "--silent",
                    "--show-error",
                    "--max-time",
                    "30",
                    "--user-agent",
                    "nba-stock-market-backtest/1.0",
                    url,
                ],
                check=True,
                stdout=subprocess.PIPE,
            ).stdout
            parsed = json.loads(payload)
            temporary = path.with_suffix(path.suffix + ".tmp")
            temporary.write_bytes(payload)
            temporary.replace(path)
            return parsed
        except (OSError, subprocess.CalledProcessError, json.JSONDecodeError):
            if attempt + 1 == retries:
                raise
            time.sleep(0.5 * 2**attempt)
    raise AssertionError("unreachable")


def _dates() -> list[date]:
    days = (SEASON_END - SEASON_START).days
    return [SEASON_START + timedelta(days=offset) for offset in range(days + 1)]


def _fetch_scoreboard(day: date) -> dict[str, object]:
    compact = day.strftime("%Y%m%d")
    return _download_json(
        f"{ESPN_SCOREBOARD}?dates={compact}&limit=100",
        SCOREBOARD_DIR / f"{compact}.json",
    )


def _regular_season_events(scoreboards: list[dict[str, object]]) -> dict[str, date]:
    events: dict[str, date] = {}
    for day, payload in zip(_dates(), scoreboards, strict=True):
        for event in payload.get("events", []):  # type: ignore[union-attr]
            season = event.get("season", {})
            competition = event.get("competitions", [{}])[0]
            competition_type = competition.get("type", {}).get("abbreviation")
            status = event.get("status", {}).get("type", {})
            if (
                season.get("year") == 2026
                and season.get("type") == 2
                and competition_type == "STD"
                and status.get("completed") is True
            ):
                events[_validated_game_id(event["id"])] = day
    if len(events) != EXPECTED_REGULAR_SEASON_GAMES:
        raise RuntimeError(
            f"expected {EXPECTED_REGULAR_SEASON_GAMES} final regular-season games, found {len(events)}"
        )
    return events


def _fetch_summary(game_id: str) -> dict[str, object]:
    game_id = _validated_game_id(game_id)
    return _download_json(
        f"{ESPN_SUMMARY}?event={game_id}",
        SUMMARY_DIR / f"{game_id}.json",
    )


def _cache_salaries() -> None:
    if not (SITE_DATA_DIR / ".git").exists():
        SITE_DATA_DIR.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["git", "clone", "--filter=blob:none", "--no-checkout", SITE_DATA_URL, str(SITE_DATA_DIR)],
            check=True,
        )
    subprocess.run(
        ["git", "-C", str(SITE_DATA_DIR), "fetch", "--depth", "1", "origin", SITE_DATA_COMMIT],
        check=True,
        stdout=subprocess.DEVNULL,
    )
    salary_bytes = subprocess.run(
        ["git", "-C", str(SITE_DATA_DIR), "show", f"{SITE_DATA_COMMIT}:salary.csv"],
        check=True,
        stdout=subprocess.PIPE,
    ).stdout
    SALARIES_CSV.parent.mkdir(parents=True, exist_ok=True)
    SALARIES_CSV.write_bytes(salary_bytes)
    fallback_bytes = subprocess.run(
        [
            "curl", "--location", "--fail", "--silent", "--show-error",
            "--max-time", "30", FALLBACK_SALARY_URL,
        ],
        check=True,
        stdout=subprocess.PIPE,
    ).stdout
    SALARIES_FALLBACK_CSV.write_bytes(fallback_bytes)


def fetch(*, workers: int = 8, force: bool = False) -> None:
    if force:
        for path in (GAMES_CSV, SALARIES_CSV, SALARIES_FALLBACK_CSV, MANIFEST_JSON):
            path.unlink(missing_ok=True)
        shutil.rmtree(RAW_ROOT / "espn", ignore_errors=True)
    if all(
        path.exists()
        for path in (GAMES_CSV, SALARIES_CSV, SALARIES_FALLBACK_CSV, MANIFEST_JSON)
    ):
        print(f"Using cached backtest data in {RAW_ROOT.relative_to(ROOT)}")
        return

    print(f"Caching {len(_dates())} ESPN scoreboards...")
    with ThreadPoolExecutor(max_workers=workers) as pool:
        scoreboards_by_day = {
            day: payload
            for day, payload in zip(
                _dates(), pool.map(_fetch_scoreboard, _dates()), strict=True
            )
        }
    scoreboards = [scoreboards_by_day[day] for day in _dates()]
    events = _regular_season_events(scoreboards)

    print(f"Caching {len(events)} ESPN game summaries...")
    summaries: dict[str, dict[str, object]] = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_fetch_summary, game_id): game_id for game_id in sorted(events)}
        for index, future in enumerate(as_completed(futures), start=1):
            game_id = futures[future]
            summaries[game_id] = future.result()
            if index % 100 == 0:
                print(f"  {index}/{len(events)} summaries cached")

    games = []
    for game_id in sorted(events, key=lambda value: (events[value], value)):
        games.extend(parse_espn_summary(summaries[game_id], events[game_id]))
    write_game_records(GAMES_CSV, games)
    _cache_salaries()
    manifest = {
        "season": "2025-26",
        "competition": "NBA regular season (NBA Cup championship excluded)",
        "season_start": SEASON_START.isoformat(),
        "season_end": SEASON_END.isoformat(),
        "game_count": len(events),
        "player_game_count": len(games),
        "espn_scoreboard_endpoint": ESPN_SCOREBOARD,
        "espn_summary_endpoint": ESPN_SUMMARY,
        "salary_repository": SITE_DATA_URL,
        "salary_commit": SITE_DATA_COMMIT,
        "salary_file": "salary.csv",
        "fallback_salary_url": FALLBACK_SALARY_URL,
        "fallback_salary_file": "raw_salary.csv",
    }
    MANIFEST_JSON.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote {len(games)} player-games to {GAMES_CSV.relative_to(ROOT)}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    if args.workers <= 0:
        parser.error("--workers must be positive")
    fetch(workers=args.workers, force=args.force)


if __name__ == "__main__":
    main()
