import assert from 'node:assert/strict';
import test from 'node:test';

import type { PerGameLedgerEntry, PerGamePosition, PerGameSettledResult } from '../api/contracts';
import {
  currentResults,
  earningsBetween,
  lastYearEdge,
  nightTotals,
  playerValue,
  positionValue,
  recentEarnings,
  scoreBreakdown,
  seasonSummary,
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

test('recent earnings: what your players made last night and over the last seven days, fees apart', () => {
  const entry = (gameDate: string | null, amountDollars: number, createdAt = '2025-11-08T00:00:00Z'): PerGameLedgerEntry => ({
    eventCursor: 1,
    entryId: `${gameDate}-${amountDollars}-${createdAt}`,
    positionId: 'a',
    playerId: 'p1',
    gameId: null,
    gameDate,
    resultRevision: null,
    kind: gameDate ? 'game_dividend' : 'open_fee',
    amountDollars,
    adjustsEntryId: null,
    createdAt,
  });
  const nights = ['2025-10-28', '2025-10-29', '2025-10-31', '2025-11-01', '2025-11-03', '2025-11-04', '2025-11-05', '2025-11-07', '2025-11-08'];
  const ledger = [
    ...nights.map((day, index) => entry(day, (index + 1) * 1_000)),
    entry(null, -250, '2025-11-08T12:00:00.000Z'),
    entry(null, -250, '2025-11-03T12:00:00.000Z'),
  ];
  const recent = recentEarnings(ledger, '2025-11-08');
  // Last night: the Nov 8 games only; the fee booked that day is not a game.
  assert.equal(recent?.night, 9_000);
  // Seven calendar days, Nov 2 .. Nov 8: games on Nov 3, 4, 5, 7 and 8.
  assert.equal(recent?.week, 5_000 + 6_000 + 7_000 + 8_000 + 9_000);
  assert.equal(recent?.weekNights, 5);
  // earningsBetween keeps fees unless told otherwise.
  assert.equal(earningsBetween(ledger, '2025-11-05', '2025-11-08'), 8_000 + 9_000 - 250);
  assert.equal(earningsBetween(ledger, '2025-11-05', '2025-11-08', { gamesOnly: true }), 17_000);
  assert.equal(recentEarnings(ledger, null), null);
});

test('the score breakdown adds up by source, shorts and closed positions included', () => {
  const position = (overrides: Partial<PerGamePosition>): PerGamePosition => ({
    positionId: 'x',
    playerId: 'p',
    playerName: 'P',
    side: 'long',
    status: 'active',
    lockedGameCost: 100_000,
    openedEventSequence: 1,
    closedEventSequence: null,
    expiresOn: null,
    cumulativeGameCost: 0,
    cumulativeDividend: 0,
    cumulativePnl: 0,
    ...overrides,
  });
  const positions = [
    position({ positionId: 'a', cumulativeGameCost: 100_000, cumulativeDividend: 400_000, cumulativePnl: 299_500 }),
    position({ positionId: 'b', cumulativeGameCost: 100_000, cumulativeDividend: 50_000, cumulativePnl: -50_000 }),
    position({ positionId: 'c', side: 'short', cumulativeGameCost: 200_000, cumulativeDividend: 80_000, cumulativePnl: 120_000 }),
    position({ positionId: 'd', status: 'closed', cumulativeGameCost: 100_000, cumulativeDividend: 20_000, cumulativePnl: -80_000 }),
    position({ positionId: 'e', side: 'short', status: 'closed', cumulativeGameCost: 100_000, cumulativeDividend: 60_000, cumulativePnl: 40_000 }),
  ];
  const fee = (amountDollars: number): PerGameLedgerEntry => ({
    eventCursor: 1, entryId: `f${amountDollars}`, positionId: 'a', playerId: 'p', gameId: null,
    gameDate: null, resultRevision: null, kind: 'open_fee', amountDollars, adjustsEntryId: null,
    createdAt: '2025-11-01T12:00:00Z',
  });
  const breakdown = scoreBreakdown(329_500, positions, [fee(-250), fee(-250)]);
  assert.deepEqual(breakdown, {
    roster: 250_000,
    shorts: 120_000,
    closed: -40_000,
    closedCount: 2,
    fees: -500,
    other: 0,
  });
  assert.equal(scoreBreakdown(330_000, positions, [fee(-250), fee(-250)]).other, 500);
});

test('season summary: final score, place by your own score, best and worst player, moves', () => {
  const position = (playerId: string, playerName: string, side: 'long' | 'short', cumulativePnl: number): PerGamePosition => ({
    positionId: `${playerId}-${side}-${cumulativePnl}`, playerId, playerName, side, status: 'closed', lockedGameCost: 100_000,
    openedEventSequence: 1, closedEventSequence: 2, expiresOn: null, cumulativeGameCost: 2_000_000,
    cumulativeDividend: 2_000_000 + (side === 'long' ? cumulativePnl : -cumulativePnl), cumulativePnl,
  });
  const fee = (id: string): PerGameLedgerEntry => ({
    eventCursor: 1, entryId: id, positionId: 'x', playerId: 'p', gameId: null, gameDate: null, resultRevision: null,
    kind: 'open_fee', amountDollars: -250, adjustsEntryId: null, createdAt: '2025-11-01T23:45:00Z',
  });
  const summary = seasonSummary({
    score: 1_062_500,
    completeLeaderboard: true,
    positions: [
      position('p1', 'Nikola Jokic', 'long', 1_600_000),
      position('p1', 'Nikola Jokic', 'long', -100_000),
      position('p2', 'Luka Doncic', 'long', -400_000),
      position('p3', 'Tyrese Maxey', 'short', 50_000),
    ],
    ledger: [fee('a'), fee('b'), fee('c')],
    leaderboard: [
      { rank: 1, cumulativePnl: 2_000_000, isCurrentUser: false },
      { rank: 2, cumulativePnl: 0, isCurrentUser: true },
      { rank: 3, cumulativePnl: -5_000, isCurrentUser: false },
    ],
  });
  assert.equal(summary.rank, 2);
  assert.equal(summary.of, 3);
  assert.deepEqual(summary.best, { name: 'Nikola Jokic', total: 1_500_000 });
  assert.deepEqual(summary.worst, { name: 'Luka Doncic', total: -400_000 });
  assert.equal(summary.moves, 3);
  assert.equal(summary.shortsMade, 1);
});
