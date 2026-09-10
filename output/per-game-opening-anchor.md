# Exploratory opening-anchor residuals (gross NP per observed game)

Candidate constants were proposed from historical exploration, not a sealed holdout. No winner, uplift, rate or live-price rule is approved here. Fees, floors, portfolio constraints and market impact are absent.

Before each season, the pool is the prior season's top 150 by appearances with at least 20 games. A player enters on their first recorded game only when that game's saved projection exists; the following week's projections are never used. All formulas use the same eligible player-games. Projection cache dates are assumed pregame and do not independently prove original publication time.

## 2023-24 -> 2024-25

Prior-defined pool 150; common covered players 148; no current games 2; no first-game projection 0. Tiers use prior-season means. Common observed player-games 9,302.

| Formula | Superstar | Star | Starter | Rotation | Bench | Pooled | at $20K | Worst observed tier |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| last | -0.95 | -0.70 | -0.71 | +0.54 | +1.33 | -0.028 | $-551 | +1.33 |
| last+0.75 | -1.70 | -1.45 | -1.46 | -0.21 | +0.58 | -0.778 | $-15,551 | -1.70 |
| last*1.08 | -2.86 | -2.05 | -1.59 | +0.00 | +1.01 | -0.852 | $-17,033 | -2.86 |
| proj | +4.50 | +2.09 | +1.43 | +2.12 | +2.45 | +2.081 | $+41,612 | +4.50 |
| blend | +1.77 | +0.69 | +0.36 | +1.33 | +1.89 | +1.027 | $+20,530 | +1.89 |
| blend+0.4 | +1.37 | +0.29 | -0.04 | +0.93 | +1.49 | +0.627 | $+12,530 | +1.49 |

## 2024-25 -> 2025-26

Prior-defined pool 150; common covered players 143; no current games 7; no first-game projection 0. Tiers use prior-season means. Common observed player-games 8,534.

| Formula | Superstar | Star | Starter | Rotation | Bench | Pooled | at $20K | Worst observed tier |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| last | -1.47 | -0.56 | +0.13 | +0.43 | +0.78 | +0.203 | $+4,051 | -1.47 |
| last+0.75 | -2.22 | -1.31 | -0.62 | -0.32 | +0.03 | -0.547 | $-10,949 | -2.22 |
| last*1.08 | -3.72 | -1.89 | -0.79 | -0.10 | +0.48 | -0.558 | $-11,150 | -3.72 |
| proj | +6.48 | +2.82 | +2.54 | +2.00 | +2.12 | +2.374 | $+47,482 | +6.48 |
| blend | +2.50 | +1.13 | +1.33 | +1.22 | +1.45 | +1.288 | $+25,766 | +2.50 |
| blend+0.4 | +2.10 | +0.73 | +0.93 | +0.82 | +1.05 | +0.888 | $+17,766 | +2.10 |

## Combined observed player-games (weighted by observation count)

| Formula | Player-games | Mean gross residual | at $20K/game |
|---|---:|---:|---:|
| last | 17,836 | +0.083 | $+1,651 |
| last+0.75 | 17,836 | -0.667 | $-13,349 |
| last*1.08 | 17,836 | -0.711 | $-14,218 |
| proj | 17,836 | +2.221 | $+44,420 |
| blend | 17,836 | +1.152 | $+23,036 |
| blend+0.4 | 17,836 | +0.752 | $+15,036 |

## Earlier-pair selection illustration

Selection minimizes absolute pooled drift on completed earlier pairs only. The current pair never selects its own formula. Because the candidate set itself was historically explored, this is not independent validation.

| Evaluated pair | Formula chosen from earlier pairs | Current-pair residual |
|---|---|---:|
| 2023-24 -> 2024-25 | calibration only | not evaluated |
| 2024-25 -> 2025-26 | last | +0.203 |
