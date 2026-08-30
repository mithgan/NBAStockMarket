from __future__ import annotations

import pytest

from nba_stock_market.per_game import (
    DividendBasis,
    EconomyPolicy,
    EconomyRuleError,
    JAVASCRIPT_MAX_SAFE_INTEGER,
    LedgerEntryKind,
    MAX_PER_GAME_QUOTE_DOLLARS,
    PerGameEconomy,
    PlayerGameResult,
    PlayerQuote,
    PositionSide,
    RevisionConflictError,
    SettlementStatus,
)


def _quotes(count: int = 12, *, cost: int = 500_000) -> list[PlayerQuote]:
    return [
        PlayerQuote(
            player_id=f"p{index}",
            current_per_game_cost_dollars=cost,
            prior_season_value_per_game_dollars=cost - 25_000,
        )
        for index in range(1, count + 1)
    ]


def test_locked_cost_does_not_change_when_later_adds_move_the_quote() -> None:
    economy = PerGameEconomy(
        _quotes(1, cost=100_000),
        policy=EconomyPolicy(open_quote_impact_bps=1_000),
    )
    economy.register_account("first")
    economy.register_account("second")

    first = economy.open_position(
        position_id="first-p1",
        account_id="first",
        player_id="p1",
        side=PositionSide.LONG,
        sequence=1,
    )
    second = economy.open_position(
        position_id="second-p1",
        account_id="second",
        player_id="p1",
        side=PositionSide.LONG,
        sequence=2,
    )

    assert first.locked_per_game_cost_dollars == 100_000
    assert second.locked_per_game_cost_dollars == 110_000
    assert economy.position("first-p1").locked_per_game_cost_dollars == 100_000
    assert economy.quote("p1").current_per_game_cost_dollars == 121_000


def test_per_game_long_settlement_charges_cost_and_credits_raw_dividend() -> None:
    economy = PerGameEconomy(
        _quotes(1),
        policy=EconomyPolicy(dividend_dollars_per_net_point=100_000),
    )
    economy.register_account("holder")
    economy.open_position(
        position_id="long-p1",
        account_id="holder",
        player_id="p1",
        side=PositionSide.LONG,
        sequence=1,
    )

    outcome = economy.settle_player_game(
        PlayerGameResult(
            game_id="game-1",
            player_id="p1",
            sequence=1,
            revision=1,
            actual_net_points=7.25,
        )
    )

    entries = economy.ledger_entries(account_id="holder")
    assert outcome.dividend_dollars == 725_000
    assert [entry.kind for entry in entries] == [
        LedgerEntryKind.GAME_COST,
        LedgerEntryKind.GAME_DIVIDEND,
    ]
    assert [entry.amount_dollars for entry in entries] == [-500_000, 725_000]
    assert economy.account_pnl_dollars("holder") == 225_000


def test_provider_game_id_settles_and_corrects_multiple_players_independently() -> None:
    economy = PerGameEconomy(
        _quotes(2),
        policy=EconomyPolicy(dividend_dollars_per_net_point=100_000),
    )
    economy.register_account("holder")
    for player_id in ("p1", "p2"):
        economy.open_position(
            position_id=f"long-{player_id}",
            account_id="holder",
            player_id=player_id,
            side=PositionSide.LONG,
            sequence=1,
        )

    first_p1 = economy.settle_player_game(
        PlayerGameResult("nba-game-1", "p1", 1, 1, actual_net_points=6.0)
    )
    first_p2 = economy.settle_player_game(
        PlayerGameResult("nba-game-1", "p2", 1, 1, actual_net_points=2.0)
    )
    corrected_p1 = economy.settle_player_game(
        PlayerGameResult("nba-game-1", "p1", 1, 2, actual_net_points=7.0)
    )
    corrected_p2 = economy.settle_player_game(
        PlayerGameResult("nba-game-1", "p2", 1, 2, actual_net_points=1.0)
    )

    assert (first_p1.dividend_dollars, corrected_p1.dividend_dollars) == (
        600_000,
        700_000,
    )
    assert (first_p2.dividend_dollars, corrected_p2.dividend_dollars) == (
        200_000,
        100_000,
    )
    assert [
        entry.amount_dollars
        for entry in economy.ledger_entries()
        if entry.player_id == "p1"
    ] == [-500_000, 600_000, 100_000]
    assert [
        entry.amount_dollars
        for entry in economy.ledger_entries()
        if entry.player_id == "p2"
    ] == [-500_000, 200_000, -100_000]


def test_game_id_sequence_is_immutable_across_players() -> None:
    economy = PerGameEconomy(_quotes(2))
    economy.settle_player_game(
        PlayerGameResult("nba-game-1", "p1", 7, 1, actual_net_points=6.0)
    )

    with pytest.raises(RevisionConflictError, match="game sequence"):
        economy.settle_player_game(
            PlayerGameResult("nba-game-1", "p2", 8, 1, actual_net_points=2.0)
        )

    accepted = economy.settle_player_game(
        PlayerGameResult("nba-game-1", "p2", 7, 1, actual_net_points=2.0)
    )
    assert accepted.sequence == 7


def test_roster_slot_limit_duplicate_side_and_opposing_position_policy() -> None:
    economy = PerGameEconomy(
        _quotes(3),
        policy=EconomyPolicy(max_long_positions=2, allow_opposing_positions=False),
    )
    economy.register_account("holder")
    economy.open_position(
        position_id="long-p1",
        account_id="holder",
        player_id="p1",
        side=PositionSide.LONG,
        sequence=1,
    )

    with pytest.raises(EconomyRuleError, match="active long position"):
        economy.open_position(
            position_id="duplicate-p1",
            account_id="holder",
            player_id="p1",
            side=PositionSide.LONG,
            sequence=2,
        )
    with pytest.raises(EconomyRuleError, match="opposing position"):
        economy.open_position(
            position_id="short-p1",
            account_id="holder",
            player_id="p1",
            side=PositionSide.SHORT,
            sequence=2,
        )

    economy.open_position(
        position_id="long-p2",
        account_id="holder",
        player_id="p2",
        side=PositionSide.LONG,
        sequence=2,
    )
    with pytest.raises(EconomyRuleError, match="long roster is full"):
        economy.open_position(
            position_id="long-p3",
            account_id="holder",
            player_id="p3",
            side=PositionSide.LONG,
            sequence=3,
        )


def test_short_cashflow_is_locked_cost_minus_game_dividend() -> None:
    economy = PerGameEconomy(
        _quotes(1),
        policy=EconomyPolicy(dividend_dollars_per_net_point=100_000),
    )
    economy.register_account("shorter")
    economy.open_position(
        position_id="short-p1",
        account_id="shorter",
        player_id="p1",
        side=PositionSide.SHORT,
        sequence=1,
    )

    economy.settle_player_game(
        PlayerGameResult(
            game_id="game-1",
            player_id="p1",
            sequence=1,
            revision=1,
            actual_net_points=3.0,
        )
    )

    entries = economy.ledger_entries(account_id="shorter")
    assert [entry.amount_dollars for entry in entries] == [500_000, -300_000]
    assert economy.account_pnl_dollars("shorter") == 200_000


def test_correction_posts_only_dividend_delta_and_never_a_second_cost() -> None:
    economy = PerGameEconomy(
        _quotes(1),
        policy=EconomyPolicy(dividend_dollars_per_net_point=100_000),
    )
    economy.register_account("holder")
    economy.open_position(
        position_id="long-p1",
        account_id="holder",
        player_id="p1",
        side=PositionSide.LONG,
        sequence=1,
    )
    economy.settle_player_game(
        PlayerGameResult("game-1", "p1", 1, 1, actual_net_points=3.0)
    )

    corrected = economy.settle_player_game(
        PlayerGameResult("game-1", "p1", 1, 2, actual_net_points=5.0)
    )

    entries = economy.ledger_entries(account_id="holder")
    assert [entry.kind for entry in entries].count(LedgerEntryKind.GAME_COST) == 1
    assert entries[-1].kind is LedgerEntryKind.DIVIDEND_CORRECTION
    assert entries[-1].amount_dollars == 200_000
    assert entries[-1].adjusts_revision == 1
    assert corrected.base_revision == 1
    assert corrected.adjusts_revision == 1
    assert economy.account_pnl_dollars("holder") == 0


def test_missing_projection_is_visible_and_can_settle_when_projection_arrives() -> None:
    economy = PerGameEconomy(
        _quotes(1),
        policy=EconomyPolicy(
            dividend_basis=DividendBasis.SURPRISE_VS_PROJECTION,
            dividend_dollars_per_net_point=100_000,
        ),
    )
    economy.register_account("holder")
    economy.open_position(
        position_id="long-p1",
        account_id="holder",
        player_id="p1",
        side=PositionSide.LONG,
        sequence=1,
    )

    missing = economy.settle_player_game(
        PlayerGameResult("game-1", "p1", 1, 1, actual_net_points=10.0)
    )

    assert missing.status is SettlementStatus.UNSETTLED_MISSING_PROJECTION
    assert missing.dividend_dollars is None
    assert missing.ledger_entry_ids == ()
    assert economy.ledger_entries(account_id="holder") == ()

    settled = economy.settle_player_game(
        PlayerGameResult(
            "game-1",
            "p1",
            1,
            2,
            actual_net_points=10.0,
            saved_projection_net_points=4.0,
        )
    )
    assert settled.status is SettlementStatus.SETTLED
    assert settled.base_revision == 2
    assert settled.dividend_dollars == 600_000
    assert [entry.amount_dollars for entry in economy.ledger_entries()] == [
        -500_000,
        600_000,
    ]


def test_idempotency_returns_original_outcome_without_appending_entries() -> None:
    economy = PerGameEconomy(_quotes(1))
    economy.register_account("holder")
    economy.open_position(
        position_id="long-p1",
        account_id="holder",
        player_id="p1",
        side=PositionSide.LONG,
        sequence=1,
    )
    result = PlayerGameResult("game-1", "p1", 1, 1, actual_net_points=2.0)

    first = economy.settle_player_game(result)
    entries_after_first = economy.ledger_entries()
    replay = economy.settle_player_game(result)

    assert replay is first
    assert economy.ledger_entries() == entries_after_first


def test_conflicting_retry_under_same_revision_is_rejected() -> None:
    economy = PerGameEconomy(_quotes(1))
    economy.settle_player_game(
        PlayerGameResult("game-1", "p1", 1, 1, actual_net_points=2.0)
    )

    with pytest.raises(RevisionConflictError, match="conflicts with prior payload"):
        economy.settle_player_game(
            PlayerGameResult("game-1", "p1", 1, 1, actual_net_points=2.5)
        )


def test_drop_after_settlement_cannot_retroactively_remove_that_game() -> None:
    economy = PerGameEconomy(_quotes(1))
    economy.register_account("holder")
    economy.open_position(
        position_id="long-p1",
        account_id="holder",
        player_id="p1",
        side=PositionSide.LONG,
        sequence=5,
    )
    economy.settle_player_game(
        PlayerGameResult("game-5", "p1", 5, 1, actual_net_points=2.0)
    )

    with pytest.raises(EconomyRuleError, match="already-settled exposure"):
        economy.close_position("long-p1", sequence=5)


def test_exposure_uses_half_open_boundaries_and_stops_after_drop() -> None:
    economy = PerGameEconomy(_quotes(1))
    economy.register_account("holder")
    economy.open_position(
        position_id="long-p1",
        account_id="holder",
        player_id="p1",
        side=PositionSide.LONG,
        sequence=5,
    )

    economy.settle_player_game(
        PlayerGameResult("game-4", "p1", 4, 1, actual_net_points=2.0)
    )
    economy.settle_player_game(
        PlayerGameResult("game-5", "p1", 5, 1, actual_net_points=2.0)
    )
    economy.close_position("long-p1", sequence=6)
    economy.settle_player_game(
        PlayerGameResult("game-6", "p1", 6, 1, actual_net_points=2.0)
    )

    entries = economy.ledger_entries(account_id="holder")
    assert {entry.game_id for entry in entries} == {"game-5"}
    assert economy.position("long-p1").closed_sequence == 6


def test_lifecycle_fees_and_all_game_entries_reconcile_to_exact_account_pnl() -> None:
    economy = PerGameEconomy(
        _quotes(1),
        policy=EconomyPolicy(
            dividend_dollars_per_net_point=100_000,
            open_fee_dollars=100,
            drop_fee_dollars=50,
        ),
    )
    economy.register_account("holder")
    economy.open_position(
        position_id="long-p1",
        account_id="holder",
        player_id="p1",
        side=PositionSide.LONG,
        sequence=1,
    )
    economy.settle_player_game(
        PlayerGameResult("game-1", "p1", 1, 1, actual_net_points=7.0)
    )
    economy.settle_player_game(
        PlayerGameResult("game-1", "p1", 1, 2, actual_net_points=8.0)
    )
    economy.close_position("long-p1", sequence=2)

    entries = economy.ledger_entries(account_id="holder")
    assert [entry.kind for entry in entries] == [
        LedgerEntryKind.OPEN_FEE,
        LedgerEntryKind.GAME_COST,
        LedgerEntryKind.GAME_DIVIDEND,
        LedgerEntryKind.DIVIDEND_CORRECTION,
        LedgerEntryKind.DROP_FEE,
    ]
    assert [entry.amount_dollars for entry in entries] == [
        -100,
        -500_000,
        700_000,
        100_000,
        -50,
    ]
    assert economy.account_pnl_dollars("holder") == 299_850
    assert economy.account_pnl_dollars("holder") == sum(
        entry.amount_dollars for entry in entries
    )
    assert len({entry.entry_id for entry in entries}) == len(entries)


def test_quote_movement_on_open_and_drop_is_deterministic_and_can_be_zero() -> None:
    moving = PerGameEconomy(
        _quotes(1, cost=100_000),
        policy=EconomyPolicy(
            open_quote_impact_bps=1_000,
            drop_quote_impact_bps=500,
        ),
    )
    moving.register_account("holder")
    position = moving.open_position(
        position_id="long-p1",
        account_id="holder",
        player_id="p1",
        side=PositionSide.LONG,
        sequence=1,
    )
    moving.close_position("long-p1", sequence=1)

    assert position.locked_per_game_cost_dollars == 100_000
    assert moving.quote("p1").current_per_game_cost_dollars == 104_762

    stationary = PerGameEconomy(_quotes(1, cost=100_000))
    stationary.register_account("holder")
    stationary.open_position(
        position_id="long-p1",
        account_id="holder",
        player_id="p1",
        side=PositionSide.LONG,
        sequence=1,
    )
    stationary.close_position("long-p1", sequence=1)
    assert stationary.quote("p1").current_per_game_cost_dollars == 100_000


def test_repeated_maximum_impact_quote_growth_saturates_at_practical_cap() -> None:
    economy = PerGameEconomy(
        _quotes(1, cost=250_000_000_000),
        policy=EconomyPolicy(
            open_quote_impact_bps=JAVASCRIPT_MAX_SAFE_INTEGER,
        ),
    )

    for index in range(20):
        account_id = f"holder-{index}"
        economy.register_account(account_id)
        position = economy.open_position(
            position_id=f"long-p1-{index}",
            account_id=account_id,
            player_id="p1",
            side=PositionSide.LONG,
            sequence=index,
        )
        assert position.locked_per_game_cost_dollars <= MAX_PER_GAME_QUOTE_DOLLARS
        assert economy.quote("p1").current_per_game_cost_dollars <= (
            MAX_PER_GAME_QUOTE_DOLLARS
        )

    assert economy.quote("p1").current_per_game_cost_dollars == (
        MAX_PER_GAME_QUOTE_DOLLARS
    )


@pytest.mark.parametrize("side", [PositionSide.LONG, PositionSide.SHORT])
def test_equal_open_and_drop_impacts_are_reciprocal_round_trips(
    side: PositionSide,
) -> None:
    economy = PerGameEconomy(
        _quotes(1, cost=100_000),
        policy=EconomyPolicy(
            open_quote_impact_bps=1_000,
            drop_quote_impact_bps=1_000,
            minimum_quote_dollars=1,
        ),
    )
    economy.register_account("holder")
    economy.open_position(
        position_id="position-p1",
        account_id="holder",
        player_id="p1",
        side=side,
        sequence=1,
    )
    economy.close_position("position-p1", sequence=1)

    assert economy.quote("p1").current_per_game_cost_dollars == 100_000


def test_default_slot_pools_allow_ten_longs_and_five_shorts() -> None:
    economy = PerGameEconomy(_quotes(17))
    economy.register_account("holder")
    for index in range(1, 11):
        economy.open_position(
            position_id=f"long-p{index}",
            account_id="holder",
            player_id=f"p{index}",
            side=PositionSide.LONG,
            sequence=index,
        )
    with pytest.raises(EconomyRuleError, match="long roster is full at 10"):
        economy.open_position(
            position_id="long-p11",
            account_id="holder",
            player_id="p11",
            side=PositionSide.LONG,
            sequence=11,
        )

    for index in range(11, 16):
        economy.open_position(
            position_id=f"short-p{index}",
            account_id="holder",
            player_id=f"p{index}",
            side=PositionSide.SHORT,
            sequence=index,
        )
    with pytest.raises(EconomyRuleError, match="short roster is full at 5"):
        economy.open_position(
            position_id="short-p16",
            account_id="holder",
            player_id="p16",
            side=PositionSide.SHORT,
            sequence=16,
        )


def test_opposing_positions_can_be_enabled_explicitly() -> None:
    economy = PerGameEconomy(
        _quotes(1),
        policy=EconomyPolicy(allow_opposing_positions=True),
    )
    economy.register_account("holder")
    economy.open_position(
        position_id="long-p1",
        account_id="holder",
        player_id="p1",
        side=PositionSide.LONG,
        sequence=1,
    )
    economy.open_position(
        position_id="short-p1",
        account_id="holder",
        player_id="p1",
        side=PositionSide.SHORT,
        sequence=1,
    )

    assert len(economy.active_positions(account_id="holder")) == 2


def test_surprise_dividend_uses_actual_minus_saved_pregame_projection() -> None:
    economy = PerGameEconomy(
        _quotes(1),
        policy=EconomyPolicy(
            dividend_basis=DividendBasis.SURPRISE_VS_PROJECTION,
            dividend_dollars_per_net_point=100_000,
        ),
    )

    outcome = economy.settle_player_game(
        PlayerGameResult(
            "game-1",
            "p1",
            1,
            1,
            actual_net_points=7.0,
            saved_projection_net_points=2.0,
        )
    )

    assert outcome.dividend_dollars == 500_000


def test_surprise_dividend_subtracts_decimal_inputs_before_rounding() -> None:
    economy = PerGameEconomy(
        _quotes(1),
        policy=EconomyPolicy(
            dividend_basis=DividendBasis.SURPRISE_VS_PROJECTION,
            dividend_dollars_per_net_point=10,
        ),
    )

    outcome = economy.settle_player_game(
        PlayerGameResult("game-1", "p1", 1, 1, 0.30, 0.25)
    )

    assert outcome.dividend_dollars == 1


def test_short_correction_after_drop_keeps_original_exposure_and_inverse_sign() -> None:
    economy = PerGameEconomy(
        _quotes(1),
        policy=EconomyPolicy(dividend_dollars_per_net_point=100_000),
    )
    economy.register_account("shorter")
    economy.open_position(
        position_id="short-p1",
        account_id="shorter",
        player_id="p1",
        side=PositionSide.SHORT,
        sequence=1,
    )
    economy.settle_player_game(
        PlayerGameResult("game-1", "p1", 1, 1, actual_net_points=5.0)
    )
    economy.close_position("short-p1", sequence=2)

    economy.settle_player_game(
        PlayerGameResult("game-1", "p1", 1, 2, actual_net_points=3.0)
    )

    entries = economy.ledger_entries(account_id="shorter")
    assert entries[-1].kind is LedgerEntryKind.DIVIDEND_CORRECTION
    assert entries[-1].amount_dollars == 200_000
    assert economy.account_pnl_dollars("shorter") == 200_000


def test_dividend_rounding_is_half_away_from_zero_in_integer_dollars() -> None:
    economy = PerGameEconomy(
        _quotes(1),
        policy=EconomyPolicy(dividend_dollars_per_net_point=1_000),
    )

    positive = economy.settle_player_game(
        PlayerGameResult("positive", "p1", 1, 1, actual_net_points=0.0005)
    )
    negative = economy.settle_player_game(
        PlayerGameResult("negative", "p1", 2, 1, actual_net_points=-0.0005)
    )

    assert positive.dividend_dollars == 1
    assert negative.dividend_dollars == -1


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -float("inf"), True])
def test_non_finite_net_points_are_rejected(value: object) -> None:
    with pytest.raises(ValueError, match="actual_net_points must be finite"):
        PlayerGameResult("game-1", "p1", 1, 1, actual_net_points=value)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("dividend_dollars_per_net_point", 1.5),
        ("max_long_positions", True),
        ("open_fee_dollars", -1),
    ],
)
def test_policy_money_and_limits_require_integer_values(field: str, value: object) -> None:
    with pytest.raises(ValueError):
        EconomyPolicy(**{field: value})  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("dividend_dollars_per_net_point", JAVASCRIPT_MAX_SAFE_INTEGER + 1),
        ("max_long_positions", JAVASCRIPT_MAX_SAFE_INTEGER + 1),
        ("max_short_positions", JAVASCRIPT_MAX_SAFE_INTEGER + 1),
        ("open_quote_impact_bps", JAVASCRIPT_MAX_SAFE_INTEGER + 1),
        ("drop_quote_impact_bps", JAVASCRIPT_MAX_SAFE_INTEGER + 1),
        ("minimum_quote_dollars", MAX_PER_GAME_QUOTE_DOLLARS + 1),
        ("open_fee_dollars", JAVASCRIPT_MAX_SAFE_INTEGER + 1),
        ("drop_fee_dollars", JAVASCRIPT_MAX_SAFE_INTEGER + 1),
    ],
)
def test_policy_values_reject_oversized_integers(field: str, value: int) -> None:
    with pytest.raises(ValueError, match=field):
        EconomyPolicy(**{field: value})


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("current_per_game_cost_dollars", MAX_PER_GAME_QUOTE_DOLLARS + 1),
        ("prior_season_value_per_game_dollars", MAX_PER_GAME_QUOTE_DOLLARS + 1),
    ],
)
def test_player_quote_values_reject_oversized_integers(
    field: str,
    value: int,
) -> None:
    values = {
        "player_id": "p1",
        "current_per_game_cost_dollars": 500_000,
        "prior_season_value_per_game_dollars": 475_000,
        field: value,
    }
    with pytest.raises(ValueError, match=field):
        PlayerQuote(**values)


def test_correction_cannot_change_game_sequence_or_saved_projection() -> None:
    economy = PerGameEconomy(
        _quotes(1),
        policy=EconomyPolicy(dividend_basis=DividendBasis.SURPRISE_VS_PROJECTION),
    )
    economy.settle_player_game(
        PlayerGameResult("game-1", "p1", 1, 1, 5.0, 2.0)
    )

    with pytest.raises(RevisionConflictError, match="game sequence"):
        economy.settle_player_game(
            PlayerGameResult("game-1", "p1", 2, 2, 5.0, 2.0)
        )
    with pytest.raises(RevisionConflictError, match="projection cannot change"):
        economy.settle_player_game(
            PlayerGameResult("game-1", "p1", 1, 2, 5.0, 3.0)
        )
