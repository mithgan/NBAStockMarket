# Per-game economy v2 — cross-season robustness battery

Universes: top 150 per season by projected-game count (2023-24: 150 players / 11,316 games, 2024-25: 150 players / 11,143 games, 2025-26: 150 players / 11,108 games). Dollar figures at $20K/NP.

## R1. Anchor leak per settled game, all seasons (NP)

| Season | Games | trailing-10 requote | game-day projection |
|---|---:|---:|---:|
| 2023-24 | 11,316 | +0.145 ($+2,895) | +0.271 ($+5,419) |
| 2024-25 | 11,143 | +0.208 ($+4,151) | +0.464 ($+9,280) |
| 2025-26 | 11,108 | +0.173 ($+3,466) | +0.276 ($+5,523) |

## R2. TRUE last-season opening lock (the product mechanic)

Lock every listed player at his PRIOR season's produced NP/game (20+ games played there), hold all season, measure mean(actual − locked) per game.

| Season pair | Players covered | Superstar | Star | Starter | Rotation | Bench | All (NP) | All at $20K |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 2023-24 → 2024-25 | 130/150 | +1.36 | +0.62 | +1.47 | +0.26 | +0.07 | +0.635 | $+12,702/game |
| 2024-25 → 2025-26 | 128/150 | +2.00 | +1.45 | +1.51 | +0.90 | -1.53 | +0.860 | $+17,208/game |

Coverage gap = rookies/returners without a 20-game prior season; they need the projection+premium path.

## R3. Normal-user P&L bands, cross-season ($20K, fair locks)

| Season | Roster | Season P&L | Night SD | Night p95 | Week SD | Week p95 |
|---|---|---:|---:|---:|---:|---:|
| 2023-24 | balanced | $+1,210,954 | ±$292,283 | ±$538,321 | ±$741,185 | ±$1,542,457 |
| 2023-24 | stars | $+289,854 | ±$340,293 | ±$651,083 | ±$1,065,108 | ±$1,966,220 |
| 2023-24 | random ×10 | mean $+69,254 (SD $631,206) | ±$299,378 | ±$603,739 | ±$725,460 | ±$1,424,089 |
| 2024-25 | balanced | $+524,490 | ±$289,069 | ±$592,764 | ±$644,978 | ±$1,298,277 |
| 2024-25 | stars | $+232,884 | ±$355,904 | ±$738,910 | ±$813,499 | ±$1,503,346 |
| 2024-25 | random ×10 | mean $+65,234 (SD $282,991) | ±$299,007 | ±$598,831 | ±$825,342 | ±$1,580,748 |
| 2025-26 | balanced | $+605,509 | ±$248,211 | ±$503,371 | ±$611,283 | ±$1,199,023 |
| 2025-26 | stars | $-292,960 | ±$337,053 | ±$653,305 | ±$827,446 | ±$1,325,837 |
| 2025-26 | random ×10 | mean $+186,772 (SD $566,689) | ±$283,062 | ±$577,946 | ±$729,396 | ±$1,421,235 |

## R4. Shorts under fair trailing quotes (7-day windows, $20K)

| Season | Windows | Mean P&L | SD | Win rate | Superstar-after-Jan15 mean | its win rate |
|---|---:|---:|---:|---:|---:|---:|
| 2023-24 | 3,302 | $-14,456 | ±$307,876 | 49.3% | $-14,761 (89 windows) | 49.4% |
| 2024-25 | 3,271 | $-19,657 | ±$299,491 | 48.1% | $-7,606 (32 windows) | 46.9% |
| 2025-26 | 3,250 | $-18,192 | ±$293,226 | 48.7% | $+52,525 (28 windows) | 60.7% |

Random shorting is ≈ zero-EV before fees in every season (as designed); the superstar-fade meta is the structural positive-EV short.

## R5. Requote cadence: leak left by each server implementation

| Season | frozen at open | weekly full requote | nightly half-step | nightly full |
|---|---:|---:|---:|---:|
| 2023-24 | +2.440 ($+48,796) | +0.192 ($+3,833) | +0.201 ($+4,013) | +0.163 ($+3,250) |
| 2024-25 | +2.781 ($+55,623) | +0.269 ($+5,381) | +0.279 ($+5,577) | +0.230 ($+4,599) |
| 2025-26 | +2.947 ($+58,944) | +0.241 ($+4,819) | +0.247 ($+4,937) | +0.199 ($+3,988) |

Leak = mean(actual − market quote) per settled game: what a NEW lock at the prevailing quote earns for free. Frozen quotes are the money printer; any trailing requote (weekly is enough) kills ~all of it.

## R6. Retention risk for a fair user ($20K)

| Season | Roster | P(down after 7 days) | P(down after 28 days) | Max drawdown p50 | p95 |
|---|---|---:|---:|---:|---:|
| 2023-24 | balanced | yes | yes | $1,379,064 | $2,930,703 |
| 2023-24 | stars | no | no | $1,913,221 | $3,396,043 |
| 2024-25 | balanced | yes | yes | $1,196,715 | $2,955,623 |
| 2024-25 | stars | yes | yes | $1,502,290 | $2,978,045 |
| 2025-26 | balanced | yes | yes | $1,545,809 | $2,050,987 |
| 2025-26 | stars | no | no | $1,536,916 | $3,637,129 |

Single-path down/up flags are one draw each; the drawdown columns are rolling 28-day windows (peak-to-trough inside the window).
