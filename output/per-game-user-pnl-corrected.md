# User P&L with actual previous-season opening anchors

Long-only, forced-hold/weekly-random diagnostic. Sample and fixed rosters are frozen before trading. Opening anchor is actual previous-season mean, without a policy markup; missing players use first observed projection. Later adds use trailing 10 prior games.
Each rate is replayed separately with a $25K floor and $10K fee per actual add. Retained positions keep their locked costs and do not incur another fee. Calendar-day statistics include zero-return days.
No bankroll constraints, demand impact, short lifecycle, rookie adjustment or strategic drop/re-signing are modeled. This does not select a rate or validate the complete economy.

## Rate $15,000/NP; opening 2025-11-04; prior coverage 146/150

| Archetype | Mean season net | Actual mean adds | Calendar-day SD | Weekly SD | Absolute night p95 | Absolute week p95 |
|---|---:|---:|---:|---:|---:|---:|
| star hold | $+1,322,931 | 10.0 | $235,654 | $487,100 | $441,788 | $919,396 |
| balanced | $+11,955,558 | 10.0 | $216,782 | $481,453 | $483,454 | $1,130,498 |
| bench hold | $-1,540,368 | 10.0 | $121,127 | $303,609 | $253,903 | $492,461 |
| random | $-1,524,975 | 214.9 | $187,422 | $520,400 | $391,529 | $1,047,449 |

Random season totals: min $-5,493,519, max $+2,448,516, sample SD $2,434,271 across 10 seeds. This is observed strategy variability, not a confidence interval or a calibrated luck band.

## Rate $20,000/NP; opening 2025-11-04; prior coverage 146/150

| Archetype | Mean season net | Actual mean adds | Calendar-day SD | Weekly SD | Absolute night p95 | Absolute week p95 |
|---|---:|---:|---:|---:|---:|---:|
| star hold | $+1,797,241 | 10.0 | $314,167 | $651,018 | $589,051 | $1,225,862 |
| balanced | $+15,974,077 | 10.0 | $288,673 | $642,166 | $644,605 | $1,507,331 |
| bench hold | $-1,153,824 | 10.0 | $161,071 | $409,333 | $333,394 | $651,097 |
| random | $-1,141,246 | 214.9 | $248,342 | $694,973 | $512,604 | $1,387,010 |

Random season totals: min $-6,522,192, max $+4,131,988, sample SD $3,264,298 across 10 seeds. This is observed strategy variability, not a confidence interval or a calibrated luck band.

## Rate $25,000/NP; opening 2025-11-04; prior coverage 146/150

| Archetype | Mean season net | Actual mean adds | Calendar-day SD | Weekly SD | Absolute night p95 | Absolute week p95 |
|---|---:|---:|---:|---:|---:|---:|
| star hold | $+2,271,551 | 10.0 | $392,693 | $814,976 | $736,313 | $1,532,327 |
| balanced | $+19,992,596 | 10.0 | $360,578 | $802,922 | $805,756 | $1,884,164 |
| bench hold | $-767,280 | 10.0 | $201,169 | $515,488 | $410,806 | $847,288 |
| random | $-802,370 | 214.9 | $309,480 | $869,063 | $636,150 | $1,708,762 |

Random season totals: min $-7,572,740, max $+5,759,485, sample SD $4,087,243 across 10 seeds. This is observed strategy variability, not a confidence interval or a calibrated luck band.
