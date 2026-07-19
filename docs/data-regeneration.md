# Regenerating the simulator's data caches (so reruns match)

Every cache under `data/raw/` is git-ignored. This doc is the complete recipe for rebuilding
them from nothing so that `instruments_simulation.py` (and the analyses behind
`docs/shorting-spec.md`) reproduce their published numbers exactly.

## What the instruments simulator reads

| Cache | Contents | Used for | Rebuilt by |
|---|---|---|---|
| `data/raw/2025-26/` | ESPN player game logs + salaries + manifest | The replayed season | `scripts/fetch_backtest_data.py` |
| `data/raw/dnt/` | D&T pregame box predictions, one JSON per date, 2025-10-21 → 2026-04-12 | Expectations for every dividend/short settlement | `scripts/fetch_instruments_sim_data.py --seasons 2026` |
| `data/raw/2024-25/` | ESPN player game logs | **Cold-start bias seed** (prior October) | `scripts/fetch_instruments_sim_data.py --seasons 2025` |
| `data/raw/dnt-2024-25/` | D&T predictions 2024-10-22 → 2025-04-13 | Cold-start bias seed | same command |
| `data/raw/2023-24/` + `data/raw/dnt-2023-24/` | Same layout, 2023-10-24 → 2024-04-14 | Three-season bias/fee studies only (not the sim itself) | `scripts/fetch_instruments_sim_data.py --seasons 2024` |

(The FV/opening-price caches under `data/raw/opening/` are a separate pipeline —
`scripts/prepare_fv_inputs.py`, pinned by `data/manifests/fv-inputs.json` — and are not
needed by the instruments simulator.)

## Full rebuild from a clean checkout

```bash
# 1. The replayed season (ESPN logs + salaries + validated manifest)
python scripts/fetch_backtest_data.py --workers 8

# 2. Predictions for the replayed season + the prior seasons (needs DNT_API_KEY in .env)
python scripts/fetch_instruments_sim_data.py            # 2024, 2025, 2026 = all of the above

# 3. Verify, then run the acceptance sim
python -m nba_stock_market.instruments_simulation
```

Expected cache shapes after a full rebuild:

| Check | Expected (verified 2026-07-16) |
|---|---|
| `data/raw/2025-26/player_game_logs.csv` | 26,540 player-games, 1,230 games (manifest-enforced) |
| `data/raw/2024-25/player_game_logs.csv` | 26,206 player-games, 1,230 games |
| `data/raw/2023-24/player_game_logs.csv` | 26,283 player-games, 1,230 games |
| `data/raw/dnt/*.json` | 174 date files, 9 empty (off) days |
| `data/raw/dnt-2024-25/*.json` | 174 date files, 10 empty days |
| `data/raw/dnt-2023-24/*.json` | 174 date files, 13 empty days |
| Sim banner | `Rolling-30 bias with cold start +1.002 NP` |
| Sim coverage line | `10,689 settled player-games, 0 skipped` |
| Seed 2027 fader mean net | −$12,359 |

## Why reruns match (and the ways they can silently not)

**Determinism sources:** the season is historical (ESPN archives and D&T's historical
prediction endpoint are frozen); every cache file is written once and never re-downloaded if
present; the simulator is seeded (`--seed`, default 2027) and contains no wall-clock or
unordered iteration. Same caches + same seed ⇒ identical output, byte for byte.

**The three silent-divergence traps:**

1. **Missing 2024-25 cache ⇒ wrong cold start.** `cold_start_bias()` falls back to a generic
   +0.35 if `data/raw/2024-25/` or `data/raw/dnt-2024-25/` are absent — the sim still runs,
   with different early-season numbers and no error. Always confirm the banner says
   `cold start +1.002 NP`, not `+0.350`.
2. **Partial D&T cache.** An interrupted fetch leaves a valid-looking directory missing later
   dates; games on missing dates are skipped as "no projection." Check the coverage line
   reads `0 skipped` (2025-26). Re-running the fetch script fills only the gaps.
3. **Deleting cache files to "refresh" them.** Content should be identical on re-fetch
   (historical endpoints), but the guarantee of exact reproduction is the cache, not the
   provider. If you must refresh, re-run the acceptance sim and re-check the expected values
   above before trusting downstream comparisons.

## Provenance notes

- ESPN endpoints are public and keyless (`site.api.espn.com`); the 2025-26 fetch validates
  against the committed manifest (game/player-game counts, season bounds).
- D&T predictions require `DNT_API_KEY` (repo-root `.env`, never committed). The endpoint
  serves historical dates at least back to the 2022-23 season.
- Season windows are pinned in `scripts/fetch_instruments_sim_data.py` (`SEASONS`): 2023-24
  = 2023-10-24 → 2024-04-14, 2024-25 = 2024-10-22 → 2025-04-13, 2025-26 = 2025-10-21 →
  2026-04-12; each expects exactly 1,230 completed regular-season games and aborts loudly on
  any other count.
