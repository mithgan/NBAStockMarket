import assert from 'node:assert/strict';
import test from 'node:test';

import { HELD_NOW_MIN_WIDTH, heldValueLine, slotLine, waitingActionName, waitingForLine } from './marketView';

// walk 9 T4-04: a move pressed while practice games play says it waits.
test('the slot count says moves wait for the games playing, no longer than the saving line', () => {
  const saving = slotLine('long', { used: 1, limit: 10 }, 2);
  const waiting = slotLine('long', { used: 1, limit: 10 }, 2, true);
  assert.equal(saving, '3 of 10 · 2 saving');
  assert.equal(waiting, '3 of 10 · 2 waiting');
  assert.ok(waiting.length <= slotLine('long', { used: 3, limit: 10 }).length, 'never longer than the plain line');
  // Nothing saving: the plain line, whatever is playing.
  assert.equal(slotLine('long', { used: 1, limit: 10 }, 0, true), slotLine('long', { used: 1, limit: 10 }));
});

test('the line under it names the games, kept whole', () => {
  assert.equal(waitingForLine('Oct 21–27'), 'for the Oct 21–27 games');
  assert.equal(waitingForLine('Oct 21'), 'for the Oct 21 games');
  assert.equal(waitingForLine("rest of the season's"), "for the rest of the season's games");
});

test('a waiting button says what it waits for and what it will do', () => {
  assert.equal(waitingActionName('long', 'Scottie Barnes', 'Oct 21–27'), 'Waiting for the Oct 21–27 games to add Scottie Barnes');
  assert.equal(waitingActionName('short', 'Devin Booker', 'Oct 21'), 'Waiting for the Oct 21 games to short Devin Booker');
});

// walk 9 T1-06: a held row's value line is last season's figure at your price
// (drawn in neutral ink); walk 13 T1-05 names it Value, the word the list sorts
// by and the Market defines, and gives today's price its noun.
test('a held row says its Value at your price, whatever this season did', () => {
  const barnes = { currentGameCost: 260_000, priorSeasonValuePerGame: 294_000 };
  const line = heldValueLine(barnes, 'long', 259_000);
  assert.equal(line.value, 'Value +$35K at your price');
  assert.equal(line.now, 'price now $260K');
  assert.doesNotMatch(line.value, /^Last season/);
  assert.equal(HELD_NOW_MIN_WIDTH, 360);
});

// walk 9 T1-16, T4-10, T2-12: the order in one quiet line.
test('the order line says the order, an unusual order, or that it is from before the games', async () => {
  const { orderLine, flippedSortNote, sortAscending } = await import('./marketView');
  assert.equal(sortAscending('price'), false, 'Price opens highest first');
  assert.deepEqual(flippedSortNote('price'), { text: 'Showing the lowest price first.', restore: 'Highest price first' });
  const plain = orderLine({ sort: 'value', reversed: false, heldNote: null });
  assert.deepEqual([plain.text, plain.tone, plain.resort], ['Sorted by value, highest first.', 'quiet', false]);
  const flipped = orderLine({ sort: 'price', reversed: true, heldNote: null });
  assert.deepEqual([flipped.text, flipped.tone, flipped.resort], ['Showing the lowest price first.', 'flipped', false]);
  const stale = orderLine({ sort: 'price', reversed: true, heldNote: 'Same order as before the Oct 21–27 games.' });
  assert.deepEqual([stale.text, stale.tone, stale.resort], ['Same order as before the Oct 21–27 games.', 'stale', true]);
  // Every wording keeps the height of the longest one, so nothing below moves.
  for (const line of [plain, flipped, stale]) assert.equal(line.reserve, stale.reserve);
  assert.ok(stale.reserve.length >= stale.text.length);
});

// walk 9 T3-02: the table row's player cell is its header, named without the figures.
test('a row header names the player and his profile, not the figures in the next cells', async () => {
  const { rowHeaderLabel } = await import('./marketView');
  assert.equal(rowHeaderLabel({ name: 'Luka Doncic', tier: 'star' }), 'Luka Doncic, star, view profile');
  assert.equal(rowHeaderLabel({ name: 'Luka Doncic', tier: 'star', tag: 'On your roster' }), 'Luka Doncic, star, on your roster, view profile');
  assert.equal(rowHeaderLabel({ name: 'Kon Knueppel', tier: 'role' }), 'Kon Knueppel, role player, view profile');
  assert.equal(
    rowHeaderLabel({ name: 'Kawhi Leonard', tier: 'star', reason: 'Shorted: close his short to add him.' }),
    'Kawhi Leonard, star. Shorted: close his short to add him. View profile',
  );
  assert.doesNotMatch(rowHeaderLabel({ name: 'Luka Doncic', tier: 'star', tag: 'On your roster' }), /\$/);
});

// walk 9 T4-07: below 360px a phone row gives its photo's room to the name and price.
test('narrow phone rows leave out the photo so every row keeps one height', async () => {
  const { phoneRowPhoto, PHONE_PHOTO_MIN_WIDTH } = await import('./marketView');
  assert.equal(PHONE_PHOTO_MIN_WIDTH, 360);
  assert.equal(phoneRowPhoto(320), false);
  assert.equal(phoneRowPhoto(359), false);
  assert.equal(phoneRowPhoto(360), true);
  assert.equal(phoneRowPhoto(390), true);
});
