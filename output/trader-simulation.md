# Trader Simulation: Price-Impact Calibration

**Recommended `IMPACT_K`: `0.003` (provisional).**

**Production readiness: NOT READY; price behavior passes, but the fee economy does not.**

This sweep isolates market mechanics: game dividends are disabled and fair-value reversion remains off. Prices move only through buys, sells, and inactivity decay.

## Method

- 45 simulated days, 48 traders, and 90 order opportunities per day.
- Fixed seeds: 7, 42, 1337.
- Scenarios: balanced strategies, hype-heavy buying, and a concentrated boom/bust unwind.
- Safety gates: no invariant failures, no >50% drawdown, no >10% one-day move, and no >2x price spike.
- Among safe candidates, choose the median per-trade move closest to 0.5%; penalize a market that moves <3% over the test window.

## Candidate results

| IMPACT_K | Price-safe | Median trade move | Median window move | Worst drawdown | Worst daily move | Worst price multiple | Worst wealth loss | Min execution |
|---:|:---:|---:|---:|---:|---:|---:|---:|---:|
| 0.0003 | yes | 0.003% | 0.31% | 17.34% | 0.50% | 1.004x | 48.54% | 99.2% |
| 0.001 | yes | 0.009% | 1.07% | 17.34% | 1.38% | 1.015x | 52.18% | 98.9% |
| 0.003 | yes | 0.028% | 3.08% | 17.34% | 4.19% | 1.044x | 51.69% | 99.0% |
| 0.01 | no | 0.093% | 10.71% | 20.17% | 14.68% | 1.156x | 49.75% | 99.0% |
| 0.03 | no | 0.319% | 26.70% | 32.65% | 50.82% | 1.544x | 47.92% | 99.1% |

## Scenario checks for the recommendation

| Scenario | Seed | Executed / attempted | End-window median move | Max drawdown | Max daily move | Wealth change | Fees / trader | Invariants |
|---|---:|---:|---:|---:|---:|---:|---:|:---:|
| balanced | 7 | 3054 / 3057 | 2.90% | 1.06% | 2.49% | -26.72% | $38,480,744 | pass |
| hype | 7 | 4022 / 4050 | 3.08% | 1.32% | 2.68% | -51.69% | $73,417,453 | pass |
| boom_bust | 7 | 96 / 96 | 17.34% | 17.34% | 4.01% | -4.27% | $1,155,111 | pass |
| balanced | 42 | 3064 / 3074 | 3.12% | 0.90% | 2.27% | -29.25% | $41,962,280 | pass |
| hype | 42 | 4011 / 4050 | 2.84% | 5.02% | 2.60% | -50.90% | $72,319,325 | pass |
| boom_bust | 42 | 96 / 96 | 17.34% | 17.34% | 4.11% | -4.08% | $1,157,921 | pass |
| balanced | 1337 | 3095 / 3109 | 2.96% | 0.75% | 2.67% | -27.98% | $40,270,784 | pass |
| hype | 1337 | 4026 / 4050 | 3.05% | 2.05% | 2.93% | -49.15% | $69,899,993 | pass |
| boom_bust | 1337 | 96 / 96 | 17.34% | 17.34% | 4.19% | -4.08% | $1,157,908 | pass |

## Economy finding

The stress run also checks whether the existing 1% trade fee and escalating same-player flip penalty drain user wealth at the simulated turnover rate. A price-safe `IMPACT_K` does not make the full economy production-ready if the worst scenario destroys more than 25% of starting wealth. Treat that as a separate fee/turnover calibration task; do not raise `IMPACT_K` to compensate for cash sinks.

At the recommended setting, the worst run was `hype` / seed `7`: wealth changed -51.69% and 76.5% of charged fees came from flip surcharges.

## Decision

Use `0.003` for the next interactive prototype. It is the safe candidate closest to the 0.5% median per-trade responsiveness target under these synthetic order flows.

This is not a production calibration. Re-run the sweep against observed order-size, turnover, and concentration distributions once real users trade; the simulator intentionally makes no claim that its mock trader mix predicts demand.
