import assert from 'node:assert/strict';
import test from 'node:test';

import { MockPerGameApiClient } from './mockPerGameClient';

test('the mock market plays the real rules end to end', async () => {
  const client = new MockPerGameApiClient();
  const boot = await client.bootstrap();
  assert.equal(boot.positions.length, 0);
  assert.equal(boot.capabilities.canAdvanceReplay, true);
  assert.equal(boot.ruleset.rosterMutationsLocked, false);
  assert.ok(boot.market.length >= 10);

  const player = boot.market[0];
  const open = await client.openPosition({
    playerId: player.playerId,
    side: 'long',
    expectedAccountVersion: boot.account.version,
    expectedQuoteVersion: player.quoteVersion,
  });
  assert.equal(open.lockedGameCost, player.currentGameCost);

  // A stale quote version must be rejected before any cost locks.
  const after = await client.bootstrap();
  await assert.rejects(
    client.openPosition({
      playerId: player.playerId,
      side: 'long',
      expectedAccountVersion: after.account.version,
      expectedQuoteVersion: player.quoteVersion,
    }),
    /already hold|quote moved/i,
  );

  // The opposing side of a held player is blocked.
  await assert.rejects(
    client.openPosition({
      playerId: player.playerId,
      side: 'short',
      expectedAccountVersion: after.account.version,
      expectedQuoteVersion: after.market[0].quoteVersion,
    }),
    /opposing/i,
  );

  // Open fee reached the ledger and the score.
  assert.equal(after.account.cumulativePnl, -after.ruleset.transactionFeeDollars);
  assert.equal(after.ledger.items.filter((entry) => entry.kind === 'open_fee').length, 1);
  assert.equal(after.account.longSlots.used, 1);

  // Settle nights until the held player plays, then verify the arithmetic.
  let settled = await client.bootstrap();
  for (let night = 0; night < 12 && settled.settledResults.length === 0; night += 1) {
    client.advanceNight();
    settled = await client.bootstrap();
  }
  assert.ok(settled.settledResults.length > 0, 'no night settled in 12 advances');
  const result = settled.settledResults[0];
  assert.equal(result.status, 'settled');
  assert.equal(
    result.netPnl,
    (result.dividendDollars ?? 0) - result.lockedGameCost,
  );
  const position = settled.positions.find((row) => row.positionId === result.positionId);
  assert.ok(position);
  assert.equal(
    position.cumulativePnl,
    position.cumulativeDividend - position.cumulativeGameCost,
  );

  // The ledger reconciles with the account score exactly.
  const ledgerSum = settled.ledger.items.reduce((sum, entry) => sum + entry.amountDollars, 0);
  assert.equal(ledgerSum, settled.account.cumulativePnl);

  // The clock moved and the leaderboard tracks the account.
  assert.notEqual(settled.game.lastSettledDate, boot.game.lastSettledDate);
  const you = settled.leaderboard.find((row) => row.isCurrentUser);
  assert.ok(you);
  assert.equal(you.cumulativePnl, settled.account.cumulativePnl);

  // Closing frees the slot and charges the drop fee.
  const close = await client.closePosition(open.positionId, settled.account.version);
  const closed = await client.bootstrap();
  assert.equal(close.positionId, open.positionId);
  assert.equal(closed.account.longSlots.used, 0);
  assert.equal(closed.ledger.items.filter((entry) => entry.kind === 'drop_fee').length, 1);
});
