from __future__ import annotations

import copy
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, timedelta
import hashlib
import json
from pathlib import Path

import pytest
from sqlalchemy import func, select

from nba_stock_market.api.auth import Principal
from nba_stock_market.api.database import (
    Database,
    PerGameAccrualRow,
    PerGameCommandRow,
    PerGameLedgerEntryRow,
    PerGameLiveGameRow,
    PerGameLiveResultCommandRow,
    PerGameLiveSlateRow,
    PerGameProviderPlayerMapRow,
    PerGamePositionRow,
    PerGameQuoteRow,
    PerGameResultRow,
    PerGameRulesetRow,
)
from nba_stock_market.api.live_settlement_sink import (
    DatabaseLiveSettlementSink,
    InProcessPerGameCommandTarget,
)
from nba_stock_market.api.per_game_service import PerGameService
from nba_stock_market.api.service import ApiProblem
from nba_stock_market.bdl_live import BallDontLieLiveClient
from nba_stock_market.live_settlement import (
    CoordinatorContractError,
    DateCompletionCommand,
    LiveSettlementCoordinator,
    PlayerSettlementCommand,
    RetryableSettlementProviderError,
    RosterLockCommand,
    StaleSettlementFenceError,
)


GAME_DATE = date(2026, 10, 22)
NEXT_GAME_DATE = date(2026, 10, 24)
TIPOFF = datetime(2026, 10, 22, 23, tzinfo=UTC)
FIXTURES = Path(__file__).parents[1] / "fixtures"


def sha(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class Fence:
    owner_id: str = "pipeline-a"
    fencing_token: int = 7


@dataclass(frozen=True)
class GameLine:
    player_name: str


@dataclass(frozen=True)
class ProviderResult:
    game_id: str
    player_id: str
    raw_net_points: float
    scoring_fingerprint: str
    game_line: GameLine


@dataclass(frozen=True)
class ProviderGame:
    game_id: str
    season_id: str
    game_date: date
    tipoff_at: datetime
    status: str
    home_team_id: str
    away_team_id: str
    expected_player_ids: tuple[str, ...]
    source_fingerprint: str
    tipoff_known: bool = True


@dataclass(frozen=True)
class ProviderSlate:
    game_date: date
    games: tuple[ProviderGame, ...]
    schedule_complete: bool


class Provider:
    def __init__(self, game: ProviderGame, result: ProviderResult) -> None:
        self.game = game
        self.result = result
        self.additional_games: tuple[ProviderGame, ...] = ()
        self.additional_results: tuple[ProviderResult, ...] = ()

    def fetch_slate(self, game_date: date) -> ProviderSlate:
        assert game_date == self.game.game_date
        return ProviderSlate(game_date, (self.game, *self.additional_games), True)

    def fetch_final_results(self, game: ProviderGame) -> tuple[ProviderResult, ...]:
        assert game.game_id == self.game.game_id
        return (self.result, *self.additional_results)


class FixtureTransport:
    def __init__(self, responses: dict[str, list[dict[str, object]]]) -> None:
        self.responses = responses

    def get_json(self, path: str, params: object) -> dict[str, object]:
        del params
        responses = self.responses.get(path)
        if not responses:
            raise AssertionError(f"unexpected BDL request: {path}")
        return copy.deepcopy(responses.pop(0))


def fixture(name: str) -> dict[str, object]:
    return json.loads((FIXTURES / f"bdl_live_{name}.json").read_text(encoding="utf-8"))


def canonical_bdl_provider() -> BallDontLieLiveClient:
    games = fixture("games_page_1")
    box_scores = fixture("box_scores_page_1")
    stats = fixture("stats_page_1")
    stats["data"].extend(fixture("stats_page_2")["data"])
    for payload in (games, stats):
        payload["meta"] = {}

    game = games["data"][0]
    box = box_scores["data"][0]
    for row in (game, box):
        row["date"] = GAME_DATE.isoformat()
        row["datetime"] = TIPOFF.isoformat().replace("+00:00", "Z")
        row["season"] = 2025
    for stat in stats["data"]:
        stat["game"]["date"] = GAME_DATE.isoformat()
        stat["game"]["datetime"] = TIPOFF.isoformat().replace("+00:00", "Z")
        stat["game"]["season"] = 2025

    home_player = box["home_team"]["players"][0]["player"]
    home_player["first_name"] = "Shai"
    home_player["last_name"] = "Gilgeous-Alexander"
    stat = stats["data"][0]
    stat["player"]["first_name"] = "Shai"
    stat["player"]["last_name"] = "Gilgeous-Alexander"

    return BallDontLieLiveClient(
        FixtureTransport(
            {
                "/v1/games": [games],
                "/v1/box_scores": [box_scores],
                "/v1/stats": [stats],
            }
        )
    )


class LostResponseOnceTarget:
    def __init__(self, inner: InProcessPerGameCommandTarget) -> None:
        self.inner = inner
        self.failed = False
        self.settlement_keys: list[str] = []

    def set_roster_lock(self, command: RosterLockCommand, *, write_guard):
        return self.inner.set_roster_lock(command, write_guard=write_guard)

    def settle_player(self, command: PlayerSettlementCommand, *, write_guard):
        self.settlement_keys.append(command.idempotency_key)
        response = self.inner.settle_player(command, write_guard=write_guard)
        if not self.failed:
            self.failed = True
            raise TimeoutError("the committed response was lost")
        return response

    def complete_date(self, command: DateCompletionCommand, *, write_guard):
        return self.inner.complete_date(command, write_guard=write_guard)


class RosterLockRequiredOnceTarget:
    def __init__(self, inner: InProcessPerGameCommandTarget) -> None:
        self.inner = inner
        self.failed = False

    def set_roster_lock(self, command: RosterLockCommand, *, write_guard):
        return self.inner.set_roster_lock(command, write_guard=write_guard)

    def settle_player(self, command: PlayerSettlementCommand, *, write_guard):
        if not self.failed:
            self.failed = True
            raise ApiProblem(
                status_code=409,
                code="roster_lock_required",
                message="the roster lock moved before settlement",
            )
        return self.inner.settle_player(command, write_guard=write_guard)

    def complete_date(self, command: DateCompletionCommand, *, write_guard):
        return self.inner.complete_date(command, write_guard=write_guard)


class LostUnlockResponseOnceTarget:
    def __init__(self, inner: InProcessPerGameCommandTarget) -> None:
        self.inner = inner
        self.failed = False
        self.unlock_calls = 0

    def set_roster_lock(self, command: RosterLockCommand, *, write_guard):
        response = self.inner.set_roster_lock(command, write_guard=write_guard)
        if not command.locked:
            self.unlock_calls += 1
            if not self.failed:
                self.failed = True
                raise TimeoutError("the committed unlock response was lost")
        return response

    def settle_player(self, command: PlayerSettlementCommand, *, write_guard):
        return self.inner.settle_player(command, write_guard=write_guard)

    def complete_date(self, command: DateCompletionCommand, *, write_guard):
        return self.inner.complete_date(command, write_guard=write_guard)


class LostDateCompletionResponseOnceTarget:
    def __init__(self, inner: InProcessPerGameCommandTarget) -> None:
        self.inner = inner
        self.failed = False
        self.completion_calls = 0

    def set_roster_lock(self, command: RosterLockCommand, *, write_guard):
        return self.inner.set_roster_lock(command, write_guard=write_guard)

    def settle_player(self, command: PlayerSettlementCommand, *, write_guard):
        return self.inner.settle_player(command, write_guard=write_guard)

    def complete_date(self, command: DateCompletionCommand, *, write_guard):
        self.completion_calls += 1
        response = self.inner.complete_date(command, write_guard=write_guard)
        if not self.failed:
            self.failed = True
            raise TimeoutError("the committed date-completion response was lost")
        return response


class ExpireBeforeWriteTarget:
    def __init__(
        self,
        inner: InProcessPerGameCommandTarget,
        accepted_token: dict[str, int],
    ) -> None:
        self.inner = inner
        self.accepted_token = accepted_token

    def set_roster_lock(self, command: RosterLockCommand, *, write_guard):
        return self.inner.set_roster_lock(command, write_guard=write_guard)

    def settle_player(self, command: PlayerSettlementCommand, *, write_guard):
        self.accepted_token["value"] += 1
        return self.inner.settle_player(command, write_guard=write_guard)

    def complete_date(self, command: DateCompletionCommand, *, write_guard):
        return self.inner.complete_date(command, write_guard=write_guard)


def final_provider(
    *,
    player_name: str = "Shai Gilgeous-Alexander",
    points: float = 20.0,
    result_version: str = "a",
) -> Provider:
    game = ProviderGame(
        game_id="1001",
        season_id="2025",
        game_date=GAME_DATE,
        tipoff_at=TIPOFF,
        status="final",
        home_team_id="1",
        away_team_id="2",
        expected_player_ids=("115",),
        source_fingerprint=sha("game-final"),
    )
    return Provider(
        game,
        ProviderResult(
            game_id=game.game_id,
            player_id="115",
            raw_net_points=points,
            scoring_fingerprint=sha(f"result-{result_version}"),
            game_line=GameLine(player_name),
        ),
    )


def configure_live_ruleset(database: Database, *, open_sga: bool = False) -> None:
    service = PerGameService(database)
    principal = Principal(id="alice", display_name="Alice")
    service.bootstrap(principal)
    if open_sga:
        service.open_position(
            principal,
            player_id="sga",
            side="long",
            expected_account_version=0,
            expected_quote_version=0,
            idempotency_key="open-sga-live-test",
        )
    with database.market_write_transaction(settlement_exclusive=True) as session:
        ruleset = session.scalar(
            select(PerGameRulesetRow)
            .where(PerGameRulesetRow.is_active.is_(True))
            .with_for_update()
        )
        assert ruleset is not None
        ruleset.enforce_roster_lock = True
        ruleset.roster_mutations_locked = False
        ruleset.roster_lock_game_date = None
        ruleset.last_roster_lock_game_date = None
        ruleset.next_game_date = GAME_DATE


def make_sink(
    database: Database,
    *,
    accepted_token: dict[str, int],
    command_target=None,
    clock=None,
    next_game_date_resolver=None,
) -> DatabaseLiveSettlementSink:
    def validate_fence(session, fence: Fence) -> bool:
        del session
        return fence.fencing_token == accepted_token["value"]

    return DatabaseLiveSettlementSink(
        database,
        fence_validator=validate_fence,
        next_game_date_resolver=(
            next_game_date_resolver
            or (lambda game_date: (NEXT_GAME_DATE if game_date == GAME_DATE else None))
        ),
        expected_ruleset_id="per-game-v2-staging",
        expected_ruleset_version=1,
        expected_ruleset_season_id="2025-26",
        expected_dividend_dollars_per_net_point=40_000,
        expected_provider_season_id="2025",
        command_target=command_target,
        clock=clock or (lambda: TIPOFF - timedelta(days=1)),
    )


def test_durable_sink_settles_unlocks_and_appends_correction_without_second_cost(
    database: Database,
) -> None:
    configure_live_ruleset(database, open_sga=True)
    accepted_token = {"value": 7}
    sink = make_sink(database, accepted_token=accepted_token)
    provider = final_provider()
    coordinator = LiveSettlementCoordinator(provider, sink)

    first = coordinator.run(GAME_DATE, Fence())
    provider.result = ProviderResult(
        game_id="1001",
        player_id="115",
        raw_net_points=22.5,
        scoring_fingerprint=sha("result-b"),
        game_line=GameLine("Shai Gilgeous-Alexander"),
    )
    correction = coordinator.run(GAME_DATE, Fence())

    assert first.commands_succeeded == 1
    assert first.unlocked is True
    assert correction.commands_succeeded == 1
    assert correction.lock_attempted is False
    with database.snapshot_session() as session:
        mapping = session.get(
            PerGameProviderPlayerMapRow,
            {"provider": "bdl", "provider_player_id": "115"},
        )
        assert mapping is not None
        assert mapping.player_id == "sga"
        rows = session.scalars(
            select(PerGameResultRow)
            .where(
                PerGameResultRow.game_id == "bdl:1001",
                PerGameResultRow.player_id == "sga",
            )
            .order_by(PerGameResultRow.revision)
        ).all()
        assert [row.revision for row in rows] == [1, 2]
        assert rows[1].adjusts_result_revision == 1
        ledger_kinds = list(
            session.scalars(
                select(PerGameLedgerEntryRow.kind).where(
                    PerGameLedgerEntryRow.game_id == "bdl:1001"
                )
            )
        )
        assert ledger_kinds.count("game_cost") == 1
        assert ledger_kinds.count("game_dividend") == 1
        assert ledger_kinds.count("dividend_correction") == 1
        live_rows = session.scalars(
            select(PerGameLiveResultCommandRow)
            .where(PerGameLiveResultCommandRow.provider_game_id == "1001")
            .order_by(PerGameLiveResultCommandRow.revision)
        ).all()
        assert [(row.revision, row.status) for row in live_rows] == [
            (1, "succeeded"),
            (2, "succeeded"),
        ]


def test_changed_net_points_creates_correction_when_stats_fingerprint_is_stable(
    database: Database,
) -> None:
    configure_live_ruleset(database, open_sga=True)
    sink = make_sink(database, accepted_token={"value": 7})
    provider = final_provider(points=20.0, result_version="stable-stats")
    coordinator = LiveSettlementCoordinator(provider, sink)

    first = coordinator.run(GAME_DATE, Fence())
    provider.result = replace(provider.result, raw_net_points=22.5)
    correction = coordinator.run(GAME_DATE, Fence())

    assert first.commands_succeeded == 1
    assert correction.commands_succeeded == 1
    with database.snapshot_session() as session:
        durable = session.scalars(
            select(PerGameLiveResultCommandRow).order_by(
                PerGameLiveResultCommandRow.revision
            )
        ).all()
        results = session.scalars(
            select(PerGameResultRow).order_by(PerGameResultRow.revision)
        ).all()
        assert [row.result_fingerprint for row in durable] == [
            sha("result-stable-stats"),
            sha("result-stable-stats"),
        ]
        assert [row.actual_net_points_micros for row in durable] == [
            20_000_000,
            22_500_000,
        ]
        assert [row.revision for row in results] == [1, 2]


def test_real_bdl_payload_flows_through_canonical_scoring_and_v2_service(
    database: Database,
) -> None:
    configure_live_ruleset(database, open_sga=True)
    sink = make_sink(database, accepted_token={"value": 7})

    run = LiveSettlementCoordinator(canonical_bdl_provider(), sink).run(
        GAME_DATE, Fence()
    )

    assert run.games_seen == 1
    assert run.results_seen == 10
    assert run.commands_succeeded == 1
    assert run.unchanged_results == 9
    assert run.unlocked is True
    with database.snapshot_session() as session:
        result = session.scalar(select(PerGameResultRow))
        assert result is not None
        assert result.game_id == "bdl:18450001"
        assert result.player_id == "sga"
        assert result.actual_net_points_micros == 14_450_000
        live_game = session.scalar(select(PerGameLiveGameRow))
        assert live_game is not None
        assert live_game.ignored_player_ids == [
            "1002",
            "1003",
            "1004",
            "1005",
            "2001",
            "2002",
            "2003",
            "2004",
            "2005",
        ]
        ledger_kinds = list(session.scalars(select(PerGameLedgerEntryRow.kind)))
        assert ledger_kinds.count("game_cost") == 1
        assert ledger_kinds.count("game_dividend") == 1


def test_all_unlisted_final_players_still_advance_the_date_before_unlock(
    database: Database,
) -> None:
    configure_live_ruleset(database)
    sink = make_sink(database, accepted_token={"value": 7})
    provider = final_provider(player_name="Not A Listed Player")

    run = LiveSettlementCoordinator(provider, sink).run(GAME_DATE, Fence())

    assert run.commands_attempted == 0
    assert run.commands_succeeded == 0
    assert run.unchanged_results == 1
    assert run.unresolved_items == 0
    assert run.unlocked is True
    with database.snapshot_session() as session:
        ruleset = session.scalar(select(PerGameRulesetRow))
        slate = session.scalar(select(PerGameLiveSlateRow))
        live_game = session.scalar(select(PerGameLiveGameRow))
        assert ruleset is not None
        assert slate is not None
        assert live_game is not None
        assert live_game.ignored_player_ids == ["115"]
        assert slate.completion_succeeded is True
        assert slate.unlock_succeeded is True
        assert ruleset.last_settled_date == GAME_DATE
        assert ruleset.next_game_date == NEXT_GAME_DATE
        assert ruleset.current_sequence > live_game.event_sequence


@pytest.mark.parametrize("terminal_status", ["postponed", "cancelled"])
def test_terminal_only_slate_uses_transient_lock_and_advances_date(
    database: Database,
    terminal_status: str,
) -> None:
    configure_live_ruleset(database)
    sink = make_sink(database, accepted_token={"value": 7})
    provider = final_provider()
    provider.game = replace(
        provider.game,
        status=terminal_status,
        expected_player_ids=(),
        source_fingerprint=sha(f"terminal-only-{terminal_status}"),
    )

    run = LiveSettlementCoordinator(provider, sink).run(GAME_DATE, Fence())

    assert run.games_seen == 0
    assert run.final_games_seen == 0
    assert run.commands_attempted == 0
    assert run.lock_attempted is True
    assert run.lock_acquired is True
    assert run.unresolved_items == 0
    assert run.unlocked is True
    with database.snapshot_session() as session:
        ruleset = session.scalar(select(PerGameRulesetRow))
        slate = session.scalar(select(PerGameLiveSlateRow))
        game = session.scalar(select(PerGameLiveGameRow))
        assert ruleset is not None
        assert slate is not None
        assert game is not None
        assert game.status == terminal_status
        assert slate.expected_game_ids == []
        assert slate.lock_succeeded is True
        assert slate.completion_succeeded is True
        assert slate.unlock_succeeded is True
        assert ruleset.last_settled_date == GAME_DATE
        assert ruleset.next_game_date == NEXT_GAME_DATE


def test_lost_date_completion_response_replays_without_duplicate_completion(
    database: Database,
) -> None:
    configure_live_ruleset(database, open_sga=True)
    accepted_token = {"value": 7}
    target = LostDateCompletionResponseOnceTarget(
        InProcessPerGameCommandTarget(
            PerGameService(database, ruleset_id="per-game-v2-staging")
        )
    )
    first_sink = make_sink(
        database,
        accepted_token=accepted_token,
        command_target=target,
    )
    provider = final_provider()

    first = LiveSettlementCoordinator(provider, first_sink).run(GAME_DATE, Fence())
    assert first.commands_succeeded == 1
    assert first.unresolved_items == 1
    assert first.unlocked is False
    with database.snapshot_session() as session:
        slate = session.scalar(select(PerGameLiveSlateRow))
        assert slate is not None
        assert slate.completion_succeeded is False
        assert slate.completion_next_event_sequence is not None
        completion_sequence = slate.completion_next_event_sequence
        assert slate.unlock_succeeded is False
        assert (
            session.scalar(
                select(func.count())
                .select_from(PerGameCommandRow)
                .where(PerGameCommandRow.command_kind == "complete_game_date")
            )
            == 1
        )

    provider.additional_games = (
        replace(
            provider.game,
            game_id="1002",
            tipoff_at=TIPOFF + timedelta(hours=2),
            status="postponed",
            home_team_id="3",
            away_team_id="4",
            expected_player_ids=(),
            source_fingerprint=sha("postponed-diagnostic-after-completion"),
        ),
    )
    second_sink = make_sink(database, accepted_token=accepted_token)
    second = LiveSettlementCoordinator(provider, second_sink).run(GAME_DATE, Fence())

    assert second.unchanged_results == 1
    assert second.unresolved_items == 0
    assert second.unlocked is True
    assert target.completion_calls == 1
    with database.snapshot_session() as session:
        slate = session.scalar(select(PerGameLiveSlateRow))
        assert slate is not None
        assert slate.completion_succeeded is True
        assert slate.completion_next_event_sequence == completion_sequence
        assert slate.unlock_succeeded is True
        diagnostic = session.get(
            PerGameLiveGameRow,
            {
                "ruleset_id": slate.ruleset_id,
                "provider": "bdl",
                "provider_game_id": "1002",
            },
        )
        assert diagnostic is not None
        assert diagnostic.event_sequence >= completion_sequence
        assert (
            session.scalar(
                select(func.count())
                .select_from(PerGameCommandRow)
                .where(PerGameCommandRow.command_kind == "complete_game_date")
            )
            == 1
        )


def test_next_date_failure_persists_tipoff_locks_and_recovers(
    database: Database,
) -> None:
    configure_live_ruleset(database, open_sga=True)
    accepted_token = {"value": 7}
    scheduled = replace(
        final_provider().game,
        status="scheduled",
        expected_player_ids=(),
        source_fingerprint=sha("scheduled-before-next-date-recovery"),
    )
    provider = Provider(
        scheduled,
        ProviderResult(
            game_id=scheduled.game_id,
            player_id="115",
            raw_net_points=20.0,
            scoring_fingerprint=sha("unused-scheduled-result"),
            game_line=GameLine("Shai Gilgeous-Alexander"),
        ),
    )

    def unavailable_next_date(game_date: date) -> date | None:
        del game_date
        raise RetryableSettlementProviderError("future schedule unavailable")

    failing_sink = make_sink(
        database,
        accepted_token=accepted_token,
        clock=lambda: TIPOFF,
        next_game_date_resolver=unavailable_next_date,
    )
    first = LiveSettlementCoordinator(
        provider,
        failing_sink,
        clock=lambda: TIPOFF,
    ).run(GAME_DATE, Fence())

    assert first.unresolved_items == 1
    assert first.lock_attempted is True
    assert first.lock_acquired is True
    with database.snapshot_session() as session:
        slate = session.scalar(select(PerGameLiveSlateRow))
        game = session.scalar(select(PerGameLiveGameRow))
        ruleset = session.scalar(select(PerGameRulesetRow))
        assert slate is not None
        assert game is not None
        assert ruleset is not None
        assert slate.next_game_date_resolved is False
        assert slate.next_game_date is None
        assert game.started_at == TIPOFF.replace(tzinfo=None)
        assert game.next_game_date is None
        assert ruleset.roster_mutations_locked is True

    recovery_sink = make_sink(
        database,
        accepted_token=accepted_token,
        clock=lambda: TIPOFF,
    )
    recovery = LiveSettlementCoordinator(
        provider,
        recovery_sink,
        clock=lambda: TIPOFF,
    ).run(GAME_DATE, Fence())

    assert recovery.unresolved_items == 0
    assert recovery.unlocked is False
    with database.snapshot_session() as session:
        slate = session.scalar(select(PerGameLiveSlateRow))
        game = session.scalar(select(PerGameLiveGameRow))
        assert slate is not None
        assert game is not None
        assert slate.next_game_date_resolved is True
        assert slate.next_game_date == NEXT_GAME_DATE
        assert game.next_game_date == NEXT_GAME_DATE
        assert game.schedule_history == []

    settled = LiveSettlementCoordinator(
        final_provider(),
        recovery_sink,
        clock=lambda: TIPOFF,
    ).run(GAME_DATE, Fence())
    assert settled.commands_succeeded == 1
    assert settled.unlocked is True


def test_next_date_is_not_resolved_until_current_slate_is_persisted_and_locked(
    database: Database,
) -> None:
    configure_live_ruleset(database)
    resolver_enabled = {"value": False}
    resolver_calls: list[date] = []

    def resolve_next_date(game_date: date) -> date | None:
        resolver_calls.append(game_date)
        if not resolver_enabled["value"]:
            raise AssertionError("next-date resolver ran before the roster lock")
        return NEXT_GAME_DATE

    sink = make_sink(
        database,
        accepted_token={"value": 7},
        next_game_date_resolver=resolve_next_date,
    )
    scheduled = replace(
        final_provider().game,
        status="scheduled",
        expected_player_ids=(),
        source_fingerprint=sha("persist-before-next-date-resolution"),
    )
    slate = ProviderSlate(GAME_DATE, (scheduled,), True)

    first = sink.prepare_slate(slate, Fence())

    assert first.schedule_complete is False
    assert resolver_calls == []
    with database.snapshot_session() as session:
        persisted_slate = session.scalar(select(PerGameLiveSlateRow))
        persisted_game = session.scalar(select(PerGameLiveGameRow))
        assert persisted_slate is not None
        assert persisted_game is not None
        assert persisted_slate.next_game_date_resolved is False
        assert persisted_game.started_at == TIPOFF.replace(tzinfo=None)

    assert sink.dispatch_roster_lock(
        RosterLockCommand(game_date=GAME_DATE, locked=True), Fence()
    ).succeeded
    resolver_enabled["value"] = True
    second = sink.prepare_slate(slate, Fence())

    assert resolver_calls == [GAME_DATE]
    assert second.schedule_complete is True
    assert second.games[0].boundary.next_game_date == NEXT_GAME_DATE


def test_invalid_next_date_persists_tipoff_and_locks_before_failing(
    database: Database,
) -> None:
    configure_live_ruleset(database)
    accepted_token = {"value": 7}
    scheduled = replace(
        final_provider().game,
        status="scheduled",
        expected_player_ids=(),
        source_fingerprint=sha("scheduled-before-invalid-next-date"),
    )
    provider = Provider(
        scheduled,
        ProviderResult(
            game_id=scheduled.game_id,
            player_id="115",
            raw_net_points=20.0,
            scoring_fingerprint=sha("unused-invalid-next-date-result"),
            game_line=GameLine("Shai Gilgeous-Alexander"),
        ),
    )
    sink = make_sink(
        database,
        accepted_token=accepted_token,
        clock=lambda: TIPOFF,
        next_game_date_resolver=lambda game_date: game_date,
    )

    with pytest.raises(CoordinatorContractError, match="later than"):
        LiveSettlementCoordinator(
            provider,
            sink,
            clock=lambda: TIPOFF,
        ).run(GAME_DATE, Fence())

    with database.snapshot_session() as session:
        slate = session.scalar(select(PerGameLiveSlateRow))
        game = session.scalar(select(PerGameLiveGameRow))
        ruleset = session.scalar(select(PerGameRulesetRow))
        assert slate is not None
        assert game is not None
        assert ruleset is not None
        assert slate.next_game_date_resolved is False
        assert game.started_at == TIPOFF.replace(tzinfo=None)
        assert ruleset.roster_mutations_locked is True
        assert ruleset.roster_lock_game_date == GAME_DATE


def test_unlocked_correction_reuses_frozen_next_date_without_resolving(
    database: Database,
) -> None:
    configure_live_ruleset(database, open_sga=True)
    accepted_token = {"value": 7}
    provider = final_provider()
    first_sink = make_sink(database, accepted_token=accepted_token)
    first = LiveSettlementCoordinator(provider, first_sink).run(GAME_DATE, Fence())
    assert first.unlocked is True

    provider.result = replace(
        provider.result,
        raw_net_points=23.0,
        scoring_fingerprint=sha("correction-with-frozen-next-date"),
    )

    def must_not_resolve_again(game_date: date) -> date | None:
        del game_date
        raise AssertionError("completed corrections must reuse the saved next date")

    correction_sink = make_sink(
        database,
        accepted_token=accepted_token,
        next_game_date_resolver=must_not_resolve_again,
    )
    correction = LiveSettlementCoordinator(provider, correction_sink).run(
        GAME_DATE, Fence()
    )

    assert correction.commands_succeeded == 1
    assert correction.lock_attempted is False
    with database.snapshot_session() as session:
        result = session.scalar(
            select(PerGameResultRow).where(PerGameResultRow.revision == 2)
        )
        game = session.scalar(select(PerGameLiveGameRow))
        assert result is not None
        assert game is not None
        assert game.next_game_date == NEXT_GAME_DATE


def test_new_empty_slate_is_retryable_and_not_persisted(database: Database) -> None:
    configure_live_ruleset(database)
    sink = make_sink(database, accepted_token={"value": 7})

    with pytest.raises(
        RetryableSettlementProviderError,
        match="empty uncorroborated slate",
    ):
        sink.prepare_slate(ProviderSlate(GAME_DATE, (), True), Fence())

    with database.snapshot_session() as session:
        assert (
            session.scalar(select(func.count()).select_from(PerGameLiveSlateRow)) == 0
        )


def test_new_slate_cannot_skip_authoritative_next_game_date(
    database: Database,
) -> None:
    configure_live_ruleset(database)
    skipped_game = replace(
        final_provider().game,
        game_date=NEXT_GAME_DATE,
        tipoff_at=TIPOFF + timedelta(days=2),
        source_fingerprint=sha("skipped-game-date"),
    )
    sink = make_sink(database, accepted_token={"value": 7})

    with pytest.raises(CoordinatorContractError, match="ruleset next game date"):
        sink.prepare_slate(
            ProviderSlate(NEXT_GAME_DATE, (skipped_game,), True),
            Fence(),
        )

    with database.snapshot_session() as session:
        assert (
            session.scalar(select(func.count()).select_from(PerGameLiveSlateRow)) == 0
        )
        assert session.scalar(select(func.count()).select_from(PerGameLiveGameRow)) == 0


def test_live_settlement_targets_configured_ruleset_with_multiple_active_rows(
    database: Database,
) -> None:
    configure_live_ruleset(database, open_sga=True)
    with database.market_write_transaction(settlement_exclusive=True) as session:
        session.add(
            PerGameRulesetRow(
                id="other-active-ruleset",
                version=9,
                season_id="2025-26",
                dividend_basis="raw_net_points",
                dividend_dollars_per_net_point=80_000,
                long_slot_limit=10,
                short_slot_limit=5,
                allow_opposing_positions=False,
                enforce_roster_lock=True,
                roster_mutations_locked=False,
                roster_lock_game_date=None,
                last_roster_lock_game_date=None,
                quote_add_impact_bps=25,
                quote_drop_impact_bps=25,
                transaction_fee_dollars=0,
                short_term_days=7,
                current_sequence=0,
                last_settled_date=None,
                next_game_date=GAME_DATE,
                event_cursor=0,
                is_active=True,
            )
        )

    sink = make_sink(database, accepted_token={"value": 7})
    run = LiveSettlementCoordinator(final_provider(), sink).run(GAME_DATE, Fence())

    assert run.commands_succeeded == 1
    assert run.unlocked is True
    with database.snapshot_session() as session:
        result_rulesets = set(session.scalars(select(PerGameResultRow.ruleset_id)))
        assert result_rulesets == {"per-game-v2-staging"}


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("version", 2, "version"),
        ("dividend_dollars_per_net_point", 80_000, "dividend rate"),
        ("enforce_roster_lock", False, "roster-lock enforcement"),
    ],
)
def test_live_ruleset_policy_mismatch_fails_before_provider_state(
    database: Database,
    field: str,
    value: object,
    message: str,
) -> None:
    configure_live_ruleset(database)
    with database.market_write_transaction(settlement_exclusive=True) as session:
        ruleset = session.get(PerGameRulesetRow, "per-game-v2-staging")
        assert ruleset is not None
        setattr(ruleset, field, value)

    sink = make_sink(database, accepted_token={"value": 7})
    with pytest.raises(CoordinatorContractError, match=message):
        sink.prepare_slate(final_provider().fetch_slate(GAME_DATE), Fence())

    with database.snapshot_session() as session:
        assert (
            session.scalar(select(func.count()).select_from(PerGameLiveSlateRow)) == 0
        )


def test_post_tipoff_open_is_excluded_even_if_sequence_matches(
    database: Database,
) -> None:
    configure_live_ruleset(database, open_sga=True)
    with database.market_write_transaction(settlement_exclusive=True) as session:
        position = session.scalar(select(PerGamePositionRow))
        assert position is not None
        position.opened_at = (TIPOFF + timedelta(seconds=1)).replace(tzinfo=None)

    run = LiveSettlementCoordinator(
        final_provider(),
        make_sink(database, accepted_token={"value": 7}),
        clock=lambda: TIPOFF,
    ).run(GAME_DATE, Fence())

    assert run.commands_succeeded == 1
    with database.snapshot_session() as session:
        assert session.scalar(select(func.count()).select_from(PerGameAccrualRow)) == 0
        game_money = session.scalar(
            select(func.count())
            .select_from(PerGameLedgerEntryRow)
            .where(PerGameLedgerEntryRow.game_id == "bdl:1001")
        )
        assert game_money == 0


def test_post_tipoff_close_remains_exposed_even_if_sequence_matches(
    database: Database,
) -> None:
    configure_live_ruleset(database, open_sga=True)
    with database.market_write_transaction(settlement_exclusive=True) as session:
        position = session.scalar(select(PerGamePositionRow))
        assert position is not None
        position.opened_at = (TIPOFF - timedelta(minutes=5)).replace(tzinfo=None)
        position.status = "closed"
        position.closed_event_sequence = position.opened_event_sequence
        position.closed_at = (TIPOFF + timedelta(seconds=1)).replace(tzinfo=None)

    run = LiveSettlementCoordinator(
        final_provider(),
        make_sink(database, accepted_token={"value": 7}),
        clock=lambda: TIPOFF,
    ).run(GAME_DATE, Fence())

    assert run.commands_succeeded == 1
    with database.snapshot_session() as session:
        assert session.scalar(select(func.count()).select_from(PerGameAccrualRow)) == 1
        ledger_kinds = list(
            session.scalars(
                select(PerGameLedgerEntryRow.kind).where(
                    PerGameLedgerEntryRow.game_id == "bdl:1001"
                )
            )
        )
        assert ledger_kinds.count("game_cost") == 1
        assert ledger_kinds.count("game_dividend") == 1


def test_restart_retries_same_idempotency_key_after_committed_response_is_lost(
    database: Database,
) -> None:
    configure_live_ruleset(database)
    accepted_token = {"value": 7}
    provider = final_provider(points=12.250000000000002)
    lost_response = LostResponseOnceTarget(
        InProcessPerGameCommandTarget(
            PerGameService(database, ruleset_id="per-game-v2-staging")
        )
    )
    first_sink = make_sink(
        database,
        accepted_token=accepted_token,
        command_target=lost_response,
    )

    first = LiveSettlementCoordinator(provider, first_sink).run(GAME_DATE, Fence())
    assert first.commands_succeeded == 0
    assert first.unlocked is False

    restarted_sink = make_sink(database, accepted_token=accepted_token)
    second = LiveSettlementCoordinator(provider, restarted_sink).run(GAME_DATE, Fence())

    assert second.commands_succeeded == 1
    assert second.unlocked is True
    with database.snapshot_session() as session:
        assert session.scalar(select(func.count()).select_from(PerGameResultRow)) == 1
        durable = session.scalar(select(PerGameLiveResultCommandRow))
        assert durable is not None
        assert durable.status == "succeeded"
        assert durable.attempt_count == 2
        assert durable.idempotency_key == lost_response.settlement_keys[0]
        assert durable.actual_net_points_micros == 12_250_000


def test_transient_roster_lock_required_delivery_retries_on_the_next_tick(
    database: Database,
) -> None:
    configure_live_ruleset(database)
    accepted_token = {"value": 7}
    target = RosterLockRequiredOnceTarget(
        InProcessPerGameCommandTarget(
            PerGameService(database, ruleset_id="per-game-v2-staging")
        )
    )
    sink = make_sink(
        database,
        accepted_token=accepted_token,
        command_target=target,
    )
    coordinator = LiveSettlementCoordinator(final_provider(), sink)

    first = coordinator.run(GAME_DATE, Fence())

    assert first.commands_succeeded == 0
    assert first.unresolved_items == 1
    with database.snapshot_session() as session:
        durable = session.scalar(select(PerGameLiveResultCommandRow))
        assert durable is not None
        assert durable.status == "pending"
        assert durable.error_code == "roster_lock_required"
        assert durable.attempt_count == 1

    second = coordinator.run(GAME_DATE, Fence())

    assert second.commands_succeeded == 1
    assert second.unlocked is True
    with database.snapshot_session() as session:
        durable = session.scalar(select(PerGameLiveResultCommandRow))
        assert durable is not None
        assert durable.status == "succeeded"
        assert durable.error_code is None
        assert durable.attempt_count == 2


def test_restart_reconciles_unlock_when_committed_response_is_lost(
    database: Database,
) -> None:
    configure_live_ruleset(database, open_sga=True)
    accepted_token = {"value": 7}
    provider = final_provider()
    lost_unlock = LostUnlockResponseOnceTarget(
        InProcessPerGameCommandTarget(
            PerGameService(database, ruleset_id="per-game-v2-staging")
        )
    )
    first_sink = make_sink(
        database,
        accepted_token=accepted_token,
        command_target=lost_unlock,
    )

    first = LiveSettlementCoordinator(provider, first_sink).run(GAME_DATE, Fence())

    assert first.commands_succeeded == 1
    assert first.unlocked is False
    assert first.unresolved_items == 1
    with database.snapshot_session() as session:
        ruleset = session.scalar(select(PerGameRulesetRow))
        slate = session.scalar(select(PerGameLiveSlateRow))
        assert ruleset is not None
        assert slate is not None
        assert ruleset.roster_mutations_locked is False
        assert ruleset.last_roster_lock_game_date == GAME_DATE
        assert slate.unlock_succeeded is False

    restarted_sink = make_sink(database, accepted_token=accepted_token)
    second = LiveSettlementCoordinator(provider, restarted_sink).run(GAME_DATE, Fence())

    assert second.unchanged_results == 1
    assert second.lock_attempted is False
    assert second.unlocked is True
    assert lost_unlock.unlock_calls == 1
    with database.snapshot_session() as session:
        slate = session.scalar(select(PerGameLiveSlateRow))
        ledger_kinds = list(
            session.scalars(
                select(PerGameLedgerEntryRow.kind).where(
                    PerGameLedgerEntryRow.game_id == "bdl:1001"
                )
            )
        )
        assert slate is not None
        assert slate.unlock_succeeded is True
        assert ledger_kinds.count("game_cost") == 1
        assert ledger_kinds.count("game_dividend") == 1


def test_lost_unlock_response_cannot_reopen_completed_manifest(
    database: Database,
) -> None:
    configure_live_ruleset(database, open_sga=True)
    accepted_token = {"value": 7}
    provider = final_provider()
    lost_unlock = LostUnlockResponseOnceTarget(
        InProcessPerGameCommandTarget(
            PerGameService(database, ruleset_id="per-game-v2-staging")
        )
    )
    first_sink = make_sink(
        database,
        accepted_token=accepted_token,
        command_target=lost_unlock,
    )

    first = LiveSettlementCoordinator(provider, first_sink).run(GAME_DATE, Fence())
    assert first.unlocked is False

    added_game = replace(
        provider.game,
        game_id="1002",
        tipoff_at=TIPOFF + timedelta(hours=2),
        home_team_id="3",
        away_team_id="4",
        source_fingerprint=sha("late-final-game"),
    )
    provider.additional_games = (added_game,)

    restarted_sink = make_sink(database, accepted_token=accepted_token)
    with pytest.raises(CoordinatorContractError, match="completed provider slate"):
        restarted_sink.prepare_slate(provider.fetch_slate(GAME_DATE), Fence())


def test_delayed_retry_reconciles_lost_unlock_after_next_date_locks(
    database: Database,
) -> None:
    configure_live_ruleset(database, open_sga=True)
    accepted_token = {"value": 7}
    provider = final_provider()
    lost_unlock = LostUnlockResponseOnceTarget(
        InProcessPerGameCommandTarget(
            PerGameService(database, ruleset_id="per-game-v2-staging")
        )
    )
    first_sink = make_sink(
        database,
        accepted_token=accepted_token,
        command_target=lost_unlock,
    )

    first = LiveSettlementCoordinator(provider, first_sink).run(GAME_DATE, Fence())
    assert first.unlocked is False

    next_tipoff = TIPOFF + timedelta(days=2)
    next_game = replace(
        provider.game,
        game_id="1002",
        game_date=NEXT_GAME_DATE,
        tipoff_at=next_tipoff,
        status="in_progress",
        source_fingerprint=sha("next-game-live"),
    )
    next_provider = Provider(next_game, provider.result)
    next_sink = make_sink(database, accepted_token=accepted_token)
    next_sink.prepare_slate(next_provider.fetch_slate(NEXT_GAME_DATE), Fence())
    next_lock = next_sink.dispatch_roster_lock(
        RosterLockCommand(game_date=NEXT_GAME_DATE, locked=True), Fence()
    )
    assert next_lock.succeeded is True

    restarted_sink = make_sink(database, accepted_token=accepted_token)
    recovered = LiveSettlementCoordinator(provider, restarted_sink).run(
        GAME_DATE, Fence()
    )

    assert recovered.lock_attempted is False
    assert recovered.unchanged_results == 1
    assert recovered.unlocked is True
    assert lost_unlock.unlock_calls == 1
    with database.snapshot_session() as session:
        ruleset = session.scalar(select(PerGameRulesetRow))
        old_slate = session.scalar(
            select(PerGameLiveSlateRow).where(
                PerGameLiveSlateRow.game_date == GAME_DATE
            )
        )
        assert ruleset is not None
        assert old_slate is not None
        assert old_slate.unlock_succeeded is True
        assert ruleset.roster_mutations_locked is True
        assert ruleset.roster_lock_game_date == NEXT_GAME_DATE
        assert ruleset.last_roster_lock_game_date == NEXT_GAME_DATE


def test_lease_expiry_inside_authoritative_service_transaction_blocks_money_write(
    database: Database,
) -> None:
    configure_live_ruleset(database)
    accepted_token = {"value": 7}
    target = ExpireBeforeWriteTarget(
        InProcessPerGameCommandTarget(
            PerGameService(database, ruleset_id="per-game-v2-staging")
        ),
        accepted_token,
    )
    sink = make_sink(
        database,
        accepted_token=accepted_token,
        command_target=target,
    )

    with pytest.raises(StaleSettlementFenceError, match="stale"):
        LiveSettlementCoordinator(final_provider(), sink).run(GAME_DATE, Fence())

    with database.snapshot_session() as session:
        assert session.scalar(select(func.count()).select_from(PerGameResultRow)) == 0
        durable = session.scalar(select(PerGameLiveResultCommandRow))
        assert durable is not None
        assert durable.status == "pending"
        assert durable.attempt_count == 1


def test_indeterminate_lease_validation_fails_closed(database: Database) -> None:
    configure_live_ruleset(database)
    sink = DatabaseLiveSettlementSink(
        database,
        fence_validator=lambda session, fence: None,
        next_game_date_resolver=lambda game_date: NEXT_GAME_DATE,
        expected_ruleset_id="per-game-v2-staging",
        expected_ruleset_version=1,
        expected_ruleset_season_id="2025-26",
        expected_dividend_dollars_per_net_point=40_000,
        expected_provider_season_id="2025",
        clock=lambda: TIPOFF - timedelta(days=1),
    )

    with pytest.raises(StaleSettlementFenceError, match="stale"):
        sink.prepare_slate(final_provider().fetch_slate(GAME_DATE), Fence())

    with database.snapshot_session() as session:
        assert (
            session.scalar(select(func.count()).select_from(PerGameLiveSlateRow)) == 0
        )
        assert session.scalar(select(func.count()).select_from(PerGameLiveGameRow)) == 0


def test_listed_player_without_quote_remains_retryable_until_provisioned(
    database: Database,
) -> None:
    configure_live_ruleset(database)
    with database.market_write_transaction(settlement_exclusive=True) as session:
        quote = session.get(
            PerGameQuoteRow,
            {"ruleset_id": "per-game-v2-staging", "player_id": "sga"},
        )
        assert quote is not None
        quote_values = {
            "current_game_cost_dollars": quote.current_game_cost_dollars,
            "prior_season_value_per_game_dollars": (
                quote.prior_season_value_per_game_dollars
            ),
            "version": quote.version,
        }
        session.delete(quote)

    sink = make_sink(database, accepted_token={"value": 7})
    provider = final_provider()
    fence = Fence()
    prepared_slate = sink.prepare_slate(provider.fetch_slate(GAME_DATE), fence)
    provider_result = provider.fetch_final_results(provider.game)[0]
    first = sink.prepare_player_settlement(
        prepared_slate.games[0],
        provider_result,
        fence,
    )

    assert first.status.value == "unresolved"
    assert first.error_code == "unmapped_player"
    with database.snapshot_session() as session:
        live_game = session.scalar(select(PerGameLiveGameRow))
        mapping = session.get(
            PerGameProviderPlayerMapRow,
            {"provider": "bdl", "provider_player_id": "115"},
        )
        assert live_game is not None
        assert live_game.ignored_player_ids == []
        assert mapping is not None

    with database.market_write_transaction(settlement_exclusive=True) as session:
        session.add(
            PerGameQuoteRow(
                ruleset_id="per-game-v2-staging",
                player_id="sga",
                **quote_values,
            )
        )

    second = sink.prepare_player_settlement(
        prepared_slate.games[0],
        provider_result,
        fence,
    )

    assert second.status.value == "ready"
    assert second.command is not None


def test_mismatched_provider_mapping_is_unresolved_and_lock_stays_held(
    database: Database,
) -> None:
    configure_live_ruleset(database)
    with database.market_write_transaction(settlement_exclusive=True) as session:
        session.add(
            PerGameProviderPlayerMapRow(
                provider="bdl",
                provider_player_id="115",
                player_id="sga",
                player_name="Shai Gilgeous-Alexander",
            )
        )
    accepted_token = {"value": 7}
    sink = make_sink(database, accepted_token=accepted_token)

    run = LiveSettlementCoordinator(
        final_provider(player_name="Not A Listed Player"), sink
    ).run(GAME_DATE, Fence())

    assert run.unresolved_items == 1
    assert run.commands_attempted == 0
    assert run.unlocked is False
    with database.snapshot_session() as session:
        ruleset = session.scalar(select(PerGameRulesetRow))
        assert ruleset is not None
        assert ruleset.roster_mutations_locked is True
        assert ruleset.roster_lock_game_date == GAME_DATE
        slate = session.scalar(select(PerGameLiveSlateRow))
        assert slate is not None
        assert slate.lock_succeeded is True
        assert slate.unlock_succeeded is False


def test_unlisted_box_score_player_is_durably_ignored_without_blocking_unlock(
    database: Database,
) -> None:
    configure_live_ruleset(database, open_sga=True)
    accepted_token = {"value": 7}
    sink = make_sink(database, accepted_token=accepted_token)
    provider = final_provider()
    provider.game = replace(
        provider.game,
        expected_player_ids=("115", "999"),
        source_fingerprint=sha("game-with-unlisted-player"),
    )
    provider.additional_results = (
        ProviderResult(
            game_id=provider.game.game_id,
            player_id="999",
            raw_net_points=8.0,
            scoring_fingerprint=sha("unlisted-player-result"),
            game_line=GameLine("Not A Listed Player"),
        ),
    )

    first = LiveSettlementCoordinator(provider, sink).run(GAME_DATE, Fence())
    second = LiveSettlementCoordinator(provider, sink).run(GAME_DATE, Fence())

    assert first.commands_succeeded == 1
    assert first.unchanged_results == 1
    assert first.unresolved_items == 0
    assert first.unlocked is True
    assert second.lock_attempted is False
    assert second.unresolved_items == 0
    with database.snapshot_session() as session:
        game = session.scalar(select(PerGameLiveGameRow))
        commands = session.scalars(select(PerGameLiveResultCommandRow)).all()
        assert game is not None
        assert game.ignored_player_ids == ["999"]
        assert [row.provider_player_id for row in commands] == ["115"]


def test_live_sink_rejects_projection_ruleset_before_provider_state_is_written(
    database: Database,
) -> None:
    configure_live_ruleset(database)
    with database.market_write_transaction(settlement_exclusive=True) as session:
        ruleset = session.scalar(select(PerGameRulesetRow).with_for_update())
        assert ruleset is not None
        ruleset.dividend_basis = "surprise_vs_projection"
    sink = make_sink(database, accepted_token={"value": 7})

    with pytest.raises(CoordinatorContractError, match="raw-net-points"):
        sink.prepare_slate(final_provider().fetch_slate(GAME_DATE), Fence())

    with database.snapshot_session() as session:
        assert (
            session.scalar(select(func.count()).select_from(PerGameLiveSlateRow)) == 0
        )
        assert session.scalar(select(func.count()).select_from(PerGameLiveGameRow)) == 0


def test_sink_rejects_direct_unlock_until_every_base_result_succeeds(
    database: Database,
) -> None:
    configure_live_ruleset(database)
    accepted_token = {"value": 7}
    sink = make_sink(database, accepted_token=accepted_token)
    provider = final_provider()
    fence = Fence()
    slate = sink.prepare_slate(provider.fetch_slate(GAME_DATE), fence)

    lock = sink.dispatch_roster_lock(
        RosterLockCommand(game_date=GAME_DATE, locked=True), fence
    )
    premature_unlock = sink.dispatch_roster_lock(
        RosterLockCommand(game_date=GAME_DATE, locked=False), fence
    )

    assert lock.succeeded is True
    assert premature_unlock.succeeded is False
    assert premature_unlock.error_code == "unlock_preconditions_not_met"
    assert sink.can_unlock(slate, fence) is False
    with database.snapshot_session() as session:
        ruleset = session.scalar(select(PerGameRulesetRow))
        assert ruleset is not None
        assert ruleset.roster_mutations_locked is True
        assert ruleset.roster_lock_game_date == GAME_DATE


def test_sink_rejects_direct_unlock_until_date_completion_succeeds(
    database: Database,
) -> None:
    configure_live_ruleset(database)
    accepted_token = {"value": 7}
    sink = make_sink(database, accepted_token=accepted_token)
    provider = final_provider(player_name="Not A Listed Player")
    fence = Fence()
    slate = sink.prepare_slate(provider.fetch_slate(GAME_DATE), fence)
    assert sink.dispatch_roster_lock(
        RosterLockCommand(game_date=GAME_DATE, locked=True), fence
    ).succeeded
    slate = sink.prepare_slate(provider.fetch_slate(GAME_DATE), fence)
    result = provider.fetch_final_results(provider.game)[0]
    assert (
        sink.prepare_player_settlement(slate.games[0], result, fence).status.value
        == "unchanged"
    )
    assert sink.can_unlock(slate, fence) is True

    early_unlock = sink.dispatch_roster_lock(
        RosterLockCommand(game_date=GAME_DATE, locked=False), fence
    )
    assert early_unlock.succeeded is False
    assert early_unlock.error_code == "date_completion_required"
    assert sink.dispatch_date_completion(slate, fence).succeeded is True
    assert (
        sink.dispatch_roster_lock(
            RosterLockCommand(game_date=GAME_DATE, locked=False), fence
        ).succeeded
        is True
    )


def test_sink_uses_persisted_tipoff_to_lock_stale_scheduled_game(
    database: Database,
) -> None:
    configure_live_ruleset(database)
    accepted_token = {"value": 7}
    sink = make_sink(database, accepted_token=accepted_token)
    provider = final_provider()
    provider.game = replace(
        provider.game,
        status="scheduled",
        expected_player_ids=(),
        source_fingerprint=sha("game-scheduled"),
    )
    fence = Fence()
    sink.prepare_slate(provider.fetch_slate(GAME_DATE), fence)

    assert (
        sink.requires_roster_lock(
            GAME_DATE,
            TIPOFF - timedelta(seconds=1),
            fence,
        )
        is False
    )
    assert sink.requires_roster_lock(GAME_DATE, TIPOFF, fence) is True


def test_sink_does_not_relock_an_unlocked_completed_slate(
    database: Database,
) -> None:
    configure_live_ruleset(database, open_sga=True)
    accepted_token = {"value": 7}
    sink = make_sink(database, accepted_token=accepted_token)
    provider = final_provider()
    coordinator = LiveSettlementCoordinator(provider, sink, clock=lambda: TIPOFF)

    settled = coordinator.run(GAME_DATE, Fence())

    assert settled.unlocked is True
    assert sink.requires_roster_lock(GAME_DATE, TIPOFF, Fence()) is False


def test_sink_rejects_provider_or_ruleset_season_mismatch_before_persistence(
    database: Database,
) -> None:
    configure_live_ruleset(database)
    sink = make_sink(database, accepted_token={"value": 7})
    wrong_provider_game = replace(
        final_provider().game,
        season_id="2026",
        source_fingerprint=sha("wrong-provider-season"),
    )

    with pytest.raises(CoordinatorContractError, match="provider slate season"):
        sink.prepare_slate(
            ProviderSlate(GAME_DATE, (wrong_provider_game,), True),
            Fence(),
        )

    with database.market_write_transaction(settlement_exclusive=True) as session:
        ruleset = session.scalar(select(PerGameRulesetRow))
        assert ruleset is not None
        ruleset.season_id = "2026-27"

    with pytest.raises(CoordinatorContractError, match="active ruleset season"):
        sink.prepare_slate(final_provider().fetch_slate(GAME_DATE), Fence())

    with database.snapshot_session() as session:
        assert (
            session.scalar(select(func.count()).select_from(PerGameLiveSlateRow)) == 0
        )
        assert session.scalar(select(func.count()).select_from(PerGameLiveGameRow)) == 0


def test_open_slate_accepts_added_game_and_keeps_stable_sequences(
    database: Database,
) -> None:
    configure_live_ruleset(database)
    sink = make_sink(database, accepted_token={"value": 7})
    game_a = replace(
        final_provider().game,
        status="scheduled",
        expected_player_ids=(),
        source_fingerprint=sha("game-a-scheduled"),
    )
    game_b = replace(
        game_a,
        game_id="1002",
        tipoff_at=TIPOFF + timedelta(hours=2),
        home_team_id="3",
        away_team_id="4",
        source_fingerprint=sha("game-b-scheduled"),
    )

    first = sink.prepare_slate(ProviderSlate(GAME_DATE, (game_a,), True), Fence())
    second = sink.prepare_slate(
        ProviderSlate(GAME_DATE, (game_a, game_b), True), Fence()
    )

    assert [game.boundary.provider_game_id for game in first.games] == ["1001"]
    assert [game.boundary.provider_game_id for game in second.games] == [
        "1001",
        "1002",
    ]
    assert (
        second.games[0].boundary.event_sequence
        == first.games[0].boundary.event_sequence
    )
    assert (
        second.games[1].boundary.event_sequence
        > second.games[0].boundary.event_sequence
    )
    with database.snapshot_session() as session:
        slate = session.scalar(select(PerGameLiveSlateRow))
        assert slate is not None
        assert slate.expected_game_ids == ["1001", "1002"]


def test_removed_scheduled_game_stays_auditable_but_does_not_block_unlock(
    database: Database,
) -> None:
    configure_live_ruleset(database, open_sga=True)
    sink = make_sink(database, accepted_token={"value": 7})
    game_a = replace(
        final_provider().game,
        status="scheduled",
        expected_player_ids=(),
        source_fingerprint=sha("game-a-scheduled"),
    )
    game_b = replace(
        game_a,
        game_id="1002",
        tipoff_at=TIPOFF + timedelta(hours=2),
        home_team_id="3",
        away_team_id="4",
        source_fingerprint=sha("game-b-scheduled"),
    )
    sink.prepare_slate(ProviderSlate(GAME_DATE, (game_a, game_b), True), Fence())
    sink.prepare_slate(
        ProviderSlate(GAME_DATE, (final_provider().game,), True), Fence()
    )

    run = LiveSettlementCoordinator(final_provider(), sink, clock=lambda: TIPOFF).run(
        GAME_DATE, Fence()
    )

    assert run.commands_succeeded == 1
    assert run.unlocked is True
    with database.snapshot_session() as session:
        slate = session.scalar(select(PerGameLiveSlateRow))
        games = session.scalars(
            select(PerGameLiveGameRow).order_by(PerGameLiveGameRow.provider_game_id)
        ).all()
        assert slate is not None
        assert slate.expected_game_ids == ["1001"]
        assert [game.provider_game_id for game in games] == ["1001", "1002"]


def test_locked_slate_cannot_drop_future_scheduled_game_on_partial_poll(
    database: Database,
) -> None:
    configure_live_ruleset(database)
    sink = make_sink(database, accepted_token={"value": 7})
    game_a = replace(
        final_provider().game,
        status="scheduled",
        expected_player_ids=(),
        source_fingerprint=sha("game-a-scheduled"),
    )
    game_b = replace(
        game_a,
        game_id="1002",
        tipoff_at=TIPOFF + timedelta(hours=2),
        home_team_id="3",
        away_team_id="4",
        source_fingerprint=sha("game-b-scheduled"),
    )
    sink.prepare_slate(ProviderSlate(GAME_DATE, (game_a, game_b), True), Fence())
    assert sink.dispatch_roster_lock(
        RosterLockCommand(game_date=GAME_DATE, locked=True), Fence()
    ).succeeded

    with pytest.raises(CoordinatorContractError, match="locked provider slate"):
        sink.prepare_slate(ProviderSlate(GAME_DATE, (game_a,), True), Fence())

    with database.snapshot_session() as session:
        slate = session.scalar(select(PerGameLiveSlateRow))
        assert slate is not None
        assert slate.expected_game_ids == ["1001", "1002"]


def test_provider_cannot_remove_scheduled_game_at_or_after_tipoff(
    database: Database,
) -> None:
    configure_live_ruleset(database)
    sink = make_sink(
        database,
        accepted_token={"value": 7},
        clock=lambda: TIPOFF,
    )
    scheduled = replace(
        final_provider().game,
        status="scheduled",
        expected_player_ids=(),
        source_fingerprint=sha("scheduled-at-tipoff"),
    )
    sink.prepare_slate(ProviderSlate(GAME_DATE, (scheduled,), True), Fence())

    with pytest.raises(CoordinatorContractError, match="at or after tipoff"):
        sink.prepare_slate(ProviderSlate(GAME_DATE, (), True), Fence())

    with database.snapshot_session() as session:
        slate = session.scalar(select(PerGameLiveSlateRow))
        assert slate is not None
        assert slate.expected_game_ids == ["1001"]


@pytest.mark.parametrize("status", ["in_progress", "final"])
def test_provider_cannot_remove_started_or_final_game(
    database: Database,
    status: str,
) -> None:
    configure_live_ruleset(database)
    sink = make_sink(database, accepted_token={"value": 7})
    game = replace(
        final_provider().game,
        status=status,
        expected_player_ids=(("115",) if status == "final" else ()),
        source_fingerprint=sha(f"game-{status}"),
    )
    sink.prepare_slate(ProviderSlate(GAME_DATE, (game,), True), Fence())

    with pytest.raises(CoordinatorContractError, match=f"remove {status} game"):
        sink.prepare_slate(ProviderSlate(GAME_DATE, (), True), Fence())


def test_provider_cannot_remove_game_with_durable_result_command(
    database: Database,
) -> None:
    configure_live_ruleset(database)
    accepted_token = {"value": 7}
    target = LostResponseOnceTarget(
        InProcessPerGameCommandTarget(
            PerGameService(database, ruleset_id="per-game-v2-staging")
        )
    )
    sink = make_sink(
        database,
        accepted_token=accepted_token,
        command_target=target,
    )
    first = LiveSettlementCoordinator(final_provider(), sink).run(GAME_DATE, Fence())
    assert first.commands_succeeded == 0
    with database.market_write_transaction(settlement_exclusive=True) as session:
        game = session.scalar(select(PerGameLiveGameRow).with_for_update())
        assert game is not None
        game.status = "cancelled"

    with pytest.raises(CoordinatorContractError, match="durable result commands"):
        sink.prepare_slate(ProviderSlate(GAME_DATE, (), True), Fence())


def test_unlocked_slate_rejects_manifest_change(
    database: Database,
) -> None:
    configure_live_ruleset(database, open_sga=True)
    sink = make_sink(database, accepted_token={"value": 7})
    settled = LiveSettlementCoordinator(final_provider(), sink).run(GAME_DATE, Fence())
    assert settled.unlocked is True
    game_b = replace(
        final_provider().game,
        game_id="1002",
        tipoff_at=TIPOFF + timedelta(hours=2),
        status="scheduled",
        home_team_id="3",
        away_team_id="4",
        expected_player_ids=(),
        source_fingerprint=sha("game-b-scheduled"),
    )

    with pytest.raises(CoordinatorContractError, match="completed provider slate"):
        sink.prepare_slate(
            ProviderSlate(GAME_DATE, (final_provider().game, game_b), True),
            Fence(),
        )


def test_postponed_game_can_reappear_with_revised_tipoff_before_lock(
    database: Database,
) -> None:
    configure_live_ruleset(database)
    sink = make_sink(database, accepted_token={"value": 7})
    postponed = replace(
        final_provider().game,
        status="postponed",
        expected_player_ids=(),
        source_fingerprint=sha("game-postponed"),
    )
    sink.prepare_slate(ProviderSlate(GAME_DATE, (postponed,), True), Fence())
    sink.prepare_slate(ProviderSlate(GAME_DATE, (), True), Fence())
    revised_tipoff = TIPOFF + timedelta(hours=3)
    scheduled = replace(
        postponed,
        tipoff_at=revised_tipoff,
        status="scheduled",
        source_fingerprint=sha("game-rescheduled"),
    )

    prepared = sink.prepare_slate(ProviderSlate(GAME_DATE, (scheduled,), True), Fence())

    assert prepared.games[0].boundary.game_started_at == revised_tipoff
    with database.snapshot_session() as session:
        game = session.scalar(select(PerGameLiveGameRow))
        assert game is not None
        assert game.status == "scheduled"
        assert game.started_at == revised_tipoff.replace(tzinfo=None)


def test_tipoff_revision_after_roster_lock_fails_closed(
    database: Database,
) -> None:
    configure_live_ruleset(database)
    sink = make_sink(database, accepted_token={"value": 7})
    scheduled = replace(
        final_provider().game,
        status="scheduled",
        expected_player_ids=(),
        source_fingerprint=sha("game-scheduled"),
    )
    sink.prepare_slate(ProviderSlate(GAME_DATE, (scheduled,), True), Fence())
    assert sink.dispatch_roster_lock(
        RosterLockCommand(game_date=GAME_DATE, locked=True), Fence()
    ).succeeded
    revised = replace(
        scheduled,
        tipoff_at=TIPOFF + timedelta(minutes=30),
        source_fingerprint=sha("game-revised-after-lock"),
    )

    with pytest.raises(CoordinatorContractError, match="frozen started_at"):
        sink.prepare_slate(ProviderSlate(GAME_DATE, (revised,), True), Fence())


def test_terminal_update_without_tipoff_preserves_known_locked_boundary(
    database: Database,
) -> None:
    configure_live_ruleset(database)
    sink = make_sink(database, accepted_token={"value": 7})
    scheduled = replace(
        final_provider().game,
        status="scheduled",
        expected_player_ids=(),
        source_fingerprint=sha("scheduled-with-known-tipoff"),
    )
    initial = sink.prepare_slate(ProviderSlate(GAME_DATE, (scheduled,), True), Fence())
    assert sink.dispatch_roster_lock(
        RosterLockCommand(game_date=GAME_DATE, locked=True), Fence()
    ).succeeded
    terminal = replace(
        scheduled,
        tipoff_at=datetime(2026, 10, 22, tzinfo=UTC),
        tipoff_known=False,
        status="postponed",
        source_fingerprint=sha("postponed-without-tipoff"),
    )

    updated = sink.prepare_slate(ProviderSlate(GAME_DATE, (terminal,), True), Fence())

    assert initial.games[0].boundary.game_started_at == TIPOFF
    assert updated.games == ()
    with database.snapshot_session() as session:
        row = session.scalar(select(PerGameLiveGameRow))
        assert row is not None
        assert row.status == "postponed"
        assert DatabaseLiveSettlementSink._aware_db_datetime(row.started_at) == TIPOFF


@pytest.mark.parametrize("terminal_status", ["postponed", "cancelled"])
def test_excluded_game_cannot_change_tipoff_while_date_lock_is_held(
    database: Database,
    terminal_status: str,
) -> None:
    configure_live_ruleset(database)
    sink = make_sink(database, accepted_token={"value": 7})
    scheduled = replace(
        final_provider().game,
        status="scheduled",
        expected_player_ids=(),
        source_fingerprint=sha("scheduled-before-terminal-transition"),
    )
    sink.prepare_slate(ProviderSlate(GAME_DATE, (scheduled,), True), Fence())
    assert sink.dispatch_roster_lock(
        RosterLockCommand(game_date=GAME_DATE, locked=True), Fence()
    ).succeeded
    changed_boundary = replace(
        scheduled,
        status=terminal_status,
        tipoff_at=TIPOFF + timedelta(hours=1),
        source_fingerprint=sha(f"{terminal_status}-with-revised-tipoff"),
    )

    with pytest.raises(CoordinatorContractError, match="frozen started_at"):
        sink.prepare_slate(ProviderSlate(GAME_DATE, (changed_boundary,), True), Fence())

    with database.snapshot_session() as session:
        slate = session.scalar(select(PerGameLiveSlateRow))
        game = session.scalar(select(PerGameLiveGameRow))
        assert slate is not None
        assert game is not None
        assert slate.expected_game_ids == ["1001"]
        assert game.status == "scheduled"
        assert game.started_at == TIPOFF.replace(tzinfo=None)


@pytest.mark.parametrize("terminal_status", ["postponed", "cancelled"])
def test_nonsettling_terminal_game_transfers_to_rescheduled_date_after_unlock(
    database: Database,
    terminal_status: str,
) -> None:
    configure_live_ruleset(database, open_sga=True)
    sink = make_sink(database, accepted_token={"value": 7})
    provider = final_provider()
    deferred = replace(
        provider.game,
        game_id="1002",
        tipoff_at=TIPOFF + timedelta(hours=2),
        status=terminal_status,
        home_team_id="3",
        away_team_id="4",
        expected_player_ids=(),
        source_fingerprint=sha(f"game-b-{terminal_status}"),
    )
    provider.additional_games = (deferred,)

    first = LiveSettlementCoordinator(provider, sink).run(GAME_DATE, Fence())
    assert first.unlocked is True
    with database.snapshot_session() as session:
        old_slate = session.scalar(
            select(PerGameLiveSlateRow).where(
                PerGameLiveSlateRow.game_date == GAME_DATE
            )
        )
        assert old_slate is not None
        assert old_slate.expected_game_ids == ["1001"]

    rescheduled_date = NEXT_GAME_DATE
    rescheduled_tipoff = TIPOFF + timedelta(days=2)
    rescheduled = replace(
        deferred,
        game_date=rescheduled_date,
        tipoff_at=rescheduled_tipoff,
        status="scheduled",
        source_fingerprint=sha("game-b-rescheduled"),
    )

    prepared = sink.prepare_slate(
        ProviderSlate(rescheduled_date, (rescheduled,), True),
        Fence(),
    )

    assert prepared.games[0].boundary.game_date == rescheduled_date
    assert prepared.games[0].boundary.game_started_at == rescheduled_tipoff
    with database.snapshot_session() as session:
        game = session.scalar(
            select(PerGameLiveGameRow).where(
                PerGameLiveGameRow.provider_game_id == "1002"
            )
        )
        new_slate = session.scalar(
            select(PerGameLiveSlateRow).where(
                PerGameLiveSlateRow.game_date == rescheduled_date
            )
        )
        assert game is not None
        assert new_slate is not None
        assert game.game_date == rescheduled_date
        assert game.status == "scheduled"
        assert game.schedule_history == [
            {
                "game_date": GAME_DATE.isoformat(),
                "started_at": deferred.tipoff_at.isoformat(),
                "next_game_date": NEXT_GAME_DATE.isoformat(),
                "event_sequence": 1,
                "status": terminal_status,
                "source_fingerprint": deferred.source_fingerprint,
            }
        ]
        assert new_slate.expected_game_ids == ["1002"]
