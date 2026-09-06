# Per-game economy v2 — balance recommendations (Mith)

Status: recommended constants for the v2 live ruleset, 2026-09-06.
Evidence: `output/per-game-balance-study.md` (deterministic replay arithmetic over
11,108 top-150 player-games, 2025-26 cache) and `output/per-game-economy-v2.*`
(Ryan's 32-scenario engine matrix, 115,808 settled games, ledgers reconciled) plus
the fee acceptance sweep in `output/fee-check/`. Everything below is measured on
those runs unless labeled as a design argument.

## The one structural finding first

A per-game cost that never reprices is a money printer. With quotes frozen at the
first preseason projection, a plain hold account earned **+$61M in one season**
(+$59K per settled game, every holder, no skill). Demand impact cannot close that
gap at realistic trade volumes (50 bps × synthetic churn moved prices ~2% max in a
day). **The quote must track production**, with demand impact layered on top.

## Recommended constants

| Knob | Recommendation | Measured basis |
|---|---|---|
| Dollars per net point | **$20,000** | Wemby ≈ $527K/game cost; one-game surprise SD ±$134K; 10-slot night swing ±$423K; season leaderboard in single-digit $M. $40K doubles every number into the hundreds of millions. All EVs/fees scale linearly — this is a legibility choice. |
| Opening cost | **last season's produced NP/game × rate, +1.0 NP premium through October** (new players: current projection equivalent, league median ≈ $166K if nothing exists); floor $25K | Every anchor leaks +0.9 to +1.1 NP in October (three prior seasons showed the same curve). The premium is the rolling-bias cold-start lesson applied to costs. |
| Quote movement | **Nightly requote: move the quote halfway to the trailing-10-games produced-NP anchor** (needs ≥3 games played, else hold); **±15% daily cap**; **plus 50 bps demand impact per add/drop**, symmetric | Trailing-10 anchor leaks only **+$3.5K/game** vs $59K frozen and $5.5K for game-day D&T projections — and it needs **no projection feed**, matching the raw-net-points product rule. Demand impact becomes flavor/congestion pricing, not the fairness mechanism. |
| Churn fee | **$10K flat per add; $0 to drop; no cooldown** | Under a fair anchor, mindless nightly streaming is already **−EV** (−$1.3M to −$3.3M/season vs hold — the streamer plays 2.5× the games at slightly negative edge). The fee is decision weight, not an exploit patch. Mechanically verified: fees post to the ledger and reconcile. |
| Short duration | **7-day expiry**, stored at open (engine already expires these); auto-close before the first post-expiry game | 7 days catches 3.42 games and cuts per-game luck to **0.54×** a single game. 1-day shorts are ~85-90% noise; 14 days over-commits through role changes. |
| Short early close | **Allowed, $10K fee, no other penalty** | The tipoff roster lock already prevents closing after an outcome is knowable; cutting a losing short is legitimate play. |
| Short slots / fee at open | Keep **5 slots**, $10K open fee | Same friction as longs; random shorting under a fair anchor costs ≈ the calendar bias (−$3K to −$21K/game by month), so shorts stay an opinion, not an income stream. |

## "Weekly pay," clarified

In the v1 spec "weekly" was only the **short's exposure window**: a short armed
before the window settled game-by-game across Mon-Sun and the slot freed at the
week boundary. All P&L — longs and shorts — settled per game. It was never "all
P&L settles weekly." In v2 terms: shorts are simply 7-day-expiry inverse
positions; per-game settlement stays exactly as built.

## What the backend needs that it doesn't have yet

1. **The nightly requote step.** `PerGameEconomy` moves quotes only on add/drop
   impact. The trailing-anchor requote needs either a scheduled requote command in
   the service (preferred: runs inside the roster-lock window after settlement) or
   anchor-derived quotes at bootstrap. Without it, ship nothing — the frozen-quote
   leak is the whole economy.
2. **October premium** on opening quotes (a constant in the ruleset, retired
   automatically once a player has 3 games and the trailing anchor takes over).
3. Fees: `open_fee_dollars=10_000`, `drop_fee_dollars=0` in the live ruleset
   (engine + schema already support both).

## Honest limits

- The engine matrix's order flow is synthetic (4 archetypes, 2 seeds); churn rates
  there (16.6 adds/week) are a stress posture, not a user forecast.
- The anchor study is replay arithmetic on last season; a live market with real
  demand flow on top has not been simulated. The tripwire discipline from v1
  applies: re-measure hold-account EV after ~4 live weeks; if a plain hold roster
  earns beyond noise, the requote is not keeping up — tighten the nightly blend
  from ½ toward the anchor to ¾ before touching anything else.
- Rate, fees, and premiums scale linearly together; if the group later prefers
  $40K/NP for bigger numbers, double the fees and floors with it.
