from __future__ import annotations

import csv
import tempfile
import unittest
from pathlib import Path

from nba_stock_market.opening_prices import (
    ImpactRow,
    OpeningPriceModel,
    build_opening_listings,
    load_impact_rows,
    load_salaries,
    tier_for_price,
    write_listings_csv,
)


def impact_row(
    player: str,
    rating: float,
    minutes: float = 2000.0,
    **overrides: object,
) -> ImpactRow:
    values = {
        "player": player,
        "team": "TST",
        "position": "SF",
        "age": 25.0,
        "minutes": minutes,
        "games": 70.0,
        "rating": rating,
        "war": 5.0,
    }
    values.update(overrides)
    return ImpactRow(**values)  # type: ignore[arg-type]


class OpeningPriceModelTest(unittest.TestCase):
    def test_zero_rating_full_sample_lists_at_baseline(self) -> None:
        model = OpeningPriceModel(shrinkage_minutes=0.0)
        self.assertAlmostEqual(model.impact_implied_price(0.0, 2000.0), 12_000_000.0)

    def test_every_tenth_of_a_point_adds_seven_hundred_thousand(self) -> None:
        model = OpeningPriceModel(shrinkage_minutes=0.0)
        base = model.impact_implied_price(0.0, 2000.0)
        self.assertAlmostEqual(model.impact_implied_price(0.1, 2000.0) - base, 700_000.0)

    def test_shrinkage_pulls_small_samples_toward_baseline(self) -> None:
        model = OpeningPriceModel()
        small_sample = model.impact_implied_price(4.0, 150.0)
        large_sample = model.impact_implied_price(4.0, 2400.0)
        self.assertLess(small_sample, large_sample)
        self.assertGreater(small_sample, model.impact_implied_price(0.0, 150.0))

    def test_blend_mixes_implied_and_actual_salary(self) -> None:
        model = OpeningPriceModel(shrinkage_minutes=0.0, impact_blend_weight=0.7)
        # implied = 12M + 7M*4 = 40M, salary = 10M -> 0.7*40 + 0.3*10 = 31M
        self.assertAlmostEqual(
            model.opening_price(4.0, 2000.0, 10_000_000.0), 31_000_000.0
        )

    def test_missing_salary_falls_back_to_impact_only(self) -> None:
        model = OpeningPriceModel(shrinkage_minutes=0.0)
        self.assertAlmostEqual(
            model.opening_price(4.0, 2000.0, None),
            model.impact_implied_price(4.0, 2000.0),
        )

    def test_floor_and_cap_are_enforced(self) -> None:
        model = OpeningPriceModel(shrinkage_minutes=0.0)
        self.assertEqual(model.opening_price(-5.0, 2000.0, None), 2_000_000.0)
        self.assertEqual(model.opening_price(12.0, 2000.0, None), 70_000_000.0)

    def test_invalid_parameters_are_rejected(self) -> None:
        with self.assertRaises(ValueError):
            OpeningPriceModel(impact_blend_weight=1.5)
        with self.assertRaises(ValueError):
            OpeningPriceModel(shrinkage_minutes=-1.0)
        with self.assertRaises(ValueError):
            OpeningPriceModel(min_listing_price=5.0, max_listing_price=1.0)

    def test_tiers_match_engine_thresholds(self) -> None:
        self.assertEqual(tier_for_price(45_000_000.0), "star")
        self.assertEqual(tier_for_price(15_000_000.0), "mid")
        self.assertEqual(tier_for_price(3_000_000.0), "bench")


class OpeningListingBuildTest(unittest.TestCase):
    def test_universe_is_selected_by_minutes_and_ranked_by_price(self) -> None:
        rows = [
            impact_row("Star Player", 6.0, minutes=2400.0),
            impact_row("Mid Player", 1.0, minutes=2200.0),
            impact_row("Fringe Player", 0.0, minutes=100.0),
        ]
        listings = build_opening_listings(rows, {}, universe_size=2)
        self.assertEqual([listing.player for listing in listings], ["Star Player", "Mid Player"])
        self.assertEqual([listing.rank for listing in listings], [1, 2])
        self.assertGreater(listings[0].opening_price, listings[1].opening_price)

    def test_salary_lookup_is_name_normalized(self) -> None:
        rows = [impact_row("nikola jokic", 7.0)]
        listings = build_opening_listings(rows, {"nikolajokic": 55_000_000.0})
        self.assertEqual(listings[0].actual_salary, 55_000_000.0)
        low = min(listings[0].impact_implied_price, 55_000_000.0)
        high = max(listings[0].impact_implied_price, 55_000_000.0)
        self.assertTrue(low < listings[0].opening_price < high)

    def test_rejects_non_positive_universe(self) -> None:
        with self.assertRaises(ValueError):
            build_opening_listings([impact_row("Anyone", 0.0)], {}, universe_size=0)


class OpeningPriceIoTest(unittest.TestCase):
    def test_load_impact_rows_filters_season_and_keeps_biggest_minutes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "impact.csv"
            with path.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.writer(handle)
                writer.writerow(
                    ["Season", "Player", "team", "Minutes", "Pos", "WAR", "LEBRON", "year", "Games", "Age"]
                )
                writer.writerow(["2024-25", "Old Season", "AAA", "2000", "PG", "3", "2.0", "2025", "70", "27"])
                writer.writerow(["2025-26", "Traded Guy", "AAA", "800", "PG", "1", "1.0", "2026", "30", "27"])
                writer.writerow(["2025-26", "Traded Guy", "BBB", "1200", "PG", "2", "2.0", "2026", "40", "27"])
                writer.writerow(["2025-26", "No Rating", "CCC", "900", "C", "1", "", "2026", "35", "24"])
            rows = load_impact_rows(path, season_year=2026)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].player, "Traded Guy")
        self.assertEqual(rows[0].minutes, 1200.0)

    def test_load_salaries_prefers_next_season_with_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "salary.csv"
            with path.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.writer(handle)
                writer.writerow(["Player", "2025-26", "2026-27"])
                writer.writerow(["Has Next", "10000000", "12000000"])
                writer.writerow(["Expiring", "9000000", "0.0"])
                writer.writerow(["Dead Cap", "5000000", "5000000"])
            salaries = load_salaries(path)
        self.assertEqual(salaries["hasnext"], 12_000_000.0)
        self.assertEqual(salaries["expiring"], 9_000_000.0)
        self.assertNotIn("deadcap", salaries)

    def test_written_csv_round_trips(self) -> None:
        rows = [impact_row("Round Trip", 2.0)]
        listings = build_opening_listings(rows, {"roundtrip": 20_000_000.0})
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "out" / "listings.csv"
            write_listings_csv(listings, path)
            with path.open(encoding="utf-8", newline="") as handle:
                written = list(csv.DictReader(handle))
        self.assertEqual(len(written), 1)
        self.assertEqual(written[0]["player"], "Round Trip")
        self.assertEqual(written[0]["tier"], listings[0].tier)


if __name__ == "__main__":
    unittest.main()
