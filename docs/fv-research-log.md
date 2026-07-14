# FV Research Log — every test we ran, why we ran it, and how it works

This document is the complete record of the fair-value (FV) research: the question each test
was designed to answer, exactly how it works mechanically, what it found, and how each result
forced the next test. It assumes no prior context. Read top to bottom and you can re-derive —
or challenge — every decision in the final formula.

**The goal of all of it:** find the best formula for a player's *opening listing price* — the
number the market opens at before supply and demand take over.

**The final answer this research produced** (details in `docs/opening-price-model.md`):

```
blend         = 0.40·z(EPM) + 0.35·z(prior WAR) + 0.15·z(minutes) + 0.10·z(25 − age)
projected_WAR = 1.4821 + 2.5605 × blend
FV            = $1.2M + projected_WAR × $5M
listing       = 0.9 × FV + 0.1 × actual salary,  clamped [$2M, $70M]
```

**Post-review correction (2026-07-14).** The first exploratory notebook evaluated only
players who appeared in both the train and test seasons. That introduced survivorship bias.
The production verifier now defines eligibility from the train season, takes the same top 300
by minutes that production lists, and assigns zero WAR to players absent the next season. It
also evaluates the v2 fair-value component, not a rate-only proxy, on the exact same cohort as
its prior-WAR baseline. The canonical result is in `output/fv-validation.md`: the FV component
scores 0.752/0.773/0.768/0.655 and beats the same-cohort prior-WAR baseline in all four windows.
Intermediate numbers below are retained as the research trail where noted; only the generated
report is acceptance evidence.

---

## 0. The measurement tool everything relies on: Spearman rank correlation

Before any test makes sense, one concept: almost every experiment below produces a single
number called **Spearman rho (ρ)**. Here is exactly what it is.

**The setup.** For some group of players (usually ~400-460), we have two lists of numbers:
a *prediction* made before a season (e.g. our price for each player) and an *outcome* known
after it (e.g. the WAR each player actually produced). Pair them up: each player is one dot
of (predicted, actual).

**The computation.** Rank both lists 1st, 2nd, 3rd… (average ranks for ties). Then compute
the ordinary correlation *of the ranks*. That's it.

- **ρ = 1.0** — the prediction ordered players exactly right.
- **ρ = 0.0** — the ordering was worthless, no better than shuffling.
- **ρ = −1.0** — perfectly backwards.

**Why ranks instead of raw values?** Three deliberate reasons:

1. **Scale immunity.** Our candidate formulas output incomparable units (z-scores, dollars,
   rating×minutes products). Ranks only care about *order*, so no formula can win because its
   numbers happen to be large. This also matters across metrics: EPM's numeric spread is wider
   than LEBRON's, which inflates dollar comparisons but not rank comparisons.
2. **It matches what the game needs.** A market rewards *relative* pricing — is player A cheap
   relative to player B? Getting the order right is the product requirement; absolute dollars
   are a separate calibration step.
3. **Outlier robustness.** One 15-WAR MVP season can't dominate the statistic the way it
   would dominate a squared-error measure.

We implemented Spearman from scratch (no scipy dependency) in
`nba_stock_market/fv_validation.py`, with average-rank tie handling — ties are guaranteed in
our data because the price floor ($2M) and cap ($70M) create blocks of identically-priced
players. The implementation has its own unit tests: known answers (±1.0), invariance under
monotone transforms (x vs x³ must give exactly 1.0), tie handling, and rejection of degenerate
input (mismatched lengths, <3 points, constant series that would divide by zero).

**Secondary metric — top-30 recall.** ρ over 450 players is dominated by the broad middle, but
portfolio money concentrates in stars. So some tests also report: of the 30 players the formula
ranks most valuable, how many actually finished in the true top 30? (Answer, spoiler: ~53% for
every formula — star outcomes are genuinely hard, and that residual is the game.)

---

## 1. The backtest protocol: "train on season N−1, grade on season N"

**Why we built it.** The user asked the key question early: *"Is there a way to backtest this
FV?"* A fair-value formula is a forecast, and forecasts are only testable one way: make them
with information available *at the time*, then compare against what happened. Any evaluation
that peeks at the season being predicted is worthless.

**How it works, step by step:**

1. Pick a season pair, e.g. train = 2024-25, test = 2025-26.
2. For every player, gather **only 2024-25 information**: rating (EPM/LEBRON/DARKO), WAR,
   minutes, age, salary.
3. Run the candidate formula on those inputs → a predicted value/price per player.
4. Look up each player's **realized WAR in 2025-26** (the season the formula never saw).
5. Compute Spearman ρ between the predicted ordering and the realized ordering.
6. Repeat for four season pairs — 2021-22→2022-23, 2022-23→2023-24, 2023-24→2024-25,
   2024-25→2025-26 — so one weird season can't decide the answer. Eligibility comes only from
   the train season; a player absent in the test season receives zero WAR.

**What "realized WAR" is and why it's the target.** WAR = wins above replacement: one number
for "how much winning did this player actually produce," combining per-minute impact AND
playing time (from the LEBRON dataset's WAR column). We chose it because an opening price is
implicitly a claim about *total future value*, and total value = quality × quantity. (The
target choice turned out to be the most important assumption in the whole research program —
see tests 6 and 7, where we attacked it.)

**The mandatory baseline.** Every formula competes against **naive WAR carry-forward**: predict
that each player produces exactly what he produced last season. It's the dumbest defensible
forecast. Anything below it is worse than doing nothing clever. On the exact production listing
cohort its scores are ρ = 0.712 / 0.749 / 0.725 / 0.610 (mean 0.699).

**Data sources** (all cached under `data/raw/opening/`, all free/public except EPM; exact
sources and SHA-256 hashes are pinned in `data/manifests/fv-inputs.json`):
- `lebron.csv` (gabriel1200/site_Data) — LEBRON rating, WAR, minutes, age; 17 seasons.
- `darko_current.csv` (darko.app public sheet) — DARKO DPM, current snapshot only.
- `epm_2022.csv` … `epm_2026.csv` — Dunks & Threes EPM via API (key in `.env`), built by
  sweeping the final week of each regular season and keeping each player's latest row.
- `nba_salaries_master.csv` / `salary.csv` — actual salaries, historical and current.

---

## 2. Test: does the v1 model predict anything? (the first honest failure)

**Why.** The shipped v1 opening-price model was `$12M + $7M × LEBRON`, shrunk by minutes, then
blended 70/30 with salary. Before wiring it into listings, prove it forecasts value.

**How.** The Section-1 protocol, v1 model vs the naive baseline, four season pairs.

**Result — it failed.** v1 scored ρ = 0.52-0.58. The naive baseline scored 0.67-0.77. The
model *lost to "copy last season" in all four years.*

**Why it failed — the diagnosis that shaped everything after.** LEBRON's rating is
*per-possession*. It has no idea whether a player fills a 900-minute or a 2,900-minute role.
Role size is a coach's decision, it persists year to year, and prior WAR carries that
information "for free." A rate-only price systematically overvalues small-role specialists
with shiny ratings. **Lesson: an FV needs a volume term.** Also visible in the decile table:
realized WAR fell smoothly through the expensive deciles then went flat at the cheap end,
where low-minute rating noise dominates.

---

## 3. Test: which metric? LEBRON vs DARKO vs EPM

**Why.** The formula's core input is an all-in-one impact rating, and three candidates were on
the table (the team call mentioned EPM or DARKO; LEBRON was what our data source carried).
Metric choice shouldn't be a vibe — it's measurable.

**How — two sub-tests:**

*(a) Agreement study (current season).* Join all three metrics on normalized player names
(~516-534 shared players), compute pairwise rank correlations of the ratings themselves, and
tabulate the largest individual disagreements when both are priced through the same
$-per-point map.

*(b) Predictive tournament (historical).* Run the Section-1 protocol with each metric as the
sole rating input. LEBRON has 17 seasons of history; EPM snapshots we rebuilt for 5 seasons
from the D&T API (the endpoint accepts `?date=`, so we swept historical season-end weeks);
DARKO's public sheet is current-only, so it could join (a) but not (b).

**Results:**

- Agreement: DARKO↔EPM ρ = 0.829; LEBRON↔EPM 0.761; LEBRON↔DARKO 0.749. **LEBRON is the
  outlier** — it systematically loves defense-first bigs and low-usage connectors (Derrick
  White, Queta, Clingan, Duren priced $12-18M richer) while DARKO/EPM favor shot creators
  (Anthony Edwards $17M richer under DARKO, Jamal Murray, Brunson, OG).
- Prediction on the shared production cohort: **EPM matched or beat LEBRON in all four
  corrected season pairs** — ρ 0.655/0.691/0.689/0.607 vs
  0.648/0.691/0.650/0.576. The full v2 formula then scored
  0.752/0.773/0.768/0.655, beating same-cohort prior WAR in every pair.
- Bonus finding: blending LEBRON *into* EPM made it worse (0.711 < 0.718). No ensemble gain.

**Decision: EPM is the core rating.** DARKO (free, public, 0.83 agreement) is the designated
fallback if D&T API access ever lapses. The individual-player disagreement table doubles as a
"most controversial listings" feature for launch content.

---

## 4. Test: the formula sweep — 20 candidate constructions

**Why.** Test 2 said "add a volume term," but there are many ways to do that, plus age terms,
shrinkage variants, offsets, ensembles. Rather than argue, enumerate and measure.

**How.** Twenty formulas, organized in families, every one run through the Section-1 protocol
(same four pairs, same target, same statistic). z(x) = z-score within that season's pool, so
different-unit features can be weighted and summed. The families and the question each asks:

| Family | Members | Question |
|---|---|---|
| Baseline | naive WAR carry | the bar to clear |
| Single metric | EPM alone; O-EPM alone; D-EPM alone | is the rating enough? which half carries signal? |
| Rating × volume | EPM×minutes; (EPM+3)×minutes; EPM shrunk k=300; k=750 | literal "total value" constructions |
| Two-feature z-blends | EPM/minutes at 70/30, 50/50, 30/70; EPM/priorWAR at 70/30, 50/50, 30/70 | how much volume, and which volume proxy? |
| Ensemble | ½z(EPM)+½z(LEBRON) | do rival metrics correct each other? |
| Age | EPM + 0.10×(25−age); EPM + 0.20×(25−age) | youth premium, two strengths |
| Multi-feature | 50/35/15 EPM/MIN/youth; 45/35/20 EPM/WARp/youth; 40/25/25/10 "kitchen sink" | the full spec structure |

**Results (mean ρ across four pairs):** kitchen sink 0.766 (beat the naive baseline in all
four pairs — the only headline requirement); WARp-heavy blends ~0.75; naive baseline 0.732;
EPM alone 0.718; O-EPM 0.652; shrunk EPM 0.636/0.608; raw EPM×minutes 0.555; **D-EPM 0.365**.

**Lessons, each one load-bearing:**

1. Every formula above the baseline mixes EPM with a volume term. Confirms test 2's diagnosis.
2. **Don't shrink EPM.** It's already a regularized Bayesian estimate; multiplying by
   min/(min+k) double-shrinks and destroys signal (0.718 → 0.636). (Shrinkage stays correct
   for *raw* metrics like LEBRON.)
3. **The offset lesson.** Raw EPM×minutes is terrible because a negative-rating player on
   heavy minutes goes hugely negative — but heavy minutes are a *positive* signal (coaches
   know things). Adding an offset first, (EPM+3)×minutes, fixes it (0.741). This vindicates
   CraftedNBA's odd-looking `(WARP + 2.15)` constant.
4. **Defense doesn't persist.** D-EPM alone predicts almost nothing (0.365); offense carries
   the signal. An FV should not pay much for defense-only reputation.
5. Youth adds a small, consistent bump as a blend component; crude age adjustments to the raw
   rating do little.

---

## 5. Test: the weight grid search + overfitting checks

**Why.** The kitchen sink won with hand-guessed weights. With four features there are
thousands of weightings; the winner should be found, not guessed — but searching that hard
over only 4 season pairs risks overfitting, so the search shipped with its own audit.

**How.** All weight combinations of {z(EPM), z(priorWAR), z(minutes), z(youth)} in 5% steps
(~1,300 valid combos, youth capped at 40%), each evaluated on mean ρ across the four pairs.
Then two guards:

- **Leave-one-out (LOO):** re-run the whole search four times, each time *excluding* one season
  pair; check the winning weights barely move and the winner still performs on the *held-out*
  pair it never saw.
- **Plateau inspection:** is the optimum a sharp spike (suspicious — likely noise) or a broad
  flat region (signal)?

**Results.** The optimum is a **broad plateau**: everything in EPM 30-45% / priorWAR 35-50% /
minutes 10-15% / youth 10-15% scores mean ρ 0.770-0.771. LOO passed: excluded-pair performance
0.72-0.80, winning weights stable. We adopted **40/35/15/10** as a clean point on the plateau.

**Honest reading:** the top ~10 combos are statistically indistinguishable. The *structure*
(quality + role + trajectory) is the finding; the exact digits are not sacred.

---

## 6. Test: the target-sensitivity attack (the user's objection)

**Why.** Mith challenged the methodology: *"If you're comparing correlation to WAR, won't
formulas that just resemble WAR win automatically?"* If true, the sweep's rankings would be
partly circular — formulas rewarded for looking like the ruler rather than for forecasting.
The objection is testable, so we tested it.

**How.** Re-run the entire 20-formula sweep three times, changing only the definition of "what
actually happened":

- **Target A:** next-season WAR (the original — value including minutes),
- **Target B:** next-season EPM (pure quality; minutes removed from the truth),
- **Target C:** next-season LEBRON (a rival metric's definition of quality).

If rankings are stable across targets, the methodology is robust. If the winner changes with
the ruler, the objection is confirmed.

**Result — the objection was confirmed.** Under target A the WAR-blends win; under target B
the winner is EPM+youth (0.835) and the volume terms stop helping; under target C the
LEBRON-ensemble wins. **Formulas structurally similar to the target float to the top of that
target's leaderboard.**

**What survived anyway:** (1) EPM stays at/near the core under every ruler; (2) time still does
real work — the *most* WAR-shaped formula possible (last WAR itself) still lost under the WAR
ruler, so forecasting genuinely adds value beyond resemblance. **What was downgraded:** the
precise volume-term weights, now understood to be partly an artifact of choosing WAR as truth.

**The deeper consequence:** "which target is correct?" is a game-design question — what does
holding a share actually *pay*? That forced test 7.

---

## 7. Test: the dividend-target test (grading against actual game payouts)

**Why.** Under the engine's economy, a share pays **surprise dividends**: after each game,
holders receive (actual − expected net points) × $/point — negative allowed. So the honest
referee for "which players were good to own" is realized dividends, not WAR. This required
real game data.

**How:**

1. Re-downloaded the full 2025-26 season from ESPN's public endpoints (1,230 game summaries,
   26,540 player-game box scores) using the repo's own deterministic fetch script.
2. **Integrity gate:** replayed the season through Engine v2 and confirmed it reproduces the
   committed backtest report *to the dollar* (net inflation −$57,174,120). Our replay was
   provably faithful before we trusted anything downstream.
3. Summed every player's per-game dividends into a realized **season dividend per share**
   (under the then-default trailing-mean expectations, window 10).
4. Scored all 20 formulas against that target (138 veterans with prior-season features;
   rookies have no N−1 data and drop out).

**Result — total inversion.** Every formula was **negatively** correlated with realized
dividends (−0.02 to −0.26), and the WAR-target champion (kitchen sink) was the *worst* at
−0.26. Last season's best players systematically *debited* their holders (Maxey −$60K/share,
Vučević −$69K/share); the money went to breakout players (Amen Thompson +$70K/share, Dyson
Daniels, Nickeil Alexander-Walker — all real 2025-26 leapers).

**Why this happens.** Trailing-mean expectations make dividends measure *within-season
improvement against your own baseline*. Established quality mean-reverts; young unknowns leap.
So quality anti-predicts surprise. Nothing predicts these payouts positively except
youth/obscurity — and listing players by *that* would be absurd.

---

## 8. Test: is the inversion a tuning bug or structural? (the window sweep)

**Why.** The trailing baseline had one free parameter — the window (how many past games the
expectation averages). Maybe a slower baseline fixes the anti-quality flow?

**How.** Re-ran the full season replay five times with expectation windows of 5, 10, 25, 41,
and 82 games, measuring ρ(prior-season quality → season dividend) each time.

**Result: structural.** ρ ≈ −0.19 to −0.23 at *every* window. No tuning escapes it: any
self-referential baseline turns dividends into a trajectory bet, and trajectory anti-correlates
with established quality.

**Consequences (the research's biggest design impact):**
1. Under that economy, owning stars was strictly dominated — they cost the most and carried
   negative expected dividends. "Never own Jokić" is a thematically broken game.
2. The fix had to be in the *expectation source*, not the FV formula: absolute, opponent-aware
   projections (Dunks & Threes) make surprise symmetric within every tier, or a hybrid
   level+surprise dividend pays quality directly.
3. The team adopted the projection fix ("Option B", Discord 7/14): cached D&T pregame
   projections are now the canonical expectation source, with a league-bias correction
   (+0.436 NP/player-game) so projections aren't systematically low, landing the season at
   ≈ −1.5% net inflation.
4. It also clarified FV's *role*: under unbiased expectations, dividends are ~zero-expectation
   for a correctly-priced player *by design*. FV's job is fair listings and a trading anchor —
   not a payout-prediction machine, because no such machine can exist in a well-calibrated
   surprise economy.

---

## 9. Test: the impact-vs-salary blend sweep (historical)

**Reproducibility note.** This section records an exploratory run whose
`nba_salaries_master.csv` input was not preserved in the repository. The table is useful
directional context, but it is not part of the reproducible headline verifier and should not be
treated as independently confirmed evidence for the exact 90/10 weight.

**Why.** The listing formula blends model value with the player's actual contract, originally
70/30 on intuition ("salary anchors fan expectations"). The weight is measurable: does salary
*add information* about future value, or just familiarity?

**How.** For three historical season pairs (2021-22→22-23 through 2023-24→24-25 — public
historical salary data ends at 2023-24, so the fourth pair sat out), price every player at
`w × model_value + (1−w) × actual_salary` for w = 100% down to 0% in 10% steps, and run each
blend through the Section-1 protocol. Salaries from `nba_salaries_master.csv` (historical,
per-season).

**Result — a clean monotonic verdict:**

| Impact/salary | mean ρ | | Impact/salary | mean ρ |
|---|---|---|---|---|
| 100/0 | 0.792 | | 50/50 | 0.744 |
| **90/10** | **0.793** | | 30/70 | 0.694 |
| 80/20 | 0.789 | | 10/90 | 0.622 |
| 70/30 (shipped v1) | 0.778 | | 0/100 (salary only) | 0.562 |

Salary adds ~nothing at 10% weight and destroys accuracy beyond it. Salary-only pricing (0.562)
is worse than every model variant — real contracts encode agent leverage, cap timing, and sunk
legacy deals, not value. The 70/30 v1 sat barely above the naive baseline (0.763); the sweep
caught a likely calibration miss. **Product decision: 90/10** — keep a whisper of real-world
anchoring while the exact sweep remains provisional until its historical salary panel and
reproducer are pinned. Heavier salary flavor can still be chosen deliberately, but the exact
accuracy cost should not be claimed as reproducible yet.

---

## 10. The synthesis test: our formula vs the standard framework, like for like

**Why.** The team was sent the canonical sports-analytics framework: *fair salary = min salary
+ WAR × ~$5M/win*, with the $5M derived from league economics (≈$4.5B of above-replacement
payroll ÷ ≈880 marginal wins). How does our formula relate?

**How.** Two steps. (a) Recognize their formula ranks players identically to last season's
WAR — meaning it *is* our naive baseline, already measured. (b) Fit our blend score to WAR
units by regression on 1,200 listed player-seasons, including players who disappeared the
following year (`projected_WAR = 1.4821 + 2.5605 × blend`). That pooled fit is the production
mapping; historical scoring excludes both the evaluated window and any successor window that
reuses its realized WAR as a prior-WAR input. Both formulas can therefore be written in the
same economic units without using the scored window's outcomes for its own clamp thresholds.

**Result.**

- Same skeleton, one different part: they price **last season's realized WAR**; we price
  **projected next-season WAR**. On the exact v2 listing cohort, prior WAR averages 0.699 rho
  while the FV component averages 0.737 and wins all four season pairs.
- The refit makes the blend dollar-calibrated on the corrected train-defined cohorts. Its
  purpose is absolute scale; rank validation is reported separately. These windows are
  retrospective model-selection evidence, not untouched holdouts.
- We adopted their best part: the **economically-derived $5M/win scale** (it independently
  reproduced our hand-calibrated prices — average player ≈ $11M vs our $12M anchor; Jokić ≈
  supermax). Their two caveats map to our design: the max-contract distortion is why our cap
  sits above the supermax, and the convex win curve is deliberately *left out* of FV so star
  scarcity gets priced by the market, where it's tradeable content.

**One sentence:** the standard formula with its one weak joint — looking backward — replaced by
a forecast that beat it in every season tested.

---

## 11. The supporting cast: unit tests (110 passing)

The experiments above are only as trustworthy as the code underneath, so the instruments are
tested separately — 110 tests across the suite. The FV-research-specific ones:

- **Formula arithmetic pinned:** baseline price at rating 0; exact $-per-0.1 slope; shrinkage
  direction (less trust in 150 minutes than 2,400, but never inverting a positive rating);
  blend betweenness (a blend must land between its inputs); floor/cap enforcement; invalid
  parameters rejected at construction.
- **Dirty-data handling:** traded players (two rows, keep the bigger-minutes stint); blank
  ratings skipped, not parsed as zero; "Dead Cap" salary rows excluded; expiring contracts
  falling back to the prior season's figure; accented/case-mismatched names joining correctly
  across files.
- **Instrument calibration:** the Spearman battery (section 0), and a zero-noise synthetic
  world where the backtest harness must report exactly ρ = 1.0 with strictly descending
  deciles — if the world is perfectly predictable, the instrument must say so. (First version
  of this test failed and taught a real lesson: ratings pushed past the $70M cap created price
  ties and ρ = 0.936 — the cap genuinely destroys ranking information among superstars.)
- **Loader round-trips:** EPM/DARKO snapshot writers and readers are inverses; empty or
  header-only cache files raise instead of silently joining as ghost data.

---

## 12. Everything we know that argues against our own answer

A research log that only records wins is marketing. The standing limitations:

1. **Four season pairs.** Every headline mean is an average of four (three, for the salary
   sweep). LOO and cross-pair consistency mitigate; differences under ~0.02 ρ should be read
   as ties.
2. **The target is LEBRON-flavored.** "Realized WAR" comes from the LEBRON dataset, so ground
   truth is itself a model output. This plausibly *understates* EPM's edge (it won while being
   graded by a rival's ruler), but a second target family would strengthen the claim.
3. **Washouts are counted as zero, but the reason is ambiguous.** The train-season cohort
   includes players who disappear the following year and assigns them zero WAR. That captures
   the holder loss, but cannot distinguish retirement, overseas play, injury, or a true talent
   collapse without a separate availability model.
4. **Rookies are out of scope by construction** (no N−1 season), and they were the old
   economy's biggest earners. They need the separate IPO/auction path.
5. **Weights are a plateau, partly target-shaped** (tests 5 and 6). Defend the structure, not
   the digits.
6. **The cap costs star resolution.** Test-proven: the $70M clamp erases ranking information
   among the very best players.
7. **~0.28 of rank disagreement is irreducible** — no formula in the sweep exceeded ~0.55
   top-30 recall. Injuries, leaps, and role shocks are not model failures; they are the
   tradeable uncertainty the game exists to price. A much better formula would arguably make
   a worse game.

---

## Appendix: file map

| Artifact | What it is |
|---|---|
| `nba_stock_market/opening_prices.py` | The listing model + CSV builder |
| `nba_stock_market/fv_validation.py` | Spearman, metric comparison, predictive backtest |
| `nba_stock_market/epm_data.py` | D&T EPM season-snapshot fetcher/loader |
| `output/opening-prices-2026-27.csv` | The 300-player listing deliverable |
| `output/fv-validation.md` | Generated three-way metric + backtest report |
| `docs/opening-price-model.md` | The production formula spec + census design |
| `tests/test_opening_prices.py`, `tests/test_fv_validation.py` | The instrument tests |
| `data/manifests/fv-inputs.json` | Pinned source versions and SHA-256 checks for every FV input |
| `scripts/prepare_fv_inputs.py` | Rebuilds the git-ignored raw-input directory and rejects provider drift |
| `data/raw/opening/` (git-ignored) | Verified LEBRON history, DARKO sheet, EPM snapshots, salaries |
| `data/raw/2025-26/` (git-ignored) | Full ESPN season cache for the dividend replay |
