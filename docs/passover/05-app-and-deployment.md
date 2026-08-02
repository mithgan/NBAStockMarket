# Passover 05 — The App, Backend, and Deployment

Updated 2026-08-02 after the server-authoritative rebuild. The app is no longer a
static demo: it is an authenticated client against a FastAPI backend with a Supabase
Postgres database. Historical replay ("season progression") is a first-class server
feature via `SeasonControl`.

## Architecture

```
Supabase (auth + Postgres)          Render (render.yaml)
        │                                  │
        └──────► FastAPI backend  ◄────────┘
                 nba_stock_market/api/
                 app.py / main.py     routes & wiring
                 auth.py              JWT verification (Supabase principals)
                 database.py          SQLAlchemy models (accounts, holdings,
                                      instruments, replay events, settlements)
                 service.py           the authoritative game service: trades,
                                      SERVER-OWNED daily settlements from
                                      pre-computed ReplayEventRows, instruments,
                                      account history, keyed locks
                 settings.py          pydantic-settings config
                        ▲
                        │ authenticated JSON (src/api/client.ts)
                Expo app (app/)
```

Replay data path: `scripts/generate_app_trends.py` computes per-game dividends using the
**shared rolling-bias module** (`nba_stock_market/bias.py` — 30-day window, seeded cold
start, min-300-games guard, unit-tested) → replay events land in the database → the server
settles each date exactly once per account, idempotently, when the user advances.

## The app (`app/src/`)

- **Auth**: `auth/` — Supabase sign-in (AuthScreen/AuthContext), token refresh, sign-out;
  `api/client.ts` attaches JWTs and verifies the expected user id.
- **State**: `state/game.ts` — a 1,000+ line pure client state machine mirroring the
  engine/spec constants exactly (0.25% fees, weekly shorts 3×/±25/±50/$2M collateral,
  min $10K fee, boosts 2×, $40K/NP); `serverState.ts` reconciles authoritative snapshots;
  `persistence.ts` (device save + legacy-save migration flow), `actionLock.ts` (double-tap
  guards), `localTransition.ts` (prototype→server account handoff).
- **Screens**: Portfolio (value hero, free-cash/reserved/holdings/cash cards, portfolio
  history chart, roster with cost basis + unrealized P&L, latest daily result, activity
  feed) · Market (search + sort/filter chips, live prices, form sparklines, buy/sell with
  fees at checkout) · **Plays** (the instruments UI: weekly shorts and boosts) ·
  Leaderboard. `SeasonControl` sits above the tabs — the season progression bar (advance
  the replay; the server settles and returns the authoritative result).
- **Design**: `theme.ts` + (on the `codex/standalone-web-flask` branch) a Databallr
  design-system rebuild with `ui/primitives.tsx` — compact money everywhere ($34.6M),
  landscape fixes, denser market scanning. That branch had not merged into the MVP at
  the time of writing; expect it to supersede some screen code here.

## Testing

- App: `cd app && npm test` — **111 tests** (game state machine, server reconciliation,
  persistence, replay, ordering/presentation, UI contracts). `npx tsc --noEmit` clean.
- Python: `python -m pytest tests -q` — **284 passed** as of the last full run. Three
  `tests/api/test_supabase_migration.py` cases shell out to the Supabase CLI via bash and
  fail with exit 127 on machines without it — environment, not code. `python -m unittest
  discover -s tests` covers the non-pytest suites (160).
- Backend deps: `pip install -e .` (fastapi, sqlalchemy, psycopg, PyJWT, uvicorn,
  pydantic-settings, httpx; see `pyproject.toml`; `uv.lock` is committed).

## Deployments

- **API**: `render.yaml` provisions the FastAPI service on Render;
  `scripts/push_supabase_schema.sh` pushes the database schema (guarded: refuses wrong
  project/failed link/failed dry-run).
- **Web app**: the flask/UI branch carries `app/vercel.json` for Vercel; export with
  `npx expo export --platform web` from `app/`.
- **Stale**: https://nba-stock-backsim.vercel.app still serves the OLD client-only
  backsim build (pre-server, superseded SimBar). Treat it as a historical demo; do not
  iterate on it. The client-only backsim code was removed from `mith/experiments` on
  2026-08-02 in favor of the MVP's SeasonControl.

## Traps before you edit

1. `generate_app_trends.py` STILL regex-parses `snapshot.ts` (line ~54) — the most fragile
   coupling in the pipeline; a formatting change to snapshot's player lines silently breaks
   trend regeneration. (Suggested fix on file: emit snapshot.json alongside.)
2. UI-contract tests (`uiContracts.test.ts`, `mvpUiContracts.test.ts`) pin exact source
   patterns in App.tsx/MarketScreen.tsx — run `npm test` after touching those files; put
   new UI in new files.
3. Money display is compact ($34.6M) but affordability math is exact — keep exact figures
   at trade confirmation; two "equal-looking" compact numbers can differ by $100K.
4. Game dates are ET calendar labels; treat as opaque strings, construct dates only with
   `T00:00:00Z`. Server settles by replay date, not wall-clock.
5. `app.json` still locks `"orientation": "portrait"` — iPad multitasking ignores it;
   landscape work on the flask branch is web-oriented.
