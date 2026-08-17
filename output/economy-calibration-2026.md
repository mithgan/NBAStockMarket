# 2025-26 Economy Calibration

Five payout candidates were replayed against the same cached 2025-26 season, 150-player universe, and 100 deterministic 10-player portfolios.

Starting cash is **$207,824,000**. The selected rate is **$80,000 per net point per holder**, the lowest candidate passing all four product constraints.

## Constraints

1. A +20 surprise pays at least 0.75% of starting cash ($1,558,680).
2. A +5 surprise remains visible after UI rounding to $0.1M.
3. Full-season deterministic economy drift remains inside +/-5%.
4. Equal positive and negative surprises have equal magnitude before instrument-specific clamps.

## Candidate Results

| Rate / NP / holder | +5 | +5 at $0.1M | +20 | +20 / bankroll | Season drift | Symmetry | Result |
|---:|---:|---:|---:|---:|---:|:---:|:---:|
| $40,000 | $200,000 | $200,000 | $800,000 | 0.3849% | -$231,013,859 (-1.1116%) | PASS | FAIL |
| $60,000 | $300,000 | $300,000 | $1,200,000 | 0.5774% | -$296,752,635 (-1.4279%) | PASS | FAIL |
| $80,000 | $400,000 | $400,000 | $1,600,000 | 0.7699% | -$362,606,945 (-1.7448%) | PASS | PASS |
| $100,000 | $500,000 | $500,000 | $2,000,000 | 0.9624% | -$428,653,941 (-2.0626%) | PASS | PASS |
| $120,000 | $600,000 | $600,000 | $2,400,000 | 1.1548% | -$494,864,113 (-2.3812%) | PASS | PASS |

## Absolute Player-Game Payouts

Per-holder payout magnitude across every listed-universe player-game.

| Rate / NP / holder | p50 | p75 | p90 | p95 |
|---:|---:|---:|---:|---:|
| $40,000 | $192,393 | $328,599 | $473,088 | $562,609 |
| $60,000 | $288,589 | $492,898 | $709,632 | $843,913 |
| $80,000 | $384,785 | $657,198 | $946,176 | $1,125,217 |
| $100,000 | $480,982 | $821,497 | $1,182,720 | $1,406,521 |
| $120,000 | $577,178 | $985,797 | $1,419,264 | $1,687,826 |

## Absolute Daily Portfolio Moves

One absolute end-to-end portfolio value change for every synthetic portfolio on each league game day, including dividends and the daily idle-cash sink. Each cell reports dollars and percentage of starting cash.

| Rate / NP / holder | p50 | p75 | p90 | p95 | Observations |
|---:|---:|---:|---:|---:|---:|
| $40,000 | $360,992 (0.1737%) | $658,387 (0.3168%) | $994,744 (0.4786%) | $1,223,979 (0.5889%) | 16,400 |
| $60,000 | $541,285 (0.2605%) | $986,581 (0.4747%) | $1,492,599 (0.7182%) | $1,834,067 (0.8825%) | 16,400 |
| $80,000 | $721,686 (0.3473%) | $1,314,511 (0.6325%) | $1,989,805 (0.9574%) | $2,444,543 (1.1763%) | 16,400 |
| $100,000 | $901,931 (0.4340%) | $1,643,645 (0.7909%) | $2,487,764 (1.1971%) | $3,056,520 (1.4707%) | 16,400 |
| $120,000 | $1,082,033 (0.5206%) | $1,972,917 (0.9493%) | $2,985,246 (1.4364%) | $3,668,685 (1.7653%) | 16,400 |

## SGA 55-Point Reference

| Rate / NP / holder | Actual NP | Expected NP | Surprise NP | Payout / holder |
|---:|---:|---:|---:|---:|
| $40,000 | 43.6000 | 23.2488 | +20.3512 | $814,050 |
| $60,000 | 43.6000 | 23.2488 | +20.3512 | $1,221,075 |
| $80,000 | 43.6000 | 23.2488 | +20.3512 | $1,628,100 |
| $100,000 | 43.6000 | 23.2488 | +20.3512 | $2,035,125 |
| $120,000 | 43.6000 | 23.2488 | +20.3512 | $2,442,149 |

## Reproduction

```bash
python -m nba_stock_market.backtest --economy-calibration
python -m nba_stock_market.backtest
```

Both commands use only cached replay inputs during report generation.
