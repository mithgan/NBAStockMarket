"""Temporal and accounting invariants for descriptive statistics studies."""
from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from scripts import per_game_blend_sweep as blend
from scripts import per_game_margin_study as margin
from scripts import per_game_opening_anchor_shootout as opening
from scripts import per_game_robustness_tests as robustness


DAY = date(2025, 10, 1)


def test_prior_only_roster_does_not_change_when_future_results_are_appended():
    start = DAY + timedelta(days=3)
    past = {str(i): [(DAY + timedelta(days=j), float(i + 1)) for j in range(3)] for i in range(20)}
    future = {p: s + [(start, 10000.0 if p == '0' else -10000.0)] for p, s in past.items()}
    future['future-only'] = [(start + timedelta(days=i), 1000000.0) for i in range(40)]
    assert margin.prior_only_locks(past, start, limit=20) == margin.prior_only_locks(future, start, limit=20)


def test_quote_residuals_do_not_settle_their_own_warmup():
    series = [(DAY + timedelta(days=i), v) for i, v in enumerate([100.0, 1.0, 1.0, 40.0])]
    residuals = margin.quote_residuals(series)
    assert all(values == [6.0] for values in residuals.values())


def test_same_day_actual_cannot_enter_another_same_day_quote():
    series = [(DAY, 1.0), (DAY + timedelta(days=1), 2.0), (DAY + timedelta(days=2), 3.0), (DAY + timedelta(days=3), 100.0), (DAY + timedelta(days=3), 4.0)]
    assert margin.quote_residuals(series)['full'] == [98.0, 2.0]


def test_uplift_uses_only_completed_prior_transitions():
    assert margin.prior_transition_uplifts([0.298, 0.257]) == [None, pytest.approx(0.298)]
    assert margin.prior_transition_uplifts([0.298, 0.257, 9000.0])[:2] == [None, pytest.approx(0.298)]


def test_points_identity_is_reported_without_identifying_scale():
    diagnostic = blend.association_diagnostics([2.0, 4.0, 6.0], [1.0, 2.0, 3.0])
    assert diagnostic['r'] == pytest.approx(1)
    assert diagnostic['slope'] == pytest.approx(0.5)
    assert diagnostic['rmse'] > 0


def test_initial_loss_is_part_of_drawdown():
    assert robustness.max_drawdown([-10.0, 2.0, -3.0]) == 11.0
    assert robustness.max_drawdown([]) == 0.0


def test_retention_horizon_uses_calendar_days_and_starts_at_entry():
    dates = [DAY, DAY + timedelta(days=10), DAY + timedelta(days=20)]
    result = robustness.path_risk(dates, [-10.0, 50.0, 1.0], DAY)
    assert result['day7'] == -10.0
    assert result['day28'] is None  # The observed calendar does not cover 28 days.
    assert result['max_drawdown'] == 10.0


def test_opening_projection_does_not_read_the_following_week():
    series = [(DAY, 4.0, None), (DAY + timedelta(days=1), 5.0, 100.0)]
    assert opening.first_game_projection(series) is None
    series[0] = (DAY, 4.0, 7.0)
    assert opening.first_game_projection(series) == 7.0


def test_anchor_formula_selection_does_not_use_evaluated_transition():
    histories = [{'a': [1.0, 1.0], 'b': [4.0]}, {'a': [1000.0], 'b': [0.0]}]
    assert opening.prior_pair_choices(histories) == [None, 'a']


def test_robustness_roster_does_not_use_future_actuals_or_projections(monkeypatch):
    dates = [DAY + timedelta(days=i) for i in range(40)]
    def season(future):
        series = {str(p): [(d, float(p + 1) if i < 10 else future * (p + 1), float(p + 1) if i < 10 else -future * (p + 1)) for i, d in enumerate(dates)] for p in range(20)}
        by_date = {d: [(p, a, pred) for p, s in series.items() for sd, a, pred in s if sd == d] for d in dates}
        return SimpleNamespace(label='fixture', dates=dates, series=series, all_dated_series=series, by_date=by_date, full_by_date=by_date, season_mean={p: sum(a for _, a, _ in s)/len(s) for p, s in series.items()}, trailing_at=lambda p, day: float(int(p)+1))
    captured=[]
    def record(s, roster, start):
        captured.append((tuple(sorted(roster.items())), start)); return [0.0]*10+[1.0]*30
    monkeypatch.setattr(robustness, '_replay_fixed', record)
    robustness.r3_user_bands([season(1.0)])
    before=captured[:];captured.clear()
    robustness.r3_user_bands([season(1000.0)])
    assert captured == before


def test_cadence_does_not_backfill_future_projection():
    dates=[DAY + timedelta(days=i) for i in range(5)]
    s=SimpleNamespace(label='fixture',series={'p':[(d,1000.0 if i<4 else 10.0,None if i<4 else 20.0) for i,d in enumerate(dates)]})
    report='\n'.join(robustness.r5_cadence([s]))
    # Only the last game has an opening projection; earlier actuals cannot be priced with it.
    assert '| fixture | 1 |' in report
    assert '-10.000 ($-200,000)' in report  # Frozen cost20 is charged only to the final actual10.


def test_half_step_updates_on_league_game_dates_without_this_player():
    dates = [DAY + timedelta(days=i) for i in range(6)]
    series = [(dates[0], 0.0, 100.0), (dates[1], 0.0, None),
              (dates[2], 0.0, None), (dates[5], 100.0, None)]
    season = SimpleNamespace(label='fixture', dates=dates, series={'p': series})
    report = '\n'.join(robustness.r5_cadence([season]))
    # Quote halves on dates 3, 4 and 5: 100 -> 50 -> 25 -> 12.5.
    assert '-53.125 ($-1,062,500)' in report


@pytest.mark.parametrize("start", [date(2025, 10, 6), date(2025, 10, 4)],
                         ids=["entry_week", "new_week_without_warmup"])
def test_weekly_quote_does_not_update_when_warmup_finishes_midweek(start):
    dates = [start + timedelta(days=i) for i in range(4)]
    season = SimpleNamespace(
        label='fixture', dates=dates,
        series={'p': [(day, 0.0 if i < 3 else 100.0, 100.0 if i == 0 else None)
                      for i, day in enumerate(dates)]},
    )
    report = '\n'.join(robustness.r5_cadence([season]))
    # Monday entry: history becomes ready Thursday. Saturday entry: Monday
    # still has only two prior games, so Tuesday cannot become a weekly update.
    assert '| fixture | 4 | -75.000 ($-1,500,000) | -75.000 ($-1,500,000) |' in report


def test_first_projection_midweek_keeps_weekly_entry_quote_until_next_week():
    monday = date(2025, 10, 6)
    dates = [monday + timedelta(days=i) for i in range(5)]
    season = SimpleNamespace(
        label='fixture', dates=dates,
        series={'p': [(day, 0.0, 100.0 if i == 3 else None)
                      for i, day in enumerate(dates)]},
    )
    report = '\n'.join(robustness.r5_cadence([season]))
    # Three prior actuals exist at Thursday entry, but Monday's scheduled
    # update is already past. Thursday is not a weekly repricing date.
    assert '| fixture | 2 | -100.000 ($-2,000,000) | -100.000 ($-2,000,000) |' in report


def test_zero_net_game_nights_are_retained_in_residual_distribution():
    dates = [DAY, DAY + timedelta(days=1)]
    bands = margin.fixed_roster_bands({'p': [(dates[0], 10.0), (dates[1], 20.0)]},
                                      dates, DAY, {'p': 10.0}, {'roster': ['p']})
    assert bands['roster'][0] == 5.0  # SD of [0, 10], not only the nonzero night.


def test_plusminus_missing_cache_rows_fail_before_writing_full_report(monkeypatch):
    from scripts import per_game_plusminus_study as plusminus
    monkeypatch.setattr(plusminus, 'SEASONS', ('fixture',))
    monkeypatch.setattr(plusminus, 'extract_plusminus', lambda season: {})
    monkeypatch.setattr(plusminus, 'load_csv', lambda season: [{'date': DAY, 'game_id': '1', 'pid': 'p'}])
    with pytest.raises(ValueError, match='incomplete plus-minus coverage'):
        plusminus.main()
