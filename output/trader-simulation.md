# Trader Simulation: Price-Impact Calibration

**Recommended `IMPACT_K`: `0.003` (provisional).**

**Production readiness: READY for the next gate.**

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
| 0.0003 | yes | 0.003% | 0.32% | 17.34% | 0.50% | 1.004x | 10.60% | 100.0% |
| 0.001 | yes | 0.010% | 1.08% | 17.34% | 1.38% | 1.015x | 11.60% | 100.0% |
| 0.003 | yes | 0.028% | 3.27% | 17.34% | 4.19% | 1.044x | 11.00% | 100.0% |
| 0.01 | no | 0.096% | 11.01% | 20.17% | 14.68% | 1.156x | 10.20% | 100.0% |
| 0.03 | no | 0.317% | 27.97% | 32.65% | 50.82% | 1.544x | 3.10% | 100.0% |

## Scenario checks for the recommendation

| Scenario | Seed | Executed / attempted | End-window median move | Max drawdown | Max daily move | Wealth change | Fees / trader | Invariants |
|---|---:|---:|---:|---:|---:|---:|---:|:---:|
| balanced | 7 | 3077 / 3077 | 2.91% | 1.06% | 2.39% | -5.44% | $8,775,575 | pass |
| hype | 7 | 4050 / 4050 | 3.27% | 1.20% | 3.08% | -10.40% | $15,743,280 | pass |
| boom_bust | 7 | 96 / 96 | 17.34% | 17.34% | 4.01% | -3.66% | $288,778 | pass |
| balanced | 42 | 3080 / 3080 | 3.08% | 0.78% | 2.27% | -6.38% | $10,049,548 | pass |
| hype | 42 | 4050 / 4050 | 3.27% | 1.21% | 2.60% | -11.00% | $16,646,256 | pass |
| boom_bust | 42 | 96 / 96 | 17.34% | 17.34% | 4.11% | -3.46% | $289,480 | pass |
| balanced | 1337 | 3101 / 3101 | 3.11% | 1.02% | 2.76% | -5.07% | $8,276,054 | pass |
| hype | 1337 | 4050 / 4050 | 3.55% | 1.39% | 2.67% | -10.59% | $16,030,740 | pass |
| boom_bust | 1337 | 96 / 96 | 17.34% | 17.34% | 4.19% | -3.46% | $289,477 | pass |

## Economy finding

The stress run also checks whether the existing 0.25% trade fee and 0.5%-step same-player flip penalty capped at 1.5% drain user wealth at the simulated turnover rate. A price-safe `IMPACT_K` does not make the full economy production-ready if the worst scenario destroys more than 25% of starting wealth. Treat that as a separate fee/turnover calibration task; do not raise `IMPACT_K` to compensate for cash sinks.

At the recommended setting, the worst run was `hype` / seed `42`: wealth changed -11.00% and 71.4% of charged fees came from flip surcharges.

## Decision

Use `0.003` for the next interactive prototype. It is the safe candidate closest to the 0.5% median per-trade responsiveness target under these synthetic order flows.

This is not a production calibration. Re-run the sweep against observed order-size, turnover, and concentration distributions once real users trade; the simulator intentionally makes no claim that its mock trader mix predicts demand.
