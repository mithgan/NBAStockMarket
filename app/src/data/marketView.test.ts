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
  foldedSlotBeside,
  fullTierFits,
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
  heldValuePhrase,
  nameInitials,
  netTone,
  nextSortState,
  orderButtonName,
  orderButtonTitle,
  SEARCH_NEEDS_LETTERS,
  searchHasLetters,
  slotLineBeside,
  spokenTier,
  rowActions,
  rowKicker,
  tierLabel,
  rowProfileLabel,
  rosterPickReason,
  sameFlat,
  sameMarketRow,
  sameMarketRowProps,
  searchKey,
  shownAmount,
  slotSummary,
  slotLine,
  feeLine,
  sortAscending,
  sortDirection,
  sortMarketRows,
  sortedLine,
  valueByPosition,
  valueSignal,
  heldValueLine,
  nicknameFor,
  PLAYER_NICKNAMES,
  heldOrderLine,
  listHeading,
  searchFooterLine,
  stillFilteredLine,
  surnameFontSize,
  valueLineParts,
  lastSlotTakenBy,
  savingMoves,
  spokenForNote,
  resortName,
  resortedLine,
  rowTier,
  rowValueEdge,
  sameOrder,
  shortTermLine,
  shortTierLabel,
  unheldValueLines,
  watchingLine,
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
  // One game reads "in 1 game" (walk 5 T1-05).
  assert.deepEqual(detail, { text: '-$368.3K in 1 game', tone: 'loss' });
  // Right after a re-add, before the new stint plays: the locked price, not the old stint.
  // Right after a re-add the price box shows "yours $104.3K"; the line says no games yet.
  assert.deepEqual(heldDetail(positionValue(all, 'mock-position-13'), 104_250), { text: 'no games yet', tone: 'none' });
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
  // The press paints its result while the move is still on its way (walk 5 T2-18).
  assert.equal(actionWord({ ...base, held: true, justOpened: true, pending: true }), 'Added ✓');
  assert.equal(actionWord({ ...base, held: false, justClosed: true, pending: true }), 'Dropped ✓');
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
  assert.equal(headerStatus({ ...base, rosterLocked: true, lockGameDate: '2025-10-31' }).text, 'Moves reopen after Oct 31');
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
  // The space before the dot does not break: no line starts with "·" (T2-12).
  assert.equal(rowKicker('Karl-Anthony', 'star', 380), 'Karl-Anthony\u00A0· Star');
  assert.equal(rowKicker('Nikola', 'star', 1440), 'Nikola\u00A0· Star');
  // The tier in words, never a bare "ROLE" beside a name (walk 4 T1-21).
  assert.equal(rowKicker('Kon', 'role', 390), 'Kon\u00A0· Role\u00A0player');
  // A long given name with a long tier would push the price down at 390.
  assert.equal(rowKicker('Donovan', 'role', 390), 'Donovan');
  assert.equal(rowKicker('Donovan', 'role', 412), 'Donovan\u00A0· Role\u00A0player');
  assert.equal(tierLabel('role'), 'Role\u00A0player');
  assert.equal(tierLabel('starter'), 'Starter');
  assert.equal(tierLabel(null), '');
  assert.equal(rowKicker('Nikola', 'star', 195), 'Nikola');
  assert.equal(rowKicker('Nene', '', 390), 'Nene', 'no tier, no separator');
});

test('search, sort and Watching fold behind one toggle below 300px', () => {
  assert.equal(collapseControls(195), true);
  assert.equal(collapseControls(299), true);
  assert.equal(collapseControls(300), false);
  assert.equal(collapseControls(390), false);
  // Short windows fold too (T4-16), except the table, whose toolbar is one row.
  assert.equal(collapseControls(600, 400), true);
  assert.equal(collapseControls(844, 390), true);
  assert.equal(collapseControls(600, 450), true);
  assert.equal(collapseControls(600, 500), false);
  // Any width: a short laptop window folds too (walk 4 T2-18, 1280x440 and 1280x480).
  assert.equal(collapseControls(1280, 440, true), true);
  assert.equal(collapseControls(1280, 480, true), true);
  assert.equal(collapseControls(1280, 800, true), false);
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
  // Walk 8 T2-07: names the button under the list, "Show all 30".
  assert.equal(listCountLine({ ...base, count: 1, watchedOnly: true }), 'Watching: 1 player. Show all 30 to see everyone.');
  assert.equal(listCountLine({ ...base, cleared: true }), 'Search cleared. Showing all 30 players.');
  assert.equal(listCountLine({ ...base, query: 'zz', count: 0 }), 'No players match "zz".');
  assert.equal(listCountLine({ ...base, query: 'le', count: 7 }), '7 players match "le".');
});

test('FULL is named for why it cannot add him, never as an offer (T1-24, T4-06, T3-19)', () => {
  // Walk 8 T1-11: the name starts with the button's words, "Full, make room".
  assert.equal(fullActionName('long', 'Tyrese Maxey'), 'Full, make room: drop a player to add Tyrese Maxey');
  assert.equal(fullActionName('short', 'Luka Doncic'), 'Full, make room: close a short to short Luka Doncic');
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

test('choosing a sort never flips it; only the order button does (T1-08, T2-05, T3-02)', () => {
  const start = { sort: 'price' as const, reversed: false };
  // A new sort starts in its natural order; choosing the one in use changes nothing.
  assert.deepEqual(nextSortState(start, { choose: 'value' }), { sort: 'value', reversed: false });
  assert.deepEqual(nextSortState({ sort: 'value', reversed: false }, { choose: 'value' }), { sort: 'value', reversed: false });
  assert.deepEqual(nextSortState({ sort: 'value', reversed: true }, { choose: 'value' }), { sort: 'value', reversed: true });
  assert.deepEqual(nextSortState({ sort: 'value', reversed: true }, { choose: 'name' }), { sort: 'name', reversed: false });
  assert.deepEqual(nextSortState({ sort: 'value', reversed: false }, 'flip'), { sort: 'value', reversed: true });
  // Natural orders: Value and Dividend highest first, Price lowest first, Name A to Z.
  assert.equal(orderButtonName('value', false), 'Order: highest first');
  assert.equal(orderButtonName('dividend', false), 'Order: highest first');
  assert.equal(orderButtonName('price', false), 'Order: lowest first');
  assert.equal(orderButtonName('name', false), 'Order: A to Z');
  assert.equal(orderButtonTitle('value', false), 'Order: highest first. Flip to lowest first.');
  // Labels carry no arrow; Dividend joins where the table shows its column, or while in use.
  assert.deepEqual(marketSortOptions('price').map((o) => o.label), ['Price', 'Value', 'Name']);
  assert.deepEqual(marketSortOptions('value', true).map((o) => o.label), ['Price', 'Dividend', 'Value', 'Name']);
  assert.deepEqual(marketSortOptions('dividend').map((o) => o.name), ['Price', 'Dividend last season', 'Value', 'Name']);
  // Dividend last season sorts highest first; no last season still goes last either way.
  assert.equal(ids(sortMarketRows(rows, 'dividend', 'long')), 'eadbc');
  assert.equal(ids(sortMarketRows(rows, 'dividend', 'long', true)), 'bdaec');
  assert.equal(sortedLine('dividend'), 'Sorted by dividend last season, highest first.');
  assert.equal(sortAscending('dividend'), false);
});

test('the slot line sits beside the side toggle from 340px, under it below (T1-09)', () => {
  assert.equal(slotLineBeside(360), true);
  assert.equal(slotLineBeside(340), true);
  assert.equal(slotLineBeside(320), false);
});

test('search: no letters asks for a name; spaces and hyphens are ignored; initials find players (T4-05, T4-12)', () => {
  const list = [
    { player: player({ playerId: 'k', name: 'Karl-Anthony Towns' }) },
    { player: player({ playerId: 's', name: 'Shai Gilgeous-Alexander' }) },
    { player: player({ playerId: 'a', name: 'Anthony Davis' }) },
    { player: player({ playerId: 'b', name: 'Bam Adebayo' }) },
    { player: player({ playerId: 'j', name: 'Jaren Jackson Jr.' }) },
    { player: player({ playerId: 'l', name: 'Luka Doncic' }) },
  ];
  const find = (query: string) => ids(filterMarketRows(list, { query, watchedOnly: false, watched: [] }));
  for (const query of ['🏀', "'", '-', ' - ', '…']) {
    assert.equal(searchHasLetters(query), false, query);
    assert.equal(find(query), '', query);
  }
  assert.equal(listCountLine({ query: '🏀', count: 0, total: 30, watchedOnly: false }), `${SEARCH_NEEDS_LETTERS}.`);
  assert.equal(find(''), 'ksabjl');
  assert.equal(find('karlanthony'), 'k');
  assert.equal(find('gilgeousalexander'), 's');
  assert.equal(find('Karl-Anthony'), 'k');
  assert.equal(find('karl anthony'), 'k');
  assert.equal(find('sga'), 's');
  assert.equal(find('KAT'), 'k');
  // Initials alongside normal matches: "ad" is Anthony Davis and every name with "ad" in
  // it, never a match across two names ("Luk|a D|oncic").
  assert.equal(find('ad'), 'ab');
  assert.equal(find('doncic luka'), 'l');
  assert.equal(find('jjj'), 'j');
  assert.equal(find('jj'), 'j');
  assert.deepEqual(nameInitials('Shai Gilgeous-Alexander'), ['sga']);
  assert.deepEqual(nameInitials('Jaren Jackson Jr.'), ['jjj', 'jj']);
  // One letter is not initials.
  assert.equal(find('k'), 'kjl');
});

test('spoken rows say the tier as words, and held rows keep their value phrase (T3-30)', () => {
  assert.equal(spokenTier('role'), 'role player');
  assert.equal(spokenTier('Starter'), 'starter');
  assert.equal(spokenTier('star'), 'star');
  assert.match(rowProfileLabel({ name: 'Kon Knueppel', tier: 'role', price: 111_500, detail: 'No last season' }), /^Kon Knueppel, role player, /);
  const gillespie = { currentGameCost: 126_500, priorSeasonValuePerGame: 120_000 };
  // Held at the price you locked (walk 5 T4-02): today's price is said after it.
  assert.equal(heldValuePhrase(gillespie, 'long', 126_500), 'value -$6.5K a game at your price, last season $120K a game, now $126.5K a game');
  assert.equal(heldValuePhrase(gillespie, 'short', 126_500), 'value +$6.5K a game at your price, last season $120K a game, now $126.5K a game');
  assert.equal(heldValuePhrase({ currentGameCost: 90_000, priorSeasonValuePerGame: null }, 'long', 89_000), 'no last season, now $90K a game');
});

test('a reversed sort runs the other way, words included; no last season still goes last (T2-N03)', () => {
  assert.equal(ids(sortMarketRows(rows, 'price', 'long', true)), 'debac');
  assert.equal(ids(sortMarketRows(rows, 'value', 'long', true)), 'dbeac');
  assert.equal(ids(sortMarketRows(rows, 'name', 'long', true)), 'ecabd');
  // Plain direction words (T3-18): "highest first", not "dearest first".
  assert.equal(sortedLine('price', true), 'Sorted by price, highest first.');
  assert.equal(sortedLine('price'), 'Sorted by price, lowest first.');
  assert.equal(sortedLine('value'), 'Sorted by value, highest first.');
  assert.equal(sortedLine('value', true), 'Sorted by value, lowest first.');
  assert.equal(sortedLine('name', true), 'Sorted by name, Z to A.');
  assert.equal(sortDirection('value'), 'highest first');
  // The arrow (and the header's spoken order) follows this: Price and Name start ascending, Value descending.
  assert.equal(sortAscending('price'), true);
  assert.equal(sortAscending('value'), false);
  assert.equal(sortAscending('value', true), true);
  assert.equal(sortAscending('name', true), false);
});

test('a market row redraws only when what it shows changes (walk 4 T4-11)', () => {
  const base = {
    player: player({ playerId: 'a', name: 'Kon Knueppel', currentGameCost: 111_500, quoteVersion: 3 }),
    side: 'long',
    position: null,
    isFull: false,
    blockedByOpposingPosition: false,
    canSubmit: true,
    unavailableReason: null,
  };
  const onPress = () => undefined;
  const props = { row: base, width: 390, pending: false, locked: false, onToggleWatch: onPress, currentValue: undefined, columns: { avatar: 34, gap: 8 } };
  // A new snapshot rebuilds every row object with the same values: no redraw.
  const rebuilt = { ...props, row: { ...base, player: { ...base.player } }, columns: { avatar: 34, gap: 8 } };
  assert.equal(sameMarketRowProps(props, rebuilt), true);
  // What the row shows, or its own move state, changing: a redraw.
  assert.equal(sameMarketRowProps(props, { ...props, pending: true }), false);
  assert.equal(sameMarketRowProps(props, { ...props, row: { ...base, player: { ...base.player, currentGameCost: 111_800 } } }), false);
  assert.equal(sameMarketRowProps(props, { ...props, row: { ...base, player: { ...base.player, quoteVersion: 4 } } }), false, 'the quote an Add sends stays fresh');
  assert.equal(sameMarketRowProps(props, { ...props, row: { ...base, isFull: true } }), false);
  assert.equal(sameMarketRowProps(props, { ...props, currentValue: { games: 1, avgNet: 500 } }), false);
  // A callback that is not stable redraws the row rather than keep a stale one.
  assert.equal(sameMarketRowProps(props, { ...props, onToggleWatch: () => undefined }), false);
  const held = { ...base, position: { positionId: 'x', lockedGameCost: 111_500 } };
  assert.equal(sameMarketRow(held, { ...held, position: { positionId: 'x', lockedGameCost: 111_500 } }), true);
  assert.equal(sameMarketRow(held, { ...held, position: { positionId: 'y', lockedGameCost: 111_500 } }), false);
  assert.equal(sameFlat(null, undefined), false);
  assert.equal(sameFlat({ a: 1 }, { a: 1, b: 2 }), false);
});

test('search: digits alone are not a name, so they get the names hint (walk 4 T2-19, T4-10, T1-15)', () => {
  const list = [
    { player: player({ playerId: 'l', name: 'Luka Doncic' }) },
    { player: player({ playerId: 'b', name: 'Bam Adebayo' }) },
  ];
  const find = (query: string) => ids(filterMarketRows(list, { query, watchedOnly: false, watched: [] }));
  for (const query of ['123', '23', ' 7 ', '#23', '1-2']) {
    assert.equal(searchHasLetters(query), false, query);
    assert.equal(find(query), '', query);
    assert.equal(listCountLine({ query, count: 0, total: 30, watchedOnly: false }), `${SEARCH_NEEDS_LETTERS}.`, query);
  }
  // A number beside a name is left out, so the name still finds him.
  assert.equal(find('luka 77'), 'l');
  assert.equal(find('77 bam'), 'b');
  assert.equal(searchHasLetters('luka 77'), true);
});

test('the slot line never breaks mid-phrase (walk 4 T1-11)', () => {
  assert.equal(slotLine('long', { used: 0, limit: 10 }), '0\u00A0of\u00A010 on\u00A0your\u00A0roster');
  assert.equal(slotLine('short', { used: 1, limit: 5 }), '1\u00A0of\u00A05 shorts');
  assert.equal(slotLine('short', { used: 0, limit: 1 }), '0\u00A0of\u00A01 short');
  // One break point each: after the count, after the amount.
  assert.equal(slotLine('long', { used: 3, limit: 10 }).split(' ').length, 2);
  // Walk 8 T1-10: the amount stays with its words; any break falls inside them.
  assert.equal(feeLine('long', 250), '$250\u00A0to add or\u00A0drop');
  assert.equal(feeLine('short', 250), '$250\u00A0to short or\u00A0close');
  assert.equal(feeLine('long', 0), '');
});

test('a move never reorders the list under the finger', async () => {
  const { keepListOrder } = await import('./marketView');
  const row = (id: string) => ({ player: { playerId: id } });
  // After an Add, Barnes's value dropped below Booker's: the sort swaps them.
  const resorted = [row('doncic'), row('booker'), row('barnes'), row('duren')];
  assert.deepEqual(
    keepListOrder(resorted, ['doncic', 'barnes', 'booker', 'duren']).map((r) => r.player.playerId),
    ['doncic', 'barnes', 'booker', 'duren'],
  );
  // A player new to the view goes at the end; no earlier order sorts afresh.
  assert.deepEqual(keepListOrder([row('a'), row('new'), row('b')], ['b', 'a']).map((r) => r.player.playerId), ['b', 'a', 'new']);
  assert.deepEqual(keepListOrder(resorted, null).map((r) => r.player.playerId), ['doncic', 'booker', 'barnes', 'duren']);
});

test('a held row measures Value at the price you locked, and sorts by the figure it shows (walk 5 T4-02, T1-02)', () => {
  // Doncic: locked at $417.5K, his dividend $488.5K; your add nudged today's price to $418.5K.
  const doncic = { currentGameCost: 418_500, priorSeasonValuePerGame: 488_500 };
  assert.equal(rowValueEdge(doncic, 'long', { lockedGameCost: 417_500 }), 71_000);
  assert.equal(rowValueEdge(doncic, 'long', null), 70_000, 'unheld: today\'s price');
  assert.deepEqual(heldValueLine(doncic, 'long', 417_500), { edge: 71_000, value: 'Value +$71K at your price', now: 'now $418.5K', tone: 'gain' });
  // A held short: locked credit minus his dividend.
  assert.equal(heldValueLine({ currentGameCost: 150_000, priorSeasonValuePerGame: 120_000 }, 'short', 140_000).value, 'Value +$20K at your price');
  assert.equal(heldValueLine({ currentGameCost: 90_000, priorSeasonValuePerGame: null }, 'long', 89_500).value, 'No last season');
  assert.equal(heldValueLine({ currentGameCost: 100_200, priorSeasonValuePerGame: 100_000 }, 'long', 100_000).value, 'Value even at your price');
  // Value sort: a held row sorts by its value at your price (+$71K), above a +$70.5K row at today's.
  const market = [
    { player: player({ playerId: 'x', currentGameCost: 100_000, priorSeasonValuePerGame: 170_500 }), position: null },
    { player: player({ playerId: 'd', ...doncic }), position: { lockedGameCost: 417_500 } },
  ];
  assert.equal(ids(sortMarketRows(market, 'value', 'long')), 'dx');
  assert.equal(ids(sortMarketRows(market.map((row) => ({ ...row, position: null })), 'value', 'long')), 'xd');
});

test('the name leads with your price on a held row (walk 5 T4-02)', () => {
  assert.equal(
    rowProfileLabel({ name: 'Luka Doncic', tier: 'star', price: 418_500, detail: 'On your roster', locked: 417_500 }),
    'Luka Doncic, star, yours $417.5K a game, On your roster, View profile',
  );
  assert.equal(rowProfileLabel({ name: 'Luka Doncic', tier: 'star', price: 418_500, detail: '' }), 'Luka Doncic, star, $418.5K a game, View profile');
});

test('every phone row breaks its value in the same place, and one game reads "in 1 game" (walk 5 T1-04, T1-05)', () => {
  const signal = valueSignal({ currentGameCost: 210_000, priorSeasonValuePerGame: 218_000 }, 'long');
  assert.deepEqual(unheldValueLines(signal), { first: 'Dividend last season $218K a game ·', second: '$8K over his price' });
  const none = unheldValueLines(valueSignal({ currentGameCost: 111_500, priorSeasonValuePerGame: null }, 'long'));
  assert.equal(none.first, 'No last season ·');
  assert.ok(none.second.length > 0, 'the second line is never empty');
  const one = { games: 1, avgNet: 194_500 } as Parameters<typeof heldDetail>[0];
  assert.equal(heldDetail(one, 417_500).text, '+$194.5K in 1 game');
  assert.equal(heldDetail({ ...one, games: 2, avgNet: 1_473 } as Parameters<typeof heldDetail>[0], 417_500).text, '+$1.5K a game over 2 games');
});

test('a phone list names the tier on every row, in one word and one place per width (walk 6 T1-01, T4-03, T4-06; walk 5 T1-03)', () => {
  assert.equal(shortTierLabel('role'), 'Role');
  assert.equal(shortTierLabel('starter'), 'Starter');
  assert.equal(shortTierLabel(null), '');
  const names = [['Donovan', 'role'], ['Derrick', 'role'], ['Kon', 'role'], ['OG', 'role'], ['Giannis', 'star'], ['Karl-Anthony', 'star'], ['Shai', 'star'], ["De'Aaron", 'starter']];
  const longest = Math.max(...names.map(([given]) => given.length));
  for (const width of [320, 360, 375, 390, 412, 430, 844]) {
    const fullTier = fullTierFits(width, longest);
    const placed = names.map(([given, tier]) => rowTier({ given, tier, width, fullTier }));
    // Never dropped, one place and one role word for the whole list.
    assert.ok(placed.every((row) => row.tier !== ''), `every row at ${width} keeps its tier`);
    assert.equal(new Set(placed.map((row) => row.place)).size, 1, `one place at ${width}`);
    assert.equal(new Set(placed.filter((_, index) => names[index][1] === 'role').map((row) => row.tier)).size, 1, `one role word at ${width}`);
  }
  // Portrait phones: "Role" beside the given name (Karl-Anthony is cut short, not moved); landscape has room for "Role player".
  assert.deepEqual(rowTier({ given: 'Derrick', tier: 'role', width: 390, fullTier: fullTierFits(390, longest) }), { given: 'Derrick', tier: 'Role', place: 'kicker' });
  assert.deepEqual(rowTier({ given: 'Karl-Anthony', tier: 'star', width: 390, fullTier: false }), { given: 'Karl-Anthony', tier: 'Star', place: 'kicker' });
  assert.equal(fullTierFits(430, longest), false);
  assert.equal(fullTierFits(844, longest), true);
  assert.deepEqual(rowTier({ given: 'Derrick', tier: 'role', width: 844, fullTier: true }), { given: 'Derrick', tier: 'Role\u00A0player', place: 'kicker' });
  // Narrow phones: after the surname on every row.
  assert.deepEqual(rowTier({ given: 'Shai', tier: 'star', width: 360, fullTier: false }), { given: 'Shai', tier: 'Star', place: 'after' });
  assert.deepEqual(rowTier({ given: 'Nikola', tier: null, width: 390, fullTier: false }), { given: 'Nikola', tier: '', place: 'kicker' });
});

test('spaced single letters are initials, and a few nicknames find their player alone (walk 5 T4-10, T4-N3)', () => {
  const pool = [
    { player: player({ playerId: 'og', name: 'OG Anunoby' }) },
    { player: player({ playerId: 'dc', name: 'Donovan Clingan' }) },
    { player: player({ playerId: 'cg', name: 'Collin Gillespie' }) },
    { player: player({ playerId: 'sga', name: 'Shai Gilgeous-Alexander' }) },
    { player: player({ playerId: 'wemby', name: 'Victor Wembanyama' }) },
    { player: player({ playerId: 'jokic', name: 'Nikola Jokić' }) },
    { player: player({ playerId: 'giannis', name: 'Giannis Antetokounmpo' }) },
    { player: player({ playerId: 'spida', name: 'Donovan Mitchell' }) },
    { player: player({ playerId: 'kat', name: 'Karl-Anthony Towns' }) },
  ];
  const find = (query: string) => filterMarketRows(pool, { query, watchedOnly: false, watched: [] }).map((row) => row.player.playerId).join(',');
  assert.equal(find('O G'), 'og');
  assert.equal(find('o g'), 'og');
  assert.equal(find('s g a'), 'sga');
  assert.equal(find('d c'), 'dc');
  assert.equal(find('x z'), '');
  assert.equal(find('wemby'), 'wemby');
  assert.equal(find('Wemby'), 'wemby');
  assert.equal(find('joker'), 'jokic');
  assert.equal(find('the joker'), 'jokic');
  assert.equal(find('greek freak'), 'giannis');
  assert.equal(find('Greek-Freak'), 'giannis');
  assert.equal(find('spida'), 'spida');
  // Anthony Edwards is not listed here: "ant" reads as letters, as before.
  assert.equal(find('ant'), 'giannis,kat');
  assert.equal(find('sga'), 'sga');
  // Every nickname names one player, and none is part of another's name.
  for (const [nickname, name] of Object.entries(PLAYER_NICKNAMES)) {
    assert.equal(nicknameFor(nickname), searchKey(name));
  }
  assert.equal(nicknameFor('wem'), null, 'only whole nicknames');
  assert.equal(nicknameFor('luka'), null);
});

test('after a night the list keeps its order, says so for which games, and re-sorts only when asked (walk 7 T4-11)', () => {
  assert.equal(heldOrderLine('2025-10-20', '2025-10-21'), 'Same order as before the Oct 21 games.');
  assert.equal(heldOrderLine('2025-10-20', '2025-10-27'), 'Same order as before the Oct 21–27 games.');
  assert.equal(resortName('2025-10-21'), 'Re-sort for the Oct 21 games');
  assert.equal(resortedLine('2025-10-20', '2025-10-21'), 'Re-sorted for the Oct 21 games.');
  assert.equal(resortedLine('', '2025-10-21'), 'Re-sorted for the Oct 21 games.');
  assert.equal(resortedLine('2025-10-20', '2025-10-27'), 'Re-sorted for the Oct 21–27 games.');
  assert.equal(resortedLine('2025-10-27', '2025-11-03'), 'Re-sorted for the Oct 28–Nov 3 games.');
  assert.equal(sameOrder(['a', 'b'], ['a', 'b']), true);
  assert.equal(sameOrder(['a', 'b'], ['b', 'a']), false);
  assert.equal(sameOrder(['a'], null), false);
});

test('the folded slot line never shares room it does not have with the search button (walk 6 T3-01, T4-10)', () => {
  // 200% zoom (195), 180px split screen and 400% zoom of a laptop (320): beside the button.
  assert.equal(foldedSlotBeside(195), true);
  assert.equal(foldedSlotBeside(180), true);
  assert.equal(foldedSlotBeside(320), true);
  // 400% zoom of a phone (98px): a line of its own.
  assert.equal(foldedSlotBeside(98), false);
  assert.equal(foldedSlotBeside(163), false);
});

test('a Watching list says how many it shows, on screen too (walk 6 T1-12)', () => {
  assert.equal(watchingLine(2), 'Watching: 2 players');
  assert.equal(watchingLine(1), 'Watching: 1 player');
});

test('the Short side says how long a short runs before one is bought (walk 6 T1-11)', () => {
  assert.equal(shortTermLine(7), 'Each short runs 7 days, then ends by itself.');
  assert.equal(shortTermLine(1), 'Each short runs 1 day, then ends by itself.');
  assert.equal(shortTermLine(null), 'Each short runs until you close it.');
});

test('Adds still saving count toward the free slots: once the last one is spoken for, other rows are FULL and say whose Add took it (walk 7 T4-01)', () => {
  const names = new Map([['brunson', 'Jalen Brunson'], ['kawhi', 'Kawhi Leonard'], ['bane', 'Desmond Bane'], ['luka', 'Luka Doncic']]);
  const held = new Set(['luka']);
  // A press claimed on screen first, then the context's running and queued keys; drops (held) and the other side are left out.
  const saving = savingMoves({
    side: 'long',
    keys: ['position:long:brunson', 'queued:position:long:brunson', 'queued:position:long:kawhi', 'position:long:luka', 'position:short:bane'],
    held,
    names,
  });
  assert.deepEqual(saving.map((move) => move.id), ['brunson', 'kawhi']);
  // One slot left, Brunson's Add saving: every other row is FULL, his is not.
  assert.equal(lastSlotTakenBy(1, saving.slice(0, 1), 'kawhi'), 'Jalen Brunson');
  assert.equal(lastSlotTakenBy(1, saving.slice(0, 1), 'bane'), 'Jalen Brunson');
  assert.equal(lastSlotTakenBy(1, saving.slice(0, 1), 'brunson'), null);
  // Two slots, two saving: the second Add takes the last one.
  assert.equal(lastSlotTakenBy(2, saving, 'bane'), 'Kawhi Leonard');
  assert.equal(lastSlotTakenBy(2, saving, 'kawhi'), null, 'his own Add still fits');
  assert.equal(lastSlotTakenBy(3, saving, 'bane'), null, 'a slot is still free');
  assert.equal(lastSlotTakenBy(0, saving, 'bane'), null, 'already full: the usual FULL says so');
  const note = spokenForNote('long', 'Jalen Brunson', 'Kawhi Leonard', 10);
  assert.equal(note.hint, "Full once Jalen Brunson's add saves.");
  assert.equal(note.message, "Full once Jalen Brunson's add saves (10 of 10). Drop a player to add Kawhi Leonard.");
  assert.equal(note.action, 'Choose who to drop');
  assert.equal(spokenForNote('short', 'Jalen Brunson', 'Kawhi Leonard', 5).hint, "Full once Jalen Brunson's short saves.");
});

test('the player list has a heading with its count, and a search still on is said on return and under the list (walk 7 T3-13, T3-19)', () => {
  assert.equal(listHeading('long', 30, 30), 'Players (30)');
  assert.equal(listHeading('short', 30, 30), 'Players to short (30)');
  assert.equal(listHeading('long', 6, 30), 'Players (6 of 30)');
  assert.equal(stillFilteredLine({ query: 'ja', count: 6, total: 30, watchedOnly: false }), 'Still showing 6 players matching "ja". Show all 30 is under the list.');
  assert.equal(stillFilteredLine({ query: 'ja', count: 1, total: 30, watchedOnly: true }), 'Still showing 1 player you watch matching "ja". Show all 30 is under the list.');
  assert.equal(stillFilteredLine({ query: 'zz', count: 0, total: 30, watchedOnly: false }), 'Search still on: no players match "zz".');
  assert.equal(stillFilteredLine({ query: '', count: 3, total: 30, watchedOnly: true }), 'Still showing only players you watch: 3 players. Show all 30 is under the list.');
  assert.equal(stillFilteredLine({ query: '', count: 30, total: 30, watchedOnly: false }), null, 'nothing on: nothing to say');
  assert.equal(stillFilteredLine({ query: '🏀', count: 30, total: 30, watchedOnly: false }), null, 'no letters: the empty state says what search needs');
  assert.equal(searchFooterLine('ja', 6), '6 players match "ja"');
});

test('a value line never ends on a lone "·" and a large-text surname shrinks rather than break mid-word (walk 7 T1-02, T4-08)', () => {
  assert.deepEqual(valueLineParts('Dividend last season $488.5K a game ·', '$71K over his price', false), { first: 'Dividend last season $488.5K a game', joiner: '', second: '$71K over his price' });
  assert.deepEqual(valueLineParts('No last season ·', 'nothing to compare with his price', true), { first: 'No last season', joiner: '·\u00A0', second: 'nothing to compare with his price' });
  // 180px window: 112px for the name at 15px.
  assert.ok(surnameFontSize('Antetokounmpo', 112, 15) < 15, 'shrinks to fit');
  assert.ok(surnameFontSize('Antetokounmpo', 112, 15) * 13 * 0.62 <= 112, 'the whole word fits');
  assert.equal(surnameFontSize('Doncic', 112, 15), 15, 'short names keep full size');
  assert.equal(surnameFontSize('Gilgeous-Alexander', 112, 15), 15, 'a plain hyphen may end the line');
  assert.equal(surnameFontSize('Antetokounmpo', 20, 15), 11, 'never below the floor');
});
