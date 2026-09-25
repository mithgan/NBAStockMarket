import assert from 'node:assert/strict';
import test from 'node:test';

import type { PerGameBootstrap, PerGamePosition } from '../api/contracts';
import { refreshHasNews, refreshNotice } from './perGameNotices';

function short(positionId: string, playerName: string, status: 'active' | 'closed', cumulativePnl: number) {
  return { positionId, playerName, side: 'short', status, cumulativePnl } as PerGamePosition;
}

function snapshot(
  lastSettledDate: string | null,
  nextGameDate: string | null,
  cumulativePnl: number,
  positions: PerGamePosition[] = [],
) {
  return {
    game: { seasonId: 's', lastSettledDate, nextGameDate, eventCursor: 0 },
    account: { cumulativePnl },
    positions,
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

test('a short that ran its term is named with what it made', () => {
  const before = snapshot('2025-11-04', '2025-11-05', 0, [short('s1', 'Tyrese Maxey', 'active', 200_000)]);
  const after = snapshot('2025-11-05', '2025-11-06', 345_000, [short('s1', 'Tyrese Maxey', 'closed', 345_000)]);
  assert.equal(
    refreshNotice(before, after, false),
    'Games through Nov 5 are in. Your score rose $345K. Your short on Tyrese Maxey ended: +$345K.',
  );
  const two = snapshot('2025-11-05', '2025-11-06', 0, [
    short('s1', 'A', 'closed', 345_000),
    short('s2', 'B', 'closed', -45_000),
  ]);
  const twoBefore = snapshot('2025-11-04', '2025-11-05', 0, [short('s1', 'A', 'active', 0), short('s2', 'B', 'active', 0)]);
  assert.match(refreshNotice(twoBefore, two, false), /2 shorts ended: \+\$300K in all\.$/);
});

test('a score that moved without new games is reported as a change', () => {
  const before = snapshot('2025-11-05', '2025-11-06', 100_000);
  assert.equal(
    refreshNotice(before, snapshot('2025-11-05', '2025-11-06', 300_000), false),
    'Your score changed by +$200K since the last update.',
  );
});

test('a refresh with nothing new confirms the account is current', () => {
  const same = snapshot('2025-11-05', '2025-11-06', 100_000);
  assert.equal(refreshNotice(same, same, false), "You're up to date. Next games Thu, Nov 6.");
  assert.equal(
    refreshNotice(same, snapshot('2025-11-05', null, 100_000), false),
    "You're up to date. The next games are not scheduled yet.",
  );
  assert.equal(refreshHasNews(same, same), false);
  assert.equal(refreshHasNews(same, snapshot('2025-11-05', '2025-11-06', 90_000)), true);
  assert.equal(refreshHasNews(same, snapshot('2025-11-06', '2025-11-07', 100_000)), true);
});

test('reconciliation keeps its own message', () => {
  const same = snapshot('2025-11-05', '2025-11-06', 100_000);
  assert.equal(
    refreshNotice(same, same, true),
    'Your account is back in sync. You can make roster moves again.',
  );
});
