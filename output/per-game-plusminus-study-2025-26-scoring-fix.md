> Corrected scoring, 2025–26 subset only. Historical cross-season sections are intentionally empty. This is not the full three-season study.

# On-court plus-minus as the dividend basis

- 2025-26: extracted 26,640 player-game +/- values, joined 26,547/26,547 log rows (100.0%).

## 1. Split-half reliability (the skill ceiling, 2025-26 listed players)

Correlation between each player's odd-game and even-game season mean —
how much of what you pay for tonight is a repeatable trait vs dice:

| Metric | Split-half r | Per-game SD around player mean |
|---|---:|---:|
| old NetPoints | 0.945 | 6.65 |
| margin-fit box | 0.953 | 5.23 |
| raw +/- | 0.678 | 12.34 |

## 2. Scale and the negative-value problem (raw +/-)

Listed players with a season mean: 150. **52 (35%) have ≤0 expected value** (old NP: 0). Season-mean SD 3.56; top of market: Shai Gilgeous-Alexander +11.6, Chet Holmgren +9.8, Derrick White +7.8, Julian Champagnie +7.2, Duncan Robinson +7.0.

## 3. Requote leak per settled game (raw +/-, all seasons)

| Season | frozen at open | weekly requote | nightly full |
|---|---:|---:|---:|
| 2025-26 | +0.148 | +0.106 | +0.076 |

## 4. YoY opening drift (lock at prior-season mean +/-)


## 5. User P&L bands and rate sweep (raw +/-)

- stars: night SD 37.3 / p95 74.6; week SD 99.6 / p95 197.8 (margin-pts).
- balanced: night SD 26.4 / p95 52.2; week SD 76.2 / p95 130.7 (margin-pts).

| Rate | Star cost/game | Night p95 | Week p95 | p05 positive player | Floor OK |
|---|---:|---:|---:|---:|:---:|
| $10K | $115,882 | ±$521,958 | ±$1,307,049 | $1,828 | no |
| $15K | $173,824 | ±$782,937 | ±$1,960,573 | $2,741 | no |
| $20K | $231,765 | ±$1,043,916 | ±$2,614,098 | $3,655 | no |
| $25K | $289,706 | ±$1,304,895 | ±$3,267,622 | $4,569 | no |
| $40K | $463,529 | ±$2,087,832 | ±$5,228,195 | $7,310 | no |

## 6. Shorts (7-day windows, raw +/-)

3,138 windows: mean -0.33, SD 26.9 margin-pts, win rate 50.0%.
