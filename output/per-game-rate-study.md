# Per-game economy v2 — rate, fair-cost, and user-P&L study

Sample: 150 players selected by first projection availability strictly before 2025-11-04; 8,963 total player-games including calibration; 160 evaluation calendar days. Costs lock at the trailing-10 produced-NP anchor on add date (3+ prior games, else the saved pregame projection). Gross P&L excludes fees and quote floors; linear dollar views are diagnostics only. This partial-policy study cannot approve a rate, cap, or skill claim.

## A. Retrospective production landscape (not opening prices)

| Tier | NP/game band | Players | Mean NP | Fair cost band at $15K | at $20K | at $25K |
|---|---|---:|---:|---|---|---|
| Superstar | 20-30 | 5 | 23.4 | $301K-$395K | $401K-$527K | $501K-$659K |
| Star | 14-20 | 21 | 16.4 | $210K-$289K | $280K-$385K | $350K-$481K |
| Starter | 9-14 | 39 | 11.0 | $137K-$209K | $183K-$278K | $229K-$348K |
| Rotation | 5-9 | 47 | 6.6 | $75K-$129K | $101K-$172K | $126K-$214K |
| Bench | 0-5 | 38 | 3.1 | $-9K-$75K | $-12K-$100K | $-15K-$125K |

Example fair per-game costs (season produced NP × rate):

| Player | NP/game | at $15K | at $20K | at $25K | at $40K |
|---|---:|---:|---:|---:|---:|
| Shai Gilgeous-Alexander | 26.35 | $395,206 | $526,941 | $658,676 | $1,053,882 |
| Luka Doncic | 26.10 | $391,535 | $522,047 | $652,559 | $1,044,094 |
| Giannis Antetokounmpo | 24.19 | $362,875 | $483,833 | $604,792 | $967,667 |
| Donovan Mitchell | 20.47 | $307,104 | $409,471 | $511,839 | $818,943 |
| Joel Embiid | 20.04 | $300,553 | $400,737 | $500,921 | $801,474 |
| Jaylen Brown | 19.26 | $288,856 | $385,141 | $481,426 | $770,282 |
| Lauri Markkanen | 19.03 | $285,500 | $380,667 | $475,833 | $761,333 |
| Stephen Curry | 18.55 | $278,180 | $370,907 | $463,634 | $741,814 |

Retrospective p05 production is 1.73 NP; p05 alone reaches the $25K floor at $14,463/NP. Test D checks the minimum player, not p05.

## B. Descriptive noise anatomy and an independence approximation

| Tier | Games | Per-game edge SD (NP) | SD at $20K |
|---|---:|---:|---:|
| Superstar | 249 | 9.40 | ±$188,054 |
| Star | 1,186 | 8.36 | ±$167,153 |
| Starter | 2,217 | 7.54 | ±$150,827 |
| Rotation | 2,667 | 6.25 | ±$125,082 |
| Bench | 1,702 | 4.86 | ±$97,220 |
| **All listed** | 8,021 | 6.84 | ±$136,846 |

Schedule density: a listed player plays 0.33 games per calendar night → a full 10-slot roster catches ≈ 3.3 games/night and ≈ 23 games/week.

Analytic fair-roster swing: night SD ≈ 12.5 NP, week SD ≈ 33.1 NP (dollar values in test D).

## C. Archetype replay: a season of daily P&L (costs locked at add)

Calendar-day observations include zero-return days. The streamer knows realized participation; it is an oracle diagnostic, not an executable policy.

| Archetype | Adds | Season P&L (NP) | Daily mean | Daily SD | Daily p05 | Daily p95 |
|---|---:|---:|---:|---:|---:|---:|
| star holder | 10 | -1030 | -6.44 | 17.2 | -36.8 | +23.1 |
| balanced holder | 10 | -28 | -0.18 | 13.9 | -25.1 | +22.8 |
| bench holder | 10 | +114 | +0.71 | 7.6 | -10.5 | +14.8 |
| participation-oracle streamer | 1342 | -275 | -1.72 | 26.7 | -43.8 | +44.9 |
| momentum chaser | 190 | +68 | +0.42 | 13.4 | -22.1 | +20.1 |
| weekly random (10 seeds pooled) | 215 | +84 | +0.52 | 12.3 | -19.0 | +20.5 |

Random-seed season spread (weekly random, NP): -163, +94, +167, +106, +383, +55, +253, -8, -168, +117

| Archetype | Weekly mean (NP) | Weekly SD | Weekly p05 | Weekly p95 |
|---|---:|---:|---:|---:|
| star holder | -44.79 | 39.5 | -119.0 | +6.9 |
| balanced holder | -1.24 | 30.8 | -70.4 | +31.9 |
| bench holder | +4.94 | 19.8 | -31.7 | +34.1 |
| participation-oracle streamer | -11.94 | 65.5 | -102.0 | +58.3 |
| momentum chaser | +2.94 | 32.8 | -46.0 | +48.6 |
| weekly random (10 seeds pooled) | +3.64 | 34.7 | -51.8 | +63.6 |

## D. Rate sweep against legibility bands

Bands: a normal night p95 should land between $150K and $750K; a normal week p95 between $500K and $2M; the non-oracle season archetype SD below $10M; the minimum retrospective player mean above the $25K floor; a superstar cost under $1M/game so the anchor column stays readable.

| Rate | Star cost/game | Minimum player cost | Night p95 (balanced) | Worst star night p99 | Week p95 | Season archetype SD | Floor OK | Verdict |
|---|---:|---:|---:|---:|---:|---:|:---:|---|
| $10K | $263,471 | $-5,900 | ±$307,540 | ±$467,536 | ±$704,062 | $4,709,598 | no | floor binds |
| $15K | $395,206 | $-8,850 | ±$461,310 | ±$701,304 | ±$1,056,093 | $7,064,397 | no | floor binds |
| $20K | $526,941 | $-11,800 | ±$615,080 | ±$935,072 | ±$1,408,124 | $9,419,196 | no | floor binds |
| $25K | $658,676 | $-14,750 | ±$768,850 | ±$1,168,840 | ±$1,760,155 | $11,773,995 | no | floor binds; night outside band; season spread outside band |
| $30K | $790,412 | $-17,700 | ±$922,620 | ±$1,402,607 | ±$2,112,186 | $14,128,795 | no | floor binds; night outside band; week outside band; season spread outside band |
| $40K | $1,053,882 | $-23,600 | ±$1,230,160 | ±$1,870,143 | ±$2,816,248 | $18,838,393 | no | floor binds; night outside band; week outside band; season spread outside band; star cost not under $1M |

## E. Descriptive strategy differences (rate-free; not a skill test)

Weekly-random season P&L across 10 seeds: mean +84 NP, SD 161 NP. Archetype season totals (NP): star -1030, bench +114, streamer -275, momentum +68.

Distance from random in random-SDs: star -6.9σ, bench +0.2σ, oracle streamer -2.2σ, momentum -0.1σ. These signed distances are descriptive, not significance tests.

## F. Gross dividend scale (not net money supply)

| Rate | Sample dividend flow/calendar night (150 players) | Illustrative p75 roster gross flow/night |
|---|---:|---:|
| $10K | $4,541,972 | ≈ $385,265 |
| $15K | $6,812,958 | ≈ $577,897 |
| $20K | $9,083,944 | ≈ $770,530 |
| $25K | $11,354,930 | ≈ $963,162 |
| $30K | $13,625,916 | ≈ $1,155,795 |
| $40K | $18,167,888 | ≈ $1,541,060 |

The illustrative roster uses the retrospective p75 player mean and average schedule density. Gross dividend totals alone do not estimate net money creation; that requires actual costs, fees and position counts.
