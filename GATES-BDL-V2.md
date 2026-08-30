# Gates: BDL to per-game v2 live settlement

Scope: connect finalized Ball Don't Lie player results to the per-game v2 settlement contract without changing the existing v1 economy or operating production.

- [x] L1: The design records BDL game-status, player-result, revision, schedule-lock, retry, and ownership contracts before implementation.
  CHECK: rg -n "Final-game contract|Revision contract|Roster-lock contract|Failure contract|Ownership boundary" .context/orchestration/20260830-bdl-v2-live/DESIGN.md
  EXPECT: /Final-game contract.*Revision contract.*Roster-lock contract.*Failure contract.*Ownership boundary/s
  EVIDENCE: 78:### Failure contract | 82:### Ownership boundary

- [x] L2: Only finalized BDL games produce v2 settlement commands, and each player command uses the canonical BDL mapper plus `NetPointsModel` rather than a duplicate formula.
  CHECK: PYTHONDONTWRITEBYTECODE=1 .venv/bin/pytest -q tests/test_bdl_live.py tests/api/test_live_settlement_sink.py -k 'final or real_bdl_payload' -p no:cacheprovider
  EXPECT: /[1-9][0-9]* passed/
  EVIDENCE: .......... [100%] | 10 passed, 62 deselected, 17 subtests passed in 0.70s

- [x] L3: Repeating an unchanged provider result is a no-op, while a changed finalized box score produces one monotonic correction revision and no second game cost.
  CHECK: PYTHONDONTWRITEBYTECODE=1 .venv/bin/pytest -q tests/test_live_settlement.py tests/api/test_live_settlement_sink.py -k 'revision or correction or idempotency or unchanged or response_is_lost' -p no:cacheprovider
  EXPECT: /[1-9][0-9]* passed/
  EVIDENCE: .......... [100%] | 10 passed, 56 deselected in 1.12s

- [x] L4: Partial provider failures remain retryable, do not unlock a still-active game window, and do not cause already-settled players to be paid twice.
  CHECK: PYTHONDONTWRITEBYTECODE=1 .venv/bin/pytest -q tests/test_live_settlement.py tests/api/test_live_settlement_sink.py -k 'retry or lock or lease or unmapped or unlock or response_is_lost' -p no:cacheprovider
  EXPECT: /[1-9][0-9]* passed/
  EVIDENCE: ............................................. [100%] | 45 passed, 21 deselected in 4.81s

- [x] L5: The callable runtime is disabled by default, uses the existing lease/scheduler ownership model, and honestly documents that the external Flask adapter is still required before staging.
  CHECK: rg -n "disabled by default|existing Flask scheduler|does not register|Setting variables alone has no effect|Flask adapter|BALL_DONT_LIE_API_KEY|no D&T" docs/live-settlement-v2.md
  EXPECT: /disabled by default.*existing Flask scheduler.*does not register.*Setting variables alone has no effect.*Flask adapter.*BALL_DONT_LIE_API_KEY.*no D&T/s
  EVIDENCE: 4: external Flask adapter not yet implemented | 5: disabled by default | 9: existing Flask scheduler | 11: does not register | 12: Setting variables alone has no effect | 14: Flask adapter | 25/119: BALL_DONT_LIE_API_KEY | 84: no D&T

- [x] L6: Focused provider/pipeline tests and the complete Python suite pass after implementation.
  CHECK: PYTHONDONTWRITEBYTECODE=1 .venv/bin/pytest -q -p no:cacheprovider
  EXPECT: /[1-9][0-9]* passed, [1-9][0-9]* subtests passed/
  EVIDENCE: 481 passed, 49 subtests passed in 30.58s

- [x] L7: Final autoreview reports no accepted/actionable findings, `git diff --check` passes, and no production deployment, migration application, or secret addition occurred.
  EVIDENCE: autoreview clean, patch correct (0.86 confidence); `git diff --check` passed; 12 scoped Python files passed Black check; `compileall` passed; 13 migration tests passed; no credential-shaped token or populated API-key assignment found outside ignored local secret files. No production command, migration application, deployment, or runtime enablement was executed.
