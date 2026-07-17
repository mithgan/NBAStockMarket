# Shorting Mechanic — Final Spec (v1.0)

Owner: Mith (team-plan item #3). Status: ready for group sign-off; Ryan implements in the
engine after sign-off. Evidence base: `nba_stock_market/instruments_simulation.py`,
`output/instruments-sim.md`, and the three-season calibration studies summarized in §8.
Design history and rejected alternatives: `docs/shorts-and-longs-proposal.md`.

---

## 1. Overview

Two short instruments plus the temporary long, on top of the 10-player roster:

| Slot | Count | Bet | Settles on | Horizon |
|---|---|---|---|---|
| **Weekly short** | 3 | "He performs below projection this week" | Performance (dividend mirror) | Mon-Sun |
| **Price short** | 1 | "His market price is too high" | Market price | Open-ended |
| **Boost** (temporary long) | 2 | "Double my guy tonight" | Performance (2× dividend) | One game |

Design principles carried throughout: bounded loss on every position (no margin calls,
ever); no instrument profits from injuries; every position costs intention (fees); shorts
settle against the same projections as dividends, so one calibration governs everything.

---

## 2. Weekly performance short — 3 slots

### Lifecycle

1. **Arm** — any time before the first game of a Monday-Sunday window, on any *listed*
   player the user does not hold and has not boosted that window. Pay the arming fee;
   reserve the slot collateral.
2. **Accrue** — for each game the player plays that window:
   `game_surprise = actual_NP − (projected_NP + bias_correction(date))`, clamped to
   ±25 NP. The position accrues `−game_surprise`.
3. **Settle** — Sunday night: total accrual clamped to ±50 NP, paid as
   `total × $40,000` to/from the user's cash. Slot frees for the next window.

### Economics

| Parameter | Value | Rationale |
|---|---|---|
| Payout rate | $40,000 per net point (mirror of one held share) | Symmetry with dividends |
| Per-game clamp | ±25 NP | Blowout/garbage-time guard |
| Weekly clamp | ±50 NP → max win/loss **$2.0M** | Bounds every position |
| Collateral | $2.0M reserved while armed | Covers max loss exactly |
| **Arming fee** | **0.25% of the player's current price** (min $10K, non-refundable except full-void) | Same rate as trades. Measured: kills the only known mindless-profit strategy (fade-the-hottest: +$42K/short under a flat $2K fee → **−$10K** under 0.25%); random shorting stays −EV. Scales with conviction: $12.5K to short a $5M flier, $125K to short a $50M star |

### Voids and DNP handling

- A game where the player does not play, or plays **< 40% of projected minutes**, accrues
  $0 (not a loss, not a win). No refund gymnastics mid-week.
- A window with **zero qualifying games** settles at $0 and the arming fee is refunded.
- Players with **no published projection** (e.g. fresh two-way call-ups) are not shortable.
- Long-term injury announced mid-window: remaining games simply accrue $0 under the rule
  above. Shorts never profit from an injury announcement.

### Restrictions

- Not on players the user currently holds (no self-hedging).
- Mutually exclusive with boosting the same player in the same window.
- Max one armed short per player per user at a time. Slots re-armable every window.
- **League-wide cap: max 25 concurrent weekly shorts per player** (first-come,
  first-served). Bounds worst-case house settlement exposure at $50M per player-week and
  keeps the "most shorted" feed from becoming a stampede scoreboard.

---

## 3. Price short — 1 slot

### Lifecycle

1. **Open** — on any listed player the user does not hold. Records entry price P₀.
   **No cash proceeds at open.** Reserves collateral. Applies one share of sell-side
   price impact (shorts are real market participants).
2. **Hold** — daily borrow fee accrues. The shorted player counts as *actively traded*
   (inactivity decay paused — closes the decay-farming exploit).
3. **Close** — user-initiated any time, or automatic (below). Applies one share of
   buy-side price impact. P&L = `P₀ − P_close`, settled to cash.

### Economics

| Parameter | Value | Rationale |
|---|---|---|
| Collateral | 30% of P₀, reserved while open | Real allocation decision: shorting a $70M star locks $21M |
| Auto-close (stop-out) | price ≥ 1.3 × P₀, checked after **every** trade tick and daily pass | Max loss = collateral; bounded, no cascading margin |
| **Gap cap (bust price)** | settlement always at `min(P_close, 1.3 × P₀)` — realized loss can **never** exceed collateral, even if the price gaps past the stop between checks; the house absorbs the sliver | Restores "bounded loss, no exceptions" |
| Take-profit auto-close | none required (user closes); client may offer optional limits | Keep engine simple |
| Borrow fee | 0.05% of P₀ per day | Parking costs something; clean sink |
| **Borrow insolvency** | if free cash < the daily borrow debit, the position **force-closes immediately** at current price (gap cap applies) before any balance can go negative; new spending is blocked if it would leave free cash below ~14 days of accrued borrow on open positions | No debt, no negative balances, ever |
| Open fee | 0.25% of P₀ | Consistency with trades and weekly shorts |
| **League-wide cap** | max 10 open price shorts per player | Each open applies sell impact; 10 bounds coordinated bear raids (10 separate users × 30% collateral each) |

### Injury settlement (the one administered price)

If the shorted player is ruled out long-term/season: the short settles at his **average
price over the 10 days before the injury news**, not the post-news crater. Mirrors the
holder-side injury proration; shorts profit from basketball reads, never ligaments.

### Launch gating

Build now, **ship disabled**. In the full-season replay no price ever moved 5% off listing
under prototype impact settings (k = 0.003) — the instrument has nothing to bite until the
market-mechanics calibration produces real price dispersion. Enable when the trader-sim
workstream shows sustained price movement (and revisit inactivity decay, which compounds to
~0.5×/season at realistic trader counts).

---

## 4. Boost (temporary long) — 2 slots

- **Slot reset: 2 boost slots per Monday-Sunday week, resetting Monday 12:00am ET** (same
  calendar as weekly shorts). Each slot arms one player for one designated game; unused
  slots do **not** roll over. If the boosted game is voided (DNP rule), the slot is
  returned for reuse within the same week. Weekly (not nightly) keeps boosts scarce —
  two real conviction calls — and puts every instrument on one rhythm.
- Arm before tip-off on a player the user **holds**: that game his dividend counts **2×,
  both directions**.
- Fee: **0.25% of player price** (consistent with everything above). Note this makes
  boosting a conviction purchase, not a routine: expected value of the doubled dividend is
  ~$0, so the fee is the price of variance. (The earlier sim showed *any* ad-valorem fee
  makes habitual boosting −EV; that is accepted and intended — boosts are for spots, not
  spam. Group may revisit to flat $10-25K if usage is too low.)
- Same DNP/void rules as weekly shorts; exclusive with shorting the same player.

---

## 5. Expectation calibration (prerequisite, governs all settlement)

All performance instruments settle against `projected_NP + bias_correction(date)`.

**Replace the flat +0.44 constant with a rolling correction:**

```
bias_correction(d) = mean( actual_NP − projected_NP )
                     over ALL projected player-games in [d−30, d−1]
cold start (first ~14 days / <300 games in window):
                     seed with LAST season's October mean (≈ +0.7 to +1.2)
```

Measured effect (three seasons): rolling-30 cuts the October bias by 50-65% (2025-26:
+1.15 → +0.39 NP/game) and nearly zeroes mid-season (Jan −0.28 → −0.03); the seeded cold
start addresses the residual, which exists only because a trailing window has no data in
week one. Rolling also self-corrects if the projection vendor changes behavior.

**Fit the correction on the listed universe** (top-150/300), not the whole league — listed
players outperform the league-wide constant by +0.07-0.14 NP/game (3/3 seasons), which is
the accidental anti-shorter tilt found in the sims.

---

## 6. Parameters — single source of truth

```
WEEKLY_SHORT_SLOTS        = 3
WEEKLY_GAME_CLAMP_NP      = 25.0
WEEKLY_TOTAL_CLAMP_NP     = 50.0
WEEKLY_SHORT_COLLATERAL   = $2,000,000
SHORT_FEE_PCT             = 0.0025          # of player price; min $10,000
DNP_MINUTES_THRESHOLD     = 0.40            # of projected minutes
PRICE_SHORT_SLOTS         = 1
PRICE_SHORT_COLLATERAL    = 0.30            # of entry price
PRICE_SHORT_STOP_OUT      = 1.30            # of entry price
PRICE_SHORT_BORROW_DAILY  = 0.0005          # of entry price
BOOST_SLOTS               = 2               # per Mon-Sun week, reset Monday 00:00 ET
BOOST_MULTIPLIER          = 2.0
BOOST_FEE_PCT             = 0.0025
MAX_WEEKLY_SHORTS_PER_PLAYER = 25           # league-wide, concurrent
MAX_PRICE_SHORTS_PER_PLAYER  = 10           # league-wide, open
BORROW_BUFFER_DAYS        = 14              # spending guard vs accrued borrow
DOLLARS_PER_NET_POINT     = $40,000         # engine NET_POINTS_TO_DOLLARS / 100
BIAS_WINDOW_DAYS          = 30
BIAS_COLD_START           = last season's October mean
```

## 7. Integrity rules

- One armed position per (user, player) across all instrument types at any time.
- Short/boost positions hidden until settlement; a "most shorted this week" aggregate is
  published at window open (signal without pile-on targeting).
- Wash detection: users repeatedly shorting players a colluding account is pumping flags
  for review (same framework as trade wash detection).
- Playoffs (per the call): board resets, long/short anyone, positions force-close at
  elimination; same fees and clamps.

## 8. Evidence appendix (why these numbers)

- **Weekly window (not daily):** single-game surprise is ~85-90% noise (σ ≈ 8-10 NP vs
  persistent effects of 1-3); ~3-4 game windows nearly double the skill-to-luck ratio.
- **Clamps/collateral:** full-season replay, 1,408 settled shorts — per-slot weekly σ ≈
  $0.6M; ±50 NP ($2M) clamp rarely binds but bounds tails.
- **Random shorting EV:** −$9K to −$17K per short pre-fee across three seasons (26,500+
  projected player-games each) — the instrument self-punishes spam even before fees.
- **Fee (0.25% ad valorem):** the only mindless-profit strategy found (fade last week's
  hottest: +$42K/short net of a flat $2K fee, positive in 5/5 sim seeds and 3/3 seasons)
  flips to −$10K/short under 0.25%. Flat fees at spammable sizes do not clear this bar.
- **Seasonal bias:** without correction, October pays holders +$120K/week per held player
  (53.0% of 1,872 pooled October player-games beat projections; 62.5% of 437 player-stretches
  net-beat over Oct+Nov ≈ 5σ from fair). Rolling-30 + seeded cold start is the fix; see §5.
- **Cohort inflation with all instruments active:** +1.28% (single-seed full replay) —
  inside the target band.

## 9. Acceptance tests before launch

Re-run `instruments_simulation.py` with §5 and §6 applied and require:

1. Random weekly shorting EV ≈ −fee (no structural tilt either direction).
2. Fade-the-hottest EV ≤ 0 net of fees, **evaluated as the pooled mean across ≥10 seeds**
   (per-seed means carry ~±$23K of sampling noise and are not individually meaningful).
3. October holder surplus < $20K/week per held player (vs $120K uncorrected).
4. Cohort wealth change within −1.5% to +5% for the full season.
5. All existing engine tests green; settlement idempotency preserved.

**Executed 2026-07-16** (30 runs: 10 seeds × fees {0.25%, 0.30%, 0.35%}, production
`InstrumentsBook`, rolling-30 bias, ~6,400 settled fades per fee):

| Fee | Fade pooled | Seeds ≤ 0 | Random pooled | Inflation mean (worst) |
|---|---:|---:|---:|---:|
| **0.25% (decided)** | **−$9,807 ± $7,487** | 8/10 | −$38,808 | −0.72% (−1.54%) |
| 0.30% | −$23,064 | 10/10 | −$47,363 | −0.88% (−1.69%) |
| 0.35% | −$37,957 | 10/10 | −$54,883 | −1.03% (−1.86%) |

Decision (Mith, 7/16): **keep 0.25%** — fade exploit is dead at pooled level, fee stays
symmetric with trading, and higher fees push the worst deflation seeds below the −1.5%
band. **Tripwire:** re-measure fade EV on real user data after ~8 live weeks; if the pooled
live estimate exceeds $0 by more than its standard error, raise the fee to 0.30% and trim
the idle-cash sink to re-center inflation.
