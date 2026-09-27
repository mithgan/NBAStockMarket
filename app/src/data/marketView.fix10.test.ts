import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HELD_VALUE_CAPTION,
  heldDetail,
  heldPriceSaysYours,
  listCountLine,
  orderLine,
  pinnedChromeTooTall,
  otherSideGroupLine,
  otherSideReason,
  resortsAfterRun,
  rowValueEdge,
  unheldProfitWords,
  valueColumnExplanation,
} from './marketView';

// walk 10 T2-07: the Value tip states the formula of the side on show.
test('the Value tip is true to its side, and plus is good for you on both', () => {
  const roster = valueColumnExplanation('long');
  const short = valueColumnExplanation('short');
  assert.equal(roster, "Last season's dividend minus his price (your price once you hold him). Plus is good for you.");
  assert.equal(short, "His price minus last season's dividend (your price once you short him). Plus is good for you.");
  // The formula each states is the one the column prints (Cunningham: $388.5K − $319.5K = +$69K a short).
  const cade = { currentGameCost: 388_500, priorSeasonValuePerGame: 319_500 };
  assert.equal(rowValueEdge(cade, 'short'), 69_000);
  assert.equal(rowValueEdge(cade, 'long'), -69_000);
});

// walk 10 T2-12: a held row's Value on the tables says where it comes from.
test('a held table Value is captioned as last season at your price, kept whole', () => {
  assert.equal(HELD_VALUE_CAPTION.replace(/\u00A0/g, ' '), 'last season at your price');
  assert.ok(HELD_VALUE_CAPTION.endsWith('at\u00A0your\u00A0price'), '"at your price" never breaks');
});

// walk 10 T2-03: a run longer than a week, or one that ends the season, re-sorts.
test('a night or a week keeps the order; a longer run or the season end re-sorts', () => {
  assert.equal(resortsAfterRun('2025-10-20', '2025-10-21', false), false, 'a night');
  assert.equal(resortsAfterRun('2025-10-20', '2025-10-27', false), false, 'a week');
  assert.equal(resortsAfterRun('2025-10-20', '2025-10-28', false), true, 'more than a week');
  assert.equal(resortsAfterRun('2025-10-20', '2025-11-10', false), true, 'three weeks');
  assert.equal(resortsAfterRun('2026-04-08', '2026-04-12', true), true, 'the season ended');
  assert.equal(resortsAfterRun('2025-10-27', '2025-10-27', true), false, 'already sorted for the latest night');
  assert.equal(resortsAfterRun('', '2025-10-27', true), false, 'nothing sorted yet');
});

// walk 10 T2-04: at season end the other side's group only says who they are.
test('the other side\'s group gives advice only while moves can still happen', () => {
  assert.equal(otherSideGroupLine('short', false), 'On your roster: to short one of them, drop him there first');
  assert.equal(otherSideGroupLine('short', true), 'On your roster this season');
  assert.equal(otherSideGroupLine('long', false), 'Shorted: to add one of them, close his short first');
  assert.equal(otherSideGroupLine('long', true), 'Shorted this season');
  assert.equal(unheldProfitWords('short', true), 'on your roster');
  assert.equal(unheldProfitWords('long', true), 'shorted');
  assert.equal(unheldProfitWords('short', false), 'not held');
  assert.equal(otherSideReason('short', "He's on your roster. Drop him to short him.", false), "He's on your roster. Drop him to short him.");
  assert.equal(otherSideReason('short', "He's on your roster. Drop him to short him.", true), "He's on your roster.");
  assert.equal(otherSideReason('long', "You're shorting him. Close the short to add him.", true), "You're shorting him.");
  assert.equal(otherSideReason('long', null, true), null);
});

// walk 10 T1-05, T1-03: the held line leads with the total; a result bigger than his price says why.
test('a held line leads with the total, the average after it, and says a below-zero night', () => {
  const week = { games: 4, total: 454_000, avgNet: 113_500, avgDividend: 531_000 } as Parameters<typeof heldDetail>[0];
  assert.deepEqual(heldDetail(week, 417_500), { text: '+$454K over 4 games, +$113.5K a game', total: '+$454K over 4 games', tone: 'gain', why: null });
  const barnes = { games: 1, total: -315_000, avgNet: -315_000, avgDividend: -56_000 } as Parameters<typeof heldDetail>[0];
  assert.deepEqual(heldDetail(barnes, 259_000), { text: '-$315K in 1 game', total: '-$315K in 1 game', tone: 'loss', why: 'a below-zero night' });
  const bad = { games: 3, total: -900_000, avgNet: -300_000, avgDividend: -41_000 } as Parameters<typeof heldDetail>[0];
  assert.equal(heldDetail(bad, 259_000).why, 'below zero on average');
  // A dividend that rounds to $0 is not below zero.
  assert.equal(heldDetail({ ...bad, avgDividend: -0.4 } as Parameters<typeof heldDetail>[0], 259_000).why, null);
});

// walk 10 T1-02: a held phone price keeps "/game"; "yours" only where it fits beside the name.
test('a held price says yours only where it cannot push the row to a second line', () => {
  assert.equal(heldPriceSaysYours(390, false), false);
  assert.equal(heldPriceSaysYours(320, false), false);
  assert.equal(heldPriceSaysYours(440, false), true);
  assert.equal(heldPriceSaysYours(844, false), true, 'a phone turned sideways');
  assert.equal(heldPriceSaysYours(320, true), true, 'the large-text row gives the price a line of its own');
});

// walk 10 T4-04, superseded by walk 11 T4-08: the order line keeps one
// height from the first view on (one line with Re-sort; its short held
// wording on a narrow phone), so the list never drops when a night lands.
test('the order line reserves its own longest wording and the one-line held wording before and after games', () => {
  const before = orderLine({ sort: 'value', reversed: false, heldNote: null, gamesIn: false });
  assert.equal(before.reserveOwn, 'Sorted by value, highest first.', 'the longer of its own two wordings');
  assert.equal(orderLine({ sort: 'dividend', reversed: true, heldNote: null, gamesIn: false }).reserveOwn, 'Sorted by dividend last season, highest first.');
  assert.equal(orderLine({ sort: 'name', reversed: false, heldNote: null, gamesIn: false }).reserveOwn, 'Sorted by name, A to Z.');
  const after = orderLine({ sort: 'value', reversed: false, heldNote: null, gamesIn: true });
  assert.deepEqual([before.reserve, before.reserveResort], [after.reserve, after.reserveResort], 'one height before and after the first games');
  assert.equal(after.reserve, 'Same order as before the Oct 21–27 games.');
  assert.equal(after.reserveResort, true);
});

// walk 10 T3-08: turning the Watching filter on says the count and where the way back is.
test('the Watching filter is said with where Show all is', () => {
  const base = { query: '', total: 30, watchedOnly: true };
  assert.equal(listCountLine({ ...base, count: 1 }), 'Watching: 1 player. Show all 30 is below the list.');
  assert.equal(listCountLine({ ...base, count: 0 }), 'Watching: 0 players. Show everyone to see all 30.');
  assert.equal(listCountLine({ ...base, count: 30, watchedOnly: false }), 'Showing all 30 players.');
});

// walk 10 T2-16: a pinned toolbar that leaves the rows under 55% of the window folds.
test('the pinned toolbar folds when the rows keep too little of the window', () => {
  assert.equal(pinnedChromeTooTall(206, 600), true, '960x600: rows in the bottom 206px');
  assert.equal(pinnedChromeTooTall(430, 768), false, '1024x768 keeps its toolbar');
  assert.equal(pinnedChromeTooTall(574, 900), false, '1440x900 keeps its toolbar');
  assert.equal(pinnedChromeTooTall(0, 600), false, 'not measured yet');
});
