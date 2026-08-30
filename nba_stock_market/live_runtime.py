from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Protocol

from nba_stock_market.live_settlement import (
    LeaseFence,
    LiveSettlementRun,
)


@dataclass(frozen=True)
class LiveSettlementTick:
    enabled: bool
    game_date: date
    run: LiveSettlementRun | None


class SettlementTickCoordinator(Protocol):
    def run(self, game_date: date, fence: LeaseFence) -> LiveSettlementRun: ...


class LiveSettlementRuntime:
    """One disabled-by-default hook for the existing leased Flask scheduler."""

    def __init__(
        self,
        coordinator: SettlementTickCoordinator | None = None,
        *,
        enabled: bool = False,
    ) -> None:
        if type(enabled) is not bool:
            raise ValueError("enabled must be a boolean")
        if enabled and coordinator is None:
            raise ValueError("an enabled live runtime requires a coordinator")
        self._coordinator = coordinator
        self._enabled = enabled

    @property
    def enabled(self) -> bool:
        return self._enabled

    def tick(self, game_date: date, fence: LeaseFence) -> LiveSettlementTick:
        if type(game_date) is not date:
            raise ValueError("game_date must be a date")
        if not self._enabled:
            return LiveSettlementTick(enabled=False, game_date=game_date, run=None)
        coordinator = self._coordinator
        if coordinator is None:
            raise RuntimeError("enabled live runtime lost its coordinator")
        return LiveSettlementTick(
            enabled=True,
            game_date=game_date,
            run=coordinator.run(game_date, fence),
        )


__all__ = [
    "LiveSettlementRuntime",
    "LiveSettlementTick",
    "SettlementTickCoordinator",
]
