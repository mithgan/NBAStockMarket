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

## Addendum 2026-09-06 — rate, fair-cost, and user-P&L study

Deeper battery (`output/per-game-rate-study.md`, `per-game-lock-drift.md`,
`per-game-user-pnl-corrected.md`): production tiers, noise anatomy, 7 archetypes
× 10 random seeds, a 6-rate legibility sweep, a 7-anchor × 4-checkpoint lock-drift
test, and a corrected replay. Refinements to the table above:

- **Rate: $20K/NP confirmed.** $10K-$25K all pass the legibility bands; $30K+
  fails (nights p95 > $860K, star costs go 7-figure). $20K center: SGA $527K/game,
  bench floor safe 2.4×, normal night ±$248K.
- **Opening cost, corrected: last season's produced NP/game × rate, NO October
  premium needed.** Measured lock drift 0.00 NP pooled, ≤±0.03 per tier — the
  premium is only for players *without* last-season history (rookies: projection
  + 1.0 NP through October). The earlier +1.0-for-everyone recommendation
  over-corrects when the anchor is last-season value.
- **Never lock October costs off early-season trailing production** (+0.9 NP/game
  drift; flips a star roster from fair to −$23M/season). Trailing-10 requote takes
  over per player once 3+ games exist — but the *opening* lock must be the
  last-season anchor.
- **The superstar late-season fade is real** (oracle-anchor drift −0.8 to −2.4
  NP/game for locks after January; load management). Not a pricing bug — it is
  the structural reason shorts exist. Expect "short the resting star" to be the
  first skill meta.
- **Normal-user P&L at $20K** (balanced 10-slot roster, fair locks, measured):
  typical night ±$250K, big night (p95) ±$500K; typical week ±$610K, big week
  ±$1.18M; a full-season pure-luck band (random rosters, 2 SD) of ±$8.7M — the
  leaderboard noise floor a skill edge has to clear.

## Addendum 2026-09-06 (2) — cross-season robustness battery

Six further test families across all three cached seasons plus an opening-anchor
shootout (`output/per-game-robustness.md`, `per-game-opening-anchor.md`). Two
findings **correct** earlier addendum claims:

- **Opening cost, corrected again: last season's produced NP/game × 1.08 × rate.**
  The true product test (lock 2024-25 openers at real 2023-24 production, etc.)
  shows a RAW last-season lock leaks +$12.7K/+$17.2K per game — the league grows
  year over year. The ×1.08 uplift prices both season pairs to +0.030 NP pooled
  (+$598/game, fair). A flat +0.75 NP matches pooled but over-taxes the bench
  (−2.28 NP worst tier); proportional wins. The earlier "0.00 drift, no premium"
  readout came from a same-season proxy that was oracle-contaminated. D&T
  opening-week projections are the WORST opening anchor tested (+1.9 NP =
  +$38K/game leak) — use them only for players with no prior season, plus a
  +1.9 NP correction (veteran-measured proxy; rookie-specific calibration TBD).
- **"Short the fading superstar" retracted as a meta.** It was +$52K/window with
  a 60.7% win rate in 2025-26 but −$15K and −$8K in the two prior seasons —
  1-for-3 is an overfit, not a strategy. Random 7-day shorts are −$14K to −$20K
  mean (win rate 48-49%) in all three seasons: shorts are a fair opinion market,
  not an income stream, before fees.

Confirmed cross-season: the trailing-10 requote leak is stable (+0.15 to +0.21
NP ≈ $3-4K/game in every season); a **weekly full requote already removes ~92%
of the frozen-quote leak** ($3.8-5.4K residual vs $49-59K frozen), so Ryan can
pick the cheapest cadence to operate — the only hard requirement is "not
frozen." Normal-user bands hold in all seasons (night SD $248-292K, week SD
$611-741K at $20K). Retention note for the UI: a fair, engaged user hits a
median **$1.2-1.9M peak-to-trough drawdown inside any 28-day window** (p95
$2.9-3.6M) — frame the P&L views around weekly deltas and a since-you-joined
baseline so a normal cold streak does not read as ruin.

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
