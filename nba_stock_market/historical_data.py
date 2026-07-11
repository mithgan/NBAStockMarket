from __future__ import annotations

import csv
from datetime import date
from pathlib import Path
from typing import Any, Iterable

from nba_stock_market.backtest import GameRecord
from nba_stock_market.engine import BoxScoreLine


GAME_RECORD_FIELDS = (
    "game_id",
    "game_date",
    "player_id",
    "player_name",
    "team",
    *BoxScoreLine.__dataclass_fields__,
)


def _number(value: str) -> float:
    text = value.strip()
    if ":" in text:
        minutes, seconds = text.split(":", 1)
        return float(minutes) + float(seconds) / 60.0
    return float(text)


def _made_attempted(value: str) -> tuple[float, float]:
    made, attempted = value.split("-", 1)
    return _number(made), _number(attempted)


def parse_espn_summary(payload: dict[str, Any], game_date: date) -> list[GameRecord]:
    """Flatten one cached ESPN game summary into played player-game rows."""

    header = payload.get("header", {})
    game_id = str(header.get("id") or header.get("competitions", [{}])[0].get("id") or "")
    if not game_id:
        raise ValueError("ESPN summary is missing a game id")

    records: list[GameRecord] = []
    for team_block in payload.get("boxscore", {}).get("players", []):
        team = str(team_block.get("team", {}).get("abbreviation", ""))
        for statistics in team_block.get("statistics", []):
            labels = statistics.get("labels", [])
            for athlete_row in statistics.get("athletes", []):
                stats = athlete_row.get("stats", [])
                if athlete_row.get("didNotPlay") or not stats or len(stats) != len(labels):
                    continue
                values = dict(zip(labels, stats, strict=True))
                if (
                    "MIN" not in values
                    or values["MIN"].strip() in {"", "--"}
                    or _number(values["MIN"]) <= 0
                ):
                    continue
                fgm, fga = _made_attempted(values["FG"])
                three_pm, three_pa = _made_attempted(values["3PT"])
                ftm, fta = _made_attempted(values["FT"])
                athlete = athlete_row.get("athlete", {})
                records.append(
                    GameRecord(
                        game_id=game_id,
                        game_date=game_date,
                        player_id=str(athlete["id"]),
                        player_name=str(athlete["displayName"]),
                        team=team,
                        box_score=BoxScoreLine(
                            pts=_number(values["PTS"]),
                            offensive_rebounds=_number(values["OREB"]),
                            defensive_rebounds=_number(values["DREB"]),
                            ast=_number(values["AST"]),
                            stl=_number(values["STL"]),
                            blk=_number(values["BLK"]),
                            tov=_number(values["TO"]),
                            fga=fga,
                            fgm=fgm,
                            three_pa=three_pa,
                            three_pm=three_pm,
                            fta=fta,
                            ftm=ftm,
                            minutes=_number(values["MIN"]),
                        ),
                    )
                )
    return records


def write_game_records(path: Path, games: Iterable[GameRecord]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=GAME_RECORD_FIELDS)
        writer.writeheader()
        for game in games:
            writer.writerow(
                {
                    "game_id": game.game_id,
                    "game_date": game.game_date.isoformat(),
                    "player_id": game.player_id,
                    "player_name": game.player_name,
                    "team": game.team,
                    **{
                        field: getattr(game.box_score, field)
                        for field in BoxScoreLine.__dataclass_fields__
                    },
                }
            )


def load_game_records(path: Path) -> list[GameRecord]:
    with path.open(encoding="utf-8", newline="") as handle:
        return [
            GameRecord(
                game_id=row["game_id"],
                game_date=date.fromisoformat(row["game_date"]),
                player_id=row["player_id"],
                player_name=row["player_name"],
                team=row["team"],
                box_score=BoxScoreLine(
                    **{
                        field: float(row[field])
                        for field in BoxScoreLine.__dataclass_fields__
                    }
                ),
            )
            for row in csv.DictReader(handle)
        ]
