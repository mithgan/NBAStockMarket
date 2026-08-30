# Gates: NBA Stock Market per-game economy v2

Scope: Replace the old large-portfolio economy with a tested per-game roster P&L model across simulation, backend, and the current integrated frontend without touching production data.

- [x] G1: The agreed and unresolved rules are captured in an implementation-ready design with no provisional constant presented as a final Russell decision.
  CHECK: test -s .context/orchestration/20260829-per-game-economy-v2/DESIGN.md && rg -n "Decided rules|Configurable policy|Deferred|Invariants" .context/orchestration/20260829-per-game-economy-v2/DESIGN.md
  EXPECT: /Decided rules.*Configurable policy.*Deferred.*Invariants/s
  EVIDENCE: Design headings verified at lines 7, 19, 31, and 41 for decided rules, configurable policy, invariants, and deferred scope.

- [x] G2: The engine supports 10 persistent long slots, locked per-game acquisition costs, per-game dividends, zero-based cumulative P&L, drops, and inverse short cash flows with deterministic tests.
  CHECK: uv run pytest -q tests -k 'per_game or locked_cost or short_cashflow or roster_slot'
  EXPECT: /[1-9][0-9]* passed/
  EVIDENCE: 98 passed, 287 deselected in 9.39s.

- [x] G3: A historical simulation compares the new economy under multiple churn, pricing, and short-policy configurations and produces a reproducible report.
  CHECK: test -s output/per-game-economy-v2.md && rg -n "Roster churn|Price stability|Early mispricing|Short policy|User P&L" output/per-game-economy-v2.md
  EXPECT: /Roster churn.*Price stability.*Early mispricing.*Short policy.*User P&L/s
  EVIDENCE: 96:## Short policy | 121:## User P&L

- [x] G4: Backend persistence and API responses expose the new roster-cost, game cash-flow, and cumulative P&L concepts without breaking idempotent settlement or correction behavior.
  CHECK: uv run pytest -q tests/api -k 'per_game or settlement or correction or portfolio or trade'
  EXPECT: /[1-9][0-9]* passed/
  EVIDENCE: 69 passed, 68 deselected in 11.52s, covering optimistic writes, idempotency, shared boundaries, missing projections, corrections, expiry, roster locks, and migration parity.

- [x] G5: The integrated app displays zero-based P&L, prior-season per-game value, current per-game market cost, and the user's locked cost using the real API contract.
  CHECK: npm --prefix app test -- --runInBand && rg -n "priorSeasonValuePerGame|currentGameCost|lockedGameCost|cumulativePnl" app/src
  EXPECT: /# fail 0.*priorSeasonValuePerGame.*currentGameCost.*lockedGameCost.*cumulativePnl/s
  EVIDENCE: 262 app tests passed; rendered 1440px, 390px, and 320px evidence is recorded in `.context/orchestration/20260829-per-game-economy-v2/RENDERED-UX.md`.

- [x] G6: The full Python verification suite passes from the feature worktree with the shared ignored historical-data cache mounted read-only after implementation.
  CHECK: uv run pytest -q
  EXPECT: /[1-9][0-9]* passed, [1-9][0-9]* subtests passed/
  EVIDENCE: 385 passed, 13 subtests passed in 68.68s.

- [x] G7: The full app verification suite passes from the feature worktree after implementation.
  CHECK: npm --prefix app test -- --runInBand
  EXPECT: /# fail 0/
  EVIDENCE: 262 passed, 0 failed.

- [x] G8: The Expo web application exports successfully from the feature worktree after implementation.
  CHECK: cd app && npx expo export --platform web --clear --output-dir /tmp/nba-stock-market-per-game-v2-gate
  EXPECT: /Exported: \/tmp\/nba-stock-market-per-game-v2-gate/
  EVIDENCE: Final export produced a 971 kB web bundle and `metadata.json`; `Exported: /tmp/nba-stock-market-per-game-v2-final-export`.

- [x] G9: Final review finds no secret leakage, accidental production operations, migration execution, or edits outside the planned ownership map.
  EVIDENCE: Final autoreview reported no actionable findings; all 41 changed/untracked paths are inside the planned engine/API/app/docs/test surfaces; high-risk secret scan found 0 matches; `git diff --check` passed; only isolated local SQLite/auth/schedule harnesses were used and no production deployment or migration was run.
