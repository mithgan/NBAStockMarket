# Expo Authenticated API Cutover Plan

**Goal:** Make authenticated FastAPI data the Expo app's only gameplay authority.

**Permission:** Local edits, tests, Linear updates, and a local commit only. No push,
deploy, production mutation, or Supabase migration apply.

## Task 1: Client contracts and retry semantics

- [x] Add public app configuration validation.
- [x] Add runtime-validated FastAPI response contracts.
- [x] Add authenticated request, token refresh, timeout, and same-key retry behavior.
- [x] Test malformed payloads, API errors, 401 refresh, and idempotent retries.

## Task 2: Supabase session and auth UX

- [x] Configure the Supabase React Native client with persisted sessions.
- [x] Add session restore, email sign-in/sign-up, sign-out, and visible errors.
- [x] Keep missing configuration explicit and non-crashing.

## Task 3: Server-backed portfolio context

- [x] Map server cents/read models into the existing presentation model.
- [x] Replace local trades, instruments, history, and leaderboard authority.
- [x] Replace client settlement with an authenticated refresh command.
- [x] Lock duplicate actions and reload authoritative state after writes.

## Task 4: One-time local-save transition

- [x] Detect but never execute the legacy save.
- [x] Require explicit confirmation after a successful server portfolio load.
- [x] Reset only pristine server accounts and keep existing server accounts canonical.
- [x] Clear the old save before recording a user-scoped transition marker.
- [x] Test storage and network failure ordering.

## Task 5: UX integration

- [x] Add loading, signed-out, transition, offline/error, retry, and sign-out surfaces.
- [x] Update Market, Portfolio, Plays, Season, and Leaderboard for server state.
- [x] Remove misleading local reset/advance copy and preserve accessibility.

## Task 6: Verification and closeout

- [x] Run focused tests after each slice.
- [x] Run all Expo tests, TypeScript, web export, and Python regressions.
- [x] Smoke the rendered web app at phone and desktop widths.
- [x] Run autoreview and fix every accepted finding; record that the final clean rerun was blocked by Codex CLI capacity/authentication.
- [x] Commit locally, update Linear NBA-28, and report untested external wiring.
