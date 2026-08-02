from __future__ import annotations

from datetime import date, timedelta

import pytest

from nba_stock_market.bias import rolling_bias_for_date


def test_rolling_bias_uses_seed_until_minimum_history_exists() -> None:
    game_date = date(2026, 1, 31)
    history = [(game_date - timedelta(days=1), 4.0)] * 2

    assert rolling_bias_for_date(
        history,
        game_date,
        seed_bias=1.25,
        minimum_games=3,
    ) == pytest.approx(1.25)


def test_rolling_bias_uses_only_prior_games_inside_the_window() -> None:
    game_date = date(2026, 2, 1)
    history = [
        (game_date - timedelta(days=31), 100.0),
        (game_date - timedelta(days=30), 1.0),
        (game_date - timedelta(days=1), 3.0),
        (game_date, 200.0),
    ]

    assert rolling_bias_for_date(
        history,
        game_date,
        seed_bias=9.0,
        minimum_games=2,
    ) == pytest.approx(2.0)


@pytest.mark.parametrize(
    ("window_days", "minimum_games"),
    [(0, 1), (30, 0), (1.5, 1), (30, True)],
)
def test_rolling_bias_rejects_invalid_window_configuration(
    window_days: object,
    minimum_games: object,
) -> None:
    with pytest.raises(ValueError):
        rolling_bias_for_date(
            [],
            date(2026, 1, 1),
            seed_bias=0.0,
            window_days=window_days,  # type: ignore[arg-type]
            minimum_games=minimum_games,  # type: ignore[arg-type]
        )
