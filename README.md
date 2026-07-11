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
still has 100 shares, each user may own at most 40%, and trading fees, flip penalties, the
small idle-cash sink, listing grace period, inactivity decay, and a salary-scale minimum price
floor remain in force.

Price is now supply and demand plus inactivity decay. Fair-value reversion remains available
as an experiment, but its default rate is **0**; it is not part of the v1 economy. On-court
performance reaches holders through a daily actual-versus-expected dividend:

```
dividend_per_share = (actual_net_points - expected_net_points)
                   × $100,000 / 100 shares
```

Exact expectation pays $0 and underperformance produces a negative dividend. The
`NET_POINTS_TO_DOLLARS = $100,000` calibration means a +5 game creates $500,000 of value
across all 100 shares, or $5,000 per share. For scale, two shares of a ~$50M star earning that
payout across 82 games would add $820,000; ten shares distributed across a salary-scale
portfolio would add $4.1M. The constant is intentionally explicit so the next backtest can tune it. The
box-score-to-net-points model is transparent and swappable, as is the injected expectation
source; the engine does not fetch projections itself.

Award and season-end WARP dividends remain in the code for optional experiments, but are
dormant and outside the daily Engine v2 flow.

## The core idea: demand plus performance dividends

A player's price responds directly to trading demand:

**Force A — Demand (short-term).** Every trade moves the price. Buys push it up, sells push it
down, scaled by the player's liquidity/depth `L` so thin names can't be cheaply manipulated:

```
P ← P × exp( k × shares / L )        # +shares = buy, −shares = sell, k ≈ 0.0003
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
| Execution | Single price, no spread; 1% fee on every buy and sell |
| Anti-churn | Escalating flip penalty on same-player round-trips within 24h |
| Anti-cornering | Per-user ownership cap (~40% of a player's 100 shares) |
| Price drift | Supply/demand plus inactivity decay after the listing grace period |
| Fair-value reversion | Default off (`0`); retained only as an experiment |
| Floor | $350,000 absolute minimum (the old $25 floor scaled by 14,000×) |
| IPOs | Model-seeded fair value + opening auction; 7-day grace period |
| Daily dividend | `(actual net points − expected net points) × $100,000 / 100` per share |
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

Run the sim and write a comparison artifact:

```bash
python3 -m nba_stock_market.simulation --seed 1337 --days 45 --output output/sim-summary.json
```

The entrypoint compares default pure-crowd pricing with two explicitly configured
fair-value-reversion experiments. Every variant uses deterministic fake game results and nine
real players across star/mid/bench salary tiers; the v1/default market remains reversion-free.

## Backtest

The historical replay covers the complete 2025-26 NBA regular season using cached ESPN
player-game box scores and pinned public salary snapshots. Cache the inputs once (the command
is idempotent and resumes partial downloads):

Ball Don't Lie (BDL) is the canonical live-capable per-game actuals source alongside cached ESPN.
Set `BALL_DONT_LIE_API_KEY` in the environment or `.env`; BDL pages cache under `data/raw/bdl/`.
Run the bounded source check with `python3 -m nba_stock_market.bdl_data --smoke-jokic`.

```bash
/usr/local/bin/python3 scripts/fetch_backtest_data.py
```

Then regenerate the committed Markdown and JSON reports deterministically from cached data
with one command:

```bash
/usr/local/bin/python3 -m nba_stock_market.backtest
```

The replay selects the top 150 players by regular-season minutes, lists them at salary-derived
prices, and evaluates 100 seeded buy-and-hold 10-player portfolios. Expectations use each
player's prior 10 played games; only the first game uses the salary-implied cold-start prior.
Trading and live Dunks & Threes calls are deliberately disabled.
