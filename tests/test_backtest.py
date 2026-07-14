from __future__ import annotations

import json
import math
import os
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from nba_stock_market import backtest as backtest_module
from nba_stock_market import expectations
from nba_stock_market.backtest import (
    GameRecord,
    ListedPlayer,
    _player_row,
    _render_markdown,
    _round_money,
    build_synthetic_users,
    compute_league_mean_surprise,
    inflation_option_row,
    load_opening_prices_by_name,
    load_source_manifest,
    main,
    replay_game_records,
    run_backtest,
    select_universe,
)
from nba_stock_market.engine import BoxScoreLine, Market, NetPointsModel, Player, User
from nba_stock_market.expectations import (
    DunksAndThreesExpectation,
    SalaryProjectionExpectation,
    TrailingMeanExpectation,
    salary_implied_net_points,
)
from nba_stock_market.historical_data import (
    load_game_records,
    parse_espn_summary,
    write_game_records,
)
from scripts.fetch_backtest_data import _validated_game_id


def line_with_points(points: float) -> BoxScoreLine:
    return BoxScoreLine(
        pts=points,
        offensive_rebounds=0,
        defensive_rebounds=0,
        ast=0,
        stl=0,
        blk=0,
        tov=0,
        fga=0,
        fgm=0,
        three_pa=0,
        three_pm=0,
        fta=0,
        ftm=0,
        minutes=0,
    )


class ExpectationSourceTest(unittest.TestCase):
    def _dnt_cache(self, directory: str) -> Path:
        cache = Path(directory)
        fixture = Path("tests/fixtures/dnt_predictions_2025-12-25.json")
        (cache / "2025-12-25.json").write_text(
            fixture.read_text(encoding="utf-8"), encoding="utf-8"
        )
        return cache

    def test_salary_projection_uses_salary_implied_value_for_every_game(self) -> None:
        player = Player("p", "Projected Player", "star", 40_000_000, 40_000_000)
        source = SalaryProjectionExpectation()
        expected = salary_implied_net_points(40_000_000)

        self.assertEqual(
            source.expected_performance(player, date(2025, 10, 21)), expected
        )
        source.observe(player.id, 60.0)
        self.assertEqual(
            source.expected_performance(player, date(2026, 4, 12)), expected
        )

    def test_salary_expectations_use_actual_salary_not_modeled_listing(self) -> None:
        player = Player(
            "p",
            "Split Price Player",
            "star",
            58_000_000,
            58_000_000,
            actual_salary=20_000_000,
        )
        expected = salary_implied_net_points(20_000_000)

        self.assertEqual(
            SalaryProjectionExpectation().expected_performance(player, date(2025, 10, 21)),
            expected,
        )
        self.assertEqual(
            TrailingMeanExpectation().expected_performance(player, date(2025, 10, 21)),
            expected,
        )
        self.assertEqual(player.current_price, 58_000_000)

    def test_production_expectation_is_zero_for_every_game(self) -> None:
        player = Player("p", "Raw Producer", "star", 40_000_000, 40_000_000)
        source = expectations.ProductionExpectation()

        self.assertEqual(source.expected_performance(player, date(2025, 10, 21)), 0.0)
        source.observe(player.id, 60.0)
        self.assertEqual(source.expected_performance(player, date(2026, 4, 12)), 0.0)

    def test_cold_start_uses_salary_implied_prior(self) -> None:
        player = Player("p", "Cold Start", "star", 40_000_000, 40_000_000)
        source = TrailingMeanExpectation(window=10)

        expected = source.expected_performance(player, date(2025, 10, 21))

        self.assertEqual(expected, salary_implied_net_points(40_000_000))

    def test_trailing_mean_uses_only_prior_games_inside_window(self) -> None:
        player = Player("p", "Rolling Player", "mid", 20_000_000, 20_000_000)
        source = TrailingMeanExpectation(window=3)
        for actual in (2.0, 4.0, 8.0, 10.0):
            source.observe(player.id, actual)

        expected = source.expected_performance(player, date(2025, 11, 1))

        self.assertAlmostEqual(expected, (4.0 + 8.0 + 10.0) / 3)

    def test_dnt_maps_projection_fields_to_engine_box_score(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = DunksAndThreesExpectation(cache_dir=self._dnt_cache(directory))
            player = Player("p", "Nikola Jokic", "star", 55_000_000, 55_000_000)

            line = source.projected_box_score(player, date(2025, 12, 25))

        self.assertIsNotNone(line)
        assert line is not None
        self.assertEqual(line.fga, 17.8)
        self.assertEqual(line.fgm, 10.0)
        self.assertEqual(line.three_pa, 4.7)
        self.assertEqual(line.three_pm, 1.8)
        self.assertEqual(line.offensive_rebounds, 3.1)
        self.assertEqual(line.defensive_rebounds, 9.4)
        self.assertEqual(line.minutes, 36.5)

    def test_dnt_matches_normalized_player_name_and_scores_with_engine_model(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = DunksAndThreesExpectation(cache_dir=self._dnt_cache(directory))
            player = Player("p", "Nikola Jokic", "star", 55_000_000, 55_000_000)

            expected = source.expected_performance(player, date(2025, 12, 25))
            line = source.projected_box_score(player, date(2025, 12, 25))

        self.assertIsNotNone(line)
        self.assertEqual(expected, line)
        self.assertAlmostEqual(
            NetPointsModel().score(expected), NetPointsModel().score(line)
        )

    def test_dnt_returns_none_for_missing_player_game(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = DunksAndThreesExpectation(cache_dir=self._dnt_cache(directory))
            player = Player("p", "Missing Player", "star", 40_000_000, 40_000_000)

            self.assertIsNone(source.expected_performance(player, date(2025, 12, 25)))


class BacktestReplayTest(unittest.TestCase):
    def test_auto_bias_is_finite_league_mean_surprise(self) -> None:
        class FixedExpectation:
            def expected_performance(self, player: Player, game_date: date) -> float:
                return 10.0

            def observe(self, player_id: str, actual: float) -> None:
                pass

        player = Player("p", "Bias Player", "star", 40_000_000, 40_000_000)
        market = Market([player], idle_cash_fee=0.0, inactivity_decay_rate=0.0)
        games = [
            GameRecord("g1", date(2025, 10, 21), "p", player.name, "TST", line_with_points(12)),
            GameRecord("g2", date(2025, 10, 22), "p", player.name, "TST", line_with_points(14)),
        ]

        bias = compute_league_mean_surprise(market, games, FixedExpectation())

        self.assertTrue(math.isfinite(bias))
        self.assertEqual(bias, 3.0)

    def test_inflation_option_row_uses_requested_report_math(self) -> None:
        report = {
            "money_supply": {"net_inflation": 7.0, "net_inflation_pct": 0.5},
            "calibration": {"current_great_game_per_holder_payout": 90.0},
            "portfolio_spread": {"median_final_value": 140.0},
            "examples": [
                {"player": "Shai Gilgeous-Alexander", "game_date": "2025-10-23", "payout_per_share": 80.0},
                {"player": "Nikola Jokic", "game_date": "2025-12-25", "payout_per_share": 120.0},
            ],
        }

        row = inflation_option_row("B", 40_000.0, 1.25, report)

        self.assertEqual(row["net_inflation"], 7.0)
        self.assertEqual(row["net_inflation_pct"], 0.5)
        self.assertEqual(row["sga_payout"], 80.0)
        self.assertEqual(row["jokic_payout"], 120.0)
        self.assertEqual(row["star_game_p90_payout"], 90.0)
        self.assertEqual(row["median_portfolio_final_value"], 140.0)

    def test_money_rounding_canonicalizes_negative_zero(self) -> None:
        self.assertEqual(math.copysign(1.0, _round_money(-0.001)), 1.0)

    def test_cli_defaults_to_dnt_expectation(self) -> None:
        report = {"money_supply": {"net_inflation": 1.0, "final_portfolio_wealth": 2.0}}
        with (
            patch("sys.argv", ["backtest"]),
            patch("nba_stock_market.backtest.run_backtest", return_value=report) as run,
        ):
            main()

        self.assertEqual(run.call_args.kwargs["expectation_model"], "dnt")

    def test_cli_defaults_to_auto_expectation_bias(self) -> None:
        report = {"money_supply": {"net_inflation": 1.0, "final_portfolio_wealth": 2.0}}
        with (
            patch("sys.argv", ["backtest"]),
            patch("nba_stock_market.backtest.run_backtest", return_value=report) as run,
        ):
            main()

        self.assertEqual(run.call_args.kwargs["expectation_bias"], "auto")

    def test_cli_expectation_flag_selects_projection_source(self) -> None:
        report = {
            "money_supply": {
                "net_inflation": 1.0,
                "final_portfolio_wealth": 2.0,
            }
        }
        with (
            patch("sys.argv", ["backtest", "--expectation", "projection"]),
            patch("nba_stock_market.backtest.run_backtest", return_value=report) as run,
        ):
            main()

        self.assertEqual(run.call_args.kwargs["expectation_model"], "projection")

    def test_cli_expectation_bias_accepts_auto(self) -> None:
        report = {"money_supply": {"net_inflation": 1.0, "final_portfolio_wealth": 2.0}}
        with (
            patch("sys.argv", ["backtest", "--expectation-bias", "auto"]),
            patch("nba_stock_market.backtest.run_backtest", return_value=report) as run,
        ):
            main()

        self.assertEqual(run.call_args.kwargs["expectation_bias"], "auto")

    def test_cli_expectation_flag_selects_dnt_source(self) -> None:
        report = {"money_supply": {"net_inflation": 1.0, "final_portfolio_wealth": 2.0}}
        with (
            patch("sys.argv", ["backtest", "--expectation", "dnt"]),
            patch("nba_stock_market.backtest.run_backtest", return_value=report) as run,
        ):
            main()

        self.assertEqual(run.call_args.kwargs["expectation_model"], "dnt")

    def test_cli_expectation_flag_selects_production_source(self) -> None:
        report = {"money_supply": {"net_inflation": 1.0, "final_portfolio_wealth": 2.0}}
        with (
            patch("sys.argv", ["backtest", "--expectation", "production"]),
            patch("nba_stock_market.backtest.run_backtest", return_value=report) as run,
        ):
            main()

        self.assertEqual(run.call_args.kwargs["expectation_model"], "production")

    def test_replay_falls_back_to_salary_for_missing_dnt_projection(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            (cache / "2025-12-25.json").write_text("[]", encoding="utf-8")
            source = DunksAndThreesExpectation(cache_dir=cache)
            player = Player(
                "p",
                "Missing Player",
                "star",
                58_000_000,
                58_000_000,
                actual_salary=20_000_000,
            )
            market = Market(
                [player],
                [User("holder", holdings={"p": 1})],
                expectation_source=source,
                idle_cash_fee=0.0,
                inactivity_decay_rate=0.0,
            )
            game = GameRecord(
                "g1", date(2025, 12, 25), "p", player.name, "TST", line_with_points(20)
            )

            summary = replay_game_records(market, [game], source)

        self.assertEqual(summary.expectation_fallback_count, 1)
        self.assertEqual(
            summary.evaluations[0].expected_net_points,
            salary_implied_net_points(20_000_000) + market.expectation_bias,
        )

    def test_replay_applies_idle_cash_sink_after_game_dividends(self) -> None:
        player = Player("p", "Replay Player", "star", 40_000_000, 40_000_000)
        holder = User("holder", cash=100_000_000, holdings={"p": 1})
        source = TrailingMeanExpectation(window=10)
        market = Market(
            [player],
            [holder],
            expectation_source=source,
            idle_cash_fee=0.10,
            inactivity_decay_rate=0.0,
        )
        game = GameRecord(
            "g1",
            date(2025, 10, 21),
            "p",
            "Replay Player",
            "TST",
            line_with_points(20),
        )
        dividend = (
            20.0 - salary_implied_net_points(player.current_price) - market.expectation_bias
        ) * market.net_points_to_dollars / 100
        cash_before_sink = 100_000_000 + dividend

        summary = replay_game_records(market, [game], source)

        self.assertAlmostEqual(holder.cash, cash_before_sink * 0.90)
        self.assertAlmostEqual(summary.idle_cash_sunk, cash_before_sink * 0.10)

    def test_replay_integrates_engine_dividends_and_updates_expectation_after_game(self) -> None:
        player = Player("p", "Replay Player", "star", 40_000_000, 40_000_000)
        holder = User("holder", cash=100_000_000, holdings={"p": 1})
        source = TrailingMeanExpectation(window=10)
        market = Market(
            [player],
            [holder],
            expectation_source=source,
            idle_cash_fee=0.0,
            inactivity_decay_rate=0.0,
        )
        games = [
            GameRecord("g1", date(2025, 10, 21), "p", "Replay Player", "TST", line_with_points(20)),
            GameRecord("g2", date(2025, 10, 23), "p", "Replay Player", "TST", line_with_points(24)),
        ]
        prior = salary_implied_net_points(player.current_price)
        expected_cash_change = (
            (20.0 - prior - market.expectation_bias)
            + (24.0 - 20.0 - market.expectation_bias)
        ) * market.net_points_to_dollars / 100

        summary = replay_game_records(market, games, source)

        self.assertAlmostEqual(holder.cash - 100_000_000, expected_cash_change)
        self.assertEqual(summary.game_count, 2)
        self.assertEqual(summary.game_day_count, 2)
        self.assertEqual(len(market.dividend_events), 2)
        self.assertEqual(
            market.dividend_events[1].expected_net_points,
            20.0 + market.expectation_bias,
        )
        self.assertEqual(source.history("p"), (20.0, 24.0))
        self.assertEqual(NetPointsModel().score(games[0].box_score), 20.0)

    def test_replay_uses_game_id_to_make_duplicate_settlement_idempotent(self) -> None:
        game = GameRecord(
            "g1",
            date(2025, 10, 21),
            "p",
            "Replay Player",
            "TST",
            line_with_points(20),
        )

        def replay(records: list[GameRecord]) -> tuple[object, float, tuple[float, ...]]:
            source = TrailingMeanExpectation(window=10)
            holder = User("holder", cash=100_000_000, holdings={"p": 1})
            market = Market(
                [Player("p", "Replay Player", "star", 40_000_000, 40_000_000)],
                [holder],
                expectation_source=source,
                idle_cash_fee=0.0,
                inactivity_decay_rate=0.0,
            )
            summary = replay_game_records(market, records, source)
            report_total = sum(item.dividend_per_share for item in summary.evaluations)
            return summary, report_total, source.history("p")

        deduplicated, deduplicated_total, deduplicated_history = replay([game])
        duplicated, duplicated_total, duplicated_history = replay([game, game])

        self.assertEqual(duplicated, deduplicated)
        self.assertEqual(duplicated_total, deduplicated_total)
        self.assertEqual(duplicated_history, deduplicated_history)

    def test_synthetic_portfolios_are_deterministic_diversified_and_budgeted(self) -> None:
        players = [
            ListedPlayer(
                player_id=str(index),
                name=f"Player {index}",
                salary=5_000_000 + index * 250_000,
                minutes=2_000 - index,
                games=82,
                tier="bench",
            )
            for index in range(15)
        ]

        first = build_synthetic_users(players, count=5, seed=2026)
        second = build_synthetic_users(players, count=5, seed=2026)

        self.assertEqual(first, second)
        for user in first:
            self.assertEqual(len(user.holdings), 10)
            self.assertEqual(set(user.holdings.values()), {1})
            invested = sum(
                next(player.salary for player in players if player.player_id == player_id)
                for player_id in user.holdings
            )
            self.assertAlmostEqual(user.cash + invested, 140_000_000)

    def test_synthetic_portfolios_cannot_exceed_one_share_per_user_float(self) -> None:
        players = [
            ListedPlayer(str(index), f"Player {index}", 5_000_000, 2_000, 82, "bench")
            for index in range(15)
        ]

        with self.assertRaisesRegex(ValueError, "100-share float"):
            build_synthetic_users(players, count=101, seed=2026)


class OpeningListingLoaderTest(unittest.TestCase):
    def test_report_player_row_separates_listing_price_and_actual_salary(self) -> None:
        row = _player_row(
            ListedPlayer(
                "p",
                "Split Price Player",
                57_985_817,
                2_000,
                65,
                "star",
                actual_salary=55_224_526,
            ),
            1_000,
            2_000,
        )

        self.assertEqual(row["listing_price"], 57_985_817)
        self.assertEqual(row["actual_salary"], 55_224_526)
        self.assertNotIn("salary", row)

    def test_run_backtest_default_opening_prices_path_is_cwd_independent(self) -> None:
        expected = (
            Path(backtest_module.__file__).resolve().parents[1]
            / "output/opening-prices-2026-27.csv"
        )
        with tempfile.TemporaryDirectory() as directory:
            previous_cwd = Path.cwd()
            try:
                os.chdir(directory)
                with (
                    patch("nba_stock_market.historical_data.load_game_records", return_value=[]),
                    patch("nba_stock_market.backtest.load_source_manifest", return_value={}),
                    patch("nba_stock_market.backtest.load_salary_by_name", return_value={}),
                    patch(
                        "nba_stock_market.backtest.load_opening_prices_by_name",
                        return_value={},
                    ) as load_openings,
                    self.assertRaisesRegex(ValueError, "at least ten listed players"),
                ):
                    run_backtest(
                        Path(directory) / "data",
                        Path(directory) / "output",
                    )
            finally:
                os.chdir(previous_cwd)

        load_openings.assert_called_once_with(expected)

    def test_report_narrative_reflects_selected_listing_basis(self) -> None:
        report = json.loads(Path("output/backtest-2026.json").read_text(encoding="utf-8"))

        opening_text = _render_markdown(report)
        report["metadata"]["listing_basis"] = "salary-only listings"
        salary_text = _render_markdown(report)

        self.assertIn("Listings use projected-WAR FV plus 10% salary", opening_text)
        self.assertIn("projected-WAR FV plus 10% salary", opening_text)
        self.assertIn("Listings use a salary-only basis", salary_text)
        self.assertIn("prices stay at salary-only listings", salary_text)
        self.assertNotIn("projected-WAR FV plus 10% salary", salary_text)

    def test_report_narrative_reflects_selected_expectation_and_zero_bias(self) -> None:
        report = json.loads(Path("output/backtest-2026.json").read_text(encoding="utf-8"))
        report["metadata"].update(
            {
                "expectation_model": "production",
                "expectation": "zero expected net points; dividends reward raw game-log value",
                "expectation_bias_mode": "override",
            }
        )
        report["metadata"].pop("expectation_bias_net_points", None)

        text = _render_markdown(report)

        self.assertIn(
            "dividends settle actual game logs against zero expected net points; "
            "dividends reward raw game-log value",
            text,
        )
        self.assertIn("No expectation-bias correction is applied.", text)
        self.assertNotIn("against cached Dunks & Threes pregame projections", text)

    def test_normalized_match_uses_opening_price_and_missing_name_falls_back(self) -> None:
        games = [
            GameRecord("g1", date(2025, 10, 21), "p1", "Nikola Jokić", "DEN", line_with_points(20)),
            GameRecord("g1", date(2025, 10, 21), "p2", "Fallback Player", "TST", line_with_points(10)),
        ]
        salaries = {
            expectations.normalize_player_name("Nikola Jokic"): 55_000_000.0,
            expectations.normalize_player_name("Fallback Player"): 8_000_000.0,
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "opening.csv"
            path.write_text(
                "player,opening_price,tier\nnikola jokic,57985817,star\n",
                encoding="utf-8",
            )

            openings = load_opening_prices_by_name(path)
            universe = select_universe(games, salaries, opening_prices_by_name=openings, size=2)

        by_id = {player.player_id: player for player in universe}
        self.assertEqual(by_id["p1"].salary, 57_985_817.0)
        self.assertEqual(by_id["p1"].actual_salary, 55_000_000.0)
        self.assertEqual(by_id["p1"].tier, "star")
        self.assertFalse(by_id["p1"].used_salary_fallback)
        self.assertEqual(by_id["p2"].salary, 8_000_000.0)
        self.assertEqual(by_id["p2"].actual_salary, 8_000_000.0)
        self.assertEqual(by_id["p2"].tier, "bench")
        self.assertTrue(by_id["p2"].used_salary_fallback)


class HistoricalDataTest(unittest.TestCase):
    def test_remote_game_ids_must_be_numeric_before_becoming_cache_paths(self) -> None:
        self.assertEqual(_validated_game_id("401809236"), "401809236")
        for unsafe in ("../escape", "/tmp/escape", "401809236.json", ""):
            with self.subTest(unsafe=unsafe):
                with self.assertRaisesRegex(ValueError, "game id"):
                    _validated_game_id(unsafe)

    def test_source_manifest_validates_cache_counts_and_provenance(self) -> None:
        games = [
            GameRecord("g1", date(2025, 10, 21), "p1", "Player One", "AAA", line_with_points(20)),
            GameRecord("g1", date(2025, 10, 21), "p2", "Player Two", "BBB", line_with_points(18)),
            GameRecord("g2", date(2026, 4, 12), "p1", "Player One", "AAA", line_with_points(22)),
        ]
        manifest = {
            "season": "2025-26",
            "competition": "NBA regular season (NBA Cup championship excluded)",
            "season_start": "2025-10-21",
            "season_end": "2026-04-12",
            "game_count": 2,
            "player_game_count": 3,
            "espn_scoreboard_endpoint": "https://site.api.espn.com/scoreboard",
            "espn_summary_endpoint": "https://site.api.espn.com/summary",
            "salary_repository": "https://github.com/gabriel1200/site_Data",
            "salary_commit": "bc583cb0188a6d5ae59d052d08ac0d6efe1b14fd",
            "salary_file": "salary.csv",
            "fallback_salary_url": "https://raw.githubusercontent.com/example/raw_salary.csv",
            "fallback_salary_file": "raw_salary.csv",
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.json"
            path.write_text(json.dumps(manifest), encoding="utf-8")

            source = load_source_manifest(path, games)
            with self.assertRaisesRegex(ValueError, "not the complete 2025-26"):
                load_source_manifest(path, games, require_complete_season=True)

        self.assertEqual(source["game_count"], 2)
        self.assertEqual(source["player_game_count"], 3)
        self.assertEqual(source["salary_commit"], manifest["salary_commit"])

    def test_source_manifest_rejects_truncated_or_duplicate_cache(self) -> None:
        games = [
            GameRecord("g1", date(2025, 10, 21), "p1", "Player One", "AAA", line_with_points(20)),
            GameRecord("g1", date(2025, 10, 21), "p1", "Player One", "AAA", line_with_points(20)),
        ]
        manifest = {
            "season": "2025-26",
            "competition": "NBA regular season (NBA Cup championship excluded)",
            "season_start": "2025-10-21",
            "season_end": "2026-04-12",
            "game_count": 1230,
            "player_game_count": 26547,
            "espn_scoreboard_endpoint": "https://site.api.espn.com/scoreboard",
            "espn_summary_endpoint": "https://site.api.espn.com/summary",
            "salary_repository": "https://github.com/gabriel1200/site_Data",
            "salary_commit": "bc583cb0188a6d5ae59d052d08ac0d6efe1b14fd",
            "salary_file": "salary.csv",
            "fallback_salary_url": "https://raw.githubusercontent.com/example/raw_salary.csv",
            "fallback_salary_file": "raw_salary.csv",
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.json"
            path.write_text(json.dumps(manifest), encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "duplicate player-game"):
                load_source_manifest(path, games)

    def test_espn_summary_parser_flattens_real_box_score_fields(self) -> None:
        payload = {
            "header": {"id": "401809243"},
            "boxscore": {
                "players": [
                    {
                        "team": {"abbreviation": "OKC"},
                        "statistics": [
                            {
                                "labels": [
                                    "MIN", "PTS", "FG", "3PT", "FT", "REB", "AST",
                                    "TO", "STL", "BLK", "OREB", "DREB", "PF", "+/-",
                                ],
                                "athletes": [
                                    {
                                        "athlete": {"id": "4278073", "displayName": "Shai Gilgeous-Alexander"},
                                        "didNotPlay": False,
                                        "stats": ["40", "35", "12-26", "2-9", "9-11", "5", "5", "2", "2", "2", "1", "4", "3", "9"],
                                    },
                                    {
                                        "athlete": {"id": "dnp", "displayName": "Bench Player"},
                                        "didNotPlay": True,
                                        "stats": [],
                                    },
                                    {
                                        "athlete": {"id": "inactive", "displayName": "Inactive Player"},
                                        "didNotPlay": False,
                                        "stats": ["--"] * 14,
                                    },
                                ],
                            }
                        ],
                    }
                ]
            },
        }

        records = parse_espn_summary(payload, date(2025, 10, 21))

        self.assertEqual(len(records), 1)
        game = records[0]
        self.assertEqual((game.game_id, game.player_id, game.team), ("401809243", "4278073", "OKC"))
        self.assertEqual(game.box_score.pts, 35)
        self.assertEqual((game.box_score.fgm, game.box_score.fga), (12, 26))
        self.assertEqual((game.box_score.three_pm, game.box_score.three_pa), (2, 9))
        self.assertEqual((game.box_score.ftm, game.box_score.fta), (9, 11))
        self.assertEqual((game.box_score.offensive_rebounds, game.box_score.defensive_rebounds), (1, 4))

    def test_game_record_csv_round_trip_is_lossless(self) -> None:
        games = [
            GameRecord("g1", date(2025, 10, 21), "p", "Player One", "TST", line_with_points(20)),
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "games.csv"

            write_game_records(path, games)

            self.assertEqual(load_game_records(path), games)


if __name__ == "__main__":
    unittest.main()
