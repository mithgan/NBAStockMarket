from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

import pytest

from nba_stock_market.live_settlement import (
    CommandDispatch,
    CoordinatorContractError,
    GameSettlementBoundary,
    LiveSettlementCoordinator,
    PlayerPreparation,
    PlayerSettlementCommand,
    PreparedGame,
    PreparedSlate,
    RetryableSettlementProviderError,
    RosterLockCommand,
    StaleSettlementFenceError,
)


GAME_DATE = date(2026, 10, 22)
NEXT_GAME_DATE = date(2026, 10, 24)


@dataclass(frozen=True)
class FakeFence:
    owner_id: str = "worker-a"
    fencing_token: int = 7


@dataclass(frozen=True)
class FakeGame:
    game_id: str
    game_date: date
    status: str
    expected_player_ids: frozenset[str]
    tipoff_at: datetime = datetime(2026, 10, 22, 23, tzinfo=timezone.utc)
    source_fingerprint: str = "game-source-a"


@dataclass(frozen=True)
class FakeResult:
    game_id: str
    player_id: str
    raw_net_points: float
    scoring_fingerprint: str


@dataclass(frozen=True)
class FakeSlate:
    game_date: date
    games: tuple[FakeGame, ...]
    schedule_complete: bool


class RetryableFetchError(RetryableSettlementProviderError):
    pass


class PermanentFetchError(RuntimeError):
    pass


class FakeProvider:
    def __init__(
        self,
        slate: FakeSlate,
        results: dict[str, tuple[FakeResult, ...]] | None = None,
    ) -> None:
        self.slate = slate
        self.results = results or {}
        self.fetch_result_calls: list[str] = []
        self.fetch_failures: dict[str, int] = {}
        self.fetch_slate_failures = 0
        self.events: list[tuple[str, object]] = []

    def fetch_slate(self, game_date: date) -> FakeSlate:
        self.events.append(("fetch_slate", game_date))
        assert game_date == self.slate.game_date
        if self.fetch_slate_failures:
            self.fetch_slate_failures -= 1
            raise RetryableFetchError("slate temporarily unavailable")
        return self.slate

    def fetch_final_results(self, game: FakeGame) -> tuple[FakeResult, ...]:
        self.fetch_result_calls.append(game.game_id)
        remaining_failures = self.fetch_failures.get(game.game_id, 0)
        if remaining_failures:
            self.fetch_failures[game.game_id] = remaining_failures - 1
            raise RetryableFetchError(f"results not ready for {game.game_id}")
        return self.results.get(game.game_id, ())


@dataclass
class _StoredCommand:
    command: PlayerSettlementCommand
    delivered: bool = False


class FakeDurableSink:
    def __init__(
        self,
        *,
        player_mapping: dict[str, str],
        next_game_date: date | None = NEXT_GAME_DATE,
    ) -> None:
        self.player_mapping = player_mapping
        self.next_game_date = next_game_date
        self.accepted_fencing_token = 7
        self.boundaries: dict[str, GameSettlementBoundary] = {}
        self.manifests: dict[date, PreparedSlate] = {}
        self.commands: dict[tuple[str, str, int], _StoredCommand] = {}
        self.latest: dict[tuple[str, str], _StoredCommand] = {}
        self.fail_dispatches: dict[str, int] = {}
        self.fail_lock_dispatches = 0
        self.commit_lock_before_failure = False
        self.expire_on_settlement = False
        self.locked_date: date | None = None
        self.completed_dates: set[date] = set()
        self.unlocked_dates: set[date] = set()
        self.events: list[tuple[str, object]] = []

    def _assert_fence(self, fence: FakeFence) -> None:
        if fence.fencing_token != self.accepted_fencing_token:
            raise StaleSettlementFenceError(
                f"stale fence {fence.fencing_token}; current is "
                f"{self.accepted_fencing_token}"
            )

    def prepare_slate(self, slate: FakeSlate, fence: FakeFence) -> PreparedSlate:
        self._assert_fence(fence)
        prepared_games: list[PreparedGame] = []
        for source_game in slate.games:
            boundary = self.boundaries.get(source_game.game_id)
            if boundary is None:
                boundary = GameSettlementBoundary(
                    provider="bdl",
                    provider_game_id=source_game.game_id,
                    game_id=f"bdl:{source_game.game_id}",
                    game_date=source_game.game_date,
                    game_started_at=source_game.tipoff_at,
                    next_game_date=self.next_game_date,
                    event_sequence=100 + len(self.boundaries),
                )
                self.boundaries[source_game.game_id] = boundary
            prepared_games.append(
                PreparedGame(provider_game=source_game, boundary=boundary)
            )
        prepared = PreparedSlate(
            game_date=slate.game_date,
            games=tuple(prepared_games),
            schedule_complete=slate.schedule_complete,
        )
        self.manifests[slate.game_date] = prepared
        self.events.append(("prepare_slate", prepared))
        return prepared

    def requires_roster_lock(
        self,
        game_date: date,
        observed_at: datetime,
        fence: FakeFence,
    ) -> bool:
        self._assert_fence(fence)
        self.events.append(("preflight", observed_at))
        if game_date in self.unlocked_dates:
            return False
        if self.locked_date == game_date:
            return True
        manifest = self.manifests.get(game_date)
        if manifest is None:
            return False
        if manifest.schedule_complete and not manifest.games:
            return game_date not in self.completed_dates
        for prepared in manifest.games:
            game = prepared.provider_game
            if game.status in {"in_progress", "final"}:
                return True
            if game.status == "scheduled" and game.tipoff_at <= observed_at:
                return True
        return False

    def dispatch_roster_lock(
        self, command: RosterLockCommand, fence: FakeFence
    ) -> CommandDispatch:
        self._assert_fence(fence)
        self.events.append(("lock" if command.locked else "unlock", command))
        if command.locked and self.fail_lock_dispatches:
            self.fail_lock_dispatches -= 1
            if self.commit_lock_before_failure:
                self.locked_date = command.game_date
                self.unlocked_dates.discard(command.game_date)
            return CommandDispatch.retryable_failure("ambiguous_lock_delivery")
        if command.locked:
            self.locked_date = command.game_date
            self.unlocked_dates.discard(command.game_date)
        elif self.locked_date == command.game_date:
            if command.game_date not in self.completed_dates:
                return CommandDispatch.retryable_failure("date_completion_required")
            self.locked_date = None
            self.unlocked_dates.add(command.game_date)
        return CommandDispatch.success()

    def prepare_player_settlement(
        self,
        game: PreparedGame,
        result: FakeResult,
        fence: FakeFence,
    ) -> PlayerPreparation:
        self._assert_fence(fence)
        key = (game.boundary.provider_game_id, result.player_id)
        existing = self.latest.get(key)
        if existing is not None and not existing.delivered:
            return PlayerPreparation.ready(existing.command)
        if (
            existing is not None
            and existing.command.result_fingerprint == result.scoring_fingerprint
        ):
            return PlayerPreparation.unchanged()
        player_id = self.player_mapping.get(result.player_id)
        if player_id is None:
            return PlayerPreparation.unresolved("unmapped_player")
        command = PlayerSettlementCommand(
            boundary=game.boundary,
            provider_player_id=result.player_id,
            player_id=player_id,
            result_fingerprint=result.scoring_fingerprint,
            previous_revision=(
                existing.command.result_revision if existing is not None else None
            ),
            actual_net_points=result.raw_net_points,
        )
        stored = _StoredCommand(command=command)
        self.latest[key] = stored
        self.commands[
            (game.boundary.provider_game_id, result.player_id, command.result_revision)
        ] = stored
        return PlayerPreparation.ready(command)

    def dispatch_player_settlement(
        self, command: PlayerSettlementCommand, fence: FakeFence
    ) -> CommandDispatch:
        self._assert_fence(fence)
        self.events.append(("settle", command))
        if self.expire_on_settlement:
            self.accepted_fencing_token += 1
            raise StaleSettlementFenceError("lease changed during dispatch")
        remaining_failures = self.fail_dispatches.get(command.provider_player_id, 0)
        if remaining_failures:
            self.fail_dispatches[command.provider_player_id] = remaining_failures - 1
            return CommandDispatch.retryable_failure("ambiguous_delivery")
        stored = self.commands[
            (
                command.boundary.provider_game_id,
                command.provider_player_id,
                command.result_revision,
            )
        ]
        stored.delivered = True
        return CommandDispatch.success()

    def can_unlock(self, slate: PreparedSlate, fence: FakeFence) -> bool:
        self._assert_fence(fence)
        self.events.append(("can_unlock", slate.game_date))
        if self.locked_date != slate.game_date or not slate.schedule_complete:
            return False
        terminal = {"final", "postponed", "cancelled"}
        for prepared_game in slate.games:
            game = prepared_game.provider_game
            if game.status not in terminal:
                return False
            if game.status != "final":
                continue
            for player_id in game.expected_player_ids:
                base = self.commands.get((game.game_id, player_id, 1))
                if base is None or not base.delivered:
                    return False
        return True

    def dispatch_date_completion(
        self, slate: PreparedSlate, fence: FakeFence
    ) -> CommandDispatch:
        self._assert_fence(fence)
        self.events.append(("complete_date", slate.game_date))
        if not self.can_unlock(slate, fence):
            return CommandDispatch.retryable_failure(
                "date_completion_preconditions_not_met"
            )
        self.completed_dates.add(slate.game_date)
        return CommandDispatch.success()


def _final_game(
    game_id: str = "1001", player_ids: tuple[str, ...] = ("11",)
) -> FakeGame:
    return FakeGame(
        game_id=game_id,
        game_date=GAME_DATE,
        status="final",
        expected_player_ids=frozenset(player_ids),
    )


def _result(
    player_id: str,
    *,
    game_id: str = "1001",
    points: float = 20.0,
    fingerprint: str = "fingerprint-a",
) -> FakeResult:
    return FakeResult(
        game_id=game_id,
        player_id=player_id,
        raw_net_points=points,
        scoring_fingerprint=fingerprint,
    )


def _settle_events(sink: FakeDurableSink) -> list[PlayerSettlementCommand]:
    return [event for kind, event in sink.events if kind == "settle"]


def test_bdl_non_final_games_never_fetch_or_emit_settlement_commands() -> None:
    games = (
        FakeGame("scheduled", GAME_DATE, "scheduled", frozenset({"11"})),
        FakeGame("live", GAME_DATE, "in_progress", frozenset({"12"})),
    )
    provider = FakeProvider(FakeSlate(GAME_DATE, games, schedule_complete=True))
    sink = FakeDurableSink(player_mapping={"11": "alpha", "12": "beta"})

    result = LiveSettlementCoordinator(provider, sink).run(GAME_DATE, FakeFence())

    assert provider.fetch_result_calls == []
    assert _settle_events(sink) == []
    assert [kind for kind, _ in sink.events].count("lock") == 1
    assert [kind for kind, _ in sink.events].count("unlock") == 0
    assert result.final_games_seen == 0
    assert result.lock_acquired is True


def test_bdl_revision_one_locks_before_settlement_and_uses_prepared_boundary() -> None:
    game = _final_game(player_ids=("11", "12"))
    provider = FakeProvider(
        FakeSlate(GAME_DATE, (game,), schedule_complete=True),
        {"1001": (_result("11"), _result("12", points=9.5))},
    )
    sink = FakeDurableSink(player_mapping={"11": "alpha", "12": "beta"})

    result = LiveSettlementCoordinator(provider, sink).run(GAME_DATE, FakeFence())

    event_names = [kind for kind, _ in sink.events]
    assert event_names.index("lock") < event_names.index("settle")
    assert event_names[-1] == "unlock"
    commands = _settle_events(sink)
    assert [command.player_id for command in commands] == ["alpha", "beta"]
    assert {command.boundary for command in commands} == {sink.boundaries[game.game_id]}
    assert commands[0].payload == {
        "game_id": "bdl:1001",
        "player_id": "alpha",
        "game_date": GAME_DATE,
        "game_started_at": game.tipoff_at,
        "next_game_date": NEXT_GAME_DATE,
        "event_sequence": 100,
        "result_revision": 1,
        "actual_net_points": 20.0,
    }
    assert result.commands_succeeded == 2
    assert result.unlocked is True


def test_bdl_partial_retry_reuses_command_without_duplicating_success() -> None:
    game = _final_game(player_ids=("11", "12"))
    provider = FakeProvider(
        FakeSlate(GAME_DATE, (game,), schedule_complete=True),
        {"1001": (_result("11"), _result("12", points=9.5))},
    )
    sink = FakeDurableSink(player_mapping={"11": "alpha", "12": "beta"})
    sink.fail_dispatches["12"] = 1
    coordinator = LiveSettlementCoordinator(provider, sink)

    first = coordinator.run(GAME_DATE, FakeFence())
    first_attempts = list(_settle_events(sink))
    assert sink.locked_date == GAME_DATE
    second = coordinator.run(GAME_DATE, FakeFence())
    all_attempts = _settle_events(sink)

    alpha_attempts = [c for c in all_attempts if c.provider_player_id == "11"]
    beta_attempts = [c for c in all_attempts if c.provider_player_id == "12"]
    assert len(alpha_attempts) == 1
    assert len(beta_attempts) == 2
    assert beta_attempts[0] is beta_attempts[1]
    assert beta_attempts[0].idempotency_key == beta_attempts[1].idempotency_key
    assert beta_attempts[0].payload == beta_attempts[1].payload
    assert first_attempts == [alpha_attempts[0], beta_attempts[0]]
    assert first.unlocked is False
    assert sink.locked_date is None
    assert second.unlocked is True


def test_bdl_unchanged_is_noop_and_a_b_a_allocates_revisions_one_two_three() -> None:
    game = _final_game()
    provider = FakeProvider(
        FakeSlate(GAME_DATE, (game,), schedule_complete=True),
        {"1001": (_result("11"),)},
    )
    sink = FakeDurableSink(player_mapping={"11": "alpha"})
    coordinator = LiveSettlementCoordinator(provider, sink)

    first = coordinator.run(GAME_DATE, FakeFence())
    unchanged = coordinator.run(GAME_DATE, FakeFence())
    provider.results["1001"] = (
        _result("11", points=21.0, fingerprint="fingerprint-b"),
    )
    correction = coordinator.run(GAME_DATE, FakeFence())
    provider.results["1001"] = (_result("11"),)
    reverted = coordinator.run(GAME_DATE, FakeFence())

    commands = _settle_events(sink)
    assert [command.result_revision for command in commands] == [1, 2, 3]
    assert len({command.idempotency_key for command in commands}) == 3
    assert [kind for kind, _ in sink.events].count("lock") == 1
    assert [kind for kind, _ in sink.events].count("unlock") == 1
    assert first.unlocked is True
    assert unchanged.unchanged_results == 1
    assert unchanged.commands_attempted == 0
    assert correction.commands_succeeded == 1
    assert reverted.commands_succeeded == 1


def test_bdl_incomplete_manifest_and_provider_failure_retain_lock() -> None:
    game_a = _final_game("1001", ("11",))
    game_b = _final_game("1002", ("12",))
    provider = FakeProvider(
        FakeSlate(GAME_DATE, (game_a, game_b), schedule_complete=False),
        {
            "1001": (_result("11", game_id="1001"),),
            "1002": (_result("12", game_id="1002"),),
        },
    )
    provider.fetch_failures["1002"] = 1
    sink = FakeDurableSink(player_mapping={"11": "alpha", "12": "beta"})
    coordinator = LiveSettlementCoordinator(provider, sink)

    first = coordinator.run(GAME_DATE, FakeFence())
    assert sink.locked_date == GAME_DATE
    provider.slate = FakeSlate(GAME_DATE, (game_a, game_b), schedule_complete=True)
    second = coordinator.run(GAME_DATE, FakeFence())

    commands = _settle_events(sink)
    assert [command.provider_player_id for command in commands] == ["11", "12"]
    assert first.unresolved_items == 1
    assert first.unlocked is False
    assert second.unlocked is True
    assert [kind for kind, _ in sink.events].count("lock") == 2
    assert [kind for kind, _ in sink.events].count("unlock") == 1


def test_bdl_permanent_provider_failure_is_not_mislabeled_as_retryable() -> None:
    game = _final_game()

    class PermanentFailureProvider(FakeProvider):
        def fetch_final_results(self, game: FakeGame) -> tuple[FakeResult, ...]:
            raise PermanentFetchError(f"invalid provider contract for {game.game_id}")

    provider = PermanentFailureProvider(
        FakeSlate(GAME_DATE, (game,), schedule_complete=True)
    )
    sink = FakeDurableSink(player_mapping={"11": "alpha"})

    with pytest.raises(PermanentFetchError, match="invalid provider contract"):
        LiveSettlementCoordinator(provider, sink).run(GAME_DATE, FakeFence())

    assert sink.locked_date == GAME_DATE
    assert [kind for kind, _ in sink.events].count("unlock") == 0


def test_persisted_tipoff_locks_before_retryable_provider_poll_failure() -> None:
    game = FakeGame(
        game_id="1001",
        game_date=GAME_DATE,
        status="scheduled",
        expected_player_ids=frozenset(),
    )
    provider = FakeProvider(FakeSlate(GAME_DATE, (game,), schedule_complete=True))
    sink = FakeDurableSink(player_mapping={})
    now = [game.tipoff_at.replace(hour=22)]
    coordinator = LiveSettlementCoordinator(
        provider,
        sink,
        clock=lambda: now[0],
    )

    before_tipoff = coordinator.run(GAME_DATE, FakeFence())
    assert before_tipoff.lock_attempted is False
    assert sink.locked_date is None

    shared_events: list[tuple[str, object]] = []
    provider.events = shared_events
    sink.events = shared_events
    now[0] = game.tipoff_at
    provider.fetch_slate_failures = 1

    failed_poll = coordinator.run(GAME_DATE, FakeFence())

    event_names = [name for name, _ in shared_events]
    assert event_names.index("lock") < event_names.index("fetch_slate")
    assert failed_poll.unresolved_items == 1
    assert failed_poll.lock_acquired is True
    assert failed_poll.games_seen == 0
    assert sink.locked_date == GAME_DATE


def test_unconfirmed_preflight_lock_stops_before_provider_poll() -> None:
    game = FakeGame(
        game_id="1001",
        game_date=GAME_DATE,
        status="scheduled",
        expected_player_ids=frozenset(),
    )
    provider = FakeProvider(FakeSlate(GAME_DATE, (game,), schedule_complete=True))
    sink = FakeDurableSink(player_mapping={})
    now = [game.tipoff_at - timedelta(hours=1)]
    coordinator = LiveSettlementCoordinator(provider, sink, clock=lambda: now[0])

    coordinator.run(GAME_DATE, FakeFence())
    provider.events.clear()
    sink.events.clear()
    sink.fail_lock_dispatches = 1
    sink.commit_lock_before_failure = True
    now[0] = game.tipoff_at

    failed = coordinator.run(GAME_DATE, FakeFence())

    assert provider.events == []
    assert [kind for kind, _ in sink.events] == ["preflight", "lock"]
    assert failed.unresolved_items == 1
    assert failed.lock_attempted is True
    assert failed.lock_acquired is False
    assert failed.games_seen == 0
    assert sink.locked_date == GAME_DATE


def test_retryable_slate_fetch_rechecks_lock_after_tipoff_crosses() -> None:
    game = FakeGame(
        game_id="1001",
        game_date=GAME_DATE,
        status="scheduled",
        expected_player_ids=frozenset(),
    )
    provider = FakeProvider(FakeSlate(GAME_DATE, (game,), schedule_complete=True))
    sink = FakeDurableSink(player_mapping={})
    LiveSettlementCoordinator(
        provider,
        sink,
        clock=lambda: game.tipoff_at - timedelta(hours=1),
    ).run(GAME_DATE, FakeFence())

    shared_events: list[tuple[str, object]] = []
    provider.events = shared_events
    sink.events = shared_events
    provider.fetch_slate_failures = 1
    observed_times = iter((game.tipoff_at - timedelta(microseconds=1), game.tipoff_at))

    failed = LiveSettlementCoordinator(
        provider,
        sink,
        clock=lambda: next(observed_times),
    ).run(GAME_DATE, FakeFence())

    event_names = [kind for kind, _ in shared_events]
    assert event_names.index("fetch_slate") < event_names.index("lock")
    assert failed.unresolved_items == 1
    assert failed.lock_acquired is True
    assert sink.locked_date == GAME_DATE


def test_stale_scheduled_status_still_locks_at_persisted_tipoff() -> None:
    game = FakeGame(
        game_id="1001",
        game_date=GAME_DATE,
        status="scheduled",
        expected_player_ids=frozenset(),
    )
    provider = FakeProvider(FakeSlate(GAME_DATE, (game,), schedule_complete=True))
    sink = FakeDurableSink(player_mapping={})

    result = LiveSettlementCoordinator(
        provider,
        sink,
        clock=lambda: game.tipoff_at,
    ).run(GAME_DATE, FakeFence())

    assert result.lock_acquired is True
    assert sink.locked_date == GAME_DATE


def test_settlement_clock_must_be_timezone_aware() -> None:
    game = _final_game()
    coordinator = LiveSettlementCoordinator(
        FakeProvider(FakeSlate(GAME_DATE, (game,), schedule_complete=True)),
        FakeDurableSink(player_mapping={"11": "alpha"}),
        clock=lambda: datetime(2026, 10, 22, 23),
    )

    with pytest.raises(CoordinatorContractError, match="timezone-aware"):
        coordinator.run(GAME_DATE, FakeFence())


def test_bdl_stale_fence_is_raised_and_cannot_unlock() -> None:
    game = _final_game()
    provider = FakeProvider(
        FakeSlate(GAME_DATE, (game,), schedule_complete=True),
        {"1001": (_result("11"),)},
    )
    sink = FakeDurableSink(player_mapping={"11": "alpha"})
    sink.expire_on_settlement = True

    with pytest.raises(StaleSettlementFenceError, match="lease changed"):
        LiveSettlementCoordinator(provider, sink).run(GAME_DATE, FakeFence())

    assert sink.locked_date == GAME_DATE
    assert [kind for kind, _ in sink.events].count("unlock") == 0


def test_bdl_correction_after_unlock_reuses_boundary_without_relocking() -> None:
    game = _final_game()
    provider = FakeProvider(
        FakeSlate(GAME_DATE, (game,), schedule_complete=True),
        {"1001": (_result("11"),)},
    )
    sink = FakeDurableSink(player_mapping={"11": "alpha"})
    coordinator = LiveSettlementCoordinator(provider, sink)
    coordinator.run(GAME_DATE, FakeFence())
    original_boundary = sink.boundaries[game.game_id]
    provider.results["1001"] = (
        _result("11", points=22.0, fingerprint="fingerprint-b"),
    )

    result = coordinator.run(GAME_DATE, FakeFence())

    correction = _settle_events(sink)[-1]
    assert correction.result_revision == 2
    assert correction.boundary is original_boundary
    assert [kind for kind, _ in sink.events].count("lock") == 1
    assert [kind for kind, _ in sink.events].count("unlock") == 1
    assert result.lock_attempted is False
    assert result.unlocked is False


def test_bdl_command_rejects_fractional_previous_revision() -> None:
    boundary = GameSettlementBoundary(
        provider="bdl",
        provider_game_id="1001",
        game_id="bdl:1001",
        game_date=GAME_DATE,
        game_started_at=None,
        next_game_date=NEXT_GAME_DATE,
        event_sequence=100,
    )

    with pytest.raises(CoordinatorContractError, match="previous_revision"):
        PlayerSettlementCommand(
            boundary=boundary,
            provider_player_id="11",
            player_id="alpha",
            result_fingerprint="fingerprint-a",
            previous_revision=1.5,  # type: ignore[arg-type]
            actual_net_points=20.0,
        )


@pytest.mark.parametrize("event_sequence", [1.5, "100"])
def test_bdl_boundary_rejects_non_integer_event_sequence(
    event_sequence: object,
) -> None:
    with pytest.raises(CoordinatorContractError, match="event_sequence"):
        GameSettlementBoundary(
            provider="bdl",
            provider_game_id="1001",
            game_id="bdl:1001",
            game_date=GAME_DATE,
            game_started_at=None,
            next_game_date=NEXT_GAME_DATE,
            event_sequence=event_sequence,  # type: ignore[arg-type]
        )
