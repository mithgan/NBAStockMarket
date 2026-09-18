import assert from 'node:assert/strict';
import test from 'node:test';

import type { PerGameLedgerEntry } from '../api/contracts';
import { scoreComponents } from './perGameScoreComponents';

function entry(kind: PerGameLedgerEntry['kind'], amountDollars: number): PerGameLedgerEntry {
  return {
    eventCursor: 1,
    entryId: 'example-entry',
    positionId: 'example-position',
    playerId: 'example-player',
    gameId: 'example-game',
    gameDate: '2026-10-24',
    resultRevision: 1,
    kind,
    amountDollars,
    adjustsEntryId: null,
    createdAt: '2026-10-25T03:00:00Z',
  };
}

function assertReconciles(entries: PerGameLedgerEntry[], expectedPnl: number) {
  const components = scoreComponents(entries);
  assert.equal(components.dividends + components.gameCosts + components.fees, expectedPnl);
  assert.equal(entries.reduce((total, row) => total + row.amountDollars, 0), expectedPnl);
  return components;
}

test('score components begin at zero when there are no ledger movements', () => {
  assert.deepEqual(scoreComponents([]), { dividends: 0, gameCosts: 0, fees: 0 });
});

for (const side of ['long', 'short']) {
  const direction = side === 'long' ? 1 : -1;

  test(`${side} played-to-DNP reverses game charges and payouts while retaining account fees`, () => {
    const entries = [
      entry('game_cost', -480_000 * direction),
      entry('game_dividend', 504_000 * direction),
      entry('open_fee', -2_000),
      entry('game_cost_correction', 480_000 * direction),
      entry('dividend_correction', -504_000 * direction),
    ];
    assert.deepEqual(assertReconciles(entries, -2_000), {
      dividends: 0,
      gameCosts: 0,
      fees: -2_000,
    });
  });

  test(`${side} DNP-to-played includes the first cost and dividend as correction entries`, () => {
    const entries = [
      entry('game_cost_correction', -480_000 * direction),
      entry('dividend_correction', 504_000 * direction),
    ];
    assert.deepEqual(assertReconciles(entries, 24_000 * direction), {
      dividends: 504_000 * direction,
      gameCosts: -480_000 * direction,
      fees: 0,
    });
  });

  test(`${side} repeated participation changes leave only the latest game's cost and payout`, () => {
    const entries = [
      entry('game_cost', -480_000 * direction),
      entry('game_dividend', 504_000 * direction),
      entry('game_cost_correction', 480_000 * direction),
      entry('dividend_correction', -504_000 * direction),
      entry('game_cost_correction', -480_000 * direction),
      entry('dividend_correction', 532_000 * direction),
    ];
    assert.deepEqual(assertReconciles(entries, 52_000 * direction), {
      dividends: 532_000 * direction,
      gameCosts: -480_000 * direction,
      fees: 0,
    });
  });

  test(`${side} ordinary stat correction changes the dividend without charging the game cost again`, () => {
    const entries = [
      entry('game_cost', -480_000 * direction),
      entry('game_dividend', 504_000 * direction),
      entry('dividend_correction', 28_000 * direction),
    ];
    assert.deepEqual(assertReconciles(entries, 52_000 * direction), {
      dividends: 532_000 * direction,
      gameCosts: -480_000 * direction,
      fees: 0,
    });
  });
}

test('score components retain every dividend alias and signed fee or refund', () => {
  const entries = [
    entry('game_dividend', 100),
    entry('dividend', 200),
    entry('dividend_correction', -25),
    entry('correction', 30),
    entry('game_cost', -80),
    entry('game_cost_correction', 10),
    entry('open_fee', -3),
    entry('drop_fee', -5),
    entry('fee', -7),
    entry('penalty', -11),
    entry('fee', 2),
  ];
  assert.deepEqual(assertReconciles(entries, 211), {
    dividends: 305,
    gameCosts: -70,
    fees: -24,
  });
});
