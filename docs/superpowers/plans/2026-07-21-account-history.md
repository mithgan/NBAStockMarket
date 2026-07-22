# Account Activity And History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable, deterministic account activity, dividends, daily portfolio history, and safe account reset APIs.

**Architecture:** Add append-only activity and daily snapshot read models to the existing SQLAlchemy transaction boundary. Record rows while trades, instruments, and settlements are committed; expose cursor-paginated authenticated reads; reset one account with optimistic version and idempotency guards.

**Tech Stack:** FastAPI, Pydantic, SQLAlchemy 2, PostgreSQL/Supabase, SQLite tests, pytest.

---

### Task 1: Persist The Read Model

**Files:**
- Modify: `nba_stock_market/api/database.py`
- Create: `supabase/migrations/20260724000000_create_market_account_history.sql`
- Test: `tests/api/test_account_history.py`
- Modify: `tests/api/test_bootstrap.py`
- Modify: `tests/api/test_supabase_migration.py`

- [ ] Add a failing schema test for `reset_at`, activity, snapshots, and reset commands.
- [ ] Add SQLAlchemy rows with unique source keys, money checks, account/date indexes,
  and service-role-only Supabase grants.
- [ ] Add a SQLite upgrade for `market_accounts.reset_at` so old local databases open.
- [ ] Add migration/readiness assertions and run:

```bash
.venv/bin/pytest -q tests/api/test_bootstrap.py tests/api/test_supabase_migration.py
```

Expected: all selected tests pass.

### Task 2: Record Trades And Instruments

**Files:**
- Modify: `nba_stock_market/api/service.py`
- Test: `tests/api/test_account_history.py`
- Test: `tests/api/test_instruments_api.py`

- [ ] Write failing tests showing a retried trade/instrument creates one activity row.
- [ ] Add one activity insert per committed trade, weekly short, and boost using source
  keys `trade:<id>`, `weekly_short:<id>:opened`, and `boost:<id>:armed`.
- [ ] Record signed cash amounts and structured fee/collateral details without accepting
  client calculations.
- [ ] Run:

```bash
.venv/bin/pytest -q tests/api/test_account_history.py tests/api/test_instruments_api.py
```

Expected: all selected tests pass.

### Task 3: Record Settlements And Daily Values

**Files:**
- Modify: `nba_stock_market/api/service.py`
- Test: `tests/api/test_account_history.py`
- Test: `tests/api/test_settlements.py`

- [ ] Write failing tests for per-player dividend activity, instrument outcomes, one
  snapshot per account/date, and an account created after prior settlements.
- [ ] During the existing exclusive settlement transaction, insert immutable activity
  rows and calculate one portfolio snapshot for every existing account after all cash
  and instrument updates.
- [ ] Use unique source keys and `(account_id, game_date)` so a retry cannot duplicate
  events or history.
- [ ] Run:

```bash
.venv/bin/pytest -q tests/api/test_account_history.py tests/api/test_settlements.py
```

Expected: all selected tests pass.

### Task 4: Add Deterministic Read APIs

**Files:**
- Modify: `nba_stock_market/api/app.py`
- Modify: `nba_stock_market/api/service.py`
- Test: `tests/api/test_account_history.py`

- [ ] Write failing authentication, empty-page, partial-page, invalid-cursor, and
  foreign-cursor tests.
- [ ] Add authenticated activity, dividend, and portfolio-history endpoints with bounded
  limits and stable opaque cursors.
- [ ] Return `{items, next_cursor}` and integer cents only.
- [ ] Run:

```bash
.venv/bin/pytest -q tests/api/test_account_history.py
```

Expected: all selected tests pass.

### Task 5: Add Idempotent Account Reset

**Files:**
- Modify: `nba_stock_market/api/app.py`
- Modify: `nba_stock_market/api/service.py`
- Test: `tests/api/test_account_history.py`
- Modify: `README.md`

- [ ] Write failing tests for confirmation, stale version, exact retry, held-float
  release, read-model clearing, and isolation from another account.
- [ ] Add `POST /api/v1/account/reset` using the account lock, shared market-write
  transaction, expected version, and reset-command idempotency row.
- [ ] Preserve old trade/instrument command rows while clearing financial positions and
  current read-model rows.
- [ ] Document endpoints and the no-import AsyncStorage transition policy.
- [ ] Run:

```bash
.venv/bin/pytest -q tests/api
```

Expected: all API tests pass.

### Task 6: Close Out

**Files:**
- Modify: `.loop/nba-activity-history/state/*` (ignored local evidence only)

- [ ] Run full Python, Expo, type, export, compile, deterministic-data, diff, and secret
  checks.
- [ ] Run final structured review:

```bash
/Users/ryanyin/.codex/skills/autoreview/scripts/autoreview \
  --mode local --parallel-tests ".venv/bin/pytest -q tests/api"
```

- [ ] Fix every verified finding and repeat affected checks plus autoreview until clean.
- [ ] Commit locally, exclude `uv.lock`, update NBA-27 in Linear, and do not push or
  apply the Supabase migration.
