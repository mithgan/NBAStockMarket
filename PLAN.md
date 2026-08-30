# Plan: NBA Stock Market per-game economy v2

Branch: `codex/per-game-economy-v2`

Base: `origin/mith/experiments` at `526d9a2`

Run: `.context/orchestration/20260829-per-game-economy-v2`

## Objective

Implement Russell's new per-game roster economy in the simulator first, validate it against historical data, then carry the verified contract through the backend and current integrated frontend. Production deployment and production migrations are excluded until the economy has evidence and approval.

## Depth tree

1. Per-game economy v2
2. Discovery and contract
3. Four parallel read-only audits
4. Engine/simulation implementation, followed by parallel backend and frontend implementation
5. Integration, review, and user-facing verification

## Contract before fan-out

### Product facts already decided

- 10 persistent long roster slots.
- A live per-game market cost replaces the large salary-style value.
- A user's acquisition cost remains locked until drop/sale.
- Every completed player-game charges the locked cost and separately pays a dividend equal to that game's raw net points multiplied by the configured dollar rate.
- Cumulative user score starts at zero and may become positive or negative.
- A dropped player stops generating future charges and dividends.
- At most one long position per player per user.
- Up to five inverse short positions are part of the intended model.
- The market must expose prior-season per-game value beside current per-game cost.

### Policies that must remain configurable until simulations or team input settle them

- Dividend dollars per net point.
- Opening per-game market cost.
- Add/drop market sensitivity.
- Add/drop transaction friction.
- Short duration and early-exit rule.
- Roster composition limits.

### Existing correctness guarantees that must survive

- Settlement is idempotent.
- Later box-score corrections create explicit adjustments.
- A projection-dependent ruleset never settles a missing pregame projection silently.
- Money and event ledgers remain auditable.
- No production database operation or deployment occurs in this run without a separate explicit instruction.

## Initial parallel audit ownership

| Task | Read scope | Sole write scope | Must not edit |
|---|---|---|---|
| AUDIT-ENGINE | `nba_stock_market/engine.py`, economy/model modules, engine tests | `handoffs/AUDIT-ENGINE.md` | Product code, tests |
| AUDIT-API | `nba_stock_market/api/`, API tests, Supabase migrations | `handoffs/AUDIT-API.md` | Product code, migrations, tests |
| AUDIT-APP | `app/src/`, app tests and build config | `handoffs/AUDIT-APP.md` | App source and tests |
| AUDIT-SIM | backtest/simulator/data-source modules, reports, related tests | `handoffs/AUDIT-SIM.md` | Product code, reports, tests |

The full handoff paths are under `.context/orchestration/20260829-per-game-economy-v2/`. The audit tasks are intentionally read-only and have no overlapping write paths.

## Planned implementation ownership

The audit contract is now integrated. Work proceeds in dependency-aware waves; no two workers in a wave own the same file.

### Wave 1: domain contract

| Task | Sole write scope | Dependencies |
|---|---|---|
| ENGINE-V2 | `nba_stock_market/per_game.py`, `tests/test_per_game.py`, `handoffs/ENGINE-V2.md` | Final design contract |

### Wave 2: parallel consumers after ENGINE-V2 is accepted

| Task | Sole write scope | Dependencies |
|---|---|---|
| SIM-V2 | `nba_stock_market/per_game_simulation.py`, `tests/test_per_game_simulation.py`, `output/per-game-economy-v2.json`, `output/per-game-economy-v2.md`, `handoffs/SIM-V2.md` | ENGINE-V2 |
| API-V2 | New versioned migration, `nba_stock_market/api/per_game_service.py`, additive v2 routes/models in files named by its task card, focused `tests/api/test_per_game_*.py`, `handoffs/API-V2.md` | ENGINE-V2 |
| APP-V2 | `app/App.tsx`, `app/src/**`, `handoffs/APP-V2.md` | Frozen v2 API response fixture |

Root integration is the only owner allowed to modify shared exports, existing migration-order tests, cross-system fixtures, root docs, and final verification evidence.

### Frozen domain interface for Wave 1

- Integer-dollar arithmetic only.
- `DividendBasis`: `raw_net_points` and `surprise_vs_projection`.
- `PositionSide`: `long` and `short`.
- A durable position has a stable ID, account/player/side, locked per-game cost, open sequence, and optional half-open close sequence.
- Long settlement cash flow is `dividend - locked_cost`; short cash flow is `locked_cost - dividend`.
- Base settlement charges cost exactly once. A later result revision posts only the dividend delta and never charges cost again.
- Projection-dependent settlement without a saved projection remains explicitly unsettled.
- The account score is the exact sum of append-only ledger entries and begins at zero.
- Opening or closing a position may move the live quote, but never changes an existing position's locked cost.
- Calendar short expiry is supplied by the simulator/API as a close boundary; the pure engine has no clock.
- Default policy values are simulation defaults, not final product decisions.

## Status log

- 2026-08-29: Created isolated branch/worktree from the latest integrated Mith UI/backend branch.
- 2026-08-29: Wrote root gates and a read-only four-audit ownership map before dispatch.
- 2026-08-29: Baseline verified: 288 Python tests plus 13 subtests, 210 app tests, and Expo web export all pass.
- 2026-08-29: Four audits accepted. Chose an additive versioned economy so historical asset-market rows are not reinterpreted or destructively migrated.
- 2026-08-29: Froze the Wave 1 domain interface and, at that stage, preserved raw-net-points versus D&T-surprise as explicit simulation modes because product confirmation had not yet arrived.
- 2026-08-29: Added Linear parent NBA-41 with implementation children NBA-42 (engine), NBA-43 (simulation), NBA-44 (API), and NBA-45 (frontend).
- 2026-08-29: ENGINE-V2 accepted after correcting provider game identity to `(game_id, player_id)`; 27 focused tests pass.
- 2026-08-29: SIM-V2, API-V2, and APP-V2 integrated. Independent engine/app review findings were fixed, including deterministic strategy ordering, reciprocal quote movement, durable reconciliation locks, opposing-position prevention, responsive reflow, and virtualized results.
- 2026-08-29: A fresh rendered pass verified long/inverse entry, settlement, correction delta, close boundaries, leaderboard, failure/retry, uncertain-write reconciliation, and desktop/mobile/320px layouts. Incremental result merging was corrected to match a fresh bootstrap after revisions.
- 2026-08-29: Hardened deployment topology with an exact public `/api/v2/meta` contract probe, explicit mounted API prefixes, and a Pages fail-closed preflight so the frontend cannot silently deploy against legacy v1 routes.
- 2026-08-29: Hardened live scheduling with explicit roster locks, canonical shared game boundaries, immutable settlement policy, monotonic corrections, all-player inverse expiry, and fee-equivalent automatic expiry.
- 2026-08-29: Final autoreview returned no actionable findings. Full verification reached 385 Python tests plus 13 subtests, 262 app tests, a clean TypeScript check, a successful Expo export, and byte-identical 32-scenario historical simulation output.
- 2026-08-29: Repeated the actual rendered workflow using an isolated local auth/schedule harness. Long and inverse positions, shared settlement, revision correction, leaderboard, roster lock, and 1440/390/320px layouts all passed. No production migration, deployment, or data operation was performed.
- 2026-08-29: Russell confirmed the product dividend uses raw net points from that game, with the locked per-game cost charged separately. Raw net points remain the implementation default; D&T surprise remains available only for historical comparison and compatibility testing.
- 2026-08-30: Added the disabled-by-default live BDL settlement boundary: finalized box scores, canonical raw-net-points calculation, exact ruleset binding, durable fenced commands, date-wide roster locks, retry-safe corrections, and additive provider-ingestion tables.
- 2026-08-30: Hardened final-box validation, persisted current tipoffs before any future-schedule lookup, required an authoritative roster lock before resolving the next date, and made computed net-point changes explicit correction revisions even when provider stats are unchanged.
- 2026-08-30: Final verification reached 481 Python tests plus 49 subtests, and autoreview returned no actionable findings. No migration, deployment, live configuration, or provider key was applied.

## Live BDL settlement follow-up

Run: `.context/orchestration/20260830-bdl-v2-live`

Objective: turn finalized Ball Don't Lie player box scores into authoritative v2 raw-net-points settlements, using the existing in-process Flask scheduler/lease design rather than creating a second worker.

### Audit ownership before implementation

| Task | Read scope | Sole write scope | Must not edit |
|---|---|---|---|
| AUDIT-BDL | `nba_stock_market/bdl_data.py`, its fixtures/tests, BDL provider code in the current Flask backend | `handoffs/AUDIT-BDL.md` | Product code, tests, migrations |
| AUDIT-LIVE | Current Flask stock-market runner, scheduler, provider, deployment docs, and scheduler/provider tests | `handoffs/AUDIT-LIVE.md` | Product code, tests, deployment config |
| AUDIT-V2 | v2 settlement service/routes/schema and focused settlement tests | `handoffs/AUDIT-V2.md` | Product code, tests, migrations |

All handoffs live under `.context/orchestration/20260830-bdl-v2-live/`. These three audit agents are read-only and have disjoint write paths. Root integration owns the design and all product edits after the contracts are reconciled.
