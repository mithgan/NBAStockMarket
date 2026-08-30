from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import pytest

from nba_stock_market.live_runtime import LiveSettlementRuntime
from nba_stock_market.live_settlement import LiveSettlementRun


GAME_DATE = date(2026, 10, 22)
RUN = LiveSettlementRun(
    game_date=GAME_DATE,
    games_seen=0,
    final_games_seen=0,
    results_seen=0,
    commands_attempted=0,
    commands_succeeded=0,
    unchanged_results=0,
    unresolved_items=0,
    lock_attempted=False,
    lock_acquired=False,
    unlock_attempted=False,
    unlocked=False,
)


@dataclass(frozen=True)
class Fence:
    owner_id: str = "worker-a"
    fencing_token: int = 1


class RecordingCoordinator:
    def __init__(self) -> None:
        self.calls: list[tuple[date, Fence]] = []

    def run(self, game_date: date, fence: Fence) -> LiveSettlementRun:
        self.calls.append((game_date, fence))
        return RUN


def test_runtime_is_disabled_by_default_and_does_not_touch_coordinator() -> None:
    coordinator = RecordingCoordinator()
    runtime = LiveSettlementRuntime(coordinator)

    tick = runtime.tick(GAME_DATE, Fence())

    assert tick.enabled is False
    assert tick.run is None
    assert coordinator.calls == []


@pytest.mark.parametrize("invalid_enabled", ["false", "true", 0, 1, None])
def test_runtime_rejects_non_boolean_enable_values(invalid_enabled: object) -> None:
    coordinator = RecordingCoordinator()

    with pytest.raises(ValueError, match="enabled must be a boolean"):
        LiveSettlementRuntime(coordinator, enabled=invalid_enabled)  # type: ignore[arg-type]

    assert coordinator.calls == []


def test_enabled_runtime_delegates_one_tick_to_existing_lease_owner() -> None:
    coordinator = RecordingCoordinator()
    runtime = LiveSettlementRuntime(coordinator, enabled=True)
    fence = Fence()

    tick = runtime.tick(GAME_DATE, fence)

    assert tick.enabled is True
    assert tick.run == RUN
    assert coordinator.calls == [(GAME_DATE, fence)]
