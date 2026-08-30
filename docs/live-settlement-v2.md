# Live settlement v2

Status: provider, coordinator, durable sink, and callable runtime implemented
and tested locally; external Flask adapter not yet implemented; not deployed.
The callable runtime is disabled by default.

## What runs

Russell's existing Flask scheduler remains the only intended timer. This package
exposes `LiveSettlementRuntime.tick(game_date, fence)` for its current database
lease owner, but this repository does not register that callback or consume live
settlement environment variables. Setting variables alone has no effect.

The separate Flask adapter must explicitly read configuration, construct the
transport/coordinator/sink, and pass `enabled=True`. Recommended server-side
names are:

```text
NBA_STOCK_LIVE_SETTLEMENT_ENABLED=true
NBA_STOCK_LIVE_RULESET_ID=<exact active ruleset id>
NBA_STOCK_LIVE_RULESET_VERSION=<exact integer version>
NBA_STOCK_LIVE_RULESET_SEASON_ID=2026-27
NBA_STOCK_LIVE_DIVIDEND_DOLLARS_PER_NET_POINT=<approved integer rate>
NBA_STOCK_LIVE_PROVIDER_SEASON_ID=2026
BALL_DONT_LIE_API_KEY=<server-side key>
```

Until that adapter exists, the callable runtime remains disabled. The key must
never be exposed to the frontend, logs, command arguments, or source control.

## Data flow

1. `BallDontLieLiveClient` exhausts paginated `/v1/games`, then reads the
   unpaginated `/v1/box_scores` response for the game date. Current BDL box
   scores expose team IDs directly and may expose a top-level game ID; an
   idless response is accepted only when its home/away pair matches exactly
   one scheduled game.
2. The adapter requires an explicit BDL season plus the exact active v2 ruleset
   ID, version, season, and dividend rate. Roster-lock enforcement must also be
   enabled. The sink and in-process money service bind to that same ID; they do
   not infer policy from the newest active row. Any mismatch fails before
   provider state or money is written.
3. The durable sink assigns each game one stable v2 ID and event sequence. A
   BDL player ID is mapped once to exactly one listed market player. Players
   absent from the active market are durably ignored for that game; ambiguous
   or contradictory mappings fail closed.
4. Each complete provider poll becomes the current date manifest. An empty
   first observation is retryable rather than authoritative, while a later empty
   observation can reconcile an already-known open slate. New games can
   be added while the slate is open. Before the date-wide lock, a scheduled,
   postponed, or canceled game can be removed only if it has no durable result
   command; a still-scheduled game also cannot disappear at or after its
   persisted tipoff. After the lock, absence alone can never remove a game: BDL
   must explicitly report it postponed or canceled. In-progress, final, or
   staged-result removals fail closed. Postponed and canceled games remain
   durable diagnostics but are excluded from that date's settlement obligations,
   so they do not block unlock. If one returns on a later date without a prior
   result command, its former date/tipoff/sequence/status is appended to schedule
   history before its boundary moves forward.
   Pregame tipoff or next-date revisions are accepted before the roster lock;
   those money-affecting boundaries freeze once the lock is acquired.
5. Schedule observations are persisted ahead of tipoff. A new current slate and
   its tipoffs are saved with an unresolved next-date boundary before the
   separate future-schedule endpoint is called. If a roster lock is due, the
   coordinator acquires that exact-date lock and then re-prepares the saved
   slate; only the locked second phase may resolve the next game date. A failed
   or invalid future lookup therefore cannot erase the current tipoff or hold a
   post-tipoff mutation window open. The date cannot settle until that lookup
   later succeeds. Once settlement has started, corrections reuse the saved
   next date instead of consulting a mutable future schedule. Before every
   provider poll, the lease owner checks persisted tipoffs and locks roster
   changes for the exact date as soon as a game starts, even if BDL is slow or
   still reports `scheduled`. The same check runs again after a fresh schedule
   poll.
   Live settlement also filters exposure by the authoritative tipoff timestamp,
   so a position opened after tipoff cannot receive that game and a position
   closed after tipoff remains exposed.
6. Game lifecycle comes only from BDL's authoritative `status_state`. `final`
   is the only state that fetches `/v1/stats`; `delayed` and `suspended` remain
   lock-safe in-progress states, while `unknown` is retryable and never settles.
   Both teams must expose a non-empty final player list, every listed player
   must have a complete stats row, and made shots must reconcile to reported
   points before classification. The shared `row_to_game_line` mapper and
   `NetPointsModel` calculate raw net points for listed players; no D&T
   projection is used. Live ingestion rejects any active ruleset whose dividend
   basis is not `raw_net_points`.
7. The command is saved before delivery. The v2 service requires the lease
   validator to return explicit `True` inside its money transaction; false or
   indeterminate validation fails closed so a stale worker cannot settle.
8. Net points are normalized to integer micros before the first delivery, so a
   lost response retries the byte-equivalent value and idempotency key. A result
   is unchanged only when both the provider scoring fingerprint and computed
   net-point micros match. Changed stats or changed model output append revision
   N+1.
9. The date unlocks only after the active settlement manifest and next-date
   boundary are complete,
   every included game is terminal, every box-score player is classified, and
   every listed player's expected revision-1 result succeeded. Before unlock,
   one durable date-completion command advances `last_settled_date`,
   `next_game_date`, and the event sequence and expires timed inverse positions.
   This command still runs when every final player was intentionally ignored,
   so an empty settlement batch cannot leave the live schedule stale. The exact
   date-completion event sequence is persisted before delivery, so a
   lost response replays the same payload even if later provider diagnostics add
   rows. Completion or unlock responses replay with the same idempotency key; a
   later game-date lock does not corrupt reconciliation of the earlier unlock.

## Staging checklist

- Add the small adapter in Russell's Flask repository: map the recommended
  environment variables to constructors, reuse its existing lease validator,
  and call one `tick` from the existing scheduler owner. Do not add another
  timer or worker.
- Apply the additive live-ingestion migration to staging only.
- Configure the existing Flask lease validator in
  `DatabaseLiveSettlementSink`; do not use an always-true validator outside
  tests.
- Construct `BallDontLieHttpTransport` from the server-side
  `BALL_DONT_LIE_API_KEY` and pass
  `BallDontLieLiveClient.fetch_next_game_date` to the sink.
- Set the exact ruleset ID, version, season, dividend rate, and BDL season, then
  verify all five against one staging slate before enabling writes. Never infer
  policy from the newest database row.
- Start polling the date before its first tipoff so the durable schedule exists
  for the pre-provider lock check. Treat a missing pregame schedule as an alert.
- Keep the adapter disabled for the first dry run and inspect the
  BDL-to-market player crosswalk coverage.
- Enable one staging lease owner, simulate one transient response loss, and
  verify one v2 result, one game cost, one date completion, and no duplicate
  dividend.
- Correct one finalized fixture and verify revision 2 posts only a dividend
  adjustment without reacquiring the roster lock.
- Enable production only after the Flask app contains the v2 schema, service,
  and routes from this branch.

No production database, environment, or deployment was changed by this work.
