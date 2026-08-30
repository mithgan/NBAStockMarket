from __future__ import annotations

import copy
import json
import unittest
from dataclasses import fields, replace
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Mapping
from unittest.mock import patch

import httpx

from nba_stock_market.bdl_data import row_to_game_line
from nba_stock_market.bdl_live import (
    BDLFinalPlayerResult,
    BDLProviderGame,
    BDLSlate,
    BallDontLieHttpTransport,
    BallDontLieLiveClient,
    ProviderContractError,
    RetryableProviderError,
)
from nba_stock_market.engine import NetPointsModel


FIXTURES = Path(__file__).parent / "fixtures"
GAME_DATE = date(2026, 3, 15)
EXPECTED_PLAYER_IDS = tuple(
    str(player_id) for player_id in (*range(1001, 1006), *range(2001, 2006))
)


def fixture(name: str) -> dict[str, Any]:
    return json.loads((FIXTURES / f"bdl_live_{name}.json").read_text(encoding="utf-8"))


class QueueTransport:
    def __init__(self, responses: Mapping[str, list[object]]) -> None:
        self.responses = {path: list(values) for path, values in responses.items()}
        self.calls: list[tuple[str, dict[str, object]]] = []

    def get_json(self, path: str, params: Mapping[str, object]) -> object:
        self.calls.append((path, dict(params)))
        queued = self.responses.get(path, [])
        if not queued:
            raise AssertionError(f"unexpected provider request: {path} {params}")
        response = queued.pop(0)
        if isinstance(response, BaseException):
            raise response
        return copy.deepcopy(response)


def slate_transport() -> QueueTransport:
    return QueueTransport(
        {
            "/v1/games": [
                fixture("games_page_1"),
                fixture("games_page_2"),
            ],
            "/v1/box_scores": [fixture("box_scores_page_1")],
        }
    )


def final_game() -> BDLProviderGame:
    slate = BallDontLieLiveClient(slate_transport()).fetch_slate(GAME_DATE)
    return next(game for game in slate.games if game.game_id == "18450001")


def complete_stats_page() -> dict[str, object]:
    return {
        "data": [
            *fixture("stats_page_1")["data"],
            *fixture("stats_page_2")["data"],
        ],
        "meta": {"next_cursor": None},
    }


class BallDontLieLiveClientTest(unittest.TestCase):
    def test_empty_schedule_is_returned_for_durable_reconciliation(self) -> None:
        transport = QueueTransport(
            {
                "/v1/games": [{"data": [], "meta": {}}],
                "/v1/box_scores": [{"data": [], "meta": {}}],
            }
        )

        slate = BallDontLieLiveClient(transport).fetch_slate(GAME_DATE)

        self.assertTrue(slate.schedule_complete)
        self.assertEqual(slate.games, ())

    def test_slate_exhausts_games_and_box_scores_before_marking_complete(self) -> None:
        transport = slate_transport()

        slate = BallDontLieLiveClient(transport).fetch_slate(GAME_DATE)

        self.assertIsInstance(slate, BDLSlate)
        self.assertEqual(slate.game_date, GAME_DATE)
        self.assertTrue(slate.schedule_complete)
        self.assertEqual(
            [game.game_id for game in slate.games],
            ["18450001", "18450002"],
        )
        final, scheduled = slate.games
        self.assertEqual(final.status, "final")
        self.assertEqual(final.season_id, "2025")
        self.assertEqual(final.home_team_id, "25")
        self.assertEqual(final.away_team_id, "8")
        self.assertEqual(final.expected_player_ids, EXPECTED_PLAYER_IDS)
        self.assertEqual(
            dict(final.expected_player_names)["1001"],
            "Avery North",
        )
        self.assertIn("tipoff_at", {field.name for field in fields(final)})
        self.assertEqual(final.tipoff_at.tzinfo, timezone.utc)
        self.assertEqual(len(final.source_fingerprint), 64)
        self.assertEqual(scheduled.status, "scheduled")
        self.assertEqual(scheduled.expected_player_ids, ())
        self.assertEqual(
            transport.calls,
            [
                (
                    "/v1/games",
                    {"dates[]": "2026-03-15", "per_page": 100},
                ),
                (
                    "/v1/games",
                    {
                        "dates[]": "2026-03-15",
                        "per_page": 100,
                        "cursor": "games-2",
                    },
                ),
                (
                    "/v1/box_scores",
                    {"date": "2026-03-15"},
                ),
            ],
        )

    def test_nonfinal_games_are_rejected_without_fetching_stats(self) -> None:
        game = final_game()
        for status in ("scheduled", "in_progress", "postponed", "cancelled"):
            with self.subTest(status=status):
                transport = QueueTransport({})
                with self.assertRaisesRegex(ProviderContractError, "final"):
                    BallDontLieLiveClient(transport).fetch_final_results(
                        replace(game, status=status)
                    )
                self.assertEqual(transport.calls, [])

    def test_next_game_date_uses_complete_future_schedule_and_skips_postponed(
        self,
    ) -> None:
        transport = QueueTransport(
            {
                "/v1/games": [
                    {
                        "data": [
                            {
                                "id": 1,
                                "date": "2026-03-16",
                                "status": "Postponed",
                                "status_state": "postponed",
                                "period": 0,
                                "postponed": True,
                            },
                            {
                                "id": 2,
                                "date": "2026-03-18",
                                "status": "7:00 PM ET",
                                "status_state": "scheduled",
                                "period": 0,
                                "postponed": False,
                            },
                        ],
                        "meta": {"next_cursor": "future-2"},
                    },
                    {
                        "data": [
                            {
                                "id": 3,
                                "date": "2026-03-17",
                                "status": "8:00 PM ET",
                                "status_state": "scheduled",
                                "period": 0,
                                "postponed": False,
                            }
                        ],
                        "meta": {"next_cursor": None},
                    },
                ]
            }
        )

        next_date = BallDontLieLiveClient(transport).fetch_next_game_date(GAME_DATE)

        self.assertEqual(next_date, date(2026, 3, 17))
        self.assertEqual(
            transport.calls,
            [
                (
                    "/v1/games",
                    {
                        "start_date": "2026-03-16",
                        "end_date": "2026-04-29",
                        "per_page": 100,
                    },
                ),
                (
                    "/v1/games",
                    {
                        "start_date": "2026-03-16",
                        "end_date": "2026-04-29",
                        "per_page": 100,
                        "cursor": "future-2",
                    },
                ),
            ],
        )

    def test_http_transport_classifies_retryable_and_permanent_responses(self) -> None:
        retry_client = httpx.Client(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    429,
                    headers={"Retry-After": "4"},
                    request=request,
                )
            )
        )
        retry_transport = BallDontLieHttpTransport(
            "test-key",
            client=retry_client,
        )
        with self.assertRaises(RetryableProviderError) as retry_context:
            retry_transport.get_json("/v1/games", {})
        self.assertEqual(retry_context.exception.retry_after_seconds, 4.0)

        timeout_client = httpx.Client(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(408, request=request)
            )
        )
        timeout_transport = BallDontLieHttpTransport(
            "test-key",
            client=timeout_client,
        )
        with self.assertRaisesRegex(RetryableProviderError, "HTTP 408"):
            timeout_transport.get_json("/v1/games", {})

        too_early_client = httpx.Client(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(425, request=request)
            )
        )
        too_early_transport = BallDontLieHttpTransport(
            "test-key",
            client=too_early_client,
        )
        with self.assertRaisesRegex(RetryableProviderError, "HTTP 425"):
            too_early_transport.get_json("/v1/games", {})

        permanent_client = httpx.Client(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(401, request=request)
            )
        )
        permanent_transport = BallDontLieHttpTransport(
            "test-key",
            client=permanent_client,
        )
        with self.assertRaisesRegex(ProviderContractError, "HTTP 401"):
            permanent_transport.get_json("/v1/games", {})

        for error_type in (httpx.RemoteProtocolError, httpx.ProxyError):
            with self.subTest(error_type=error_type.__name__):

                def raise_transient(request: httpx.Request) -> httpx.Response:
                    raise error_type("transient transport failure", request=request)

                transient_client = httpx.Client(
                    transport=httpx.MockTransport(raise_transient)
                )
                transient_transport = BallDontLieHttpTransport(
                    "test-key",
                    client=transient_client,
                )
                with self.assertRaisesRegex(
                    RetryableProviderError,
                    error_type.__name__,
                ):
                    transient_transport.get_json("/v1/games", {})
                transient_client.close()

        def raise_configuration_error(request: httpx.Request) -> httpx.Response:
            raise httpx.UnsupportedProtocol(
                "invalid provider URL",
                request=request,
            )

        configuration_client = httpx.Client(
            transport=httpx.MockTransport(raise_configuration_error)
        )
        configuration_transport = BallDontLieHttpTransport(
            "test-key",
            client=configuration_client,
        )
        with self.assertRaisesRegex(ProviderContractError, "configuration"):
            configuration_transport.get_json("/v1/games", {})

        retry_client.close()
        timeout_client.close()
        too_early_client.close()
        permanent_client.close()
        configuration_client.close()

    def test_final_results_use_canonical_mapper_after_exhausting_pages(self) -> None:
        transport = QueueTransport(
            {
                "/v1/stats": [
                    fixture("stats_page_1"),
                    fixture("stats_page_2"),
                ]
            }
        )
        client = BallDontLieLiveClient(transport)

        with patch(
            "nba_stock_market.bdl_live.row_to_game_line",
            wraps=row_to_game_line,
        ) as mapper:
            results = client.fetch_final_results(final_game())

        self.assertEqual(mapper.call_count, 10)
        self.assertTrue(
            all(isinstance(result, BDLFinalPlayerResult) for result in results)
        )
        self.assertEqual(
            [result.player_id for result in results],
            list(EXPECTED_PLAYER_IDS),
        )
        expected_rows = {
            str(row["player"]["id"]): row
            for page in (fixture("stats_page_1"), fixture("stats_page_2"))
            for row in page["data"]
        }
        for result in results:
            expected_line = row_to_game_line(expected_rows[result.player_id])
            self.assertEqual(result.game_line, expected_line)
            self.assertAlmostEqual(
                result.raw_net_points,
                NetPointsModel().score(expected_line.box_score),
            )
            self.assertEqual(len(result.scoring_fingerprint), 64)
        self.assertEqual(
            transport.calls,
            [
                (
                    "/v1/stats",
                    {
                        "game_ids[]": [18450001],
                        "period": 0,
                        "per_page": 100,
                    },
                ),
                (
                    "/v1/stats",
                    {
                        "game_ids[]": [18450001],
                        "period": 0,
                        "per_page": 100,
                        "cursor": "stats-2",
                    },
                ),
            ],
        )

    def test_fingerprint_ignores_metadata_and_numeric_representation(self) -> None:
        baseline = complete_stats_page()
        metadata_only = copy.deepcopy(baseline)
        metadata_only["data"][0]["id"] = 9901
        metadata_only["data"][0]["team"]["abbreviation"] = "NEW"
        metadata_only["data"][0]["pts"] = 20.0
        metadata_only["data"][0]["min"] = "48"
        fingerprints: list[str] = []
        for page in (baseline, metadata_only):
            result = BallDontLieLiveClient(
                QueueTransport({"/v1/stats": [page]})
            ).fetch_final_results(final_game())[0]
            fingerprints.append(result.scoring_fingerprint)

        self.assertEqual(fingerprints[0], fingerprints[1])

    def test_final_stats_must_exactly_match_nested_expected_players(self) -> None:
        missing = fixture("stats_page_1")
        missing["meta"] = {}
        with self.assertRaisesRegex(RetryableProviderError, "missing"):
            BallDontLieLiveClient(
                QueueTransport({"/v1/stats": [missing]})
            ).fetch_final_results(final_game())

        unexpected = complete_stats_page()
        extra = copy.deepcopy(unexpected["data"][0])
        extra["id"] = 9999
        extra["player"] = {
            "id": 3001,
            "first_name": "Casey",
            "last_name": "Extra",
        }
        unexpected["data"].append(extra)
        with self.assertRaisesRegex(ProviderContractError, "unexpected"):
            BallDontLieLiveClient(
                QueueTransport({"/v1/stats": [unexpected]})
            ).fetch_final_results(final_game())

        mismatched_identity = complete_stats_page()
        mismatched_identity["data"][0]["player"]["first_name"] = "Wrong"
        mismatched_identity["data"][0]["player"]["last_name"] = "Player"
        with self.assertRaisesRegex(RetryableProviderError, "identity"):
            BallDontLieLiveClient(
                QueueTransport({"/v1/stats": [mismatched_identity]})
            ).fetch_final_results(final_game())

        mismatched_scoring = complete_stats_page()
        mismatched_scoring["data"][0]["pts"] = 21
        mismatched_scoring["data"][0]["ftm"] = 3
        mismatched_scoring["data"][0]["fta"] = 3
        with self.assertRaisesRegex(RetryableProviderError, "final box score"):
            BallDontLieLiveClient(
                QueueTransport({"/v1/stats": [mismatched_scoring]})
            ).fetch_final_results(final_game())

    def test_final_stats_reject_identity_finality_and_semantic_violations(self) -> None:
        cases: list[tuple[str, dict[str, object]]] = []

        wrong_game = complete_stats_page()
        wrong_game["data"][0]["game"]["id"] = 999
        cases.append(("wrong game", wrong_game))

        wrong_date = complete_stats_page()
        wrong_date["data"][0]["game"]["date"] = "2026-03-16"
        cases.append(("wrong date", wrong_date))

        wrong_team = complete_stats_page()
        wrong_team["data"][0]["team"]["id"] = 999
        cases.append(("wrong team", wrong_team))

        not_final = complete_stats_page()
        not_final["data"][0]["game"]["status_state"] = "in_progress"
        cases.append(("non-final row", not_final))

        duplicate_stat = complete_stats_page()
        duplicate_stat["data"][1]["id"] = 9001
        cases.append(("duplicate stat", duplicate_stat))

        duplicate_player = complete_stats_page()
        duplicate_player["data"][1]["player"]["id"] = 1001
        cases.append(("duplicate player", duplicate_player))

        negative = complete_stats_page()
        negative["data"][0]["pts"] = -1
        cases.append(("negative stat", negative))

        oversized = complete_stats_page()
        oversized["data"][0]["pts"] = 501
        cases.append(("oversized stat", oversized))

        fractional = complete_stats_page()
        fractional["data"][0]["ast"] = 3.25
        cases.append(("fractional counting stat", fractional))

        long_minutes = complete_stats_page()
        long_minutes["data"][0]["min"] = "100:01"
        cases.append(("minutes", long_minutes))

        makes = complete_stats_page()
        makes["data"][0]["fgm"] = 16
        cases.append(("makes over attempts", makes))

        threes = complete_stats_page()
        threes["data"][0]["fg3a"] = 16
        cases.append(("threes over field goals", threes))

        impossible_points = complete_stats_page()
        impossible_points["data"][0]["pts"] = 200
        cases.append(("points disagree with made shots", impossible_points))

        for label, page in cases:
            with self.subTest(label=label):
                with self.assertRaises(ProviderContractError):
                    BallDontLieLiveClient(
                        QueueTransport({"/v1/stats": [page]})
                    ).fetch_final_results(final_game())

    def test_schedule_requires_players_and_matching_teams(self) -> None:
        missing_players = fixture("box_scores_page_1")
        del missing_players["data"][0]["home_team"]["players"]
        missing_players["meta"] = {}
        with self.assertRaises(RetryableProviderError):
            BallDontLieLiveClient(
                QueueTransport(
                    {
                        "/v1/games": [
                            fixture("games_page_1"),
                            fixture("games_page_2"),
                        ],
                        "/v1/box_scores": [missing_players],
                    }
                )
            ).fetch_slate(GAME_DATE)

        empty_team = fixture("box_scores_page_1")
        empty_team["data"][0]["visitor_team"]["players"] = []
        empty_team["meta"] = {}
        with self.assertRaisesRegex(RetryableProviderError, "visitor players"):
            BallDontLieLiveClient(
                QueueTransport(
                    {
                        "/v1/games": [
                            fixture("games_page_1"),
                            fixture("games_page_2"),
                        ],
                        "/v1/box_scores": [empty_team],
                    }
                )
            ).fetch_slate(GAME_DATE)

        incomplete_manifest = fixture("box_scores_page_1")
        incomplete_manifest["data"][0]["home_team"]["players"] = incomplete_manifest[
            "data"
        ][0]["home_team"]["players"][:4]
        with self.assertRaisesRegex(RetryableProviderError, "incomplete.*manifest"):
            BallDontLieLiveClient(
                QueueTransport(
                    {
                        "/v1/games": [
                            fixture("games_page_1"),
                            fixture("games_page_2"),
                        ],
                        "/v1/box_scores": [incomplete_manifest],
                    }
                )
            ).fetch_slate(GAME_DATE)

        point_mismatch = fixture("box_scores_page_1")
        point_mismatch["data"][0]["home_team_score"] = 109
        with self.assertRaisesRegex(RetryableProviderError, "points.*team score"):
            BallDontLieLiveClient(
                QueueTransport(
                    {
                        "/v1/games": [
                            fixture("games_page_1"),
                            fixture("games_page_2"),
                        ],
                        "/v1/box_scores": [point_mismatch],
                    }
                )
            ).fetch_slate(GAME_DATE)

        rounded_minutes = fixture("box_scores_page_1")
        home_players = rounded_minutes["data"][0]["home_team"]["players"]
        for player in home_players:
            player["min"] = "48"
        home_players[0]["min"] = "47"
        rounded_slate = BallDontLieLiveClient(
            QueueTransport(
                {
                    "/v1/games": [
                        fixture("games_page_1"),
                        fixture("games_page_2"),
                    ],
                    "/v1/box_scores": [rounded_minutes],
                }
            )
        ).fetch_slate(GAME_DATE)
        self.assertEqual(
            rounded_slate.games[0].expected_player_ids, EXPECTED_PLAYER_IDS
        )

        minute_mismatch = fixture("box_scores_page_1")
        minute_mismatch["data"][0]["visitor_team"]["players"][0]["min"] = "40:00"
        with self.assertRaisesRegex(RetryableProviderError, "minutes.*incomplete"):
            BallDontLieLiveClient(
                QueueTransport(
                    {
                        "/v1/games": [
                            fixture("games_page_1"),
                            fixture("games_page_2"),
                        ],
                        "/v1/box_scores": [minute_mismatch],
                    }
                )
            ).fetch_slate(GAME_DATE)

        wrong_team = fixture("box_scores_page_1")
        wrong_team["data"][0]["home_team"]["id"] = 999
        with self.assertRaisesRegex(ProviderContractError, "team"):
            BallDontLieLiveClient(
                QueueTransport(
                    {
                        "/v1/games": [
                            fixture("games_page_1"),
                            fixture("games_page_2"),
                        ],
                        "/v1/box_scores": [wrong_team],
                    }
                )
            ).fetch_slate(GAME_DATE)

    def test_schedule_rejects_duplicate_provider_identities(self) -> None:
        duplicate_game = fixture("games_page_1")
        duplicate_game["data"].append(copy.deepcopy(duplicate_game["data"][0]))
        duplicate_game["meta"] = {}
        with self.assertRaisesRegex(ProviderContractError, "duplicate.*schedule"):
            BallDontLieLiveClient(
                QueueTransport(
                    {
                        "/v1/games": [duplicate_game],
                        "/v1/box_scores": [{"data": [], "meta": {}}],
                    }
                )
            ).fetch_slate(GAME_DATE)

        duplicate_box = fixture("box_scores_page_1")
        duplicate_box["data"].append(copy.deepcopy(duplicate_box["data"][0]))
        games = fixture("games_page_1")
        games["meta"] = {}
        with self.assertRaisesRegex(ProviderContractError, "duplicate.*box-score"):
            BallDontLieLiveClient(
                QueueTransport(
                    {
                        "/v1/games": [games],
                        "/v1/box_scores": [duplicate_box],
                    }
                )
            ).fetch_slate(GAME_DATE)

        duplicate_player = fixture("box_scores_page_1")
        duplicate_player["data"][0]["visitor_team"]["players"][0]["player"]["id"] = 1001
        duplicate_player["meta"] = {}
        with self.assertRaisesRegex(ProviderContractError, "duplicate.*player"):
            BallDontLieLiveClient(
                QueueTransport(
                    {
                        "/v1/games": [games],
                        "/v1/box_scores": [duplicate_player],
                    }
                )
            ).fetch_slate(GAME_DATE)

    def test_unknown_box_identity_is_not_masked_by_a_missing_final_box(self) -> None:
        games = fixture("games_page_1")
        games["meta"] = {}
        unknown_box = fixture("box_scores_page_1")
        unknown_box["data"][0]["id"] = 99999999

        with self.assertRaisesRegex(ProviderContractError, "unknown game"):
            BallDontLieLiveClient(
                QueueTransport(
                    {
                        "/v1/games": [games],
                        "/v1/box_scores": [unknown_box],
                    }
                )
            ).fetch_slate(GAME_DATE)

    def test_slate_uses_authoritative_status_state_fail_closed(self) -> None:
        cases = (
            ("scheduled", "scheduled"),
            ("in_progress", "in_progress"),
            ("postponed", "postponed"),
            ("canceled", "cancelled"),
            ("delayed", "in_progress"),
            ("suspended", "in_progress"),
            ("abandoned", "cancelled"),
        )
        for status_state, expected_status in cases:
            with self.subTest(status_state=status_state):
                games = fixture("games_page_1")
                games["meta"] = {}
                box_scores = fixture("box_scores_page_1")
                box = box_scores["data"][0]
                box["status_state"] = status_state

                slate = BallDontLieLiveClient(
                    QueueTransport(
                        {
                            "/v1/games": [games],
                            "/v1/box_scores": [box_scores],
                        }
                    )
                ).fetch_slate(GAME_DATE)

                self.assertEqual(slate.games[0].status, expected_status)
                self.assertEqual(slate.games[0].expected_player_ids, ())

    def test_nullable_tipoff_is_allowed_only_for_nonsettling_terminal_games(
        self,
    ) -> None:
        postponed_games = fixture("games_page_2")
        postponed = postponed_games["data"][0]
        postponed["datetime"] = None
        postponed["status"] = "Postponed"
        postponed["status_state"] = "postponed"
        postponed["postponed"] = True

        slate = BallDontLieLiveClient(
            QueueTransport(
                {
                    "/v1/games": [
                        fixture("games_page_1"),
                        postponed_games,
                    ],
                    "/v1/box_scores": [fixture("box_scores_page_1")],
                }
            )
        ).fetch_slate(GAME_DATE)

        diagnostic = next(game for game in slate.games if game.game_id == "18450002")
        self.assertEqual(diagnostic.status, "postponed")
        self.assertFalse(diagnostic.tipoff_known)
        self.assertEqual(
            diagnostic.tipoff_at,
            datetime(2026, 3, 15, tzinfo=timezone.utc),
        )
        self.assertEqual(diagnostic.expected_player_ids, ())

        scheduled_games = fixture("games_page_2")
        scheduled_games["data"][0]["datetime"] = None
        with self.assertRaisesRegex(RetryableProviderError, "no tipoff timestamp"):
            BallDontLieLiveClient(
                QueueTransport(
                    {
                        "/v1/games": [
                            fixture("games_page_1"),
                            scheduled_games,
                        ],
                        "/v1/box_scores": [fixture("box_scores_page_1")],
                    }
                )
            ).fetch_slate(GAME_DATE)

    def test_status_state_overrides_contradictory_legacy_fields(self) -> None:
        games = fixture("games_page_1")
        games["meta"] = {}
        box_scores = fixture("box_scores_page_1")
        box = box_scores["data"][0]
        box["status"] = "Final"
        box["period"] = 4
        box["postponed"] = False
        box["status_state"] = "scheduled"

        slate = BallDontLieLiveClient(
            QueueTransport(
                {
                    "/v1/games": [games],
                    "/v1/box_scores": [box_scores],
                }
            )
        ).fetch_slate(GAME_DATE)

        self.assertEqual(slate.games[0].status, "scheduled")
        self.assertEqual(slate.games[0].expected_player_ids, ())

    def test_unknown_or_missing_status_state_never_settles_money(self) -> None:
        for status_state, error_type, message in (
            ("unknown", RetryableProviderError, "unknown"),
            ("future_state", ProviderContractError, "unsupported"),
            (None, ProviderContractError, "required"),
        ):
            with self.subTest(status_state=status_state):
                games = fixture("games_page_1")
                games["meta"] = {}
                box_scores = fixture("box_scores_page_1")
                box = box_scores["data"][0]
                if status_state is None:
                    del box["status_state"]
                else:
                    box["status_state"] = status_state

                with self.assertRaisesRegex(error_type, message):
                    BallDontLieLiveClient(
                        QueueTransport(
                            {
                                "/v1/games": [games],
                                "/v1/box_scores": [box_scores],
                            }
                        )
                    ).fetch_slate(GAME_DATE)

    def test_documented_idless_box_score_matches_one_game_by_team_identity(
        self,
    ) -> None:
        box_scores = fixture("box_scores_page_1")
        del box_scores["data"][0]["id"]

        slate = BallDontLieLiveClient(
            QueueTransport(
                {
                    "/v1/games": [
                        fixture("games_page_1"),
                        fixture("games_page_2"),
                    ],
                    "/v1/box_scores": [box_scores],
                }
            )
        ).fetch_slate(GAME_DATE)

        self.assertEqual(slate.games[0].game_id, "18450001")
        self.assertEqual(slate.games[0].status, "final")

    def test_idless_box_score_rejects_missing_or_ambiguous_team_match(self) -> None:
        missing = fixture("box_scores_page_1")
        del missing["data"][0]["id"]
        missing["data"][0]["home_team"]["id"] = 999
        with self.assertRaisesRegex(ProviderContractError, "exactly one"):
            BallDontLieLiveClient(
                QueueTransport(
                    {
                        "/v1/games": [
                            fixture("games_page_1"),
                            fixture("games_page_2"),
                        ],
                        "/v1/box_scores": [missing],
                    }
                )
            ).fetch_slate(GAME_DATE)

        ambiguous_games = fixture("games_page_1")
        duplicate = copy.deepcopy(ambiguous_games["data"][0])
        duplicate["id"] = 18450003
        ambiguous_games["data"].append(duplicate)
        ambiguous_games["meta"] = {}
        ambiguous = fixture("box_scores_page_1")
        del ambiguous["data"][0]["id"]
        with self.assertRaisesRegex(ProviderContractError, "exactly one"):
            BallDontLieLiveClient(
                QueueTransport(
                    {
                        "/v1/games": [ambiguous_games],
                        "/v1/box_scores": [ambiguous],
                    }
                )
            ).fetch_slate(GAME_DATE)

    def test_box_scores_are_unpaginated_and_do_not_require_meta(self) -> None:
        slate = BallDontLieLiveClient(slate_transport()).fetch_slate(GAME_DATE)
        self.assertEqual(len(slate.games), 2)

        paginated = fixture("box_scores_page_1")
        paginated["meta"] = {"next_cursor": "unexpected"}
        with self.assertRaisesRegex(ProviderContractError, "unexpectedly.*cursor"):
            BallDontLieLiveClient(
                QueueTransport(
                    {
                        "/v1/games": [
                            fixture("games_page_1"),
                            fixture("games_page_2"),
                        ],
                        "/v1/box_scores": [paginated],
                    }
                )
            ).fetch_slate(GAME_DATE)

    def test_schedule_and_stats_reject_malformed_or_unbounded_pagination(self) -> None:
        missing_meta = fixture("games_page_1")
        del missing_meta["meta"]
        with self.assertRaisesRegex(ProviderContractError, "meta"):
            BallDontLieLiveClient(
                QueueTransport({"/v1/games": [missing_meta]})
            ).fetch_slate(GAME_DATE)

        repeated_first = fixture("games_page_1")
        repeated_first["meta"]["next_cursor"] = "repeat"
        repeated_second = fixture("games_page_2")
        repeated_second["meta"]["next_cursor"] = "repeat"
        with self.assertRaisesRegex(ProviderContractError, "cursor"):
            BallDontLieLiveClient(
                QueueTransport({"/v1/games": [repeated_first, repeated_second]})
            ).fetch_slate(GAME_DATE)

        oversized = {"data": [{} for _ in range(501)], "meta": {}}
        with self.assertRaisesRegex(ProviderContractError, "row limit"):
            BallDontLieLiveClient(
                QueueTransport({"/v1/games": [oversized]})
            ).fetch_slate(GAME_DATE)

        stats_first = fixture("stats_page_1")
        stats_first["meta"]["next_cursor"] = "repeat"
        stats_second = fixture("stats_page_2")
        stats_second["meta"]["next_cursor"] = "repeat"
        with self.assertRaisesRegex(ProviderContractError, "cursor"):
            BallDontLieLiveClient(
                QueueTransport({"/v1/stats": [stats_first, stats_second]})
            ).fetch_final_results(final_game())

        with self.assertRaisesRegex(RetryableProviderError, "page limit"):
            BallDontLieLiveClient(
                QueueTransport({"/v1/stats": [fixture("stats_page_1")]}),
                max_pages=1,
            ).fetch_final_results(final_game())

        with self.assertRaisesRegex(ProviderContractError, "row limit"):
            BallDontLieLiveClient(
                QueueTransport(
                    {"/v1/stats": [{"data": [{} for _ in range(501)], "meta": {}}]}
                )
            ).fetch_final_results(final_game())

    def test_empty_final_stats_remain_retryable(self) -> None:
        with self.assertRaisesRegex(RetryableProviderError, "not available"):
            BallDontLieLiveClient(
                QueueTransport({"/v1/stats": [{"data": [], "meta": {}}]})
            ).fetch_final_results(final_game())

    def test_transport_timeouts_are_retryable(self) -> None:
        with self.assertRaisesRegex(RetryableProviderError, "transport"):
            BallDontLieLiveClient(
                QueueTransport({"/v1/games": [TimeoutError("timed out")]})
            ).fetch_slate(GAME_DATE)


if __name__ == "__main__":
    unittest.main()
