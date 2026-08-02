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

The migration backfills activity from existing trades, dividends, weekly shorts, and
boosts. Exact portfolio snapshots start at migration time because old closing market
values are not recoverable from current state. The pre-existing settlement endpoint
retains all legacy global dates for every account present at cutover through durable
account/settlement membership rows. New dates use portfolio-snapshot membership, so
runtime visibility never compares timestamps from different workers.

The migration first takes the same global advisory lock introduced by NBA-26, then
locks the account table before every authoritative source table while it installs
compatibility triggers. Those triggers keep activity complete for older workers during
a rolling deployment. A deferred settlement trigger calculates snapshots from final
account, holding, price, and collateral state at transaction commit; new workers reuse
trigger rows by source key and their own exact snapshots win on conflict. The release
sequence must deploy through NBA-26 before this migration is applied.

## API

- `GET /api/v1/activity?limit=&cursor=` returns a deterministic page of account events.
- `GET /api/v1/dividends?limit=&cursor=` returns per-player signed dividend rows.
- `GET /api/v1/portfolio/history?limit=&cursor=` returns daily closing snapshots.
- `POST /api/v1/account/reset` requires authentication, `Idempotency-Key`, the exact
  confirmation string `RESET`, and the account version last read by the client.

Every response contains integer cents and server timestamps. Read endpoints never
accept balances, prices, payouts, or account identifiers from the client.

## Reset Semantics

A reset is a one-time, pre-play transition for an authenticated account moving from
the local prototype save to the authoritative server economy. It is eligible only
while the server account is pristine: version zero, starting cash, no holdings,
trades, dividends, activity, instrument commands, or positions, and no prior reset.
Idle-account snapshots do not make an account ineligible and are cleared when the
transition succeeds. The reset does not rewind the shared replay clock or market
prices and does not affect another account.

Repeating the same successful reset key returns the original response without another
mutation. A new reset request after the account participates returns
`reset_not_eligible`; a stale expected account version returns a separate conflict.
This prevents a user from restoring the bankroll after a trade while preserving that
trade's shared price and volume effects. This restriction replaces the original
destructive-reset design after structured review identified that economy exploit.

## Existing Local Saves

AsyncStorage state is not imported. It contains client-calculated balances and events,
so accepting it would violate the server trust boundary and could duplicate money.
NBA-28 will show a one-time transition confirmation. The client clears its old gameplay
save and records a transition marker only after an authenticated server portfolio load
succeeds. A failed server load leaves the local save untouched for retry.

## Failure And Concurrency Rules

- Activity and snapshots are inserted in the same database transaction as their source
  trade, instrument command, or settlement.
- The migration's source-table lock closes the initial backfill race, and compatibility
  triggers cover writes from older API workers until they are drained.
- SQLite reconstruction runs idempotently on every startup. A local migration marker
  is committed atomically with legacy settlement membership, so interruption retries
  without restoring history after a later account reset.
- Unique source keys and existing command idempotency prevent duplicate events.
- Settlement remains globally exclusive and writes at most one snapshot per
  `(account, game_date)`.
- Account reset locks the account and fails closed after any server-side participation.
- Reset removes both exact snapshots and migration-captured legacy settlement
  memberships for that account.
- `reset_at` is informational; row visibility and idempotency never depend on clocks
  being monotonic across application workers.
- Empty and partial histories are valid successful responses.
- No migration is applied to production as part of this task.

## Verification

Tests cover fresh accounts, pagination without overlap, invalid and foreign cursors,
cross-device reads, idempotent retries, partial history for late accounts, settlement
snapshots, one-time reset conflicts, trade/instrument exploit prevention, and
preservation of other users. Full Python tests, Expo regressions, typecheck/export,
deterministic generated-data checks, and final autoreview remain release gates.
