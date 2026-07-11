# Four-Way Expectation Model Comparison

This deterministic comparison replays the same cached 2025-26 season, 150-player universe, 100 synthetic portfolios, and unchanged $100,000-per-net-point full-float constant under `trailing`, `salary-projection`, `dnt`, and `production`. No network calls are made; D&T uses the 164 cached game dates in `data/raw/dnt`.

## Net season inflation

| Model | Gross positive faucet | Net inflation | Initial wealth | Net inflation rate |
|---|---:|---:|---:|---:|
| Trailing | $214,363,224 | -$57,174,120 | $14,000,000,000 | -0.4084% |
| Salary-projection | $274,061,932 | $34,511,794 | $14,000,000,000 | 0.2465% |
| D&T | $214,293,783 | -$39,486,271 | $14,000,000,000 | -0.2820% |
| Production | $731,665,900 | $637,439,517 | $14,000,000,000 | 4.5531% |

Production is explicitly the much larger faucet: $731,665,900 of gross positive payouts, versus $214,293,783 under D&T, because no expected value is subtracted from positive game-log production.

## Top 10 season earners — Trailing

| Rank | Player | Tier | Salary | Games | Season / share | Full float |
|---:|---|---|---:|---:|---:|---:|
| 1 | Jeremiah Fears | bench | $7,520,040 | 82 | $70,616 | $7,061,563 |
| 2 | Amen Thompson | bench | $9,690,600 | 79 | $69,750 | $6,974,969 |
| 3 | Cooper Flagg | mid | $13,825,920 | 70 | $66,463 | $6,646,337 |
| 4 | Maxime Raynaud | bench | $1,272,870 | 74 | $66,049 | $6,604,893 |
| 5 | Nickeil Alexander-Walker | mid | $15,161,800 | 78 | $55,262 | $5,526,154 |
| 6 | Dyson Daniels | bench | $7,707,709 | 76 | $55,160 | $5,516,005 |
| 7 | Kyle Filipowski | bench | $3,000,000 | 77 | $50,914 | $5,091,351 |
| 8 | Derik Queen | bench | $5,157,960 | 81 | $46,568 | $4,656,795 |
| 9 | Bobby Portis | mid | $13,445,754 | 67 | $46,218 | $4,621,838 |
| 10 | CJ McCollum | star | $30,666,666 | 76 | $45,786 | $4,578,597 |

## Top 10 season earners — Salary-projection

| Rank | Player | Tier | Salary | Games | Season / share | Full float |
|---:|---|---|---:|---:|---:|---:|
| 1 | Victor Wembanyama | mid | $13,376,880 | 64 | $890,664 | $89,066,390 |
| 2 | Jalen Duren | bench | $6,483,144 | 70 | $780,054 | $78,005,398 |
| 3 | Shai Gilgeous-Alexander | star | $38,333,050 | 68 | $669,606 | $66,960,578 |
| 4 | Amen Thompson | bench | $9,690,600 | 79 | $605,333 | $60,533,278 |
| 5 | Keyonte George | bench | $4,278,960 | 54 | $547,731 | $54,773,085 |
| 6 | Deni Avdija | mid | $14,375,000 | 66 | $536,825 | $53,682,500 |
| 7 | Ryan Rollins | bench | $4,000,000 | 74 | $475,900 | $47,590,000 |
| 8 | Luka Doncic | star | $45,999,660 | 64 | $467,357 | $46,735,653 |
| 9 | Nikola Jokic | star | $55,224,526 | 65 | $443,322 | $44,332,174 |
| 10 | Cooper Flagg | mid | $13,825,920 | 70 | $431,606 | $43,160,568 |

## Top 10 season earners — D&T

| Rank | Player | Tier | Salary | Games | Season / share | Full float |
|---:|---|---|---:|---:|---:|---:|
| 1 | Nickeil Alexander-Walker | mid | $15,161,800 | 78 | $184,093 | $18,409,276 |
| 2 | Victor Wembanyama | mid | $13,376,880 | 64 | $180,546 | $18,054,577 |
| 3 | Nikola Jokic | star | $55,224,526 | 65 | $165,222 | $16,522,176 |
| 4 | Keyonte George | bench | $4,278,960 | 54 | $157,477 | $15,747,698 |
| 5 | Kevin Durant | star | $54,708,609 | 78 | $155,300 | $15,530,032 |
| 6 | Luka Doncic | star | $45,999,660 | 64 | $152,885 | $15,288,478 |
| 7 | Jamal Murray | star | $46,394,100 | 75 | $151,233 | $15,123,308 |
| 8 | Kawhi Leonard | star | $50,000,000 | 65 | $147,844 | $14,784,426 |
| 9 | Kon Knueppel | mid | $10,015,680 | 81 | $144,974 | $14,497,384 |
| 10 | Tim Hardaway Jr. | bench | $2,296,274 | 80 | $133,364 | $13,336,355 |

## Top 10 season earners — Production

| Rank | Player | Tier | Salary | Games | Season / share | Full float |
|---:|---|---|---:|---:|---:|---:|
| 1 | Nikola Jokic | star | $55,224,526 | 65 | $1,845,200 | $184,520,000 |
| 2 | Shai Gilgeous-Alexander | star | $38,333,050 | 68 | $1,791,600 | $179,160,000 |
| 3 | Luka Doncic | star | $45,999,660 | 64 | $1,670,550 | $167,055,000 |
| 4 | Tyrese Maxey | star | $37,958,760 | 70 | $1,488,000 | $148,800,000 |
| 5 | Victor Wembanyama | mid | $13,376,880 | 64 | $1,467,500 | $146,750,000 |
| 6 | Jamal Murray | star | $46,394,100 | 75 | $1,437,000 | $143,700,000 |
| 7 | Kawhi Leonard | star | $50,000,000 | 65 | $1,433,900 | $143,390,000 |
| 8 | Donovan Mitchell | star | $46,394,100 | 70 | $1,433,150 | $143,315,000 |
| 9 | Kevin Durant | star | $54,708,609 | 78 | $1,432,950 | $143,295,000 |
| 10 | Jaylen Brown | star | $53,142,264 | 71 | $1,367,250 | $136,725,000 |

## Nikola Jokic on Christmas 2025

ESPN game `401809242` on 2025-12-25 produced 59.35 actual net points.

| Model | Expected NP | Dividend NP | Payout / share | Full-float payout |
|---|---:|---:|---:|---:|
| Trailing | 28.37 | +30.98 | $30,980 | $3,098,000 |
| Salary-projection | 21.57 | +37.78 | $37,783 | $3,778,264 |
| D&T | 25.55 | +33.80 | $33,803 | $3,380,275 |
| Production | 0.00 | +59.35 | $59,350 | $5,935,000 |

## Production-only: top 10 season yield

Yield is season production dividends per share divided by the salary-listing price. This exposes the cheap-producer, or ‘Sexton over Luka,’ effect in Russ's model.

| Rank | Player | Salary-listing price | Production dividends / share | Season yield |
|---:|---|---:|---:|---:|
| 1 | Maxime Raynaud | $1,272,870 | $705,100 | 55.39% |
| 2 | Neemias Queta | $2,349,578 | $830,750 | 35.36% |
| 3 | Collin Gillespie | $2,296,274 | $750,100 | 32.67% |
| 4 | Toumani Camara | $2,221,677 | $668,100 | 30.07% |
| 5 | Russell Westbrook | $2,296,274 | $689,900 | 30.04% |
| 6 | Sandro Mamukelashvili | $2,461,463 | $737,600 | 29.97% |
| 7 | Precious Achiuwa | $2,111,516 | $620,900 | 29.41% |
| 8 | Moussa Diabate | $2,270,735 | $653,600 | 28.78% |
| 9 | Pelle Larsson | $1,955,378 | $557,100 | 28.49% |
| 10 | Jay Huff | $2,349,578 | $636,600 | 27.09% |

## Neutral takeaway

Production is simple and effectively always-positive (except genuinely negative net-points games), but its much larger faucet needs a smaller dollars-per-net-point constant; with salary-listing prices unchanged, the market prices that inflation through yield-hunting for cheap producers. Surprise-based D&T is closer to zero-sum, riskier and spicier, and makes projection quality part of the forecasting game. This comparison makes no recommendation; the team decides which dividend design it wants.
