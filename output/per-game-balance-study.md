# Per-game economy v2 — balance study

Universe: top 150 players by projected-game count, 2025-26 cache; 11,108 settled player-games. Trailing anchor = mean of last 10 produced NP (needs 3+ prior games, else game-day projection). Deterministic replay arithmetic; no synthetic order flow.

## 1. Quote anchor: long EV per settled game (net points)

Long game P&L = (actual − quote) × rate. A fair anchor has mean ≈ 0.

| Anchor | Games | Mean NP edge | SD | $/game at $20K | $/game at $40K |
|---|---:|---:|---:|---:|---:|
| first_proj | 11,108 | +2.947 | 7.10 | $+58,944 | $+117,889 |
| gameday_proj | 11,108 | +0.276 | 6.69 | $+5,523 | $+11,045 |
| trailing | 11,108 | +0.173 | 6.93 | $+3,466 | $+6,932 |
| blend | 11,108 | +0.225 | 6.73 | $+4,494 | $+8,989 |

Monthly mean NP edge (the calendar curve each anchor leaves behind):

| Month | first_proj | gameday_proj | trailing | blend |
|---|---:|---:|---:|---:|
| 2025-10 | +2.132 | +1.059 | +0.933 | +0.996 |
| 2025-11 | +2.886 | +0.534 | +0.270 | +0.402 |
| 2025-12 | +2.965 | +0.155 | +0.029 | +0.092 |
| 2026-01 | +2.638 | -0.157 | -0.042 | -0.100 |
| 2026-02 | +3.031 | +0.252 | +0.207 | +0.229 |
| 2026-03 | +3.170 | +0.140 | +0.043 | +0.092 |
| 2026-04 | +3.906 | +0.787 | +0.443 | +0.615 |

## 2. Rate scale: what a night and a season feel like

| Quantity | value in NP | at $20K/NP | at $40K/NP |
|---|---:|---:|---:|
| Top listed player, produced NP/game | 26.35 | $526,941 | $1,053,882 |
| Median listed player, produced NP/game | 8.32 | $166,480 | $332,960 |
| One-game surprise SD vs game-day projection | 6.69 | ±$133,782 | ±$267,564 |
| Full 10-slot star roster, cost turnover per played night | 196.7 | $3,934,075 | $7,868,151 |
| Typical full-roster night swing (10 independent games) | ±21.2 | ±$423,056 | ±$846,112 |

## 3. Churn: streaming premium and the neutralizing fee

Hold = fix the 10 best players by first-two-weeks projection and never touch them. Streamer = every date, hold the 10 players *playing tonight* with the highest game-day projection (drop/re-add as needed, no fee). Same anchor prices for both.

| Anchor | Hold season P&L @20K | Streamer season P&L @20K | Premium | Streamer adds | Breakeven fee/add |
|---|---:|---:|---:|---:|---:|
| gameday_proj | $+2,879,102 | $+1,604,347 | $-1,274,755 | 1,445 | $-882 |
| trailing | $-1,536,231 | $-4,879,151 | $-3,342,920 | 1,445 | $-2,313 |
| blend | $+671,436 | $-1,637,402 | $-2,308,838 | 1,445 | $-1,598 |

The streamer above plays ~2.5× the games of the holder, so most of the premium is *exposure volume* under a mispriced anchor, not skill. The breakeven fee is the per-add charge that erases the entire mindless premium at $20K/NP; scale it linearly for other rates.

## 4. Shorts: duration windows and calendar cost

Random-short EV by month, game-day-projection anchor (NP and $ at $20K):

| Month | Games | Mean short NP edge | $/game |
|---|---:|---:|---:|
| 2025-10 | 725 | -1.059 | $-21,172 |
| 2025-11 | 1,998 | -0.534 | $-10,681 |
| 2025-12 | 1,811 | -0.155 | $-3,093 |
| 2026-01 | 2,165 | +0.157 | $+3,140 |
| 2026-02 | 1,499 | -0.252 | $-5,040 |
| 2026-03 | 2,126 | -0.140 | $-2,803 |
| 2026-04 | 784 | -0.787 | $-15,737 |

| Window | Mean games caught | SD of window P&L @20K | Per-game luck SD vs 1 game |
|---|---:|---:|---:|
| 1 day | 1.00 | ±$133,782 | 1.00× |
| 3 days | 1.76 | ±$177,310 | 0.75× |
| 7 days | 3.42 | ±$246,698 | 0.54× |
| 14 days | 6.27 | ±$336,103 | 0.40× |

Luck per game of exposure shrinks as the window catches more games; the 7-day window keeps the v1 finding that one game is mostly noise while a week is a real opinion.
