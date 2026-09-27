import assert from 'node:assert/strict';
import test from 'node:test';

import {
  headerStatus,
  heldOrderLine,
  lockLineShort,
  orderLine,
  orderLineNarrow,
  rowsUnderToolbarTooFew,
} from './marketView';

// walk 11 T4-08: at 320px the list starts in one place before and after every night.
test('a narrow phone says the held order short, on one line beside Re-sort', () => {
  assert.equal(orderLineNarrow(320, false), true);
  assert.equal(orderLineNarrow(389, false), true);
  assert.equal(orderLineNarrow(390, false), false);
  assert.equal(orderLineNarrow(768, true), false, 'the table has room for the long wording');
  // walk 13 T1-17: the short wording says why the order stayed (Re-sort names the games).
  assert.equal(heldOrderLine('2025-10-20', '2025-10-21', true), 'Order kept so rows stay put');
  assert.equal(heldOrderLine('2025-10-20', '2025-10-27', true), 'Order kept so rows stay put');
  assert.equal(heldOrderLine('2025-10-20', '2025-10-27'), 'Values moved in the Oct 21–27 games; order kept so rows stay put.');
  const narrow = orderLine({ sort: 'value', reversed: false, heldNote: null, gamesIn: false, narrow: true });
  assert.equal(narrow.reserve, 'Order kept so rows stay put');
  assert.equal(narrow.reserveResort, true, "Re-sort's height is kept before the first games too");
  const stale = orderLine({ sort: 'value', reversed: false, heldNote: heldOrderLine('2025-10-20', '2025-10-27', true), narrow: true });
  assert.deepEqual([stale.text, stale.resort, stale.reserve], ['Order kept so rows stay put', true, narrow.reserve]);
});

test('the lock line takes the fee line\'s two lines in the narrow slot column', () => {
  assert.equal(lockLineShort(320), true);
  assert.equal(lockLineShort(339), true);
  assert.equal(lockLineShort(340), false);
  assert.equal(lockLineShort(300), false, 'under the toggle it has the full width');
  const base = { side: 'long' as const, seasonOver: false, rosterLocked: true, lockGameDate: '2025-10-28', full: false };
  assert.equal(headerStatus(base).text, 'Moves reopen after Oct 28');
  assert.deepEqual(headerStatus({ ...base, short: true }), { text: 'Reopens after Oct 28', kind: 'lock' });
  assert.equal(headerStatus({ ...base, rosterLocked: false, short: true }).text, null);
});

// walk 11 T3-13: a short table window folds its toolbar when the rows under it get under half the window.
test('the rows under a scrolling toolbar keep at least half the window on arrival', () => {
  assert.equal(rowsUnderToolbarTooFew(126, 533), true, '853x533: two players under the full toolbar');
  assert.equal(rowsUnderToolbarTooFew(300, 533), false);
  assert.equal(rowsUnderToolbarTooFew(-40, 533), true, 'a toolbar taller than the list');
  assert.equal(rowsUnderToolbarTooFew(100, 0), false, 'no window measured yet');
});

// walk 11 lead note: a phone row's price box keeps the widest price's width, so an Add never re-wraps its name.
test('the price width reserve is the widest price shape the list can show', async () => {
  const { priceWidthReserve } = await import('./marketView');
  assert.equal(priceWidthReserve(['$379.5K', '$380.4K', '$99.5K']), '$000.0K', 'every digit as its widest');
  assert.equal(priceWidthReserve(['$99.5K', '$1.25M']), '$0.00M', 'an M is wider than a K');
  assert.equal(priceWidthReserve([]), '');
});

// walk 11 T1-13, T2-03: the Market after the season speaks of the season past.
test('a finished season is said in the past tense on the Market', async () => {
  const { heldTag, seasonEndSlotLine, seasonEndExplainer } = await import('./marketView');
  assert.equal(heldTag('long', false), 'On your roster');
  assert.equal(heldTag('long', true), 'On your roster this season');
  assert.equal(heldTag('short', true), 'Shorted this season');
  assert.equal(seasonEndSlotLine('long', 2), '2 held at season end');
  assert.equal(seasonEndSlotLine('long', 0), 'None held at season end');
  assert.equal(seasonEndSlotLine('short', 0), 'No shorts at season end');
  assert.equal(seasonEndExplainer('short'), 'The season is over. Shorts open again in a new season.');
  // walk 12 T2-05: Value is still last season's dividend against his price, not this season's result.
  assert.equal(seasonEndExplainer('long'), "The season is over. Value still compares last season's dividend with his price.");
});

// walk 11 check: at 320px with text spacing, "on your roster" never spills over the side toggle.
test('the narrow slot column puts the count and "on your roster" on lines of their own', async () => {
  const { slotLineNarrow } = await import('./marketView');
  assert.equal(slotLineNarrow('long', { used: 2, limit: 10 }), '2 of 10\non your roster');
  assert.equal(slotLineNarrow('short', { used: 0, limit: 5 }), '0 of 5 shorts', 'one word: unchanged');
});
