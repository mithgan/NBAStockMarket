# NBA Talent Market — Project Plan & Build Spec

> A persistent, skill-based **fantasy stock market for NBA players**, played with in-platform
> (fake) cash. Users buy and sell "shares" of players; prices move with both **market demand**
> and **real on-court performance**; holding good players pays **cash dividends**. Everyone
> starts equal and competes on a leaderboard by portfolio value.
>
> This document assumes **zero prior context**. Read top to bottom and you can build it.

---

## 0. The one-paragraph pitch

Imagine a stock market where the "stocks" are NBA players. You start with a fixed amount of
fake money. You buy shares of players you think are undervalued and sell players you think are
overvalued. A player's price goes **up** when people buy and **down** when people sell — but
also drifts toward a **"fair value"** calculated from that player's real basketball performance.
On top of price gains, holding a player pays you **cash dividends** when they hit real
milestones (win MVP, make All-Star, play well over a season). Your score is your total net
worth (cash + value of your holdings), ranked against everyone else. It never resets — it's a
long game of being right about players before the crowd is.

---

## 1. Core concepts & vocabulary

| Term | Meaning |
|---|---|
| **Share** | One unit of ownership in a player. Each player has a fixed number of shares. |
| **Price** | The current market value of one share of a player. |
| **Bankroll / cash** | The fake money a user has available to trade with. |
| **Holding / position** | How many shares of a given player a user owns. |
| **Portfolio value (net worth)** | `cash + Σ(shares_held × current_price)` across all holdings. This is your score. |
| **Fair value (FV)** | A model-calculated "true" price for a player based on real stats. Acts as gravity on the price. |
| **Liquidity / depth (L)** | How hard a player's price is to move. Popular players are "deep" (hard to move); ignored players are "thin" (move fast). |
| **Dividend** | A cash payout to shareholders, triggered by real NBA results. |
| **IPO** | Listing a new player onto the market for the first time and setting their starting price. |
| **Faucet** | Anything that creates new money in the economy (dividends). |
| **Sink** | Anything that removes money from the economy (fees). |

---

## 2. Design goals (why the rules are the way they are)

1. **Reward judgment, not luck or longevity.** Everyone starts with the same bankroll; the
   market never wipes. Long-term winners are people who are repeatedly right about player value.
2. **Price must reflect reality, not just hype.** A player who balls out should get more
   valuable even if no one is trading them. This is the single most important design decision
   and what makes it a *skill* game rather than a popularity contest.
3. **Resist manipulation.** No single user should be able to cheaply pump a player's price and
   cash out. Friction (fees), depth (liquidity), and anti-churn penalties handle this.
4. **Keep the economy stable.** Money entering (dividends) must be balanced by money leaving
   (fees/sinks), or the currency inflates and scores become meaningless.
5. **Simple to start, deep to master.** A new user should understand "buy low, sell high" in
   30 seconds, but there should be real edge in performance modeling and timing.

---

## 3. The pricing model — TWO FORCES

A player's price is the result of a tug-of-war between two forces. This is the heart of the
whole system.

### Force A — Demand (short-term, human-driven)

Every trade moves the price: **buys push it up, sells push it down.** The price *is* the running
result of net buying vs. selling — there's no central authority declaring the price.

The move is **multiplicative** (a percentage, not a fixed dollar amount), so a $100 player and a
$1,000 player move by the same *percentage* for the same-size trade. We scale the move by the
player's liquidity so thin players aren't trivially manipulable:

```
P_after = P_before × exp( k × q_signed / L )
```

- `q_signed` = number of shares traded (**positive** for a buy, **negative** for a sell)
- `k` = base impact sensitivity — NBA-9's synthetic trader sweep selected **0.003** as the
  provisional interactive-prototype setting; re-calibrate from observed order flow before production
- `L` = liquidity/depth of the player — grows with recent trading volume and ownership.
  A brand-new, untraded player has `L ≈ 1`; a heavily-traded superstar has a large `L`.

**Worked examples (at L = 1):**
- Buy 1 share of a $68M player → `68M × e^(0.003×1)` ≈ **$68.20M**
- Buy 1 share of a $25M player → `25M × e^(0.003×1)` ≈ **$25.08M**
- Sell 1 share of a $25M player → `25M × e^(-0.003×1)` ≈ **$24.93M**

**Same $68M buy on a deep player (L = 5):** `68M × e^(0.003/5)` ≈ **$68.04M** — moves
5× less. Popularity buys stability.

> **Why exponential?** It guarantees the price can never go to zero or negative from trading,
> and it makes the percentage cost of moving the price constant regardless of the price level.
> This is mathematically equivalent to a standard automated-market-maker bonding curve.

**Suggested liquidity formula (tune later):**
```
L = 1 + a × volume_30d + b × ownership_pct        # e.g. a = 0.05, b = 0.10
```

### Force B — Performance gravity (long-term, the anchor)

Each player has a **live fair value (FV)** recomputed from real basketball stats. Once per day,
the price is pulled a fraction of the way toward FV:

```
P_daily ← P + λ × (FV − P)
```

- `λ` = reversion speed — start at **0.03/day** (small, so the market still leads day-to-day but
  the price cannot stay divorced from reality forever).

**What this does:**
- Player plays great → FV rises → price gets pulled **up**, even with zero buyers. Holders of
  genuinely improving players are rewarded automatically.
- Hyped player underperforms → FV falls → price drifts **down**. Chasing hype gets punished.
- If `P == FV`, nothing happens (equilibrium).

**Fair value formula (starting point — this is your "secret sauce," tune heavily):**
```
FV = base_tier
   + w1 × rolling_WARP          # all-in-one advanced stat (see §8)
   + w2 × minutes_factor        # availability / role size
   + w3 × age_curve_adj         # young = upside, old = decline
   + w4 × recent_form_adj       # hot/cold streak over last N games
```
`base_tier` is a floor for the player's role; the weights `w1..w4` are what you tune. Start
simple (WARP + minutes only) and add terms as you validate them.

### The two forces together

- **Short-term price** = crowd conviction and speculation (fun, tradeable, reactive to news).
- **Long-term price** = tethered to actual on-court value (skill-rewarding, self-correcting).
- Being **right about a player before the crowd pays you twice**: once when demand catches up
  (Force A pushes price up), and again when FV confirms it (Force B locks it in).

---

## 4. Trading rules

### Execution
- **Single price, no spread.** Buys and sells both execute at the current market price.
- Then the price moves per Force A (above).

### Fees (the primary economic sink)
A flat **0.25% fee** on the notional value of every trade, both buy and sell:
```
Buy  n shares:  cost      = n × P × 1.0025
Sell n shares:  proceeds  = n × P × 0.9975
```
Base round-trip friction ≈ 0.5% plus whatever the price moved against you.

### Anti-churn: escalating flip penalty
A buy-then-sell (or sell-then-buy) on the **same player within 24 hours** adds an **extra
penalty** on top of the 0.25% fee. It escalates with repeated round-trips but caps at 1.5%
so persistent churners/self-pumpers pay more without unbounded wealth destruction:
```
extra_rate = min(0.005 × (1 + roundtrips_last_7d), 0.015)
extra_fee = notional × extra_rate
```

### Ownership cap
Cap any single user at, say, **40% of a player's shares** to prevent one whale from cornering a
thin market. (Track ownership % per player.)

---

## 5. Listing new players (IPOs)

An **IPO** is putting a new player on the market for the first time. Don't hand-type a price and
hope it's right — that just hands early users free money on mispriced listings. Use **price
discovery**:

1. **Seed the fair value from the model.** New rookie → project from pre-draft/college stats.
   Newly-listed veteran → use prior-season WARP + minutes. This FV is the anchor.
2. **Auction the opening price** during a short listing window (e.g. draft night). Collect bids;
   clear at the price where buy demand meets the initial share supply. The crowd discovers the
   real opening price — and it becomes a hype event.
3. **Grace period:** for the first **7 days** after listing, disable Force B / decay so a
   brand-new player isn't punished before the market has data.
4. **Post-IPO:** both forces engage normally.

**Pick the IPO style that fits your resources:**

| Option | Who sets opening price | Trade-off |
|---|---|---|
| Hand-set | You, manually | Simple, full control; slow to scale, subjective, mispricings = free arbitrage |
| Model-seeded | A projection formula | Scales to 100s of players, objective; only as good as your data |
| Auction-discovered | The crowd | Best price discovery, no free arbitrage, hype event; needs active users |

**Recommended:** model-seed + auction (model proposes anchor, auction corrects it on day one).
If you're launching solo with few users, start hand-set/model-seeded and add auctions later.

---

## 6. Dividends (cash rewards for real performance)

Dividends pay **cash into the holder's bankroll** (they do NOT change the price). Paid **per
share held at a snapshot moment**. Two systems:

### 6.1 Award dividends (event-driven)
When a player you hold earns real NBA recognition, every share pays out. Pays down the *ballot*,
not just winners, so owning consistently-good players matters. Starting table (tune amounts):

| Recognition | $/share | Recognition | $/share |
|---|---|---|---|
| MVP winner | 15 | All-NBA 3rd / All-Star / DPOY 2nd | 5 |
| All-NBA 1st / DPOY winner | 10 | All-Rookie 1st | 4 |
| All-NBA 2nd / MVP 2nd | 7 | All-Def 2nd / MIP 2nd / ROY 2nd | 3 |
| MIP winner / ROY winner | 6 | All-Rookie 2nd / Player of Month | 2 |
| All-Defensive 1st | 5 | Player of Week | 1 |

### 6.2 Season-end performance dividend (formula-driven)
At season end, every player pays a dividend scaled by their advanced-stat value and how much
they actually played:
```
season_dividend_per_share = (WARP + OFFSET) × minutes_played × SCALE
```
Starting constants: `OFFSET = 2.15` (so even replacement-level players pay a little),
`SCALE = 0.0005102`. **Example:** WARP 8.0 over 2,500 minutes → `(8.0 + 2.15) × 2500 × 0.0005102`
≈ **$12.95/share**. Treat OFFSET and SCALE as tuning knobs, not sacred.

### Anti-sniping
Base dividend eligibility on holding across a **rolling window** (not a single known instant) so
users can't buy shares seconds before a known payout and dump them after.

---

## 7. Economy management — sinks & faucets

Money flows in (**faucets**) and out (**sinks**). If faucets > sinks the currency inflates:
bankrolls balloon, the starting stake becomes meaningless, and the leaderboard rewards longevity
over skill. **You must keep these roughly balanced.**

| Faucets (add money) | Sinks (remove money) |
|---|---|
| Award dividends | 0.25% trade fee |
| Season-end performance dividends | Flip / churn penalties |
| IPO paper gains | Idle-cash fee (see below) |
| | Listing/creation fees (optional) |

**Recommended sinks to add from day one:**
- **Idle-cash fee:** ~0.02%/day on uninvested cash (encourages deploying capital, gently removes
  money).
- **Dividend budget cap:** cap total dividends paid per season at a fixed % of total market cap,
  so payouts auto-scale down as the economy grows instead of relying on hand-tuned constants.

**Metric to watch:** total money supply (sum of all bankrolls + market cap) over time. If it
trends up steadily, increase sinks.

---

## 8. Data you need (external inputs)

- **Player roster & headshots** — NBA player list, teams, positions, ages.
- **Box scores / advanced stats** — to compute `WARP`, minutes, recent form. `WARP` ("Wins Above
  Replacement Player") is an all-in-one value metric; if you don't have your own, substitute a
  public equivalent (BPM, EPM, LEBRON, RAPTOR-style) or compute a simple version from box scores.
- **Awards feed** — MVP/All-NBA/All-Star/etc. results to trigger award dividends.
- **Schedule** — to know when games/seasons start and end (drives the daily FV pass and
  season-end dividend run).

Sources: the public NBA stats API, Basketball-Reference, or a paid stats provider. Start with a
nightly batch pull; real-time isn't needed for a daily-reversion model.

---

## 9. Data model (schema)

```
players(
  id, slug, name, team, position, age,
  opening_price, current_price, fair_value,
  shares_outstanding,           -- fixed per player, e.g. 100
  listed_at, last_trade_day,
  volume_30d, ownership_pct
)

users(
  id, display_name, cash,        -- starts at STARTING_CASH
  tier                           -- free / pro (optional gating)
)

holdings(
  user_id, player_id, shares, avg_cost   -- avg_cost enables P&L display
)

trades(
  id, user_id, player_id, side, qty, price, fee, ts
)

dividend_events(
  id, player_id, type, per_share, snapshot_ts
)

price_history(
  player_id, date, price, fair_value, volume  -- one row/player/day
)
```

---

## 10. System components & jobs

**Request-time (synchronous):**
- **Trade engine** — validates funds/shares/ownership-cap, applies fee + flip penalty, executes
  at market price, applies Force A price impact, records the trade.
- **Portfolio/leaderboard** — computes net worth on demand; ranks users.

**Scheduled (cron):**
- **Daily fair-value pass** — recompute FV for every player from latest stats, apply Force B
  reversion, enforce floor. (Force B replaces the old "inactivity decay" idea.)
- **Daily price-history snapshot** — write one row per player for charts and 7-day change.
- **Daily idle-cash sink** — apply the small idle-cash fee.
- **Award ingestion** — event-driven: when an award result lands, pay award dividends.
- **Season-end run** — compute and pay the performance dividends, then start the next season.

---

## 11. Reference implementation (pseudocode)

```python
STARTING_CASH   = 10_000
FEE_PCT         = 0.0025
SHARES_OUT      = 100
K               = 0.003      # NBA-9 provisional prototype sensitivity
LAMBDA          = 0.03       # daily mean-reversion speed toward fair value
GRACE_DAYS      = 7
FLIP_WINDOW_H   = 24
FLIP_SURCHARGE  = 0.005
FLIP_CAP        = 0.015
OWNERSHIP_CAP   = 0.40
IDLE_CASH_FEE   = 0.0002     # per day
DIV_OFFSET      = 2.15
DIV_SCALE       = 0.0005102

import math

def liquidity(p):
    return 1.0 + 0.05 * p.volume_30d + 0.10 * p.ownership_pct   # >= 1

def execute_trade(user, p, qty, side):          # side: +1 buy, -1 sell
    P = p.current_price
    notional = qty * P
    fee = notional * FEE_PCT
    if reversed_within(user, p, FLIP_WINDOW_H):
        flip_rate = min(FLIP_SURCHARGE * (1 + user.roundtrips_7d.get(p.id, 0)), FLIP_CAP)
        fee += notional * flip_rate

    if side > 0:
        assert user.cash >= notional + fee, "insufficient cash"
        assert (user.shares[p.id] + qty) <= OWNERSHIP_CAP * SHARES_OUT, "ownership cap"
        user.cash -= notional + fee
        user.shares[p.id] += qty
    else:
        assert user.shares[p.id] >= qty, "not enough shares"
        user.cash += notional - fee
        user.shares[p.id] -= qty

    L = liquidity(p)
    p.current_price *= math.exp(K * side * qty / L)   # Force A
    p.last_trade_day = today(); p.volume_30d += qty
    record_trade(user, p, side, qty, P, fee)

def daily_fair_value_pass(p):                    # Force B — cron, once/day
    if days_since(p.listed_at) <= GRACE_DAYS:
        return                                   # grace period: no reversion
    p.fair_value = compute_fair_value(p)
    p.current_price += LAMBDA * (p.fair_value - p.current_price)
    floor = max(0.5 * p.fair_value, 25)          # floor tracks live value
    p.current_price = max(p.current_price, floor)

def compute_fair_value(p):
    return (p.base_tier
            + 1.0 * p.rolling_warp
            + 0.5 * p.minutes_factor
            + p.age_curve_adj
            + p.recent_form_adj)

def daily_idle_cash_sink(user):
    user.cash *= (1 - IDLE_CASH_FEE)

def pay_award_dividend(p, award):                # event-driven
    amt = AWARD_TABLE[award]
    for u in holders_at_snapshot(p):
        u.cash += u.shares[p.id] * amt

def pay_season_dividend(p):                      # end of season
    amt = (p.warp + DIV_OFFSET) * p.minutes * DIV_SCALE
    for u in holders_at_snapshot(p):
        u.cash += u.shares[p.id] * amt

def portfolio_value(user):
    return user.cash + sum(user.shares[pid] * price(pid) for pid in user.shares)
```

---

## 12. Build phases (roadmap)

**Phase 0 — Prototype the engine (no UI).**
Pure Python + SQLite. Implement `execute_trade`, `daily_fair_value_pass`, dividends. Write a
simulation that runs synthetic users trading over a fake season and assert the economy behaves
(prices track FV, no negative prices, money supply stable). *Deliverable: a passing test suite.*

**Phase 1 — API + persistence.**
Wrap the engine in a web API (FastAPI/Express). Endpoints: list players, player detail + history,
place trade, portfolio, leaderboard. Add auth and the starting bankroll on signup.

**Phase 2 — Stats pipeline.**
Nightly job pulling real NBA stats → compute FV inputs (WARP, minutes, form) → run the daily
FV pass and price-history snapshot.

**Phase 3 — Frontend.**
Player board with prices/movers, player pages with charts, trade modal, portfolio with P&L,
leaderboard. A live "trade tape" is great for engagement.

**Phase 4 — Dividends & seasons.**
Award ingestion + season-end run. Announce payouts.

**Phase 5 — Integrity & polish.**
Ownership caps, wash-trade detection, dividend anti-sniping, idle-cash sink, dividend budget cap.

**Phase 6 (stretch) — Shorting.**
Let users bet *against* overvalued players. This makes the market fully two-sided and
self-correcting — the single biggest gameplay upgrade, but adds real complexity (margin,
liquidation). Do it only once the long-only version is solid.

---

## 13. Parameters cheat-sheet (all in one place to tune)

| Parameter | Start value | Controls |
|---|---|---|
| `STARTING_CASH` | 10,000 | Opening bankroll |
| `SHARES_OUT` | 100 | Shares per player |
| `FEE_PCT` | 0.0025 | Trade fee (main sink) |
| `K` | 0.003 (provisional) | Price sensitivity selected by the NBA-9 synthetic trader sweep |
| `L` formula | `1 + 0.05·vol + 0.10·own` | Depth / manipulation resistance |
| `LAMBDA` | 0.03/day | How fast price tracks reality |
| `w1..w4` | tune | Fair-value stat weights (your edge) |
| `GRACE_DAYS` | 7 | New-player protection |
| `FLIP_SURCHARGE` / `FLIP_CAP` | 0.005 / 0.015 | Capped anti-churn surcharge |
| `OWNERSHIP_CAP` | 0.40 | Anti-cornering |
| `IDLE_CASH_FEE` | 0.0002/day | Inflation sink |
| `DIV_OFFSET` / `DIV_SCALE` | 2.15 / 0.0005102 | Season dividend size |
| floor | `max(0.5·FV, 25)` | Downside limit |

---

## 14. TL;DR

- Fake-money market where NBA players are tradeable shares; everyone starts equal; never resets.
- **Price = two forces:** demand (`P ×= exp(k·q/L)` on each trade) + performance gravity
  (`P += λ·(FV − P)` daily, where FV comes from real stats).
- **0.25% fee** both sides; 0.5%-step flip surcharge capped at 1.5%; ownership cap.
- **Dividends** pay cash for real results: an award table + a season-end
  `(WARP + 2.15) × minutes × 0.0005102` per share.
- **IPOs** via model-seed + auction, with a 7-day grace period.
- **Keep the economy balanced** — dividends are faucets; fees + idle-cash fee + a dividend budget
  cap are the sinks.
- **Build order:** engine → API → stats pipeline → frontend → dividends → integrity → (shorting).
