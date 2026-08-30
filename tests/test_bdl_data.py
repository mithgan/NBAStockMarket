from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from nba_stock_market.bdl_data import (
    fetch_stats_pages,
    load_cached_lines,
    parse_minutes,
    row_to_game_line,
)
from nba_stock_market.engine import BoxScoreLine, NetPointsModel


FIXTURE = Path(__file__).parent / "fixtures" / "bdl_stats_page.json"


class BDLDataTest(unittest.TestCase):
    def test_row_maps_to_box_score_line_and_game_identity(self) -> None:
        row = json.loads(FIXTURE.read_text(encoding="utf-8"))["data"][0]

        game_line = row_to_game_line(row)

        self.assertEqual(game_line.player_name, "Nikola Jokic")
        self.assertEqual(game_line.player_id, "246")
        self.assertEqual(game_line.game_id, "18447236")
        self.assertEqual(game_line.game_date.isoformat(), "2025-12-25")
        self.assertEqual(game_line.team, "DEN")
        self.assertIsInstance(game_line.box_score, BoxScoreLine)
        self.assertEqual(game_line.box_score.offensive_rebounds, 5.0)
        self.assertEqual(game_line.box_score.three_pm, 4.0)
        self.assertAlmostEqual(NetPointsModel().score(game_line.box_score), 59.35)

    def test_minutes_accepts_whole_and_clock_forms(self) -> None:
        self.assertEqual(parse_minutes("45"), 45.0)
        self.assertEqual(parse_minutes("45:30"), 45.5)

    def test_minutes_rejects_invalid_or_negative_values(self) -> None:
        for value in (True, -1, "-1", "12:60", "12:-1", "nan", "inf"):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    parse_minutes(value)

    def test_cursor_pagination_is_cached_resumable_and_idempotent(self) -> None:
        responses = [
            {"data": [{"id": 1}], "meta": {"next_cursor": 17}},
            {"data": [{"id": 2}], "meta": {"next_cursor": 29}},
            {"data": [{"id": 3}], "meta": {}},
        ]
        requested_urls: list[str] = []

        def request_json(url: str, api_key: str) -> dict[str, object]:
            self.assertEqual(api_key, "test-key")
            requested_urls.append(url)
            return responses[len(requested_urls) - 1]

        with tempfile.TemporaryDirectory() as directory:
            cache_dir = Path(directory)
            first = fetch_stats_pages(
                cache_dir,
                "test-key",
                {"seasons[]": "2025"},
                per_page=25,
                max_pages=2,
                request_json=request_json,
            )
            second = fetch_stats_pages(
                cache_dir,
                "test-key",
                {"seasons[]": "2025"},
                per_page=25,
                request_json=request_json,
            )
            third = fetch_stats_pages(
                cache_dir,
                "test-key",
                {"seasons[]": "2025"},
                per_page=25,
                request_json=request_json,
            )

            self.assertEqual(first.pages_fetched, 2)
            self.assertFalse(first.complete)
            self.assertEqual(second.pages_fetched, 1)
            self.assertTrue(second.complete)
            self.assertEqual(third.pages_fetched, 0)
            self.assertTrue(third.complete)
            self.assertNotIn("cursor=", requested_urls[0])
            self.assertIn("cursor=17", requested_urls[1])
            self.assertIn("cursor=29", requested_urls[2])
            self.assertEqual(len(list(cache_dir.glob("page-*.json"))), 3)

    def test_loader_reads_cached_page_rows(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            cache_dir = Path(directory)
            (cache_dir / "page-000001.json").write_text(
                FIXTURE.read_text(encoding="utf-8"), encoding="utf-8"
            )

            lines = load_cached_lines(cache_dir)

        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0].player_name, "Nikola Jokic")


if __name__ == "__main__":
    unittest.main()
