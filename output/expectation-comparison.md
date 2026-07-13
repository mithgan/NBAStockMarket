# Four-Way Expectation Model Comparison

This deterministic comparison replays the same cached 2025-26 season, 150-player universe, 100 synthetic portfolios, and the engine's $40,000-per-net-point per-holder and $4,000,000-per-net-point full-float constant under `trailing`, `salary-projection`, `dnt`, and `production`. This audit comparison intentionally remains listing-neutral: all four models use the same salary-only listing basis. No network calls are made; D&T uses the 164 cached game dates in `data/raw/dnt`.

## Net season inflation

| Model | Gross positive faucet | Net inflation | Initial wealth | Net inflation rate |
|---|---:|---:|---:|---:|
| Trailing | $8,574,528,961 | $353,477,213 | $14,000,000,000 | 2.5248% |
| Salary-projection | $10,962,477,286 | $4,020,362,047 | $14,000,000,000 | 28.7169% |
| D&T | $8,571,751,333 | $1,061,023,137 | $14,000,000,000 | 7.5787% |
| Production | $29,266,636,000 | $28,138,056,348 | $14,000,000,000 | 200.9861% |

Production is explicitly the much larger faucet: $29,266,636,000 of gross positive payouts, versus $8,571,751,333 under D&T, because no expected value is subtracted from positive game-log production.

## Top 10 season earners — Trailing

| Rank | Player | Tier | Salary | Games | Season / share | Full float |
|---:|---|---|---:|---:|---:|---:|
| 1 | Jeremiah Fears | bench | $7,520,040 | 82 | $2,824,625 | $282,462,539 |
| 2 | Amen Thompson | bench | $9,690,600 | 79 | $2,789,987 | $278,998,740 |
| 3 | Cooper Flagg | mid | $13,825,920 | 70 | $2,658,535 | $265,853,499 |
| 4 | Maxime Raynaud | bench | $1,272,870 | 74 | $2,641,957 | $264,195,731 |
| 5 | Nickeil Alexander-Walker | mid | $15,161,800 | 78 | $2,210,462 | $221,046,157 |
| 6 | Dyson Daniels | bench | $7,707,709 | 76 | $2,206,402 | $220,640,194 |
| 7 | Kyle Filipowski | bench | $3,000,000 | 77 | $2,036,540 | $203,654,048 |
| 8 | Derik Queen | bench | $5,157,960 | 81 | $1,862,718 | $186,271,797 |
| 9 | Bobby Portis | mid | $13,445,754 | 67 | $1,848,735 | $184,873,508 |
| 10 | CJ McCollum | star | $30,666,666 | 76 | $1,831,439 | $183,143,890 |

## Top 10 season earners — Salary-projection

| Rank | Player | Tier | Salary | Games | Season / share | Full float |
|---:|---|---|---:|---:|---:|---:|
| 1 | Victor Wembanyama | mid | $13,376,880 | 64 | $35,626,556 | $3,562,655,616 |
| 2 | Jalen Duren | bench | $6,483,144 | 70 | $31,202,159 | $3,120,215,904 |
| 3 | Shai Gilgeous-Alexander | star | $38,333,050 | 68 | $26,784,231 | $2,678,423,120 |
| 4 | Amen Thompson | bench | $9,690,600 | 79 | $24,213,311 | $2,421,331,120 |
| 5 | Keyonte George | bench | $4,278,960 | 54 | $21,909,234 | $2,190,923,392 |
| 6 | Deni Avdija | mid | $14,375,000 | 66 | $21,473,000 | $2,147,300,000 |
| 7 | Ryan Rollins | bench | $4,000,000 | 74 | $19,036,000 | $1,903,600,000 |
| 8 | Luka Doncic | star | $45,999,660 | 64 | $18,694,261 | $1,869,426,112 |
| 9 | Nikola Jokic | star | $55,224,526 | 65 | $17,732,870 | $1,773,286,972 |
| 10 | Cooper Flagg | mid | $13,825,920 | 70 | $17,264,227 | $1,726,422,720 |

## Top 10 season earners — D&T

| Rank | Player | Tier | Salary | Games | Season / share | Full float |
|---:|---|---|---:|---:|---:|---:|
| 1 | Nickeil Alexander-Walker | mid | $15,161,800 | 78 | $7,363,710 | $736,371,020 |
| 2 | Victor Wembanyama | mid | $13,376,880 | 64 | $7,221,831 | $722,183,080 |
| 3 | Nikola Jokic | star | $55,224,526 | 65 | $6,608,871 | $660,887,060 |
| 4 | Keyonte George | bench | $4,278,960 | 54 | $6,299,079 | $629,907,920 |
| 5 | Kevin Durant | star | $54,708,609 | 78 | $6,212,013 | $621,201,280 |
| 6 | Luka Doncic | star | $45,999,660 | 64 | $6,115,391 | $611,539,140 |
| 7 | Jamal Murray | star | $46,394,100 | 75 | $6,049,323 | $604,932,300 |
| 8 | Kawhi Leonard | star | $50,000,000 | 65 | $5,913,770 | $591,377,020 |
| 9 | Kon Knueppel | mid | $10,015,680 | 81 | $5,798,954 | $579,895,380 |
| 10 | Tim Hardaway Jr. | bench | $2,296,274 | 80 | $5,334,542 | $533,454,200 |

## Top 10 season earners — Production

| Rank | Player | Tier | Salary | Games | Season / share | Full float |
|---:|---|---|---:|---:|---:|---:|
| 1 | Nikola Jokic | star | $55,224,526 | 65 | $73,808,000 | $7,380,800,000 |
| 2 | Shai Gilgeous-Alexander | star | $38,333,050 | 68 | $71,664,000 | $7,166,400,000 |
| 3 | Luka Doncic | star | $45,999,660 | 64 | $66,822,000 | $6,682,200,000 |
| 4 | Tyrese Maxey | star | $37,958,760 | 70 | $59,520,000 | $5,952,000,000 |
| 5 | Victor Wembanyama | mid | $13,376,880 | 64 | $58,700,000 | $5,870,000,000 |
| 6 | Jamal Murray | star | $46,394,100 | 75 | $57,480,000 | $5,748,000,000 |
| 7 | Kawhi Leonard | star | $50,000,000 | 65 | $57,356,000 | $5,735,600,000 |
| 8 | Donovan Mitchell | star | $46,394,100 | 70 | $57,326,000 | $5,732,600,000 |
| 9 | Kevin Durant | star | $54,708,609 | 78 | $57,318,000 | $5,731,800,000 |
| 10 | Jaylen Brown | star | $53,142,264 | 71 | $54,690,000 | $5,469,000,000 |

## Nikola Jokic on Christmas 2025

ESPN game `401809242` on 2025-12-25 produced 59.35 actual net points.

| Model | Expected NP | Dividend NP | Payout / share | Full-float payout |
|---|---:|---:|---:|---:|
| Trailing | 28.37 | +30.98 | $1,239,200 | $123,920,000 |
| Salary-projection | 21.57 | +37.78 | $1,511,306 | $151,130,569 |
| D&T | 25.55 | +33.80 | $1,352,110 | $135,210,980 |
| Production | 0.00 | +59.35 | $2,374,000 | $237,400,000 |

## Production-only: top 10 season yield

Yield is season production dividends per share divided by the salary-listing price. This exposes the cheap-producer, or ‘Sexton over Luka,’ effect in Russ's model.

| Rank | Player | Salary-listing price | Production dividends / share | Season yield |
|---:|---|---:|---:|---:|
| 1 | Maxime Raynaud | $1,272,870 | $28,204,000 | 2215.78% |
| 2 | Neemias Queta | $2,349,578 | $33,230,000 | 1414.30% |
| 3 | Collin Gillespie | $2,296,274 | $30,004,000 | 1306.64% |
| 4 | Toumani Camara | $2,221,677 | $26,724,000 | 1202.88% |
| 5 | Russell Westbrook | $2,296,274 | $27,596,000 | 1201.77% |
| 6 | Sandro Mamukelashvili | $2,461,463 | $29,504,000 | 1198.64% |
| 7 | Precious Achiuwa | $2,111,516 | $24,836,000 | 1176.22% |
| 8 | Moussa Diabate | $2,270,735 | $26,144,000 | 1151.35% |
| 9 | Pelle Larsson | $1,955,378 | $22,284,000 | 1139.63% |
| 10 | Jay Huff | $2,349,578 | $25,464,000 | 1083.77% |

## Neutral takeaway

Production is simple and effectively always-positive (except genuinely negative net-points games), but its much larger faucet needs a smaller dollars-per-net-point constant; with salary-listing prices unchanged, the market prices that inflation through yield-hunting for cheap producers. Surprise-based D&T is closer to zero-sum, riskier and spicier, and makes projection quality part of the forecasting game. This comparison makes no recommendation; the team decides which dividend design it wants.
