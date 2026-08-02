# NBA Stock Market Mobile MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete persistent historical-season loop in the existing Expo client with buy/sell, daily dividends, three weekly shorts, two weekly boosts, history, and a dynamic leaderboard.

**Architecture:** A generated-data adapter derives replay days from the committed trend cache. A pure TypeScript state machine mirrors the Python economy and is wrapped by a versioned AsyncStorage context; screens consume only focused context commands and derived selectors.

**Tech Stack:** Expo SDK 54, React 19, React Native 0.81, TypeScript 5.9, AsyncStorage, react-native-svg, Node test runner, Playwright CLI.

---

### Task 1: Historical replay calendar

**Files:**
- Create: `app/src/data/replay.ts`
- Create: `app/src/data/replay.test.ts`

- [x] **Step 1: Write failing calendar tests**

Cover sorted unique dates, finite values, no duplicate `(player,date)` events, lookup of a player's next game, ISO Monday-Sunday week keys, and the retained Jokic 2025-12-25 spot check.

- [x] **Step 2: Verify RED**

Run: `cd app && npx tsx --test src/data/replay.test.ts`

Expected: FAIL because `replay.ts` does not exist.

- [x] **Step 3: Implement the adapter**

Export `ReplayEvent`, `ReplayDay`, `replayDays`, `replayDayByDate`, `weekKey`, and `nextEventForPlayer`. Derive all values from `playerTrends`; never fetch or hand-edit event values.

- [x] **Step 4: Verify GREEN**

Run: `cd app && npx tsx --test src/data/replay.test.ts`

Expected: all replay tests pass.

### Task 2: Pure game state machine

**Files:**
- Create: `app/src/state/game.ts`
- Create: `app/src/state/game.test.ts`
- Modify: `app/src/state/portfolio.ts`
- Modify: `app/src/state/portfolio.test.ts`

- [x] **Step 1: Write failing economy tests**

Cover 0.25% buy/sell fees, one-share cap, reserved-cash affordability, duplicate-date rejection, exact positive/negative holder dividends, boost doubling in both directions, boost void refund, short fee/collateral, three-slot cap, conflict rules, +/-25 per-game and +/-50 weekly clamps, zero-game short void, week settlement, and finite-money invariants.

- [x] **Step 2: Verify RED**

Run: `cd app && npx tsx --test src/state/game.test.ts src/state/portfolio.test.ts`

Expected: FAIL on missing game transitions and changed trade-fee expectations.

- [x] **Step 3: Implement minimal pure transitions**

Create a serializable `GameState` and atomic result functions: `createInitialGameState`, `tradePlayer`, `armWeeklyShort`, `armBoost`, `advanceReplayDay`, `resetGame`, `getFreeCash`, `getGameSummary`, and `rankGameLeaderboard`. Constants must match the Python modules exactly.

- [x] **Step 4: Verify GREEN and refactor**

Run: `cd app && npm test`

Expected: all state and data tests pass with no warnings.

### Task 3: Versioned persistence and context

**Files:**
- Create: `app/src/state/persistence.ts`
- Create: `app/src/state/persistence.test.ts`
- Modify: `app/src/state/PortfolioContext.tsx`
- Modify: `app/package.json`
- Modify: `app/package-lock.json`

- [x] **Step 1: Install the SDK-compatible storage package**

Run: `cd app && npx expo install @react-native-async-storage/async-storage`

Expected: Expo installs the SDK 54 compatible package and updates the lockfile.

- [x] **Step 2: Write failing persistence tests**

Test current-version round trip, missing value, malformed JSON, wrong schema version, invalid money, and injected read/write failure behavior.

- [x] **Step 3: Verify RED, implement, verify GREEN**

Run before and after: `cd app && npx tsx --test src/state/persistence.test.ts`

The provider must expose hydration state and save errors, skip the initial pre-hydration write, persist every later game state, and confirm before reset.

### Task 4: Complete mobile-first workflow UI

**Files:**
- Modify: `app/App.tsx`
- Modify: `app/src/screens/PortfolioScreen.tsx`
- Modify: `app/src/screens/MarketScreen.tsx`
- Modify: `app/src/screens/LeaderboardScreen.tsx`
- Create: `app/src/screens/PlaysScreen.tsx`
- Create: `app/src/components/SeasonControl.tsx`
- Create: `app/src/components/PortfolioHistoryChart.tsx`
- Modify: `app/src/theme.ts`
- Modify: `app/src/data/uiContracts.test.ts`

- [x] **Step 1: Add failing UI-contract tests**

Require four stable tabs, 44px controls, explicit accessibility labels/states, a duplicate-safe advance control, search empty state, instrument slot labels, feedback region, reset confirmation, and non-negative letter spacing in touched styles.

- [x] **Step 2: Verify RED**

Run: `cd app && npx tsx --test src/data/uiContracts.test.ts`

- [x] **Step 3: Implement screens and components**

Portfolio: value/free cash/reserved cash, history, holdings, daily result, activity, reset. Market: search, current prices, detail, fee-aware buy/sell. Plays: slot summaries, open positions, shortable and boostable lists with next-game labels. Leaders: live You rank and explicit prototype-rival label. Season control: next date, advance, settling/complete/disabled states.

- [x] **Step 4: Verify GREEN**

Run: `cd app && npm test && npx tsc --noEmit`

### Task 5: Rendered UX and functionality loop

**Files:**
- Modify only files implicated by confirmed findings in `app/`
- Save evidence under: `output/playwright/mobile-mvp/`

- [x] **Step 1: Export and serve the app**

Run: `cd app && npx expo export --platform web --output-dir /tmp/nba-stock-mobile-mvp-dist`

Run: `npx serve /tmp/nba-stock-mobile-mvp-dist -l 5197`

- [x] **Step 2: Test first-time and returning workflows**

At 390x844 and 760x900: navigate every tab; buy, blocked buy, sell, search, details/back, arm short, conflict rejection, arm boost, advance, inspect math/history/activity/leaderboard, refresh, reopen, reset/cancel/reset-confirm, season-end disabled state, keyboard focus, text scaling, empty/error states, slow repeated taps, and missing-image fallback.

- [x] **Step 3: Record and fix findings**

For every confirmed issue record reproduction, expected, actual, severity, and impact in `.loop/nba-stock-mobile-mvp/state/review_findings.jsonl`. Add a failing test before each behavior fix, then rerun its original rendered reproduction.

- [x] **Step 4: Repeat until clean**

Stop only when a fresh full pass finds no unresolved high/medium issue.

### Task 6: Closeout

**Files:**
- Update: `.context/orchestration/20260720-mobile-mvp/STATE.md`
- Update: `.loop/nba-stock-mobile-mvp/state/*`

- [x] **Step 1: Run complete verification**

```bash
cd app && npm test
cd app && npx tsc --noEmit
cd app && npx expo export --platform web --output-dir /tmp/nba-stock-mobile-mvp-dist
python3 -m pytest -q
git diff --check
```

- [x] **Step 2: Run structured review**

Run: `/Users/ryanyin/.codex/skills/autoreview/scripts/autoreview --mode local --parallel-tests "cd app && npm test && npx tsc --noEmit"`

Verify each finding against the real code, fix accepted findings test-first, and rerun until clean.

- [x] **Step 3: Secret scan and local commit**

Confirm `.env` and key patterns are absent from the diff, create a local commit without collaborator trailers, and do not push.

- [x] **Step 4: Update Linear**

Attach verification evidence to NBA-10 and its scoped child issues. Mark complete only if every acceptance criterion has fresh proof.
