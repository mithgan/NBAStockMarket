# Shorts, Longs & Two Calibration Issues — consolidated proposal

> Historical proposal snapshot. The current economy uses a $207.824M bankroll and
> $80K/NP owned-player dividends while weekly shorts remain fixed at $40K/NP; see
> `docs/PLAN.md`, `docs/pricing-writeup.md`, and `docs/shorting-spec.md`.

Status: team proposal (Mith, 2026-07-15). This is the actionable summary of the
shorts/longs design plus the two economy issues the simulations surfaced. Full design
history and alternatives considered: `docs/shorts-and-longs-proposal.md`. Simulation code:
`nba_stock_market/instruments_simulation.py`; report: `output/instruments-sim.md`.

> **2026-07-15 final decisions (supersede the fee/bias numbers below):** after a follow-up
> sim, the arming fee is **0.25% of player price** (not flat $2K — the flat fee left the
> fade exploit at +$42K/short; 0.25% flips it to −$10K), and the bias correction is a
> **rolling 30-day window with a seeded October cold start** (not a static monthly curve —
> adaptive, self-correcting if projections change). Canonical parameters:
> `docs/shorting-spec.md`.

---

## 1. The instruments (decided structure)

Every user has a 10-player roster plus side-bet slots. Each instrument in one sentence:

- **Weekly short** — bet a player *performs below* his projections for one Mon-Sun window.
- **Price short** — bet a player's *market price* is too high and will come down.
- **Boost** — double tonight's dividend (both directions) on a player you own.

### 1a. Weekly shorts — 3 slots

| Rule | Value | Why |
|---|---|---|
| Window | Mon-Sun, settles Sunday night | ~3-4 games averages out single-game noise (one game is ~85-90% luck; a week nearly doubles the skill-to-luck ratio) |
| Payout | −1 × (actual − projected NP, summed over week) × $40K | Exact mirror of holding one share |
| Caps | ±25 NP per game, ±50 NP per week | Max win/loss $2M per slot per week |
| Reserve | $2M cash held while armed | Covers max loss — no margin calls, ever |
| Fee | $2K flat per arming | See Issue 2 |
| Voids | DNP/short-minutes games count as $0; zero-game week = full refund | No injury lottery |
| Restrictions | Not on players you hold or boost that week; one short per player per user | Blocks self-hedging and pile-ons |

### 1b. Price short — 1 slot

| Rule | Value | Why |
|---|---|---|
| Open | At current price P₀; **no cash proceeds at open** | Shorting must not mint liquidity |
| Close | Anytime; P&L = P₀ − close price | Russell's example: short Brown at $70M, cover at $50M, +$20M |
| Collateral | 30% of P₀ reserved | Shorting a $70M star locks $21M — a real allocation decision |
| Stop-out | Auto-close if price hits 1.3 × P₀ | Max loss = collateral, bounded |
| Borrow fee | 0.05%/day of P₀ | Parking costs something; clean sink |
| Decay pause | Shorted player counts as "active" (no inactivity decay) | Closes the risk-free decay-farming exploit |
| Injury rule | Long-term injury ⇒ settle at 10-day pre-injury average price | Shorts profit from basketball reads, never ligaments |

### 1c. Boosts (the longs) — 2 slots

| Rule | Value | Why |
|---|---|---|
| Effect | Tonight, one owned player's dividend counts 2× — up AND down | Conviction with doubled risk, per the call ("more expensive than owning") |
| Fee | **Flat ~$2-5K** (changed from 0.25% of price — see sim finding) | Percentage fees made boosting structurally unprofitable |
| Voids | Same DNP rules as shorts | |
| Restrictions | Owned players only; exclusive with shorting the same player | |

---

## 2. What the simulations showed

Setup: full 2025-26 replay (26,540 real player-games, real cached D&T pregame projections),
60 mock traders across 7 archetypes with all instruments active; then a 5-seed rerun; then a
population-level analysis extended to three seasons (2023-24, 2024-25, 2025-26 — ~79,000
projected player-games, fetched and cached).

1. **Mechanics hold.** ~1,400 weekly shorts settled cleanly; cohort wealth stayed in band
   (+1.28% with everything on); per-slot weekly variance ≈ $0.6M — the $2M cap/reserve are
   sized right.
2. **Random shorting loses money in all three seasons** (−$11K to −$19K per short after
   fee). No free money; the instrument punishes thoughtlessness on its own.
3. **"Fade last week's hottest" is a modest, probably-real edge** (+$20-40K/short;
   positive in 5/5 sim seeds and 3/3 seasons deterministically, but only ~1.1σ pooled).
   Verdict: publish it as the known basic strategy; re-measure with real users.
4. **Ad-valorem boost fees are broken** — boosters finished last; a fee proportional to
   player price on a zero-expectation double is guaranteed bleed. Hence the flat-fee change.
5. **Price shorts never fired** — at prototype impact settings, no price moved 5% off
   listing all season. The instrument needs livelier order flow (Ryan's market-mechanics
   calibration) before it can matter. Ship it built but disabled.
6. **Two calibration issues surfaced** — the actual headline. Detailed below.

---

## 3. ISSUE 1 — The seasonal dividend bias (launch blocker)

### The problem, plainly

Every dividend, short, and boost settles against "actual minus projected performance."
Fairness requires projections to be right *on average*. Ryan's flat bias correction
(+0.44 NP added to every projection) makes the **season-long** average surprise zero — but
the error is not flat across the calendar. **Projections start every season too low.**

### The evidence (top-150 players, each season vs its own fitted constant)

Pooled across three seasons, ~32,000 player-games:

| Month | Games | Beat % | Mean surprise (NP/game) | $/week per held player |
|---|---:|---:|---:|---:|
| **Oct** | 1,872 | **53.0%** | **+0.88** | **+$119,600** |
| **Nov** | 5,820 | 51.3% | +0.46 | +$62,300 |
| Dec | 5,331 | 49.2% | +0.10 | +$13,000 |
| Jan | 6,132 | 47.7% | −0.12 | −$16,100 |
| **Feb** | 4,549 | **47.1%** | **−0.16** | −$22,200 |
| Mar | 5,985 | 48.2% | −0.05 | −$6,600 |
| Apr | 2,325 | 48.4% | +0.22 | +$30,500 |

Player-level, October+November (players with ≥8 games): **62.3% / 60.1% / 64.9%** of the
top 150 net-beat their projections in the three seasons — pooled 273 of 437 (62.5%), about
five standard deviations from the 50% a fair ruler would give. The average listed player
banks +7.6 to +13.7 NP of calendar surprise across Oct-Nov ≈ **+$300-550K per player held**
≈ **$3-5.5M per 10-player roster, every fall, for free.**

The October spike replicates in **3 of 3** seasons; the Jan-Feb dip in 2 of 3 (2024-25 is
flatter); a small April rebound (tanking season) shows in 3 of 3.

### Why it matters

- **It's a calendar cheat code**: hold-and-boost in the fall, short in the winter. Roughly
  25-60× the arming fee in predictable value. By season two every user knows it, and the
  dominant strategy is reading a calendar, not basketball.
- **It whipsaws the economy**: a large faucet every autumn, a drain every winter.
- **It poisons the instruments**: October shorts are donations; October boosts are free money.

### The fix

Replace the flat +0.44 constant with a **month-of-season correction curve**, fitted on the
three cached seasons (the pooled table above *is* essentially the curve). Guidance:

- Fit Oct and Nov aggressively (3-for-3 evidence, largest magnitudes).
- Treat Dec-Mar gently (smaller, only 2-of-3 consistent).
- Consider the small April term (3-for-3 but short month, tanking-driven).
- Refit annually as each season closes; also fit the constant **on the listed universe**,
  not the whole league (see Issue 2 — the tier mismatch is the same root cause).

Implementation is small: the expectation source swaps one constant for a 7-entry lookup.
All three seasons of inputs are cached under `data/raw/` (ESPN logs + `dnt-*` projections),
so the fit is reproducible offline.

**This is the one precondition before instruments go live.**

---

## 4. ISSUE 2 — The arming fee (what it is for, and its size)

### The EV ladder (measured, three seasons)

| Strategy | Per weekly short, before fee | After $2K fee |
|---|---:|---:|
| Random player | −$9K to −$17K | **−$11K to −$19K** |
| Fade last week's hottest | ≈ +$22-42K | ≈ +$20-40K |
| Actual skill | above that | above that |

Note random shorting *already loses* before any fee. That tilt is an accident: the bias
constant is fitted league-wide, but only the top 150 are shortable, and listed players
slightly outperform the league-corrected projections (+0.07 to +0.14 NP/game, all three
seasons). The same fix as Issue 1 (fit the correction on the listed universe, by month)
removes this tilt — after which a random short becomes a true ~$0 coin flip.

### So why have a fee at all?

Not to make shorting unprofitable — the fee's jobs are structural:

1. **Leaderboard variance is never free.** Score = rank, not dollars. A trailing user
   *wants* zero-EV coin flips (upside jumps the queue; expected dollar cost is irrelevant
   to 8th place). Free shorts ⇒ everyone behind spams all 3 slots weekly as lottery
   tickets. The fee prices the ticket.
2. **Short interest should mean something.** The "most shorted this week" feed is signal
   only if positions cost intention. Free arming makes it noise.
3. **Fees are a sink.** One of the few levers pulling money out of the economy against the
   dividend faucets.
4. **Size for the fixed world.** After the Issue-1 curve fix, the accidental −$10-17K tilt
   disappears and the fee becomes the *only* brake on spray-and-pray. $2K is calibrated
   for that world: trivial vs a $140M bankroll and a ±$2M swing, but large enough that
   ~26 weeks × 3 slots of mindless arming (~$156K/season) visibly bleeds.

Recommendation: **keep $2K flat** (weekly shorts), **$2-5K flat** (boosts), revisit only if
real-user data shows the fade edge surviving the Issue-1 fix at scale.

---

## 5. Launch plan

| Step | What | Gate |
|---|---|---|
| 1 | Fit and ship the monthly bias curve (Issue 1) + refit on listed universe (Issue 2) | **Blocker for everything below** |
| 2 | Weekly shorts (3 slots, spec §1a) | After step 1 |
| 3 | Boosts with flat fee (2 slots, spec §1c) | After step 1 |
| 4 | Price short (spec §1b): build now, ship **disabled** | Enable when market-mechanics calibration produces real price dispersion (also revisit inactivity decay — at realistic trader counts it compounds to ~0.5×/season) |
| 5 | Re-run `instruments_simulation.py` after the curve fix; confirm random-short EV ≈ −fee, fade edge shrunk, cohort inflation in band | Regression harness exists; one command |

## 6. Open questions for the group

1. Weekly-short notional: flat $2M/slot (proposed) vs scaled to player price.
2. Price short on your own player (hedging): proposed **no**.
3. Boost multiplier: 2× now; premium 3× tier later?
4. Short-interest visibility: settle-then-reveal (proposed), with an aggregate
   "most shorted this week" published at window open.
5. Playoffs mode: reset board, long/short anyone, force-close on elimination (per the call).
6. Listed-universe size: 150 (current sim) vs 300 (opening-price CSV already covers 300) —
   affects Issue 2's universe-fitted constant.
