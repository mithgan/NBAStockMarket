# NBA Stock Market 2025-26 Backtest

**DECIDED DESIGN (Russ, Discord 7/12): one opening-price-model share is the whole player; each user may hold at most one share per player; dividends settle actual game logs against cached Dunks & Threes pregame projections. The decided economy keeps $40,000 per net point per holder and applies the league-mean expectation-bias correction. Listings use Mith's impact + salary blend.**

This deterministic replay covers the 1,230-game 2025-26 NBA regular season. The universe is the top 150 players by final regular-season minutes. One hundred synthetic users each begin at $140M and hold one share of 10 unique players. Trading and inactivity decay are off; prices stay at opening-price-model listings, so the measured economy is dividends minus the daily idle-cash sink.

## Method

- Actuals: 26,547 played player-games from ESPN game summaries (1,230 games).
- Salaries: `https://github.com/gabriel1200/site_Data` `salary.csv` at commit `bc583cb`; missing names filled from the pinned fallback snapshot.
- Listings: Mith's committed impact + salary blend; 0 of 150 players fall back to salary (none).
- Expectation: Dunks & Threes pre-game box-score projection; salary-implied fallback for missing player-games. Expectations include the automatically computed +0.43586494964917194 NP/player-game league-mean surprise correction.
- Replay: 10,689 universe player-games on 164 game days, with 174 calendar-day idle-fee passes.
- Payout conventions: per-share amounts are what one holder receives; full-float amounts are the same result across all 100 shares.

## A. Money supply

| Measure | Amount |
|---|---:|
| Starting cohort wealth | $14,000,000,000 |
| Gross positive dividends (faucet) | $7,864,796,120 |
| Negative dividend debits | $8,018,433,872 |
| Net signed dividends | -$153,637,753 |
| Trading fees (trading off) | $0 |
| Idle cash sunk | $63,055,375 |
| **Net inflation** | **-$216,693,128 (-1.5478%)** |
| Ending cohort wealth | $13,783,306,872 |

The league-mean correction removes systematic projection inflation by design; the remaining cohort deflation reflects non-uniform ownership and the intended idle-cash sink. The reconciliation difference is $0 (rounding only).

## B. Calibration

**DECIDED 2026-07-14 (Mith, Discord 7/14).** The decided rate is **$40,000 per net point per holder**, so a +20 surprise pays **$800,000**. The observed 90th-percentile positive star surprise is +14.17 NP, paying $566,702 to one holder.

| Tier | Players | Games | Typical absolute game / share | Typical positive game / full float | Median signed season / share | Median signed season / full float |
|---|---:|---:|---:|---:|---:|---:|
| Star | 19 | 1,314 | $225,128 | $24,590,140 | $797,796 | $79,779,635 |
| Mid | 86 | 6,067 | $194,666 | $19,074,980 | -$75,348 | -$7,534,785 |
| Bench | 45 | 3,308 | $176,931 | $17,697,480 | -$205,587 | -$20,558,662 |

## C. Player distribution

### Top 10

| Player | Tier | Listing | Actual salary | Games | Season / share | Full float | Cohort cash |
|---|---|---:|---:|---:|---:|---:|---:|
| Victor Wembanyama | star | $45,741,439 | $13,376,880 | 64 | $6,106,017 | $610,601,653 | $0 |
| Nickeil Alexander-Walker | mid | $13,376,003 | $15,161,800 | 78 | $6,003,812 | $600,381,156 | $66,041,927 |
| Nikola Jokic | star | $57,985,817 | $55,224,526 | 65 | $5,475,622 | $547,562,173 | $0 |
| Keyonte George | bench | $7,661,869 | $4,278,960 | 54 | $5,357,611 | $535,761,091 | $53,576,109 |
| Luka Doncic | star | $45,513,838 | $45,999,660 | 64 | $4,999,577 | $499,957,713 | $4,999,577 |
| Kevin Durant | star | $35,346,797 | $54,708,609 | 78 | $4,852,114 | $485,211,416 | $0 |
| Kawhi Leonard | star | $45,081,675 | $50,000,000 | 65 | $4,780,521 | $478,052,133 | $9,561,043 |
| Jamal Murray | mid | $29,545,167 | $46,394,100 | 75 | $4,741,728 | $474,172,815 | $0 |
| Kon Knueppel | mid | $15,952,592 | $10,015,680 | 81 | $4,386,751 | $438,675,136 | $21,933,757 |
| Tim Hardaway Jr. | bench | $5,177,427 | $2,296,274 | 80 | $3,939,774 | $393,977,416 | $39,397,742 |

### Bottom 10

| Player | Tier | Listing | Actual salary | Games | Season / share | Full float | Cohort cash |
|---|---|---:|---:|---:|---:|---:|---:|
| Derrick White | star | $37,706,830 | $28,100,000 | 77 | -$8,548,365 | -$854,836,464 | $0 |
| Jamal Shead | bench | $9,746,697 | $1,955,377 | 82 | -$4,791,524 | -$479,152,423 | -$57,498,291 |
| Quentin Grimes | bench | $2,562,481 | $8,741,209 | 75 | -$4,734,951 | -$473,495,105 | -$42,614,559 |
| Payton Pritchard | mid | $19,156,234 | $7,232,143 | 79 | -$4,577,057 | -$457,705,704 | -$22,885,285 |
| Herbert Jones | mid | $10,385,487 | $13,937,574 | 56 | -$4,258,111 | -$425,811,069 | -$34,064,886 |
| Miles Bridges | mid | $18,919,025 | $25,000,000 | 77 | -$4,151,821 | -$415,182,124 | -$37,366,391 |
| Sam Hauser | mid | $14,142,412 | $10,044,644 | 78 | -$3,835,825 | -$383,582,524 | -$38,358,252 |
| Luguentz Dort | mid | $10,428,906 | $18,222,222 | 69 | -$3,475,000 | -$347,500,028 | -$31,275,003 |
| Devin Booker | star | $36,223,145 | $53,142,264 | 64 | -$3,353,620 | -$335,362,047 | -$6,707,241 |
| Onyeka Okongwu | mid | $16,928,310 | $15,000,000 | 74 | -$3,272,969 | -$327,296,925 | -$3,272,969 |

The ranking is signed surprise versus Dunks & Threes pregame projections, not raw scoring. Players who outperform those projections lead; underperformance debits holders. Injuries themselves create no game event.

## D. Portfolio spread

| Portfolio | Final value | P/L vs $140M | Return |
|---|---:|---:|---:|
| Best (portfolio-048) | $156,270,509 | $16,270,509 | 11.6218% |
| Median | $137,649,206 | -$2,350,794 | -1.6791% |
| Worst (portfolio-068) | $121,432,015 | -$18,567,985 | -13.2628% |

## E. Shareable player-games

### Shai Gilgeous-Alexander — 2025-10-23

55 PTS, 15-31 FG, 2-7 3PT, 23-26 FT, 8 REB, 5 AST, 2 STL, 1 BLK, 2 TO in 45 MIN. Expected **23.25 NP**, actual **43.60 NP** (surprise **+20.35**): **$814,050 per share / $81,404,980 full float**. ESPN game `401809236`.

### Nikola Jokic — 2025-12-25

56 PTS, 15-21 FG, 4-6 3PT, 22-23 FT, 16 REB, 15 AST, 0 STL, 2 BLK, 5 TO in 43 MIN. Expected **25.98 NP**, actual **59.35 NP** (surprise **+33.37**): **$1,334,675 per share / $133,467,520 full float**. ESPN game `401809242`.

### Luka Doncic — 2026-03-19

60 PTS, 18-30 FG, 9-17 3PT, 15-19 FT, 7 REB, 3 AST, 5 STL, 0 BLK, 2 TO in 38 MIN. Expected **25.06 NP**, actual **54.45 NP** (surprise **+29.39**): **$1,175,481 per share / $117,548,080 full float**. ESPN game `401810865`.

## Reproduction and caveats

All ESPN actuals and Dunks & Threes projections are cached; the backtest performs no network calls. Universe selection uses final-season minutes (appropriate for economy evaluation, not a preseason trading strategy). Mith's impact + salary blend is the season-level listing price (salary is used only for reported fallbacks), prices are fixed, portfolios respect the one-share-per-user-per-player cap, and negative dividends may reduce cash.
