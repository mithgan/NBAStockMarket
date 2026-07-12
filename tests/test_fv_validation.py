from __future__ import annotations

import csv
import tempfile
import unittest
from pathlib import Path

from nba_stock_market.expectations import NotConfigured
from nba_stock_market.fv_validation import (
    backtest_season_pair,
    compare_metrics,
    load_darko_rows,
    load_epm_rows,
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


class EpmStubTest(unittest.TestCase):
    def test_epm_is_blocked_on_api_key(self) -> None:
        with self.assertRaises(NotConfigured):
            load_epm_rows()


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


if __name__ == "__main__":
    unittest.main()
