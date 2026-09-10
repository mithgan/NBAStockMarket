# Scoring-margin impact — metric fit and rebalanced economy

> Historical report: current-engine scoring comparisons below predate the September 10 correction and are superseded. These numbers and related recommendations have not been fully regenerated. See the [correction and available-data results](../docs/per-game-scoring-parity-fix.md).

**Data reality check:** no pipeline source carries per-player on-court plus-minus (ESPN cache, BDL /stats, and BDL /box_scores were all inspected). Team scores + affiliations exist everywhere, so this study fits box-score weights TO team scoring margin (BPM family) — the implementable version of Russ's ask. If he means literal on-court +/-, that needs a new provider field before anything can settle on it.

## 1. Fitted margin weights (train 2023-24+2024-25, 9,832 team-games)

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

Out-of-sample validation (2025-26, 2,460 team-games): predicted vs actual margin correlation **r = 0.876**.

## 2. Scale, ranking shift, and the negative-value problem

Player-season means (2025-26, 150 listed players): metric SD 3.55 margin-pts vs old-NP SD 4.54; correlation between the two rankings **ρ ≈ -0.093**.

**38 of 150 listed players have ≤0 expected margin impact** — they cannot be fairly priced above a floor and are structurally unholdable longs. (Old NP: 0 players ≤0.)

| Player | Margin-NP/game | Old NP/game |
|---|---:|---:|
| Rudy Gobert | +14.86 | 11.60 |
| Donovan Clingan | +13.42 | 12.90 |
| Moussa Diabate | +11.48 | 8.95 |
| Jalen Duren | +11.40 | 18.09 |
| Neemias Queta | +11.05 | 10.94 |
| Kel'el Ware | +10.96 | 10.72 |
| Karl-Anthony Towns | +10.13 | 16.69 |
| Deandre Ayton | +9.38 | 10.84 |

## 3. Requote leak per settled game (margin-NP, all seasons)

| Season | frozen at open | weekly requote | nightly full |
|---|---:|---:|---:|
| 2023-24 | +0.112 | +0.019 | +0.005 |
| 2024-25 | +0.456 | +0.024 | +0.016 |
| 2025-26 | +0.465 | +0.046 | +0.029 |

## 4. True last-season opening lock (margin-NP)

| Season pair | Raw drift/game | With fitted uplift |
|---|---:|---:|
| 2023-24 → 2024-25 | +0.298 | +0.000 (uplift +0.30) |
| 2024-25 → 2025-26 | +0.257 | -0.021 (uplift +0.28) |

Mean YoY uplift under margin-NP: **+0.28 margin-pts/game** (additive; the ×1.08 proportional form fails here because near-zero players cannot be scaled).

## 5. User P&L bands and the rate sweep (margin-NP units)

| Roster | Night SD | Night p95 | Week SD | Week p95 | (margin-pts) |
|---|---:|---:|---:|---:|---|
| stars | 13.0 | 25.4 | 27.2 | 45.4 | |
| balanced | 10.2 | 20.1 | 23.9 | 54.3 | |

| Rate | Star cost/game | Night p95 | Week p95 | p05 positive player | Floor OK | Verdict |
|---|---:|---:|---:|---:|:---:|---|
| $10K | $148,564 | ±$201,319 | ±$542,647 | $3,887 | no | floor distorts |
| $15K | $222,846 | ±$301,978 | ±$813,970 | $5,830 | no | floor distorts |
| $20K | $297,127 | ±$402,638 | ±$1,085,294 | $7,773 | no | floor distorts |
| $25K | $371,409 | ±$503,297 | ±$1,356,617 | $9,717 | no | floor distorts |
| $30K | $445,691 | ±$603,956 | ±$1,627,941 | $11,660 | no | floor distorts |
| $40K | $594,255 | ±$805,275 | ±$2,170,588 | $15,547 | no | nights too violent; weeks too violent; floor distorts |
| $50K | $742,818 | ±$1,006,594 | ±$2,713,234 | $19,433 | no | nights too violent; weeks too violent; floor distorts |

## 6. Shorts (7-day windows, margin-NP units)

3,138 windows: mean -0.16, SD 11.6 margin-pts, win rate 50.4%.
