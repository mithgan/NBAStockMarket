# NBA Talent Market

A persistent, skill-based **fantasy stock market for NBA players**, played with in-platform
(fake) cash. Users buy and sell shares of players; prices move with **market demand**, while
**real on-court performance versus expectation** pays signed cash dividends tied to NBA
results. Everyone starts with $207,824,000 and competes on a leaderboard by net worth. It never
resets — it's a long game of being right about players before the crowd is.

No real money, no cash-out — which keeps it out of gambling/securities territory entirely.

## Economy v2

Engine v2 uses a **$207,824,000 virtual bankroll**, matching the official 2025-26 second apron,
and salary-like per-share prices: roughly
$40–70M for stars, $15–30M for rotation players, and $2–12M for bench players. Each player
has a 100-share float, but **one share represents the whole player at his listed salary** and
each user may hold at most one share of a given player. Trading fees, flip penalties, the
small idle-cash sink, listing grace period, inactivity decay, and a salary-scale minimum price
floor remain in force.

Price is now supply and demand plus inactivity decay. Fair-value reversion remains available
as an experiment, but its default rate is **0**; it is not part of the v1 economy. On-court
performance reaches holders through a daily actual-versus-expected dividend:

```
dividend_per_share = (actual_net_points - expected_net_points)
                   × $8,000,000 / 100 shares
expected_net_points = D&T projection + 0.43586494964917194 NP league-bias correction
```

Exact bias-corrected expectation pays $0 and underperformance produces a negative dividend. The
`NET_POINTS_TO_DOLLARS = $8,000,000` means $80,000 per net point per holder, so a +20
surprise pays that holder $1,600,000. The deterministic 2025-26 candidate replay selected
$80,000 as the lowest rate satisfying the +20 impact, +5 UI visibility, season-drift, and
pre-clamp symmetry constraints. The league-mean expectation-bias correction remains on by
default; at the selected rate the replay's full-season economy drift is -1.744779%.
Cached Dunks & Threes pregame projections are the canonical expectation source;
`trailing`, `projection`, and `production` remain comparison modes. The
box-score-to-net-points model is transparent and swappable, as is the injected expectation
source; the engine does not fetch projections itself.

Award and season-end WARP dividends remain in the code for optional experiments, but are
dormant and outside the daily Engine v2 flow.

## The core idea: demand plus performance dividends

A player's price responds directly to trading demand:

**Force A — Demand (short-term).** Every trade moves the price. Buys push it up, sells push it
down, scaled by the player's liquidity/depth `L` so thin names can't be cheaply manipulated:

```
P ← P × exp( k × shares / L )        # +shares = buy, −shares = sell, prototype k = 0.003
```

Performance does not automatically rewrite that price. Instead, a game settles against an
injected expectation and credits or debits current holders. Optional fair-value reversion can
still be enabled to compare experimental economies:

```
P ← P + λ × (FV − P)                 # default λ = 0
```

The crowd sets the tradable price; beating the public projection pays holders daily.

## Why this design

This market model is derived from a reverse-engineering of **CraftedNBA's live market** (see
[docs/craftednba-market-model.md](docs/craftednba-market-model.md)). Their price is **100%
demand-driven** — performance never touches the price, `fairValue` is frozen at the IPO price,
and untraded players just decay −0.5%/day. It's a popularity contest with a dividend coupon
stapled on.

Engine v2 keeps exponential impact, fees, dividends, and equal starts while moving to the
$207.824M second-apron scale. Daily surprise dividends carry the performance signal; liquidity-scaled
impact resists whale manipulation, and explicit sinks help control inflation.

## Key mechanics at a glance

| Mechanic | Rule |
|---|---|
| Starting bankroll | $207,824,000 for everyone; score = cash + (shares × price) |
| Execution | Single price, no spread; 0.25% fee on every buy and sell |
| Anti-churn | 0.5% escalating flip surcharge on same-player round-trips within 24h, capped at 1.5% |
| Roster / anti-cornering | One whole-player share at listed salary; max one per player per user |
| Price drift | Supply/demand plus inactivity decay after the listing grace period |
| Fair-value reversion | Default off (`0`); retained only as an experiment |
| Floor | $350,000 absolute minimum (the old $25 floor scaled by 14,000×) |
| IPOs | Model-seeded fair value + opening auction; 7-day grace period |
| Daily dividend | D&T-projected vs actual; `$80,000 × bias-corrected surprise net points` per holder |
| Award/WARP dividends | Optional/dormant; not part of the daily v1 economy |
| Economy | League-bias correction targets zero net dividends; fees, flip penalties, and idle cash are sinks |

## Docs

| Doc | What it is |
|---|---|
| [docs/nba-talent-market-plan.md](docs/nba-talent-market-plan.md) | **The build spec.** Full project plan: pricing model, trading rules, IPOs, dividends, economy, schema, pseudocode, roadmap. Assumes zero prior context. |
| [docs/pricing-writeup.md](docs/pricing-writeup.md) | Short explainer of the two-force pricing model. |
| [docs/craftednba-market-model.md](docs/craftednba-market-model.md) | Reverse-engineered CraftedNBA market (their parameters, verified decay, dividend tables) + our recommended improvements. |
| [docs/PLAN.md](docs/PLAN.md) | Earlier concept-stage plan (positioning, competitive landscape, architecture sketch). Partially superseded by the build spec above. |

## Build order

From the spec (§12 of the build plan):

1. **Phase 0 — Engine prototype**: pure Python + SQLite. Trade execution, daily performance
   dividends, and a synthetic-season simulation proving the economy is stable.
2. **Phase 1 — API + persistence** (FastAPI/Express): players, trades, portfolio, leaderboard.
3. **Phase 2 — Stats pipeline**: nightly real-NBA results and projected box-score inputs.
4. **Phase 3 — Frontend**: player board, charts, trade modal, portfolio P&L, leaderboard.
5. **Phase 4 — Dividends & seasons**: award ingestion + season-end WARP dividend run.
6. **Phase 5 — Integrity**: wash-trade detection, dividend anti-sniping, sinks.
7. **Phase 6 (stretch) — Shorting**: makes the market fully two-sided.

Data sourcing: nightly batch from public NBA stats (the installed `espn-pp-cli` covers scores,
box scores, injuries, and news; advanced metrics need a separate source).

## Prototype commands

This repo now includes the Phase 0 standalone pricing simulation. It is intentionally local and
deterministic: no network calls, no UI, no external database.

Run the verifier:

```bash
python3 -m pytest -q
```

Run the deterministic trader sweep and write its JSON evidence plus readable report:

```bash
python3 -m nba_stock_market.simulation --days 45 \
  --seeds 7 42 1337 \
  --candidates 0.0003 0.001 0.003 0.01 0.03 \
  --output output/trader-simulation.json \
  --report output/trader-simulation.md
```

The entrypoint keeps game dividends and fair-value reversion off so it can isolate supply/demand
price impact and inactivity decay. It runs balanced, hype-heavy, and boom/bust order flows across
fixed seeds using nine real players across star/mid/bench salary tiers. NBA-9 selected `0.003` as
the strongest candidate that stayed below the prototype price-safety gates. The report also found
the fee decision lowers the base fee to 0.25% and caps the softened flip surcharge at 1.5%, keeping
anti-churn friction while sharply reducing wealth destruction under high turnover.

## Backend API

The current Expo client uses the Databallr Flask implementation under
`/api/nba-stock-market`. That backend owns production accounts, trades, instruments,
settlements, and leaderboard state. Configure its base URL with
`EXPO_PUBLIC_NBA_STOCK_API_URL`; the mobile client never talks directly to the database.

### Legacy Phase 1 reference

The original FastAPI service in `nba_stock_market/api/` remains as the Phase 1 reference and test
harness. It owns
account creation, the $207.824M starting balance, listings, one-whole-player holdings, fees, price
impact, idempotent buys/sells, the portfolio leaderboard, and the global historical replay clock.
Daily settlements are atomic and idempotent: the server pays the signed canonical dividend to each
current holder, records a per-account ledger row, advances exactly one date, and stores
reconciliation totals in one transaction. The initial market and replay events are generated from
the same sources used by Expo, so the app and API do not maintain separate calculation paths.

| Route | Auth | Purpose |
|---|---|---|
| `GET /healthz` | Public | Liveness check |
| `GET /readyz` | Public | Database migration, connectivity, and seed readiness |
| `GET /api/v1/market` | Bearer | Current listings, float, ownership, and volume |
| `GET /api/v1/portfolio` | Bearer | Cash, holdings, P&L, and recent trades |
| `GET /api/v1/portfolio/history` | Bearer | Cursor-paginated daily closing portfolio values |
| `GET /api/v1/activity` | Bearer | Cursor-paginated trades, instruments, and settlement activity |
| `GET /api/v1/dividends` | Bearer | Cursor-paginated per-player dividend activity |
| `GET /api/v1/game` | Bearer | Global replay date and completion state |
| `GET /api/v1/instruments` | Bearer | Weekly slot usage, reserved collateral, and current short/boost positions |
| `POST /api/v1/instruments/weekly-shorts` | Bearer + `Idempotency-Key` | Arm a server-dated weekly performance short |
| `POST /api/v1/instruments/boosts` | Bearer + `Idempotency-Key` | Boost one owned player's signed dividend for a specified replay date |
| `GET /api/v1/settlements` | Bearer | Daily settlement totals and the current user's dividends |
| `POST /api/v1/trades` | Bearer + `Idempotency-Key` | Authoritative whole-player buy or sell |
| `POST /api/v1/account/reset` | Bearer + `Idempotency-Key` | One-time, pre-play local-save transition |
| `GET /api/v1/leaderboard` | Bearer | Current portfolio-value ranking |
| `POST /api/v1/admin/settlements/next` | `X-Settlement-Key` + `Idempotency-Key` | Scheduler-only, expected-date-guarded clock advancement |

Create the generated market seed and start a local database:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[dev]'
python scripts/generate_app_snapshot.py
python scripts/generate_app_trends.py
set -a && source .env && set +a
uvicorn nba_stock_market.api.main:app --host 127.0.0.1 --port 8011 --reload
```

Copy `.env.example` to the gitignored `.env` before sourcing it. Protected routes fail closed until
`NBA_STOCK_SUPABASE_URL` is configured. Asymmetric Supabase user JWTs are verified locally against
the project's JWKS; legacy HS256 user tokens are checked through Supabase Auth and additionally
require `NBA_STOCK_SUPABASE_PUBLISHABLE_KEY`. A service-role key is neither required nor accepted by
this API configuration.

For deployment, use `postgresql+psycopg://...` for `NBA_STOCK_DATABASE_URL`, set
`NBA_STOCK_ENVIRONMENT=production`, and leave `NBA_STOCK_AUTO_CREATE_SCHEMA=false`. A direct or
session-pooler connection on port 5432 is preferred for a persistent backend. Supabase transaction
pooler URLs on port 6543 are also supported; the API automatically disables psycopg prepared
statements for that mode. Production schema changes must happen through separately reviewed
migrations; the API process must never create or mutate its own schema. Set a separate random
`NBA_STOCK_SETTLEMENT_ADMIN_KEY` only on the API and scheduler; it must never ship in the mobile
client. Signed settlement losses may take cash below zero, but affordability checks block new buys
and instrument risk until the account recovers. Active weekly-short collateral is reserved rather
than removed from cash and is excluded from every affordability check. Weekly shorts and boosts use
the server's Monday-Sunday replay week, enforce their per-user slot and cross-position rules
transactionally, and settle in the same transaction as the base dividend. Historical replay uses
the current replay date as its arming cutoff; production live-season wiring must replace that guard
with authoritative game tipoff timestamps. Projection-only DNP rows carry a zero base dividend so
armed boosts refund and zero-qualifying-game shorts void without inventing a played result. `/docs`
is disabled in production.

Activity and portfolio-history pages are ordered deterministically and use opaque, account-scoped
cursors. The portfolio response exposes an account `version` for optimistic writes and `reset_at`
as an informational transition timestamp. History membership uses durable account rows and daily
snapshots plus migration-captured legacy membership rather than comparing application-worker
clocks. Reset requires the exact `RESET`
confirmation plus the latest account version and is available only once, before the first
server-side trade or instrument. It clears idle-account snapshots while preserving global market
prices and the replay clock. Once an account participates in the economy, reset fails with
`reset_not_eligible` and cannot erase losses or retain market impact while restoring cash.
Retrying the original successful reset key returns the stored response.
The account-history migration backfills activity from the authoritative trade, dividend, short,
and boost ledgers. Exact portfolio-value history begins with the migration because historical
closing market values cannot be reconstructed safely; the existing settlement feed preserves
all older global dates for accounts present at cutover through durable account/settlement
membership rows. The migration takes the NBA-26 global write barrier, locks accounts before the
source ledgers, then leaves compatibility triggers in place so older rolling-deployment workers
cannot create activity or settlement-history gaps. Deploy through NBA-26 before applying it.

The Expo API cutover intentionally does not import the historical AsyncStorage prototype save into
the authoritative economy. On first authenticated launch, the client must explain the one-time
reset, load a valid server portfolio, and only then clear the old gameplay save. If authentication
or the portfolio load fails, the local save remains untouched and the transition can be retried.

The market database is intentionally separate from the Databallr production database. Databallr
Supabase remains the authentication issuer, while `NBA_STOCK_DATABASE_URL` points at the dedicated
NBA Stock Market Postgres project. Authenticate the Supabase CLI, identify the dedicated project,
then use the fail-closed helper to apply the checked-in schema and canonical 30-player seed. The
helper stops if linking or the dry run fails, verifies the linked project before mutation, and
prompts for the password without putting it in command arguments:

```bash
npx supabase login
export SUPABASE_PROJECT_REF="vykoykabweuemstpqljg"
./scripts/push_supabase_schema.sh
unset SUPABASE_PROJECT_REF
```

The schema migration enables RLS and revokes `anon` and `authenticated` table privileges. The seed
migration is idempotent and never overwrites listings that already exist. Mobile clients must use
the Flask routes; they never read or mutate market balances, holdings, prices, or trades through
Supabase's Data API.

`generate_app_trends.py` updates only the unversioned app and replay JSON artifacts by default. If
replay instrument data changes after a migration is applied, pass
`--api-instruments-sql-output supabase/migrations/<new-version>_seed_replay_instruments.sql`; never
reuse an applied migration filename.

The second-apron economy intentionally regenerates the canonical replay seed at
$80,000 per net point. Existing databases must apply the checked-in guarded
`20260815000000_rebase_market_economy.sql` migration before the matching Flask
deployment. Supabase CLI records the version for the migration under `supabase/migrations`;
the direct-psql Flask companion records it atomically itself. Readiness includes that
version so a mixed $140M/$207.824M deployment fails closed. The migration also retains a
database trigger that rejects an explicit legacy $140M account insert atomically. An old
worker that survives quiescing therefore fails closed instead of persisting or returning an
underfunded account. The Supabase CLI migration intentionally has no explicit `COMMIT`, keeping the
cash grant and CLI-owned migration-history write atomic.

## Backtest

The historical replay covers the complete 2025-26 NBA regular season using cached ESPN
player-game box scores, pinned public salary snapshots, cached Dunks & Threes projections,
and the committed Mith opening-price CSV. From a fresh checkout, run this complete sequence
(`DNT_API_KEY` is required; never commit its value):

Ball Don't Lie (BDL) is the canonical live-capable per-game actuals source alongside cached ESPN.
Set `BALL_DONT_LIE_API_KEY` in the environment or `.env`; BDL pages cache under `data/raw/bdl/`.
Run the bounded source check with `python3 -m nba_stock_market.bdl_data --smoke-jokic`.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e . pytest
printf "DNT API key: " && read -rs DNT_API_KEY && export DNT_API_KEY && echo
python scripts/prepare_fv_inputs.py
python -m nba_stock_market.opening_prices
python -m nba_stock_market.fv_validation
python scripts/fetch_backtest_data.py
python scripts/fetch_dnt_predictions.py
python -m nba_stock_market.backtest --economy-calibration
python -m nba_stock_market.backtest
python scripts/generate_app_snapshot.py
python scripts/generate_app_trends.py
python -m scripts.generate_expectation_comparison
python -m pytest -q
```

The fetchers are idempotent and resume their caches. `prepare_fv_inputs.py` copies every FV
input from an exact committed snapshot and verifies it against
`data/manifests/fv-inputs.json`; `--refresh` checks live providers separately and reports drift.
Once cached,
report generation makes no network calls. `output/economy-calibration-2026.md` compares all five
candidate rates and records the lowest-passing selection; `output/backtest-2026.md` is the
canonical selected-rate replay. The replay selects the top 150 players by regular-season minutes, lists them from
`output/opening-prices-2026-27.csv` using projected-WAR fair value plus a 10% salary blend
(with reported salary fallbacks), and evaluates 100 seeded buy-and-hold 10-player portfolios. The default expectation
model is cached Dunks & Threes; missing projection rows use the salary-implied cold-start prior.
Trading and live Dunks & Threes calls are deliberately disabled during replay.
