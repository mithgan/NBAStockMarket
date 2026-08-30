from __future__ import annotations

from dataclasses import replace
from datetime import date, timedelta
from pathlib import Path

import pytest

import nba_stock_market.per_game_simulation as simulation
from nba_stock_market.per_game import DividendBasis, PerGameEconomy
from nba_stock_market.per_game_simulation import (
    EvaluationMatrix,
    HistoricalPlayerGame,
    MINIMUM_QUOTE_DOLLARS,
    ScenarioConfig,
    _short_inverse_cashflow_audit,
    derive_opening_market,
    render_markdown,
    run_evaluation,
    run_scenario,
    write_reports,
)


def _games(*, players: int = 14, days: int = 4) -> list[HistoricalPlayerGame]:
    start = date(2025, 10, 21)
    rows: list[HistoricalPlayerGame] = []
    for day_index in range(days):
        game_date = start + timedelta(days=day_index)
        for player_index in range(players):
            rows.append(
                HistoricalPlayerGame(
                    game_id=f"game-{day_index:02d}-{player_index // 2:02d}",
                    game_date=game_date,
                    player_id=f"p{player_index:02d}",
                    player_name=f"Player {player_index:02d}",
                    actual_net_points=5.0 + player_index + day_index,
                    saved_projection_net_points=6.0 + player_index + day_index / 10,
                )
            )
    return rows


def _config(
    *,
    basis: DividendBasis = DividendBasis.RAW_NET_POINTS,
    impact: int = 50,
    shorts: bool = True,
    seed: int = 7,
) -> ScenarioConfig:
    return ScenarioConfig(
        dividend_basis=basis,
        dividend_dollars_per_net_point=20_000,
        quote_impact_bps=impact,
        weekly_shorts=shorts,
        seed=seed,
        universe_size=14,
    )


def _matrix() -> EvaluationMatrix:
    return EvaluationMatrix(
        bases=(DividendBasis.RAW_NET_POINTS, DividendBasis.SURPRISE_VS_PROJECTION),
        rates=(20_000,),
        quote_impacts_bps=(0, 50),
        short_modes=(False, True),
        seeds=(7,),
        universe_size=14,
    )


def test_identical_inputs_and_seeds_produce_identical_report() -> None:
    games = _games()
    first = run_evaluation(games, hashes={"fixture": "same"}, matrix=_matrix())
    second = run_evaluation(games, hashes={"fixture": "same"}, matrix=_matrix())

    assert first == second
    assert render_markdown(first) == render_markdown(second)


def test_simulator_assigns_one_sequence_to_every_player_in_a_game(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    observed: dict[str, set[int]] = {}
    original = PerGameEconomy.settle_player_game

    def recording_settlement(self: PerGameEconomy, result):  # type: ignore[no-untyped-def]
        observed.setdefault(result.game_id, set()).add(result.sequence)
        return original(self, result)

    monkeypatch.setattr(PerGameEconomy, "settle_player_game", recording_settlement)

    run_scenario(_games(), _config(shorts=False))

    assert observed
    assert all(len(sequences) == 1 for sequences in observed.values())


def test_reversing_strategy_declaration_order_does_not_change_outcomes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    games = _games(players=18, days=8)
    config = replace(_config(impact=500), universe_size=18)
    baseline = simulation.run_scenario(games, config)

    monkeypatch.setattr(
        simulation,
        "STRATEGIES",
        tuple(reversed(simulation.STRATEGIES)),
    )
    reversed_order = simulation.run_scenario(games, config)

    baseline_accounts = {
        row["strategy"]: row for row in baseline.report["user_pnl"]["accounts"]
    }
    reversed_accounts = {
        row["strategy"]: row
        for row in reversed_order.report["user_pnl"]["accounts"]
    }
    assert reversed_accounts == baseline_accounts


def test_same_day_outcome_is_not_visible_to_pregame_actions() -> None:
    games = _games(days=3)
    changed = [
        replace(game, actual_net_points=9_999.0)
        if game.game_date == date(2025, 10, 22)
        else game
        for game in games
    ]

    baseline = run_scenario(games, _config(seed=42))
    altered = run_scenario(changed, _config(seed=42))
    cutoff = date(2025, 10, 22)
    baseline_actions = [action for action in baseline.actions if action.game_date <= cutoff]
    altered_actions = [action for action in altered.actions if action.game_date <= cutoff]

    assert baseline_actions == altered_actions
    assert baseline.report["adapter_invariants"][
        "no_same_day_outcome_leakage_violations"
    ] == 0


def test_missing_projection_remains_unsettled_in_surprise_mode() -> None:
    games = _games(days=2)
    games = [
        replace(game, saved_projection_net_points=None)
        if game.player_id == "p00" and game.game_date == date(2025, 10, 22)
        else game
        for game in games
    ]

    result = run_scenario(
        games,
        _config(basis=DividendBasis.SURPRISE_VS_PROJECTION, shorts=False),
    ).report

    assert result["unsettled"] == 1
    assert result["settled"] == len(games) - 1


def test_every_account_reconciles_to_integer_dollar_ledger() -> None:
    result = run_scenario(_games(), _config()).report

    assert result["ledger_reconciled"] is True
    assert result["adapter_invariants"]["integer_ledger_amounts"] is True
    for account in result["user_pnl"]["accounts"]:
        assert account["ledger_reconciled"] is True
        assert account["pnl_dollars"] == account["ledger_sum_dollars"]
        assert account["pnl_dollars"] == account["expected_cash_flow_dollars"]
        assert isinstance(account["pnl_dollars"], int)


def test_independent_cash_flow_reconciliation_rejects_equal_ledger_tampering(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original_entries = PerGameEconomy.ledger_entries
    original_pnl = PerGameEconomy.account_pnl_dollars

    def tampered_entries(self: PerGameEconomy, *, account_id: str | None = None):
        entries = list(original_entries(self, account_id=account_id))
        touched_accounts: set[str] = set()
        for index, entry in enumerate(entries):
            if entry.account_id in touched_accounts:
                continue
            entries[index] = replace(
                entry,
                amount_dollars=entry.amount_dollars + 1,
            )
            touched_accounts.add(entry.account_id)
        return tuple(entries)

    def tampered_pnl(self: PerGameEconomy, account_id: str) -> int:
        return original_pnl(self, account_id) + 1

    monkeypatch.setattr(PerGameEconomy, "ledger_entries", tampered_entries)
    monkeypatch.setattr(PerGameEconomy, "account_pnl_dollars", tampered_pnl)

    with pytest.raises(AssertionError, match="independent expected cash flow"):
        run_scenario(_games(), _config(shorts=False))


def test_locked_cost_and_drop_boundaries_survive_adapter() -> None:
    games = [
        replace(
            game,
            saved_projection_net_points=(
                100.0 - int(game.player_id[1:])
                if game.game_date == date(2025, 10, 22)
                else game.saved_projection_net_points
            ),
        )
        for game in _games(days=5)
    ]
    result = run_scenario(games, _config(impact=100)).report

    assert result["adapter_invariants"]["locked_cost_violations"] == 0
    assert result["adapter_invariants"]["post_drop_exposure_violations"] == 0
    assert result["roster_churn"]["drops"] > 0
    assert result["price_stability"]["maximum_single_action_move_pct"] > 0


def test_price_extrema_use_the_full_action_path() -> None:
    games = _games(players=18, days=8)
    config = replace(_config(impact=1_000), universe_size=18)
    opening = derive_opening_market(games, config)
    run = run_scenario(games, config)
    opening_quotes = {
        quote.player_id: quote.current_per_game_cost_dollars
        for quote in opening.quotes
    }
    paths = {player_id: [quote] for player_id, quote in opening_quotes.items()}
    for action in run.actions:
        paths[action.player_id].append(action.quote_after_dollars)
    ratios = [
        value / opening_quotes[player_id]
        for player_id, values in paths.items()
        for value in values
    ]

    metrics = run.report["price_stability"]
    assert metrics["maximum_price_opening_multiple"] == round(max(ratios), 6)
    assert metrics["minimum_price_opening_ratio"] == round(min(ratios), 6)
    assert metrics["maximum_absolute_change_from_opening_pct"] == round(
        100 * max(abs(ratio - 1.0) for ratio in ratios),
        4,
    )


def test_initial_floor_quotes_are_not_counted_as_floor_hits() -> None:
    games = [
        replace(game, saved_projection_net_points=0.0)
        for game in _games(days=1)
    ]

    result = run_scenario(games, _config(impact=50, shorts=False)).report

    assert result["price_stability"]["floor_hit_count"] == 0
    assert MINIMUM_QUOTE_DOLLARS == 25_000


def test_profitable_daily_net_settlement_has_no_fake_drawdown() -> None:
    games = [
        replace(
            game,
            actual_net_points=(game.saved_projection_net_points or 0.0) + 20.0,
        )
        for game in _games(days=1)
    ]

    result = run_scenario(games, _config(impact=0, shorts=False)).report

    for account in result["user_pnl"]["accounts"]:
        assert account["pnl_dollars"] > 0
        assert account["max_drawdown_dollars"] == 0


def test_opening_quote_path_ignores_realized_season_results() -> None:
    games = _games()
    changed_actuals = [replace(game, actual_net_points=-game.actual_net_points) for game in games]

    original = derive_opening_market(games, _config())
    changed = derive_opening_market(changed_actuals, _config())

    assert original == changed
    assert all(quote.prior_season_value_per_game_dollars is None for quote in original.quotes)
    assert "no realized" in original.method


def test_simulation_honors_ten_long_and_five_short_limits() -> None:
    result = run_scenario(_games(players=18), replace(_config(), universe_size=18)).report

    assert result["policy"]["long_slot_limit"] == 10
    assert result["policy"]["short_slot_limit"] == 5
    assert result["roster_churn"]["max_active_longs_per_account"] == 10
    assert result["roster_churn"]["max_active_shorts_per_account"] <= 5
    assert set(result["roster_churn"]["max_active_longs_by_account"].values()) == {10}
    assert all(
        count <= 5
        for count in result["roster_churn"]["max_active_shorts_by_account"].values()
    )
    assert result["adapter_invariants"]["max_active_longs_per_account"] == 10
    assert result["adapter_invariants"]["max_active_shorts_per_account"] <= 5


def test_short_inverse_audit_uses_exposure_cost_and_settled_dividends() -> None:
    mismatch = _short_inverse_cashflow_audit(
        locked_cost_dollars=100,
        opened_sequence=2,
        closed_sequence=4,
        settled_games=((1, 5), (2, 120), (3, 50), (4, 10)),
        actual_short_game_pnl_dollars=31,
    )

    assert mismatch == {
        "qualifying_games": 2,
        "expected_short_pnl_dollars": 30,
        "actual_short_game_pnl_dollars": 31,
        "asymmetry_dollars": 1,
    }

    result = run_scenario(_games(players=18), replace(_config(), universe_size=18)).report
    short_policy = result["short_policy"]
    assert short_policy["inverse_cashflow_positions_checked"] > 0
    assert short_policy["inverse_cashflow_expected_short_pnl_dollars"] != 0
    assert (
        short_policy["inverse_cashflow_actual_short_game_pnl_dollars"]
        == short_policy["inverse_cashflow_expected_short_pnl_dollars"]
    )
    assert short_policy["inverse_cashflow_aggregate_asymmetry_dollars"] == 0
    assert short_policy["inverse_cashflow_max_position_asymmetry_dollars"] == 0


def test_report_contains_required_headings_metrics_and_labels(tmp_path: Path) -> None:
    report = run_evaluation(_games(), hashes={"fixture": "hash"}, matrix=_matrix())
    markdown = render_markdown(report)
    headings = [
        "## Roster churn",
        "## Price stability",
        "## Early mispricing",
        "## Short policy",
        "## User P&L",
    ]

    assert [markdown.index(heading) for heading in headings] == sorted(
        markdown.index(heading) for heading in headings
    )
    assert "synthetic scenario behavior" in markdown
    assert "prior-season per-game anchors are unavailable" in markdown
    assert report["ledger_reconciled"] is True
    assert report["settled"] > 0
    assert report["policies"]["scenario_count"] == 8

    json_path, markdown_path = write_reports(report, tmp_path)
    assert json_path.read_text(encoding="utf-8").endswith("\n")
    assert markdown_path.read_text(encoding="utf-8") == markdown
