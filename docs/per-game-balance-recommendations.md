# Per-game economy v2: status of balance recommendations

Updated September 10, 2026. The earlier constants table is superseded by the corrected [reviewed findings](per-game-v2-findings.md). No production settings are approved by this research pass.

| Earlier proposal | Status after correction |
|---|---|
|$20,000 per NetPoint | Experimental rate only; none of the candidate rates passes every condition in the corrected rate screen. |
| Last-season mean multiplied by 1.08 | Exploratory candidate; prior-season eligibility and matched coverage change the results. No held-out validation. |
| Fixed rookie uplift | Unvalidated; available forecasts and missing-data handling must be distinguished. |
| Weekly repricing capped at 5–10% | Previous favorable scout comparison does not reproduce under a prior-only entry sample and complete add fees. |
|$10,000 add fee | Modeled ledger assumption, not an optimized or validated fee. |
| Seven-day shorts | Duration diagnostic only; incomplete windows are excluded, but a full short policy and user behavior are not validated. |

The implementation work in this branch repairs evidence: scoring parity, temporal ordering, actual prior-season inputs, fees, floors, calendar windows and report conclusions. It does not implement a new settlement policy or certify the deployed market game.

The next balance decision needs a complete policy specification, explicit constraints and a fresh evaluation sample. The [full review record](per-game-research-review.md) and linked generated reports document what was actually checked.
