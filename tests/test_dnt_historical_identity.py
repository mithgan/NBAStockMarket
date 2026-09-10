from __future__ import annotations

import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

from nba_stock_market.engine import Player
from nba_stock_market.expectations import DunksAndThreesExpectation, normalize_player_name


DAY = date(2023, 10, 24)
VERIFIED_NAMES = (
    ("202710", "Jimmy Butler III", "Jimmy Butler"),
    ("1630231", "KJ Martin", "Kenyon Martin Jr."),
    ("1641854", "Craig Porter Jr.", "Craig Porter"),
    ("1641998", "Trey Jemison III", "Trey Jemison"),
    ("1642267", "Bub Carrington", "Carlton Carrington"),
    ("1642259", "Alex Sarr", "Alexandre Sarr"),
    ("1630527", "Brandon Boston Jr.", "Brandon Boston"),
    ("1641877", "Nate Mensah", "Nathan Mensah"),
    ("1642385", "Yongxi Cui", "Cui Yongxi"),
)


def projection(name: str, nba_id: str, *, points: float = 23.5) -> dict:
    return {
        "player_name": name,
        "player_id": int(nba_id),
        "game_id": 22300061,
        "p_pts": points,
        "p_orb": 1.2,
        "p_drb": 4.7,
        "p_ast": 5.4,
        "p_stl": 1.1,
        "p_blk": 0.8,
        "p_tov": 2.3,
        "p_fg2a": 10.0,
        "p_fg2m": 5.7,
        "p_fg3a": 6.5,
        "p_fg3m": 2.4,
        "p_fta": 6.1,
        "p_ftm": 4.9,
        "p_mp": 32.8,
    }


class DNTHistoricalIdentityTest(unittest.TestCase):
    def lookup(self, name: str, rows: list[dict]):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            (cache / f"{DAY}.json").write_text(json.dumps(rows), encoding="utf-8")
            source = DunksAndThreesExpectation(cache_dir=cache)
            return source.projected_box_score(Player("espn-id", name, "mid", 1.0, 1.0), DAY)

    def test_verified_historical_names_load_real_fields_in_both_directions(self):
        for nba_id, first, second in VERIFIED_NAMES:
            for query, saved in ((first, second), (second, first)):
                with self.subTest(query=query, saved=saved):
                    actual = self.lookup(query, [projection(saved, nba_id)])
                    self.assertIsNotNone(actual)
                    self.assertEqual(actual.pts, 23.5)
                    self.assertEqual(actual.three_pa, 6.5)
                    self.assertEqual(actual.fga, 16.5)
                    self.assertEqual(actual.minutes, 32.8)

    def test_exact_normalized_match_precedes_alias(self):
        actual = self.lookup("Jimmy Butler III", [
            projection("Jimmy Butler", "202710", points=99.0),
            projection("Jimmy Butler III", "202710", points=17.0),
        ])
        self.assertEqual(actual.pts, 17.0)

    def test_accents_and_punctuation_keep_existing_exact_behavior(self):
        actual = self.lookup("Nikola Jokic", [projection("Nikola Jokić", "203999")])
        self.assertEqual(actual.pts, 23.5)
        self.assertNotEqual(normalize_player_name("Jimmy Butler"), normalize_player_name("Jimmy Butler III"))

    def test_alias_requires_verified_provider_player_id(self):
        self.assertIsNone(self.lookup("Jimmy Butler III", [projection("Jimmy Butler", "999999")]))
        no_id = projection("Jimmy Butler", "202710")
        del no_id["player_id"]
        self.assertIsNone(self.lookup("Jimmy Butler III", [no_id]))

    def test_ambiguous_alias_name_raises_instead_of_selecting_a_row(self):
        with self.assertRaisesRegex(ValueError, "ambiguous"):
            self.lookup("Jimmy Butler III", [
                projection("Jimmy Butler", "202710"),
                projection("Jimmy Butler", "999999", points=88.0),
            ])

    def test_ambiguous_exact_normalized_name_raises(self):
        with self.assertRaisesRegex(ValueError, "ambiguous"):
            self.lookup("Jimmy Butler", [
                projection("Jimmy Butler", "202710"),
                projection("Jimmy-Butler", "999999", points=88.0),
            ])

    def test_unlisted_names_and_suffixes_are_not_guessed(self):
        self.assertIsNone(self.lookup("Tim Hardaway Jr.", [projection("Tim Hardaway", "896")]))
        self.assertIsNone(self.lookup("Missing Player", []))

    def test_null_exact_or_alias_forecast_remains_unavailable(self):
        for query, saved in (("Jimmy Butler", "Jimmy Butler"), ("Jimmy Butler III", "Jimmy Butler")):
            for field in ("p_pts", "p_fg3a", "p_mp"):
                with self.subTest(query=query, field=field):
                    row = projection(saved, "202710")
                    row[field] = None
                    self.assertIsNone(self.lookup(query, [row]))

    def test_malformed_forecast_is_not_replaced_with_zero(self):
        row = projection("Jimmy Butler", "202710")
        del row["p_fg3a"]
        with self.assertRaisesRegex(ValueError, "missing p_fg3a"):
            self.lookup("Jimmy Butler", [row])


if __name__ == "__main__":
    unittest.main()
