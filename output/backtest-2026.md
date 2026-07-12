# NBA Stock Market 2025-26 Backtest

**DECIDED DESIGN (Russ, Discord 7/12): one opening-price-model share is the whole player; each user may hold at most one share per player; dividends settle actual game logs against cached Dunks & Threes pregame projections. The $40,000 per net point per holder rate is PROVISIONAL pending Mith's NBA-12 calibration. Listings use Mith's impact + salary blend.**

This deterministic replay covers the 1,230-game 2025-26 NBA regular season. The universe is the top 150 players by final regular-season minutes. One hundred synthetic users each begin at $140M and hold one share of 10 unique players. Trading and inactivity decay are off; prices stay at opening-price-model listings, so the measured economy is dividends minus the daily idle-cash sink.

## Method

- Actuals: 26,547 played player-games from ESPN game summaries (1,230 games).
- Salaries: `https://github.com/gabriel1200/site_Data` `salary.csv` at commit `bc583cb`; missing names filled from the pinned fallback snapshot.
- Listings: Mith's committed impact + salary blend; 0 of 150 players fall back to salary (none).
- Expectation: Dunks & Threes pre-game box-score projection; salary-implied fallback for missing player-games.
- Replay: 10,689 universe player-games on 164 game days, with 174 calendar-day idle-fee passes.
- Payout conventions: per-share amounts are what one holder receives; full-float amounts are the same result across all 100 shares.

## A. Money supply

| Measure | Amount |
|---|---:|
| Starting cohort wealth | $14,000,000,000 |
| Gross positive dividends (faucet) | $8,481,552,166 |
| Negative dividend debits | $7,380,073,210 |
| Net signed dividends | $1,101,478,956 |
| Trading fees (trading off) | $0 |
| Idle cash sunk | $84,069,806 |
| **Net inflation** | **$1,017,409,150 (7.2672%)** |
| Ending cohort wealth | $15,017,409,150 |

Russell's answer: signed surprise dividends are close to self-cancelling at the player level, while portfolio ownership and the idle fee determine cohort inflation. The reconciliation difference is $0 (rounding only).

## B. Calibration

**PROVISIONAL pending Mith's calibration (NBA-12).** The decided provisional rate is **$40,000 per net point per holder**, so a +20 surprise pays **$800,000**. The observed 90th-percentile positive star surprise is +14.38 NP, paying $575,317 to one holder.

| Tier | Players | Games | Typical absolute game / share | Typical positive game / full float | Median signed season / share | Median signed season / full float |
|---|---:|---:|---:|---:|---:|---:|
| Star | 19 | 1,314 | $225,057 | $24,751,570 | $2,105,391 | $210,539,120 |
| Mid | 86 | 6,067 | $194,209 | $19,827,770 | $1,163,709 | $116,370,900 |
| Bench | 45 | 3,308 | $175,826 | $18,025,840 | $1,027,263 | $102,726,300 |

## C. Player distribution

### Top 10

| Player | Tier | Listing price | Games | Season / share | Full float | Cohort cash |
|---|---|---:|---:|---:|---:|---:|
| Nickeil Alexander-Walker | mid | $13,376,003 | 78 | $7,363,710 | $736,371,020 | $81,000,812 |
| Victor Wembanyama | star | $45,741,439 | 64 | $7,221,831 | $722,183,080 | $0 |
| Nikola Jokic | star | $57,985,817 | 65 | $6,608,871 | $660,887,060 | $0 |
| Keyonte George | bench | $7,661,869 | 54 | $6,299,079 | $629,907,920 | $62,990,792 |
| Kevin Durant | star | $35,346,797 | 78 | $6,212,013 | $621,201,280 | $0 |
| Luka Doncic | star | $45,513,838 | 64 | $6,115,391 | $611,539,140 | $6,115,391 |
| Jamal Murray | mid | $29,545,167 | 75 | $6,049,323 | $604,932,300 | $0 |
| Kawhi Leonard | star | $45,081,675 | 65 | $5,913,770 | $591,377,020 | $11,827,540 |
| Kon Knueppel | mid | $15,952,592 | 81 | $5,798,954 | $579,895,380 | $28,994,769 |
| Tim Hardaway Jr. | bench | $5,177,427 | 80 | $5,334,542 | $533,454,200 | $53,345,420 |

### Bottom 10

| Player | Tier | Listing price | Games | Season / share | Full float | Cohort cash |
|---|---|---:|---:|---:|---:|---:|
| Derrick White | star | $37,706,830 | 77 | -$7,205,901 | -$720,590,060 | $0 |
| Quentin Grimes | bench | $2,562,481 | 75 | -$3,427,356 | -$342,735,620 | -$30,846,206 |
| Jamal Shead | bench | $9,746,697 | 82 | -$3,361,887 | -$336,188,720 | -$40,342,646 |
| Herbert Jones | mid | $10,385,487 | 56 | -$3,281,773 | -$328,177,320 | -$26,254,186 |
| Payton Pritchard | mid | $19,156,234 | 79 | -$3,199,724 | -$319,972,380 | -$15,998,619 |
| Miles Bridges | mid | $18,919,025 | 77 | -$2,809,357 | -$280,935,720 | -$25,284,215 |
| Sam Hauser | mid | $14,142,412 | 78 | -$2,475,927 | -$247,592,660 | -$24,759,266 |
| Luguentz Dort | mid | $10,428,906 | 69 | -$2,272,013 | -$227,201,302 | -$20,448,117 |
| Devin Booker | star | $36,223,145 | 64 | -$2,237,806 | -$223,780,620 | -$4,475,612 |
| Onyeka Okongwu | mid | $16,928,310 | 74 | -$1,982,809 | -$198,280,900 | -$1,982,809 |

The ranking is signed surprise versus Dunks & Threes pregame projections, not raw scoring. Players who outperform those projections lead; underperformance debits holders. Injuries themselves create no game event.

## D. Portfolio spread

| Portfolio | Final value | P/L vs $140M | Return |
|---|---:|---:|---:|
| Best (portfolio-048) | $168,604,261 | $28,604,261 | 20.4316% |
| Median | $149,776,694 | $9,776,694 | 6.9834% |
| Worst (portfolio-068) | $134,445,721 | -$5,554,279 | -3.9673% |

## E. Shareable player-games

### Shai Gilgeous-Alexander — 2025-10-23

55 PTS, 15-31 FG, 2-7 3PT, 23-26 FT, 8 REB, 5 AST, 2 STL, 1 BLK, 2 TO in 45 MIN. Expected **22.81 NP**, actual **43.60 NP** (surprise **+20.79**): **$831,484 per share / $83,148,440 full float**. ESPN game `401809236`.

### Nikola Jokic — 2025-12-25

56 PTS, 15-21 FG, 4-6 3PT, 22-23 FT, 16 REB, 15 AST, 0 STL, 2 BLK, 5 TO in 43 MIN. Expected **25.55 NP**, actual **59.35 NP** (surprise **+33.80**): **$1,352,110 per share / $135,210,980 full float**. ESPN game `401809242`.

### Luka Doncic — 2026-03-19

60 PTS, 18-30 FG, 9-17 3PT, 15-19 FT, 7 REB, 3 AST, 5 STL, 0 BLK, 2 TO in 38 MIN. Expected **24.63 NP**, actual **54.45 NP** (surprise **+29.82**): **$1,192,915 per share / $119,291,540 full float**. ESPN game `401810865`.

## Reproduction and caveats

All ESPN actuals and Dunks & Threes projections are cached; the backtest performs no network calls. Universe selection uses final-season minutes (appropriate for economy evaluation, not a preseason trading strategy). Mith's impact + salary blend is the season-level listing price (salary is used only for reported fallbacks), prices are fixed, portfolios respect the one-share-per-user-per-player cap, and negative dividends may reduce cash.
