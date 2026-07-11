from __future__ import annotations

import json
import unicodedata
from collections import defaultdict, deque
from datetime import date
from pathlib import Path

from nba_stock_market.engine import BoxScoreLine, ExpectedPerformance, Player


DUNKS_AND_THREES_ENDPOINT = "https://dunksandthrees.com/api/v1/game-predictions-box"
SALARY_PRIOR_BASE = 5.0
SALARY_PRIOR_PER_MILLION = 0.3
SALARY_PRIOR_CAP = 25.0


def normalize_player_name(name: str) -> str:
    """Normalize provider-specific accents and punctuation for name joins."""

    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return "".join(character for character in ascii_name.lower() if character.isalnum())


def salary_implied_net_points(salary: float) -> float:
    """Map salary-scale listing prices to a transparent cold-start prior."""

    normalized = max(0.0, float(salary))
    return min(
        SALARY_PRIOR_CAP,
        SALARY_PRIOR_BASE + SALARY_PRIOR_PER_MILLION * normalized / 1_000_000,
    )


class TrailingMeanExpectation:
    """Expect a player's trailing mean, with salary as the preseason prior."""

    def __init__(self, *, window: int = 10) -> None:
        if type(window) is not int or window <= 0:
            raise ValueError("window must be a positive integer")
        self.window = window
        self._history: defaultdict[str, deque[float]] = defaultdict(
            lambda: deque(maxlen=self.window)
        )

    def expected_performance(self, player: Player, game_date: date) -> float:
        del game_date
        prior_games = self._history[player.id]
        if not prior_games:
            return salary_implied_net_points(player.opening_price or player.current_price)
        return sum(prior_games) / len(prior_games)

    def observe(self, player_id: str, actual_net_points: float) -> None:
        self._history[player_id].append(float(actual_net_points))

    def history(self, player_id: str) -> tuple[float, ...]:
        return tuple(self._history[player_id])


class SalaryProjectionExpectation:
    """Placeholder season projection based on salary for every game.

    The production source will be DARKO or Dunks & Threes. This temporary
    linear salary curve caps at 25 net points, so most good players will beat
    it and the resulting economy will be inflationary.
    """

    def expected_performance(self, player: Player, game_date: date) -> float:
        del game_date
        return salary_implied_net_points(player.opening_price or player.current_price)

    def observe(self, player_id: str, actual_net_points: float) -> None:
        """Ignore actuals because the season projection is intentionally constant."""

        del player_id, actual_net_points


class ProductionExpectation:
    """Reward raw game-log value by subtracting no expected performance."""

    def expected_performance(self, player: Player, game_date: date) -> float:
        del player, game_date
        return 0.0

    def observe(self, player_id: str, actual_net_points: float) -> None:
        del player_id, actual_net_points


class DunksAndThreesExpectation:
    """Read cached Dunks & Threes pre-game box-score projections by date/name."""

    endpoint = DUNKS_AND_THREES_ENDPOINT

    def __init__(self, *, cache_dir: Path = Path("data/raw/dnt")) -> None:
        self.cache_dir = Path(cache_dir)
        self._by_date: dict[date, dict[str, dict[str, object]]] = {}

    def _projections(self, game_date: date) -> dict[str, dict[str, object]]:
        if game_date in self._by_date:
            return self._by_date[game_date]
        path = self.cache_dir / f"{game_date.isoformat()}.json"
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except OSError as exc:
            raise ValueError(f"missing Dunks & Threes cache for {game_date}: {path}") from exc
        except json.JSONDecodeError as exc:
            raise ValueError(f"invalid Dunks & Threes cache for {game_date}: {path}") from exc
        if not isinstance(payload, list):
            raise ValueError(f"Dunks & Threes cache must contain a JSON list: {path}")
        indexed: dict[str, dict[str, object]] = {}
        for row in payload:
            if not isinstance(row, dict) or not isinstance(row.get("player_name"), str):
                raise ValueError(f"invalid Dunks & Threes projection row: {path}")
            indexed[normalize_player_name(row["player_name"])] = row
        self._by_date[game_date] = indexed
        return indexed

    def projected_box_score(
        self, player: Player, game_date: date
    ) -> BoxScoreLine | None:
        row = self._projections(game_date).get(normalize_player_name(player.name))
        if row is None:
            return None
        try:
            return BoxScoreLine(
                pts=row["p_pts"],
                offensive_rebounds=row["p_orb"],
                defensive_rebounds=row["p_drb"],
                ast=row["p_ast"],
                stl=row["p_stl"],
                blk=row["p_blk"],
                tov=row["p_tov"],
                fga=float(row["p_fg2a"]) + float(row["p_fg3a"]),
                fgm=float(row["p_fg2m"]) + float(row["p_fg3m"]),
                three_pa=row["p_fg3a"],
                three_pm=row["p_fg3m"],
                fta=row["p_fta"],
                ftm=row["p_ftm"],
                minutes=row["p_mp"],
            )
        except KeyError as exc:
            raise ValueError(
                f"Dunks & Threes projection for {player.name} on {game_date} "
                f"is missing {exc.args[0]}"
            ) from exc

    def expected_performance(
        self, player: Player, game_date: date
    ) -> ExpectedPerformance | None:
        return self.projected_box_score(player, game_date)

    def observe(self, player_id: str, actual_net_points: float) -> None:
        del player_id, actual_net_points
