from types import SimpleNamespace
from unittest.mock import patch

from scripts import generate_expectation_comparison


def test_comparison_basis_reads_engine_dividend_constant() -> None:
    with patch.object(generate_expectation_comparison.engine, "NET_POINTS_TO_DOLLARS", 2_000_000.0):
        basis = generate_expectation_comparison._comparison_basis()

    assert "$20,000-per-net-point per-holder" in basis
    assert "$2,000,000-per-net-point full-float" in basis


def test_comparison_report_declares_current_economy_and_zero_bias() -> None:
    intro = generate_expectation_comparison._comparison_intro()

    assert "Each portfolio starts with $207,824,000" in intro
    assert "expectation bias is fixed at 0.00" in intro
    assert "0.43586495-net-point league bias" in intro


def test_generate_uses_explicit_zero_bias_for_every_comparison_report() -> None:
    with (
        patch.object(generate_expectation_comparison, "run_backtest", return_value={}) as run,
        patch.object(
            generate_expectation_comparison,
            "_replays",
            side_effect=RuntimeError("stop after report generation"),
        ) as replays,
    ):
        try:
            generate_expectation_comparison.generate()
        except RuntimeError as exc:
            assert str(exc) == "stop after report generation"
        else:
            raise AssertionError("generate() unexpectedly continued past _replays()")

    assert [item.kwargs["expectation_model"] for item in run.call_args_list] == list(
        generate_expectation_comparison.MODEL_LABELS
    )
    assert [item.kwargs["expectation_bias"] for item in run.call_args_list] == [
        generate_expectation_comparison.COMPARISON_EXPECTATION_BIAS
    ] * len(generate_expectation_comparison.MODEL_LABELS)
    assert replays.call_args.kwargs["expectation_bias"] == (
        generate_expectation_comparison.COMPARISON_EXPECTATION_BIAS
    )


def test_replays_applies_explicit_bias_to_every_market() -> None:
    player = SimpleNamespace(
        player_id="player-1",
        name="Player One",
        tier="mid",
        salary=20_000_000.0,
        actual_salary=20_000_000.0,
    )
    market = object()
    replay = object()

    with (
        patch.object(generate_expectation_comparison, "load_game_records", return_value=[]),
        patch.object(generate_expectation_comparison, "load_salary_by_name", return_value={}),
        patch.object(generate_expectation_comparison, "select_universe", return_value=[player]),
        patch.object(generate_expectation_comparison, "build_synthetic_users", return_value=[]),
        patch.object(generate_expectation_comparison, "_source", return_value=object()),
        patch.object(generate_expectation_comparison, "Market", return_value=market) as market_cls,
        patch.object(
            generate_expectation_comparison,
            "replay_game_records",
            return_value=replay,
        ),
    ):
        _, replays = generate_expectation_comparison._replays(expectation_bias=0.0)

    assert set(replays) == set(generate_expectation_comparison.MODEL_LABELS)
    assert [item.kwargs["expectation_bias"] for item in market_cls.call_args_list] == [
        0.0
    ] * len(generate_expectation_comparison.MODEL_LABELS)
