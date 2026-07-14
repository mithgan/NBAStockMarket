from __future__ import annotations

import csv
import tempfile
import unittest
from pathlib import Path

from nba_stock_market.epm_data import EPMRow, load_epm_rows, write_snapshot
from nba_stock_market.fv_validation import (
    backtest_external_rows,
    backtest_projected_war_model,
    backtest_season_pair,
    compare_metrics,
    fit_war_calibration,
    listing_cohort_keys,
    load_darko_rows,
    projected_war_calibration_rows,
    spearman,
)
from tests.test_opening_prices import impact_row


class SpearmanTest(unittest.TestCase):
    def test_perfect_positive_and_negative(self) -> None:
        self.assertAlmostEqual(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1.0)
        self.assertAlmostEqual(spearman([1, 2, 3, 4], [40, 30, 20, 10]), -1.0)

    def test_monotone_transform_is_invariant(self) -> None:
        xs = [1.0, 5.0, 2.0, 9.0, 4.0]
        ys = [x**3 for x in xs]
        self.assertAlmostEqual(spearman(xs, ys), 1.0)

    def test_ties_get_average_ranks(self) -> None:
        rho = spearman([1.0, 1.0, 2.0, 3.0], [1.0, 2.0, 3.0, 4.0])
        self.assertGreater(rho, 0.9)
        self.assertLess(rho, 1.0)

    def test_rejects_bad_input(self) -> None:
        with self.assertRaises(ValueError):
            spearman([1.0, 2.0], [1.0, 2.0])
        with self.assertRaises(ValueError):
            spearman([1.0, 2.0, 3.0], [1.0, 2.0])
        with self.assertRaises(ValueError):
            spearman([1.0, 1.0, 1.0], [1.0, 2.0, 3.0])

    def test_war_calibration_recovers_linear_mapping(self) -> None:
        result = fit_war_calibration([-1.0, 0.0, 1.0], [-1.0, 2.0, 5.0])

        self.assertEqual(result.players, 3)
        self.assertAlmostEqual(result.intercept, 2.0)
        self.assertAlmostEqual(result.slope, 3.0)


class DarkoLoaderTest(unittest.TestCase):
    def test_loads_dpm_rows_and_skips_blanks(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "darko.csv"
            with path.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.writer(handle)
                writer.writerow(["NBA ID", "Player Name", "Position", "Age", "DPM"])
                writer.writerow(["1", "Nikola Jokic", "c_pos", "31.3", "7.03"])
                writer.writerow(["2", "Blank Rating", "f_pos", "25.0", ""])
            rows = load_darko_rows(path)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].player, "Nikola Jokic")
        self.assertAlmostEqual(rows[0].rating, 7.03)

    def test_empty_file_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "darko.csv"
            path.write_text("NBA ID,Player Name,Position,Age,DPM\n", encoding="utf-8")
            with self.assertRaises(ValueError):
                load_darko_rows(path)


class EpmLoaderTest(unittest.TestCase):
    def test_snapshot_round_trips_to_impact_rows(self) -> None:
        rows = [
            EPMRow("1", "Nikola Jokic", "2026-04-12", 8.1, 6.2, 1.9),
            EPMRow("2", "Bench Guy", "2026-04-10", -1.4, -0.9, -0.5),
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "epm_2026.csv"
            write_snapshot(rows, path)
            loaded = load_epm_rows(path)
        self.assertEqual(len(loaded), 2)
        self.assertEqual(loaded[0].player, "Nikola Jokic")
        self.assertAlmostEqual(loaded[0].rating, 8.1)

    def test_empty_snapshot_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "epm_2026.csv"
            path.write_text("player_id,player_name,game_dt,epm,oepm,depm\n", encoding="utf-8")
            with self.assertRaises(ValueError):
                load_epm_rows(path)


class ExternalBacktestTest(unittest.TestCase):
    def test_external_rows_score_against_realized_war(self) -> None:
        train = [impact_row(f"P{i}", i * 0.3) for i in range(12)]
        test = [impact_row(f"P{i}", 0.0, war=float(i)) for i in range(12)]
        result = backtest_external_rows("EPM", train, test, 2025, 2026)
        self.assertEqual(result.players, 12)
        self.assertAlmostEqual(result.price_spearman, 1.0)

    def test_requires_minimum_overlap(self) -> None:
        train = [impact_row("Solo", 1.0)]
        test = [impact_row("Solo", 1.0)]
        with self.assertRaises(ValueError):
            backtest_external_rows("EPM", train, test, 2025, 2026)

    def test_train_cohort_includes_next_season_washouts(self) -> None:
        train = [impact_row(f"P{i}", i * 0.3) for i in range(12)]
        test = [impact_row(f"P{i}", 0.0, war=float(i)) for i in range(2, 12)]
        result = backtest_external_rows("EPM", train, test, 2025, 2026)
        self.assertEqual(result.players, 12)


class ProjectedWarBacktestTest(unittest.TestCase):
    def test_scores_production_model_on_train_defined_cohort(self) -> None:
        train = [
            impact_row(
                f"P{i}",
                i * 0.2,
                war=float(i),
                minutes=800.0 + i * 100,
                age=35.0 - i * 0.5,
            )
            for i in range(12)
        ]
        epm = [impact_row(f"P{i}", i * 0.3) for i in range(12)]
        test = [impact_row(f"P{i}", 0.0, war=float(i)) for i in range(2, 12)]
        result = backtest_projected_war_model(train, epm, test, 2025, 2026)
        self.assertEqual(result.label, "Projected WAR FV")
        self.assertEqual(result.players, 12)
        self.assertGreater(result.price_spearman, 0.8)
        self.assertIsNotNone(result.naive_war_spearman)

    def test_validation_and_calibration_use_the_requested_listing_cohort(self) -> None:
        train = [
            impact_row(
                f"P{i}",
                i * 0.2,
                war=float(i),
                minutes=500.0 + i * 100,
                age=35.0 - i * 0.2,
            )
            for i in range(14)
        ]
        epm = [impact_row(f"P{i}", i * 0.3) for i in range(14)]
        test = [impact_row(f"P{i}", 0.0, war=float(i)) for i in range(14)]
        cohort = listing_cohort_keys(train, epm, universe_size=10)

        result = backtest_projected_war_model(
            train,
            epm,
            test,
            2025,
            2026,
            eligible_keys=cohort,
        )
        blends, realized = projected_war_calibration_rows(
            train,
            epm,
            test,
            eligible_keys=cohort,
        )

        self.assertEqual(result.players, 10)
        self.assertEqual(len(blends), 10)
        self.assertEqual(len(realized), 10)
        self.assertEqual(cohort[0], "p13")


class CompareMetricsTest(unittest.TestCase):
    def test_agreeing_metrics_have_high_rho_and_small_delta(self) -> None:
        lebron = [impact_row(f"Player {i}", float(i)) for i in range(6)]
        darko = [impact_row(f"Player {i}", float(i) + 0.1) for i in range(6)]
        result = compare_metrics(lebron, darko)
        self.assertEqual(result.joined_players, 6)
        self.assertAlmostEqual(result.rating_spearman, 1.0)
        self.assertAlmostEqual(result.price_spearman, 1.0)

    def test_disagreements_are_sorted_by_price_delta(self) -> None:
        lebron = [
            impact_row("Agree Guy", 1.0),
            impact_row("Mild Guy", 2.0),
            impact_row("Disagree Guy", 5.0),
        ]
        darko = [
            impact_row("Agree Guy", 1.0),
            impact_row("Mild Guy", 2.4),
            impact_row("Disagree Guy", -2.0),
            impact_row("Only Darko", 3.0),
        ]
        result = compare_metrics(lebron, darko)
        self.assertEqual(result.joined_players, 3)
        self.assertEqual(result.disagreements[0][0], "Disagree Guy")

    def test_too_few_shared_players_rejected(self) -> None:
        with self.assertRaises(ValueError):
            compare_metrics([impact_row("Solo", 1.0)], [impact_row("Solo", 1.0)])


class SeasonBacktestTest(unittest.TestCase):
    def test_predictive_rank_is_perfect_when_talent_persists(self) -> None:
        # Ratings stay below the level where the $70M listing cap creates ties.
        train = [impact_row(f"P{i}", i * 0.3, war=float(i)) for i in range(20)]
        test = [impact_row(f"P{i}", i * 0.3, war=float(i) * 2) for i in range(20)]
        result = backtest_season_pair({2025: train, 2026: test}, 2025, 2026)
        self.assertEqual(result.players, 20)
        self.assertAlmostEqual(result.price_spearman, 1.0)
        self.assertAlmostEqual(result.naive_war_spearman, 1.0)
        self.assertEqual(len(result.deciles), 10)
        realized = [decile[2] for decile in result.deciles]
        self.assertEqual(realized, sorted(realized, reverse=True))

    def test_requires_enough_shared_players(self) -> None:
        train = [impact_row("Only One", 1.0)]
        test = [impact_row("Only One", 1.0)]
        with self.assertRaises(ValueError):
            backtest_season_pair({2025: train, 2026: test}, 2025, 2026)

    def test_train_cohort_includes_next_season_washouts(self) -> None:
        train = [impact_row(f"P{i}", i * 0.3, war=float(i)) for i in range(20)]
        test = [impact_row(f"P{i}", i * 0.3, war=float(i)) for i in range(18)]
        result = backtest_season_pair({2025: train, 2026: test}, 2025, 2026)
        self.assertEqual(result.players, 20)

    def test_explicit_cohort_is_shared_by_metric_backtests(self) -> None:
        lebron = [impact_row(f"P{i}", i * 0.2, war=float(i)) for i in range(15)]
        epm = [impact_row(f"P{i}", i * 0.3) for i in range(2, 15)]
        test = [impact_row(f"P{i}", 0.0, war=float(i)) for i in range(15)]
        cohort = listing_cohort_keys(lebron, epm, universe_size=10)

        lebron_result = backtest_season_pair(
            {2025: lebron, 2026: test},
            2025,
            2026,
            eligible_keys=cohort,
        )
        epm_result = backtest_external_rows(
            "EPM",
            epm,
            test,
            2025,
            2026,
            eligible_keys=cohort,
        )

        self.assertEqual(lebron_result.players, 10)
        self.assertEqual(epm_result.players, 10)


if __name__ == "__main__":
    unittest.main()
