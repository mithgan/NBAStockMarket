import assert from 'node:assert/strict';
import test from 'node:test';

import type { PerGameMarketPlayer, PerGameSettledResult } from '../api/contracts';
import { rosterReopensLine } from '../copy/terms';
import { positionValue } from './perGameMetrics';
import {
  accountValueByPlayer,
  actionableFirst,
  actionName,
  actionWord,
  collapseControls,
  echoQuery,
  feeHint,
  fullActionName,
  fullNote,
  filterMarketRows,
  headerStatus,
  heldDetail,
  isSeasonOver,
  justClosedName,
  justOpenedName,
  keepNamesWhole,
  keptAnnouncement,
  KICKER_TIER_MIN_WIDTH,
  listCountLine,
  marketColumns,
  marketLayout,
  marketSortOptions,
  netTone,
  rowActions,
  rowKicker,
  rowProfileLabel,
  rosterPickReason,
  searchKey,
  shownAmount,
  slotSummary,
  sortAscending,
  sortDirection,
  sortMarketRows,
  sortedLine,
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
    lead: 'Dividend last season $120K a game ·',
    text: '$15K over his price',
    tone: 'gain',
  });
  // The Short tab says what a short would have made: the same fact, flipped.
  assert.deepEqual(valueSignal(rows[0].player, 'short'), {
    edge: -15_000,
    lead: 'Dividend last season $120K a game ·',
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

test('the button says why it is dimmed, and waits while pending', () => {
  const base = { side: 'long' as const, held: false, pending: false, rosterLocked: false, full: false };
  assert.equal(actionWord(base), 'Add');
  assert.equal(actionWord({ ...base, side: 'short' }), 'Short');
  assert.equal(actionWord({ ...base, full: true }), 'Full');
  assert.equal(actionWord({ ...base, rosterLocked: true, full: true }), 'Locked');
  assert.equal(actionWord({ ...base, pending: true }), 'Wait');
  assert.equal(actionWord({ ...base, held: true }), 'Drop');
  assert.equal(actionWord({ ...base, held: true, full: true }), 'Drop', 'a full roster never blocks a drop');
  assert.equal(actionWord({ ...base, side: 'short', held: true }), 'Close');
});

test('right after Add or Short the spot says so and never reads Drop or Close (T4-01, T4-02)', () => {
  const base = { side: 'long' as const, held: true, pending: false, rosterLocked: false, full: false };
  assert.equal(actionWord({ ...base, justOpened: true }), 'Added ✓');
  assert.equal(actionWord({ ...base, side: 'short', justOpened: true }), 'Shorted ✓');
  assert.equal(actionWord({ ...base, held: false, justClosed: true }), 'Dropped ✓');
  assert.equal(actionWord({ ...base, side: 'short', held: false, justClosed: true }), 'Closed ✓');
  // A failed add leaves him unheld: the button offers Add again, not a check mark.
  assert.equal(actionWord({ ...base, held: false, justOpened: true }), 'Add');
  // The QA harness and screen readers find offers by their first word; these never match.
  for (const name of [justOpenedName('long', 'Nikola Jokic'), justOpenedName('short', 'Luka Doncic')]) {
    assert.doesNotMatch(name, /^(add|short)\b/i);
  }
  assert.equal(justOpenedName('long', 'Nikola Jokic'), 'Added Nikola Jokic to your roster');
  assert.equal(justClosedName('short', 'Luka Doncic'), 'Closed your short on Luka Doncic');
});

test('backing out of a Drop or Close is announced by name (T2-01, T1-16)', () => {
  assert.equal(keptAnnouncement('long', 'LeBron James'), 'Kept LeBron James on your roster.');
  assert.equal(keptAnnouncement('short', 'LeBron James'), 'Kept your short on LeBron James.');
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
  // Sideways phone: phone rows; short laptop window: still the table.
  assert.equal(marketLayout(844, 1, 390), 'phone');
  assert.equal(marketLayout(1280, 1, 480), 'table');
  // A phone turned sideways gets the phone rows, which label their own figures (T1-19, T4-11).
  assert.equal(marketLayout(844, 1, 390), 'phone');
  assert.equal(marketLayout(932, 1, 430), 'phone');
  assert.equal(marketLayout(1024, 1, 768), 'table');
  assert.equal(marketLayout(1280, 1, 500), 'table');
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

test('search ignores curly apostrophes, quotes and dots (T4-18)', () => {
  const fox = [{ player: player({ playerId: 'f', name: "De'Aaron Fox" }) }, ...rows];
  for (const query of ['De’Aaron', "De'Aaron", 'DeAaron', 'de aaron', 'deaaron fox', '“fox”', 'dé’aaron']) {
    assert.equal(ids(filterMarketRows(fox, { query, watchedOnly: false, watched: [] })), 'f', query);
  }
  assert.equal(ids(filterMarketRows(rows, { query: 'Gilgeous Alexander', watchedOnly: false, watched: [] })), 'b');
  assert.equal(ids(filterMarketRows(rows, { query: 'gilgeous-alexander', watchedOnly: false, watched: [] })), 'b');
  // A name copied from a row (non-breaking hyphen) or typed with any Unicode dash (T4-14).
  for (const dash of ['\u2010', '\u2011', '\u2012', '\u2013', '\u2014', '\u2015']) {
    assert.equal(ids(filterMarketRows(rows, { query: `Gilgeous${dash}Alexander`, watchedOnly: false, watched: [] })), 'b', `U+${dash.charCodeAt(0).toString(16)}`);
  }
});

test('the empty state echoes a long search short and breakable (T4-19)', () => {
  assert.equal(echoQuery('  lebron  '), 'lebron');
  const long = echoQuery('x'.repeat(500));
  assert.ok(long.endsWith('…'));
  assert.equal(long.replace(/\u200B/g, '').length, 25);
  assert.ok(long.split('\u200B').every((part) => part.length <= 10));
});

test('FULL explains itself and says the fee where the side is chosen (T1-43, T1-03)', () => {
  assert.deepEqual(fullNote('long', 'Tyrese Maxey', 10), {
    message: 'Your roster is full (10 of 10). Drop a player to add Tyrese Maxey.',
    action: 'Choose who to drop',
  });
  assert.equal(fullNote('short', 'Luka Doncic', 2).message, 'All 2 short slots are in use. Close a short to short Luka Doncic.');
  // The QA harness finds offers by their first word; the note's button is not one.
  assert.doesNotMatch(fullNote('short', 'x', 2).action, /^(add|short)\b/i);
  assert.equal(feeHint('long', 250), '$250 to add or drop');
  assert.equal(feeHint('short', 250), '$250 to short or close');
  assert.equal(feeHint('long', 0), '');
});

test('spoken counts say what the filter did, and that a cleared search is back (T2-07, T3-13)', () => {
  const base = { query: '', count: 30, total: 30, watchedOnly: false };
  assert.equal(listCountLine(base), 'Showing all 30 players.');
  assert.equal(listCountLine({ ...base, count: 0, watchedOnly: true }), 'Watching: 0 players. Show everyone to see all 30.');
  assert.equal(listCountLine({ ...base, count: 1, watchedOnly: true }), 'Watching: 1 player. Show everyone to see all 30.');
  assert.equal(listCountLine({ ...base, cleared: true }), 'Search cleared, 30 players.');
  assert.equal(listCountLine({ ...base, query: 'zz', count: 0 }), 'No players match "zz".');
  assert.equal(listCountLine({ ...base, query: 'le', count: 7 }), '7 players match "le".');
});

test('FULL is named for why it cannot add him, never as an offer (T1-24, T4-06, T3-19)', () => {
  assert.equal(fullActionName('long', 'Tyrese Maxey'), 'Roster full: drop a player to add Tyrese Maxey');
  assert.equal(fullActionName('short', 'Luka Doncic'), 'Shorts full: close a short to short Luka Doncic');
  for (const side of ['long', 'short'] as const) {
    // The visible word is in the name (voice control); the harness's offer test misses it.
    assert.match(fullActionName(side, 'x'), /full/i);
    assert.doesNotMatch(fullActionName(side, 'x'), /^(add|short)\b/i);
  }
  assert.equal(rosterPickReason('Tyrese Maxey'), 'Pick a player to drop to make room for Tyrese Maxey.');
});

test('the edge is the difference of the figures shown, so the row adds up (T2-05, T1-07)', () => {
  // $200,550 prints $200.6K and $220,440 prints $220.4K: the edge reads $19.8K, not $19.9K.
  const bam = player({ currentGameCost: 200_550, priorSeasonValuePerGame: 220_440 });
  assert.equal(valueSignal(bam, 'long').text, '$19.8K over his price');
  assert.equal(valueSignal(bam, 'short').text, '-$19.8K for a short');
  assert.equal(valueSignal(player({ currentGameCost: 120_000, priorSeasonValuePerGame: 100_000 }), 'long').text, '$20K under his price');
  assert.equal(shownAmount(1_234_567), 1_230_000);
  assert.equal(shownAmount(9_999.4), 9_999);
});

test('choosing a sort again flips it; no last season still goes last (T2-N03)', () => {
  assert.equal(ids(sortMarketRows(rows, 'price', 'long', true)), 'debac');
  assert.equal(ids(sortMarketRows(rows, 'value', 'long', true)), 'dbeac');
  assert.equal(ids(sortMarketRows(rows, 'name', 'long', true)), 'ecabd');
  assert.deepEqual(marketSortOptions('price', false).map((o) => o.label), ['Price ↑', 'Value', 'Name']);
  assert.deepEqual(marketSortOptions('value', false).map((o) => o.label), ['Price', 'Value ↓', 'Name']);
  assert.equal(marketSortOptions('name', true)[2].label, 'Name ↓');
  // Plain direction words (T3-18): "highest first", not "dearest first".
  assert.equal(sortedLine('price', true), 'Sorted by price, highest first.');
  assert.equal(sortedLine('price'), 'Sorted by price, lowest first.');
  assert.equal(sortedLine('value'), 'Sorted by value, highest first.');
  assert.equal(sortedLine('value', true), 'Sorted by value, lowest first.');
  assert.equal(sortedLine('name', true), 'Sorted by name, Z to A.');
  assert.equal(sortDirection('value'), 'highest first');
  // aria-sort follows the arrow: Price and Name start ascending, Value descending.
  assert.equal(sortAscending('price'), true);
  assert.equal(sortAscending('value'), false);
  assert.equal(sortAscending('value', true), true);
  assert.equal(sortAscending('name', true), false);
});
