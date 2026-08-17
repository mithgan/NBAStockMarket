# Four-Way Expectation Model Comparison

This deterministic comparison replays the same cached 2025-26 season, 150-player universe, 100 synthetic portfolios, and the engine's $80,000-per-net-point per-holder and $8,000,000-per-net-point full-float constant under `trailing`, `salary-projection`, `dnt`, and `production`. Each portfolio starts with $207,824,000. This audit comparison intentionally remains listing-neutral: all four models use the same salary-only listing basis, and expectation bias is fixed at 0.00 so only the expectation models differ. The canonical production economy instead applies the 0.43586495-net-point league bias recorded in `output/economy-calibration-2026.md`. No network calls are made; D&T uses the 164 cached game dates in `data/raw/dnt`.

## Net season inflation

| Model | Gross positive faucet | Net inflation | Initial wealth | Net inflation rate |
|---|---:|---:|---:|---:|
| Trailing | $17,162,727,551 | $305,854,486 | $20,782,400,000 | 1.4717% |
| Salary-projection | $21,322,512,405 | $6,225,259,113 | $20,782,400,000 | 29.9545% |
| D&T | $17,321,154,386 | $2,041,695,012 | $20,782,400,000 | 9.8242% |
| Production | $62,680,596,000 | $60,426,141,910 | $20,782,400,000 | 290.7563% |

Production is explicitly the much larger faucet: $62,680,596,000 of gross positive payouts, versus $17,321,154,386 under D&T, because no expected value is subtracted from positive game-log production.

## Top 10 season earners — Trailing

| Rank | Player | Tier | Salary | Games | Season / share | Full float |
|---:|---|---|---:|---:|---:|---:|
| 1 | Jeremiah Fears | bench | $7,520,040 | 82 | $5,649,251 | $564,925,079 |
| 2 | Amen Thompson | bench | $9,690,600 | 79 | $5,579,975 | $557,997,481 |
| 3 | Cooper Flagg | mid | $13,825,920 | 70 | $5,317,070 | $531,706,998 |
| 4 | Maxime Raynaud | bench | $1,272,870 | 74 | $5,283,915 | $528,391,461 |
| 5 | Nickeil Alexander-Walker | mid | $15,161,800 | 78 | $4,420,923 | $442,092,315 |
| 6 | Dyson Daniels | bench | $7,707,709 | 76 | $4,412,804 | $441,280,387 |
| 7 | Kyle Filipowski | bench | $3,000,000 | 77 | $4,073,081 | $407,308,095 |
| 8 | Derik Queen | bench | $5,157,960 | 81 | $3,725,436 | $372,543,594 |
| 9 | Bobby Portis | mid | $13,445,754 | 67 | $3,697,470 | $369,747,016 |
| 10 | CJ McCollum | star | $30,666,666 | 76 | $3,662,878 | $366,287,779 |

## Top 10 season earners — Salary-projection

| Rank | Player | Tier | Salary | Games | Season / share | Full float |
|---:|---|---|---:|---:|---:|---:|
| 1 | Victor Wembanyama | mid | $13,376,880 | 64 | $71,253,112 | $7,125,311,232 |
| 2 | Jalen Duren | bench | $6,483,144 | 70 | $62,404,318 | $6,240,431,808 |
| 3 | Shai Gilgeous-Alexander | star | $38,333,050 | 68 | $53,568,462 | $5,356,846,240 |
| 4 | Amen Thompson | bench | $9,690,600 | 79 | $48,426,622 | $4,842,662,240 |
| 5 | Keyonte George | bench | $4,278,960 | 54 | $43,818,468 | $4,381,846,784 |
| 6 | Deni Avdija | mid | $14,375,000 | 66 | $42,946,000 | $4,294,600,000 |
| 7 | Ryan Rollins | bench | $4,000,000 | 74 | $38,072,000 | $3,807,200,000 |
| 8 | Luka Doncic | star | $45,999,660 | 64 | $37,388,522 | $3,738,852,224 |
| 9 | Nikola Jokic | star | $55,224,526 | 65 | $35,465,739 | $3,546,573,944 |
| 10 | Cooper Flagg | mid | $13,825,920 | 70 | $34,528,454 | $3,452,845,440 |

## Top 10 season earners — D&T

| Rank | Player | Tier | Salary | Games | Season / share | Full float |
|---:|---|---|---:|---:|---:|---:|
| 1 | Nickeil Alexander-Walker | mid | $15,161,800 | 78 | $14,727,420 | $1,472,742,040 |
| 2 | Victor Wembanyama | mid | $13,376,880 | 64 | $14,443,662 | $1,444,366,160 |
| 3 | Nikola Jokic | star | $55,224,526 | 65 | $13,217,741 | $1,321,774,120 |
| 4 | Keyonte George | bench | $4,278,960 | 54 | $12,598,158 | $1,259,815,840 |
| 5 | Kevin Durant | star | $54,708,609 | 78 | $12,424,026 | $1,242,402,560 |
| 6 | Luka Doncic | star | $45,999,660 | 64 | $12,230,783 | $1,223,078,280 |
| 7 | Jamal Murray | star | $46,394,100 | 75 | $12,098,646 | $1,209,864,600 |
| 8 | Kawhi Leonard | star | $50,000,000 | 65 | $11,827,540 | $1,182,754,040 |
| 9 | Kon Knueppel | mid | $10,015,680 | 81 | $11,597,908 | $1,159,790,760 |
| 10 | Tim Hardaway Jr. | bench | $2,296,274 | 80 | $10,669,084 | $1,066,908,400 |

## Top 10 season earners — Production

| Rank | Player | Tier | Salary | Games | Season / share | Full float |
|---:|---|---|---:|---:|---:|---:|
| 1 | Nikola Jokic | star | $55,224,526 | 65 | $147,616,000 | $14,761,600,000 |
| 2 | Shai Gilgeous-Alexander | star | $38,333,050 | 68 | $143,328,000 | $14,332,800,000 |
| 3 | Luka Doncic | star | $45,999,660 | 64 | $133,644,000 | $13,364,400,000 |
| 4 | Tyrese Maxey | star | $37,958,760 | 70 | $119,040,000 | $11,904,000,000 |
| 5 | Victor Wembanyama | mid | $13,376,880 | 64 | $117,400,000 | $11,740,000,000 |
| 6 | Jamal Murray | star | $46,394,100 | 75 | $114,960,000 | $11,496,000,000 |
| 7 | Kawhi Leonard | star | $50,000,000 | 65 | $114,712,000 | $11,471,200,000 |
| 8 | Donovan Mitchell | star | $46,394,100 | 70 | $114,652,000 | $11,465,200,000 |
| 9 | Kevin Durant | star | $54,708,609 | 78 | $114,636,000 | $11,463,600,000 |
| 10 | Jaylen Brown | star | $53,142,264 | 71 | $109,380,000 | $10,938,000,000 |

## Nikola Jokic on Christmas 2025

ESPN game `401809242` on 2025-12-25 produced 59.35 actual net points.

| Model | Expected NP | Dividend NP | Payout / share | Full-float payout |
|---|---:|---:|---:|---:|
| Trailing | 28.37 | +30.98 | $2,478,400 | $247,840,000 |
| Salary-projection | 21.57 | +37.78 | $3,022,611 | $302,261,138 |
| D&T | 25.55 | +33.80 | $2,704,220 | $270,421,960 |
| Production | 0.00 | +59.35 | $4,748,000 | $474,800,000 |

## Production-only: top 10 season yield

Yield is season production dividends per share divided by the salary-listing price. This exposes the cheap-producer, or ‘Sexton over Luka,’ effect in Russ's model.

| Rank | Player | Salary-listing price | Production dividends / share | Season yield |
|---:|---|---:|---:|---:|
| 1 | Maxime Raynaud | $1,272,870 | $56,408,000 | 4431.56% |
| 2 | Neemias Queta | $2,349,578 | $66,460,000 | 2828.59% |
| 3 | Collin Gillespie | $2,296,274 | $60,008,000 | 2613.28% |
| 4 | Toumani Camara | $2,221,677 | $53,448,000 | 2405.75% |
| 5 | Russell Westbrook | $2,296,274 | $55,192,000 | 2403.55% |
| 6 | Sandro Mamukelashvili | $2,461,463 | $59,008,000 | 2397.27% |
| 7 | Precious Achiuwa | $2,111,516 | $49,672,000 | 2352.43% |
| 8 | Moussa Diabate | $2,270,735 | $52,288,000 | 2302.69% |
| 9 | Pelle Larsson | $1,955,378 | $44,568,000 | 2279.25% |
| 10 | Jay Huff | $2,349,578 | $50,928,000 | 2167.54% |

## Neutral takeaway

Production is simple and effectively always-positive (except genuinely negative net-points games), but its much larger faucet needs a smaller dollars-per-net-point constant; with salary-listing prices unchanged, the market prices that inflation through yield-hunting for cheap producers. Surprise-based D&T is closer to zero-sum, riskier and spicier, and makes projection quality part of the forecasting game. This comparison makes no recommendation; the team decides which dividend design it wants.
