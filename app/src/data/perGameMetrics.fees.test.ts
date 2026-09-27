import assert from 'node:assert/strict';
import test from 'node:test';

import type { PerGameLedgerEntry, PerGamePosition } from '../api/contracts';
import { MockPerGameApiClient } from '../api/mockPerGameClient';
import { positionGamePnl, scoreBreakdown, seasonSummary } from './perGameMetrics';

function position(overrides: Partial<PerGamePosition> = {}): PerGamePosition {
  return {
    positionId: 'long', playerId: 'p1', playerName: 'Player', side: 'long', status: 'active',
    lockedGameCost: 100_000, openedEventSequence: 1, closedEventSequence: null, expiresOn: null,
    cumulativeGameCost: 0, cumulativeDividend: 0, cumulativePnl: -250,
    ...overrides,
  };
}

function fee(positionId: string, kind: 'open_fee' | 'drop_fee' = 'open_fee'): PerGameLedgerEntry {
  return {
    eventCursor: 1, entryId: `${positionId}-${kind}`, positionId, playerId: 'p1',
    gameId: null, gameDate: null, resultRevision: null, kind, amountDollars: -250,
    adjustsEntryId: null, createdAt: '2025-10-21T00:00:00Z',
  };
}

test('a production add before any games reports its fee once and no phantom earnings', () => {
  // The Worker includes the open fee in position cumulativePnl as well as
  // the ledger/account, while game aggregates are both still zero.
  assert.deepEqual(scoreBreakdown(-250, [position()], [fee('long')]), {
    roster: 0, shorts: 0, closed: 0, closedCount: 0, fees: -250, other: 0,
  });
});

test('production active and closed long/short totals separate all embedded fees', () => {
  const positions = [
    position({ cumulativeGameCost: 100_000, cumulativeDividend: 150_000, cumulativePnl: 49_750 }),
    position({ positionId: 'short', side: 'short', cumulativeGameCost: 100_000, cumulativeDividend: -10_000, cumulativePnl: 109_750 }),
    position({ positionId: 'closed-long', status: 'closed', cumulativeGameCost: 100_000, cumulativeDividend: 80_000, cumulativePnl: -20_500 }),
    position({ positionId: 'closed-short', status: 'closed', side: 'short', cumulativeGameCost: 100_000, cumulativeDividend: 150_000, cumulativePnl: -50_500 }),
  ];
  const ledger = [fee('long'), fee('short'), fee('closed-long'), fee('closed-long', 'drop_fee'), fee('closed-short'), fee('closed-short', 'drop_fee')];
  const score = positions.reduce((sum, row) => sum + row.cumulativePnl, 0);
  assert.deepEqual(scoreBreakdown(score, positions, ledger), {
    roster: 50_000, shorts: 110_000, closed: -70_000, closedCount: 2, fees: -1_500, other: 0,
  });
});

test('complete position game aggregates do not shrink with a partial ledger', () => {
  const held = position({ cumulativeGameCost: 200_000, cumulativeDividend: 230_000, cumulativePnl: 29_750 });
  assert.equal(positionGamePnl(held), 30_000);
  assert.deepEqual(scoreBreakdown(29_750, [held], []), {
    roster: 30_000, shorts: 0, closed: 0, closedCount: 0, fees: 0, other: -250,
  });
});

test('practice add, settlement and close retain the same game totals and fee split', async () => {
  const client = new MockPerGameApiClient();
  const start = await client.bootstrap();
  const player = start.market[0];
  const opened = await client.openPosition({
    playerId: player.playerId, side: 'long', expectedAccountVersion: start.account.version,
    expectedQuoteVersion: player.quoteVersion,
  });
  const added = await client.bootstrap();
  const addSplit = scoreBreakdown(added.account.cumulativePnl, added.positions, added.ledger.items);
  assert.equal(addSplit.roster, 0);
  assert.equal(addSplit.fees, -added.ruleset.transactionFeeDollars);
  assert.equal(addSplit.other, 0);
  let played = added;
  for (let day = 0; day < 12 && played.settledResults.length === 0; day += 1) {
    client.advanceNight();
    played = await client.bootstrap();
  }
  assert.ok(played.settledResults.length > 0);
  const gameTotal = played.settledResults.reduce((sum, row) => sum + (row.netPnl ?? 0), 0);
  assert.equal(scoreBreakdown(played.account.cumulativePnl, played.positions, played.ledger.items).roster, gameTotal);
  await client.closePosition(opened.positionId, played.account.version);
  const closed = await client.bootstrap();
  const split = scoreBreakdown(closed.account.cumulativePnl, closed.positions, closed.ledger.items);
  assert.equal(split.closed, gameTotal);
  assert.equal(split.fees, -2 * closed.ruleset.transactionFeeDollars);
  assert.equal(split.other, 0);
});

test('season summary keeps a server rank outside the returned top 50 and leaves population unknown', () => {
  const summary = seasonSummary({
    score: 5_000, positions: [], ledger: [],
    leaderboard: [
      ...Array.from({ length: 50 }, (_, i) => ({ rank: i + 1, cumulativePnl: 100_000 - i * 1_000, isCurrentUser: false })),
      { rank: 312, cumulativePnl: 5_000, isCurrentUser: true },
    ],
  });
  assert.equal(summary.rank, 312);
  assert.equal(summary.of, null);
});
