# Opening Price Model — season-start listing prices

Owner: Mith (team-plan item #1). Implementation: `nba_stock_market/opening_prices.py`
(`ProjectedWarModel`). Output: `output/opening-prices-2026-27.csv` (top 300 by prior-season
minutes), which Ryan wires into listing. The full experimental record behind every choice here
is `docs/fv-research-log.md`.

## The formula (v2 — validated)

```
blend         = 0.40*z(EPM) + 0.35*z(prior WAR) + 0.15*z(minutes) + 0.10*z(25 - age)

projected_WAR = 1.4821 + 2.5605 * blend    # refit on 1,200 listed player-seasons

fair_value    = $1.2M + projected_WAR * $5M
                (min salary)   (market price of one win above replacement)

listing       = clamp(0.9 * fair_value + 0.1 * actual_salary,  $2M, $70M)
```

All inputs are prior-season only; z-scores are computed within that season's player pool.
Players missing a salary row (mostly rookie-scale deals) list at fair value alone.

| Component | Why (each earned its seat by measurement) |
|---|---|
| EPM core (40%) | Matched or beat LEBRON on the same 300-player cohort in all four corrected backtest season pairs; agrees most with DARKO (0.83). Blending LEBRON in made it *worse* in the exploratory sweep. |
| Prior WAR + minutes (35% + 15%) | A rate-only price lost to the naive "carry last WAR" baseline every year — role size is a coach's decision that persists and a per-possession rating can't see. |
| Youth (10%) | Small, consistent gain (+0.01-0.02 rho) in every configuration tested. Kept small to avoid double-counting the dividend economy's improver rewards. |
| `1.4821 + 2.5605x` fit | Converts the blend to WAR units. It is fit on the same top-300-by-minutes cohort that production lists, while full-pool z-scores are retained. |
| $1.2M + $5M/win | The standard sports-economics scale (~$4.5B above-replacement payroll / ~880 marginal wins). Independently reproduces our hand-calibrated anchors (average player ≈ $11M; Jokic ≈ supermax) and self-updates as the cap grows. |
| 90/10 salary blend | The historical sweep was monotonic: salary adds ~nothing at 10% weight and destroys accuracy beyond it (salary-only rho 0.56). 90/10 is the empirical peak; the shipped v1 70/30 was measurably too salary-heavy. |
| $2M floor / $70M cap | Min contract and above-supermax. Note: the cap provably erases ranking information among the very top players — it is a legibility choice with a known cost. |

**Headline validation:** retrospective model-selection evidence across four season pairs
(2021-22→2022-23 through 2024-25→2025-26, 300 listed players each), Spearman rho
0.655-0.772 (mean 0.737) vs realized next-season WAR, beating the same-cohort naive
carry-forward baseline (mean 0.699) in **every** pair. These are not untouched holdouts: the
weights and WAR mapping were selected using these windows. The cohort is defined entirely by
the train season; players absent the following season receive
zero WAR, so retirement and washout risk are counted instead of filtered away. The weights
sit on a broad plateau — defend the structure (quality + role + trajectory, converted to
wins, priced at market rate), not the digits.

The historical table validates the fair-value ranking before the 10% salary blend because a
complete season-aligned salary panel is not part of the reproducible verifier. The 90/10 blend
is supported by the separate historical salary sweep; it is not included in the headline rho.

## Metric choice: EPM primary, DARKO fallback

EPM comes from the Dunks & Threes API (`nba_stock_market/epm_data.py`, key via `DNT_API_KEY`
in `.env`, season-end snapshots cached under `data/raw/opening/`). If access ever lapses,
DARKO (free public sheet, 0.83 rank agreement with EPM) is the drop-in replacement; LEBRON is
retained as a third opinion and as the WAR/minutes/age source.

The v1 single-metric linear pricer (`OpeningPriceModel`, `--legacy-linear`) is kept as the
comparison pricer used by `fv_validation` and as a fallback needing no EPM data.

## What FV is for (and what it is not for)

Under the Option B economy (bias-corrected D&T projections), dividends are ~zero-expectation
for a correctly-priced player *by design*. FV's job is **fair listings and a trading anchor**
— not payout prediction, because no quality-based signal can predict a well-calibrated
surprise economy (measured: under the old trailing-baseline economy, every quality formula
anti-predicted dividends at rho ≈ −0.2; that finding drove the Option B switch). The ~0.28 of
ranking error no formula could remove — the leaps and the cliffs — is the tradeable
uncertainty the game runs on.

## The community census (bounded, post-listing)

The crowd-check from the call, made manipulation-resistant:

1. Publish the draft CSV to the group/Discord ~2 weeks before listing.
2. Per player, collect votes: **too high / about right / too low** (one weighted vote per
   account; accounts must predate the census).
3. Net sentiment `s = (low − high) / total` in [−1, +1]; minimum 10 votes, else no adjustment.
4. Bounded nudge: `price *= (1 + 0.15 * s)` — the crowd can move a listing at most ±15%, so it
   can fix a howler but never set prices (unbounded voting lets a coordinated group pre-cheapen
   players they intend to buy).
5. Log every adjustment beside the model price; the deltas are next season's calibration data.

Not implemented in code — the engine consumes whatever CSV it is given, so the pipeline is:
model CSV → census pass → final listing CSV.

## Current output (2026-27 listings)

`output/opening-prices-2026-27.csv`: 300 players, full EPM coverage, ranked by opening price.
It is the canonical source for the current top-of-board prices; the app snapshot is generated
from it rather than maintaining a second manual list. Columns include `epm`, `prior_war`,
`projected_war`, and `fair_value` next to the listing price, so the
fair-value-vs-salary surplus ("most underpaid players") is readable straight off the file.

Rebuild anytime: `python scripts/prepare_fv_inputs.py` then
`python -m nba_stock_market.opening_prices`. Raw inputs remain git-ignored, while
`data/manifests/fv-inputs.json` pins the site_Data commit and content hashes every public/EPM
snapshot. Mutable DARKO/EPM bytes are archived under `data/snapshots/fv/`; live refresh is a
separate explicit check, so provider drift cannot make a historical rebuild impossible.

## Open questions for the group

1. **The $70M cap** — keep for salary legibility, or lift so superstar surplus is priced?
   (Measured cost: rank information among the top handful of players.)
2. **Rookies** (no prior season) are absent by construction — they need the IPO path
   (model-seed from college data + opening auction) per the build spec, not this model.
3. **Census mechanics** — which platform, vote weighting, and whether the ±15% bound is right.
