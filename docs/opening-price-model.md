# Opening Price Model — season-start listing prices

Owner: Mith (team-plan item #1). Implementation: `nba_stock_market/opening_prices.py`.
Output: `output/opening-prices-2026-27.csv` (top 300 by 2025-26 minutes), which Ryan wires
into listing.

## The formula

Two steps: map an impact rating to a salary-scale dollar value, then blend with the player's
actual contract.

```
shrunk_rating   = rating × minutes / (minutes + 300)

impact_implied  = $12,000,000 + $7,000,000 × shrunk_rating
                  # a 0-rated (league average) player lists at $12M
                  # every +0.1 of rating adds $700K

opening_price   = clamp( 0.7 × impact_implied + 0.3 × actual_salary,
                         $2M floor, $70M cap )
```

| Parameter | Value | Rationale |
|---|---|---|
| Baseline (rating = 0) | $12M | ≈ real NBA mid-level; a league-average starter's salary |
| $ per rating point | $7M ($700K per 0.1) | +7 rating ⇒ ~$61M implied — supermax territory |
| Shrinkage constant | 300 minutes | Small samples pulled toward league-average; 2,000+ min ≈ face value |
| Blend weight | 70% impact / 30% salary | Impact is the signal; salary anchors fan intuition + contract value |
| Floor / cap | $2M / $70M | Min-contract floor; supermax cap |

Calibration checks against the real 2025-26 distribution (582 players): median LEBRON −0.73 →
~$6.9M (typical rotation salary ✓); Jokić +7.37 → lists $58M ✓; the tier cuts (star ≥ $30M,
mid ≥ $10M) reuse the backtest thresholds.

## Metric choice: LEBRON now, DARKO/EPM drop-in later

The metric column is a CLI flag (`--metric-column`). We use **LEBRON** today because it ships
in the same `gabriel1200/site_Data` repository as our salaries (nothing new to license or
scrape). When Russ's Dunks & Threes key lands or a DARKO feed is chosen, point the flag at the
new column and re-tune only `$/point` (DARKO/EPM have slightly different spreads than LEBRON).

## Why blend with actual salary at all?

- **Pure impact** ignores contracts: Wembanyama (+7.6, best rating in the league) would list
  at $58M even though his real cost is a $17M rookie deal. Contract value *is* value.
- **Pure salary** ignores reality: Curry earns $62M at a +3.1 rating; listing him there is a
  gift to short-sellers (and a trap for casuals).
- The 70/30 blend prices Wemby at $45.7M and Curry at $39.7M — both debatable, neither absurd.
  Debatable-but-not-absurd is exactly what an opening price should be: the market corrects the
  rest (and mispricings players can argue about are the fun).

Players missing from the salary file (mostly rookie-scale deals not yet in `salary.csv` —
80 of 300 today) list at impact-implied value alone. Improving that coverage with the
backtest's fallback salary snapshot is a known TODO.

## The community census (bounded, post-listing)

The crowd-check idea from the call, made manipulation-resistant:

1. Publish the draft CSV to the group/Discord ~2 weeks before listing.
2. Per player, collect votes: **too high / about right / too low** (one weighted vote per
   account; accounts must predate the census).
3. Compute net sentiment `s = (low_votes − high_votes) / total_votes` ∈ [−1, +1]; require a
   minimum of 10 votes, else no adjustment.
4. Apply a **bounded** nudge: `price ×= (1 + 0.15 × s)` — the crowd can move a listing at most
   ±15%, so it can fix a howler but can never set prices (that would let a coordinated group
   pre-cheapen players they intend to buy).
5. Log every adjustment next to the model price; the deltas become training data for next
   season's calibration.

The census is deliberately **not** implemented in code yet — it needs the community infra.
The engine consumes whatever CSV it is given, so the pipeline is: model CSV → census pass →
final listing CSV.

## Current output (2026-27 listings)

`output/opening-prices-2026-27.csv`: 300 players, ranked by opening price. Snapshot of the
top of the board: Jokić $58.0M, SGA $49.5M, Cade $46.6M, Wembanyama $45.7M, Luka $45.5M.
Sanity notes:

- 21 players list at "star" tier (≥$30M) — matches a ~10-player-portfolio economy where a
  $140M bankroll fits 2–3 stars plus depth.
- The backtest's dividend winners (Flagg $11.0M, Fears $3.0M, Amen Thompson $21.1M) all list
  cheap or mid — the improver-hunting game and the listing model are consistent.
- Rebuild anytime: `python -m nba_stock_market.opening_prices` (inputs cached under
  `data/raw/opening/`, git-ignored; re-download from `gabriel1200/site_Data` master).

## Validation results (see `output/fv-validation.md`)

The FV backtest protocol: build prices from season N-1 data only, score against realized
season-N WAR, across four historical season pairs. Findings:

1. **Rate-only pricing loses to a naive "carry last season's WAR" baseline in all four
   pairs** (price→WAR Spearman ~0.52–0.58 vs ~0.67–0.77). WAR carries minutes/role
   information that a per-possession rating lacks. **Recommendation: v1.1 should add a
   minutes/role term to `impact_implied`** (the spec's `w2` factor) — e.g. blend shrunk
   rating with prior-season WAR — then re-run this backtest until the model at least matches
   the naive baseline.
2. **LEBRON and DARKO agree broadly (rating rho 0.749, 516 shared players) but diverge
   hugely on individuals** (mean price gap $4.5M; Derrick White $18M apart). Metric choice
   is a real gameplay decision, not a detail — the disagreement list doubles as a
   "controversial players" preview.
3. **EPM** slots into the same harness once the Dunks & Threes key arrives
   (`load_epm_rows` is stubbed with the endpoint recorded).

## Open questions for the group

1. **Blend weight** — is 70/30 right, or should opening lean harder into impact (more
   "correct", fewer arguments) vs salary (more familiar, more mispricings to trade)?
2. **Age term** — deliberately omitted in v1. A youth premium (e.g. +$1M per year under 24,
   −$1M per year over 31, capped ±$5M) would price trajectory into listings; but dividends
   already reward improvers, so it may be double-counting. Decide after the D&T backtest rerun.
3. **Rookies with no NBA data** (2026 draft class) are absent by construction — they need the
   IPO path (model-seed from college data + opening auction) per the build spec, not this model.
