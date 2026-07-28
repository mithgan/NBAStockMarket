#!/usr/bin/env python3
"""Deterministic local benchmark for server-authoritative market workflows."""

from __future__ import annotations

import argparse
import json
import statistics
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from time import perf_counter
from typing import Callable, Iterator

from sqlalchemy import event, select

from nba_stock_market.api.auth import Principal
from nba_stock_market.api.database import (
    AccountRow,
    Database,
    HoldingRow,
    PlayerListingRow,
)
from nba_stock_market.api.service import MarketService
from nba_stock_market.engine import STARTING_CASH


ROOT = Path(__file__).resolve().parents[1]
MARKET_SEED = ROOT / "data/generated/market-seed.json"
REPLAY_SEED = ROOT / "data/generated/replay-seed.json"


@dataclass
class QueryCounter:
    count: int = 0


@contextmanager
def count_queries(database: Database) -> Iterator[QueryCounter]:
    counter = QueryCounter()

    def before_cursor_execute(*_args: object) -> None:
        counter.count += 1

    event.listen(database.engine, "before_cursor_execute", before_cursor_execute)
    try:
        yield counter
    finally:
        event.remove(database.engine, "before_cursor_execute", before_cursor_execute)


def percentile(values: list[float], quantile: float) -> float:
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, round((len(ordered) - 1) * quantile)))
    return ordered[index]


def timed_samples(
    operation: Callable[[int], object],
    *,
    warmups: int,
    samples: int,
) -> tuple[list[float], object]:
    result: object = None
    for index in range(warmups):
        result = operation(-(index + 1))
    timings: list[float] = []
    for index in range(samples):
        started = perf_counter()
        result = operation(index)
        timings.append((perf_counter() - started) * 1_000)
    return timings, result


def summarize(timings: list[float]) -> dict[str, float]:
    return {
        "p50_ms": round(statistics.median(timings), 3),
        "p95_ms": round(percentile(timings, 0.95), 3),
        "min_ms": round(min(timings), 3),
        "max_ms": round(max(timings), 3),
    }


def seed_accounts(database: Database, *, account_count: int) -> list[Principal]:
    principals = [
        Principal(id=f"bench-{index:04d}", display_name=f"Bench {index:04d}")
        for index in range(account_count)
    ]
    with database.session() as session, session.begin():
        players = list(
            session.scalars(select(PlayerListingRow).order_by(PlayerListingRow.id))
        )
        if len(players) < 3:
            raise RuntimeError("benchmark requires at least three player listings")
        held_counts = {player.id: 0 for player in players}
        for index, principal in enumerate(principals):
            selected = [players[(index * 3 + offset) % len(players)] for offset in range(3)]
            cost = sum(player.current_price_cents for player in selected)
            account = AccountRow(
                id=principal.id,
                display_name=principal.display_name,
                cash_cents=round(STARTING_CASH * 100) - cost,
            )
            session.add(account)
            for player in selected:
                session.add(
                    HoldingRow(
                        account_id=principal.id,
                        player_id=player.id,
                        shares=1,
                        average_cost_cents=player.current_price_cents,
                    )
                )
                held_counts[player.id] += 1
        for player in players:
            player.held_shares = held_counts[player.id]
    return principals


def prepare_database(
    database: Database,
    service: MarketService,
    *,
    account_count: int,
    settled_days: int,
) -> list[Principal]:
    database.create_schema()
    database.seed_from_file(MARKET_SEED)
    database.seed_replay_from_file(REPLAY_SEED)
    principals = seed_accounts(database, account_count=account_count)
    for index in range(settled_days):
        game = service.game_state(principals[0])
        next_date = game["next_game_date"]
        if not isinstance(next_date, str):
            raise RuntimeError("benchmark replay ended before setup completed")
        service.settle_next(
            expected_game_date=date.fromisoformat(next_date),
            idempotency_key=f"bench-setup-{index:04d}",
        )
    return principals


def run_benchmark(
    *,
    account_count: int,
    settled_days: int,
    warmups: int,
    samples: int,
) -> dict[str, object]:
    with tempfile.TemporaryDirectory(prefix="nba-stock-latency-") as directory:
        database = Database(f"sqlite+pysqlite:///{Path(directory) / 'bench.db'}")
        service = MarketService(database)
        try:
            principals = prepare_database(
                database,
                service,
                account_count=account_count,
                settled_days=settled_days,
            )
            principal = principals[0]

            initial_bootstrap = service.bootstrap(principal)
            last_settled_date = initial_bootstrap["game"]["last_settled_date"]
            if not isinstance(last_settled_date, str):
                raise RuntimeError("benchmark requires a settled replay date")
            result_cursor = date.fromisoformat(last_settled_date)

            with count_queries(database) as refresh_queries:
                refresh_timings, refresh_payload = timed_samples(
                    lambda _index: service.bootstrap(
                        principal,
                        settled_results_after=result_cursor,
                    ),
                    warmups=warmups,
                    samples=samples,
                )
            if not isinstance(refresh_payload, dict):
                raise RuntimeError("bootstrap returned an invalid payload")

            holdings = refresh_payload["portfolio"]["holdings"]
            if not holdings:
                raise RuntimeError("benchmark account requires a holding")
            player_id = str(holdings[0]["player_id"])
            next_side = "sell"

            def trade_and_refresh(index: int) -> dict[str, object]:
                nonlocal next_side
                result = service.execute_trade(
                    principal,
                    player_id=player_id,
                    side=next_side,
                    idempotency_key=f"bench-trade-{index:+05d}-{next_side}",
                    settled_results_after=result_cursor,
                )
                next_side = "buy" if next_side == "sell" else "sell"
                bootstrap = result.get("bootstrap")
                if not isinstance(bootstrap, dict):
                    raise RuntimeError("trade benchmark requires an atomic bootstrap")
                return result

            with count_queries(database) as trade_queries:
                trade_timings, trade_payload = timed_samples(
                    trade_and_refresh,
                    warmups=warmups,
                    samples=samples,
                )

            settlement_timings: list[float] = []
            settlement_queries: list[int] = []
            for index in range(samples):
                game = service.game_state(principal)
                next_date = game["next_game_date"]
                if not isinstance(next_date, str):
                    break
                with count_queries(database) as query_counter:
                    started = perf_counter()
                    service.settle_next(
                        expected_game_date=date.fromisoformat(next_date),
                        idempotency_key=f"bench-measured-settle-{index:04d}",
                    )
                    settlement_timings.append((perf_counter() - started) * 1_000)
                settlement_queries.append(query_counter.count)
            if not settlement_timings:
                raise RuntimeError("benchmark had no settlement samples")

            return {
                "workload": {
                    "accounts": account_count,
                    "holdings_per_account": 3,
                    "players": len(refresh_payload["market"]),
                    "pre_settled_days": settled_days,
                    "warmups": warmups,
                    "samples": samples,
                },
                "refresh": {
                    **summarize(refresh_timings),
                    "mean_queries": round(refresh_queries.count / (warmups + samples), 2),
                    "payload_bytes": len(
                        json.dumps(refresh_payload, separators=(",", ":")).encode("utf-8")
                    ),
                    "settled_result_count": len(refresh_payload["settled_results"]),
                },
                "trade_plus_refresh": {
                    **summarize(trade_timings),
                    "mean_queries": round(trade_queries.count / (warmups + samples), 2),
                    "payload_bytes": len(
                        json.dumps(trade_payload, separators=(",", ":")).encode("utf-8")
                    ),
                },
                "settlement": {
                    **summarize(settlement_timings),
                    "mean_queries": round(statistics.mean(settlement_queries), 2),
                },
            }
        finally:
            database.dispose()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--accounts", type=int, default=200)
    parser.add_argument("--settled-days", type=int, default=60)
    parser.add_argument("--warmups", type=int, default=3)
    parser.add_argument("--samples", type=int, default=15)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = run_benchmark(
        account_count=args.accounts,
        settled_days=args.settled_days,
        warmups=args.warmups,
        samples=args.samples,
    )
    rendered = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")


if __name__ == "__main__":
    main()
