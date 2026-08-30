from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Protocol

import httpx

from nba_stock_market.bdl_data import BDLGameLine, parse_minutes, row_to_game_line
from nba_stock_market.engine import NetPointsModel
from nba_stock_market.live_settlement import RetryableSettlementProviderError


BDL_GAMES_PATH = "/v1/games"
BDL_BOX_SCORES_PATH = "/v1/box_scores"
BDL_STATS_PATH = "/v1/stats"
BDL_API_BASE_URL = "https://api.balldontlie.io"
BDL_PAGE_SIZE = 100
BDL_MAX_PAGES = 5
BDL_MAX_ROWS = 500
BDL_MIN_FINAL_TEAM_PLAYERS = 5
BDL_REGULATION_TEAM_MINUTES = 240.0
BDL_OVERTIME_TEAM_MINUTES = 25.0
BDL_TEAM_MINUTES_EPSILON = 1e-6

FINAL_STAT_FIELDS = (
    "pts",
    "oreb",
    "dreb",
    "ast",
    "stl",
    "blk",
    "turnover",
    "fga",
    "fgm",
    "fg3a",
    "fg3m",
    "fta",
    "ftm",
)
NORMALIZED_SCORING_FIELDS = (
    "pts",
    "offensive_rebounds",
    "defensive_rebounds",
    "ast",
    "stl",
    "blk",
    "tov",
    "fga",
    "fgm",
    "three_pa",
    "three_pm",
    "fta",
    "ftm",
    "minutes",
)
FINAL_STAT_TO_NORMALIZED = {
    "pts": "pts",
    "oreb": "offensive_rebounds",
    "dreb": "defensive_rebounds",
    "ast": "ast",
    "stl": "stl",
    "blk": "blk",
    "turnover": "tov",
    "fga": "fga",
    "fgm": "fgm",
    "fg3a": "three_pa",
    "fg3m": "three_pm",
    "fta": "fta",
    "ftm": "ftm",
}
FINAL_STATUSES = frozenset({"final"})
NORMALIZED_STATUSES = frozenset(
    {"scheduled", "in_progress", "final", "postponed", "cancelled"}
)
NON_SETTLING_TERMINAL_STATUSES = frozenset({"postponed", "cancelled"})
STATUS_STATE_MAP = {
    "scheduled": "scheduled",
    "in_progress": "in_progress",
    "final": "final",
    "postponed": "postponed",
    "canceled": "cancelled",
    "delayed": "in_progress",
    "suspended": "in_progress",
    "abandoned": "cancelled",
}


class ProviderContractError(RuntimeError, ValueError):
    """A successful provider response violated a money-affecting contract."""


class RetryableProviderError(RetryableSettlementProviderError):
    """Provider data or transport is temporarily unavailable or incomplete."""

    def __init__(
        self,
        message: str,
        *,
        retry_after_seconds: float | None = None,
    ) -> None:
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds


class BDLJSONTransport(Protocol):
    def get_json(self, path: str, params: Mapping[str, object]) -> object: ...


Transport = BDLJSONTransport | Callable[[str, Mapping[str, object]], object]


class BallDontLieHttpTransport:
    """Small fail-closed HTTP adapter; scheduler retries happen outside it."""

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = BDL_API_BASE_URL,
        timeout_seconds: float = 10.0,
        client: httpx.Client | None = None,
    ) -> None:
        if not isinstance(api_key, str) or not api_key.strip():
            raise ValueError("BALL_DONT_LIE_API_KEY is required")
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")
        self._api_key = api_key.strip()
        self._base_url = base_url.rstrip("/")
        self._timeout_seconds = timeout_seconds
        self._client = client or httpx.Client()
        self._owns_client = client is None

    def get_json(self, path: str, params: Mapping[str, object]) -> object:
        try:
            response = self._client.get(
                f"{self._base_url}{path}",
                params=params,
                headers={
                    "Authorization": self._api_key,
                    "Accept": "application/json",
                    "User-Agent": "nba-stock-market/0.1",
                },
                timeout=self._timeout_seconds,
            )
        except (
            httpx.TimeoutException,
            httpx.NetworkError,
            httpx.ProxyError,
            httpx.RemoteProtocolError,
        ) as exc:
            raise RetryableProviderError(
                f"BDL transport failed: {type(exc).__name__}"
            ) from exc
        except httpx.TransportError as exc:
            raise ProviderContractError(
                f"BDL transport configuration failed: {type(exc).__name__}"
            ) from exc
        if response.status_code in {408, 425, 429} or response.status_code >= 500:
            retry_after = response.headers.get("Retry-After")
            try:
                delay = float(retry_after) if retry_after is not None else None
            except ValueError:
                delay = None
            raise RetryableProviderError(
                f"BDL returned retryable HTTP {response.status_code}",
                retry_after_seconds=delay,
            )
        if response.status_code < 200 or response.status_code >= 300:
            raise ProviderContractError(
                f"BDL returned non-retryable HTTP {response.status_code}"
            )
        try:
            return response.json()
        except ValueError as exc:
            raise ProviderContractError("BDL response was not valid JSON") from exc

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def __enter__(self) -> BallDontLieHttpTransport:
        return self

    def __exit__(self, *exc_info: object) -> None:
        del exc_info
        self.close()


@dataclass(frozen=True)
class BDLProviderGame:
    game_id: str
    season_id: str
    game_date: date
    tipoff_at: datetime
    tipoff_known: bool
    status: str
    home_team_id: str
    away_team_id: str
    expected_player_ids: tuple[str, ...]
    expected_player_names: tuple[tuple[str, str], ...]
    expected_player_scoring_fingerprints: tuple[tuple[str, str], ...]
    source_fingerprint: str

    def __post_init__(self) -> None:
        for field in ("game_id", "season_id", "home_team_id", "away_team_id"):
            value = getattr(self, field)
            if not isinstance(value, str) or not value:
                raise ValueError(f"{field} must be a non-empty string")
        if type(self.game_date) is not date:
            raise ValueError("game_date must be a date")
        if not isinstance(self.tipoff_at, datetime) or self.tipoff_at.tzinfo is None:
            raise ValueError("tipoff_at must be timezone-aware")
        object.__setattr__(self, "tipoff_at", self.tipoff_at.astimezone(timezone.utc))
        if type(self.tipoff_known) is not bool:
            raise ValueError("tipoff_known must be a boolean")
        if self.status not in NORMALIZED_STATUSES:
            raise ValueError("status must be normalized")
        expected = tuple(self.expected_player_ids)
        if len(expected) != len(set(expected)) or any(
            not isinstance(player_id, str) or not player_id for player_id in expected
        ):
            raise ValueError("expected_player_ids must contain unique identifiers")
        object.__setattr__(self, "expected_player_ids", expected)
        expected_names = tuple(self.expected_player_names)
        if tuple(player_id for player_id, _ in expected_names) != expected or any(
            not isinstance(player_name, str) or not player_name.strip()
            for _, player_name in expected_names
        ):
            raise ValueError(
                "expected_player_names must exactly match expected_player_ids"
            )
        object.__setattr__(self, "expected_player_names", expected_names)
        scoring_fingerprints = tuple(self.expected_player_scoring_fingerprints)
        if tuple(player_id for player_id, _ in scoring_fingerprints) != expected or any(
            not isinstance(fingerprint, str) or len(fingerprint) != 64
            for _, fingerprint in scoring_fingerprints
        ):
            raise ValueError(
                "expected_player_scoring_fingerprints must exactly match "
                "expected_player_ids"
            )
        object.__setattr__(
            self,
            "expected_player_scoring_fingerprints",
            scoring_fingerprints,
        )
        if not isinstance(self.source_fingerprint, str) or not self.source_fingerprint:
            raise ValueError("source_fingerprint is required")

    @property
    def provider_game_id(self) -> str:
        return self.game_id

    @property
    def starts_at(self) -> datetime:
        return self.tipoff_at

    @property
    def visitor_team_id(self) -> str:
        return self.away_team_id

    @property
    def source_version(self) -> str:
        return self.source_fingerprint


@dataclass(frozen=True)
class BDLFinalPlayerResult:
    game_id: str
    player_id: str
    game_line: BDLGameLine
    raw_net_points: float
    scoring_fingerprint: str

    def __post_init__(self) -> None:
        if self.game_line.game_id != self.game_id:
            raise ValueError("game result identity does not match its game line")
        if self.game_line.player_id != self.player_id:
            raise ValueError("player result identity does not match its game line")
        if not math.isfinite(float(self.raw_net_points)):
            raise ValueError("raw_net_points must be finite")
        if (
            not isinstance(self.scoring_fingerprint, str)
            or not self.scoring_fingerprint
        ):
            raise ValueError("scoring_fingerprint is required")

    @property
    def provider_game_id(self) -> str:
        return self.game_id

    @property
    def provider_player_id(self) -> str:
        return self.player_id

    @property
    def fingerprint(self) -> str:
        return self.scoring_fingerprint

    @property
    def result_fingerprint(self) -> str:
        return self.scoring_fingerprint


@dataclass(frozen=True)
class BDLSlate:
    game_date: date
    games: tuple[BDLProviderGame, ...]
    schedule_complete: bool

    def __post_init__(self) -> None:
        if type(self.game_date) is not date:
            raise ValueError("game_date must be a date")
        games = tuple(self.games)
        if any(game.game_date != self.game_date for game in games):
            raise ValueError("slate games must share the slate date")
        object.__setattr__(self, "games", games)


class BallDontLieLiveClient:
    """Strictly normalize BDL schedule and exact-final player result pages."""

    def __init__(
        self,
        transport: Transport,
        *,
        max_pages: int = BDL_MAX_PAGES,
        max_rows: int = BDL_MAX_ROWS,
        per_page: int = BDL_PAGE_SIZE,
        net_points_model: NetPointsModel | None = None,
    ) -> None:
        get_json = getattr(transport, "get_json", None)
        if not callable(transport) and not callable(get_json):
            raise TypeError("transport must be callable or expose get_json")
        for name, value in (
            ("max_pages", max_pages),
            ("max_rows", max_rows),
            ("per_page", per_page),
        ):
            if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
                raise ValueError(f"{name} must be a positive integer")
        self._transport = transport
        self._max_pages = max_pages
        self._max_rows = max_rows
        self._per_page = per_page
        self._net_points_model = net_points_model or NetPointsModel()

    def fetch_slate(self, game_date: date) -> BDLSlate:
        if type(game_date) is not date:
            raise ValueError("game_date must be a date")
        date_text = game_date.isoformat()
        game_rows = self._fetch_all_pages(
            BDL_GAMES_PATH,
            {"dates[]": date_text, "per_page": self._per_page},
            "BDL games",
        )
        box_rows = self._fetch_unpaginated(
            BDL_BOX_SCORES_PATH,
            {"date": date_text},
            "BDL box scores",
        )

        schedule_ids: set[str] = set()
        schedule_by_matchup: dict[tuple[str, str], list[str]] = {}
        for row in game_rows:
            game_id = _positive_identifier(row.get("id"), "BDL game id")
            if game_id in schedule_ids:
                raise ProviderContractError("duplicate BDL schedule game row")
            schedule_ids.add(game_id)
            _require_date(row.get("date"), game_date, "BDL game date")
            matchup = (
                _schedule_team_id(row.get("home_team"), "home"),
                _schedule_team_id(row.get("visitor_team"), "visitor"),
            )
            schedule_by_matchup.setdefault(matchup, []).append(game_id)

        boxes_by_game: dict[str, Mapping[str, object]] = {}
        for row in box_rows:
            _require_date(row.get("date"), game_date, "BDL box-score date")
            raw_box_game_id = row.get("id")
            if raw_box_game_id is None:
                matchup = (_box_team(row, "home")[0], _box_team(row, "visitor")[0])
                candidates = schedule_by_matchup.get(matchup, [])
                if len(candidates) != 1:
                    raise ProviderContractError(
                        "BDL box score without an id must match exactly one "
                        "scheduled game by team identity"
                    )
                box_game_id = candidates[0]
            else:
                box_game_id = _positive_identifier(
                    raw_box_game_id, "BDL box-score game id"
                )
            if box_game_id in boxes_by_game:
                raise ProviderContractError("duplicate BDL box-score game row")
            boxes_by_game[box_game_id] = row

        unknown_box_ids = set(boxes_by_game).difference(schedule_ids)
        if unknown_box_ids:
            unknown = ", ".join(sorted(unknown_box_ids, key=_identifier_sort_key))
            raise ProviderContractError(
                f"BDL box scores contain unknown game ids: {unknown}"
            )

        games: list[BDLProviderGame] = []
        for row in game_rows:
            game_id = _positive_identifier(row.get("id"), "BDL game id")
            _require_date(row.get("date"), game_date, "BDL game date")
            season_id = _positive_identifier(row.get("season"), "BDL season")
            home_team_id = _schedule_team_id(row.get("home_team"), "home")
            away_team_id = _schedule_team_id(row.get("visitor_team"), "visitor")
            if home_team_id == away_team_id:
                raise ProviderContractError("BDL game teams must be distinct")

            box_row = boxes_by_game.pop(game_id, None)
            status_source = box_row if box_row is not None else row
            status = _normalize_status(status_source)
            raw_starts_at = row.get("datetime")
            if raw_starts_at is None and box_row is not None:
                raw_starts_at = box_row.get("datetime")
            tipoff_known = raw_starts_at is not None
            if tipoff_known:
                starts_at = _parse_datetime(raw_starts_at, "BDL datetime")
            elif status in NON_SETTLING_TERMINAL_STATUSES:
                # These rows are retained only for audit and never create a
                # settlement boundary, so a deterministic date marker is safe.
                starts_at = datetime.combine(game_date, time.min, timezone.utc)
            else:
                raise RetryableProviderError(
                    f"BDL {status} game {game_id} has no tipoff timestamp yet"
                )

            if box_row is not None:
                self._validate_box_identity(
                    box_row,
                    game_id=game_id,
                    season_id=season_id,
                    game_date=game_date,
                    starts_at=starts_at,
                    home_team_id=home_team_id,
                    away_team_id=away_team_id,
                )

            expected_player_ids: tuple[str, ...] = ()
            expected_player_names: tuple[tuple[str, str], ...] = ()
            expected_player_scoring_fingerprints: tuple[tuple[str, str], ...] = ()
            if status == "final":
                if box_row is None:
                    raise RetryableProviderError(
                        f"BDL final game {game_id} has no box score yet"
                    )
                (
                    expected_player_ids,
                    expected_player_names,
                    expected_player_scoring_fingerprints,
                ) = self._expected_final_players(box_row)

            source_fingerprint = _canonical_fingerprint(
                {
                    "game_id": game_id,
                    "season_id": season_id,
                    "game_date": game_date.isoformat(),
                    "starts_at": _iso_utc(starts_at),
                    "tipoff_known": tipoff_known,
                    "status": status,
                    "home_team_id": home_team_id,
                    "away_team_id": away_team_id,
                    "expected_player_ids": expected_player_ids,
                    "expected_player_names": expected_player_names,
                    "expected_player_scoring_fingerprints": (
                        expected_player_scoring_fingerprints
                    ),
                }
            )
            games.append(
                BDLProviderGame(
                    game_id=game_id,
                    season_id=season_id,
                    game_date=game_date,
                    tipoff_at=starts_at,
                    tipoff_known=tipoff_known,
                    status=status,
                    home_team_id=home_team_id,
                    away_team_id=away_team_id,
                    expected_player_ids=expected_player_ids,
                    expected_player_names=expected_player_names,
                    expected_player_scoring_fingerprints=(
                        expected_player_scoring_fingerprints
                    ),
                    source_fingerprint=source_fingerprint,
                )
            )

        if boxes_by_game:
            unknown = ", ".join(sorted(boxes_by_game, key=_identifier_sort_key))
            raise ProviderContractError(
                f"BDL box scores contain unknown game ids: {unknown}"
            )
        games.sort(key=lambda game: _identifier_sort_key(game.game_id))
        return BDLSlate(
            game_date=game_date,
            games=tuple(games),
            schedule_complete=True,
        )

    def fetch_final_results(
        self,
        game: BDLProviderGame,
    ) -> tuple[BDLFinalPlayerResult, ...]:
        if not isinstance(game, BDLProviderGame):
            raise TypeError("game must be a BDLProviderGame")
        if game.status not in FINAL_STATUSES:
            raise ProviderContractError("only a final BDL game can yield results")
        game_id = _positive_identifier(game.game_id, "BDL game id")
        if not game.expected_player_ids:
            raise RetryableProviderError(
                f"BDL final game {game_id} has no expected players yet"
            )
        try:
            numeric_game_id = int(game_id)
        except ValueError:
            raise ProviderContractError("BDL game id must be numeric") from None

        rows = self._fetch_all_pages(
            BDL_STATS_PATH,
            {
                "game_ids[]": [numeric_game_id],
                "period": 0,
                "per_page": self._per_page,
            },
            "BDL final stats",
        )
        if not rows:
            raise RetryableProviderError("BDL final stats are not available yet")

        expected_players = set(game.expected_player_ids)
        expected_player_names = dict(game.expected_player_names)
        expected_scoring_fingerprints = dict(game.expected_player_scoring_fingerprints)
        seen_stats: set[str] = set()
        seen_players: set[str] = set()
        results: list[BDLFinalPlayerResult] = []
        for row in rows:
            stat_id = _positive_identifier(row.get("id"), "BDL stat id")
            if stat_id in seen_stats:
                raise ProviderContractError("duplicate BDL stat row")
            seen_stats.add(stat_id)

            self._validate_final_game_identity(row, game)
            player = _require_mapping(row.get("player"), "BDL stat player")
            player_id = _positive_identifier(player.get("id"), "BDL player id")
            if player_id in seen_players:
                raise ProviderContractError("duplicate BDL player row")
            seen_players.add(player_id)
            if player_id not in expected_players:
                raise ProviderContractError(
                    f"BDL final stats contain unexpected player {player_id}"
                )
            player_name = _require_player_name(player)
            if _normalize_provider_name(player_name) != _normalize_provider_name(
                expected_player_names[player_id]
            ):
                raise RetryableProviderError(
                    "BDL stat player identity does not match the final box score"
                )

            team = _require_mapping(row.get("team"), "BDL stat team")
            team_id = _positive_identifier(team.get("id"), "BDL stat team id")
            if team_id not in {game.home_team_id, game.away_team_id}:
                raise ProviderContractError("BDL stat row has a wrong team")
            abbreviation = team.get("abbreviation")
            if not isinstance(abbreviation, str) or not abbreviation.strip():
                raise ProviderContractError("BDL stat team abbreviation is required")

            normalized_stats = _validate_scoring_inputs(row)
            try:
                game_line = row_to_game_line(row)
            except ProviderContractError:
                raise
            except (KeyError, TypeError, ValueError) as exc:
                raise ProviderContractError(
                    "BDL stat row cannot be mapped to a canonical game line"
                ) from exc
            if game_line.game_id != game.game_id:
                raise ProviderContractError("canonical BDL line has a wrong game id")
            if game_line.game_date != game.game_date:
                raise ProviderContractError("canonical BDL line has a wrong game date")
            if game_line.player_id != player_id:
                raise ProviderContractError("canonical BDL line has a wrong player id")

            canonical_values = _normalized_box_score(game_line)
            if canonical_values != normalized_stats:
                raise ProviderContractError(
                    "canonical BDL mapper disagrees with validated scoring inputs"
                )
            scoring_fingerprint = _canonical_fingerprint(canonical_values)
            if scoring_fingerprint != expected_scoring_fingerprints[player_id]:
                raise RetryableProviderError(
                    "BDL final stats do not match the final box score"
                )
            raw_net_points = self._net_points_model.score(game_line.box_score)
            if not math.isfinite(raw_net_points):
                raise ProviderContractError("BDL net-points score must be finite")
            results.append(
                BDLFinalPlayerResult(
                    game_id=game.game_id,
                    player_id=player_id,
                    game_line=game_line,
                    raw_net_points=raw_net_points,
                    scoring_fingerprint=scoring_fingerprint,
                )
            )

        missing_players = expected_players.difference(seen_players)
        if missing_players:
            missing = ", ".join(sorted(missing_players, key=_identifier_sort_key))
            raise RetryableProviderError(
                f"BDL final stats are missing expected players: {missing}"
            )
        results.sort(key=lambda result: _identifier_sort_key(result.player_id))
        return tuple(results)

    def fetch_next_game_date(
        self,
        after_date: date,
        *,
        lookahead_days: int = 45,
    ) -> date | None:
        """Return the earliest non-cancelled scheduled date after ``after_date``."""

        if type(after_date) is not date:
            raise ValueError("after_date must be a date")
        if (
            isinstance(lookahead_days, bool)
            or not isinstance(lookahead_days, int)
            or not 1 <= lookahead_days <= 90
        ):
            raise ValueError("lookahead_days must be between 1 and 90")
        end_date = after_date + timedelta(days=lookahead_days)
        rows = self._fetch_all_pages(
            BDL_GAMES_PATH,
            {
                "start_date": (after_date + timedelta(days=1)).isoformat(),
                "end_date": end_date.isoformat(),
                "per_page": self._per_page,
            },
            "BDL future games",
        )
        seen_games: set[str] = set()
        candidates: set[date] = set()
        for row in rows:
            game_id = _positive_identifier(row.get("id"), "BDL future game id")
            if game_id in seen_games:
                raise ProviderContractError("duplicate BDL future game row")
            seen_games.add(game_id)
            raw_date = row.get("date")
            try:
                game_date = date.fromisoformat(str(raw_date)[:10])
            except ValueError as exc:
                raise ProviderContractError("BDL future game date is invalid") from exc
            if not after_date < game_date <= end_date:
                raise ProviderContractError(
                    "BDL future game is outside the query range"
                )
            if _normalize_status(row) not in {"cancelled", "postponed"}:
                candidates.add(game_date)
        return min(candidates) if candidates else None

    def _request_json(
        self,
        path: str,
        params: Mapping[str, object],
    ) -> object:
        try:
            get_json = getattr(self._transport, "get_json", None)
            if callable(get_json):
                return get_json(path, params)
            transport = self._transport
            if callable(transport):
                return transport(path, params)
        except (ProviderContractError, RetryableProviderError):
            raise
        except (TimeoutError, ConnectionError, OSError) as exc:
            raise RetryableProviderError(
                f"BDL transport failed: {type(exc).__name__}"
            ) from exc
        raise TypeError("transport must be callable or expose get_json")

    def _fetch_all_pages(
        self,
        path: str,
        base_params: Mapping[str, object],
        label: str,
    ) -> tuple[Mapping[str, object], ...]:
        rows: list[Mapping[str, object]] = []
        cursor: object | None = None
        seen_cursors: set[str] = set()
        page_count = 0
        while True:
            page_count += 1
            params = dict(base_params)
            if cursor is not None:
                params["cursor"] = cursor
            payload = self._request_json(path, params)
            if not isinstance(payload, Mapping):
                raise ProviderContractError(f"{label} response must be an object")
            page_rows = payload.get("data")
            if not isinstance(page_rows, list):
                raise ProviderContractError(
                    f"{label} response must contain a data list"
                )
            if not all(isinstance(row, Mapping) for row in page_rows):
                raise ProviderContractError(f"{label} contains a non-object row")
            if len(rows) + len(page_rows) > self._max_rows:
                raise ProviderContractError(f"{label} exceeded the safe row limit")
            rows.extend(page_rows)

            meta = payload.get("meta")
            if not isinstance(meta, Mapping):
                raise ProviderContractError(f"{label} meta must be an object")
            next_cursor = meta.get("next_cursor")
            if next_cursor is None:
                return tuple(rows)
            cursor_key = _cursor_key(next_cursor, label)
            if cursor_key in seen_cursors:
                raise ProviderContractError(f"{label} cursor repeated")
            seen_cursors.add(cursor_key)
            if page_count >= self._max_pages:
                raise RetryableProviderError(
                    f"{label} pagination exceeded the safe page limit"
                )
            cursor = next_cursor

    def _fetch_unpaginated(
        self,
        path: str,
        params: Mapping[str, object],
        label: str,
    ) -> tuple[Mapping[str, object], ...]:
        payload = self._request_json(path, params)
        if not isinstance(payload, Mapping):
            raise ProviderContractError(f"{label} response must be an object")
        rows = payload.get("data")
        if not isinstance(rows, list):
            raise ProviderContractError(f"{label} response must contain a data list")
        if not all(isinstance(row, Mapping) for row in rows):
            raise ProviderContractError(f"{label} contains a non-object row")
        if len(rows) > self._max_rows:
            raise ProviderContractError(f"{label} exceeded the safe row limit")
        meta = payload.get("meta")
        if meta is not None:
            if not isinstance(meta, Mapping):
                raise ProviderContractError(f"{label} meta must be an object")
            if meta.get("next_cursor") is not None:
                raise ProviderContractError(
                    f"{label} unexpectedly returned a pagination cursor"
                )
        return tuple(rows)

    @staticmethod
    def _validate_box_identity(
        row: Mapping[str, object],
        *,
        game_id: str,
        season_id: str,
        game_date: date,
        starts_at: datetime,
        home_team_id: str,
        away_team_id: str,
    ) -> None:
        if row.get("id") is not None and (
            _positive_identifier(row.get("id"), "BDL box-score game id") != game_id
        ):
            raise ProviderContractError("BDL box score has a wrong game id")
        _require_date(row.get("date"), game_date, "BDL box-score date")
        if _positive_identifier(row.get("season"), "BDL box-score season") != season_id:
            raise ProviderContractError("BDL box score has a wrong season")
        if "datetime" in row and row.get("datetime") is not None:
            box_starts_at = _parse_datetime(
                row.get("datetime"), "BDL box-score datetime"
            )
            if box_starts_at != starts_at:
                raise ProviderContractError("BDL box score has a wrong tipoff")
        box_home = _box_team(row, "home")
        box_away = _box_team(row, "visitor")
        if box_home[0] != home_team_id or box_away[0] != away_team_id:
            raise ProviderContractError("BDL box-score team identity does not match")

    @staticmethod
    def _expected_final_players(
        box_row: Mapping[str, object],
    ) -> tuple[
        tuple[str, ...],
        tuple[tuple[str, str], ...],
        tuple[tuple[str, str], ...],
    ]:
        expected: set[str] = set()
        expected_names: dict[str, str] = {}
        expected_scoring_fingerprints: dict[str, str] = {}
        period = _final_period(box_row)
        expected_team_minutes = BDL_REGULATION_TEAM_MINUTES + (
            max(period - 4, 0) * BDL_OVERTIME_TEAM_MINUTES
        )
        for label in ("home", "visitor"):
            _, container = _box_team(box_row, label)
            if "players" not in container or container.get("players") is None:
                raise RetryableProviderError(
                    f"BDL final box score is missing {label} players"
                )
            players = container.get("players")
            if not isinstance(players, list):
                raise ProviderContractError(
                    f"BDL final box-score {label} players must be a list"
                )
            if not players:
                raise RetryableProviderError(
                    f"BDL final box score has no {label} players yet"
                )
            if len(players) < BDL_MIN_FINAL_TEAM_PLAYERS:
                raise RetryableProviderError(
                    "BDL final box score has an incomplete " f"{label} player manifest"
                )
            team_points = 0.0
            team_minutes = 0.0
            team_minutes_tolerance = BDL_TEAM_MINUTES_EPSILON
            for entry in players:
                player_row = _require_mapping(
                    entry,
                    f"BDL final box-score {label} player row",
                )
                missing_fields = [
                    field
                    for field in (*FINAL_STAT_FIELDS, "min")
                    if field not in player_row or player_row.get(field) is None
                ]
                if missing_fields:
                    raise RetryableProviderError(
                        "BDL final box-score player row is incomplete: "
                        + ", ".join(missing_fields)
                    )
                scoring = _validate_scoring_inputs(player_row)
                team_points += scoring["pts"]
                team_minutes += scoring["minutes"]
                team_minutes_tolerance += _minute_rounding_tolerance(player_row["min"])
                player = _require_mapping(
                    player_row.get("player"),
                    f"BDL final box-score {label} player",
                )
                player_id = _positive_identifier(
                    player.get("id"),
                    "BDL final box-score player id",
                )
                if player_id in expected:
                    raise ProviderContractError("duplicate BDL final box-score player")
                if scoring["minutes"] > 0:
                    expected.add(player_id)
                    expected_names[player_id] = _require_player_name(player)
                    expected_scoring_fingerprints[player_id] = _canonical_fingerprint(
                        scoring
                    )

            score_field = "home_team_score" if label == "home" else "visitor_team_score"
            team_score = _final_team_score(box_row.get(score_field), score_field)
            if team_points != team_score:
                raise RetryableProviderError(
                    f"BDL final box-score {label} player points do not match "
                    "the final team score"
                )
            if abs(team_minutes - expected_team_minutes) > team_minutes_tolerance:
                raise RetryableProviderError(
                    f"BDL final box-score {label} player minutes are incomplete"
                )
        expected_ids = tuple(sorted(expected, key=_identifier_sort_key))
        return (
            expected_ids,
            tuple((player_id, expected_names[player_id]) for player_id in expected_ids),
            tuple(
                (player_id, expected_scoring_fingerprints[player_id])
                for player_id in expected_ids
            ),
        )

    @staticmethod
    def _validate_final_game_identity(
        row: Mapping[str, object],
        game: BDLProviderGame,
    ) -> None:
        embedded = _require_mapping(row.get("game"), "BDL stat game")
        embedded_game_id = _positive_identifier(embedded.get("id"), "BDL stat game id")
        if embedded_game_id != game.game_id:
            raise ProviderContractError("BDL stats contain a wrong game row")
        _require_date(embedded.get("date"), game.game_date, "BDL stat game date")
        if "season" in embedded and embedded.get("season") is not None:
            season_id = _positive_identifier(
                embedded.get("season"), "BDL stat game season"
            )
            if season_id != game.season_id:
                raise ProviderContractError("BDL stat row has a wrong season")
        if "datetime" in embedded and embedded.get("datetime") is not None:
            starts_at = _parse_datetime(
                embedded.get("datetime"), "BDL stat game datetime"
            )
            if starts_at != game.starts_at:
                raise ProviderContractError("BDL stat row has a wrong tipoff")
        if _normalize_status(embedded) != "final":
            raise ProviderContractError("BDL stat row is not exact final")


def _require_mapping(value: object, label: str) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise ProviderContractError(f"{label} must be an object")
    return value


def _positive_identifier(value: object, field: str) -> str:
    if isinstance(value, bool) or value is None:
        raise ProviderContractError(f"{field} is required")
    if isinstance(value, int):
        number = value
    elif isinstance(value, str) and value.strip().isdigit():
        number = int(value.strip())
    else:
        raise ProviderContractError(f"{field} must be a positive integer")
    if number <= 0:
        raise ProviderContractError(f"{field} must be a positive integer")
    return str(number)


def _require_date(value: object, expected: date, field: str) -> date:
    if not isinstance(value, str) or len(value) < 10:
        raise ProviderContractError(f"{field} is required")
    try:
        actual = date.fromisoformat(value[:10])
    except ValueError:
        raise ProviderContractError(f"{field} is invalid") from None
    if actual != expected:
        raise ProviderContractError(f"{field} has a wrong date")
    return actual


def _parse_datetime(value: object, field: str) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise ProviderContractError(f"{field} must be an ISO timestamp")
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        raise ProviderContractError(f"{field} must be an ISO timestamp") from None
    if parsed.tzinfo is None:
        raise ProviderContractError(f"{field} must be timezone-aware")
    return parsed.astimezone(timezone.utc)


def _final_period(row: Mapping[str, object]) -> int:
    value = row.get("period")
    if value is None:
        raise RetryableProviderError("BDL final box score is missing its period")
    if isinstance(value, bool):
        raise ProviderContractError("BDL final box-score period must be a whole number")
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ProviderContractError(
            "BDL final box-score period must be a whole number"
        ) from None
    if not math.isfinite(number) or not number.is_integer():
        raise ProviderContractError("BDL final box-score period must be a whole number")
    period = int(number)
    if period < 4:
        raise RetryableProviderError("BDL final box-score period is incomplete")
    if period > 20:
        raise ProviderContractError("BDL final box-score period is out of range")
    return period


def _final_team_score(value: object, field: str) -> float:
    if value is None:
        raise RetryableProviderError(f"BDL final box score is missing {field}")
    score = _finite_stat({field: value}, field)
    if score < 0 or score > 500:
        raise ProviderContractError(f"BDL final box-score {field} is out of range")
    return score


def _minute_rounding_tolerance(value: object) -> float:
    """Return the maximum rounding error implied by the provider's precision."""

    text = str(value).strip()
    if ":" in text:
        _, seconds = text.split(":", 1)
        decimal_places = len(seconds.partition(".")[2])
        return 0.5 / (60 * (10**decimal_places))
    decimal_places = len(text.partition(".")[2])
    return 0.5 / (10**decimal_places)


def _schedule_team_id(value: object, label: str) -> str:
    team = _require_mapping(value, f"BDL {label} team")
    return _positive_identifier(team.get("id"), f"BDL {label} team id")


def _box_team(
    row: Mapping[str, object],
    label: str,
) -> tuple[str, Mapping[str, object]]:
    field = "home_team" if label == "home" else "visitor_team"
    container = _require_mapping(row.get(field), f"BDL box-score {label} team")
    raw_team = container.get("team")
    team = (
        _require_mapping(raw_team, f"BDL box-score {label} team identity")
        if raw_team is not None
        else container
    )
    team_id = _positive_identifier(team.get("id"), f"BDL box-score {label} team id")
    return team_id, container


def _normalize_status(payload: Mapping[str, object]) -> str:
    raw_state = payload.get("status_state")
    if not isinstance(raw_state, str) or not raw_state.strip():
        raise ProviderContractError("BDL status_state is required")
    state = raw_state.strip().casefold()
    if state == "unknown":
        raise RetryableProviderError(
            "BDL status_state is unknown and cannot be classified safely"
        )
    try:
        return STATUS_STATE_MAP[state]
    except KeyError:
        raise ProviderContractError(f"unsupported BDL status_state: {state}") from None


def _require_player_name(player: Mapping[str, object]) -> str:
    first_name = player.get("first_name")
    last_name = player.get("last_name")
    if not isinstance(first_name, str) or not isinstance(last_name, str):
        raise ProviderContractError("BDL player name is missing")
    name = f"{first_name.strip()} {last_name.strip()}".strip()
    if not name:
        raise ProviderContractError("BDL player name is missing")
    return name


def _normalize_provider_name(value: str) -> str:
    return " ".join(value.split()).casefold()


def _finite_stat(row: Mapping[str, object], field: str) -> float:
    value = row.get(field)
    if isinstance(value, bool):
        raise ProviderContractError(f"BDL stat {field} must be finite")
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ProviderContractError(f"BDL stat {field} must be finite") from None
    if not math.isfinite(number):
        raise ProviderContractError(f"BDL stat {field} must be finite")
    if not number.is_integer():
        raise ProviderContractError(f"BDL stat {field} must be a whole number")
    return _normalized_float(number)


def _validate_scoring_inputs(row: Mapping[str, object]) -> dict[str, float]:
    values = {
        FINAL_STAT_TO_NORMALIZED[field]: _finite_stat(row, field)
        for field in FINAL_STAT_FIELDS
    }
    try:
        values["minutes"] = _normalized_float(parse_minutes(row.get("min")))
    except (TypeError, ValueError):
        raise ProviderContractError("BDL stat min must be a valid clock") from None

    invalid = sorted(
        field for field, value in values.items() if value < 0 or value > 500
    )
    if invalid:
        raise ProviderContractError(
            f"BDL box score has out-of-range fields: {', '.join(invalid)}"
        )
    if values["minutes"] > 100:
        raise ProviderContractError("BDL box score minutes exceed the supported range")
    for made, attempted in (
        ("fgm", "fga"),
        ("three_pm", "three_pa"),
        ("ftm", "fta"),
    ):
        if values[made] > values[attempted]:
            raise ProviderContractError("BDL box score makes exceed attempts")
    if values["three_pa"] > values["fga"] or values["three_pm"] > values["fgm"]:
        raise ProviderContractError("BDL three-point totals exceed field-goal totals")
    if values["fgm"] - values["three_pm"] > values["fga"] - values["three_pa"]:
        raise ProviderContractError("BDL two-point makes exceed attempts")
    expected_points = (
        2 * (values["fgm"] - values["three_pm"])
        + 3 * values["three_pm"]
        + values["ftm"]
    )
    if values["pts"] != expected_points:
        raise ProviderContractError("BDL points disagree with made shots")
    return values


def _normalized_box_score(game_line: BDLGameLine) -> dict[str, float]:
    return {
        field: _normalized_float(getattr(game_line.box_score, field))
        for field in NORMALIZED_SCORING_FIELDS
    }


def _normalized_float(value: object) -> float:
    if isinstance(value, bool):
        raise ProviderContractError("normalized scoring input must be finite")
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ProviderContractError("normalized scoring input must be finite") from None
    if not math.isfinite(number):
        raise ProviderContractError("normalized scoring input must be finite")
    return 0.0 if number == 0 else number


def _canonical_fingerprint(value: Mapping[str, object]) -> str:
    try:
        encoded = json.dumps(
            dict(value),
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError):
        raise ProviderContractError("BDL normalized payload cannot be hashed") from None
    return hashlib.sha256(encoded).hexdigest()


def _cursor_key(value: object, label: str) -> str:
    if isinstance(value, bool) or value is None:
        raise ProviderContractError(f"{label} cursor must be a scalar")
    if not isinstance(value, (str, int)):
        raise ProviderContractError(f"{label} cursor must be a scalar")
    key = str(value).strip()
    if not key:
        raise ProviderContractError(f"{label} cursor cannot be blank")
    return key


def _identifier_sort_key(value: str) -> tuple[int, int | str]:
    try:
        return (0, int(value))
    except ValueError:
        return (1, value)


def _iso_utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


__all__ = [
    "BDLFinalPlayerResult",
    "BDLProviderGame",
    "BDLSlate",
    "BallDontLieLiveClient",
    "ProviderContractError",
    "RetryableProviderError",
]
