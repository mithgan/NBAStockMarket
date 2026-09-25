import assert from 'node:assert/strict';
import test from 'node:test';

import type { PerGameBootstrap } from '../api/contracts';
import { refreshNotice } from './perGameNotices';

function snapshot(lastSettledDate: string | null, nextGameDate: string | null, cumulativePnl: number) {
  return {
    game: { seasonId: 's', lastSettledDate, nextGameDate, eventCursor: 0 },
    account: { cumulativePnl },
  } as unknown as PerGameBootstrap;
}

test('newly settled games report the score change, not "prices updated"', () => {
  const before = snapshot('2025-11-04', '2025-11-05', 100_000);
  assert.equal(
    refreshNotice(before, snapshot('2025-11-05', '2025-11-06', 423_000), false),
    'Games through Nov 5 are in. Your score rose $323K.',
  );
  assert.equal(
    refreshNotice(before, snapshot('2025-11-12', '2025-11-13', 33_000), false),
    'Games through Nov 12 are in. Your score fell $67K.',
  );
  assert.equal(
    refreshNotice(before, snapshot('2025-11-05', '2025-11-06', 100_000), false),
    'Games through Nov 5 are in. Your score is unchanged.',
  );
});

test('a refresh with nothing new confirms the account is current', () => {
  const same = snapshot('2025-11-05', '2025-11-06', 100_000);
  assert.equal(refreshNotice(same, same, false), "You're up to date. Next games Thu, Nov 6.");
  assert.equal(
    refreshNotice(same, snapshot('2025-11-05', null, 100_000), false),
    "You're up to date. The next games are not scheduled yet.",
  );
});

test('reconciliation keeps its own message', () => {
  const same = snapshot('2025-11-05', '2025-11-06', 100_000);
  assert.equal(
    refreshNotice(same, same, true),
    'Your account is back in sync. You can make roster moves again.',
  );
});
