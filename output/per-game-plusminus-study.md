# Descriptive on-court plus-minus diagnostics

- 2023-24: extracted 26,498 player-game +/- values, joined 26,283/26,283 log rows (100.0%).
- 2024-25: extracted 26,373 player-game +/- values, joined 26,206/26,206 log rows (100.0%).
- 2025-26: extracted 26,640 player-game +/- values, joined 26,547/26,547 log rows (100.0%).

## 1. Odd/even season-mean repeatability (2025-26 retrospective cohort)

Correlation between each player's odd-game and even-game season mean measures repeatability of aggregates.
This is not next-game prediction accuracy or a skill ceiling. Cohort uses final-season appearance counts, and each metric is measured on the same joined player-game rows.

| Metric | Split-half r | Per-game SD around player mean |
|---|---:|---:|
| old NetPoints | 0.945 | 6.65 |
| margin-fit box | 0.953 | 5.23 |
| raw +/- | 0.678 | 12.34 |

## 2. Observed player means and scale (raw +/-)

Listed players with a season mean: 150. **52 (35%) have nonpositive observed season means**. Season-mean SD 3.56; top of market: Shai Gilgeous-Alexander +11.6, Chet Holmgren +9.8, Derrick White +7.8, Julian Champagnie +7.2, Duncan Robinson +7.0.
Observed player means range from -9.10 to +11.59, a width of 20.69. Residual SD around a full-season mean is not a decomposition of irreducible noise.

## 3. Gross quote residuals after three strictly prior games

Warmup games are not scored against their own mean. Retrospective cohort; no fees or price floor applied.

| Season | frozen at open | weekly requote | nightly full |
|---|---:|---:|---:|
| 2023-24 | +1.048 | +0.145 | +0.105 |
| 2024-25 | +0.328 | +0.092 | +0.065 |
| 2025-26 | +0.154 | +0.111 | +0.079 |

## 4. YoY opening drift (lock at prior-season mean +/-)

- 2023-24 → 2024-25: +0.587 margin-pts/game over 9,593 games.
- 2024-25 → 2025-26: +0.872 margin-pts/game over 9,495 games.

## 5. Prior-only fixed-roster gross residuals and dollar sensitivity

Entry date 2025-10-31. Pool uses appearances before entry; ranking and fixed cost proxies use strictly earlier means with at least three observations. No full-season mean or rank sets these locks.
No signing fees, price floor, budget, market impact or subsequent trading is simulated. These are research residuals, not full-policy user P&L or a recommended rate.

- high prior mean: night SD 46.8 / abs-p95 128.7; week SD 107.0 / abs-p95 438.8; season -6871.0 (score units).
- middle prior mean: night SD 24.3 / abs-p95 56.2; week SD 57.1 / abs-p95 181.3; season -2254.9 (score units).

| Rate | Highest prior cost proxy | Night abs-p95 | Week abs-p95 | p05 positive prior cost | p05 at least $25K? |
|---|---:|---:|---:|---:|:---:|
| $10K | $204,000 | $561,667 | $1,812,683 | $4,650 | no |
| $15K | $306,000 | $842,500 | $2,719,025 | $6,975 | no |
| $20K | $408,000 | $1,123,333 | $3,625,367 | $9,300 | no |
| $25K | $510,000 | $1,404,167 | $4,531,708 | $11,625 | no |
| $40K | $816,000 | $2,246,667 | $7,250,733 | $18,600 | no |

## 6. Gross inverse-score residuals (7-calendar-day windows)

Independent player windows in the retrospective cohort; not a short-roster strategy. Fees, floors, slot limits, DNP rules and early-close policy are absent.

3,031 windows: mean -0.25, SD 27.1 margin-pts, win rate 50.2%.
