# Passover 03 — Instruments: Weekly Shorts, Price Short, Boosts

Source of truth: `docs/shorting-spec.md` (v1.0, signed off + acceptance-executed).
Implementation: `nba_stock_market/instruments.py` (`InstrumentsBook`). Acceptance harness:
`nba_stock_market/instruments_simulation.py` → `output/instruments-sim.md`. Design history
and rejected alternatives: `docs/shorts-and-longs-proposal.md`,
`docs/instruments-and-calibration-proposal.md`.

## The three instruments, one line each

| Slot | Count | The bet | Settles on | Max loss |
|---|---|---|---|---|
| Weekly short | 3 | "He performs below projection this week" | dividends, inverted, Mon-Sun | $2M/slot |
| Price short | 1 | "His market price is too high" | price (open→close) | 30% of entry |
| Boost | 2/week | "Double my guy tonight" (owned players) | dividends ×2, one game | 2× a bad night |

## Weekly shorts (the everyday instrument)

Arm before the window's first game; per-game surprise clamped ±25 NP, weekly total ±50 NP →
max swing $2M; $2M collateral reserved (no margin calls ever); **fee 0.25% of player price,
min $10K**; DNP games contribute $0; zero-game week voids with refund; one position per
(user, player) across ALL instrument types; league-wide cap 25 concurrent per player.
Weekly (not daily) because one game is ~85-90% noise — a 3-4 game window nearly doubles
skill-to-luck.

**Why the 0.25% ad-valorem fee (measured):** the only mindless-profit strategy found —
"fade last week's hottest 3" — earned +$42K/short under a flat $2K fee; at 0.25% it flips to
pooled **−$9.8K ± $7.5K over 6,493 shorts / 10 seeds**. Random shorting nets −$38.8K after
fee (10/10 seeds negative). Higher fees (0.30/0.35%) buy strict per-seed negativity but push
worst-seed deflation below the −1.5% band. Decision: keep 0.25% + live tripwire (re-measure
fade EV after ~8 real weeks; if pooled >0 beyond SE, raise to 0.30% and trim the idle sink).
Full 30-run table: `docs/shorting-spec.md` §9.

## Price short (the conviction instrument)

No cash proceeds at open (shorting must not mint liquidity); 30% collateral; sell-impact at
open, buy-impact at close; borrow 0.05%/day; stop-out at 1.3× entry checked every trade tick
AND daily; **gap-capped: settlement always at min(close, 1.3×entry)** so realized loss can
never exceed collateral; **borrow insolvency force-closes before any negative balance**;
long-term injury settles at the 10-day pre-injury average (never profit from ligaments);
decay pauses while shorted (kills the decay-farming exploit); league cap 10 open per player.

**Ships built but DISABLED**: in the full-season replay at prototype impact settings, no
price ever moved 5% off listing — the instrument has nothing to bite until Ryan's
market-mechanics calibration produces real price dispersion.

## Boosts (the temporary long)

2 slots per Mon-Sun week (reset Monday 00:00 ET, no rollover); owned players only; 2× the
game's dividend both directions; fee 0.25% of price; voided game returns slot AND fee;
mutually exclusive with shorting the same player. Note: at ad-valorem fees, habitual
boosting is deliberately −EV — boosts are spot conviction, not a routine. If live usage is
too low, the group may revisit a flat $10-25K fee.

## Acceptance status (executed 2026-07-16)

30 runs (10 seeds × 3 fee levels) through the production `InstrumentsBook` with rolling-30
bias + seeded cold start (+1.00 from real 2024-25 October):

- Random short EV ≈ −fee: **PASS** (all seeds)
- Fade ≤ 0 pooled across ≥10 seeds: **PASS** at 0.25% (−$9.8K; criterion is pooled-mean
  because per-seed means carry ±$23K sampling noise)
- Cohort inflation in band: **PASS** (mean −0.72%, worst −1.54% borderline)
- 159+ unit tests green, incl. gap-cap, insolvency, exclusivity, caps at exact boundaries

## Integration notes for the app/engine (not yet done)

- Engine trades don't check the book's collateral reservations — the app layer must route
  spend checks through `book.free_cash(user_id)` until unified.
- Driver contract: `record_game(...)` after each dividend, `expire_boosts(date)` nightly,
  `settle_week(week)` Sundays, `daily_pass()` in the daily cron, `check_stop_outs()` after
  trades.
- The rolling-30 bias must land in production `expectations.py` BEFORE instruments go live
  (see Passover 01 — the launch blocker).
- Instruments are not in the mobile app at all yet.
