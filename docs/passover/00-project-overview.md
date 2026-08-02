# Passover 00 — Project Overview

Read this first. The passover set (00-06) is a complete handover: someone with zero context
should be able to read these in order and take over any part of the project. Each doc links
to the deeper source-of-truth documents rather than duplicating them.

## What this project is

**NBA Stock Market** (working brand: DataBallr) — a free-to-play fantasy *stock market* for
NBA players. Every user starts with a **$140M virtual bankroll** (the real salary-cap scale),
drafts a ~10-player portfolio by buying one share of each player at model-set listing prices,
and competes on total net worth over a season. The core loop:

1. **Prices** move on supply and demand (plus inactivity decay) — *not* on performance.
2. **Performance pays cash**: after every real NBA game, holders receive a dividend equal to
   the player's *surprise* — actual minus projected net points — at **$40,000 per net point**.
   Exactly-as-projected pays $0; underperformance debits. "SGA gave you a +$800K night."
3. **Skill = beating the market's expectations**, not owning the best players. A Collin
   Sexton 30-piece pays more than a routine Luka 30, because the projection already priced
   Luka's.

No real money, no cash-out, no purchase-to-play — deliberately outside gambling/securities
territory (this killed every real-money predecessor: Football Index, Mojo, Fantex).

## Why it's built this way (compressed history)

- Researched the graveyard: real-money player markets die of regulation or Ponzi dividends;
  fake-money ones die of boredom. Answer: fake money + real-data dividends + reputation.
- Reverse-engineered **CraftedNBA**'s live market (the closest incumbent): pure
  demand-driven prices, exponential impact k≈0.0003, verified −0.5%/day inactivity decay,
  award/WARP dividends. Its flaw: performance never touches anything financially meaningful
  day-to-day. Full teardown: `docs/craftednba-market-model.md`.
- Group call (transcript in team history) locked the big decisions: $140M salary-scale
  bankroll, ~10-player rosters, one share = whole player, daily surprise dividends carry the
  performance signal, fair-value price reversion OFF, shorting later, mobile-first (Expo).
- **Option B** (decided by Mith, Discord 7/14): expectations come from cached **Dunks &
  Threes pregame projections** plus a league bias correction, making dividends
  ~zero-expectation for a correctly-projected player.

## Current status (as of 2026-08-02)

| Piece | Status |
|---|---|
| Engine v2 (trading, fees, dividends) | Built, tests green (`nba_stock_market/engine.py`) |
| 2025-26 full-season backtest | Reproduces committed report to the dollar |
| Fair-value listing model v2 | Validated, generates `output/opening-prices-2026-27.csv` |
| Shorting/boost instruments | Spec v1.0 implemented server-side AND in the app (Plays tab) |
| Backend | FastAPI + Supabase auth/Postgres; server-owned settlements; Render config (`render.yaml`) |
| Mobile app | Server-authoritative 4-tab Expo app with auth, persistence, SeasonControl season replay |
| Rolling-bias correction | **LANDED**: shared `nba_stock_market/bias.py` (30d window, seeded cold start), feeds the replay/settlement pipeline |
| UI rebuild (Databallr design system) | In flight on `codex/standalone-web-flask` (sort/filters, compact money, density) |

## The team

- **Russell (Russ)** — direction, DataBallr ecosystem, D&T/EPM API access, impact metrics.
- **Ryan (bigbrolin)** — engine, data infrastructure, backtests, app scaffold.
- **Mith** — game economy design, FV/pricing model, dividend calibration, shorting spec.
- **Andrew** — impact metrics consulting (with Russ).
- **Gabriel** — CraftedNBA; his public repo `gabriel1200/site_Data` is our salary/LEBRON source.

## Branches

- `main` — early docs only, stale.
- `codex/nba-stock-sim-prototype` — **the MVP branch**: engine, research, backend, app.
- `codex/standalone-web-flask` — Ryan's UI rebuild (Databallr design system) + Flask web
  preview; expected to fold back into the MVP.
- `mith/experiments` — tracks the MVP exactly, plus these passover docs. (Its earlier
  client-only backsim was retired 2026-08-02 when the MVP shipped its own SeasonControl.)

## Repo map (one line each)

```
nba_stock_market/engine.py            Market core: trades, fees, dividends (Engine v2)
nba_stock_market/expectations.py      Expectation sources; D&T cached projections (canonical)
nba_stock_market/bias.py              Shared rolling-30 bias correction (seeded cold start)
nba_stock_market/opening_prices.py    Fair-value listing model v2 (ProjectedWarModel)
nba_stock_market/instruments.py       Weekly shorts, price short, boosts (spec v1.0)
nba_stock_market/api/                 FastAPI backend: auth, DB models, authoritative service
nba_stock_market/backtest.py          Deterministic 2025-26 season replay + report
nba_stock_market/instruments_simulation.py  Trader sim = acceptance harness for instruments
nba_stock_market/simulation.py        Ryan's trader sweep (impact_k calibration)
nba_stock_market/fv_validation.py     FV backtest verifier (Spearman, season pairs)
nba_stock_market/epm_data.py          D&T EPM season-snapshot fetcher
scripts/                              Data fetchers, app snapshot/trend generators, schema push
app/                                  Expo app: auth + server-backed game (see passover 05)
render.yaml                           Render deployment for the API
docs/                                 Specs, proposals, research log (see each passover doc)
output/                               Committed evidence reports (whitelisted in .gitignore)
data/raw/                             Git-ignored caches (see passover 04 to regenerate)
```

## Reading order for a full handover

1. This doc.
2. `01-economy-and-engine.md` — how money works.
3. `02-fair-value-model.md` — how listing prices are set.
4. `03-instruments-shorts-longs.md` — the side-bet layer.
5. `04-data-and-reproducibility.md` — caches, keys, regeneration.
6. `05-app-and-deployment.md` — the product surface.
7. `06-roadmap-open-questions.md` — what's undecided and what's next.
