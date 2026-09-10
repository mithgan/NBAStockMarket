# Per-game research review — September 10, 2026

All ten per-game research scripts were reviewed, corrected and run on the recovered historical inputs. This branch repairs the calculations and their interpretation. It does not change the production scoring coefficients or economy rules, and it does not certify the deployed application or select a production constant set.

## Corrections

| Area | Corrected behavior |
|---|---|
| Scoring | Every engine comparison includes minutes and three-point attempts and agrees with the existing engine. |
| Entry and chronology | Actionable roster samples, rankings and quotes use information recorded before entry; calibration games cannot earn retroactive cash flow. Retrospective and participation-oracle diagnostics are identified explicitly. |
| Accounting | Each actual add pays its signing fee, reopened positions pay again, held positions retain their cost until a scheduled change, and applicable floors/caps are enforced. Gross and net results are distinguished. |
| Prior-season anchors | Actual earlier-season records replace current-season stand-ins. Candidate anchors use a common eligible sample and only the first game's available forecast. |
| Windows and risk | Weekly updates follow the stated schedule even when warmup is incomplete. Calendar risk includes initial losses and zero-return days. Incomplete short windows are excluded and counted; variable-exposure SD uses each window's average. |
| Decision rules | Every advertised rate condition affects the verdict. Correlation, repeatability and retrospective residuals cannot establish causal impact, user skill or production approval. |
| Forecast identity | Nine explicit historical name pairs use verified NBA IDs for fallback matching. Exact matches retain priority; ambiguous matches fail, and missing/null forecasts remain unavailable. |
| Retrieval | The ESPN fetcher uses ordinary curl transport after the custom user-agent was rejected. The changed download path and cache reuse were exercised against a public historical scoreboard. |

Separate reviewers cross-checked the economics and statistics file groups. Two additional findings—midweek updates after warmup and incomplete short windows—were reproduced independently, fixed by their original owners and covered by regressions that failed before the fixes.

## Input coverage

| Season | Regular-season games | Player-game records | Raw plus-minus joins | Usable dated forecasts |
|---|---:|---:|---:|---:|
| 2023–24 | 1,230 | 26,283 | 26,283 | 26,283 |
| 2024–25 | 1,230 | 26,206 | 26,206 | 26,206 |
| 2025–26 | 1,230 | 26,547 | 26,547 | 26,515 |

The full sample has 79,036 player-game records across 3,690 games. All played dates have corresponding forecast cache files. Game/season/date joins and three-point attempts were checked against the saved summaries; duplicate player-game keys and mismatched attempts were zero. NBA Cup final groups outside the regular-season sample were excluded.

Identity matching recovers 255 already-existing forecasts. Every previously usable forecast field remains unchanged. The 32 remaining current-season gaps comprise 31 named rows with null scoring values and one missing usable name match. None was replaced with invented projections or game outcomes. Original publication and correction timestamps are absent, so the pregame availability of saved forecast values remains an assumption.

The less-obvious Mensah and Cui aliases have primary identity evidence: the [NBA G League Mensah profile](https://gleague.nba.com/player/1641877) contains both Nate and Nathan for one ID; the [NBA Cui profile](https://www.nba.com/player/1642385/cui-yongxi/profile) and [G League stats page](https://stats.gleague.nba.com/player/1642385/misc) share the same ID across the two name orders. The other seven pairs were established through unique exact-name ESPN-to-NBA bridges in the archives.

## Verification

- Full Python suite: **544 tests and 73 subtests passed**.
- App suite: **262 tests passed**; TypeScript checking passed.
- All ten real script entrypoints completed twice, with `PYTHONHASHSEED=1729` and `2718`. Every report was byte-identical between runs. Report tables were checked for finite displayed values and consistent column counts; copied reports only normalize trailing blank lines.
- Each of the three scoring comparisons agrees with the engine across all 79,036 records. Blend endpoints and halfway interpolation were also checked.
- An independent event ledger reconciles all 65 repricing traces: **11,795 openings and 35,520 held-game settlements**, including opening fees, gross/net totals, timing, floors and capped changes. The displayed comparison rows match those independently summed results.
- Source and CSV hashes remained unchanged during the two runs. The [machine-readable review evidence](../output/per-game-research-review.json) records source/report/input hashes, final coverage, test counts and repricing results.

An initial full test run lacked the ignored `data/raw` link in the isolated checkout. A subsequent attempt encountered transient shared-disk exhaustion. The final counts above come from a complete successful run after attaching the input data and restoring available space; no tests were skipped or weakened.

## Reproduction

Install the project's Python dependencies and app dependencies. Research scripts read raw inputs from the current working directory and write reports below `output/`. Supply the regular-season CSVs and saved ESPN summaries under `data/raw/<season>/`; forecast caches are `data/raw/dnt-2023-24`, `data/raw/dnt-2024-25` and `data/raw/dnt` for the current sample. Provider credentials are needed to fetch licensed forecasts; they are not stored in this branch.

From the repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 python -m pytest -q -p no:cacheprovider tests
```

Run `npm test` and `npx tsc --noEmit` from `app/`. Run each `scripts/per_game_*.py` with the repository on `PYTHONPATH`, using an isolated working directory that contains the above data layout. Repeat with the two hash seeds to compare raw report hashes. The [evidence index](per-game-v2-findings.md) maps all ten scripts' reports to their questions.

The final structured code review uses the Codex autoreview helper against base commit `73ef41da9da17fcad4bc77aa788a3e799723b5d9`. Its result is recorded separately after reviewing the complete committed branch diff; it is not inferred from these test counts.

## Interpretation

The corrected rate screen approves none of its tested rates, and the old favorable 5–10% cap recommendation does not survive the corrected repricing sample. These findings concern the declared research scenarios. They do not establish that every cap is poor, that no useful game design exists, or that simulated profits predict actual user behavior. Opening candidates were historically explored and remain exploratory. Budget, demand, market impact and a complete short policy require separate evaluation before adoption.
