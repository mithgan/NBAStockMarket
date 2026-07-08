# NBA Talent Market

A persistent, skill-based **fantasy stock market for NBA players**, played with in-platform
(fake) cash. Users buy and sell shares of players; prices move with both **market demand** and
**real on-court performance**; holding good players pays **cash dividends** tied to real NBA
results. Everyone starts with $10,000 and competes on a leaderboard by net worth. It never
resets — it's a long game of being right about players before the crowd is.

No real money, no cash-out — which keeps it out of gambling/securities territory entirely.

## The core idea: two-force pricing

A player's price is a tug-of-war between two forces:

**Force A — Demand (short-term).** Every trade moves the price. Buys push it up, sells push it
down, scaled by the player's liquidity/depth `L` so thin names can't be cheaply manipulated:

```
P ← P × exp( k × shares / L )        # +shares = buy, −shares = sell, k ≈ 0.0003
```

**Force B — Performance gravity (long-term).** Each player has a **live fair value (FV)**
recomputed from real basketball stats (rolling WARP, minutes, age curve, recent form). Daily,
the price is pulled a small step toward it:

```
P ← P + λ × (FV − P)                 # λ ≈ 0.03/day
```

Short-term, the crowd leads. Long-term, reality wins. Being right about a player **before the
crowd pays twice**: once when demand catches up, again when the stats confirm it.

## Why this design

This market model is derived from a reverse-engineering of **CraftedNBA's live market** (see
[docs/craftednba-market-model.md](docs/craftednba-market-model.md)). Their price is **100%
demand-driven** — performance never touches the price, `fairValue` is frozen at the IPO price,
and untraded players just decay −0.5%/day. It's a popularity contest with a dividend coupon
stapled on.

Our build keeps what works (exponential impact, 1% fee, dividends, $10k equal start) and fixes
the flaws: a **live** fair value anchors every price to reality, mean reversion replaces the
decay hack, liquidity-scaled impact resists whale manipulation, and explicit sinks keep the
economy from inflating.

## Key mechanics at a glance

| Mechanic | Rule |
|---|---|
| Starting bankroll | $10,000 for everyone; score = cash + (shares × price) |
| Execution | Single price, no spread; 1% fee on every buy and sell |
| Anti-churn | Escalating flip penalty on same-player round-trips within 24h |
| Anti-cornering | Per-user ownership cap (~40% of a player's 100 shares) |
| Floor | `max(0.5 × FV, $25)` — tracks live value, nobody gets zeroed |
| IPOs | Model-seeded fair value + opening auction; 7-day grace period |
| Award dividends | Cash per share for real honors (MVP $15 … Player of Week $1) |
| Season dividend | `(WARP + 2.15) × minutes × 0.0005102` per share |
| Economy | Dividends are faucets; fees, flip penalties, idle-cash fee are sinks |

## Docs

| Doc | What it is |
|---|---|
| [docs/nba-talent-market-plan.md](docs/nba-talent-market-plan.md) | **The build spec.** Full project plan: pricing model, trading rules, IPOs, dividends, economy, schema, pseudocode, roadmap. Assumes zero prior context. |
| [docs/pricing-writeup.md](docs/pricing-writeup.md) | Short explainer of the two-force pricing model. |
| [docs/craftednba-market-model.md](docs/craftednba-market-model.md) | Reverse-engineered CraftedNBA market (their parameters, verified decay, dividend tables) + our recommended improvements. |
| [docs/PLAN.md](docs/PLAN.md) | Earlier concept-stage plan (positioning, competitive landscape, architecture sketch). Partially superseded by the build spec above. |
| [index.html](index.html) | Interactive concept explainer / mock — open in a browser. |

## Build order

From the spec (§12 of the build plan):

1. **Phase 0 — Engine prototype**: pure Python + SQLite. Trade execution, daily FV pass,
   dividends, and a synthetic-season simulation proving the economy is stable.
2. **Phase 1 — API + persistence** (FastAPI/Express): players, trades, portfolio, leaderboard.
3. **Phase 2 — Stats pipeline**: nightly real-NBA stats pull → FV inputs → daily reversion pass.
4. **Phase 3 — Frontend**: player board, charts, trade modal, portfolio P&L, leaderboard.
5. **Phase 4 — Dividends & seasons**: award ingestion + season-end WARP dividend run.
6. **Phase 5 — Integrity**: wash-trade detection, dividend anti-sniping, sinks.
7. **Phase 6 (stretch) — Shorting**: makes the market fully two-sided.

Data sourcing: nightly batch from public NBA stats (the installed `espn-pp-cli` covers scores,
box scores, injuries, and news; advanced metrics need a separate source).
