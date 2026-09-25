import assert from 'node:assert/strict';
import test from 'node:test';

import type { PerGameLedgerEntry, PerGameSettledResult } from '../api/contracts';
import {
  currentResults,
  lastYearEdge,
  nightTotals,
  playerValue,
  positionValue,
  recentEarnings,
  valueVerdict,
} from './perGameMetrics';

let cursor = 0;
function result(overrides: Partial<PerGameSettledResult>): PerGameSettledResult {
  cursor += 1;
  return {
    eventCursor: cursor,
    positionId: 'pos-1',
    playerId: 'p1',
    gameId: 'g1',
    gameDate: '2025-11-01',
    resultRevision: 1,
    side: 'long',
    kind: 'base',
    status: 'settled',
    lockedGameCost: 100_000,
    dividendDollars: 150_000,
    netPnl: 50_000,
    adjustsResultRevision: null,
    ...overrides,
  };
}

test('a correction replaces the base result instead of adding to it', () => {
  const base = result({ gameId: 'g1', dividendDollars: 150_000, netPnl: 50_000 });
  const corrected = result({
    gameId: 'g1',
    resultRevision: 2,
    kind: 'correction',
    adjustsResultRevision: 1,
    dividendDollars: 90_000,
    netPnl: -10_000,
  });
  const current = currentResults([corrected, base]);
  assert.equal(current.length, 1);
  assert.equal(current[0].netPnl, -10_000);
  assert.equal(positionValue([base, corrected], 'pos-1').total, -10_000);
});

test('averages count settled games only; DNP and unsettled nights are counted apart', () => {
  const rows = [
    result({ gameId: 'g1', gameDate: '2025-11-01', dividendDollars: 150_000, netPnl: 50_000 }),
    result({ gameId: 'g2', gameDate: '2025-11-02', dividendDollars: 70_000, netPnl: -30_000 }),
    result({ gameId: 'g3', gameDate: '2025-11-03', status: 'verified_dnp', dividendDollars: 0, netPnl: 0 }),
    result({ gameId: 'g4', gameDate: '2025-11-04', status: 'unsettled', dividendDollars: null, netPnl: null }),
  ];
  const value = positionValue(rows, 'pos-1');
  assert.equal(value.games, 2);
  assert.equal(value.dnp, 1);
  assert.equal(value.pending, 1);
  assert.equal(value.total, 20_000);
  assert.equal(value.avgNet, 10_000);
  assert.equal(value.avgDividend, 110_000);
  assert.equal(value.avgPrice, 100_000);
  assert.equal(value.wins, 1);
  assert.equal(value.lastNet, -30_000);
  assert.equal(value.lastDate, '2025-11-02');
  assert.equal(valueVerdict(value), 'profit');
});

test('verdicts: untested before a game, even inside $500, loss below', () => {
  assert.equal(valueVerdict(positionValue([], 'pos-1')), 'untested');
  assert.equal(valueVerdict(positionValue([result({ netPnl: 300, dividendDollars: 100_300 })], 'pos-1')), 'even');
  assert.equal(valueVerdict(positionValue([result({ netPnl: -40_000, dividendDollars: 60_000 })], 'pos-1')), 'loss');
});

test('player value spans stints and can be limited to one side', () => {
  const rows = [
    result({ positionId: 'a', gameId: 'g1', side: 'long', netPnl: 20_000, dividendDollars: 120_000 }),
    result({ positionId: 'b', gameId: 'g2', side: 'short', netPnl: 5_000, dividendDollars: 95_000 }),
    result({ positionId: 'c', playerId: 'p2', gameId: 'g3', netPnl: 99_000, dividendDollars: 199_000 }),
  ];
  assert.equal(playerValue(rows, 'p1').games, 2);
  assert.equal(playerValue(rows, 'p1').total, 25_000);
  assert.equal(playerValue(rows, 'p1', 'short').total, 5_000);
});

test('last-year edge flips sign for a short and is null without a prior season', () => {
  const player = { currentGameCost: 100_000, priorSeasonValuePerGame: 120_000 };
  assert.equal(lastYearEdge(player, 'long'), 20_000);
  assert.equal(lastYearEdge(player, 'short'), -20_000);
  assert.equal(lastYearEdge({ currentGameCost: 100_000, priorSeasonValuePerGame: null }, 'long'), null);
});

test('night totals are newest first and use corrected values', () => {
  const rows = [
    result({ positionId: 'a', gameId: 'g1', gameDate: '2025-11-01', netPnl: 10_000, dividendDollars: 110_000 }),
    result({ positionId: 'b', gameId: 'g2', gameDate: '2025-11-01', netPnl: -4_000, dividendDollars: 96_000 }),
    result({ positionId: 'a', gameId: 'g3', gameDate: '2025-11-02', netPnl: 1_000, dividendDollars: 101_000 }),
    result({
      positionId: 'a', gameId: 'g3', gameDate: '2025-11-02', resultRevision: 2, kind: 'correction',
      netPnl: 3_000, dividendDollars: 103_000,
    }),
  ];
  const nights = nightTotals(rows);
  assert.deepEqual(nights.map((night) => night.date), ['2025-11-02', '2025-11-01']);
  assert.equal(nights[0].net, 3_000);
  assert.equal(nights[0].games, 1);
  assert.equal(nights[1].net, 6_000);
  assert.equal(nights[1].wins, 1);
});

test('recent earnings match the ledger, fees included', () => {
  const entry = (gameDate: string | null, amountDollars: number): PerGameLedgerEntry => ({
    eventCursor: 1,
    entryId: `${gameDate}-${amountDollars}`,
    positionId: 'a',
    playerId: 'p1',
    gameId: null,
    gameDate,
    resultRevision: null,
    kind: 'game_dividend',
    amountDollars,
    adjustsEntryId: null,
    createdAt: '2025-11-08T00:00:00Z',
  });
  const ledger = [entry('2025-11-08', 5_000), entry('2025-11-08', -1_000), entry('2025-11-02', 2_000), entry('2025-11-01', 9_000), entry(null, -7_000)];
  assert.deepEqual(recentEarnings(ledger, '2025-11-08'), { night: 4_000, week: 6_000 });
  assert.equal(recentEarnings(ledger, null), null);
});
