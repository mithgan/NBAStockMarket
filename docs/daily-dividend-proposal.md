# Daily Dividend Model v3 — proposal (coupon + surprise)

Status: proposal for group discussion. Builds on Economy v2 + Option B (cached Dunks & Threes
pregame projections with the league-bias correction). Research grounding:
`docs/fv-research-log.md` §7-8 (the dividend-inversion findings).

## The design goal, in one line

> **A 30-point game from Collin Sexton must pay more than a 30-point game from Luka — but
> owning Luka must still be worth something.**

The first half is the *surprise* principle (already in Economy v2). The second half is what v2
is missing: under pure-surprise dividends, a correctly-projected player pays $0 in expectation
— a star is a $45M asset with zero yield. We measured where that road ends (research log §7):
under self-referential expectations every quality signal *anti-predicted* payouts (rho ≈ −0.2),
i.e. "never own Jokic" was the optimal strategy. Option B's absolute projections fixed the
anti-quality bias, but expected yield for everyone is still ~$0 — true value still pays
nothing for being owned.

## The proposal: two components, one game event

After each game, a player's holders receive:

```
dividend_per_share = COUPON + SURPRISE

SURPRISE = (actual_NP − projected_NP_corrected) × $40,000        [unchanged from v2]

COUPON   = κ × projected_NP × $40,000 × (actual_minutes / projected_minutes, capped at 1)
           κ ≈ 0.02 (illustrative — calibrated in the replay, see §Calibration)
```

- `projected_NP` = net points computed by the existing `NetPointsModel` from the **D&T
  predicted box score** (`p_pts, p_orb, … p_mp` — the game-predictions-box endpoint the engine
  already caches per date). Same projection powers both components.
- `projected_NP_corrected` = projected_NP + the Option B league-bias correction (+0.436),
  exactly as today. The bias correction applies to the surprise baseline only; the coupon uses
  the raw projection so it isn't inflated by the correction.

**Why this shape:**

- **SURPRISE is the skill game** (zero-mean by construction under unbiased projections).
  Sexton's 30 blows past his projection → big payout. Luka's 30 *is* his projection → ~$0
  surprise. The Sexton>Luka requirement is preserved verbatim.
- **COUPON is the ownership yield** — literally a return *on true value*, because it's
  proportional to the same projected production that defines the player's fair value. Stars
  pay a steady drip for being good; holding Jokic becomes an income position, not a dead $45M.
  It's pre-game-knowable (like a bond coupon), so it capitalizes into the price rather than
  being exploitable: you can't "snipe" a payment everyone can see coming — its value is already
  in what you paid.
- The minutes scaler (`actual/projected`, capped at 1) means a late scratch or short night
  pays a pro-rated coupon — no free income for players who don't actually play, and no debit
  for sitting either.

## Worked examples (κ = 0.02, current $40K/NP scale)

| Scenario | Projected NP | Actual NP | Surprise | Coupon | Total /share |
|---|---:|---:|---:|---:|---:|
| **Sexton drops 30** (proj ~12 NP, actual ~25) | 12.0 | 25.0 | **+$520,000** | +$9,600 | **+$529,600** |
| **Luka drops 30** (his normal night) | 28.0 | 30.0 | +$80,000 | +$22,400 | +$102,400 |
| **Luka drops 45** (star ceiling still pays) | 28.0 | 45.0 | +$680,000 | +$22,400 | +$702,400 |
| **Luka has a stinker** (15 NP) | 28.0 | 15.0 | −$520,000 | +$22,400 | −$497,600 |
| **Jokic rests / late scratch** | 30.0 | DNP | $0 (no event) | $0 | $0 |
| **Bench guy, quiet night as projected** | 4.0 | 4.5 | +$20,000 | +$3,200 | +$23,200 |

The ordering the game wants: *unexpected greatness ≫ expected greatness > expected mediocrity*,
with expected greatness still strictly > 0. Season shape (illustrative): Luka's coupon ≈
$22.4K × ~70 games ≈ **$1.6M/season ≈ 3.8% yield** on his $41.6M listing; his surprises sum
to ~$0 unless he outruns the model — which is exactly the bet his buyers are making.

## Deeper uses of game-predictions-box (beyond expected NP)

The predicted box score is a full stat line, not one number. Cheap wins it enables:

1. **DNP semantics for free.** `p_mp` is the availability signal: projected ~0 minutes → no
   expectation, no event (current behavior, now explicit). Projected 34 minutes + played 6
   (injury exit) → pro-rated coupon, and we propose **suppressing the surprise debit when
   actual minutes < 40% of projected** — holders shouldn't eat a −20 NP "surprise" because of
   a first-quarter ankle roll. The information was physical, not basketball.
2. **Garbage-time/blowout cap.** Cap per-game surprise at **±25 NP** before dollars. Protects
   the economy's tails (a 4-sigma noise game can't move ±$1M+/share) and blunts stat-padding.
3. **Per-stat kickers (optional, flavor).** Because projections are per-stat, "beat your
   projected rebounds by 8" or "triple-double vs a projection that said no" are computable and
   make great shareable-card moments. Recommend: cosmetic/badge layer only at first — keep
   real money on the one transparent NP number.
4. **A published pregame "line."** Showing each player's projected NP before tip-off makes the
   dividend legible (users see the bar their guy must clear) and doubles as content. The
   engine already has the data; this is pure UI.

## Calibration protocol (the replay harness answers all of this)

Free parameters: `κ` (coupon rate), the surprise cap, the DNP threshold. Calibrate against the
2025-26 replay (deterministic, already reproduces Ryan's report to the dollar) with targets:

1. **Median star yield 3-6%/season** of listing price (makes stars real income assets without
   turning the game into bonds). κ = 0.02 lands Luka at ~3.8% — in band, refine per tier.
2. **Improver upside still dominates.** Season-total dividends for the breakout cohort (Amen
   Thompson, Fears, Flagg 2025-26) must still exceed any star's coupon income by a healthy
   multiple — the Sexton principle at season scale.
3. **Cohort inflation inside the agreed band** (~−1.5% to +5%). The coupon is a pure faucet:
   rough order, mean projected NP ≈ 9 across the universe → κ=0.02 adds ≈ $75-80M/season
   across 150 players × 100 shares ≈ +0.55% cohort wealth. Offset knobs if needed: the idle
   sink, or a **dividend budget cap** (total coupons ≤ X% of market cap, auto-scaling κ).
4. **Quality-payout sanity check.** Re-run the research-log §7 test under v3: rho(prior
   quality → season dividends) should land **positive but modest** (~+0.2 to +0.4) — quality
   pays, but doesn't trivially decide the leaderboard. (v2 today: ~0. Old trailing economy:
   −0.2. Pure-production dividends would be ~+0.7 — that's fantasy, not a market.)

## Edge cases and abuse

- **Late scratch after buy-in:** no event → no loss beyond price; coupon requires minutes.
- **Rest days / load management:** star coupons are earned per game played, so heavy-rest
  stars yield less — correctly priced-in by the market, and an honest reflection of value.
- **Blowout stat-padding:** the ±25 NP cap bounds it; NP itself already penalizes inefficiency
  (fga/tov are negative weights).
- **Coupon sniping:** impossible by construction — the coupon is known pregame and thus
  capitalized into price; buying at 6pm captures nothing the seller didn't price at 5pm.
  (Contrast award dividends, which needed anti-snipe windows.)
- **Projection gaps** (two-way players, fresh call-ups missing from D&T): fall back to the
  salary-implied prior for the surprise baseline (existing behavior) and **no coupon** until a
  real projection exists — avoids paying yield off a made-up number.

## What this does NOT change

Prices remain pure supply/demand + inactivity decay (reversion stays off). Fees, float,
ownership caps, grace periods: untouched. This is a payout-layer change only, implementable as
a second term inside `pay_daily_performance_dividend` with `κ = 0` reproducing Economy v2
exactly — so the replay comparison is one flag.

## Open questions for the group

1. κ globally flat, or tiered (slightly higher for bench so cheap players' coupons aren't
   invisible)? Flat is cleaner; start flat.
2. Should the surprise cap be symmetric (±25) or looser upward (+30/−20) to keep monster-game
   headlines? (Economy prefers symmetric; marketing prefers loose-up.)
3. Do per-stat kickers ever carry money, or stay cosmetic badges forever?
4. Coupon eligibility: any minutes vs a minimum (e.g. ≥5 actual minutes)?
