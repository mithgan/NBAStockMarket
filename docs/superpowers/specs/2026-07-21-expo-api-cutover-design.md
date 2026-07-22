# Expo Authenticated API Cutover Design

## Outcome

The Expo app uses a Supabase session to call FastAPI and treats the server as the only
authority for money, holdings, market prices, weekly plays, settlements, history, and
leaderboard state. A second device receives the same account immediately after it
authenticates. The app never falls back to the prototype's local calculation engine
when authentication or networking fails.

## Runtime States

The root app has explicit states instead of rendering partial gameplay:

1. `config_missing`: public Supabase URL/key or API URL is absent or invalid.
2. `auth_loading`: Supabase is restoring and validating the saved session.
3. `signed_out`: the email/password sign-in and sign-up form is available.
4. `server_loading`: an authenticated FastAPI snapshot is loading.
5. `transition_required`: a legacy AsyncStorage game exists and must be discarded.
6. `ready`: all visible gameplay reads and writes use FastAPI.
7. `server_error`: gameplay is locked, the last server snapshot may remain visible,
   and an explicit retry is available.

Supabase owns only identity and token refresh. It never receives service-role keys in
the client. Expo public environment variables are expected to be readable in the
compiled application and therefore contain only the API base URL, project URL, and
publishable key.

## API Client

A typed client validates every response envelope at runtime and converts integer cents
to display dollars only at the UI boundary. It attaches the current bearer token to
every request. A `401` forces one Supabase session refresh before failing signed out.

All state-changing requests receive a fresh idempotency key. Network/5xx retries reuse
that exact key, so a lost response cannot duplicate a trade, short, boost, or account
transition. UI action locks prevent repeated taps while the request is unresolved.
Client errors preserve FastAPI's public error code and message without exposing raw
response bodies.

The bootstrap snapshot includes market, portfolio, game clock, activity, portfolio
history, settlements, and leaderboard data. After a mutation the app reloads the
authoritative snapshot rather than attempting to reproduce server calculations.

## Local-Save Transition

AsyncStorage gameplay is no longer loaded into the active game context and is never
uploaded. After the first authenticated portfolio load, the app checks for the legacy
save. If one exists, the user sees a one-time explanation that prototype progress
cannot be trusted or imported.

On confirmation, a pristine server account calls `POST /api/v1/account/reset` with the
last-read account version and an idempotency key. A server account that already has
activity remains authoritative and skips destructive reset. Only after a successful
server reload does the client remove the old gameplay key and write a user-scoped
transition marker. A failed server call or failed local clear leaves the old save in
place for another attempt.

## UI Changes

- The global replay clock becomes read-only. Users can refresh it, but the settlement
  admin secret never ships in Expo.
- Portfolio reset is removed after cutover because the server only permits the one-time
  pristine transition.
- Market, plays, and leaderboard use server listings and account state.
- Loading, retry, signed-out, pending-action, and configuration states remain readable
  and keyboard/screen-reader accessible.
- A sign-out command is available from the header.

## Verification

Pure tests cover configuration, response validation, bearer authentication, 401 token
refresh, same-key mutation retry, local transition ordering, server-to-screen mapping,
and duplicate-action locks. Existing UI contract tests are updated to prove no local
settlement or reset command remains. Final gates are Expo tests, TypeScript, web export,
Python regressions, a rendered web smoke, and autoreview.

## Boundaries

This task does not push, deploy, apply a Supabase migration, create production users,
or ship an admin settlement credential. Real-device authentication requires public app
configuration and a reachable FastAPI deployment; unavailable external wiring is
reported separately from local implementation correctness.
