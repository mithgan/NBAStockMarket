from __future__ import annotations

import json
import math
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from nba_stock_market.backtest import (
    GameRecord,
    ListedPlayer,
    _round_money,
    build_synthetic_users,
    load_source_manifest,
    main,
    replay_game_records,
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
    def test_money_rounding_canonicalizes_negative_zero(self) -> None:
        self.assertEqual(math.copysign(1.0, _round_money(-0.001)), 1.0)

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

    def test_cli_expectation_flag_selects_dnt_source(self) -> None:
        report = {"money_supply": {"net_inflation": 1.0, "final_portfolio_wealth": 2.0}}
        with (
            patch("sys.argv", ["backtest", "--expectation", "dnt"]),
            patch("nba_stock_market.backtest.run_backtest", return_value=report) as run,
        ):
            main()

        self.assertEqual(run.call_args.kwargs["expectation_model"], "dnt")

    def test_replay_falls_back_to_salary_for_missing_dnt_projection(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            (cache / "2025-12-25.json").write_text("[]", encoding="utf-8")
            source = DunksAndThreesExpectation(cache_dir=cache)
            player = Player("p", "Missing Player", "star", 40_000_000, 40_000_000)
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
            salary_implied_net_points(player.current_price),
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
            20.0 - salary_implied_net_points(player.current_price)
        ) * market.net_points_to_dollars / 100
        cash_before_sink = 100_000_000 + dividend

        summary = replay_game_records(market, [game], source)

        self.assertAlmostEqual(holder.cash, cash_before_sink * 0.90)
        self.assertAlmostEqual(summary.idle_cash_sunk, cash_before_sink * 0.10)

    def test_replay_integrates_engine_dividends_and_updates_expectation_after_game(self) -> None:
        player = Player("p", "Replay Player", "star", 40_000_000, 40_000_000)
        holder = User("holder", cash=100_000_000, holdings={"p": 2})
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
            (20.0 - prior) + (24.0 - 20.0)
        ) * market.net_points_to_dollars / 100 * 2

        summary = replay_game_records(market, games, source)

        self.assertAlmostEqual(holder.cash - 100_000_000, expected_cash_change)
        self.assertEqual(summary.game_count, 2)
        self.assertEqual(summary.game_day_count, 2)
        self.assertEqual(len(market.dividend_events), 2)
        self.assertEqual(market.dividend_events[1].expected_net_points, 20.0)
        self.assertEqual(source.history("p"), (20.0, 24.0))
        self.assertEqual(NetPointsModel().score(games[0].box_score), 20.0)

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
