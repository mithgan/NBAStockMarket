# Passover 01 — The Economy and Engine v2

Source of truth: `nba_stock_market/engine.py` + `docs/PLAN.md` (Economy v2 section).
This doc explains how money enters, moves, and leaves the game.

## The two channels: price and dividends

Engine v2 deliberately separates them:

- **Price** = what users pay each other (via the market maker). Moves ONLY on trading
  (exponential impact `P *= exp(k·q/L)`, k=0.003, depth L grows with volume+ownership) and
  on inactivity decay (−0.5%/day after a 7-day no-trade grace; floor $350K). Fair-value
  reversion exists in the code but defaults to **0/off** — research knob only.
- **Dividends** = what performance pays. After each real game:

```
dividend_per_holder = (actual_NP − (projected_NP + bias)) × $40,000
NET_POINTS_TO_DOLLARS = $4,000,000 per 100-share float → $40K per NP per holder
```

`NP` (net points) is a transparent linear box-score score (`NetPointsModel`: pts 1.0,
stl 1.5, ast 0.7, fga −0.7, minutes −0.15, etc. — every coefficient documented and
swappable). `projected_NP` comes from the **canonical expectation source**: cached Dunks &
Threes pregame box projections (`DunksAndThreesExpectation`, reads `data/raw/dnt/<date>.json`).
Negative dividends are real debits. Settlement is idempotent (settlement keys prevent
double-pays).

## The trading rules (all engine-enforced, all tested)

| Rule | Value |
|---|---|
| Bankroll | $140M, equal for everyone |
| Share semantics | 1 share = the whole player at salary-scale price; float 100; max 1 share per player per user |
| Fee | 0.25% per side (NBA-17 calibration) |
| Flip surcharge | +0.5pp per repeat flip, capped at 1.5% (anti wash-trading) |
| Idle-cash sink | 0.02%/day on cash |
| Listing grace | 7 days: no decay on new listings |

## Why expectations are the load-bearing wall

The whole economy is "actual minus expected." We proved two big things with three seasons of
replays (~79,000 projected player-games; details in `docs/fv-research-log.md` §7-8 and
`docs/shorting-spec.md` §8):

1. **Self-referential expectations break the game.** Under trailing-mean baselines, every
   quality signal ANTI-predicted payouts (ρ ≈ −0.2, window-proof): stars systematically lost
   their holders money; the optimal strategy was "never own Jokić." This finding drove
   Option B (absolute D&T projections).
2. **Even D&T projections have a within-season bias curve.** With each season's own fitted
   constant, top-150 players beat projections **every October (+0.66 to +1.15 NP/game) and
   November (+0.36 to +0.60) in all three seasons checked** (game-level beat rates 51-54%;
   player-level: 62.5% of 437 player-stretches net-beat in Oct+Nov ≈ 5σ from fair).
   Mid-season mildly reverses (2 of 3 seasons). Uncorrected, October pays every holder
   ~$120K/week per held player of free calendar money and makes early shorts suicidal.

**The decided fix (not yet in the production engine — the launch blocker):**

```
bias(d) = mean(actual − projected) over ALL projected player-games in [d−30, d−1]
cold start (first ~2 weeks): seed with LAST season's October mean (≈ +1.0)
fit on the LISTED universe, not the whole league
```

Measured effect: cuts the October bias 50-65%, near-zeroes mid-season, self-corrects if the
projection vendor changes. Implemented and validated in the instruments sim
(`instruments_simulation.py`); needs porting into `expectations.py` for production.

## Economy health (measured, not assumed)

- Full-season replay with all instruments active: cohort wealth −0.01% to −1.5% across
  seeds — inside the agreed band (−1.5%..+5%). Fees/idle-cash are the sinks; dividends are
  ~zero-sum by design under corrected expectations.
- Award dividends (MVP $15/share etc.) and season-end WARP dividends exist in the engine but
  are **dormant** — not part of the daily v1 economy.
- Watch-item: at realistic trader counts, inactivity decay compounds to ~0.5×/season on
  rarely-traded players (measured). It needs retuning before price-based features matter.

## Key numbers cheat-sheet

```
$140M bankroll | $40K per net point per holder | 0.25% fee/side
flip surcharge +0.5pp capped 1.5% | idle cash 0.02%/day | decay 0.5%/day after 7d
impact k = 0.003 | floor $350K | grace 7 days | bias +0.44 flat (to be replaced by rolling-30)
```
