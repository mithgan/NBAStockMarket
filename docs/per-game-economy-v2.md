# Per-game economy v2

Status: implementation branch; not deployed.

## Product model

- Each account has 10 long roster slots and starts at $0 P&L.
- A player has a live market cost per game, not a season salary-style purchase price.
- Adding a player locks that cost for the life of the position.
- For each completed game, a long position pays its locked cost and separately receives a performance dividend based on that game's raw net points.
- Dropping a player ends exposure to future games.
- Each account may also hold up to five inverse short positions. A short receives the locked cost and pays the dividend.
- A timed inverse position stores its expiry when it opens and cannot accrue games after that date.
- The market must show last season's value per game beside today's market cost so a user has a clear anchor.

## Accounting

All values are integer dollars. An account's score is the exact sum of ledger cash flows and does not include mark-to-market roster value.

API-visible money is restricted to JavaScript's safe-integer range. Individual market quotes and locked game costs are additionally capped at $1 trillion, and quote growth saturates at that cap instead of overflowing the database or losing precision in the app.

```text
dividend        = game raw net points * configured dollars per net point
long game P&L  = dividend - locked cost
short game P&L = locked cost - dividend
account P&L    = all game P&L - explicit fees and penalties
```

A game is charged once. If the box score is corrected later, the ledger receives only the change in dividend; it does not charge the per-game cost again.

Each result stores the dividend basis and dollar rate used for its first settlement. Later box-score corrections reuse that original policy even if the active ruleset has changed, so a correction cannot retroactively move a game onto a new economy.

Raw net points are the product rule and do not require a D&T projection. The projection-based mode remains available only for historical comparison and compatibility testing. In that mode, settlement requires an authoritative game start time. The saved D&T capture timestamp must be timezone-aware and strictly earlier than tipoff; otherwise the result is rejected rather than settled from postgame information.

## Runtime contract

- Opening a position requires both the account version and the exact player quote version shown to the user. If either changed, the request is rejected before a cost is locked.
- A live ruleset starts with roster mutations locked. Before any result for a game date is accepted, the scheduler must hold the lock for that exact date. Adds, drops, inverse opens, and inverse closes return `423 roster_locked` until the scheduler unlocks the matching date.
- The scheduler locks before tipoff or before any outcome is knowable, settles every completed player-game in that window, completes the date boundary, and unlocks only after all available results for the window have been processed. A first settlement or date completion is rejected if the matching lock is no longer active. Later provider corrections are adjustments and do not require relocking.
- The settlement scheduler submits the completed game date and the authoritative next game date. The latter must be later than the completed date, or explicitly `null` when no future game is scheduled.
- The idempotent date-completion command advances the replay/live schedule even when no listed player settled. A later correction may adjust money, but it cannot move the schedule backward.
- Timed inverse positions are closed before the first game after their stored expiry and cannot receive any cash flow for that later game.

Position opens send the versions read from the same bootstrap snapshot:

```json
{
  "player_id": "sga",
  "side": "long",
  "expected_account_version": 4,
  "expected_quote_version": 12
}
```

The internal settlement request always includes the scheduler's next-date decision:

```json
{
  "game_id": "0022600001",
  "player_id": "sga",
  "game_date": "2026-10-22",
  "next_game_date": "2026-10-24",
  "event_sequence": 0,
  "result_revision": 1,
  "actual_net_points": 21.5
}
```

The scheduler owns the roster lock through the settlement-only API:

```json
{
  "locked": true,
  "game_date": "2026-10-22"
}
```

It sends the same date with `"locked": false` only after the date's completed games have settled. Both commands require the settlement key and an idempotency key.

## Still configurable

Russell confirmed that the dividend uses raw net points from that game. The locked per-game cost remains a separate charge; it is not charged on an off-day. The following are still not final product constants:

- Dollars paid per net point.
- Opening-cost calibration.
- How much adds and drops move the market cost.
- Add/drop friction or cooldown.
- Short duration and early-close penalty.
- Any required mix of stars, starters, and bench players.

The historical simulator still compares raw net points with the former D&T-surprise approach so the decision remains measurable, but D&T surprise is not the product payout rule.

An initial cache check supports the call's raw-net-points framing: Wembanyama averaged about 22.93
raw net points over 64 cached 2025-26 games, or roughly $459K per game at $20K per net point. The
simulator will compare that rate with the old $40K rate rather than treating either as final.

## Technical rollout

The v2 engine and schema are additive. Existing v1 accounts, holdings, trades, settlements, and reports remain unchanged. The v2 API uses explicit integer-dollar fields under `/api/v2`; the current `/api/v1` contract remains available during development.

The app keeps the API host and v2 path prefix separate. A standalone FastAPI deployment at a host root uses the default `/api/v2` prefix. Any API URL that already contains a path must set `EXPO_PUBLIC_NBA_STOCK_API_PREFIX` explicitly; Russell's existing `https://api.databallr.com/api/nba-stock-market` Flask mount uses `/v2`, producing routes such as `/api/nba-stock-market/v2/bootstrap` without duplicating `/api` in the path.

The Pages deployment is fail-closed during this cutover. It runs only when the repository variable `NBA_STOCK_V2_ENABLED` is `true` and `NBA_STOCK_V2_API_PREFIX` is set. Before exporting the app, the workflow calls the public v2 metadata route and requires an exact service, API, schema, and economy marker; a missing route, wrong mount, backend outage, or unexpected proxy response stops deployment and leaves the current Pages build in place.

The migration provisions a historical-preview ruleset and one per-game quote for every existing market player, using the existing season opening value divided across 82 games as the initial preview anchor. That preview ruleset stays unlocked so the current replay UX remains testable. Any separately created live ruleset keeps the schema's fail-closed roster-lock defaults.

No production migration or deployment is part of the implementation branch.

## Live BDL settlement

The live adapter is disabled by default. It is a callable hook for the existing
Flask scheduler and fenced database lease, not a new timer or worker. When the
lease owner calls the hook, it exhausts the paginated BDL schedule, reads the
unpaginated box-score response, uses BDL's authoritative `status_state`, settles
exact-final player results through the same v2 service, and leaves the date
locked until every expected base result is durable.

Provider observations and commands are stored before delivery. If the process
loses a response after the v2 transaction commits, the next lease owner retries
the same immutable idempotency key. Changed finalized box scores append the next
result revision and the economy posts only the dividend adjustment. A changed
net-points model output also creates a correction when the underlying provider
stats fingerprint remains the same.

The current game slate and tipoffs are durable before any separate lookup for
the next game date. When a lock is due, the coordinator acquires it first and
only then performs the future-schedule lookup, so a slow provider cannot leave
roster mutations open after tipoff.

This v2 raw-net-points path uses `BALL_DONT_LIE_API_KEY` and no D&T projection.
The adapter also requires explicit provider-season and ruleset-season bindings;
a mismatch fails before persistence, as does any non-raw dividend ruleset. Full
BDL rosters are validated, while players absent from the active market are
durably classified as ignored and cannot hold the roster lock forever. Open
date manifests reconcile legitimate
pregame additions and safe removals while retaining old rows for audit, but
started, finalized, staged-result, or already-unlocked changes fail closed.
This repository does not yet consume a live-settlement server flag or attach the
hook to a scheduler. A follow-up adapter in Russell's Flask repository must keep
the runtime disabled until staging has verified schedule completeness, player
crosswalk coverage, retry behavior, and the exact-date roster lock. See
`docs/live-settlement-v2.md` for the rollout contract. The migration in this
branch is additive and has not been applied.
