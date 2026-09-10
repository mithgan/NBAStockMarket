# Per-game economy v2 — balance study

Sample: 150 players observed strictly before 2025-11-04; 8,963 settled player-games. Trailing anchor = mean of last 10 produced NP (needs 3+ prior games, else game-day projection). Gross, unfloored diagnostics only; not a rate, fee or full-policy recommendation. Evaluation starts after calibration; no synthetic order flow.

## 1. Quote anchor: long EV per settled game (net points)

Matched-game gross residual = (actual − quote) × rate, before fees/floors. This is a quote-error diagnostic, not a held-position replay.

| Anchor | Games | Mean NP edge | SD | $/game at $20K | $/game at $40K |
|---|---:|---:|---:|---:|---:|
| first_proj | 8,021 | +2.353 | 7.07 | $+47,063 | $+94,127 |
| gameday_proj | 8,021 | +0.214 | 6.60 | $+4,274 | $+8,549 |
| trailing | 8,021 | +0.005 | 6.84 | $+101 | $+201 |
| blend | 8,021 | +0.109 | 6.62 | $+2,188 | $+4,375 |

Monthly mean NP edge (the calendar curve each anchor leaves behind):

| Month | first_proj | gameday_proj | trailing | blend |
|---|---:|---:|---:|---:|
| 2025-11 | +2.378 | +0.341 | -0.105 | +0.118 |
| 2025-12 | +2.469 | +0.276 | +0.013 | +0.144 |
| 2026-01 | +2.179 | -0.010 | -0.161 | -0.085 |
| 2026-02 | +2.362 | +0.251 | +0.122 | +0.187 |
| 2026-03 | +2.237 | +0.073 | +0.055 | +0.064 |
| 2026-04 | +2.832 | +0.699 | +0.393 | +0.546 |

## 2. Rate scale: what a night and a season feel like

| Quantity | value in NP | at $20K/NP | at $40K/NP |
|---|---:|---:|---:|
| Top listed player, produced NP/game | 26.31 | $526,197 | $1,052,393 |
| Median listed player, produced NP/game | 7.59 | $151,864 | $303,727 |
| One-game surprise SD vs game-day projection | 6.60 | ±$132,027 | ±$264,054 |
| Retrospective top 10 roster, hypothetical turnover if all 10 play | 208.0 | $4,159,512 | $8,319,024 |
| Independence approximation, 10 games (not observed nightly risk) | ±20.9 | ±$417,506 | ±$835,012 |

## 3. Churn: streaming premium and the neutralizing fee

Evaluation starts 2025-11-04, after fixed-roster selection. Both rosters are repriced every played game in this diagnostic (not locked-position policy). The streamer knows realized participation, so it is a participation oracle. Quotes are unfloored and fees are omitted until the break-even calculation.

| Anchor | Hold season P&L @20K | Streamer season P&L @20K | Premium | Streamer adds | Holder adds | Hold games | Stream games | Breakeven fee/incremental add |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| gameday_proj | $+4,309,299 | $-483,033 | $-4,792,332 | 1,342 | 10 | 517 | 1500 | $-3,598 |
| trailing | $-1,741,237 | $-5,702,104 | $-3,960,867 | 1,342 | 10 | 517 | 1500 | $-2,974 |
| blend | $+1,284,031 | $-3,092,568 | $-4,376,599 | 1,342 | 10 | 517 | 1500 | $-3,286 |

The break-even fee solves equal after-fee returns for these traces: gross premium divided by (streamer adds minus holder adds). Negative values mean the streamer already underperforms before fees. Exposure counts are shown explicitly. This oracle/continuous-requote diagnostic cannot choose the live churn fee.

## 4. Shorts: duration windows and calendar cost

Global league observation horizon: 2026-04-12. Windows ending after this date are omitted and counted, including incomplete final fragments. Player inactivity does not shorten this horizon.

Random-short EV by month, game-day-projection anchor (NP and $ at $20K):

| Month | Games | Mean short NP edge | $/game |
|---|---:|---:|---:|
| 2025-11 | 1,565 | -0.341 | $-6,823 |
| 2025-12 | 1,390 | -0.276 | $-5,511 |
| 2026-01 | 1,687 | +0.010 | $+199 |
| 2026-02 | 1,186 | -0.251 | $-5,020 |
| 2026-03 | 1,625 | -0.073 | $-1,470 |
| 2026-04 | 568 | -0.699 | $-13,979 |

| Window | Complete windows | Incomplete omitted | Mean games caught | SD of window P&L @20K | Per-game SD vs 1 game |
|---|---:|---:|---:|---:|---:|
| 1 day | 8,021 | 0 | 1.00 | ±$132,027 | 1.00× |
| 3 days | 4,699 | 32 | 1.70 | ±$170,705 | 0.80× |
| 7 days | 2,440 | 83 | 3.22 | ±$231,959 | 0.57× |
| 14 days | 1,313 | 107 | 5.83 | ±$315,357 | 0.45× |

Per-game SD is computed across each complete window's actual average, not SD(total)/mean(games). Variability is unavailable with fewer than two complete windows. Windows start at played games and have no fees, expiry ordering or demand impact. These residual diagnostics do not validate a seven-day short policy or isolate skill from noise.
