# Held-cost repricing: locked vs weekly capped (2025-26, $20K/NP)

Market quote = trailing-10 with weekly requote; signing cost = quote at signing.
Every add pays the $10K signing fee; quotes, signing costs, and repriced costs
respect the $25K minimum price. Repricing happens at the week boundary before
any of that week's games settle.

| Regime | Scout (improver-chaser) | Star hold | Balanced hold | Random x10 mean | Holder leak $/held game |
|---|---:|---:|---:|---:|---:|
| LOCKED | $+825,525 | $-28,350,414 | $+23,948,238 | $-206,710 | $-636 |
| CAP5 | $+469,383 | $-4,914,022 | $+17,607,656 | $-174,268 | $+1,287 |
| CAP10 | $+140,231 | $-1,841,831 | $+13,531,856 | $-164,166 | $+1,148 |
| CAP25 | $-614,409 | $-2,017,912 | $+7,020,619 | $-186,649 | $+284 |
| FULL | $-1,331,687 | $-2,716,843 | $+3,636,963 | $-367,290 | $-460 |

Scout = signs improvers while the trailing-10 quote still reflects old form; its edge under LOCKED is the permanent-annuity effect, and each cap level shows how much of that discovery premium survives.
