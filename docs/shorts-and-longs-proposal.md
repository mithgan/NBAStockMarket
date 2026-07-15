# Shorts & Longs — proposal for the 10-player roster format

Status: proposal for group discussion. Sources: the 7/14 call transcript (Russell's price-short
example, the short-term vs long-term short distinction, temporary-longs-at-a-premium, the
injury concern, Ryan's simplicity constraint) and the current Economy v2 engine (one
whole-player share per user, $140M bankroll, D&T-projection surprise dividends at $40K/NP).

**Requested slot structure:** ten roster players + **3 short-term shorts + 1 long-term short +
a form of longs.** This doc proposes three complete designs for how those slots pay, evaluates
them, and recommends one.

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

- **3 short-term shorts = per-game dividend mirrors** (from Design 1). The skill: matchup
  reads, rest patterns, "that 83-point game was fake." Sexton-principle symmetric: shorting a
  star's *routine* night pays nothing; calling a real dud pays big.
- **1 long-term short = a price short** (from Design 2), the one place its complexity earns
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

### A. Short-term shorts — 3 slots, per-game dividend mirrors

- Arm a slot any time before tip-off; it settles at final: **payout = −1 × (actual − projected
  NP) × $40K**, same ±25 NP cap as regular dividends → max win/loss $1M per slot per night.
- **Reserve requirement:** $1M cash per armed slot (covers the max loss; no margin calls ever).
- **Void rules:** player DNP or plays <40% of projected minutes → void, fee refunded. No
  projection published (two-way call-up) → not shortable.
- **Friction:** flat 0.1% of $1M ($1K) arming fee per short — the sink that stops spray-and-pray.
- **No self-overlap:** can't game-short a player you hold or have boosted tonight (blocks
  wash-hedging and confusion); max one armed short per player per user.
- Expected value under Option B projections is exactly $0 — this is a pure skill/variance
  instrument, and in aggregate it adds **zero inflation** (fees make it net deflationary).

### B. Long-term short — 1 slot, a real price short

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
| Game short | 3 | dividends (inverted) | one game | $1M/slot | "He no-shows tonight" |
| Price short | 1 | price | open-ended | 30% of notional | "The market is wrong about him" |
| Boost | 2 | dividends (2×) | one game | 2× a bad night | "I want MORE of my guy tonight" |

### Playoffs (from the call, compatible)

Reset the board for a playoff mode: longs/shorts open on anyone; positions force-close at
elimination. The LT-short machinery above works unchanged; game shorts/boosts carry over
per-game.

---

## Calibration & validation plan

The replay harness can rehearse all of this against 2025-26 before any UI exists:

1. **Game shorts:** simulate naive strategies (short last night's over-performer; short vs
   back-to-backs; random) — confirm ~zero mean, measure variance, and verify the $1K fee makes
   random spraying clearly negative-EV.
2. **Price short:** replay with synthetic trader flows and confirm (a) decay-pause kills the
   ignored-player farm, (b) the 1.3× auto-close bounds every historical trajectory, (c) the
   injury settlement rule never pays more than the pre-injury mark.
3. **Boosts:** confirm doubling is economy-neutral (zero-mean × 2 = zero-mean) and fee revenue
   scales sanely with usage.
4. **Inflation audit:** full-season replay with all instruments active at plausible usage
   rates; require the cohort stays inside the agreed band (~−1.5% to +5%).

## Open questions for the group

1. Game-short slot notional: flat $1M/slot (proposed) or scaled to the shorted player's price?
   Flat is simpler and keeps bench-player shorts meaningful.
2. Should the price short be allowed on your own player (as a hedge)? Proposed **no** —
   hedging your own roster is real-market-correct but confusing, and 10 slots is few enough
   that "sell him instead" is the honest answer.
3. Boost multiplier: 2× (proposed) or a premium-priced 3× tier later? Start 2×.
4. Do game shorts appear on the public feed immediately (juicy, invites pile-ons) or only
   after settlement (safer)? Proposed: after settlement, with a "most shorted tonight"
   aggregate before tip-off.
5. Playoff mode scope — separate bankroll or carried over?
