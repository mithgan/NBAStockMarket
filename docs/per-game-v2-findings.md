# Per-Game Economy v2 — Balancing Findings

**Author:** Mith · **Date:** 2026-09-06 · **Status:** complete test battery, constants ready for the live ruleset

Every number in this document was measured by running a sim or replay on cached real
seasons — nothing is assumed. Scripts live in `scripts/`, evidence reports in `output/`
(index at the bottom). Data: three full seasons of ESPN box scores + saved pregame D&T
projections (2023-24: 26,283 · 2024-25: 26,206 · 2025-26: 26,540 player-games; top-150
listed universe per season = 33,567 studied player-games).

---

## 1. The recommended constants

| Knob | Value | One-line justification |
|---|---|---|
| Dollars per net point | **$20,000** | $10K–$25K all pass the legibility bands; $30K+ makes nights/weeks too violent and star costs 7-figure. $20K centers the range: SGA ≈ $527K/game. |
| Opening cost | **last season's produced NP/game × 1.08 × rate** | Raw last-season leaks +$12.7K–$17.2K/game (league YoY growth). ×1.08 prices both tested season pairs to +0.03 NP pooled (+$598/game ≈ fair). |
| No-history players (rookies) | opening-week projection **+ 1.9 NP**, floor $25K | D&T openers lowball by +1.9 NP (measured on veterans; rookie-specific calibration pending). |
| Quote movement | **requote to trailing-10 produced NP, weekly or better** + 50 bps demand impact per add/drop | Weekly requote removes ~92% of the frozen-quote leak. Frozen quotes are a money printer (+$49K–$59K/game). |
| Churn fee | **$10K per add, $0 per drop, no cooldown** | Under fair quotes, mindless streaming is already −EV; the fee is decision weight. Verified to post and reconcile in the ledger. |
| Short duration | **7-day expiry**, early close allowed for the same $10K fee | 7 days catches 3.42 games and cuts per-game luck to 0.54× of a single game. Tipoff lock already prevents result-dodging. |
| Slots | 10 long / 5 short (unchanged) | Product decision; all tests ran at this shape. |

Everything scales linearly with the rate — if the group later wants $15K or $25K, scale
fees and floors with it and no other conclusion changes.

---

## 2. The structural finding everything else hangs on

**A per-game cost that never reprices is a money printer.** In Ryan's own engine matrix
(32 scenarios, 115,808 settled games, every ledger reconciled), a do-nothing hold account
with quotes frozen at first preseason projections earned **+$61M in one season** — +$59K
per settled game of pure leak, for every holder, with zero skill. Demand impact cannot
close the gap at plausible volumes (50 bps × heavy synthetic churn moved prices ~2% in a
day at most).

The fix is cheap. Measured leak per settled game, per requote cadence (all three seasons):

| Cadence | Leak per settled game |
|---|---|
| Frozen at open | +$48.8K / +$55.6K / +$58.9K |
| **Weekly full requote to trailing-10** | **+$3.8K / +$5.4K / +$4.8K** |
| Nightly half-step | +$4.0K / +$5.6K / +$4.9K |
| Nightly full | +$3.3K / +$4.6K / +$4.0K |

Weekly is already enough; pick the cheapest cadence to operate. The only hard rule is
*never frozen*. The small residual (+$3–5K/game) is a gentle everyone-drifts-up bias —
acceptable, arguably good for retention.

---

## 3. Opening costs: the shootout

Locking a full-season hold at each candidate opening anchor (both real season pairs,
130/128 players with a 20+ game prior season):

| Opening anchor | Pooled drift per game | Verdict |
|---|---|---|
| Last-season NP/game (raw) | **+0.75 NP (+$15.0K)** | Leaks — the league grows YoY |
| Last-season + 0.75 NP flat | −0.00 NP (−$45) | Pooled-perfect but over-taxes bench 25% |
| **Last-season × 1.08** | **+0.03 NP (+$598)** | **Winner — fair pooled AND best tier balance** |
| Opening-week D&T projection | +1.89 NP (+$37.8K) | Worst tested — never open on projections |
| 50/50 last-season + projection | +1.32 NP (+$26.4K) | Inherits the projection lowball |

Tier detail for ×1.08 (2024-25 → 2025-26): superstar +0.35, star +0.24, starter +0.76,
rotation +0.43, bench −1.94. The bench tier is noisy in both directions across pairs —
bench identity changes year to year, and the trailing requote takes over after 3 games,
so this is tolerable.

**Also measured and important:** never let an early-season *trailing* average set an
opening lock. October trailing locks drift +0.9 NP/game (the October hot-start) and turn
a star roster from fair into **−$23M over the season**. Trailing is the in-season requote
anchor, not the opening anchor.

### Fair-cost table at $20K (2025-26 production)

| Tier | NP/game | Players | Fair cost per game |
|---|---|---|---|
| Superstar | 20+ | 3 | $409K – $527K |
| Star | 14–20 | 19 | $281K – $385K |
| Starter | 9–14 | 47 | $180K – $278K |
| Rotation | 5–9 | 55 | $100K – $179K |
| Bench | <5 | 26 | $36K – $99K |

Examples: SGA $527K · Maxey $425K · Mitchell $409K · Jaylen Brown $385K · KD $367K.
The $25K quote floor is safe by 2.4× at the bottom of the universe (needs rate ≥ $8.5K).

---

## 4. What a normal user's P&L looks like ($20K, measured, stable across all 3 seasons)

Balanced 10-slot roster, fairly priced locks. A roster catches ≈ 4.5 games/night,
≈ 32 games/week.

| Horizon | Typical (±1 SD) | Big (p95) |
|---|---|---|
| **Night** | ±$250K–$290K | ±$500K–$650K |
| **Week** | ±$610K–$740K | ±$1.2M–$1.5M |
| **Season luck band** (random rosters, 2 SD) | ±$8.7M | — |

Season means are ≈ $0 for every archetype once anchors are fair (star −2 NP, balanced +6,
bench −10, random +3 ± 218 NP — all statistical zero). Skill has to clear the ±$8.7M luck
band to prove itself on a season leaderboard.

**Retention warning for the UI:** a completely fair, engaged user hits a median
**$1.2M–$1.9M peak-to-trough drawdown inside any 28-day window** (p95 up to $3.6M), and
single sample paths were down after both week 1 and month 1 in most season/roster
combinations. The P&L surfaces should lead with weekly deltas and a since-you-joined
baseline so a normal cold streak doesn't read as ruin.

---

## 5. Churn and fees

Under a fair anchor, the nightly streamer (re-picks tonight's top-projected players every
date, 1,356 adds/season, no fee) finished **below** the patient holder in every anchor
tested: −$1.3M to −$3.3M/season. Streaming is 2.5× the exposure at slightly negative
per-game edge — volume without an edge loses. The momentum chaser ("ride the last 3
games") was flat (+153 NP ≈ 0.7σ from random): momentum is not free money either.

So the $10K add fee is not load-bearing for economy safety — it exists for decision
weight and to damp quote-impact noise. Mechanically verified end-to-end in the engine:
fees post to the ledger, reconciliation holds (a pathological 16.6 adds/week costs
≈ $4.9M/season; real users churn far less).

---

## 6. Shorts

Random 7-day shorts under fair trailing quotes, all seasons: mean **−$14K to −$20K** per
window, win rate 48–49%, SD ≈ ±$300K. Zero-EV-minus-drift before fees, in every season —
a fair opinion market, not an income stream.

Duration: a 7-day window catches 3.42 games on average and cuts per-game luck to 0.54× of
a single game (1-day shorts are ~85–90% coin flip; 14 days over-commits through role
changes). Early close: allowed at the same $10K fee — the tipoff roster lock already
prevents closing after an outcome is knowable.

**Retracted claim:** "short the fading superstar after mid-January" looked like the
obvious meta in 2025-26 (+$52K/window, 60.7% win rate) but lost money in both prior
seasons (−$15K, −$8K). 1-for-3 is an overfit, not a strategy. The superstar late-season
fade itself is real in some seasons (even a perfect-knowledge anchor drifts −0.8 to −2.4
NP/game on post-January superstar locks) — but it is not reliably harvestable.

---

## 7. Corrections log (what testing overturned)

Kept deliberately, because each of these was a confidently wrong intermediate answer that
only more testing caught:

1. **"Opening premium +1.0 NP for everyone"** → wrong reason, wrong shape. The real
   opening correction is proportional (×1.08 for YoY league growth); October bias is
   handled by *not* using early trailing averages as opening locks.
2. **"Last-season anchor has 0.00 drift"** → the first measurement used a same-season
   proxy (season-minus-October) that was oracle-contaminated. The true prior-season test
   leaks +$15K/game raw; hence ×1.08.
3. **"Superstar-fade shorting is the first skill meta"** → 1-for-3 seasons; retracted.
4. **Star-holder −$23M panic** → not a product flaw; an artifact of October trailing
   locks. With correct opening anchors every archetype is fair to ±noise.

---

## 8. What the backend needs (Ryan)

1. **A requote job** — weekly or better, quote ← trailing-10 produced NP (min 3 games),
   ±15%/day cap, 50 bps add/drop impact on top. Runs naturally inside the roster-lock
   window after settlement. *Ship nothing without this.*
2. **Opening quote seeding** — last-season NP/game × 1.08 × rate; rookies from
   projection + 1.9 NP; floor $25K.
3. **Live ruleset constants** — `dividend_dollars_per_net_point = 20_000`,
   `open_fee_dollars = 10_000`, `drop_fee_dollars = 0`, short expiry 7 days.
4. **"Weekly pay" clarified** — in the old spec, "weekly" was only the short's exposure
   window (armed before the window, settling game-by-game Mon–Sun). All P&L settles
   per game, exactly as v2 already does. Shorts are simply 7-day-expiry positions.

## 9. Dividend basis: the scoring-margin question (2026-09-06 addendum)

Russ asked for scoring-margin impact instead of the weighted box score. Tested three
ways (`output/per-game-margin-study.md`, `per-game-plusminus-study.md`,
`per-game-blend-sweep.md`), including extracting real per-player on-court +/- from the
cached ESPN summaries (all 79,503 player-games, 100% join — the CSV had dropped the
column; note the live BDL pipeline does NOT carry +/-, so it could not settle on it
anyway without a provider change).

**Headline: the current NetPoints formula already IS a scoring-margin impact metric.**
Its team sums predict actual game margins at **r = 0.964 out-of-sample** — statistically
tied with a metric fit directly to margin (0.966 best blend, 0.939 pure fit) — while
beating both alternatives on every product axis. (Numbers corrected 2026-09-08: the
comparison scripts now import the exact engine `NetPointsCoefficients` instead of
hand-copied weights.)

| Basis | Team-margin r | Reliability (split-half) | Players ≤0 EV | Top-5 sanity |
|---|---:|---:|---:|---|
| **Old NetPoints** | **0.964** | **0.954** | **0/150** | SGA, Maxey, Mitchell, Murray… ✔ |
| Margin-fit box weights | 0.939 | 0.953 | 38/150 | Gobert, Clingan, Diabaté… ✘ |
| Raw on-court +/- | 1.000 (by construction) | 0.678 | 52/150 | SGA, then Champagnie/D. Robinson ✘ |

Raw +/- is unusable as a per-game dividend: its nightly noise (±12.3) exceeds the entire
market's value range (best player +11.6/game — one night is >100% noise), 35% of listed
players have negative expected value (unpriceable above the floor), and a balanced
roster at $20K would swing ±$1.04M per night against a star cost of only $232K. The
blend dial shows no useful middle: by α=0.75 the top of the market is already Duren/
Clingan/Gobert for +0.002 margin correlation.

**Recommendation: keep the NetPoints basis and every constant in section 1 — present
the r = 0.964 number to Russ as the evidence that margin impact is already what
dividends pay for.** If the group still switches to the margin-fit weights, the rerun
constants are: additive YoY opening uplift +0.28 (not ×1.08 — near-zero players can't
be scaled), same requote rule, and an unsolved 25%-of-the-universe floor problem that
needs a product decision before any rate can work.

## 10. Honest limits

- Engine-matrix order flow is synthetic (4 archetypes, 2 seeds); the archetype replays
  are single deterministic paths per roster (10 seeds for random). No live-demand market
  has been simulated on top of the requote mechanism.
- The rookie +1.9 NP correction is measured on veterans' projection lowball, not on
  rookies specifically.
- The superstar tier is 3 players in 2025-26 — its tier-level numbers are small-sample.
- Live tripwire, same discipline as v1: after ~4 live weeks, measure a plain hold
  account's EV. If it earns beyond noise, the requote cadence is too slow — tighten it
  before touching any other knob.

## 11. Evidence index

| Report | What it proves |
|---|---|
| `output/per-game-economy-v2.md/.json` | Ryan's 32-scenario engine matrix; frozen-quote leak; ledger reconciliation |
| `output/per-game-balance-study.md` | Anchor leak table, rate scale, streaming premium, short windows (2025-26) |
| `output/per-game-rate-study.md` | Tiers, noise anatomy, 7 archetypes, 6-rate sweep, skill separation, money flow |
| `output/per-game-lock-drift.md` | 7 anchors × 4 lock checkpoints × 5 tiers drift |
| `output/per-game-user-pnl-corrected.md` | Normal-user night/week bands under fair locks |
| `output/per-game-robustness.md` | All-season validation: leak, true last-season lock, bands, shorts, cadence, retention |
| `output/per-game-opening-anchor.md` | The 6-formula opening-anchor shootout → ×1.08 |
| `output/fee-check/` | Fee wiring acceptance (fees post + reconcile) |
| Scripts | `scripts/per_game_{balance_study,rate_study,lock_drift_test,user_pnl_corrected,robustness_tests,opening_anchor_shootout}.py` |
