from __future__ import annotations

import os
from collections import defaultdict, deque
from datetime import date

from nba_stock_market.engine import ExpectedPerformance, Player


DUNKS_AND_THREES_ENDPOINT = "https://dunksandthrees.com/api/v1/game-predictions-box"
SALARY_PRIOR_BASE = 5.0
SALARY_PRIOR_PER_MILLION = 0.3
SALARY_PRIOR_CAP = 25.0


class NotConfigured(RuntimeError):
    """Raised when an optional expectation provider lacks configuration."""


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


class DunksAndThreesExpectation:
    """Stub boundary for a future Dunks & Threes projection integration.

    This card deliberately makes no live requests.  It records the production
    endpoint and API-key contract so a later implementation can add transport
    without changing the engine-facing interface.
    """

    endpoint = DUNKS_AND_THREES_ENDPOINT

    def __init__(self, api_key: str | None = None) -> None:
        self.api_key = api_key or os.getenv("DNT_API_KEY")

    def expected_performance(self, player: Player, game_date: date) -> ExpectedPerformance:
        del player, game_date
        if not self.api_key:
            raise NotConfigured("DNT_API_KEY is required for Dunks & Threes expectations")
        raise NotImplementedError(
            "Dunks & Threes transport is intentionally disabled in the historical backtest"
        )
