# NBA Stock Market 2025-26 Backtest

This deterministic replay covers the 1,230-game 2025-26 NBA regular season. The universe is the top 150 players by final regular-season minutes. One hundred synthetic users each begin at $140M and hold one share of 10 unique players. Trading and inactivity decay are off; prices stay at salary-derived listings, so the measured economy is dividends minus the daily idle-cash sink.

## Method

- Actuals: 26,547 played player-games from ESPN game summaries (1,230 games).
- Salaries: `https://github.com/gabriel1200/site_Data` `salary.csv` at commit `bc583cb`; missing names filled from the pinned fallback snapshot.
- Expectation: mean of the player's prior 10 played games; salary-implied prior only before game 1. A 10-game window balances recent role/form against single-game noise; before game 1 the prior is `min(25, 5 + 0.3 * salary_in_millions)`.
- Replay: 10,689 universe player-games on 164 game days, with 174 calendar-day idle-fee passes.
- Payout conventions: per-share amounts are what one holder receives; full-float amounts are the same result across all 100 shares.

## A. Money supply

| Measure | Amount |
|---|---:|
| Starting cohort wealth | $14,000,000,000 |
| Gross positive dividends (faucet) | $214,363,224 |
| Negative dividend debits | $203,606,754 |
| Net signed dividends | $10,756,470 |
| Trading fees (trading off) | $0 |
| Idle cash sunk | $67,930,590 |
| **Net inflation** | **-$57,174,120 (-0.4084%)** |
| Ending cohort wealth | $13,942,825,880 |

Russell's answer: signed surprise dividends are close to self-cancelling at the player level, while portfolio ownership and the idle fee determine cohort inflation. The reconciliation difference is $0 (rounding only).

## B. Calibration

A great game is defined before inspection as the 90th-percentile positive surprise by a star: **+14.46 net points**. At the current `$100,000` constant that pays **$1,445,800 across the float**, versus the $800K target. The candidate exact-fit constant is `$55,333`. Decision: **retain current constant; empirical payout is within 2x of target**.

| Tier | Players | Games | Typical absolute game / share | Typical positive game / full float | Median signed season / share | Median signed season / full float |
|---|---:|---:|---:|---:|---:|---:|
| Star | 35 | 2,432 | $5,915 | $593,000 | -$3,893 | -$389,306 |
| Mid | 54 | 3,741 | $4,930 | $499,000 | $2,847 | $284,730 |
| Bench | 61 | 4,516 | $4,690 | $473,000 | $19,851 | $1,985,076 |

## C. Player distribution

### Top 10

| Player | Tier | Salary | Games | Season / share | Full float | Cohort cash |
|---|---|---:|---:|---:|---:|---:|
| Jeremiah Fears | bench | $7,520,040 | 82 | $70,616 | $7,061,563 | $776,772 |
| Amen Thompson | bench | $9,690,600 | 79 | $69,750 | $6,974,969 | $348,748 |
| Cooper Flagg | mid | $13,825,920 | 70 | $66,463 | $6,646,337 | $531,707 |
| Maxime Raynaud | bench | $1,272,870 | 74 | $66,049 | $6,604,893 | $462,343 |
| Nickeil Alexander-Walker | mid | $15,161,800 | 78 | $55,262 | $5,526,154 | $442,092 |
| Dyson Daniels | bench | $7,707,709 | 76 | $55,160 | $5,516,005 | $441,280 |
| Kyle Filipowski | bench | $3,000,000 | 77 | $50,914 | $5,091,351 | $610,962 |
| Derik Queen | bench | $5,157,960 | 81 | $46,568 | $4,656,795 | $512,247 |
| Bobby Portis | mid | $13,445,754 | 67 | $46,218 | $4,621,838 | $323,529 |
| CJ McCollum | star | $30,666,666 | 76 | $45,786 | $4,578,597 | $137,358 |

### Bottom 10

| Player | Tier | Salary | Games | Season / share | Full float | Cohort cash |
|---|---|---:|---:|---:|---:|---:|
| Nikola Vucevic | mid | $21,481,481 | 64 | -$68,652 | -$6,865,218 | -$343,261 |
| Tyrese Maxey | star | $37,958,760 | 70 | -$60,246 | -$6,024,642 | -$120,493 |
| Bennedict Mathurin | bench | $9,187,573 | 54 | -$53,541 | -$5,354,080 | -$428,326 |
| Austin Reaves | mid | $13,937,574 | 51 | -$52,618 | -$5,261,820 | -$578,800 |
| Norman Powell | mid | $20,482,758 | 58 | -$39,187 | -$3,918,661 | -$78,373 |
| Jerami Grant | star | $32,000,001 | 57 | -$38,009 | -$3,800,944 | -$114,028 |
| Zion Williamson | star | $39,446,090 | 62 | -$34,502 | -$3,450,244 | -$34,502 |
| Anthony Edwards | star | $45,550,512 | 61 | -$34,459 | -$3,445,855 | -$68,917 |
| Julius Randle | star | $30,935,520 | 79 | -$34,445 | -$3,444,526 | -$103,336 |
| Mikal Bridges | mid | $24,900,000 | 81 | -$33,599 | -$3,359,942 | -$167,997 |

The ranking is signed surprise versus each player's own trailing baseline, not raw scoring. Rising/outperforming players lead; slow starts, declining roles, and poor games following hot runs debit holders. Injuries themselves create no game event, but reduced post-return performance can cost holders.

## D. Portfolio spread

| Portfolio | Final value | P/L vs $140M | Return |
|---|---:|---:|---:|
| Best (portfolio-053) | $140,143,942 | $143,942 | 0.1028% |
| Median | $139,521,746 | -$478,254 | -0.3416% |
| Worst (portfolio-043) | $137,374,271 | -$2,625,729 | -1.8755% |

## E. Shareable player-games

### Shai Gilgeous-Alexander — 2025-10-23

55 PTS, 15-31 FG, 2-7 3PT, 23-26 FT, 8 REB, 5 AST, 2 STL, 1 BLK, 2 TO in 45 MIN. Expected **23.20 NP**, actual **43.60 NP** (surprise **+20.40**): **$20,400 per share / $2,040,000 full float**. ESPN game `401809236`.

### Nikola Jokic — 2025-12-25

56 PTS, 15-21 FG, 4-6 3PT, 22-23 FT, 16 REB, 15 AST, 0 STL, 2 BLK, 5 TO in 43 MIN. Expected **28.37 NP**, actual **59.35 NP** (surprise **+30.98**): **$30,980 per share / $3,098,000 full float**. ESPN game `401809242`.

### Luka Doncic — 2026-03-19

60 PTS, 18-30 FG, 9-17 3PT, 15-19 FT, 7 REB, 3 AST, 5 STL, 0 BLK, 2 TO in 38 MIN. Expected **27.68 NP**, actual **54.45 NP** (surprise **+26.77**): **$26,765 per share / $2,676,500 full float**. ESPN game `401810865`.

## Reproduction and caveats

The data downloader caches raw provider JSON and normalized CSV under ignored `data/raw/`; the backtest itself performs no network calls. Universe selection uses final-season minutes (appropriate for economy evaluation, not a preseason trading strategy). Salary is a season-level listing anchor, prices are fixed, portfolios hold one share per name, and negative dividends may reduce cash. Dunks & Threes is intentionally not called.
