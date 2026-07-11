from __future__ import annotations

import argparse
import json
import os
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Callable, Mapping

from nba_stock_market.engine import BoxScoreLine, NetPointsModel


BDL_STATS_URL = "https://api.balldontlie.io/v1/stats"
DEFAULT_CACHE_DIR = Path("data/raw/bdl/2025-26")
REGULAR_SEASON_START = "2025-10-21"
REGULAR_SEASON_END = "2026-04-12"
JOKIC_PLAYER_ID = "246"
JOKIC_CHRISTMAS_DATE = "2025-12-25"
JOKIC_ESPN_NET_POINTS = 59.35

RequestJSON = Callable[[str, str], dict[str, Any]]


@dataclass(frozen=True)
class BDLGameLine:
    player_id: str
    player_name: str
    game_id: str
    game_date: date
    team: str
    box_score: BoxScoreLine


@dataclass(frozen=True)
class FetchResult:
    pages_fetched: int
    rows_fetched: int
    complete: bool
    cache_dir: Path


def parse_minutes(value: str | int | float) -> float:
    text = str(value).strip()
    if ":" not in text:
        return float(text)
    minutes, seconds = text.split(":", 1)
    return float(minutes) + float(seconds) / 60.0


def row_to_game_line(row: Mapping[str, Any]) -> BDLGameLine:
    player = row["player"]
    game = row["game"]
    team = row.get("team") or {}
    return BDLGameLine(
        player_id=str(player["id"]),
        player_name=f"{player['first_name']} {player['last_name']}".strip(),
        game_id=str(game["id"]),
        game_date=date.fromisoformat(str(game["date"])[:10]),
        team=str(team.get("abbreviation", "")),
        box_score=BoxScoreLine(
            pts=row["pts"],
            offensive_rebounds=row["oreb"],
            defensive_rebounds=row["dreb"],
            ast=row["ast"],
            stl=row["stl"],
            blk=row["blk"],
            tov=row["turnover"],
            fga=row["fga"],
            fgm=row["fgm"],
            three_pa=row["fg3a"],
            three_pm=row["fg3m"],
            fta=row["fta"],
            ftm=row["ftm"],
            minutes=parse_minutes(row["min"]),
        ),
    )


def load_cached_lines(cache_dir: Path = DEFAULT_CACHE_DIR) -> list[BDLGameLine]:
    lines: list[BDLGameLine] = []
    for path in sorted(cache_dir.glob("page-*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        rows = payload.get("data")
        if not isinstance(rows, list):
            raise ValueError(f"BDL cache page has no data list: {path}")
        lines.extend(row_to_game_line(row) for row in rows)
    return lines


def _ssl_context() -> ssl.SSLContext:
    try:
        import certifi
    except ImportError:
        return ssl.create_default_context()
    return ssl.create_default_context(cafile=certifi.where())


def _request_json(url: str, api_key: str) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={"Authorization": api_key, "User-Agent": "nba-stock-market/0.1"},
    )
    retry = 0
    while True:
        try:
            with urllib.request.urlopen(
                request, timeout=30, context=_ssl_context()
            ) as response:
                payload = json.load(response)
            if not isinstance(payload, dict):
                raise ValueError("BDL response must be a JSON object")
            return payload
        except urllib.error.HTTPError as exc:
            if exc.code != 429:
                raise
            retry_after = exc.headers.get("Retry-After")
            delay = float(retry_after) if retry_after else min(2**retry, 60)
            time.sleep(max(delay, 1.0))
            retry += 1


def _atomic_json(path: Path, value: Mapping[str, Any]) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def fetch_stats_pages(
    cache_dir: Path,
    api_key: str,
    params: Mapping[str, str],
    *,
    per_page: int = 100,
    max_pages: int | None = None,
    request_json: RequestJSON = _request_json,
) -> FetchResult:
    if not api_key:
        raise ValueError("BALL_DONT_LIE_API_KEY is required")
    if per_page <= 0:
        raise ValueError("per_page must be positive")
    if max_pages is not None and max_pages <= 0:
        raise ValueError("max_pages must be positive")

    cache_dir.mkdir(parents=True, exist_ok=True)
    state_path = cache_dir / "state.json"
    requested = {**params, "per_page": str(per_page)}
    state: dict[str, Any]
    if state_path.exists():
        state = json.loads(state_path.read_text(encoding="utf-8"))
        if state.get("params") != requested:
            raise ValueError(f"BDL cache parameters disagree with {state_path}")
    else:
        state = {
            "params": requested,
            "next_cursor": None,
            "page_count": 0,
            "complete": False,
        }

    if state["complete"]:
        return FetchResult(0, 0, True, cache_dir)

    pages_fetched = 0
    rows_fetched = 0
    while max_pages is None or pages_fetched < max_pages:
        query = dict(requested)
        if state["next_cursor"] is not None:
            query["cursor"] = str(state["next_cursor"])
        url = f"{BDL_STATS_URL}?{urllib.parse.urlencode(query)}"
        payload = request_json(url, api_key)
        rows = payload.get("data")
        meta = payload.get("meta") or {}
        if not isinstance(rows, list) or not isinstance(meta, dict):
            raise ValueError("BDL response must contain data list and meta object")

        page_number = int(state["page_count"]) + 1
        _atomic_json(cache_dir / f"page-{page_number:06d}.json", payload)
        state["page_count"] = page_number
        state["next_cursor"] = meta.get("next_cursor")
        state["complete"] = state["next_cursor"] is None
        _atomic_json(state_path, state)
        pages_fetched += 1
        rows_fetched += len(rows)
        if state["complete"]:
            break

    return FetchResult(
        pages_fetched, rows_fetched, bool(state["complete"]), cache_dir
    )


def load_api_key(env_path: Path = Path(".env")) -> str:
    key = os.environ.get("BALL_DONT_LIE_API_KEY", "").strip()
    if key:
        return key
    if env_path.exists():
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if line.startswith("BALL_DONT_LIE_API_KEY="):
                return line.split("=", 1)[1].strip().strip("\"'")
    raise RuntimeError("set BALL_DONT_LIE_API_KEY in the environment or .env")


def _regular_season_params() -> dict[str, str]:
    return {
        "seasons[]": "2025",
        "start_date": REGULAR_SEASON_START,
        "end_date": REGULAR_SEASON_END,
        "postseason": "false",
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Cache Ball Don't Lie box scores")
    parser.add_argument("--cache-dir", type=Path, default=None)
    parser.add_argument("--per-page", type=int, default=100)
    parser.add_argument("--max-pages", type=int)
    parser.add_argument(
        "--smoke-jokic",
        action="store_true",
        help="run the bounded 2025-12-25 Jokic source comparison",
    )
    args = parser.parse_args(argv)

    params = _regular_season_params()
    cache_dir = args.cache_dir or DEFAULT_CACHE_DIR
    per_page = args.per_page
    max_pages = args.max_pages
    if args.smoke_jokic:
        params = {
            "seasons[]": "2025",
            "dates[]": JOKIC_CHRISTMAS_DATE,
            "player_ids[]": JOKIC_PLAYER_ID,
        }
        cache_dir = args.cache_dir or Path(
            f"data/raw/bdl/smoke-{JOKIC_CHRISTMAS_DATE}"
        )
        per_page = 25
        max_pages = 1

    result = fetch_stats_pages(
        cache_dir,
        load_api_key(),
        params,
        per_page=per_page,
        max_pages=max_pages,
    )
    print(
        f"BDL cache: fetched {result.pages_fetched} page(s), "
        f"{result.rows_fetched} row(s); complete={result.complete}"
    )

    if args.smoke_jokic:
        matches = [
            line
            for line in load_cached_lines(cache_dir)
            if line.player_id == JOKIC_PLAYER_ID
            and line.game_date.isoformat() == JOKIC_CHRISTMAS_DATE
        ]
        if len(matches) != 1:
            raise AssertionError(f"expected one Jokic line, found {len(matches)}")
        bdl_score = NetPointsModel().score(matches[0].box_score)
        if abs(bdl_score - JOKIC_ESPN_NET_POINTS) > 0.01:
            raise AssertionError(
                f"BDL score {bdl_score:.2f} != ESPN score {JOKIC_ESPN_NET_POINTS:.2f}"
            )
        print(
            f"Nikola Jokic {JOKIC_CHRISTMAS_DATE}: "
            f"BDL={bdl_score:.2f} NP ESPN={JOKIC_ESPN_NET_POINTS:.2f} NP "
            f"delta={bdl_score - JOKIC_ESPN_NET_POINTS:.2f}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
