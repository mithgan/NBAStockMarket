# Prior-season NBA history

Player profiles fetch historical NBA box scores from Databallr's existing public Cloudflare API:
`GET https://api.databallr.com/v1/nba/players/gamelog?nba_id=<NBA_ID>&year=<END_YEAR>&playoffs=0&limit=200`.

This is the database-backed game-log route already used by Databallr. It is separate from the BDL `game-logs` route. No new backend, credentials, provider subscription or settlement job is required. Requests omit cookies and account authorization headers. This public NBA data source is also used by local practice.

## Identity and season

Stock-market player IDs and NBA IDs use different namespaces. `playerHistoryPlayers.ts` provides an explicit verified crosswalk for listed players, with provenance in `player-history-identity.md`. A normalized full-name match is required in addition to the known market ID; every returned row must match the mapped NBA ID and normalized name. Unknown identities return unavailable rather than guessing.

The app derives the previous season from the game's current season: 2025-26 -> 2024-25 (API end-year2025), 2026-27 ->2025-26 (end-year2026). Malformed season labels return unavailable. The API's season/year and playoff fields are checked on every row. The view always states its actual season.

## Loading, errors and completeness

History loads on opening a profile. The UI has distinct loading, failed-with-retry and unavailable states. Requests abort on profile change/unmount and time out after12seconds. Rendered state is keyed by player/name/season so another player's old statistics cannot flash while the next request starts. Valid successful responses, including empty seasons, are cached in memory for15minutes; failures are not cached. At most100cache entries are retained.

The request limit200 exceeds a player's possible regular-season appearance count. A response reaching that cap is rejected rather than silently presented as a full season. Malformed response shapes, mixed identities/seasons, playoff rows, impossible dates, duplicate player/date rows, missing/nonfinite/negative statistics and fractional counting stats are rejected. Explicit zero-minute appearances are excluded; missing minutes are not treated as DNP. Zero-point played games remain included in averages.

## Display fields and missing data

Points, rebounds, assists and decimal minutes are preserved from the API. Numeric MIN is already decimal minutes in Databallr's existing game-log UI; it is not minutes.seconds. All valid played games determine season averages and the points chart. The log defaults to five newest rows and can expand to all.

The database does not consistently supply opponent or home/away. Missing opponents produce date-only rows; missing venue never implies away. The date/NBA-ID combination is an internal stable display key, not a provider game identifier. The request URL is retained with the loaded data for traceability; no source link is displayed in the profile.

Historical NBA data never changes prices, holdings, practice results, payouts or account score. Generated practice money estimates remain separately labeled. The superseded ESPN snapshot and generator are removed; no fallback to that static history remains.

## Verification

Run `npx tsc --noEmit` and `npm test` from app. Focused files: `playerHistory.test.ts` and `profileHistoryView.test.ts`. The identity audit records live API coverage; browser verification checks actual requests, displayed numbers, theme states, expanding logs, switching players and missing history. No network is required by unit tests.
