# Account Activity And History Design

## Outcome

The FastAPI backend becomes the durable source for account activity, player dividends,
and daily portfolio value. A user can reconnect on another device and receive the same
ordered history without trusting calculations or timestamps from the client.

## Read Model

The backend writes two read-model tables inside the same transaction as each state
change:

- `market_account_activity` stores immutable account events for trades, instrument
  actions, dividends, boost outcomes, and weekly-short outcomes. Each event has a
  server timestamp, signed cash amount, optional player/date, structured details, and a
  unique source key so retries cannot duplicate it.
- `market_portfolio_snapshots` stores one server-calculated closing value per account
  and settled replay date. It records cash, free cash, reserved collateral, market
  value, and total value.

Activity is ordered by `(occurred_at DESC, id DESC)`. Snapshots are ordered by
`game_date DESC`. Opaque cursors represent the final item in a page; malformed or
foreign cursors fail closed instead of silently restarting at page one.

## API

- `GET /api/v1/activity?limit=&cursor=` returns a deterministic page of account events.
- `GET /api/v1/dividends?limit=&cursor=` returns per-player signed dividend rows.
- `GET /api/v1/portfolio/history?limit=&cursor=` returns daily closing snapshots.
- `POST /api/v1/account/reset` requires authentication, `Idempotency-Key`, the exact
  confirmation string `RESET`, and the account version last read by the client.

Every response contains integer cents and server timestamps. Read endpoints never
accept balances, prices, payouts, or account identifiers from the client.

## Reset Semantics

A reset affects only the authenticated account. It restores the $140M bankroll,
releases owned float, removes holdings and instrument positions, and clears the
account's activity/snapshot read model. It does not rewind the shared replay clock or
market prices and does not affect another account.

Trade and instrument command rows remain for audit and idempotency. Repeating the same
reset key returns the original response without another mutation. A new reset request
with a stale expected account version returns a conflict, preventing delayed taps from
erasing newer progress.

## Existing Local Saves

AsyncStorage state is not imported. It contains client-calculated balances and events,
so accepting it would violate the server trust boundary and could duplicate money.
NBA-28 will show a one-time transition confirmation. The client clears its old gameplay
save and records a transition marker only after an authenticated server portfolio load
succeeds. A failed server load leaves the local save untouched for retry.

## Failure And Concurrency Rules

- Activity and snapshots are inserted in the same database transaction as their source
  trade, instrument command, settlement, or reset.
- Unique source keys and existing command idempotency prevent duplicate events.
- Settlement remains globally exclusive and writes at most one snapshot per
  `(account, game_date)`.
- Account reset locks the account plus every held listing before releasing float.
- Empty and partial histories are valid successful responses.
- No migration is applied to production as part of this task.

## Verification

Tests cover fresh accounts, pagination without overlap, invalid and foreign cursors,
cross-device reads, idempotent retries, partial history for late accounts, settlement
snapshots, reset rollback/conflicts, and preservation of other users. Full Python tests,
Expo regressions, typecheck/export, deterministic generated-data checks, and final
autoreview remain release gates.
