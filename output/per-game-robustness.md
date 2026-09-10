# Per-game economy v2 — cross-season robustness battery

Descriptive cohorts: retrospective top 150 per season by full-season projected-game count (2023-24: 150 players / 11,316 games, 2024-25: 150 players / 11,158 games, 2025-26: 150 players / 11,108 games). Dollar figures at $20K/NP are illustrative, not rate recommendations. R3 uses a separate prior-only cohort. Saved projections are assumed available on their dated game; cache retrieval does not independently prove historical publication time.

## R1. Anchor leak per settled game, all seasons (NP)

| Season | Games | trailing-10 requote | game-day projection |
|---|---:|---:|---:|
| 2023-24 | 11,316 | +0.163 ($+3,250) | +0.271 ($+5,419) |
| 2024-25 | 11,158 | +0.231 ($+4,615) | +0.463 ($+9,261) |
| 2025-26 | 11,108 | +0.199 ($+3,988) | +0.276 ($+5,523) |

## R2. Prior-season mean residuals in the retrospective cohort

Lock every listed player at his PRIOR season's produced NP/game (20+ games played there), then measure mean(actual − locked) per observed game. Tiers use the prior mean. Current-season cohort is retrospective; this is not a full game ledger.

| Season pair | Players covered | Superstar | Star | Starter | Rotation | Bench | All (NP) | All at $20K |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 2023-24 → 2024-25 | 129/150 | -0.59 | -0.15 | +0.42 | +0.88 | +1.44 | +0.650 | $+13,000/game |
| 2024-25 → 2025-26 | 128/150 | -0.97 | +0.19 | -0.08 | +0.66 | +2.79 | +0.860 | $+17,208/game |

Coverage gap = rookies/returners without a 20-game prior season; they need a separately evaluated entry rule; no premium is selected here.

## R3. Prior-only fixed-roster gross residuals ($20K illustration)

Pool, rankings and fixed mean-cost proxies use only dates before entry (the 11th observed game date; at least three prior observations). No final-season means, projections after entry, signing fees, floors or later trades enter this diagnostic.

| Season | Roster | Season residual | Night SD | Night abs-p95 | Week SD | Week abs-p95 |
|---|---|---:|---:|---:|---:|---:|
| 2023-24 | middle prior mean | $+17,756,100 | $276,963 | $580,300 | $646,126 | $1,552,818 |
| 2023-24 | high prior mean | $-3,826,300 | $387,706 | $731,230 | $902,790 | $1,769,210 |
| 2023-24 | random x10 | mean $+11,270,793 (SD $14,467,974) | $313,368 | $653,533 | $982,484 | $2,168,910 |
| 2024-25 | middle prior mean | $+14,614,200 | $286,757 | $544,880 | $709,163 | $1,555,773 |
| 2024-25 | high prior mean | $-44,940,800 | $371,276 | $955,150 | $1,011,975 | $3,797,550 |
| 2024-25 | random x10 | mean $+4,553,953 (SD $13,434,989) | $307,805 | $634,500 | $902,199 | $1,753,140 |
| 2025-26 | middle prior mean | $+13,380,267 | $317,231 | $729,617 | $687,397 | $1,502,738 |
| 2025-26 | high prior mean | $-51,647,500 | $376,909 | $966,280 | $925,641 | $3,333,295 |
| 2025-26 | random x10 | mean $+5,483,443 (SD $15,644,430) | $312,953 | $612,653 | $989,896 | $2,087,133 |

## R4. Gross inverse residuals at prior trailing/projected quotes (7-calendar-day windows)

| Season | Windows | Mean P&L | SD | Win rate | Prior quote at least 20 NP after January 15 mean | its win rate |
|---|---:|---:|---:|---:|---:|---:|
| 2023-24 | 3,176 | $-13,941 | ±$310,386 | 49.4% | $+128,853 (115 windows) | 64.3% |
| 2024-25 | 3,169 | $-19,718 | ±$301,376 | 48.1% | $+116,929 (73 windows) | 60.3% |
| 2025-26 | 3,143 | $-18,120 | ±$294,336 | 48.7% | $+234,662 (29 windows) | 82.8% |

These enumerate complete seven-calendar-day player windows in a retrospective cohort, not random or capacity-limited user portfolios. Quotes use earlier actuals once three exist, otherwise the first available dated pregame projection. The high-quote subset is classified at window entry, not from the final season. Means and win shares are observed gross residuals; no statistical edge, zero-EV guarantee or net-of-fee strategy is established.

## R5. Quote-cadence gross residuals after first available projection

| Season | Observations | frozen at entry | weekly full | half-step each league game date | full each league game date |
|---|---:|---:|---:|---:|---:|
| 2023-24 | 11316 | +2.440 ($+48,796) | +0.207 ($+4,149) | +0.181 ($+3,621) | +0.163 ($+3,250) |
| 2024-25 | 11158 | +2.792 ($+55,845) | +0.276 ($+5,512) | +0.251 ($+5,010) | +0.231 ($+4,615) |
| 2025-26 | 11108 | +2.947 ($+58,944) | +0.262 ($+5,247) | +0.222 ($+4,434) | +0.199 ($+3,988) |

A saved projection is available only on its recorded pregame date; earlier games are excluded rather than backfilled. Updates occur on league game dates even when this player has no game; weekly updates occur on the first such date of an ISO week. If no quote or fewer than three prior actuals are available then, the weekly update is skipped until the next week; warmup completion does not trigger a midweek update. Residual means are descriptive and can change sign or size by season. This does not establish a money-printer claim, quote fairness, or a preferred cadence.

## R6. Realized path risk ($20K illustration; not retention probability)

| Season | Roster | Down after 7 calendar days? | Down after 28 calendar days? | Full-path max drawdown | 28-day window p50 | p95 |
|---|---|---|---|---:|---:|---:|
| 2023-24 | balanced | no | no | $1,155,500 | $768,267 | $1,155,500 |
| 2023-24 | stars | no | no | $8,640,900 | $1,501,350 | $4,295,100 |
| 2024-25 | balanced | no | no | $1,066,800 | $808,033 | $965,070 |
| 2024-25 | stars | yes | yes | $44,940,800 | $7,458,900 | $9,512,480 |
| 2025-26 | balanced | no | no | $1,684,467 | $771,750 | $1,389,012 |
| 2025-26 | stars | yes | yes | $51,647,500 | $9,018,500 | $11,931,430 |

Days are elapsed calendar days from entry, including dates without games. Each drawdown includes loss from the zero starting balance. Quantiles describe complete rolling 28-calendar-day windows sampled every 14 days; overlapping windows are not independent trials or retention probabilities.
