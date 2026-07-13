# NBA Stock Exchange — Detailed Plan (v3)

A free-to-play fantasy **stock market** for the NBA. Users start with virtual capital and build a
portfolio of players, draft picks, prospects, teams and award futures. They win by **identifying value
before the market does** — not by predicting box scores.

> **Status:** concept stage. This document is the working plan; `index.html` is the interactive explainer/mock.

## Economy v2 (current engine; overrides legacy economy notes below)

The planning call moved the playable economy to NBA salary scale. Every user starts with
**$140,000,000** in virtual cash, player shares resemble salaries (stars ~$40–70M, rotation
players ~$15–30M, bench players ~$2–12M). One share is the whole player at his listed salary;
the float remains 100 shares, multiple users may own the player, and each user may hold at most
one share per player. The 0.25% trading fee, capped escalating flip penalty, small idle-cash sink, seven-day
listing grace period, inactivity decay, and a rescaled minimum price floor remain.

Price is set by supply and demand plus inactivity decay. Fair-value reversion is retained as a
configurable research knob but defaults to **0/off**. The performance signal instead settles
after each game as a cash dividend (or debit) to holders:

```
dividend_per_share = (actual_net_points - expected_net_points)
                   * NET_POINTS_TO_DOLLARS / 100
NET_POINTS_TO_DOLLARS = $4,000,000
```

Thus exact expectation pays $0 and a +20 surprise pays one holder about $800,000 ($40,000 per
net point per share). This constant is **PROVISIONAL pending Mith's NBA-12 calibration**.

The net-points model uses documented, swappable linear box-score weights. Expected net points
or an expected box score comes from an injected expectation-source interface. Cached Dunks &
Threes pregame projections are the canonical default; trailing, salary projection, and raw
production remain experimental comparison modes, and the engine makes no network call. Award and season-end
WARP dividends remain optional/dormant and are not part of the daily v1 economy.

---

## 1. Core design decisions (locked)

These are settled and everything else hangs off them.

| Decision | Choice | Why |
|---|---|---|
| Money | **Virtual only, no cash-out, no purchase-to-play** | Keeps it out of the securities/gambling gray area. This killed every real-money predecessor. |
| Unit of trade | **Shares** (not "lines" / yes-no contracts) | User explicitly wants a stock-market feel, not a prediction market (Kalshi/Polymarket). |
| Liquidity | **Market maker / AMM** (no peer-to-peer order book) | Solves cold-start liquidity; nobody needs to be online to trade against you. |
| Price driver | **Demand force + model gravity** (two numbers) | Demand makes it a real market; gravity gives it an anchor so it can't become a memecoin. |
| What "value" means | **Forward-looking projection**, recent perf weighted by uncertainty | This is the line between "investing" and "rebuilt DraftKings". |
| Differentiator | **Reputation / public track record** | A no-money game's reward is *being known for being right early.* |

### The two-number model (the heart of the product)
- **Intrinsic value (IV):** model-derived, forward-looking estimate of a player's future basketball value.
  *Not* the price. Acts as gravity.
- **Market price (MK):** what users actually pay; moves on supply & demand via the market maker.
- **The gap (IV − MK) is the edge.** Users profit two ways:
  1. **Mispricing alpha (trading):** crowd underrates a player, you buy, crowd corrects, price rises to IV.
  2. **Fundamental alpha (investing):** you buy before IV itself rises (young player improves), price follows.

### Why it's investing, not fantasy
Fantasy pays for **production** (raw box score). This pays for **beating expectations** (the surprise vs.
what was already priced in). Owning a fully-priced superstar earns nothing; owning the player the market is
*wrong* about is the whole game.

---

## 2. The pricing engine (build target #1)

```
new_price = old_price
          + demand_force      // (net_buys − net_sells) * liquidity_depth
          + gravity_force     // (intrinsic_value − price) * reversion_rate

intrinsic_value = slow_factors(age_curve, contract, pedigree, role_security)
                + fast_factors(recent_perf, advanced_stat_trends, news, injury) * uncertainty_weight
```

**Tuning knobs (the product *is* these knobs):**
- `liquidity_depth` — how much a unit of demand moves price. Too low = chaos; too high = unmovable.
- `reversion_rate` — how hard gravity pulls price to IV. Too high = it's just an index fund (feels rigged);
  too low = bubbles & manipulation. **This ratio defines the whole feel of the game.**
- `uncertainty_weight` — makes a rookie's 35-pt game swing IV hard and a 34-yr-old's barely move. This is the
  anti-DFS mechanism.

**Inputs needed:** per-player advanced metrics (DARKO / LEBRON / EPM / BPM where licensed), age, contract,
role, recent game logs, injury/news feed. Draft picks: projected position, team outlook, protections, class
strength. Prospects: scouting/development signal.

**First validation question to answer before building UI:** can we compute a defensible IV and a stable MK
for ~50 real players + 10 picks from public data, and does the gap behave sensibly when we replay a real
month? If yes, the concept holds. If the prices look random or rigged, nothing on top matters.

---

## 3. Game structure

- **Challenge windows:** Monthly (primary retention loop), Season, Lifetime. Each has its own leaderboard.
  - *Monthly* rewards **trading** — catching mispricings & news fast.
  - *Season / Lifetime* rewards **investing** — being right about trajectories, picks, prospects over time.
- **Starting capital:** $10,000 virtual per challenge; lifetime reputation persists across resets.
- **Anti-gaming controls:** max 20% in one asset, diversification minimums, position-size limits, trade
  cooldowns, small transaction fees, wash-trade/collusion detection for leaderboard integrity.
- **Reputation layer (the real product):** every realized gain/loss writes to a **public, timestamped track
  record** — hit rate, best early calls, calibration. Investor Archetypes (Growth, Prospect Whisperer, Quant,
  Diamond Hands) are *earned* from real behavior. Specialist leaderboards (best at picks / rookies / futures).
- **Shareable result cards:** portfolio return, rank, best call, investor style — built for social distribution.

---

## 4. Asset classes (MVP order)

1. **Draft prospects & picks** — *MVP wedge.* Most fun to speculate on, longest alpha, **least rights-encumbered**,
   cleanest to value (and they "settle" naturally on draft night).
2. **Players** — the core, but most licensing-sensitive; add once rights path is clear.
3. **Teams** — win totals / seeding / title trajectory.
4. **Award futures** — MVP / ROY / DPOY as long-horizon holdings.

---

## 5. Architecture (proposed)

```
┌─ Web client (React/Next) ──────────────┐
│  market browser · player/asset pages    │
│  portfolio · trade ticket · leaderboards │
│  reputation profile · shareable cards    │
└───────────────┬─────────────────────────┘
                │ REST/WS
┌───────────────▼─────────────────────────┐
│  API / game server (Node or Python)      │
│  • trade engine (buy/sell, fees, limits) │
│  • market maker (price = demand+gravity) │
│  • portfolio & ledger (virtual cash)     │
│  • leaderboards / reputation             │
└───────────────┬─────────────────────────┘
                │
┌───────────────▼─────────────────────────┐
│  Valuation service (scheduled job)        │
│  • computes intrinsic value per asset     │
│  • ingests stats / news / injury feeds    │
└───────────────┬─────────────────────────┘
                │
        ┌───────▼────────┐   ┌────────────────┐
        │  Postgres       │   │ Data providers  │
        │  users, assets, │   │ (stats, odds,   │
        │  prices, trades │   │ news) — TBD     │
        └─────────────────┘   └────────────────┘
```

- **Prices:** valuation service writes IV on a schedule (e.g. nightly + on news); market maker updates MK on
  every trade and applies gravity on a tick. Store full price history per asset for charts.
- **Ledger:** double-entry virtual cash + share positions; immutable trade log (needed for track record & anti-fraud).
- **Data sourcing is the first external dependency to resolve** — see open questions.

---

## 6. Roadmap

| Phase | Goal | Deliverable |
|---|---|---|
| **0 — Concept** ✅ | Pitch + mock | `index.html` explainer, this plan |
| **1 — Pricing prototype** | Prove the engine | Offline sim: IV + MK for ~50 players/picks, replay a real month, sanity-check the gap |
| **2 — Playable MVP** | One loop end-to-end | Prospects/picks only · trade engine · portfolio · 1 leaderboard · fake $10k |
| **3 — Reputation + social** | Retention | Public track record, archetypes, shareable cards |
| **4 — Expand assets** | Depth | Players (post-licensing), teams, award futures |
| **5 — Licensing & scale** | Legitimacy | NBPA/data licenses, anti-fraud hardening, monetization (cosmetics/premium analytics/season passes) |

---

## 7. Risks & open questions

- **Data rights & licensing** — biggest external risk. Which stats can we use freely? Player name/likeness
  via NBPA? Resolve *before* building player assets. (Mitigation: prospect-first wedge.)
- **Pricing credibility** — if prices feel rigged or random, trust dies. The `reversion_rate` tuning is make-or-break.
- **Retention with no money** — reputation has to genuinely matter; cards/leaderboards must be first-class, not bolted on.
- **Competition** — PredictionStrike (live virtual athlete-stock app), Sport.Fun (onchain), Polymarket/Kalshi
  (real-money prediction markets). Our wedge = *fan-friendly, free, reputation-driven, draft-first*, not a trading terminal.
- **Open:** exact data providers? Build stack (Node vs Python for valuation)? How synthetic/seeded prices are
  generated for a brand-new asset with no trade history?

---

## 8. Immediate next step

**Phase 1 — build the offline pricing prototype.** Pick ~50 players + 10 draft picks, source the inputs,
implement `intrinsic_value` and the `demand + gravity` market maker, and replay a recent month to see whether
the IV/MK gap produces sensible, fair-feeling opportunities. That single experiment de-risks the entire concept.
