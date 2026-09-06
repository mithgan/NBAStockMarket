# Per-game economy v2 historical evaluation

All order flow in this report is **synthetic scenario behavior**, not observed user demand.
The run is local-only and deterministic; it does not call a network, database, migration, or deployment.

## Inputs and limits

- Player-games in mounted cache: 26,540.
- Missing or unusable saved projection rows in the full cache: 32.
- Date range: 2025-10-21 through 2026-04-12.
- Point-in-time universe per scenario: 60 players, selected by first saved pregame projection availability.
- ESPN game-log SHA-256: `f3342cea2ee845f59b98651eeae37e37d4918e4f282fb3c422a9f9d7667a34eb`.
- D&T aggregate SHA-256: `1e0165f251c33589952782b2ae88572b8953cd6c4a37b7452b38f1f7af19c78d` across 174 files.
- Seeds: 7, 2027.
- Settled player-games across scenarios: 115,808; unsettled: 0.
- Independent cash-flow reconciliation: passed; position exposure, settled dividends, and lifecycle fees agree with engine P&L and the ledger.
- Exact prior-season per-game anchors are unavailable because the mounted cache has no 2024-25 player-game actual/projection pair.
- Current-season realized outcomes are used only for retrospective evaluation and later decisions, never for opening quotes.

## Policy matrix

The complete matrix has 32 runs: raw versus old D&T-surprise dividends, $20K versus $40K per net point, two quote-impact settings, weekly shorts on/off, and every listed seed.
Open/drop fees are zero in this comparison so price impact and strategy behavior remain separately visible.

## Roster churn

| Basis | $/NP | Impact | Shorts | Adds/user/week | Drops/user/week |
|---|---:|---:|:---:|---:|---:|
| raw_net_points | $20,000 | 0 bps | no | 16.73 | 16.32 |
| raw_net_points | $20,000 | 0 bps | yes | 16.56 | 16.16 |
| raw_net_points | $20,000 | 50 bps | no | 16.74 | 16.34 |
| raw_net_points | $20,000 | 50 bps | yes | 16.57 | 16.16 |
| raw_net_points | $40,000 | 0 bps | no | 16.75 | 16.36 |
| raw_net_points | $40,000 | 0 bps | yes | 16.59 | 16.19 |
| raw_net_points | $40,000 | 50 bps | no | 16.77 | 16.37 |
| raw_net_points | $40,000 | 50 bps | yes | 16.61 | 16.20 |
| surprise_vs_projection | $20,000 | 0 bps | no | 16.73 | 16.32 |
| surprise_vs_projection | $20,000 | 0 bps | yes | 16.56 | 16.16 |
| surprise_vs_projection | $20,000 | 50 bps | no | 16.74 | 16.34 |
| surprise_vs_projection | $20,000 | 50 bps | yes | 16.57 | 16.16 |
| surprise_vs_projection | $40,000 | 0 bps | no | 16.75 | 16.36 |
| surprise_vs_projection | $40,000 | 0 bps | yes | 16.59 | 16.19 |
| surprise_vs_projection | $40,000 | 50 bps | no | 16.77 | 16.37 |
| surprise_vs_projection | $40,000 | 50 bps | yes | 16.61 | 16.20 |

Schedule streaming rebalances before each day's outcomes; value and random strategies rebalance weekly; hold does not churn after filling its roster. Detailed per-scenario round trips, holding times, slot use, rejected actions, and the streaming-versus-hold exposure diagnostic are in the JSON.

## Price stability

| Basis | $/NP | Impact | Shorts | End ratio dispersion | Max daily move |
|---|---:|---:|:---:|---:|---:|
| raw_net_points | $20,000 | 0 bps | no | 0.0000 | 0.00% |
| raw_net_points | $20,000 | 0 bps | yes | 0.0000 | 0.00% |
| raw_net_points | $20,000 | 50 bps | no | 0.0043 | 2.02% |
| raw_net_points | $20,000 | 50 bps | yes | 0.0042 | 2.02% |
| raw_net_points | $40,000 | 0 bps | no | 0.0000 | 0.00% |
| raw_net_points | $40,000 | 0 bps | yes | 0.0000 | 0.00% |
| raw_net_points | $40,000 | 50 bps | no | 0.0043 | 1.76% |
| raw_net_points | $40,000 | 50 bps | yes | 0.0042 | 2.02% |
| surprise_vs_projection | $20,000 | 0 bps | no | 0.0000 | 0.00% |
| surprise_vs_projection | $20,000 | 0 bps | yes | 0.0000 | 0.00% |
| surprise_vs_projection | $20,000 | 50 bps | no | 0.0043 | 2.02% |
| surprise_vs_projection | $20,000 | 50 bps | yes | 0.0042 | 2.02% |
| surprise_vs_projection | $40,000 | 0 bps | no | 0.0000 | 0.00% |
| surprise_vs_projection | $40,000 | 0 bps | yes | 0.0000 | 0.00% |
| surprise_vs_projection | $40,000 | 50 bps | no | 0.0043 | 1.76% |
| surprise_vs_projection | $40,000 | 50 bps | yes | 0.0042 | 2.02% |

Quote changes come only from synthetic adds, drops, and short opens/closes. The JSON also records single-action moves, drawdowns, floor hits, price/opening extremes, day-7/day-30 dispersion, and movement concentration.

## Early mispricing

Exact prior-season value-per-game anchors are **unavailable** in the mounted cache. Opening cost therefore uses the player's first saved pregame D&T projection as an explicitly labeled proxy and never uses final-season minutes or results.

| Basis | $/NP | Impact | Shorts | Retrospective opening MAE |
|---|---:|---:|:---:|---:|
| raw_net_points | $20,000 | 0 bps | no | $53,101 |
| raw_net_points | $20,000 | 0 bps | yes | $53,101 |
| raw_net_points | $20,000 | 50 bps | no | $53,101 |
| raw_net_points | $20,000 | 50 bps | yes | $53,101 |
| raw_net_points | $40,000 | 0 bps | no | $107,783 |
| raw_net_points | $40,000 | 0 bps | yes | $107,783 |
| raw_net_points | $40,000 | 50 bps | no | $107,783 |
| raw_net_points | $40,000 | 50 bps | yes | $107,783 |
| surprise_vs_projection | $20,000 | 0 bps | no | $123,302 |
| surprise_vs_projection | $20,000 | 0 bps | yes | $123,302 |
| surprise_vs_projection | $20,000 | 50 bps | no | $123,302 |
| surprise_vs_projection | $20,000 | 50 bps | yes | $123,302 |
| surprise_vs_projection | $40,000 | 0 bps | no | $244,683 |
| surprise_vs_projection | $40,000 | 0 bps | yes | $244,683 |
| surprise_vs_projection | $40,000 | 50 bps | no | $244,683 |
| surprise_vs_projection | $40,000 | 50 bps | yes | $244,683 |

The retrospective calibration table is diagnostic only. It was not fed back into any trader decision. Per-scenario deciles, rank correlation, worst over/underpricing, and early-date P&L shares are in the JSON.

## Short policy

Weekly inverse positions open before that week's outcomes and close at the next week boundary. Each account uses at most three of the five allowed slots.

| Basis | $/NP | Impact | Shorts | Mean short P&L |
|---|---:|---:|:---:|---:|
| raw_net_points | $20,000 | 0 bps | no | $0 |
| raw_net_points | $20,000 | 0 bps | yes | -$19,626,744 |
| raw_net_points | $20,000 | 50 bps | no | $0 |
| raw_net_points | $20,000 | 50 bps | yes | -$20,031,356 |
| raw_net_points | $40,000 | 0 bps | no | $0 |
| raw_net_points | $40,000 | 0 bps | yes | -$39,616,304 |
| raw_net_points | $40,000 | 50 bps | no | $0 |
| raw_net_points | $40,000 | 50 bps | yes | -$40,431,516 |
| surprise_vs_projection | $20,000 | 0 bps | no | $0 |
| surprise_vs_projection | $20,000 | 0 bps | yes | $105,346,038 |
| surprise_vs_projection | $20,000 | 50 bps | no | $0 |
| surprise_vs_projection | $20,000 | 50 bps | yes | $102,929,721 |
| surprise_vs_projection | $40,000 | 0 bps | no | $0 |
| surprise_vs_projection | $40,000 | 0 bps | yes | $212,211,724 |
| surprise_vs_projection | $40,000 | 50 bps | no | $0 |
| surprise_vs_projection | $40,000 | 50 bps | yes | $207,373,100 |

The JSON reports entries, closes, qualifying games, random-entry EV, win rate, maximum loss, forced closes, and the exact inverse-long symmetry check. No short fee or penalty was assumed.

## User P&L

P&L starts at zero and is independently reconstructed from position exposure, settled dividends, and lifecycle fees before comparison with the integer-dollar append-only ledger. It excludes mark-to-market roster value.

| Basis | $/NP | Impact | Shorts | Mean user P&L | Cross-seed SD | Reconciled |
|---|---:|---:|:---:|---:|---:|:---:|
| raw_net_points | $20,000 | 0 bps | no | $71,571,446 | $1,185,834 | yes |
| raw_net_points | $20,000 | 0 bps | yes | $63,843,636 | $1,532,416 | yes |
| raw_net_points | $20,000 | 50 bps | no | $70,728,742 | $1,197,307 | yes |
| raw_net_points | $20,000 | 50 bps | yes | $63,043,889 | $1,569,349 | yes |
| raw_net_points | $40,000 | 0 bps | no | $142,900,352 | $2,333,726 | yes |
| raw_net_points | $40,000 | 0 bps | yes | $127,290,970 | $3,100,218 | yes |
| raw_net_points | $40,000 | 50 bps | no | $141,012,199 | $2,354,130 | yes |
| raw_net_points | $40,000 | 50 bps | yes | $125,374,674 | $3,056,696 | yes |
| surprise_vs_projection | $20,000 | 0 bps | no | -$151,350,690 | $1,531,029 | yes |
| surprise_vs_projection | $20,000 | 0 bps | yes | -$121,748,136 | $2,210,349 | yes |
| surprise_vs_projection | $20,000 | 50 bps | no | -$151,527,104 | $1,315,794 | yes |
| surprise_vs_projection | $20,000 | 50 bps | yes | -$122,380,108 | $2,481,164 | yes |
| surprise_vs_projection | $40,000 | 0 bps | no | -$301,239,083 | $3,024,116 | yes |
| surprise_vs_projection | $40,000 | 0 bps | yes | -$241,717,114 | $4,456,083 | yes |
| surprise_vs_projection | $40,000 | 50 bps | no | -$301,271,557 | $2,591,105 | yes |
| surprise_vs_projection | $40,000 | 50 bps | yes | -$242,783,585 | $4,868,962 | yes |

The old surprise dividend is near zero-mean; charging a positive projection-sized game cost on top of it therefore creates strongly negative expected long P&L. That is a model consequence to resolve with Russell, not a hidden recommendation from this report.
