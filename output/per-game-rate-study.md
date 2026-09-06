# Per-game economy v2 — rate, fair-cost, and user-P&L study

Universe: top 150 players by projected-game count; 11,108 settled player-games; 164 game dates. Costs lock at the trailing-10 produced-NP anchor on add date (3+ prior games, else the saved pregame projection). All P&L computed in NP first; dollars are linear in the rate.

## A. Production landscape and the fair-cost table

| Tier | NP/game band | Players | Mean NP | Fair cost band at $15K | at $20K | at $25K |
|---|---|---:|---:|---|---|---|
| Superstar | 20-30 | 3 | 22.7 | $307K-$395K | $409K-$527K | $512K-$659K |
| Star | 14-20 | 19 | 16.5 | $211K-$289K | $281K-$385K | $352K-$481K |
| Starter | 9-14 | 47 | 11.0 | $135K-$209K | $180K-$278K | $225K-$348K |
| Rotation | 5-9 | 55 | 6.9 | $75K-$134K | $100K-$179K | $125K-$224K |
| Bench | 0-5 | 26 | 3.7 | $27K-$74K | $36K-$99K | $45K-$123K |

Example fair per-game costs (season produced NP × rate):

| Player | NP/game | at $15K | at $20K | at $25K | at $40K |
|---|---:|---:|---:|---:|---:|
| Shai Gilgeous-Alexander | 26.35 | $395,206 | $526,941 | $658,676 | $1,053,882 |
| Tyrese Maxey | 21.26 | $318,857 | $425,143 | $531,429 | $850,286 |
| Donovan Mitchell | 20.47 | $307,104 | $409,471 | $511,839 | $818,943 |
| Jaylen Brown | 19.26 | $288,856 | $385,141 | $481,426 | $770,282 |
| Jamal Murray | 19.16 | $287,400 | $383,200 | $479,000 | $766,400 |
| Jalen Johnson | 18.65 | $279,750 | $373,000 | $466,250 | $746,000 |
| Kevin Durant | 18.37 | $275,567 | $367,423 | $459,279 | $734,846 |
| Jalen Duren | 18.09 | $271,329 | $361,771 | $452,214 | $723,543 |

Bottom of the listed universe (p05 season NP/game): 2.95 NP. The $25K quote floor stops distorting the bench only when rate ≥ $8,485/NP.

## B. Noise anatomy: what one night of a fair roster must swing

| Tier | Games | Per-game edge SD (NP) | SD at $20K |
|---|---:|---:|---:|
| Superstar | 208 | 8.88 | ±$177,659 |
| Star | 1,411 | 8.57 | ±$171,493 |
| Starter | 3,518 | 7.47 | ±$149,416 |
| Rotation | 4,090 | 6.36 | ±$127,296 |
| Bench | 1,881 | 5.23 | ±$104,597 |
| **All listed** | 11,108 | 6.93 | ±$138,630 |

Schedule density: a listed player plays 0.45 games per calendar night → a full 10-slot roster catches ≈ 4.5 games/night and ≈ 32 games/week.

Analytic fair-roster swing: night SD ≈ 14.7 NP, week SD ≈ 39.0 NP (dollar values in test D).

## C. Archetype replay: a season of daily P&L (costs locked at add)

| Archetype | Adds | Season P&L (NP) | Daily mean | Daily SD | Daily p05 | Daily p95 |
|---|---:|---:|---:|---:|---:|---:|
| star holder | 10 | -1163 | -7.75 | 18.7 | -38.8 | +23.5 |
| balanced holder | 10 | +862 | +5.75 | 13.7 | -14.3 | +28.0 |
| bench holder | 10 | +878 | +5.93 | 13.9 | -14.6 | +26.6 |
| nightly streamer | 1356 | -318 | -2.06 | 29.1 | -49.1 | +41.2 |
| momentum chaser | 219 | +153 | +1.04 | 16.8 | -25.8 | +28.1 |
| weekly random (10 seeds pooled) | 225 | +16 | +0.11 | 14.8 | -23.4 | +25.5 |

Random-seed season spread (weekly random, NP): -28, -254, +272, -273, +200, -177, +327, +84, -32, +42

| Archetype | Weekly mean (NP) | Weekly SD | Weekly p05 | Weekly p95 |
|---|---:|---:|---:|---:|
| star holder | -46.53 | 51.5 | -126.3 | +24.1 |
| balanced holder | +34.49 | 30.6 | -21.8 | +74.5 |
| bench holder | +35.12 | 33.3 | -9.5 | +96.2 |
| nightly streamer | -12.71 | 66.6 | -134.4 | +71.4 |
| momentum chaser | +6.13 | 35.9 | -50.6 | +60.6 |
| weekly random (10 seeds pooled) | +0.64 | 38.8 | -58.6 | +65.7 |

## D. Rate sweep against legibility bands

Bands: a normal night p95 should land between $150K and $750K; a normal week p95 between $500K and $2M; the season archetype spread in single-digit $M; the whole listed universe priced above the $25K floor; a superstar cost under $1M/game so the anchor column stays readable.

| Rate | Star cost/game | p05 player cost | Night p95 (balanced) | Worst star night p99 | Week p95 | Season archetype SD | Floor OK | Verdict |
|---|---:|---:|---:|---:|---:|---:|:---:|---|
| $10K | $263,471 | $29,462 | ±$287,830 | ±$559,320 | ±$744,924 | $7,691,248 | yes | **in band** |
| $15K | $395,206 | $44,193 | ±$431,745 | ±$838,981 | ±$1,117,387 | $11,536,872 | yes | **in band** |
| $20K | $526,941 | $58,924 | ±$575,659 | ±$1,118,641 | ±$1,489,849 | $15,382,496 | yes | **in band** |
| $25K | $658,676 | $73,655 | ±$719,574 | ±$1,398,301 | ±$1,862,311 | $19,228,120 | yes | **in band** |
| $30K | $790,412 | $88,386 | ±$863,489 | ±$1,677,961 | ±$2,234,773 | $23,073,745 | yes | nights too violent; weeks too violent |
| $40K | $1,053,882 | $117,848 | ±$1,151,319 | ±$2,237,282 | ±$2,979,698 | $30,764,993 | yes | nights too violent; weeks too violent; star cost 7 figures |

## E. Skill separation over one season (rate-free)

Weekly-random season P&L across 10 seeds: mean +16 NP, SD 200 NP. Archetype season totals (NP): star -1163, bench +878, streamer -318, momentum +153.

Distance from random in random-SDs: star 5.9σ, bench 4.3σ, streamer 1.7σ, momentum 0.7σ.

## F. Aggregate dividend flow (the money supply per user)

| Rate | League-wide dividend flow/night (150 listed) | One full roster's gross flow/night |
|---|---:|---:|
| $10K | $6,179,037 | ≈ $520,430 in, ≈ the same out in costs |
| $15K | $9,268,555 | ≈ $780,645 in, ≈ the same out in costs |
| $20K | $12,358,073 | ≈ $1,040,859 in, ≈ the same out in costs |
| $25K | $15,447,591 | ≈ $1,301,074 in, ≈ the same out in costs |
| $30K | $18,537,110 | ≈ $1,561,289 in, ≈ the same out in costs |
| $40K | $24,716,146 | ≈ $2,081,719 in, ≈ the same out in costs |

Under fair pricing the two columns net to ≈ zero per user; the gross flow is what the product surfaces every night, so it must read as real money without dwarfing the costs users click on.
