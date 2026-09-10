# Per-game economy v2: reviewed findings

Updated September 10, 2026. This document supersedes the earlier claim that the constants were ready for the live ruleset. The review corrected research calculations and regenerated their evidence; it does not change production economy rules.

## Supported findings

- Engine comparisons use the same complete box score as the game. Older reported reliability and margin comparisons omitted scoring inputs; use the refreshed reports.
- Actionable-looking roster replays choose their universe, ranks and opening information before evaluation. Other completed-season cohorts remain explicitly descriptive. Participation-aware streaming is labeled as an oracle diagnostic.
- The $10,000 signing fee is charged for each actual add in the ledger studies. Gross residual reports explicitly exclude fees or floors. A dollar-rate change with fixed fees and floors must be replayed; net results cannot simply be scaled.
- Prior-season opening experiments use actual earlier-season data. Current-season outcomes cannot stand in for a prior season. Opening candidates share a common eligible sample; missing forecasts and sample exclusions are reported.
- Calendar risk includes zero-return days and initial losses. Short-duration reports exclude incomplete ending windows, and variable-length per-game dispersion uses each window's actual average.

## Decisions the evidence does not support

There is no validated production constant set from these studies. In particular, the prior $20,000 rate,1.08 opening multiplier, rookie adjustment and 5–10% weekly cap recommendations are withdrawn as conclusions of this research.

The rate screen now checks every stated condition, including the minimum player's retrospective value rather than only the fifth percentile. None of its tested rates passes every condition. This screen is a declared diagnostic and does not itself define the correct game design.

The corrected repricing experiment also changes the previous favorable cap result. Its scout loses money in each regime and performs below the ten-seed random mean at every tested cap. See [scoring and repricing findings](per-game-margin-and-repricing.md) for the measured comparison and scope.

Opening candidates were explored on these historical season pairs. Earlier-pair selection prevents the current pair from selecting its own parameter, but it does not turn previously examined data into a sealed holdout. Team-margin correlation and odd/even repeatability likewise cannot identify individual impact, fairness, an exchange rate or user skill.

## Evidence index

| Research question | Generated report |
|---|---|
| Matched forecast residuals, churn and short windows | [Balance study](../output/per-game-balance-study.md) |
| Rate conditions and descriptive dollar sensitivity | [Rate study](../output/per-game-rate-study.md) |
| Actual prior-season opening drift | [Lock drift](../output/per-game-lock-drift.md) |
| Prior-season anchors with fees and floors | [Corrected user P&L](../output/per-game-user-pnl-corrected.md) |
| Chronology, cadence and calendar risk | [Robustness](../output/per-game-robustness.md) |
| Common-cohort opening candidates | [Opening anchors](../output/per-game-opening-anchor.md) |
| Same-game team fit and uncentered player scores | [Margin study](../output/per-game-margin-study.md) |
| Observed raw plus-minus comparisons | [Plus-minus](../output/per-game-plusminus-study.md) |
| Correlation, calibration and score blending | [Blend sweep](../output/per-game-blend-sweep.md) |
| Held-cost changes and complete add-fee accounting | [Repricing](../output/per-game-repricing-test.md) |

The three-season raw sample contains 79,036 player-game records across 3,690 regular-season games. Available historical name variants are matched to verified NBA IDs at the forecast lookup boundary. Null or unavailable forecasts remain unavailable. The saved forecast dates establish date ordering; original publication and revision times remain unverified.

See the [review record](per-game-research-review.md) for verification and reproduction. These reports are conditional research scenarios, not forecasts of normal users' profits or validation of the full production backend.
