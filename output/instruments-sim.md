# Instruments simulation - production spec parameters (shorting-spec v1.0)

Rolling-30 bias with cold start +1.002 NP; 0.25% ad-valorem
fees (min $10K); production `InstrumentsBook` mechanics throughout.

Projection coverage: 10,689 settled player-games, 0 skipped.
Cohort wealth change: -0.01%.

## Outcome by archetype (mean net-worth change per trader)

| Archetype | n | Mean P/L | Median | Best | Worst |
|---|---:|---:|---:|---:|---:|
| momentum | 8 | $2,818,524 | $2,285,260 | $6,732,320 | $-1,566,311 |
| noise | 8 | $2,478,820 | $2,054,782 | $8,280,619 | $-2,778,260 |
| price_shorter | 8 | $746,925 | $333,362 | $7,019,955 | $-3,925,857 |
| holder | 8 | $7,339 | $2,421,932 | $8,027,548 | $-7,399,822 |
| random_short | 10 | $-1,184,479 | $-947,676 | $11,425,417 | $-9,955,134 |
| fader | 10 | $-1,697,415 | $-852,421 | $3,552,558 | $-11,330,024 |
| booster | 8 | $-2,529,595 | $-2,925,121 | $6,363,934 | $-9,477,540 |

## Weekly shorts - net of fees (acceptance criteria)

- **fader**: 661 settled | mean net $-12,359 | median $113,107 | std $601,177 | win rate 53.6%
- **random_short**: 660 settled | mean net $-9,667 | median $11,152 | std $480,175 | win rate 50.8%

- acceptance (fader <= 0): mean $-12,359 -> **PASS**
- acceptance (random_short ~ -fee): mean $-9,667 -> **PASS**
- acceptance (inflation in -1.5%..+5%): -0.01% -> **PASS**
