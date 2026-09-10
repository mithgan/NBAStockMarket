# Scoring comparisons and held-cost repricing

Updated September 10, 2026 after review of all ten per-game research scripts. This replaces the earlier settings recommendation. The scoring engine and production economy rules are unchanged.

## What the scoring comparisons establish

The three engine comparisons now use the engine's complete box score, including the minutes deduction and three-point attempts. Across 2023–24, 2024–25 and 2025–26, the recovered input contains 79,036 player-game records. Each comparison agrees with the existing `NetPointsModel` on every record.

For 2025–26, the engine endpoint has same-game team-margin correlation 0.963, odd/even player-mean correlation 0.945, unscaled team-difference RMSE 16.030, and margin-on-score slope 0.508. These describe different properties. Correlation is unchanged by positive rescaling and cannot establish a dollar conversion rate, individual causal impact, or an appropriate player-score zero point. Odd/even correlation measures aggregate repeatability; it does not measure a trading skill ceiling.

The separate margin regression fits 2023–24 and 2024–25 on 4,920 team-games. Its 2025–26 same-game correlation is 0.876 and RMSE 7.970. Its team prediction includes an intercept, but the experimental player score omits that intercept. The resulting player zero point is not identified. Neither this fit nor a blend is adopted as a new game rule.

Raw plus-minus joins every recorded player-game in all three seasons. This confirms the saved ESPN data coverage; it makes no claim about another provider's current live endpoints. See the [margin report](../output/per-game-margin-study.md), [plus-minus report](../output/per-game-plusminus-study.md) and [blend report](../output/per-game-blend-sweep.md).

## What changed in the repricing experiment

The replay now chooses its 150-player universe and fixed-roster rankings using information recorded strictly before entry on November 4, 2025. Calibration games do not generate returns. Add quotes use earlier actuals or an available dated forecast; held positions retain their cost until a scheduled change. Every actual opening incurs the modeled $10,000 fee, including reopened positions, and quotes respect the $25,000 floor. The rate remains an experimental $20,000 per NetPoint.

| Weekly change regime | Scout net result | Random mean, 10 seeds | Scout minus random mean | Random seeds beaten |
|---|---:|---:|---:|---:|
| Locked | -$582,923 | -$676,934 | +$94,011 | 4/10 |
| 5% cap | -$1,178,358 | -$661,085 | -$517,273 | 4/10 |
| 10% cap | -$1,589,822 | -$636,115 | -$953,707 | 3/10 |
| 25% cap | -$2,363,967 | -$601,925 | -$1,762,042 | 2/10 |
| Full change | -$3,144,623 | -$654,066 | -$2,490,557 | 2/10 |

The previous recommendation to adopt a 5–10% cap does not follow from this corrected sample. The modeled scout loses money in every regime and falls below the random mean with each tested cap. This also does not prove that every scouting policy or every cap would perform poorly: these are specific retrospective traces, ten random seeds, and a partial game policy. Random dispersion, gross flow and fee totals are shown in the [full repricing report](../output/per-game-repricing-test.md).

## Limits and decision

Historical forecasts have recorded game dates but no verified original publication or revision timestamps. Forecast-based results assume the stored values were available before the corresponding game. Real budget constraints, demand, market impact and user behavior are not fully simulated. A successful research run therefore does not approve the scoring basis, rate, opening uplift, cap or short duration for production.

Use the corrected scripts and reports as reproducible research inputs. Any adoption decision needs a fully specified policy and evaluation on data reserved from candidate selection. The [review record](per-game-research-review.md) lists corrections and verification evidence.
