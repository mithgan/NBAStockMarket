import assert from 'node:assert/strict';
import test from 'node:test';

import type { PerGameMarketPlayer, PerGameSettledResult } from '../api/contracts';
import {
  accountValueByPlayer,
  actionableFirst,
  actionName,
  filterMarketRows,
  heldDetail,
  netTone,
  rowProfileLabel,
  searchKey,
  slotSummary,
  sortMarketRows,
  valueSignal,
} from './marketView';

function player(overrides: Partial<PerGameMarketPlayer>): PerGameMarketPlayer {
  return {
    playerId: 'p',
    name: 'Test Player',
    tier: 'star',
    quoteVersion: 1,
    currentGameCost: 100_000,
    priorSeasonValuePerGame: 100_000,
    ...overrides,
  };
}

const rows = [
  { player: player({ playerId: 'a', name: 'Nikola Jokic', currentGameCost: 105_000, priorSeasonValuePerGame: 120_000 }) },
  { player: player({ playerId: 'b', name: 'Shai Gilgeous-Alexander', currentGameCost: 119_000, priorSeasonValuePerGame: 93_000 }) },
  { player: player({ playerId: 'c', name: 'Kon Knueppel', currentGameCost: 90_000, priorSeasonValuePerGame: null }) },
  { player: player({ playerId: 'd', name: 'Luka Doncic', currentGameCost: 146_000, priorSeasonValuePerGame: 118_000 }) },
  { player: player({ playerId: 'e', name: 'Victor Wembanyama', currentGameCost: 131_000, priorSeasonValuePerGame: 145_000 }) },
];
const ids = (list: { player: PerGameMarketPlayer }[]) => list.map((row) => row.player.playerId).join('');

test('price sorts cheapest first', () => {
  assert.equal(ids(sortMarketRows(rows, 'price', 'long')), 'cabed');
});

test('value sorts best last-season edge first and puts no last season last', () => {
  // Edges on the roster side: a +15K, b -26K, c none, d -28K, e +14K.
  assert.equal(ids(sortMarketRows(rows, 'value', 'long')), 'aebdc');
  // A short flips every edge; the player with no last season still goes last.
  assert.equal(ids(sortMarketRows(rows, 'value', 'short')), 'dbeac');
});

test('name sorts by surname, the way the rows print it', () => {
  const order = sortMarketRows(rows, 'name', 'long').map((row) => row.player.name);
  assert.deepEqual(order, ['Luka Doncic', 'Shai Gilgeous-Alexander', 'Nikola Jokic', 'Kon Knueppel', 'Victor Wembanyama']);
});

test('players held on the other side follow everyone you can act on, in the same order', () => {
  const list = [
    { id: 'a', blockedByOpposingPosition: true },
    { id: 'b', blockedByOpposingPosition: false },
    { id: 'c', blockedByOpposingPosition: true },
    { id: 'd', blockedByOpposingPosition: false },
  ];
  assert.deepEqual(actionableFirst(list).map((row) => row.id), ['b', 'd', 'a', 'c']);
  assert.deepEqual(actionableFirst([]), []);
});

test('sorting never mutates the input', () => {
  const before = ids(rows);
  sortMarketRows(rows, 'value', 'long');
  assert.equal(ids(rows), before);
});

test('search matches every typed word, ignoring case and accents', () => {
  assert.equal(searchKey('  Dončić '), 'doncic');
  assert.equal(ids(filterMarketRows(rows, { query: 'JOK', watchedOnly: false, watched: [] })), 'a');
  assert.equal(ids(filterMarketRows(rows, { query: 'alexander shai', watchedOnly: false, watched: [] })), 'b');
  assert.equal(ids(filterMarketRows(rows, { query: 'zz', watchedOnly: false, watched: [] })), '');
  assert.equal(ids(filterMarketRows(rows, { query: '   ', watchedOnly: false, watched: [] })), 'abcde');
});

test('the watching filter keeps only watched players and combines with search', () => {
  assert.equal(ids(filterMarketRows(rows, { query: '', watchedOnly: true, watched: ['e', 'a'] })), 'ae');
  assert.equal(ids(filterMarketRows(rows, { query: 'vic', watchedOnly: true, watched: ['e', 'a'] })), 'e');
  assert.equal(ids(filterMarketRows(rows, { query: '', watchedOnly: true, watched: [] })), '');
  assert.equal(ids(filterMarketRows(rows, { query: '', watchedOnly: false, watched: [] })), 'abcde');
});

test('the value signal reads in plain English, flips for a short, and admits a missing season', () => {
  assert.deepEqual(valueSignal(rows[0].player, 'long'), { edge: 15_000, text: '+$15K a game last year', tone: 'gain' });
  assert.deepEqual(valueSignal(rows[0].player, 'short'), { edge: -15_000, text: '-$15K a game last year', tone: 'loss' });
  assert.deepEqual(valueSignal(rows[2].player, 'long'), { edge: null, text: 'No last season', tone: 'none' });
  const even = valueSignal(player({ currentGameCost: 100_000, priorSeasonValuePerGame: 100_300 }), 'long');
  assert.equal(even.tone, 'even');
  assert.equal(even.text, 'Even with last year');
  for (const side of ['long', 'short'] as const) {
    for (const row of rows) assert.doesNotMatch(valueSignal(row.player, side).text, /\/GM|inverse|%/i);
  }
});

test('slot use and action names use the shared vocabulary', () => {
  assert.equal(slotSummary('long', { used: 8, limit: 10 }), '8 of 10 on your roster');
  assert.equal(slotSummary('short', { used: 1, limit: 5 }), '1 of 5 shorts');
  assert.equal(actionName('open', 'long', 'LeBron James', 105_000), 'Add LeBron James at $105K a game');
  assert.equal(actionName('open', 'short', 'LeBron James', 105_000), 'Short LeBron James at $105K a game');
  assert.match(actionName('close', 'long', 'LeBron James', 105_000), /^Drop LeBron James/);
  assert.match(actionName('close', 'short', 'LeBron James', 105_000), /^Close /);
});

let cursor = 0;
function result(overrides: Partial<PerGameSettledResult>): PerGameSettledResult {
  cursor += 1;
  return {
    eventCursor: cursor,
    positionId: 'pos-1',
    playerId: 'a',
    gameId: `g${cursor}`,
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

test('account value per player counts one side, and a correction once', () => {
  const base = result({ gameId: 'g-x', netPnl: 50_000 });
  const corrected = result({ gameId: 'g-x', resultRevision: 2, kind: 'correction', netPnl: -10_000, dividendDollars: 90_000 });
  const other = result({ gameId: 'g-y', netPnl: 30_000 });
  const shortGame = result({ gameId: 'g-z', side: 'short', positionId: 'pos-2', netPnl: 20_000 });
  const long = accountValueByPlayer([base, corrected, other, shortGame], 'long').get('a');
  assert.equal(long?.games, 2);
  assert.equal(long?.total, 20_000);
  assert.equal(accountValueByPlayer([base, corrected, other, shortGame], 'short').get('a')?.total, 20_000);
  assert.equal(accountValueByPlayer([], 'long').size, 0);
});

test('a held row shows his net a game so far, or the locked price before any game', () => {
  const summary = accountValueByPlayer([result({ netPnl: 32_000 }), result({ netPnl: 32_000 })], 'long').get('a');
  assert.deepEqual(heldDetail(summary, 100_000), { text: '+$32K a game so far', tone: 'gain' });
  assert.deepEqual(heldDetail(undefined, 100_000), { text: 'locked at $100K', tone: 'none' });
});

test('a per-game net is green above the even band, red below it, muted inside it', () => {
  assert.equal(netTone(32_000), 'gain');
  assert.equal(netTone(-8_000), 'loss');
  assert.equal(netTone(499), 'even');
  assert.equal(netTone(-499), 'even');
  assert.equal(netTone(null), 'none');
});

test('every row label ends in "View profile"', () => {
  const plain = rowProfileLabel({ name: 'LeBron James', tier: 'Star', price: 105_000, detail: '+$15K a game last year' });
  assert.equal(plain, 'LeBron James, star, $105K a game, +$15K a game last year, View profile');
  const blocked = rowProfileLabel({
    name: 'LeBron James',
    tier: 'star',
    price: 105_000,
    detail: 'On your roster',
    reason: "He's on your roster. Drop him to short him.",
  });
  assert.match(blocked, /View profile$/);
  assert.match(blocked, /Drop him to short him\./);
});
