# Passover 04 — Data, Caches, and Reproducibility

Source of truth: `docs/data-regeneration.md` (the full rebuild recipe with verified expected
values). This doc is the orientation layer on top of it.

## The four data families

| Family | Where | What | Source | Key needed |
|---|---|---|---|---|
| Season game logs | `data/raw/2025-26/`, `2024-25/`, `2023-24/` | Every player-game box score (~26.2-26.5K rows/season) | ESPN public endpoints | No |
| Pregame projections | `data/raw/dnt/`, `dnt-2024-25/`, `dnt-2023-24/` | D&T predicted box score per player per game day (174 date-files/season) | Dunks & Threes API | **Yes** (`DNT_API_KEY`) |
| FV model inputs | `data/raw/opening/` (materialized), `data/snapshots/fv/` (committed bytes) | LEBRON history, DARKO sheet, EPM season snapshots, salaries | site_Data / darko.app / D&T | EPM only |
| Committed evidence | `output/*.md`, `output/*.json` | Backtest report, FV validation, instruments sim, opening prices CSV | generated | — |

Everything under `data/raw/` is git-ignored; `output/` is ignored EXCEPT whitelisted
evidence files (see `.gitignore`).

## Rebuild commands (from a clean clone)

```
python scripts/fetch_backtest_data.py --workers 8      # 2025-26 ESPN + salaries + manifest
python scripts/fetch_instruments_sim_data.py           # prior seasons + all D&T caches
python scripts/prepare_fv_inputs.py                    # FV inputs from pinned snapshots
```

Then verify against the expected-values table in `docs/data-regeneration.md` (player-game
counts, 174 D&T files/season, the sim banner `cold start +1.002 NP`, coverage `0 skipped`).

## Keys and secrets

- **`DNT_API_KEY`** lives in the repo-root `.env` (git-ignored, never committed). Auth
  quirk: the API wants the raw key in an `Authorization` header (NOT `Bearer`). Endpoints
  used: `/api/v1/epm` (ratings; historical via `?date=`) and `/api/v1/game-predictions-box`
  (pregame box projections; historical back to at least Jan 2023).
- ESPN endpoints are public/keyless. Gabriel's `site_Data` and the DARKO sheet are public.

## The determinism story (why reruns match)

Historical endpoints are frozen; every cache file is written once and never re-downloaded if
present; sims are seeded with no wall-clock dependence. Same caches + same seed = identical
bytes out. The three silent-divergence traps (memorize these):

1. **Missing 2024-25 cache → wrong cold start.** The instruments sim silently falls back to
   +0.35 instead of +1.002. Check the banner.
2. **Partial D&T cache → games silently skipped** as "no projection." Check `0 skipped`.
3. **"Refreshing" caches by deletion** — content should match (frozen history) but the
   guarantee is the cache, not the provider. Re-verify expected values after any refresh.

## Provenance discipline (Ryan's, keep it)

- `data/raw/2025-26/manifest.json` — the backtest REFUSES to run if the cache disagrees
  (game counts, season bounds, duplicates).
- `data/manifests/fv-inputs.json` — SHA-256 pins for every FV input; `prepare_fv_inputs.py
  --refresh` fails loudly on provider drift instead of silently changing model output.
- Committed byte-exact snapshots under `data/snapshots/fv/` mean FV rebuilds need no network.

## House rules learned the hard way (project memory)

- **Never claim a result is validated unless that exact pipeline ran** — label everything
  "measured (cite the run)" vs "pending verification." Specs with acceptance tests do not
  ship before the tests execute.
- Single-seed sim results are rumors: per-short std ≈ $600K means a 700-short mean has
  ±$23K of luck. Pool ≥10 seeds or compute the population statistic.
- Never push to GitHub without Mith's explicit go-ahead. Local commits are always fine.
- Only generated reports are acceptance evidence; prose summaries can go stale.
