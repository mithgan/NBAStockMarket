# Passover 06 — Roadmap, Open Questions, and Ownership

The single prioritized list of what's undone, undecided, and who owns it.
(Updated 2026-08-02: the former P0 — rolling bias in production — LANDED in `bias.py`;
instruments landed server-side + in the app's Plays tab.)

## P0 — current top priorities

1. **Merge the UI rebuild** (`codex/standalone-web-flask`: Databallr design system,
   sort/filters, compact money, density/landscape fixes) back into the MVP branch before
   the branches drift further. Owner: Ryan (+ Mith's ongoing UI pass).
2. **Production deployment hardening**: Render API + Supabase schema are configured
   (`render.yaml`, `scripts/push_supabase_schema.sh`); needs a deployed environment
   smoke-tested end-to-end with real auth and a settled replay date. The three
   Supabase-CLI tests require the CLI + bash locally.
3. **Fee tripwire process** (from shorting-spec §9): after ~8 live weeks, re-measure fade
   EV pooled; if > 0 beyond SE, raise fee to 0.30% AND trim the idle sink together.

## P1 — quality follow-ups

1. **Decouple the snapshot→trends regex** in `generate_app_trends.py` (emit/read JSON) —
   the most fragile joint in the data pipeline.
2. **Borrow-fee ledger test** (`borrow_paid` in `InstrumentsBook` is tracked but untested).
3. **Exact-money surfacing** at trade confirmation (compact $34.6M display vs exact
   affordability math can look contradictory at the boundary).
4. **"Move" sort baseline**: currently price-vs-listing; relabel or switch to day-over-day
   once meaningful price history accumulates.

## P2 — group decisions still open (each has a written recommendation)

| Question | Where discussed | Recommendation on file |
|---|---|---|
| Listed universe: 150 vs 300 players | instruments proposal | affects bias fit; decide before curve fit |
| $70M listing cap: keep or lift | opening-price-model.md | keep for legibility (known rank cost at the top) |
| Boost fee if usage too low | shorting-spec §4 | revisit flat $10-25K |
| Weekly-short notional: flat $2M vs price-scaled | shorting-spec open Qs | flat (keeps bench shorts meaningful) |
| Short-interest visibility | shorting-spec §7 | reveal after settlement + "most shorted" aggregate at window open |
| Playoffs mode scope | call transcript + spec | reset board, long/short anyone, force-close on elimination |
| Rookie/IPO path (college seed + auction) | build spec §5 | not started; rookies were the old economy's biggest earners |
| Community census mechanics (±15% bound) | opening-price-model.md | designed, unimplemented |

## P3 — product build-out

- **App**: persistence, autoplay replay, per-holding dividend attribution, live rivals from
  synthetic portfolios, >30 listings, instruments UI, then the real multiplayer backend
  (the app is currently backend-less by design).
- **Market mechanics** (Ryan's workstream): order-flow calibration so prices actually move
  — gates the price short (built, shipped disabled) — and retune inactivity decay
  (compounds to ~0.5×/season at realistic trader counts, measured).
- **Dunks & Threes upgrade path**: D&T pregame projections are canonical; trailing/salary/
  production modes remain comparison-only (`generate_expectation_comparison.py`).

## Needs from Russ (standing)

- Impact-metric decision confirmation (EPM primary / DARKO fallback is our working state).
- Linear workspace access (was blocked); Andrew session for dividend-coefficient review.

## Standing working agreements

- Never push to GitHub without Mith's explicit word; local commits always fine.
- "Run a sim" means run the sim — nothing is called validated until that exact pipeline
  executed; measured vs pending is always labeled.
- Only generated reports in `output/` are acceptance evidence.
- MVP branch (`codex/nba-stock-sim-prototype`) stays demo-stable; experiments live on
  side branches (`mith/experiments`).

## Where every big number came from (index of evidence)

| Claim | Evidence file |
|---|---|
| FV beats naive in all 4 windows | `output/fv-validation.md` |
| Backtest economy −0.41% (v2 era) / reproduction exact | `output/backtest-2026.md` |
| Fee sweep 30 runs, 0.25% decision | `docs/shorting-spec.md` §9 |
| Oct/Nov bias 3-for-3 seasons, 5σ | `docs/fv-research-log.md` §7-8 + shorting-spec §8 |
| impact_k = 0.003, fee softening | `output/trader-simulation.md` |
| Instruments acceptance PASS | `output/instruments-sim.md` |
