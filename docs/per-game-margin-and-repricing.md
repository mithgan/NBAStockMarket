# Scoring-Margin Impact & Weekly Repricing — Results

**Author:** Mith · **Date:** 2026-09-07 · **For:** Ryan's two asks — "rerun the balancing
with scoring-margin impact before picking a rate" and "update their cost each week but
limit how much it can change… then test it against keeping the price they originally
signed at."

Everything here is measured on the cached real seasons (2023-24 / 2024-25 / 2025-26,
79,503 player-games, top-150 listed universe). Scripts and evidence reports indexed at
the bottom.

---

## Part 1 — Scoring-margin impact

### The headline

**The current NetPoints formula already IS a scoring-margin impact metric.** Summing our
per-player NetPoints across a team predicts the actual game margin at **r = 0.963
out-of-sample** (2025-26, weights untouched since before that season) — statistically
tied with a metric fit *directly* to scoring margin, and better on every product axis.
No rebalancing or new rate is needed; the constants already recommended stand.

### The three candidates, head-to-head

| Basis | Team-margin r | Split-half reliability | Players ≤0 EV | Top-5 ranking sanity |
|---|---:|---:|---:|---|
| **Old NetPoints (current)** | **0.963** | 0.931 | **0 / 150** | SGA, Jalen Johnson, KAT, Duren, Maxey ✔ |
| Margin-fit box weights | 0.939 | **0.953** | 38 / 150 | Gobert, Clingan, Diabaté, Duren, Queta ✘ |
| Raw on-court +/- | 1.000 (by construction) | **0.678** | 52 / 150 | SGA, Holmgren, D. White, Champagnie, D. Robinson ✘ |

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
- **The blend dial** (α·old + (1−α)·marginFit) has no useful middle: by α = 0.75 the top
  of the market is already Duren/Clingan/Gobert, for a margin-correlation gain of +0.002.

### What to tell Russ

Dividends already pay for margin impact — r = 0.963 is the receipt. Switching the formula
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

### The head-to-head (2025-26 replay, $20K/NP, quote = trailing-10 weekly requote)

| Regime | Scout (signs improvers early) | Mispriced star roster | Balanced hold | Random ×10 mean |
|---|---:|---:|---:|---:|
| **LOCKED** (current rule) | +$2.93M | **−$28.3M** | +$24.0M | +$2.2M |
| CAP 5%/wk | +$2.57M | −$4.8M | +$17.7M | +$2.2M |
| **CAP 10%/wk** | **+$2.24M (77% kept)** | **−$1.7M (94% healed)** | +$13.6M | +$2.2M |
| CAP 25%/wk | +$1.49M (51%) | −$1.9M | +$7.1M | +$2.2M |
| FULL (no cap) | +$0.77M (26%) | −$2.6M | +$3.7M | +$2.0M |

### The verdict: adopt it, at ±10% per week

Lifetime locks turn every mispriced signing into a **permanent annuity** — a breakout
you caught (or an October-hot star you overpaid) compounds every game for the rest of
the season. Weekly repricing at a ±10% cap:

- **heals 94% of a badly-priced roster's damage** (−$28.3M → −$1.7M),
- **keeps 77% of the scout's discovery premium** — the cap gives an early signer a
  multi-week catch-up window where their cost still lags the player's new level, so
  skill pays, but you re-earn it instead of clipping coupons forever,
- **leaves casual/random users untouched** in every regime (+$2.2M baseline drift),
- **de-risks opening prices**: a bad opener self-heals in weeks instead of leaking all
  season, so the last-season ×1.08 anchor stops being load-bearing.

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
| Dividend basis | **Keep NetPoints** (team-sum margin r = 0.963) |
| $/NP rate | **$20,000** (unchanged — no rebalancing needed) |
| Opening cost | last-season NP/game × 1.08 (rookies: projection + 1.9 NP) |
| Market quote | trailing-10 requote, weekly or better, + 50 bps impact |
| **Held-cost repricing** | **weekly, toward quote, ±10% cap, at the roster-lock boundary, shorts symmetric** |
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
