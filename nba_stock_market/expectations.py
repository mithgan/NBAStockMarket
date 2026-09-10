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


# Historical ESPN/DNT archives use these verified names for the same NBA IDs.
# Keep this feed-specific: global name normalization also serves salary inputs.
_DNT_HISTORICAL_IDENTITIES = (
    ("202710", ("Jimmy Butler III", "Jimmy Butler")),
    ("1630231", ("KJ Martin", "Kenyon Martin Jr.")),
    ("1641854", ("Craig Porter Jr.", "Craig Porter")),
    ("1641998", ("Trey Jemison III", "Trey Jemison")),
    ("1642267", ("Bub Carrington", "Carlton Carrington")),
    ("1642259", ("Alex Sarr", "Alexandre Sarr")),
    ("1630527", ("Brandon Boston Jr.", "Brandon Boston")),
    ("1641877", ("Nate Mensah", "Nathan Mensah")),
    ("1642385", ("Yongxi Cui", "Cui Yongxi")),
)
_DNT_IDENTITIES_BY_NAME = {
    normalize_player_name(name): (
        nba_id, tuple(normalize_player_name(variant) for variant in variants)
    )
    for nba_id, variants in _DNT_HISTORICAL_IDENTITIES
    for name in variants
}
_DNT_SCORING_FIELDS = (
    "p_pts", "p_orb", "p_drb", "p_ast", "p_stl", "p_blk", "p_tov",
    "p_fg2a", "p_fg3a", "p_fg2m", "p_fg3m", "p_fta", "p_ftm", "p_mp",
)


def salary_implied_net_points(salary: float) -> float:
    """Map contract salary to a transparent cold-start prior."""

    normalized = max(0.0, float(salary))
    return min(
        SALARY_PRIOR_CAP,
        SALARY_PRIOR_BASE + SALARY_PRIOR_PER_MILLION * normalized / 1_000_000,
    )


def player_salary_implied_net_points(player: Player) -> float:
    """Use contract salary for priors while preserving legacy price-only players."""

    salary = (
        player.actual_salary
        if player.actual_salary is not None
        else player.opening_price or player.current_price
    )
    return salary_implied_net_points(salary)


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
            return player_salary_implied_net_points(player)
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
        return player_salary_implied_net_points(player)

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
        self._by_date: dict[date, dict[str, list[dict[str, object]]]] = {}

    def _projections(self, game_date: date) -> dict[str, list[dict[str, object]]]:
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
        indexed: dict[str, list[dict[str, object]]] = {}
        for row in payload:
            if not isinstance(row, dict) or not isinstance(row.get("player_name"), str):
                raise ValueError(f"invalid Dunks & Threes projection row: {path}")
            indexed.setdefault(normalize_player_name(row["player_name"]), []).append(row)
        self._by_date[game_date] = indexed
        return indexed

    def _projection_row(self, player_name: str, game_date: date) -> dict[str, object] | None:
        indexed = self._projections(game_date)
        name = normalize_player_name(player_name)
        exact = indexed.get(name, [])
        if len(exact) > 1:
            raise ValueError(f"ambiguous Dunks & Threes projection for {player_name} on {game_date}")
        if exact:
            return exact[0]
        identity = _DNT_IDENTITIES_BY_NAME.get(name)
        if identity is None:
            return None
        nba_id, variants = identity
        candidates = []
        for variant in variants:
            rows = indexed.get(variant, [])
            if len(rows) > 1:
                raise ValueError(f"ambiguous Dunks & Threes alias for {player_name} on {game_date}")
            # Incoming player IDs are ESPN IDs; the saved feed carries NBA IDs.
            candidates.extend(row for row in rows if str(row.get("player_id")) == nba_id)
        if len(candidates) > 1:
            raise ValueError(f"ambiguous Dunks & Threes alias for {player_name} on {game_date}")
        return candidates[0] if candidates else None

    def projected_box_score(
        self, player: Player, game_date: date
    ) -> BoxScoreLine | None:
        row = self._projection_row(player.name, game_date)
        if row is None:
            return None
        try:
            if any(row[field] is None for field in _DNT_SCORING_FIELDS):
                return None
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
