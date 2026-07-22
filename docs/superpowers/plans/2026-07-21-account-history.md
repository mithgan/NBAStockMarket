# Account Activity And History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable, deterministic account activity, dividends, daily portfolio history, and safe account reset APIs.

**Architecture:** Add append-only activity and daily snapshot read models to the existing SQLAlchemy transaction boundary. Record rows while trades, instruments, and settlements are committed; expose cursor-paginated authenticated reads; allow one idempotent local-save transition only while an account is pristine.

**Tech Stack:** FastAPI, Pydantic, SQLAlchemy 2, PostgreSQL/Supabase, SQLite tests, pytest.

---

### Task 1: Persist The Read Model

**Files:**
- Modify: `nba_stock_market/api/database.py`
- Create: `supabase/migrations/20260724000000_create_market_account_history.sql`
- Test: `tests/api/test_account_history.py`
- Modify: `tests/api/test_bootstrap.py`
- Modify: `tests/api/test_supabase_migration.py`

- [x] Add a failing schema test for `reset_at`, activity, durable legacy settlement
  membership, snapshots, and reset commands.
- [x] Add SQLAlchemy rows with unique source keys, money checks, account/date indexes,
  and service-role-only Supabase grants.
- [x] Add SQLite upgrades for `market_accounts.reset_at` and reconstructable activity
  so old local databases open without losing history.
- [x] Add migration/readiness assertions and run:

```bash
.venv/bin/pytest -q tests/api/test_bootstrap.py tests/api/test_supabase_migration.py
```

Expected: all selected tests pass.

### Task 2: Record Trades And Instruments

**Files:**
- Modify: `nba_stock_market/api/service.py`
- Test: `tests/api/test_account_history.py`
- Test: `tests/api/test_instruments_api.py`

- [x] Write failing tests showing a retried trade/instrument creates one activity row.
- [x] Add one activity insert per committed trade, weekly short, and boost using source
  keys `trade:<id>`, `weekly_short:<id>:opened`, and `boost:<id>:armed`.
- [x] Record signed cash amounts and structured fee/collateral details without accepting
  client calculations.
- [x] Run:

```bash
.venv/bin/pytest -q tests/api/test_account_history.py tests/api/test_instruments_api.py
```

Expected: all selected tests pass.

### Task 3: Record Settlements And Daily Values

**Files:**
- Modify: `nba_stock_market/api/service.py`
- Test: `tests/api/test_account_history.py`
- Test: `tests/api/test_settlements.py`

- [x] Write failing tests for per-player dividend activity, instrument outcomes, one
  snapshot per account/date, and an account created after prior settlements.
- [x] During the existing exclusive settlement transaction, insert immutable activity
  rows and calculate one portfolio snapshot for every existing account after all cash
  and instrument updates.
- [x] Use unique source keys and `(account_id, game_date)` so a retry cannot duplicate
  events or history.
- [x] Run:

```bash
.venv/bin/pytest -q tests/api/test_account_history.py tests/api/test_settlements.py
```

Expected: all selected tests pass.

### Task 4: Add Deterministic Read APIs

**Files:**
- Modify: `nba_stock_market/api/app.py`
- Modify: `nba_stock_market/api/service.py`
- Test: `tests/api/test_account_history.py`

- [x] Write failing authentication, empty-page, partial-page, invalid-cursor, and
  foreign-cursor tests.
- [x] Add authenticated activity, dividend, and portfolio-history endpoints with bounded
  limits and stable opaque cursors.
- [x] Return `{items, next_cursor}` and integer cents only.
- [x] Run:

```bash
.venv/bin/pytest -q tests/api/test_account_history.py
```

Expected: all selected tests pass.

### Task 5: Add Idempotent Pre-Play Transition

**Files:**
- Modify: `nba_stock_market/api/app.py`
- Modify: `nba_stock_market/api/service.py`
- Test: `tests/api/test_account_history.py`
- Modify: `README.md`

- [x] Write failing tests for confirmation, stale version, exact retry, snapshot
  clearing, isolation from another account, and rejection after any trade/instrument.
- [x] Add `POST /api/v1/account/reset` using the account lock, shared market-write
  transaction, expected version, and reset-command idempotency row.
- [x] Fail with `reset_not_eligible` after server-side participation so reset cannot
  erase losses while preserving shared market effects.
- [x] Document endpoints and the no-import AsyncStorage transition policy.
- [x] Run:

```bash
.venv/bin/pytest -q tests/api
```

Expected: all API tests pass.

### Task 6: Close Out

**Files:**
- Modify: `.loop/nba-activity-history/state/*` (ignored local evidence only)

- [x] Run full Python, Expo, type, export, compile, deterministic-data, diff, and secret
  checks.
- [x] Run final structured review:

```bash
/Users/ryanyin/.codex/skills/autoreview/scripts/autoreview \
  --mode local --parallel-tests ".venv/bin/pytest -q tests/api"
```

- [x] Fix every verified finding and repeat affected checks plus autoreview until clean.
- [x] Commit locally, exclude `uv.lock`, update NBA-27 in Linear, and do not push or
  apply the Supabase migration.
