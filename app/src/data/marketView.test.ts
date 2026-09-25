import assert from 'node:assert/strict';
import test from 'node:test';

import type { PerGameMarketPlayer, PerGameSettledResult } from '../api/contracts';
import { CONFIRM_LABEL, confirmCloseName, rosterReopensLine } from '../copy/terms';
import { positionValue } from './perGameMetrics';
import {
  accountValueByPlayer,
  actionableFirst,
  actionName,
  actionWord,
  collapseControls,
  confirmAnnouncement,
  CONFIRM_WINDOW_MS,
  filterMarketRows,
  headerStatus,
  heldDetail,
  isSeasonOver,
  keepNamesWhole,
  KICKER_TIER_MIN_WIDTH,
  marketColumns,
  marketLayout,
  netTone,
  rowActions,
  rowKicker,
  rowProfileLabel,
  searchKey,
  slotSummary,
  sortMarketRows,
  valueByPosition,
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

test('the value line states last season, then compares it with his price (grader M5)', () => {
  assert.deepEqual(valueSignal(rows[0].player, 'long'), {
    edge: 15_000,
    lead: 'Last year $120K a game ·',
    text: '+$15K vs his price',
    tone: 'gain',
  });
  // The Short tab says what a short would have made: the same fact, flipped.
  assert.deepEqual(valueSignal(rows[0].player, 'short'), {
    edge: -15_000,
    lead: 'Last year $120K a game ·',
    text: '-$15K for a short',
    tone: 'loss',
  });
  assert.deepEqual(valueSignal(rows[2].player, 'long'), { edge: null, lead: null, text: 'No last season', tone: 'none' });
  const even = valueSignal(player({ currentGameCost: 100_000, priorSeasonValuePerGame: 100_300 }), 'long');
  assert.equal(even.tone, 'even');
  assert.equal(even.text, 'even with his price');
  for (const side of ['long', 'short'] as const) {
    for (const row of rows) {
      const signal = valueSignal(row.player, side);
      assert.doesNotMatch(`${signal.lead ?? ''} ${signal.text}`, /\/GM|inverse|%|so far/i);
    }
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

test('a held row reads the current position only, like its Roster row (grader B1)', () => {
  // Two weeks on the roster, dropped, added again, one bad night since.
  const firstStint = Array.from({ length: 11 }, (_, index) => result({
    positionId: 'mock-position-1',
    gameId: `old-${index}`,
    netPnl: 148_364,
  }));
  const current = [result({ positionId: 'mock-position-12', gameId: 'new-1', netPnl: -368_339, dividendDollars: -265_000 })];
  const all = [...firstStint, ...current];
  // The all-stints value (what round 1 showed) is +$105K a game; the Roster row is -$368K.
  assert.equal(heldDetail(accountValueByPlayer(all, 'long').get('a'), 103_000).text, '+$105.3K a game over 12 games');
  const detail = heldDetail(positionValue(all, 'mock-position-12'), 103_000);
  // The Roster's precision (grader S-2): -$368.3K, not -$368K.
  assert.deepEqual(detail, { text: '-$368.3K a game over 1 game', tone: 'loss' });
  // Right after a re-add, before the new stint plays: the locked price, not the old stint.
  assert.deepEqual(heldDetail(positionValue(all, 'mock-position-13'), 104_250), { text: 'locked at $104.3K', tone: 'none' });
  assert.doesNotMatch(detail.text, /so far/);
});

test('value by position is positionValue for every position, in one pass', () => {
  const list = [
    result({ positionId: 'x', gameId: 'x1', netPnl: 10_000 }),
    result({ positionId: 'x', gameId: 'x1', resultRevision: 2, kind: 'correction', netPnl: -5_000 }),
    result({ positionId: 'y', gameId: 'y1', netPnl: 40_000 }),
    result({ positionId: 'y', gameId: 'y2', status: 'verified_dnp', netPnl: 0, dividendDollars: 0 }),
  ];
  const map = valueByPosition(list);
  for (const id of ['x', 'y']) assert.deepEqual(map.get(id), positionValue(list, id));
  assert.equal(map.get('x')?.total, -5_000);
  assert.equal(map.get('y')?.dnp, 1);
  assert.equal(map.get('z'), undefined);
});

test('the button says why it is dimmed, asks before a drop, and waits while pending', () => {
  const base = { side: 'long' as const, held: false, pending: false, confirming: false, rosterLocked: false, full: false };
  assert.equal(actionWord(base), 'Add');
  assert.equal(actionWord({ ...base, side: 'short' }), 'Short');
  assert.equal(actionWord({ ...base, full: true }), 'Full');
  assert.equal(actionWord({ ...base, rosterLocked: true, full: true }), 'Locked');
  assert.equal(actionWord({ ...base, pending: true }), 'Wait');
  assert.equal(actionWord({ ...base, held: true }), 'Drop');
  assert.equal(actionWord({ ...base, held: true, full: true }), 'Drop', 'a full roster never blocks a drop');
  // One confirm design with the Roster and Restart (grader N-S1): the shared "Confirm".
  assert.equal(actionWord({ ...base, held: true, confirming: true }), CONFIRM_LABEL);
  assert.equal(actionWord({ ...base, side: 'short', held: true, confirming: true }), 'Confirm');
  assert.equal(actionWord({ ...base, held: true, confirming: true, rosterLocked: true }), 'Locked');
  assert.equal(
    confirmAnnouncement('long', 'LeBron James', 250, 764_000),
    'Tap Confirm to drop LeBron James. $250 fee · his +$764K stays in your score.',
  );
  assert.equal(
    confirmAnnouncement('short', 'LeBron James', 0, -12_500),
    "Tap Confirm to close your short on LeBron James. This short's -$12.5K stays in your score.",
  );
  assert.equal(
    confirmAnnouncement('long', 'LeBron James', 0, 764_000),
    'Tap Confirm to drop LeBron James. His +$764K stays in your score.',
  );
  assert.equal(confirmCloseName('long', 'LeBron James'), 'Confirm dropping LeBron James');
  assert.equal(CONFIRM_WINDOW_MS, 4000);
});

test('the season is over on practice day 174, or live with no next game; not before the first game', () => {
  assert.equal(isSeasonOver({ practiceComplete: true, lastSettledDate: '2026-04-12', nextGameDate: '2026-04-13' }), true);
  assert.equal(isSeasonOver({ practiceComplete: false, lastSettledDate: '2026-04-12', nextGameDate: null }), true);
  assert.equal(isSeasonOver({ practiceComplete: false, lastSettledDate: '2025-11-05', nextGameDate: '2025-11-06' }), false);
  assert.equal(isSeasonOver({ practiceComplete: false, lastSettledDate: null, nextGameDate: null }), false);
});

test('the header adds one status line: season over, then the lock, then full (grader N-S4, N-S5)', () => {
  const base = { side: 'long' as const, seasonOver: false, rosterLocked: false, lockGameDate: null, full: false };
  assert.deepEqual(headerStatus(base), { text: null, kind: null });
  assert.deepEqual(headerStatus({ ...base, full: true }), { text: 'Full: drop one to add', kind: 'full' });
  assert.deepEqual(headerStatus({ ...base, side: 'short', full: true }), { text: 'Full: close one to short', kind: 'full' });
  // Locked and full: no advice to drop while drops are locked; the one lock sentence.
  assert.deepEqual(
    headerStatus({ ...base, full: true, rosterLocked: true, lockGameDate: '2025-10-31' }),
    { text: rosterReopensLine('2025-10-31'), kind: 'lock' },
  );
  assert.equal(headerStatus({ ...base, rosterLocked: true, lockGameDate: '2025-10-31' }).text, 'Roster reopens after Oct 31');
  assert.deepEqual(headerStatus({ ...base, seasonOver: true, rosterLocked: true, full: true }), { text: 'The season is over', kind: 'season' });
});

test('at season end the rows carry no buttons: one header line instead of 30 dead ones (product round-3 #5)', () => {
  assert.equal(rowActions(false), true);
  assert.equal(rowActions(true), false);
  const status = headerStatus({ side: 'short', seasonOver: true, rosterLocked: false, lockGameDate: null, full: false });
  assert.deepEqual(status, { text: 'The season is over', kind: 'season' });
});

test('below 380px the kicker drops the tier so the given name and price share a line (product round-3 #3)', () => {
  assert.equal(KICKER_TIER_MIN_WIDTH, 380);
  assert.equal(rowKicker('Karl-Anthony', 'star', 360), 'Karl-Anthony');
  assert.equal(rowKicker('Karl-Anthony', 'star', 379), 'Karl-Anthony');
  assert.equal(rowKicker('Karl-Anthony', 'star', 380), 'Karl-Anthony · star');
  assert.equal(rowKicker('Nikola', 'star', 1440), 'Nikola · star');
  assert.equal(rowKicker('Nikola', 'star', 195), 'Nikola');
  assert.equal(rowKicker('Nene', '', 390), 'Nene', 'no tier, no separator');
});

test('search, sort and Watching fold behind one toggle below 300px', () => {
  assert.equal(collapseControls(195), true);
  assert.equal(collapseControls(299), true);
  assert.equal(collapseControls(300), false);
  assert.equal(collapseControls(390), false);
});

test('layout: a table from 768px, the phone row below, one column under 300px or with big text', () => {
  assert.equal(marketLayout(1440, 1), 'table');
  assert.equal(marketLayout(820, 1), 'table');
  assert.equal(marketLayout(768, 1), 'table');
  assert.equal(marketLayout(767, 1), 'phone');
  assert.equal(marketLayout(360, 1), 'phone');
  assert.equal(marketLayout(299, 1), 'large');
  assert.equal(marketLayout(390, 2), 'large');
  assert.equal(marketLayout(1440, 2), 'large');
  assert.equal(keepNamesWhole(360), true);
  assert.equal(keepNamesWhole(319), false);
  const wide = marketColumns(1200);
  const tablet = marketColumns(820);
  assert.ok(wide.yours > 0);
  assert.equal(tablet.yours, 0);
  // At 768 the player column keeps room for "Gilgeous-Alexander" (about 150px).
  const used = 32 + tablet.avatar + tablet.price + tablet.lastSeason + tablet.edge + tablet.action + tablet.gap * 5;
  assert.ok(768 - used >= 180, `player column ${768 - used}px`);
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
