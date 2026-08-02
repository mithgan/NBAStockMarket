"""Expectation-bias correction shared by historical settlement pipelines."""

from __future__ import annotations

import math
import statistics
from collections.abc import Iterable
from datetime import date, timedelta


ROLLING_WINDOW_DAYS = 30
ROLLING_MIN_GAMES = 300


def rolling_bias_for_date(
    raw_surprises: Iterable[tuple[date, float]],
    game_date: date,
    *,
    seed_bias: float,
    window_days: int = ROLLING_WINDOW_DAYS,
    minimum_games: int = ROLLING_MIN_GAMES,
) -> float:
    """Return a trailing bias using only games completed before ``game_date``."""

    if not isinstance(game_date, date):
        raise TypeError("game_date must be a date")
    if not math.isfinite(seed_bias):
        raise ValueError("seed_bias must be finite")
    if type(window_days) is not int or window_days <= 0:
        raise ValueError("window_days must be a positive integer")
    if type(minimum_games) is not int or minimum_games <= 0:
        raise ValueError("minimum_games must be a positive integer")

    window_start = game_date - timedelta(days=window_days)
    window = [
        float(surprise)
        for surprise_date, surprise in raw_surprises
        if window_start <= surprise_date < game_date and math.isfinite(surprise)
    ]
    if len(window) < minimum_games:
        return float(seed_bias)
    return statistics.fmean(window)
