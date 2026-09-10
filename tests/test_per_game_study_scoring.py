"""The studies' engine comparisons must score the same box score as the game."""
import csv
from pathlib import Path

import pytest

from nba_stock_market.engine import BoxScoreLine, NetPointsModel
from scripts import per_game_blend_sweep as blend
from scripts import per_game_margin_study as margin
from scripts import per_game_plusminus_study as plusminus


@pytest.mark.parametrize('study', ['blend', 'plusminus', 'margin'])
@pytest.mark.parametrize('stats', [
    {},
    {'pts': 10, 'fgm': 5, 'fga': 6, 'three_pa': 1, 'minutes': 10},
    {
        'pts': 28, 'offensive_rebounds': 2, 'defensive_rebounds': 6,
        'ast': 7, 'stl': 2, 'blk': 1, 'tov': 3, 'fga': 18, 'fgm': 10,
        'three_pa': 6, 'three_pm': 3, 'fta': 5, 'ftm': 5, 'minutes': 35,
    },
], ids=['zero', 'minutes-and-three-attempt', 'full-box-score'])
def test_study_loaded_box_score_matches_game_engine(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, study: str, stats: dict,
) -> None:
    values = {field: 0.0 for field in BoxScoreLine.__dataclass_fields__}
    values.update(stats)
    raw = dict(game_id='game-1', game_date='2026-01-01', player_id='player-1',
               player_name='Test Player', team='BOS', **values)
    path = tmp_path / 'data/raw/2025-26/player_game_logs.csv'
    path.parent.mkdir(parents=True)
    with path.open('w', newline='', encoding='utf-8') as handle:
        writer = csv.DictWriter(handle, fieldnames=list(raw))
        writer.writeheader()
        writer.writerow(raw)
    monkeypatch.chdir(tmp_path)

    if study == 'blend':
        actual = blend.blend_score(blend.load('2025-26')[0], 1.0)
    elif study == 'plusminus':
        actual = plusminus.score(plusminus.load_csv('2025-26')[0], plusminus.OLD_WEIGHTS)
    else:
        actual = margin.old_np(margin.load_rows(path)[0])

    assert actual == pytest.approx(NetPointsModel().score(BoxScoreLine(**values)), abs=1e-12)
