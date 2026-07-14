# NBA Stock Market 2025-26 Backtest

**DECIDED DESIGN (Russ, Discord 7/12): one opening-price-model share is the whole player; each user may hold at most one share per player; dividends settle actual game logs against Dunks & Threes pre-game box-score projection; salary-implied fallback for missing player-games. This replay keeps $40,000 per net point per holder and applies the automatically computed +0.43586494964917194 NP/player-game league-mean surprise correction. Listings use projected-WAR FV plus 10% salary.**

This deterministic replay covers the 1,230-game 2025-26 NBA regular season. The universe is the top 150 players by final regular-season minutes. One hundred synthetic users each begin at $140M and hold one share of 10 unique players. Trading and inactivity decay are off; prices stay at opening-price-model listings, so the measured economy is dividends minus the daily idle-cash sink.

## Method

- Actuals: 26,547 played player-games from ESPN game summaries (1,230 games).
- Salaries: `https://github.com/gabriel1200/site_Data` `salary.csv` at commit `bc583cb`; missing names filled from the pinned fallback snapshot.
- Listings: projected-WAR FV plus 10% salary; 0 of 150 players fall back to salary (none).
- Expectation: Dunks & Threes pre-game box-score projection; salary-implied fallback for missing player-games. Expectations include the automatically computed +0.43586494964917194 NP/player-game league-mean surprise correction.
- Replay: 10,689 universe player-games on 164 game days, with 174 calendar-day idle-fee passes.
- Payout conventions: per-share amounts are what one holder receives; full-float amounts are the same result across all 100 shares.

## A. Money supply

| Measure | Amount |
|---|---:|
| Starting cohort wealth | $14,000,000,000 |
| Gross positive dividends (faucet) | $7,634,891,244 |
| Negative dividend debits | $7,799,269,417 |
| Net signed dividends | -$164,378,173 |
| Trading fees (trading off) | $0 |
| Idle cash sunk | $35,824,485 |
| **Net inflation** | **-$200,202,658 (-1.4300%)** |
| Ending cohort wealth | $13,799,797,342 |

The league-mean correction removes systematic projection inflation by design; the remaining cohort deflation reflects non-uniform ownership and the intended idle-cash sink. The reconciliation difference is $0 (rounding only).

## B. Calibration

**DECIDED 2026-07-14 (Mith, Discord 7/14).** The decided rate is **$40,000 per net point per holder**, so a +20 surprise pays **$800,000**. The observed 90th-percentile positive star surprise is +14.10 NP, paying $563,832 to one holder.

| Tier | Players | Games | Typical absolute game / share | Typical positive game / full float | Median signed season / share | Median signed season / full float |
|---|---:|---:|---:|---:|---:|---:|
| Star | 23 | 1,639 | $218,728 | $23,066,040 | $613,625 | $61,362,494 |
| Mid | 102 | 7,217 | $192,884 | $19,061,570 | $127,279 | $12,727,924 |
| Bench | 25 | 1,833 | $169,148 | $16,721,370 | -$746,833 | -$74,683,323 |

## C. Player distribution

### Top 10

| Player | Tier | Listing | Actual salary | Games | Season / share | Full float | Cohort cash |
|---|---|---:|---:|---:|---:|---:|---:|
| Victor Wembanyama | star | $47,134,433 | $13,376,880 | 64 | $6,106,017 | $610,601,653 | $0 |
| Nickeil Alexander-Walker | mid | $24,633,840 | $15,161,800 | 78 | $6,003,812 | $600,381,156 | $18,011,435 |
| Nikola Jokic | star | $51,668,326 | $55,224,526 | 65 | $5,475,622 | $547,562,173 | $0 |
| Keyonte George | mid | $11,613,930 | $4,278,960 | 54 | $5,357,611 | $535,761,091 | $37,503,276 |
| Luka Doncic | star | $47,012,753 | $45,999,660 | 64 | $4,999,577 | $499,957,713 | $0 |
| Kevin Durant | star | $34,170,043 | $54,708,609 | 78 | $4,852,114 | $485,211,416 | $4,852,114 |
| Kawhi Leonard | star | $42,626,287 | $50,000,000 | 65 | $4,780,521 | $478,052,133 | $4,780,521 |
| Jamal Murray | star | $31,348,812 | $46,394,100 | 75 | $4,741,728 | $474,172,815 | $18,966,913 |
| Kon Knueppel | mid | $28,960,025 | $10,015,680 | 81 | $4,386,751 | $438,675,136 | $8,773,503 |
| Tim Hardaway Jr. | bench | $9,237,625 | $2,296,274 | 80 | $3,939,774 | $393,977,416 | $39,397,742 |

### Bottom 10

| Player | Tier | Listing | Actual salary | Games | Season / share | Full float | Cohort cash |
|---|---|---:|---:|---:|---:|---:|---:|
| Derrick White | star | $39,195,457 | $28,100,000 | 77 | -$8,548,365 | -$854,836,464 | $0 |
| Jamal Shead | mid | $14,540,915 | $1,955,377 | 82 | -$4,791,524 | -$479,152,423 | -$23,957,621 |
| Quentin Grimes | mid | $10,351,609 | $8,741,209 | 75 | -$4,734,951 | -$473,495,105 | -$47,349,510 |
| Payton Pritchard | mid | $27,076,042 | $7,232,143 | 79 | -$4,577,057 | -$457,705,704 | $0 |
| Herbert Jones | mid | $13,375,197 | $13,937,574 | 56 | -$4,258,111 | -$425,811,069 | -$25,548,664 |
| Miles Bridges | mid | $20,464,338 | $25,000,000 | 77 | -$4,151,821 | -$415,182,124 | -$8,303,642 |
| Sam Hauser | mid | $19,402,881 | $10,044,644 | 78 | -$3,835,825 | -$383,582,524 | -$26,850,777 |
| Luguentz Dort | mid | $12,795,543 | $18,222,222 | 69 | -$3,475,000 | -$347,500,028 | -$59,075,005 |
| Devin Booker | star | $33,011,461 | $53,142,264 | 64 | -$3,353,620 | -$335,362,047 | -$3,353,620 |
| Onyeka Okongwu | mid | $20,893,727 | $15,000,000 | 74 | -$3,272,969 | -$327,296,925 | -$16,364,846 |

The ranking is signed actual-minus-expected net points, not raw scoring. Players who outperform the selected expectation lead; underperformance debits holders. Injuries themselves create no game event.

## D. Portfolio spread

| Portfolio | Final value | P/L vs $140M | Return |
|---|---:|---:|---:|
| Best (portfolio-034) | $150,463,144 | $10,463,144 | 7.4737% |
| Median | $137,905,369 | -$2,094,631 | -1.4962% |
| Worst (portfolio-032) | $124,579,418 | -$15,420,582 | -11.0147% |

## E. Shareable player-games

### Shai Gilgeous-Alexander — 2025-10-23

55 PTS, 15-31 FG, 2-7 3PT, 23-26 FT, 8 REB, 5 AST, 2 STL, 1 BLK, 2 TO in 45 MIN. Expected **23.25 NP**, actual **43.60 NP** (surprise **+20.35**): **$814,050 per share / $81,404,980 full float**. ESPN game `401809236`.

### Nikola Jokic — 2025-12-25

56 PTS, 15-21 FG, 4-6 3PT, 22-23 FT, 16 REB, 15 AST, 0 STL, 2 BLK, 5 TO in 43 MIN. Expected **25.98 NP**, actual **59.35 NP** (surprise **+33.37**): **$1,334,675 per share / $133,467,520 full float**. ESPN game `401809242`.

### Luka Doncic — 2026-03-19

60 PTS, 18-30 FG, 9-17 3PT, 15-19 FT, 7 REB, 3 AST, 5 STL, 0 BLK, 2 TO in 38 MIN. Expected **25.06 NP**, actual **54.45 NP** (surprise **+29.39**): **$1,175,481 per share / $117,548,080 full float**. ESPN game `401810865`.

## Reproduction and caveats

All declared replay inputs are cached; the backtest performs no network calls. Universe selection uses final-season minutes (appropriate for economy evaluation, not a preseason trading strategy). Projected-WAR FV plus 10% salary is the season-level listing price (salary is used only for reported fallbacks), prices are fixed, portfolios respect the one-share-per-user-per-player cap, and negative dividends may reduce cash.
