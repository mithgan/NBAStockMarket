import assert from 'node:assert/strict';
import test from 'node:test';

import { feeLine, FULL_BUTTON_WORDS, fullActionName, listCountLine, otherSideSaving, searchMatchLine, slotLine, slotRoomFirst, watchingToggleName } from './marketView';

test('walk 8 T3-11: the folded search says what it found, right under the box', () => {
  assert.equal(searchMatchLine('sga', ['Shai Gilgeous-Alexander']), '1 player: Shai Gilgeous-Alexander');
  assert.equal(searchMatchLine('jalen', ['Jalen Brunson', 'Jalen Duren']), '2 players: Jalen Brunson, Jalen Duren');
  assert.equal(searchMatchLine('le', ['A', 'B', 'C', 'D', 'E', 'F', 'G']), '7 players match "le"');
  assert.equal(searchMatchLine('zzqx', []), 'No players match "zzqx"');
  assert.equal(searchMatchLine('  ', ['Anyone']), null, 'nothing typed: no line');
  assert.equal(searchMatchLine('-', []), null, 'no letters: the empty state says what search needs');
});

test('walk 8 T2-08: the slot count counts adds still saving, and is never longer than the plain line', () => {
  assert.equal(slotLine('long', { used: 7, limit: 10 }, 3), '10\u00A0of\u00A010 ·\u00A03\u00A0saving');
  assert.equal(slotLine('short', { used: 1, limit: 5 }, 1), '2\u00A0of\u00A05 ·\u00A01\u00A0saving');
  assert.equal(slotLine('long', { used: 9, limit: 10 }, 3), '10\u00A0of\u00A010 ·\u00A03\u00A0saving', 'never past the limit');
  assert.equal(slotLine('long', { used: 7, limit: 10 }), '7\u00A0of\u00A010 on\u00A0your\u00A0roster', 'nothing saving: the plain line');
  assert.ok(slotLine('long', { used: 7, limit: 10 }, 3).length <= slotLine('long', { used: 10, limit: 10 }).length);
});

test('walk 8 T4-07: the other side shows a saving move as busy, never as its own tick', () => {
  assert.deepEqual(otherSideSaving('short'), { tag: 'Adding to your roster…', reason: 'His add to your roster is still saving.' });
  assert.deepEqual(otherSideSaving('long'), { tag: 'Shorting…', reason: 'Your short on him is still saving.' });
  assert.ok(!/✓/.test(otherSideSaving('short').tag) && !/✓/.test(otherSideSaving('long').tag));
});

test('walk 8 T1-11: FULL shows a way to make room, and its name starts with those words', () => {
  assert.deepEqual(FULL_BUTTON_WORDS.split('\n'), ['Full', 'make room']);
  const words = FULL_BUTTON_WORDS.replace('\n', ', ').toLowerCase();
  for (const side of ['long', 'short'] as const) {
    assert.ok(fullActionName(side, 'Kawhi Leonard').toLowerCase().startsWith(words), side);
    assert.match(fullActionName(side, 'Kawhi Leonard'), /Kawhi Leonard$/);
  }
});

test('walk 8 T3-16, T2-07: the Watching switch starts with its visible words; the summary names the real button', () => {
  assert.equal(watchingToggleName(0), 'Watching 0, show only players you watch');
  assert.ok(watchingToggleName(2).startsWith('Watching 2'));
  const base = { query: '', total: 30, watchedOnly: true };
  assert.equal(listCountLine({ ...base, count: 1 }), 'Watching: 1 player. Show all 30 is below the list.');
  assert.equal(listCountLine({ ...base, count: 0, listed: 1 }), 'Watching: 0 players. Show all 30 is below the list.', 'kept rows: the footer\'s Show all 30');
  assert.equal(listCountLine({ ...base, count: 0 }), 'Watching: 0 players. Show everyone to see all 30.', 'empty list: its Show everyone');
});

test('walk 8 T1-10: "$250" never stands alone, and 340-389px phones give the slot column the room', () => {
  for (const side of ['long', 'short'] as const) {
    const line = feeLine(side, 250);
    assert.ok(line.startsWith('$250\u00A0to'), line);
    assert.equal(line.replace(/\u00A0/g, ' '), side === 'long' ? '$250 to add or drop' : '$250 to short or close');
    assert.ok(!/ \S+$/.test(line), 'the last word keeps company');
  }
  assert.equal(slotRoomFirst(360), true);
  assert.equal(slotRoomFirst(375), true);
  assert.equal(slotRoomFirst(390), false);
  // Beside the toggle from 320px now (walk 10 T4-04): the slot column takes the room first there too.
  assert.equal(slotRoomFirst(320), true);
  assert.equal(slotRoomFirst(300), false, 'under the toggle there: no race for room');
});
