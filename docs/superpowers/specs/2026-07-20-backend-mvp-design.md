# NBA Stock Market Backend MVP Design

> Historical design snapshot. The current economy uses a $207.824M bankroll and
> $80K/NP owned-player dividends; see `docs/PLAN.md` and `docs/pricing-writeup.md`.

## Goal

Move the market's trust boundary out of the Expo client. The server owns balances,
holdings, prices, trades, and idempotency. A client may request an action, but it may
never submit a calculated balance, fee, execution price, payout, or leaderboard score.

## First vertical slice

- `GET /healthz`: unauthenticated liveness.
- `GET /api/v1/market`: authenticated current listings and market ownership.
- `GET /api/v1/portfolio`: authenticated cash, holdings, valuation, and recent trades.
- `POST /api/v1/trades`: authenticated whole-player buy/sell with a required
  `Idempotency-Key` header.
- `GET /api/v1/leaderboard`: authenticated portfolio-value ranking.

The slice implements the decided economy: $140M starting cash, one whole-player share
per user, 100-share league float, 0.25% fee, the existing flip surcharge, and
liquidity-scaled exponential price impact.

## Authentication

Production uses a Supabase access token in `Authorization: Bearer <jwt>`. The verifier is
an injected boundary so tests never need real credentials. Asymmetric Supabase tokens are
verified against the project's JWKS endpoint. Legacy HS256 projects are verified through
the Supabase Auth user endpoint with the publishable key. Missing or invalid credentials
fail closed with HTTP 401.

## Persistence and concurrency

SQLAlchemy models use integer cents for every money field. SQLite supports local tests;
PostgreSQL is the deployment target. A trade runs in one database transaction while
locking the account and listing. Unique constraints protect one holding per
account/player and one idempotency key per account. The listing stores aggregate held
shares so float enforcement is atomic with price updates.

The in-process keyed lock makes SQLite and a single API worker deterministic. PostgreSQL
row locks are the multi-worker authority. No production migration is applied in this task.

## Idempotency

The idempotency key is scoped to the authenticated account. Repeating the same key and
body returns the original trade with `replayed: true` and causes no second mutation.
Reusing the key with a different body returns HTTP 409.

## Deferred work

- Weekly-short and boost persistence/settlement endpoints.
- Price shorts (specified but launch-disabled).
- Nightly BDL/D&T ingest and signed-dividend settlement jobs.
- Friend leagues, push notifications, admin operations, and fraud review.
- Alembic/Supabase migration application and production deployment.
