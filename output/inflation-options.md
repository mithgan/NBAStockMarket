DECIDED: Option B (Mith, 7/14) — now the default.

# NBA-12 inflation calibration options

Decision owner: **Mith**. Option B is implemented as the engine and backtest default.

The natural expectation-bias candidate is **+0.43586494964917194 net points per player-game**, the deterministic league mean of `actual - expected` across all **10,689** Dunks & Threes player-games in the listed-universe replay. Bias is added to every expectation before settlement: `adjusted expectation = D&T expectation + bias`.

| Option | Calibration | Net season inflation | SGA 2025-10-23 payout | Jokic 2025-12-25 payout | 90th-pct star-game payout | Median portfolio final value |
|---|---|---:|---:|---:|---:|---:|
| A | $40K / net point / holder; no bias (status quo) | $1,017,409,150 (7.2672%) | $831,484 | $1,352,110 | $575,317 | $149,776,694 |
| B | $40K / net point / holder; auto bias | -$216,693,128 (-1.5478%) | $814,050 | $1,334,675 | $566,702 | $137,649,206 |
| C | $30K / net point / holder; no bias | $748,110,454 (5.3436%) | $623,613 | $1,014,082 | $431,488 | $147,127,544 |
| D | $30K / net point / holder; auto bias | -$177,313,742 (-1.2665%) | $610,537 | $1,001,006 | $425,027 | $138,031,928 |

All payout columns are per holder (one share). Every row uses the same cached season, 150-player universe, 100 deterministic ten-player portfolios, seed `2026`, opening prices, fees, and idle-cash rule. The percentage denominator is the cohort's $14.0B starting wealth.

Option B removes the systematic projection faucet while retaining the large individual moments: the SGA payout is 97.9% of status quo and the Jokic payout is 98.7%. Its remaining -1.55% cohort deflation reflects non-uniform ownership and the already-existing idle-cash sink; the unweighted league-wide surprise component is zero by construction.

Option C lowers every surprise payout by 25%, including the moments the team wants to preserve. Option D combines both levers. No option changes fees.
