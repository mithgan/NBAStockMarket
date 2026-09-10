# Scoring-Margin Impact & Weekly Repricing — Results

> Historical report: current-engine scoring comparisons below predate the September 10 correction and are superseded. These numbers and related recommendations have not been fully regenerated. See the [correction and available-data results](per-game-scoring-parity-fix.md).

**Author:** Mith · **Date:** 2026-09-08 (rev 2) · **For:** Ryan's two asks — "rerun the
balancing with scoring-margin impact before picking a rate" and "update their cost each
week but limit how much it can change… then test it against keeping the price they
originally signed at."

**Rev 2 corrections (Ryan's review):** the comparison scripts now import the exact
engine `NetPointsCoefficients` instead of hand-copied weights (the copies were wrong —
e.g. dreb 0.85 vs the engine's 0.3), and the repricing simulator now charges the $10K
signing fee and enforces the $25K minimum price. Every number below is from the rerun.
Net effect: the margin conclusion *strengthened* (old-formula reliability is 0.954, not
0.931); the repricing table changed materially — fees thin the scout's edge, which
sharpens the cap decision (see Part 2).

Everything here is measured on the cached real seasons (2023-24 / 2024-25 / 2025-26,
79,503 player-games, top-150 listed universe). Scripts and evidence reports indexed at
the bottom.

---

## Part 1 — Scoring-margin impact

### The headline

**The current NetPoints formula already IS a scoring-margin impact metric.** Summing our
per-player NetPoints (the exact engine coefficients) across a team predicts the actual
game margin at **r = 0.964 out-of-sample** (2025-26, weights untouched since before that
season) — statistically tied with a metric fit *directly* to scoring margin, and better
on every product axis. No rebalancing or new rate is needed; the constants already
recommended stand.

### The three candidates, head-to-head

| Basis | Team-margin r | Split-half reliability | Players ≤0 EV | Top-5 ranking sanity |
|---|---:|---:|---:|---|
| **Old NetPoints (current)** | **0.964** | **0.954** | **0 / 150** | SGA, Maxey, Mitchell, Murray, J. Brown ✔ |
| Margin-fit box weights | 0.939 | 0.953 | 38 / 150 | Gobert, Clingan, Diabaté, Duren, Queta ✘ |
| Raw on-court +/- | 1.000 (by construction) | 0.678 | 52 / 150 | SGA, Holmgren, D. White, Champagnie, D. Robinson ✘ |

- **Margin-fit box weights** (regress team-game margin on box stats; r = 0.876 team-level
  validation): statistically excellent, product-hostile. It zeroes assists and threes
  (their value is already inside points at team level), over-credits rebounds, crowns
  backup centers, and leaves a quarter of the listed universe with ≤0 expected value —
  unpriceable above the $25K floor, structurally unholdable.
- **Real on-court plus-minus**: extracted from our cached ESPN game summaries (the CSV
  pipeline had dropped the `+/-` column; 100% join, all three seasons). Split-half
  reliability is only **0.678** — and its nightly noise (±12.3) **exceeds the entire
  market's value range** (best player ≈ +11.6/game), so a single night is >100% noise.
  At $20K a balanced roster would swing ±$1.04M per night against a star cost of only
  $232K. 35% of listed players are negative. Also decisive for the backend: **BDL's
  stats and box-score endpoints do not return plus-minus**, so live settlement could
  not even compute it without a provider change.
- **The blend dial** (α·old + (1−α)·marginFit) has no useful middle: α = 0.75 gains
  +0.002 of margin correlation while costing reliability (0.940 vs 0.954) and pushing
  Duren to #2; by α = 0.50 the top of the market is centers.

### What to tell Russ

Dividends already pay for margin impact — r = 0.964 is the receipt. Switching the formula
buys ≤ +0.002 of margin correlation and costs sane rankings, a quarter of the player
pool, and (for raw +/-) the predictability that makes it a skill game.

If the group switches to the margin-fit weights anyway, the rerun constants are on file:
additive YoY opening uplift **+0.28** (×1.08 fails — near-zero players can't be scaled),
same requote rule, and an unsolved floor problem (38 unpriceable players) that needs a
product decision before any rate works.

---

## Part 2 — Weekly repricing of held costs

### The question

Current v2 rule: signing locks the per-game cost for the life of the position. Ryan's
proposal: update each held cost weekly toward the market quote, capped at a %, with the
new price visible before games start.

### The head-to-head (2025-26 replay, $20K/NP, quote = trailing-10 weekly requote, $10K fee per add, $25K floor)

| Regime | Scout (signs improvers early) | Scout edge vs random | Mispriced star roster | Balanced hold | Random ×10 mean |
|---|---:|---:|---:|---:|---:|
| **LOCKED** (current rule) | +$0.83M | +$1.03M | **−$28.4M** | +$23.9M | −$0.21M |
| CAP 5%/wk | +$0.47M | +$0.64M | −$4.9M (83% healed) | +$17.6M | −$0.17M |
| **CAP 10%/wk** | +$0.14M | +$0.30M | **−$1.8M (94% healed)** | +$13.5M | −$0.16M |
| CAP 25%/wk | −$0.61M | −$0.43M | −$2.0M | +$7.0M | −$0.19M |
| FULL (no cap) | −$1.33M | −$0.96M | −$2.7M | +$3.6M | −$0.37M |

(The scout rebalances weekly ≈ 210 adds ≈ $2.1M of fees/season — that's why every scout
figure dropped versus rev 1, which forgot the fee.)

### The verdict: adopt it, cap between ±5% and ±10% per week

Lifetime locks turn every mispriced signing into a **permanent annuity** — a breakout
you caught (or an October-hot star you overpaid) compounds every game for the rest of
the season. Weekly capped repricing:

- **heals the mispricing** — ±10% removes 94% of a badly-priced roster's damage
  (−$28.4M → −$1.8M); ±5% removes 83%,
- **keeps net-of-fee skill positive** — the scout still beats random by +$0.64M at ±5%
  and +$0.30M at ±10%; at ±25% and beyond, fees exceed the surviving edge and scouting
  goes negative — do not go looser than ±10%,
- **leaves casual users at the fee drag only** (weekly-churning randoms lose ≈ $170K/
  season to fees — the churn fee doing exactly its job; patient holders pay ~nothing),
- **de-risks opening prices**: a bad opener self-heals in weeks instead of leaking all
  season, so the last-season ×1.08 anchor stops being load-bearing.

The group call is ±5% vs ±10%: pick **±5% if rewarding scouting matters more**, **±10%
if healing mispriced rosters matters more**. My vote is ±10% — fairness is the safety
property, and skill stays positive.

### Implementation notes for Ryan

1. Reprice at the **weekly roster-lock boundary**, before any of that week's games
   settle — the new cost is visible before games start, exactly as proposed.
2. Apply **symmetrically to shorts** (the locked cost a short receives repricies the
   same way).
3. Formula per held position, once a week:
   `cost ← clamp(market_quote, cost × 0.90, cost × 1.10)`.
4. Guardrail: held costs now chase the market quote, so add/drop **impact** can drag a
   rival's held cost. The $10K add fee + 50 bps impact bounds it; if griefing shows up
   live, cap the demand-driven portion of a weekly reprice separately from the
   performance-driven part.
5. Softens the drop decision (a declining player's cost follows him down). Measured as
   acceptable — skill separation survives — but it slightly weakens the bag-holding
   punishment; worth watching live.

### Caveats

- Single-season replay (2025-26); cross-season run available on request before build.
- The −$28.3M LOCKED figure includes the October trailing-lock artifact (signing at a
  hot early quote), which correct opening anchors already mitigate — but mid-season
  breakouts and faders create the same annuity dynamic all year; repricing is what
  heals those.

---

## Combined recommendation

| Knob | Value |
|---|---|
| Dividend basis | **Keep NetPoints** (team-sum margin r = 0.964) |
| $/NP rate | **$20,000** (unchanged — no rebalancing needed) |
| Opening cost | last-season NP/game × 1.08 (rookies: projection + 1.9 NP) |
| Market quote | trailing-10 requote, weekly or better, + 50 bps impact |
| **Held-cost repricing** | **weekly, toward quote, at the roster-lock boundary, shorts symmetric; cap ±10% (group may pick ±5% to favor scouting; never looser than ±10%)** |
| Churn fee / shorts | $10K per add, $0 drop · 7-day shorts, $10K early close |

## Evidence index

| Report | Contents |
|---|---|
| `output/per-game-margin-study.md` | Margin-fit weights, validation r = 0.876, rebalanced economy under margin-NP |
| `output/per-game-plusminus-study.md` | Real +/- extraction (100% join), reliability, noise, bands, rate sweep |
| `output/per-game-blend-sweep.md` | The α blend dial |
| `output/per-game-repricing-test.md` | Locked vs capped weekly repricing head-to-head |
| Scripts | `scripts/per_game_{margin_study,plusminus_study,blend_sweep,repricing_test}.py` |
| Full campaign | `docs/per-game-v2-findings.md` (rate, anchors, fees, shorts, user P&L) |
