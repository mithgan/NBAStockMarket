# NBA Talent Market

A persistent, skill-based **fantasy stock market for NBA players**, played with in-platform
(fake) cash. Users buy and sell shares of players; prices move with **market demand**, while
**real on-court performance versus expectation** pays signed cash dividends tied to NBA
results. Everyone starts with $140,000,000 and competes on a leaderboard by net worth. It never
resets — it's a long game of being right about players before the crowd is.

No real money, no cash-out — which keeps it out of gambling/securities territory entirely.

## Economy v2

Engine v2 uses a **$140,000,000 virtual bankroll** and salary-like per-share prices: roughly
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
                   × $4,000,000 / 100 shares
```

Exact expectation pays $0 and underperformance produces a negative dividend. The
`NET_POINTS_TO_DOLLARS = $4,000,000` means $40,000 per net point per holder, so a +20
surprise pays that holder about $800,000. This is **PROVISIONAL pending Mith's NBA-12
calibration**. Cached Dunks & Threes pregame projections are the canonical expectation source;
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
$140M salary scale. Daily surprise dividends carry the performance signal; liquidity-scaled
impact resists whale manipulation, and explicit sinks help control inflation.

## Key mechanics at a glance

| Mechanic | Rule |
|---|---|
| Starting bankroll | $140,000,000 for everyone; score = cash + (shares × price) |
| Execution | Single price, no spread; 0.25% fee on every buy and sell |
| Anti-churn | 0.5% escalating flip surcharge on same-player round-trips within 24h, capped at 1.5% |
| Roster / anti-cornering | One whole-player share at listed salary; max one per player per user |
| Price drift | Supply/demand plus inactivity decay after the listing grace period |
| Fair-value reversion | Default off (`0`); retained only as an experiment |
| Floor | $350,000 absolute minimum (the old $25 floor scaled by 14,000×) |
| IPOs | Model-seeded fair value + opening auction; 7-day grace period |
| Daily dividend | D&T-projected vs actual; `$40,000 × surprise net points` per holder (provisional NBA-12) |
| Award/WARP dividends | Optional/dormant; not part of the daily v1 economy |
| Economy | Dividends are faucets; fees, flip penalties, idle-cash fee are sinks |

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
python scripts/fetch_backtest_data.py
printf "DNT API key: " && read -rs DNT_API_KEY && export DNT_API_KEY && echo
python scripts/fetch_dnt_predictions.py
python -m nba_stock_market.backtest
python -m scripts.generate_expectation_comparison
python -m pytest -q
```

Both fetchers are idempotent and resume their caches. Once cached, report generation makes no
network calls. The replay selects the top 150 players by regular-season minutes, lists them from
`output/opening-prices-2026-27.csv` using Mith's impact + salary blend (with reported salary
fallbacks), and evaluates 100 seeded buy-and-hold 10-player portfolios. The default expectation
model is cached Dunks & Threes; missing projection rows use the salary-implied cold-start prior.
Trading and live Dunks & Threes calls are deliberately disabled during replay.
