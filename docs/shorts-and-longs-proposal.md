# Shorts & Longs — proposal for the 10-player roster format

> Historical proposal snapshot. The current economy uses a $207.824M bankroll and
> $80K/NP owned-player dividends while weekly shorts remain fixed at $40K/NP; see
> `docs/PLAN.md`, `docs/pricing-writeup.md`, and `docs/shorting-spec.md`.

Status: proposal for group discussion. Sources: the 7/14 call transcript (Russell's price-short
example, the short-term vs long-term short distinction, temporary-longs-at-a-premium, the
injury concern, Ryan's simplicity constraint) and the current Economy v2 engine (one
whole-player share per user, $140M bankroll, D&T-projection surprise dividends at $40K/NP).

**Decided slot structure (Mith, 7/15):** ten roster players + **3 weekly shorts + 1
season-long short + 2 long ("boost") slots.** This doc records the designs considered for how
those slots pay, the evaluation, and the full spec of the chosen design.

---

## The problem each instrument must solve

The 10-slot roster format created two gaps the transcript itself identified:

1. **No way to express "overvalued"** — the market can only say "I like him" (buy) or "I'm
   done" (sell). Bam drops 83 → his price pumps → today you can only watch. ("You can short
   him because he is never doing that again... you want people talking about it.")
2. **No way to double down** — one share per player means conviction is capped. ("If a player
   is performing well and I want more exposure, how do I put more into that player?" → "You
   do not. ... Maybe the second piece is temporary longs and shorts... more expensive than
   owning the asset.")

And two constraints:

- **Simplicity** (Ryan): one new concept per instrument, no margin calls if avoidable.
- **Injury safety** (Russell): "The tricky part is injured players" — no instrument may pay
  out for predicting/exploiting injuries.

---

## Design 1 — "Mirror" (everything settles on dividends)

One mechanic for everything: every instrument is a claim on the **same surprise-dividend
stream** the roster already uses, positive or negative, possibly multiplied.

- **Short-term short (3 slots):** pick a player before tip-off; tonight you receive
  **−1 × his surprise dividend** ($40K per NP under his projection; you *pay* if he beats it).
  Settles at the final buzzer, slot re-arms next day.
- **Long-term short (1 slot):** same mirror but season-long — a standing −1 share on his
  dividend stream until you close it.
- **Longs (2 boost slots):** tonight, an owned player's dividend counts **2×** (both
  directions), activation fee 0.25% of his price.

*Pros:* one concept ("dividends, but inverted/doubled"); zero new engine plumbing (the payout
function already exists); exactly zero-mean under Option B projections, so the economy can't
inflate; injury-trivial (DNP = no event = void).
*Cons:* **the long-term short is broken.** Under unbiased projections, a season-long dividend
mirror has ~$0 expected value against *any* player — it cannot express "this asset is severely
overvalued," because it never touches the price. Bam's pumped price would be unshortable; the
discourse moment the group wants doesn't exist here.

## Design 2 — "True market" (everything settles on price)

The full stock-market answer: shorts and longs are **price positions**.

- **Short (all 4 slots):** open at price P₀, close at P₁, P&L = P₀ − P₁. Collateral reserved
  from bankroll; auto-liquidation if the price moves 50% against you; opening a short applies
  sell-side price impact, closing applies buy-side.
- **Longs:** leveraged price positions (2× exposure on an owned player's price move) with the
  same collateral machinery.

*Pros:* purest market semantics; Russell's Jaylen Brown example ($70M → $50M = +$20M) works
verbatim; makes the market two-sided and self-correcting (the build spec's Phase 6 goal).
*Cons:* heaviest complexity — margin, liquidation, borrow mechanics are exactly what Ryan
warned about; **two structural exploits need patching**: (a) inactivity decay (−0.5%/day on
quiet players) becomes risk-free short income on ignored names, (b) injuries crater prices, so
shorts become injury lottery tickets. Short-term (per-game) price shorts barely function at
all: prices move on *trading*, not on last night's game, so a one-day price short is mostly
noise — the "bad matchup tonight" bet has no expression here.

## Design 3 — "Horizon-matched hybrid" (recommended)

Match the instrument to what actually moves at each timescale: **games move dividends;
narratives move prices.** So short-term instruments settle on dividends, the long-term one
settles on price.

- **3 weekly shorts = week-window dividend mirrors** (Design 1 mechanics at a week horizon).
  The skill: role/schedule reads, "that 83-point game was fake," "this stretch of opponents
  buries him." Weekly rather than per-game because a single game's surprise is ~85-90% noise
  (single-game σ ≈ 8-10 NP vs real effects of 1-3 NP); over a ~3-4 game window the noise
  shrinks by √n while the signal persists — the skill-to-luck ratio nearly doubles. Weekly
  cadence also matches fantasy rhythm and removes nightly micromanagement.
- **1 season-long short = a price short** (from Design 2), the one place its complexity earns
  its keep — with three targeted guardrails instead of a general margin system (below).
- **2 long boosts = per-game 2× dividend multipliers on owned players** (Russell's temporary
  long, priced at a premium: activation fee + doubled downside).

*Pros:* every call from the transcript is expressible — tonight's dud (ST short), the
overvalued asset (LT short), the conviction double-down (boost); each instrument is one
sentence; the heavy machinery exists in exactly one slot.
*Cons:* two settlement concepts instead of one — users must learn "game shorts pay on
performance, the big short pays on price." (Mitigation: the UI already shows both numbers —
dividends and price — per player.)

*(A fourth family — over/under "line" contracts against the published projection — was
considered and rejected before evaluation: it settles cleanly but reads as prop betting, which
is both off-theme for a stock market and the worst possible optics for a product whose legal
posture is "not gambling.")*

---

## Evaluation

| Criterion (weight) | D1 Mirror | D2 True market | D3 Hybrid |
|---|---|---|---|
| Simplicity / explainability (×3) | **5** | 2 | 4 |
| Expresses "overvalued asset" (×3) | 1 | **5** | **5** |
| Expresses "bad game tonight" (×2) | **5** | 1 | **5** |
| Economy safety (zero-mean / no inflation) (×2) | **5** | 3 | 4 |
| Injury robustness (×2) | **5** | 2 | 4 |
| Engine cost to implement (×1) | **5** | 2 | 3 |
| Discourse / shareability (×1) | 3 | 4 | **5** |
| **Weighted total (max 70)** | **56** | 39 | **61** |

Design 1 is the safest and simplest but fails the assignment — its "long-term short" can't
target price, which is the entire point of the slot. Design 2 nails price shorting but drags
margin complexity into all four slots and breaks the per-game use case. **Design 3 wins**: it
buys Design 2's one irreplaceable feature at the cost of exactly one complex slot, and keeps
everything else at Design 1's simplicity.

---

## Recommended spec (Design 3, full detail)

### A. Weekly shorts — 3 slots, week-window dividend mirrors

- Arm a slot before a **Monday-Sunday window's** first game; it settles Sunday night:
  **payout = −1 × Σ (actual − projected NP) × $40K** across every game the player plays that
  week. Per-game surprise is capped at ±25 NP before summing; the weekly aggregate is capped
  at **±50 NP → max win/loss $2M per slot per week**.
- **Reserve requirement:** $2M cash per armed slot (covers the max loss; no margin calls ever).
- **Void rules:** a DNP or <40%-of-projected-minutes game simply contributes $0 to the weekly
  sum (no refund gymnastics); a window in which the player logs zero qualifying games settles
  at $0 with the fee refunded. No projection published (two-way call-up) → not shortable.
- **Friction:** flat $2K arming fee per short (0.1% of the slot) — the sink that stops
  spray-and-pray.
- **No self-overlap:** can't week-short a player you hold or boost during that window (blocks
  wash-hedging and confusion); max one armed short per player per user at a time.
- Expected value under Option B projections is ~$0 — a pure skill/variance instrument, and in
  aggregate it adds **zero inflation** (fees make it net deflationary).
- *Why weekly, not daily:* one game of surprise is overwhelmingly noise (σ ≈ 8-10 NP against
  real, persistent effects of 1-3 NP/game). Aggregating ~3-4 games nearly doubles the
  skill-to-luck ratio, simplifies DNP handling, and matches a check-in cadence casual users
  can actually sustain. The single-matchup "bad defense tonight" call is deliberately
  sacrificed — it was the noisiest and most prop-bet-flavored call in the design.

### B. Season-long short — 1 slot, a real price short

- Open against any player you don't own: notional = his current price P₀. **No cash changes
  hands at open** (no real-world "sale proceeds" — that would mint liquidity); P&L settles
  only on close: **P₀ − P₁**, credited/debited to cash. Close anytime; think Russell's Brown
  example.
- **Collateral:** 30% of P₀ reserved while open. **Auto-close** if price rises to P₀ × 1.3
  (loss = collateral, never more — bounded like everything else, no cascading margin).
  Note the deliberate constraint: shorting a $70M star locks up $21M of a bankroll that is
  mostly spent on the roster — the big short is a real allocation decision, not a free
  opinion.
- **Price impact:** opening applies one share of sell-side impact; closing one share of
  buy-side — shorts are real market participants, which is what makes the market two-sided.
- **Decay patch:** a player with open short interest counts as "active" — inactivity decay
  pauses. This closes the risk-free decay-farming exploit in one line.
- **Injury patch:** if the player is ruled out long-term/season, the short **settles at his
  10-day pre-injury average price**, not the post-news crater. Shorts profit from being right
  about basketball, never from a ligament. (Mirrors the injury-payout proration Russell
  proposed for holders.)
- **Borrow fee:** 0.05%/day of P₀ — makes indefinite parking cost something and is a clean sink.
- One slot means the choice itself is content: *the* short is a public statement of the
  market's most-wrong price.

### C. Longs — 2 "conviction boost" slots, per-game 2× dividends

- Arm on a player you **own**, before tip-off: tonight his dividend counts **2×, both
  directions**. Fee: 0.25% of his price (a $45M star costs ~$112K to boost — "more expensive
  than owning," per the call).
- Same void rules as game shorts; max one boost per player per night; boosts and game-shorts
  mutually exclusive per player.
- This answers "how do I get more Jimmy Butler" without breaking the one-share roster: extra
  exposure exists, is temporary, is priced, and carries double downside.

### Slot summary

| Slot | Count | Settles on | Horizon | Max loss | The call it expresses |
|---|---|---|---|---|---|
| Roster | 10 | dividends + price | season | price paid | "I believe in him" |
| Weekly short | 3 | dividends (inverted, cumulative) | Mon-Sun window | $2M/slot | "He has a bad week coming" |
| Price short | 1 | price | season / open-ended | 30% of notional | "The market is wrong about him" |
| Boost | 2 | dividends (2×) | one game | 2× a bad night | "I want MORE of my guy tonight" |

### Playoffs (from the call, compatible)

Reset the board for a playoff mode: longs/shorts open on anyone; positions force-close at
elimination. The LT-short machinery above works unchanged; game shorts/boosts carry over
per-game.

---

## Calibration & validation plan

The replay harness can rehearse all of this against 2025-26 before any UI exists:

1. **Weekly shorts:** simulate naive strategies (short last week's over-performer; short
   dense-schedule weeks; random) against the real 2025-26 season with cached D&T projections —
   confirm ~zero mean, measure per-slot weekly variance (calibrates the ±50 NP cap and $2M
   reserve), and verify the arming fee makes random spraying clearly negative-EV. Also measure
   the horizon effect directly (1-game vs weekly windows) to document the noise-averaging
   rationale with real numbers.
2. **Price short:** replay with synthetic trader flows and confirm (a) decay-pause kills the
   ignored-player farm, (b) the 1.3× auto-close bounds every historical trajectory, (c) the
   injury settlement rule never pays more than the pre-injury mark.
3. **Boosts:** confirm doubling is economy-neutral (zero-mean × 2 = zero-mean) and fee revenue
   scales sanely with usage.
4. **Inflation audit:** full-season replay with all instruments active at plausible usage
   rates; require the cohort stays inside the agreed band (~−1.5% to +5%).

## First simulation results (2026-07-15, `nba_stock_market/instruments_simulation.py`)

60 mock traders (7 archetypes) replayed the full 2025-26 season with all instruments active —
real box scores, cached D&T projections, Engine v2 trading. Report:
`output/instruments-sim.md`. Four findings:

1. **Weekly shorts work mechanically and the economy holds** (cohort +1.28% with everything
   on; 1,408 shorts settled). Per-slot variance ≈ $0.6M — comfortably inside the $2M
   reserve/cap, which look correctly sized.
2. **Random shorting is safely -EV, but projections have an early-season bias — confirmed
   across three seasons.** (Corrected 7/15 after a 5-seed rerun, then a three-season
   population analysis of ~79,000 projected player-games from 2023-24/2024-25/2025-26, each
   with its own in-sample bias constant.) The single-run "+$24K random-short edge" was seed
   noise: with each season's own constant applied, blind weekly shorting nets **−$11K to
   −$19K per short after the fee in all three seasons** — no free money, economy safe.
   What replicates everywhere is the **early-season bias**: top-150 players beat corrected
   projections every October (+0.66 to +1.15 NP/game) and November (+0.36 to +0.60) in all
   three seasons — projections start the year too low for good players. A mid-season
   negative dip appears in two of three seasons (not 2024-25). **Recommendation: fit a
   month-of-season bias curve (at minimum an October-November correction) instead of the
   flat constant**; without it, early-season *longs/boosts* are systematically +EV and
   early shorts are lambs to slaughter.
3. **"Fade the hot week" is probably a modest real edge, not conclusively proven.** Positive
   in all five sim seeds (+$10K to +$31K/short) and in all three seasons as a deterministic
   no-sampling strategy (+$42K, +$3K, +$86K; pooled ≈ +$43K/short at ~1.1σ, n=210).
   Direction is consistent (D&T doesn't fully price week-scale mean reversion; the edge is
   biggest in seasons with the mid-season dip), magnitude is fee-dominating but modest at
   portfolio scale (~+1% bankroll/season at full usage). Verdict: keep the $2K fee at launch,
   publish it as the known "basic strategy," and re-measure with real users — the seasonal
   bias fix in (2) will likely absorb part of it.
4. **Boost fees are miscalibrated as ad valorem**: 0.25% of a star's price (~$100K+) to double
   a zero-expectation dividend is structurally negative-EV — boosters finished last on fees
   alone. Boosts should carry a flat fee (like the $2K short fee), pricing the *variance*,
   not the player. Also: **price shorts never triggered** — with prototype impact (k=0.003)
   and thin flows, no price ever ran 5% above listing; the season short's viability depends
   on Ryan's order-flow calibration and should be re-tested with livelier markets.

## Open questions for the group

1. Weekly-short slot notional: flat $2M/slot (proposed) or scaled to the shorted player's
   price? Flat is simpler and keeps bench-player shorts meaningful.
2. Should the price short be allowed on your own player (as a hedge)? Proposed **no** —
   hedging your own roster is real-market-correct but confusing, and 10 slots is few enough
   that "sell him instead" is the honest answer.
3. Boost multiplier: 2× (proposed) or a premium-priced 3× tier later? Start 2×.
4. Do weekly shorts appear on the public feed immediately (juicy, invites pile-ons) or only
   after settlement (safer)? Proposed: after settlement, with a "most shorted this week"
   aggregate published when each window opens.
5. Playoff mode scope — separate bankroll or carried over?
