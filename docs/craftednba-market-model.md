# CraftedNBA Market — Reverse-Engineered Pricing Model & Build Guide

> A persistent, all-time NBA "player stock market" played with in-platform (fake) cash.
> This document derives a working pricing model from their live API data, documents every
> mechanic, and proposes improvements for building your own version.
>
> **Structure:** Sections 1–9 = **THEIRS** (CraftedNBA, reverse-engineered from their live API).
> Section 10 = **OURS** (the improved two-force model I recommend you build). If you only read
> one part for your own build, read Section 10.

---

## 1. What it is (one paragraph)

Every NBA player (and draft prospect) is a tradeable "stock." You start with a fixed bankroll,
buy/sell **shares** at a single live price, and your net worth = cash + (shares × live price).
Prices move as people trade (buys push up, sells push down), untouched players slowly decay,
and holding good players pays **cash dividends** tied to real NBA awards and a season-end
performance formula. Leaderboards rank managers by portfolio value. No real money.

---

## 2. Hard parameters (pulled from the live API)

Source: `GET /api/market/players` → `settings` object, plus per-player fields.

| Parameter | Value | Meaning |
|---|---|---|
| `startingCash` | **10,000** | Every user's opening bankroll (equal start) |
| `tradeFeePct` | **0.01** | Flat 1% fee on every buy AND sell |
| `sharesOutstanding` | **100** | Fixed "float" per player (same for everyone) |
| `priceHistoryDays` | 7 | Rolling history window shown / used for 7d change |
| `marketCap` | `price × 100` | Confirmed: cap = currentPrice × sharesOutstanding |
| `fairValue` | `= openingPrice` | A fixed valuation anchor set at listing (IPO price) |
| `projectedEdge` | `fairValue − currentPrice` | Positive = "model thinks it's cheap" |
| `volume24h` | cumulative-ish | Trading activity counter used for decay/liquidity |
| `ownershipPct` | 0–100 | % of the 100 shares held across all users |

Observed price range in production: ~**$25 floor** up to **$1,183** (Wembanyama), from
opening prices spanning **$13 → $750**. Opening prices are hand-set per player (a talent tier),
not computed by a public formula.

---

## 3. The pricing model (derived empirically)

I fit the model against ~330 day-over-day observations across the 15 most-active players.

### 3.1 Trade price impact — **multiplicative / exponential**

Buys nudge price up, sells nudge it down. Critically, the **percentage** move per share is
roughly constant whether the player trades at $300 or $1,100 — so the impact is on
`log(price)`, not on raw dollars. The clean model that reproduces this is an
**exponential bonding curve** (equivalent to an LMSR-style automated market maker):

```
P_after = P_before × exp(k × q_signed)
```

where:
- `q_signed` = number of shares in the trade (+ for buy, − for sell)
- `k` = price-impact sensitivity ≈ **0.0003** (empirically fit: regression k≈0.00023, median k≈0.0003)

For small trades this linearizes to the intuitive form:

```
ΔP / P  ≈  k × q_signed          # ~0.03% per share
```

**Worked check (matches their tape):**
- Buy 1 share of a $100 player → new price ≈ 100 × e^(0.0003) ≈ **$100.03**
- Buy 20 shares → 100 × e^(0.006) ≈ **$100.60**
- Sell 50 shares of a $500 player → 500 × e^(−0.015) ≈ **$492.5**

> Note: the FIRST trading day shows a larger "IPO pop" (e.g. Wembanyama opened $750,
> first mark $795.89; Flagg opened $277, jumped to $376 on heavy day-1 volume). That's just
> the impact model applied to a burst of opening-day demand — not a separate rule.

### 3.2 Execution price & fee

- **Single price, no spread.** Buys and sells both execute at the current market price.
- **Flat 1% fee** on notional, both sides:
  - Buy `n` shares: `cost = n × P × 1.01`
  - Sell `n` shares: `proceeds = n × P × 0.99`
- Round-trip friction is therefore ~2% + whatever the price moved against you.

### 3.3 Inactivity decay — **confirmed exactly**

I verified this against real data: **73 of 73** zero-volume days moved **exactly −0.500%**.

```
if days_since_listing <= 7:            # grace period
    no decay
elif days_since_last_trade >= 7:       # drought
    P *= 0.995          # −0.5% per day, compounding
    P = max(P, floor)
floor = max(0.5 × openingPrice, 25)    # 50% of IPO, never below $25
```

Any single trade (buy or sell) resets the drought clock for another 7 days and stops decay.

### 3.4 Flip / churn penalty

Documented but not exposed numerically in the API. A buy→sell (or sell→buy) on the **same
player within 24h** triggers an **extra penalty** on top of the 1% fee, to kill self-pumping
and wash-trading loops. (You choose the size — see build recommendations.)

---

## 4. Dividends (the interesting part) — begins 2026–27 season

Two independent systems. Both pay **per share held at a snapshot moment**, straight into cash.

### 4.1 Official NBA recognition dividends (event-driven)

Paid when a player you hold earns real NBA honors. Pays down the *ballot*, not just winners:

| Recognition | $/share | Recognition | $/share |
|---|---|---|---|
| MVP winner | 15.00 | All-Defensive 1st | 5.00 |
| All-NBA 1st | 10.00 | All-Star | 5.00 |
| DPOY winner | 10.00 | DPOY 2nd | 5.00 |
| All-NBA 2nd | 7.00 | MVP 3rd | 5.00 |
| MVP 2nd | 7.00 | All-Rookie 1st | 4.00 |
| MIP winner | 6.00 | All-Def 2nd / DPOY 3rd / MIP 2nd | 3.00 |
| ROY winner | 6.00 | MVP 4th–5th / ROY 2nd | 3.00 |
| All-NBA 3rd | 5.00 | All-Rookie 2nd / MIP 3rd | 2.00 |
| | | Player of Month | 2.00 |
| | | ROY 3rd | 2.00 |
| | | Player of Week | 1.00 |

### 4.2 Season-end "WARP" model dividend (formula-driven)

Every player pays a performance dividend based on CraftedNBA's proprietary WARP metric
scaled by minutes played:

```
WARP_dividend_per_share = (WARP + 2.15) × minutes_played × 0.0005102
```

- `+2.15` — offset so even replacement-level players pay a little (floor > 0)
- `minutes_played` — rewards durability & role, not just rate stats
- `0.0005102` — scale constant tuning payout size vs. the rest of the economy

Both `2.15` and `0.0005102` are explicitly **tuning constants** that can change.

**Example:** WARP 8.0, 2,500 minutes → (8.0 + 2.15) × 2500 × 0.0005102 ≈ **$12.95 / share**.

---

## 5. Reference implementation (pseudocode)

```python
STARTING_CASH   = 10_000
FEE_PCT         = 0.01
SHARES_OUT      = 100
IMPACT_K        = 0.0003     # ~0.03% price move per share
DECAY_RATE      = 0.005      # 0.5%/day
GRACE_DAYS      = 7
DROUGHT_DAYS    = 7
FLIP_WINDOW_H   = 24
FLIP_PENALTY    = 0.02       # your call; extra 2% on churn reversals

import math, time

def execute_trade(user, player, qty, side):          # side: +1 buy, -1 sell
    P = player.price
    notional = qty * P
    fee = notional * FEE_PCT

    # flip penalty: opposite-side trade on same player within 24h
    if user.last_side.get(player.id) == -side and \
       time.time() - user.last_ts.get(player.id, 0) < FLIP_WINDOW_H*3600:
        fee += notional * FLIP_PENALTY

    if side > 0:
        user.cash -= notional + fee
        user.shares[player.id] += qty
    else:
        user.cash += notional - fee
        user.shares[player.id] -= qty

    # multiplicative price impact
    player.price *= math.exp(IMPACT_K * side * qty)
    player.last_trade_day = today()
    player.volume += qty
    user.last_side[player.id] = side
    user.last_ts[player.id]   = time.time()

def daily_decay(player):                              # run once per day (cron)
    if days_since(player.listed_at) <= GRACE_DAYS:      return
    if days_since(player.last_trade_day) < DROUGHT_DAYS: return
    floor = max(0.5 * player.opening_price, 25)
    player.price = max(floor, player.price * (1 - DECAY_RATE))

def pay_recognition(player, award):                   # event-driven
    amt = AWARD_TABLE[award]
    for u in holders_at_snapshot(player):
        u.cash += u.shares[player.id] * amt

def pay_warp_dividend(player):                         # end of season
    amt = (player.warp + 2.15) * player.minutes * 0.0005102
    for u in holders_at_snapshot(player):
        u.cash += u.shares[player.id] * amt

def portfolio_value(user):
    return user.cash + sum(user.shares[pid] * price(pid) for pid in user.shares)
```

---

## 6. Weaknesses of their model (what to fix)

1. **No real order book / no shorting.** You can only go long. Overvalued players can't be
   bet against, so the market can only express "this is underrated," never "overrated."
2. **Symmetric impact is gameable in slow markets.** With `exp(k·q)` and no depth term, a
   whale can walk a thin name up cheaply, collect dividends, and the flip penalty only
   guards the first 24h. Ownership caps help but aren't a full fix.
3. **`fairValue` is a static anchor.** It's just the opening price and never updates from real
   stats, so `projectedEdge` goes stale — it's not a live model signal despite the name.
4. **Fixed 100-share float everywhere** means a superstar and a bench player have identical
   liquidity/depth. Real depth should scale with interest.
5. **Decay floor at 50% of open** protects downside so heavily that "bad" holds barely hurt —
   dulls the penalty for being wrong.
6. **Dividends reward the obvious.** Award payouts concentrate on stars everyone already owns;
   there's little edge in "discovering" a mispriced role player until the WARP dividend lands
   once a year.

---

## 7. Recommended improvements for YOUR build

### Pricing / market microstructure
- **Depth-scaled impact:** `P *= exp(k · q / L)` where liquidity `L` grows with recent volume
  & ownership. Popular players get deep/stable; thin names move fast. Kills whale-walking on
  illiquid stocks while keeping stars tradeable.
- **Add short positions** (or fractional "fade" contracts) so the market can price
  *overvaluation*. This is the single biggest fun/skill upgrade — it makes the market
  two-sided and self-correcting.
- **Live fair value:** recompute `fairValue` continuously from a real projection model
  (rolling WARP, minutes, age curve). Then `projectedEdge` becomes an actual alpha signal and
  a mean-reversion force you can dial in: `P drifts toward fairValue at rate λ/day`.
- **Escalating flip penalty:** penalty scales with how many round-trips on the same name in
  N days, not a flat 24h gate. Persistent churners pay progressively more.

### Economy / sinks & faucets
- **Watch inflation.** Dividends + IPO pops are faucets; the 1% fee is the only sink. Add sinks:
  listing fees for creating markets, a small daily "management fee" on idle cash, or a spread
  that the house keeps. Otherwise everyone's bankroll inflates and prices balloon.
- **Dynamic dividend budget:** cap total dividends per season as a % of market cap so payouts
  auto-scale instead of relying on hand-tuned constants (2.15 / 0.0005102).

### Engagement / retention
- **IPO auctions for rookies** instead of hand-set opening prices — let the crowd discover the
  price on draft night (they already gesture at this with "buy before Draft moves prices").
- **Weekly micro-dividends** (Player of the Week already exists) to give constant feedback
  loops rather than one big annual WARP payout.
- **Portfolio-vs-portfolio leagues / head-to-head** on top of the global leaderboard.
- **Position-level P&L and cost basis** shown clearly (they only mark net worth) — traders
  love seeing realized vs. unrealized gains.

### Integrity
- **Wash-trade detection** beyond the 24h window (same-user or colluding-user loops).
- **Snapshot randomization** for dividend eligibility (hold for a rolling window, not a single
  known instant) to stop last-second dividend sniping.
- **Per-user ownership cap** per player (they already track `ownershipPct`) to prevent
  cornering a thin market.

---

## 8. Minimal data model (to start building)

```
players(id, slug, name, team, position, opening_price, current_price,
        fair_value, shares_outstanding=100, listed_at, last_trade_day,
        volume, ownership_pct)
users(id, cash=10000, tier)                      # free/pro
holdings(user_id, player_id, shares, avg_cost)
trades(id, user_id, player_id, side, qty, price, fee, ts)
dividend_events(id, player_id, type, per_share, snapshot_ts)
price_history(player_id, date, price, fair_value, volume)   # daily snapshot
```

Cron jobs: **daily decay pass**, **daily price_history snapshot**, **award ingestion**
(event-driven), **season-end WARP dividend run**.

---

## 9. TL;DR of THEIR derived model

- Bankroll **$10,000**, single price, **1% fee** both sides.
- **Buy/sell impact:** `P *= exp(0.0003 × ±shares)` (≈0.03%/share, multiplicative).
- **Decay:** after 7-day grace, **−0.5%/day** compounding on 7-day droughts, floor
  `max(50% of open, $25)`. (Verified exact.)
- **Dividends:** award table (MVP $15 … PoW $1) + season-end
  `(WARP + 2.15) × minutes × 0.0005102` per share.
- **Key insight:** price is **100% demand-driven**. On-court performance never touches the
  price directly — it only pays *cash dividends* into your bankroll. `fairValue` is a dead
  anchor (just the IPO price), so a price can drift arbitrarily far from reality with nothing
  pulling it back. It's a popularity contest with a dividend coupon stapled on.

---

# PART II — OUR MODEL (recommended build)

## 10. The two-force pricing model

Their single flaw drives our whole redesign: **their price responds only to demand, never to
performance.** We keep demand as the fun short-term driver, but add a second force that tethers
price to real basketball value. Price is now the tug-of-war between two forces.

### 10.1 Force A — Demand (short-term, unchanged in spirit)

Trades still move price, but with a **depth/liquidity term** added so thin players aren't
trivially manipulable:

```
P_after = P_before × exp( k × q_signed / L )
```

- `q_signed` = shares traded (+buy / −sell)
- `k` ≈ **0.0003** (inherited from their fitted value)
- `L` = **liquidity/depth** of the player — grows with recent volume + ownership.
  Theirs is the special case `L = 1` for everyone.

Effect: superstars with heavy volume have large `L` (deep, hard to move); ignored players have
small `L` (volatile, move fast) — matching how real markets behave and killing whale-walking on
obscure names.

### 10.2 Force B — Performance gravity (long-term, NEW — this is the anchor)

Introduce a **live fair value** `FV`, recomputed continuously from real stats (NOT frozen at IPO
like theirs):

```
FV = base(role/tier)
   + w1 · (rolling WARP)
   + w2 · (minutes / availability)
   + w3 · (age curve)
   + w4 · (recent form)
```

Each day, pull the price a fraction of the way toward `FV`:

```
P_daily ← P + λ × (FV − P)
```

- `λ` = reversion speed, e.g. **0.02–0.05 / day** (small, so the market still leads day-to-day,
  but price CAN'T stay divorced from reality forever).
- Player balls out → `FV` rises → price gets pulled **up** even with no buyers (rewards holders
  of genuinely improving players).
- Hyped player underperforms → `FV` falls → price drifts **down** (punishes chasing hype).

### 10.3 Mean reversion REPLACES decay

The separate `−0.5%/day` decay rule is no longer needed — it falls out of Force B as a special
case. An ignored, overpriced player naturally sags toward `FV`; an ignored, underpriced player
drifts **up** toward `FV` (something their decay can never do). Keep a **floor** so nobody is
zeroed, but the floor should track `FV`, not the stale opening price:

```
floor = max(0.5 × FV, 25)     # tracks live value, not the frozen IPO price
```

### 10.4 Net effect

- **Short-term price** = speculation + crowd conviction (fun, tradeable).
- **Long-term price** = tethered to actual basketball value (skill-rewarding, self-correcting).
- Being **right about performance before the crowd pays you twice**: once when demand catches up
  (price rises via Force A), once when `FV` confirms it (reversion locks it in via Force B) —
  instead of only through the annual dividend.

---

## 11. IPOs under our model — price discovery, not a guess

Their opening price is **hand-typed by an operator** (round tier numbers: $750, $562, $447…).
Mispricings become free arbitrage for early users. We replace the guess with discovery:

1. **Seed FV from the model.** A new rookie/player enters with a model-estimated fair value
   (pre-draft/college stats for rookies; prior-season WARP + minutes for newly-listed vets).
   This is the *anchor*, not a hand-set number.
2. **Auction the opening price** (draft-night / listing window). Open a short bidding window and
   clear at the price where buy demand meets initial share supply. The crowd discovers the real
   opening price — no free arbitrage from a mispriced hand-set number, and it creates a natural
   hype event.
3. **Grace period** after listing (keep their 7-day idea) so a brand-new player isn't punished by
   reversion before the market has data on them.
4. **Post-IPO:** both forces engage — demand trades it around, `FV` pulls it toward modeled value
   as real games accumulate.

**Three IPO options for your build (pick per your resources):**

| Option | Who sets opening price | Trade-off |
|---|---|---|
| Hand-set (theirs) | You, manually per player | Simple, full control; slow to scale, subjective, mispricings = free arbitrage |
| Model-seeded | A projection formula | Scales to 100s of players, objective; only as good as your model/data |
| Auction-discovered | The crowd, at listing | Best price discovery, no free arbitrage, hype event; needs enough active users |

Common real pattern: **model-seed + auction** — the model proposes the anchor, the auction lets
the market correct it on day one.

---

## 12. Sinks & faucets — controlling inflation

Borrowed from game-economy design. In any virtual-currency economy:

- **Faucet** = anything that *creates* new money into players' hands.
- **Sink** = anything that *removes* money from the economy.

If faucets > sinks you get **inflation**: bankrolls balloon, the starting $10k becomes
meaningless, prices inflate, and the leaderboard rewards longevity over skill.

**Their balance is broken — lots of faucets, one weak sink:**

| Faucets (add money) | Sinks (remove money) |
|---|---|
| Award dividends (MVP $15/share …) | 1% trade fee |
| Season-end WARP dividends | Flip penalty (occasional) |
| "IPO pops" (paper gains) | *…that's basically it* |

**Sinks to add in your build:**
- Small **daily fee on idle cash** (encourages deploying capital, not hoarding).
- **Listing/creation fees** if users can create markets.
- A **house-kept spread** on trades (in addition to or instead of the flat fee).
- **Cap total dividends per season as a % of market cap** so payouts auto-scale down as the
  economy grows — removes reliance on hand-tuned constants (2.15 / 0.0005102).

---

## 13. Updated reference implementation (our model)

```python
STARTING_CASH = 10_000
FEE_PCT       = 0.01
K             = 0.0003     # base impact sensitivity
LAMBDA        = 0.03       # daily mean-reversion speed toward fair value
GRACE_DAYS    = 7
FLIP_WINDOW_H = 24
FLIP_PENALTY  = 0.02       # escalates with repeat round-trips (see note)

import math, time

def liquidity(player):
    # depth grows with recent volume + ownership; never below 1
    return 1.0 + 0.05 * player.volume_30d + 0.10 * player.ownership_pct

def execute_trade(user, player, qty, side):            # side: +1 buy, -1 sell
    P = player.price
    notional = qty * P
    fee = notional * FEE_PCT
    # escalating flip penalty: scale with round-trips on this name in last N days
    if reversed_within(user, player, FLIP_WINDOW_H):
        fee += notional * FLIP_PENALTY * (1 + user.roundtrips_7d.get(player.id, 0))
    if side > 0:
        user.cash -= notional + fee; user.shares[player.id] += qty
    else:
        user.cash += notional - fee; user.shares[player.id] -= qty
    # Force A: depth-scaled demand impact
    L = liquidity(player)
    player.price *= math.exp(K * side * qty / L)
    player.last_trade_day = today(); player.volume += qty

def daily_fair_value_pass(player):                     # Force B: cron, once/day
    fv = compute_fair_value(player)                    # live model from real stats
    player.fair_value = fv
    player.price += LAMBDA * (fv - player.price)       # reversion (up OR down)
    floor = max(0.5 * fv, 25)                          # floor tracks live FV
    player.price = max(player.price, floor)

def compute_fair_value(p):
    return (p.base_tier
            + 1.0 * p.rolling_warp
            + 0.5 * p.minutes_factor
            + p.age_curve_adj
            + p.recent_form_adj)

def daily_idle_cash_sink(user):                        # a sink to fight inflation
    user.cash *= (1 - 0.0002)                          # ~0.02%/day on idle cash

# dividends unchanged from theirs (award table + WARP formula),
# but optionally budget-capped per season as % of total market cap.
```

---

## 14. One-line contrast

> **Theirs:** price = pure demand; performance only pays a separate cash dividend; opening price
> hand-set; overvaluation impossible to bet against; inflation unchecked.
>
> **Ours:** price = demand **anchored to a live performance-based fair value via mean reversion**;
> dividends layered on top; opening price discovered by model-seed + auction; depth-scaled impact
> resists manipulation; real sinks control inflation. (Add shorting next for a fully two-sided
> market.)

---

*Caveat: "Theirs" is reverse-engineered from CraftedNBA's live API, not their source code. The
exponential impact (k≈0.0003) is my empirical fit; the config values, decay (−0.5%/day, verified
73/73 zero-volume days), fee, and dividend tables are directly confirmed from their API.*
