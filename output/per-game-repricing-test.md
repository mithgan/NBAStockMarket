# Held-cost repricing: conditional long-only replay

Frozen sample: 150 players observed before 2025-11-04; fixed rosters also use only pre-opening projections.
Quote = trailing 10 prior games (minimum 3), otherwise first observed projection. Every actual add pays $10K; all costs have a $25K floor; rate $20K/NP.
Weekly updates occur before that week's roster changes and games. Gross holder leak excludes fees; net P&L includes fees.
This isolates repricing. It excludes short expiry, demand impact, bankroll limits, prior-season anchors, and strategic drop/re-sign responses. It cannot select a production cap or rate.

| Regime | Scout net | Star hold net | Balanced hold net | Random mean net | Gross holder leak/held game |
|---|---:|---:|---:|---:|---:|
| LOCKED | $-582,923 | $-20,703,905 | $-668,976 | $-676,934 | $-723 |
| CAP5 | $-1,178,358 | $-1,135,381 | $+2,770,846 | $-661,085 | $+2,454 |
| CAP10 | $-1,589,822 | $-506,208 | $+2,219,535 | $-636,115 | $+2,443 |
| CAP25 | $-2,363,967 | $-889,610 | $+403,604 | $-601,925 | $+2,072 |
| FULL | $-3,144,623 | $-1,292,416 | $-711,702 | $-654,066 | $+1,675 |

## Seed variation and actual opening counts

These are descriptive comparisons across ten seeded rosters, not significance tests or proof of player skill.

| Regime | Scout minus random mean | Random SD | Random min | Random max | Random seeds beaten by scout | Scout adds | Random mean adds |
|---|---:|---:|---:|---:|---:|---:|---:|
| LOCKED | $+94,011 | $3,387,265 | $-5,700,376 | $+5,408,387 | 4/10 | 190 | 214.9 |
| CAP5 | $-517,273 | $3,319,934 | $-5,641,544 | $+5,250,471 | 4/10 | 190 | 214.9 |
| CAP10 | $-953,707 | $3,278,727 | $-5,683,990 | $+5,126,948 | 3/10 | 190 | 214.9 |
| CAP25 | $-1,762,042 | $3,207,605 | $-5,790,326 | $+4,773,545 | 2/10 | 190 | 214.9 |
| FULL | $-2,490,557 | $3,144,613 | $-5,815,676 | $+4,368,709 | 2/10 | 190 | 214.9 |

Fixed-holder losses are forced-hold scenarios. Positive excess over a random mean on this sample does not validate stable skill or the complete game economy.
