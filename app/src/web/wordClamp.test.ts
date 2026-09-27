import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampWords, wordClampText } from './wordClamp';

// A pretend line box: `perLine` characters a line, `lines` lines.
const box = (perLine: number, lines: number) => (text: string) => {
  let used = 1;
  let line = 0;
  for (const word of text.split(' ')) {
    const next = line === 0 ? word.length : line + 1 + word.length;
    if (next <= perLine) line = next;
    else {
      used += 1;
      line = word.length;
    }
  }
  return used <= lines;
};

test('a clamp ends on "…" at a word, never inside a date held together (walk 18 T3-11)', () => {
  // "Oct 21–Apr 12" is one unit: no-break space and word joiners (keepDatesTogether).
  const text = 'Season complete. Final score +$5.50M, #1 of 5. Oct 21⁠–⁠Apr 12 games: your score rose $5.50M.';
  const clamp = wordClampText(clampWords(text), box(24, 2));
  assert.equal(clamp, 'Season complete. Final score +$5.50M, #1 of 5…');
  assert.doesNotMatch(clamp ?? '', /Apr 1…/);
});

test('a text that fits is not clamped', () => {
  assert.equal(wordClampText(clampWords('Luka Doncic added.'), box(40, 2)), null);
});

test('a first word longer than the box still shows, cut by the browser', () => {
  assert.equal(wordClampText(clampWords('Gilgeous-Alexander added at $401K a game.'), box(8, 1)), 'Gilgeous-Alexander…');
});
