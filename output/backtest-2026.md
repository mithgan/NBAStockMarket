# NBA Stock Market 2025-26 Backtest

**DECIDED DESIGN (Russ, Discord 7/12): one salary-priced share is the whole player; each user may hold at most one share per player; dividends settle actual game logs against cached Dunks & Threes pregame projections. The $40,000 per net point per holder rate is PROVISIONAL pending Mith's NBA-12 calibration.**

This deterministic replay covers the 1,230-game 2025-26 NBA regular season. The universe is the top 150 players by final regular-season minutes. One hundred synthetic users each begin at $140M and hold one share of 10 unique players. Trading and inactivity decay are off; prices stay at salary-derived listings, so the measured economy is dividends minus the daily idle-cash sink.

## Method

- Actuals: 26,547 played player-games from ESPN game summaries (1,230 games).
- Salaries: `https://github.com/gabriel1200/site_Data` `salary.csv` at commit `bc583cb`; missing names filled from the pinned fallback snapshot.
- Expectation: Dunks & Threes pre-game box-score projection; salary-implied fallback for missing player-games.
- Replay: 10,689 universe player-games on 164 game days, with 174 calendar-day idle-fee passes.
- Payout conventions: per-share amounts are what one holder receives; full-float amounts are the same result across all 100 shares.

## A. Money supply

| Measure | Amount |
|---|---:|
| Starting cohort wealth | $14,000,000,000 |
| Gross positive dividends (faucet) | $8,571,751,333 |
| Negative dividend debits | $7,417,238,113 |
| Net signed dividends | $1,154,513,219 |
| Trading fees (trading off) | $0 |
| Idle cash sunk | $93,490,082 |
| **Net inflation** | **$1,061,023,137 (7.5787%)** |
| Ending cohort wealth | $15,061,023,137 |

Russell's answer: signed surprise dividends are close to self-cancelling at the player level, while portfolio ownership and the idle fee determine cohort inflation. The reconciliation difference is $0 (rounding only).

## B. Calibration

**PROVISIONAL pending Mith's calibration (NBA-12).** The decided provisional rate is **$40,000 per net point per holder**, so a +20 surprise pays **$800,000**. The observed 90th-percentile positive star surprise is +14.07 NP, paying $562,919 to one holder.

| Tier | Players | Games | Typical absolute game / share | Typical positive game / full float | Median signed season / share | Median signed season / full float |
|---|---:|---:|---:|---:|---:|---:|
| Star | 35 | 2,432 | $220,458 | $22,761,260 | $1,834,047 | $183,404,680 |
| Mid | 54 | 3,741 | $191,826 | $19,964,060 | $971,089 | $97,108,920 |
| Bench | 61 | 4,516 | $177,051 | $17,945,510 | $682,804 | $68,280,380 |

## C. Player distribution

### Top 10

| Player | Tier | Salary | Games | Season / share | Full float | Cohort cash |
|---|---|---:|---:|---:|---:|---:|
| Nickeil Alexander-Walker | mid | $15,161,800 | 78 | $7,363,710 | $736,371,020 | $58,909,682 |
| Victor Wembanyama | mid | $13,376,880 | 64 | $7,221,831 | $722,183,080 | $21,665,492 |
| Nikola Jokic | star | $55,224,526 | 65 | $6,608,871 | $660,887,060 | $0 |
| Keyonte George | bench | $4,278,960 | 54 | $6,299,079 | $629,907,920 | $50,392,634 |
| Kevin Durant | star | $54,708,609 | 78 | $6,212,013 | $621,201,280 | $6,212,013 |
| Luka Doncic | star | $45,999,660 | 64 | $6,115,391 | $611,539,140 | $18,346,174 |
| Jamal Murray | star | $46,394,100 | 75 | $6,049,323 | $604,932,300 | $6,049,323 |
| Kawhi Leonard | star | $50,000,000 | 65 | $5,913,770 | $591,377,020 | $5,913,770 |
| Kon Knueppel | mid | $10,015,680 | 81 | $5,798,954 | $579,895,380 | $52,190,584 |
| Tim Hardaway Jr. | bench | $2,296,274 | 80 | $5,334,542 | $533,454,200 | $58,679,962 |

### Bottom 10

| Player | Tier | Salary | Games | Season / share | Full float | Cohort cash |
|---|---|---:|---:|---:|---:|---:|
| Derrick White | mid | $28,100,000 | 77 | -$7,205,901 | -$720,590,060 | -$14,411,801 |
| Quentin Grimes | bench | $8,741,209 | 75 | -$3,427,356 | -$342,735,620 | -$37,700,918 |
| Jamal Shead | bench | $1,955,377 | 82 | -$3,361,887 | -$336,188,720 | -$36,980,759 |
| Herbert Jones | mid | $13,937,574 | 56 | -$3,281,773 | -$328,177,320 | -$26,254,186 |
| Payton Pritchard | bench | $7,232,143 | 79 | -$3,199,724 | -$319,972,380 | -$19,198,343 |
| Miles Bridges | mid | $25,000,000 | 77 | -$2,809,357 | -$280,935,720 | -$25,284,215 |
| Sam Hauser | mid | $10,044,644 | 78 | -$2,475,927 | -$247,592,660 | -$17,331,486 |
| Luguentz Dort | mid | $18,222,222 | 69 | -$2,272,013 | -$227,201,302 | -$11,360,065 |
| Devin Booker | star | $53,142,264 | 64 | -$2,237,806 | -$223,780,620 | -$2,237,806 |
| Onyeka Okongwu | mid | $15,000,000 | 74 | -$1,982,809 | -$198,280,900 | -$5,948,427 |

The ranking is signed surprise versus Dunks & Threes pregame projections, not raw scoring. Players who outperform those projections lead; underperformance debits holders. Injuries themselves create no game event.

## D. Portfolio spread

| Portfolio | Final value | P/L vs $140M | Return |
|---|---:|---:|---:|
| Best (portfolio-089) | $166,079,353 | $26,079,353 | 18.6281% |
| Median | $150,265,625 | $10,265,625 | 7.3326% |
| Worst (portfolio-060) | $138,933,769 | -$1,066,231 | -0.7616% |

## E. Shareable player-games

### Shai Gilgeous-Alexander — 2025-10-23

55 PTS, 15-31 FG, 2-7 3PT, 23-26 FT, 8 REB, 5 AST, 2 STL, 1 BLK, 2 TO in 45 MIN. Expected **22.81 NP**, actual **43.60 NP** (surprise **+20.79**): **$831,484 per share / $83,148,440 full float**. ESPN game `401809236`.

### Nikola Jokic — 2025-12-25

56 PTS, 15-21 FG, 4-6 3PT, 22-23 FT, 16 REB, 15 AST, 0 STL, 2 BLK, 5 TO in 43 MIN. Expected **25.55 NP**, actual **59.35 NP** (surprise **+33.80**): **$1,352,110 per share / $135,210,980 full float**. ESPN game `401809242`.

### Luka Doncic — 2026-03-19

60 PTS, 18-30 FG, 9-17 3PT, 15-19 FT, 7 REB, 3 AST, 5 STL, 0 BLK, 2 TO in 38 MIN. Expected **24.63 NP**, actual **54.45 NP** (surprise **+29.82**): **$1,192,915 per share / $119,291,540 full float**. ESPN game `401810865`.

## Reproduction and caveats

All ESPN actuals and Dunks & Threes projections are cached; the backtest performs no network calls. Universe selection uses final-season minutes (appropriate for economy evaluation, not a preseason trading strategy). Salary is a season-level listing price, prices are fixed, portfolios respect the one-share-per-user-per-player cap, and negative dividends may reduce cash.
