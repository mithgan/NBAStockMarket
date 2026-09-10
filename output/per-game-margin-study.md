# Team-margin fit and descriptive pricing diagnostics

This regression uses final box scores to describe same-game team margin; it is not a pregame forecast or identified individual impact estimator. ESPN's saved summaries separately contain raw player plus-minus. No dollar rate, price floor, fees, roster policy or live provider capability is validated here.

## 1. Fitted margin weights (train 2023-24 + 2024-25, 4,920 team-games)

| Stat | Weight (margin pts per unit) | Old NetPoints weight |
|---|---:|---:|
| pts | +0.877 | +1.00 |
| fga | -1.438 | -0.70 |
| fta | -0.681 | -0.40 |
| oreb | +1.471 | +0.70 |
| dreb | +1.516 | +0.30 |
| ast | -0.012 | +0.70 |
| stl | +1.755 | +1.50 |
| blk | +0.421 | +1.00 |
| tov | -1.386 | -1.00 |
| three_pm | +0.017 | +0.10 |
| intercept (fit only, not applied) | -20.56 | — |

Only the fitted regressors are tabulated; the complete engine comparison also includes FGM, FTM, three-point attempts and minutes.
The intercept is used in the team prediction. The player tables below use only the uncentered linear component; its zero point is not calibrated individual margin impact.

Held-season same-game association (2025-26, 2,460 team-games): fitted vs actual margin correlation **r = 0.876**, RMSE 7.970 points. Correlation alone does not establish calibration, attribution or statistical equivalence to another metric.

## 2. Retrospective player means and uncentered score scale

The top-150 cohort uses completed-season appearance counts. It describes this sample and is not a pregame listing rule or unrestricted league ranking.

Player-season means (2025-26, 150 listed players): metric SD 3.55 margin-pts vs old-NP SD 4.50; Pearson correlation between player means **r = -0.080** (not a rank correlation).

**38 of 150 sampled players have nonpositive uncentered season means**; engine means: 0 nonpositive. These are observed means, not expected causal impact or a validated floor policy.

| Player | Margin-NP/game | Old NP/game |
|---|---:|---:|
| Rudy Gobert | +14.86 | 11.60 |
| Donovan Clingan | +13.42 | 12.74 |
| Moussa Diabate | +11.48 | 8.95 |
| Jalen Duren | +11.40 | 18.09 |
| Neemias Queta | +11.05 | 10.93 |
| Kel'el Ware | +10.96 | 10.57 |
| Karl-Anthony Towns | +10.13 | 16.48 |
| Deandre Ayton | +9.38 | 10.84 |

## 3. Gross quote residuals after a three-game warmup (uncentered score)

Prices use strictly prior dates. Warmup games are excluded. No fees or floor are applied; training-season rows are in-sample diagnostics under the fitted weights.

| Season | frozen at open | weekly requote | nightly full |
|---|---:|---:|---:|
| 2023-24 | +0.116 | +0.020 | +0.005 |
| 2024-25 | +0.475 | +0.025 | +0.016 |
| 2025-26 | +0.485 | +0.048 | +0.031 |

## 4. Prior-season mean residual and chronological uplift diagnostic

| Season pair | Raw drift/game | Uplift from earlier transitions | Residual after earlier uplift |
|---|---:|---:|---:|
| 2023-24 → 2024-25 | +0.298 | not available | calibration only |
| 2024-25 → 2025-26 | +0.257 | +0.298 | -0.041 |

The current transition never enters its own uplift. Historical cohorts remain retrospective and the first transition is within the model's fitting period; these two pairs do not validate a production uplift or a multiplicative alternative.

## 5. Prior-only fixed-roster residuals and dollar sensitivity

Entry date 2025-10-31: pool chosen by prior appearances, ranking and fixed cost proxies from strictly earlier mean scores (at least three games). No final-season ranking or mean sets these locks.
These are gross research residuals, not the full game ledger: no signing fees, price floor, market impact, roster changes or budget constraint. Dollar rows only multiply the same path by a rate; none is approved.

| Roster | Night SD | Night abs-p95 | Week SD | Week abs-p95 | Season total (score units) |
|---|---:|---:|---:|---:|---:|
| high prior mean | 13.1 | 28.0 | 30.3 | 90.7 | -973.4 |
| middle prior mean | 9.6 | 20.7 | 22.6 | 52.6 | -428.1 |

| Rate | Highest prior cost proxy | Night abs-p95 | Week abs-p95 | p05 positive prior cost | p05 at least $25K? |
|---|---:|---:|---:|---:|:---:|
| $10K | $163,459 | $206,876 | $525,980 | $3,855 | no |
| $15K | $245,189 | $310,314 | $788,971 | $5,783 | no |
| $20K | $326,919 | $413,752 | $1,051,961 | $7,711 | no |
| $25K | $408,649 | $517,190 | $1,314,951 | $9,639 | no |
| $30K | $490,378 | $620,628 | $1,577,941 | $11,566 | no |
| $40K | $653,838 | $827,504 | $2,103,922 | $15,422 | no |
| $50K | $817,297 | $1,034,381 | $2,629,902 | $19,277 | no |

## 6. Gross inverse-score residuals (7-calendar-day windows)

Retrospective player cohort; each window uses prior-date trailing means. These are independent player windows, not a short-roster strategy; fees, floors, slot limits, DNP rules and early-close policy are absent.

3,031 windows: mean -0.18, SD 11.7 margin-pts, win rate 50.3%.
