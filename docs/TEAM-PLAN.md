# Team Plan — NBA Stock Market (Ryan / Mith split)

Working agreement as of 2026-07-11. Anchored to the group call decisions:
$140M salary-cap bankroll, ~10-player portfolios, 100 shares/player with 40% ownership cap,
**no fair-value reversion** (daily dividends carry the performance signal), price = supply/demand
+ inactivity decay, shorting later, mobile app (Expo) after the economy is validated.

## Where we already are (don't redo this)

- **Engine v2 is built and committed** (`nba_stock_market/engine.py`): $140M economy, daily
  performance dividend = (actual − expected net points) × $100K across the float, negative
  dividends allowed, reversion off, fees/decay/ownership caps, and a tested provider boundary.
- **Full 2025-26 backtest is done** (`output/backtest-2026.md`): 1,230 games, 26,547 player-games
  replayed. Headlines: season economy is slightly deflationary (−0.41%); a 90th-percentile star
  game pays ~$1.4M across the float (target was ~$800K — kept, within 2×); **trailing-baseline
  expectations mean IMPROVERS mint money (Fears/Flagg top the table) while stars are
  dividend-neutral** — flag for design discussion.
- **Gabriel's repo is public** — https://github.com/gabriel1200/site_Data — no need to wait on
  Russ for access. Our fetch script already caches it plus ESPN game logs under `data/raw/`.

## Ryan (bigbrolin) — engine, data, infrastructure

1. ~~Engine v2~~ ✅ · ~~2025-26 backtest + economy report~~ ✅
2. **Dunks & Threes adapter**: wire `DunksAndThreesExpectation` to the real
   `game-predictions-box` endpoint the moment Russ sends the API key (upgrade from
   trailing-mean to opponent-aware projected box scores). Re-run backtest, compare economies.
3. ~~**Market mechanics validation**~~ ✅: deterministic balanced/hype/boom-bust sweep selected
   provisional `IMPACT_K = 0.003`; all price and ownership invariants held. See
   `output/trader-simulation.md`. Follow-up required before production: the current 1% fee plus
   escalating flip surcharge removed 49–52% of wealth in the hype stress runs.
4. **App scaffold** (after economy sign-off): Expo/React Native, Robinhood-style portfolio UI,
   daily P&L feed, leaderboard.

## Mith — game economy design + math

1. **Initial pricing model** (your "fv pricing system"): opening listing prices from salary ×
   DARKO/impact blend — deliverable = a formula/spec + CSV for the top ~300 players that Ryan
   wires into listing. (Reframe from the call: there's no in-market fair-value pull anymore;
   "FV" = opening price + a reference line we can show in the UI.)
2. **Dividend calibration** (with Andrew, per Russ): own the net-points coefficients
   (`NetPointsModel` — transparent linear weights, swappable) and the $/net-point constant.
   Input = section B of `output/backtest-2026.md`. Open design question to answer: is
   "improvers mint money, stars stay neutral" the game we want, or should expectation be
   absolute (projection-based) rather than each player's own trailing baseline?
3. **Shorting/longs design spec** (your item #3): mechanics doc — collateral, max short slots,
   price impact of shorts, injury/DNP handling, temporary 2× longs. Doc first, sign-off, then
   Ryan implements in the engine.

## Needs from Russ

- Dunks & Threes API key (he said he'd send it).
- Impact metric decision (DARKO to start, per call).
- Linear workspace access for the project board (auth currently blocked).

## Cadence

- Async in Discord; review `output/backtest-2026.md` together before the next call.
- Rule from the call: keep it simple — buys/sells first; shorts only after the core loop feels right.
