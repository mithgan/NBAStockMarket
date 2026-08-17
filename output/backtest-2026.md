# NBA Stock Market 2025-26 Backtest

**DECIDED DESIGN (Russ, Discord 7/12): one opening-price-model share is the whole player; each user may hold at most one share per player; dividends settle actual game logs against Dunks & Threes pre-game box-score projection; salary-implied fallback for missing player-games. This replay uses $80,000 per net point per holder and applies the automatically computed +0.43586494964917194 NP/player-game league-mean surprise correction. Listings use projected-WAR FV plus 10% salary.**

This deterministic replay covers the 1,230-game 2025-26 NBA regular season. The universe is the top 150 players by final regular-season minutes. One hundred synthetic users each begin at $207,824,000 and hold one share of 10 unique players. Trading and inactivity decay are off; prices stay at opening-price-model listings, so the measured economy is dividends minus the daily idle-cash sink.

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
| Starting cohort wealth | $20,782,400,000 |
| Gross positive dividends (faucet) | $15,923,623,229 |
| Negative dividend debits | $16,172,411,393 |
| Net signed dividends | -$248,788,164 |
| Trading fees (trading off) | $0 |
| Idle cash sunk | $113,818,781 |
| **Net inflation** | **-$362,606,945 (-1.7448%)** |
| Ending cohort wealth | $20,419,793,055 |

The league-mean correction removes systematic projection inflation by design; the remaining cohort deflation reflects non-uniform ownership and the intended idle-cash sink. The reconciliation difference is $0 (rounding only).

## B. Calibration

**SELECTED 2026-08-15 by deterministic candidate replay.** The decided rate is **$80,000 per net point per holder**, so a +20 surprise pays **$1,600,000**. The observed 90th-percentile positive star surprise is +14.10 NP, paying $1,127,663 to one holder.

| Tier | Players | Games | Typical absolute game / share | Typical positive game / full float | Median signed season / share | Median signed season / full float |
|---|---:|---:|---:|---:|---:|---:|
| Star | 23 | 1,639 | $437,455 | $46,132,080 | $1,227,250 | $122,724,988 |
| Mid | 102 | 7,217 | $385,768 | $38,123,140 | $254,558 | $25,455,848 |
| Bench | 25 | 1,833 | $338,296 | $33,442,740 | -$1,493,666 | -$149,366,647 |

## C. Player distribution

### Top 10

| Player | Tier | Listing | Actual salary | Games | Season / share | Full float | Cohort cash |
|---|---|---:|---:|---:|---:|---:|---:|
| Victor Wembanyama | star | $47,134,433 | $13,376,880 | 64 | $12,212,033 | $1,221,203,306 | $24,424,066 |
| Nickeil Alexander-Walker | mid | $24,633,840 | $15,161,800 | 78 | $12,007,623 | $1,200,762,311 | $60,038,116 |
| Nikola Jokic | star | $51,668,326 | $55,224,526 | 65 | $10,951,243 | $1,095,124,346 | $32,853,730 |
| Keyonte George | mid | $11,613,930 | $4,278,960 | 54 | $10,715,222 | $1,071,522,182 | $53,576,109 |
| Luka Doncic | star | $47,012,753 | $45,999,660 | 64 | $9,999,154 | $999,915,426 | $19,998,309 |
| Kevin Durant | star | $34,170,043 | $54,708,609 | 78 | $9,704,228 | $970,422,831 | $19,408,457 |
| Kawhi Leonard | star | $42,626,287 | $50,000,000 | 65 | $9,561,043 | $956,104,266 | $19,122,085 |
| Jamal Murray | star | $31,348,812 | $46,394,100 | 75 | $9,483,456 | $948,345,630 | $47,417,282 |
| Kon Knueppel | mid | $28,960,025 | $10,015,680 | 81 | $8,773,503 | $877,350,273 | $43,867,514 |
| Tim Hardaway Jr. | bench | $9,237,625 | $2,296,274 | 80 | $7,879,548 | $787,954,832 | $39,397,742 |

### Bottom 10

| Player | Tier | Listing | Actual salary | Games | Season / share | Full float | Cohort cash |
|---|---|---:|---:|---:|---:|---:|---:|
| Derrick White | star | $39,195,457 | $28,100,000 | 77 | -$17,096,729 | -$1,709,672,929 | -$51,290,188 |
| Jamal Shead | mid | $14,540,915 | $1,955,377 | 82 | -$9,583,048 | -$958,304,847 | -$105,413,533 |
| Quentin Grimes | mid | $10,351,609 | $8,741,209 | 75 | -$9,469,902 | -$946,990,210 | -$66,289,315 |
| Payton Pritchard | mid | $27,076,042 | $7,232,143 | 79 | -$9,154,114 | -$915,411,408 | -$36,616,456 |
| Herbert Jones | mid | $13,375,197 | $13,937,574 | 56 | -$8,516,221 | -$851,622,137 | -$68,129,771 |
| Miles Bridges | mid | $20,464,338 | $25,000,000 | 77 | -$8,303,642 | -$830,364,249 | -$83,036,425 |
| Sam Hauser | mid | $19,402,881 | $10,044,644 | 78 | -$7,671,650 | -$767,165,049 | -$61,373,204 |
| Luguentz Dort | mid | $12,795,543 | $18,222,222 | 69 | -$6,950,001 | -$695,000,056 | -$90,350,007 |
| Devin Booker | star | $33,011,461 | $53,142,264 | 64 | -$6,707,241 | -$670,724,094 | -$13,414,482 |
| Onyeka Okongwu | mid | $20,893,727 | $15,000,000 | 74 | -$6,545,938 | -$654,593,850 | -$39,275,631 |

The ranking is signed actual-minus-expected net points, not raw scoring. Players who outperform the selected expectation lead; underperformance debits holders. Injuries themselves create no game event.

## D. Portfolio spread

| Portfolio | Final value | P/L vs $207,824,000 | Return |
|---|---:|---:|---:|
| Best (portfolio-007) | $233,567,034 | $25,743,034 | 12.3869% |
| Median | $203,899,558 | -$3,924,442 | -1.8883% |
| Worst (portfolio-055) | $157,352,917 | -$50,471,083 | -24.2855% |

## E. Shareable player-games

### Shai Gilgeous-Alexander — 2025-10-23

55 PTS, 15-31 FG, 2-7 3PT, 23-26 FT, 8 REB, 5 AST, 2 STL, 1 BLK, 2 TO in 45 MIN. Expected **23.25 NP**, actual **43.60 NP** (surprise **+20.35**): **$1,628,100 per share / $162,809,960 full float**. ESPN game `401809236`.

### Nikola Jokic — 2025-12-25

56 PTS, 15-21 FG, 4-6 3PT, 22-23 FT, 16 REB, 15 AST, 0 STL, 2 BLK, 5 TO in 43 MIN. Expected **25.98 NP**, actual **59.35 NP** (surprise **+33.37**): **$2,669,350 per share / $266,935,040 full float**. ESPN game `401809242`.

### Luka Doncic — 2026-03-19

60 PTS, 18-30 FG, 9-17 3PT, 15-19 FT, 7 REB, 3 AST, 5 STL, 0 BLK, 2 TO in 38 MIN. Expected **25.06 NP**, actual **54.45 NP** (surprise **+29.39**): **$2,350,962 per share / $235,096,160 full float**. ESPN game `401810865`.

## Reproduction and caveats

All declared replay inputs are cached; the backtest performs no network calls. Universe selection uses final-season minutes (appropriate for economy evaluation, not a preseason trading strategy). Projected-WAR FV plus 10% salary is the season-level listing price (salary is used only for reported fallbacks), prices are fixed, portfolios respect the one-share-per-user-per-player cap, and negative dividends may reduce cash.
