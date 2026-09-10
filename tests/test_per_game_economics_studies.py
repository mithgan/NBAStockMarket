"""Chronology and cash-flow regressions for the standalone economics studies."""
from dataclasses import replace
from datetime import date, timedelta
import math

import pytest

from nba_stock_market.backtest import GameRecord
from nba_stock_market.engine import BoxScoreLine
from nba_stock_market.per_game_simulation import HistoricalPlayerGame
from scripts import per_game_rate_study as rate
from scripts import per_game_balance_study as balance
from scripts import per_game_lock_drift_test as drift
from scripts import per_game_repricing_test as repricing
from scripts import per_game_user_pnl_corrected as prior_pnl


def games_fixture(days=35, players=12):
    start = date(2025, 10, 20)
    return [HistoricalPlayerGame(f"g{index:03d}", start + timedelta(days=index),
                                f"p{pid:03d}", f"Player{pid}", float(pid + 2), float(pid + 2))
            for index in range(days) for pid in range(players)]


def prior_record(pid="p000", points=8, day=date(2025, 3, 1)):
    values = {name: 0.0 for name in BoxScoreLine.__dataclass_fields__}
    values["pts"] = points
    return GameRecord("prior1", day, pid, pid, "TEAM", BoxScoreLine(**values))


def test_universe_and_fixed_rosters_ignore_future_participation_and_projections():
    games = games_fixture()
    cutoff = rate.opening_date(games)
    before = repricing.RepricingStudy(games=games)
    changed = [replace(g, actual_net_points=9999, saved_projection_net_points=99999 if g.player_id == "p000" else -999)
               if g.game_date >= cutoff else g for g in games]
    changed += [replace(games[-1], player_id="future_star", saved_projection_net_points=1e9)] * 1000
    after = repricing.RepricingStudy(games=changed)
    assert before.universe == after.universe
    assert "future_star" not in after.universe
    assert before.picker("star hold")(cutoff, set()) == after.picker("star hold")(cutoff, set())
    assert before.anchor_on("p000", cutoff) == after.anchor_on("p000", cutoff)
    assert min(before.dates) == cutoff
    assert all(g.game_date < cutoff for g in games[:14 * 12])


def test_missing_or_tiny_projection_cohort_cannot_generate_a_study():
    with pytest.raises(ValueError, match="calibration"):
        rate.Study(games=[])
    with pytest.raises(ValueError, match="fewer than 10"):
        rate.Study(games=[replace(g, saved_projection_net_points=None) for g in games_fixture()])
    with pytest.raises(ValueError, match="fewer than 10"):
        rate.Study(games=games_fixture(players=3))


@pytest.mark.parametrize("players", [10, 15])
def test_small_valid_cohorts_get_full_rosters_in_actual_rate_report(players):
    study = rate.Study(games=games_fixture(players=players))
    lines, results = rate.test_c(study)
    text = "\n".join(lines)
    for kind in ("star holder", "balanced holder", "bench holder"):
        assert f"| {kind} | 10 |" in text
        assert len(results[kind]) == len(study.dates)
        assert all(math.isfinite(value) for value in results[kind])
    assert "nan" not in text.lower()
    assert "nan" not in "\n".join(rate.test_e(results)).lower()


def test_same_day_actual_never_changes_trailing_quotes():
    games = games_fixture()
    opening = rate.opening_date(games)
    records = [g for g in games if not (g.player_id == "p000" and g.game_date < opening)]
    early = [g for g in games if g.player_id == "p000" and g.game_date < opening][:2]
    records += early
    records += [replace(early[-1], game_date=opening, game_id="g000", actual_net_points=9000)]
    study = rate.Study(games=records, trade_day=opening)
    assert study.anchor_on("p000", opening) == 2.0
    streams = balance.quote_streams(records, study.universe)
    p_rows = [r for r in streams if r["player_id"] == "p000" and r["date"] == opening]
    assert all(r["trailing"] == 2.0 for r in p_rows)


@pytest.mark.parametrize("cap", [None, .05, .10, .25, math.inf])
def test_repricing_ledger_retained_positions_floor_and_exact_fees(cap):
    games = [replace(g, actual_net_points=-2.0, saved_projection_net_points=-1.0) if g.player_id == "p000" else g for g in games_fixture()]
    study = repricing.RepricingStudy(games=games)
    result = study.run(cap, lambda day, current: {"p000"}, record_events=True)
    opens = [e for e in result.events if e["kind"] == "open"]
    settlements = [e for e in result.events if e["kind"] == "game"]
    updates = [e for e in result.events if e["kind"] == "reprice"]
    assert len(opens) == result.opens == 1  # retained across week boundaries
    assert result.fees_dollars == 10_000
    assert all(e["cost"] >= 25_000 for e in opens + updates + settlements)
    assert result.gross_dollars == pytest.approx(sum(e["dividend"] - e["cost"] for e in settlements))
    assert result.net_dollars == pytest.approx(result.gross_dollars - 10_000)
    assert result.held_games == len(settlements)
    for event in updates:
        if cap is not None and math.isfinite(cap):
            assert event["old"] * (1 - cap) <= event["cost"] <= event["old"] * (1 + cap)


def test_close_and_reopen_charges_fee_but_retaining_does_not():
    study = repricing.RepricingStudy(games=games_fixture(days=45))
    calls = []
    def pick(day, current):
        calls.append(day)
        return set() if len(calls) == 2 else {"p000"}
    result = study.run(None, pick)
    assert result.opens == 2
    assert result.fees_dollars == 20_000


@pytest.mark.parametrize("cost,quote,cap", [(0, 25000, .1), (25000, -10, .1), (math.nan, 25000, .1), (25000, math.inf, .1), (25000, 25000, -.1)])
def test_repricing_rejects_invalid_costs_and_caps(cost, quote, cap):
    with pytest.raises(ValueError):
        repricing.reprice_cost(cost, quote, cap)


def test_rate_gate_enforces_weekly_lower_bound_and_season_spread():
    good = (200_000, 600_000, 2_000_000, 25_000, 500_000)
    assert rate.rate_band_failures(*good) == []
    assert "week outside band" in rate.rate_band_failures(200_000, 499_999, *good[2:])
    assert "season spread outside band" in rate.rate_band_failures(*good[:2], 10_000_000, *good[3:])
    assert "floor binds" in rate.rate_band_failures(*good[:3], 24_999, good[4])
    assert "nonfinite input" in rate.rate_band_failures(math.nan, *good[1:])


def test_balance_break_even_counts_incremental_adds_of_both_rosters():
    fee = balance.incremental_break_even_fee(100_000, 20, 10)
    assert fee == 10_000
    assert 200_000 - 20 * fee == 100_000 - 10 * fee
    assert math.isnan(balance.incremental_break_even_fee(100, 10, 10))


def test_streaming_does_not_credit_calibration_games():
    cutoff = date(2025, 11, 1)
    rows = [{"player_id": "p1", "date": cutoff - timedelta(days=1), "actual": 1e9, "gameday_proj": 5, "trailing": 5, "blend": 5},
            {"player_id": "p1", "date": cutoff, "actual": 6, "gameday_proj": 5, "trailing": 5, "blend": 5}]
    output = "\n".join(balance.streaming_study(rows, cutoff))
    assert "| gameday_proj | $+20,000 | $+20,000 | $+0 | 1 | 1 | 1 | 1 |" in output


def test_variable_length_windows_use_actual_per_window_averages():
    # Both windows average10/game, despite different total returns and exposure.
    assert balance.window_average_sd([10, 30], [1, 3]) == 0
    assert balance.window_average_sd([10, 60], [1, 3]) == 5
    with pytest.raises(ValueError):
        balance.window_average_sd([10], [0])


def test_zero_residual_short_windows_report_undefined_relative_sd():
    rows = [{"player_id": "p", "date": date(2025, 11, i), "actual": 5, "gameday_proj": 5} for i in (1, 2, 3)]
    output = "\n".join(balance.short_study(rows))
    assert "undefined (zero baseline SD)" in output


def short_window_cells(report, label):
    row = next(line for line in report if line.startswith(f"| {label} |"))
    return [cell.strip() for cell in row.strip("|").split("|")]


def test_short_windows_exclude_incomplete_calendar_horizons():
    rows = [
        dict(player_id="a", date=date(2025, 11, 1), actual=0, gameday_proj=0),
        dict(player_id="b", date=date(2025, 11, 2), actual=10, gameday_proj=0),
    ]
    report = balance.short_study(rows)
    assert short_window_cells(report, "1 day")[1:3] == ["2", "0"]
    for label in ("3 days", "7 days", "14 days"):
        cells = short_window_cells(report, label)
        assert cells[1:3] == ["0", "2"]
        assert cells[3:] == ["unavailable", "unavailable", "unavailable"]
    assert "nan" not in "\n".join(report).lower()


def test_short_windows_share_global_horizon_despite_player_inactivity():
    rows = [dict(player_id="a", date=date(2025, 11, 1), actual=4, gameday_proj=3)]
    # a has no games after November1, but the league is observed through November14.
    report = balance.short_study(rows, observation_end=date(2025, 11, 14))
    cells = short_window_cells(report, "14 days")
    assert cells[1:4] == ["1", "0", "1.00"]
    assert "unavailable" in cells[4]  # one complete window cannot estimate variability


def test_short_window_end_is_inclusive_and_later_start_is_counted_as_omitted():
    rows = [dict(player_id="a", date=date(2025, 11, day), actual=4, gameday_proj=3) for day in (1, 15)]
    report = balance.short_study(rows, observation_end=date(2025, 11, 15))
    assert short_window_cells(report, "14 days")[1:3] == ["1", "1"]
    with pytest.raises(ValueError, match="horizon"):
        balance.short_study(rows, observation_end=date(2025, 11, 14))


def test_lock_drift_per_game_mean_weights_exposures():
    assert drift.weighted_mean([(1, 1), (10, 9)]) == pytest.approx(9.1)


def test_real_prior_season_required_and_current_year_proxy_rejected():
    opening = date(2025, 11, 3)
    assert prior_pnl.previous_season_anchors([prior_record()], opening) == {"p000": 8}
    for day in [date(2025, 10, 1), date(2026, 1, 1), date(2023, 12, 1)]:
        with pytest.raises(ValueError, match="previous-season"):
            prior_pnl.previous_season_anchors([prior_record(day=day)], opening)
    with pytest.raises(ValueError, match="empty"):
        prior_pnl.previous_season_anchors([], opening)


def test_prior_opening_cost_and_fees_are_recomputed_at_each_rate():
    games = games_fixture()
    low = prior_pnl.PriorAnchorStudy(games=games, prior_records=[prior_record(points=1)], rate=15_000)
    high = prior_pnl.PriorAnchorStudy(games=games, prior_records=[prior_record(points=1)], rate=40_000)
    low_result = low.run(None, lambda day, current: {"p000"}, record_events=True)
    high_result = high.run(None, lambda day, current: {"p000"}, record_events=True)
    assert low_result.events[0]["cost"] == 25_000
    assert high_result.events[0]["cost"] == 40_000
    assert low_result.fees_dollars == high_result.fees_dollars == 10_000
    daily, weekly = prior_pnl.daily_and_weekly(low, low_result)
    assert sum(daily) == pytest.approx(low_result.net_dollars)
    assert sum(weekly) == pytest.approx(low_result.net_dollars)


def test_oracle_drift_rows_are_explicit_and_causal_rows_ignore_future():
    cutoff = date(2025, 11, 1)
    rows = [{"date": cutoff - timedelta(days=i), "actual": 4, "proj": 3} for i in (3, 2, 1)]
    first = drift.lock_anchors(rows + [{"date": cutoff, "actual": 10, "proj": 999}], cutoff, 8)
    second = drift.lock_anchors(rows + [{"date": cutoff, "actual": 1000, "proj": -999}], cutoff, 8)
    assert first["trailing10"] == second["trailing10"] == 4
    assert first["latest_prior_projection"] == second["latest_prior_projection"] == 3
    assert first["actual_previous_season"] == second["actual_previous_season"] == 8
    assert all(name.startswith("ORACLE") for name in first if first[name] != second[name])
