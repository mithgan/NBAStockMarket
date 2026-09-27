import assert from 'node:assert/strict';
import test from 'node:test';
import { keepFiguresTogether } from './perGameRules';

const plain = (text: string) => text.replace(/⁠/g, '').replace(/ /g, ' ');

test('the Rules keep "× $40K" together, and a figure with its "a game" (walk 18 T1-09)', () => {
  const line = keepFiguresTogether('His dividend is his net points each game × $40K.');
  assert.equal(line, 'His dividend is his net points each game × $40K.');
  assert.equal(keepFiguresTogether('Locks his price at $230.4K a game for 7 days.'), 'Locks his price at $230.4K\u00a0a\u00a0game for 7 days.');
  // The worked example: each figure with its word, the sign on its figure.
  assert.equal(
    keepFiguresTogether('3.5 net points = $140K dividend; price $118K; profit +$22K.'),
    '3.5 net points = $140K dividend; price $118K; profit +⁠$22K.',
  );
  // The words read the same.
  for (const text of ['His dividend is how far his net points beat his pregame projection, × $40K.', 'score -$250', 'a $250 fee each time']) {
    assert.equal(plain(keepFiguresTogether(text)), text);
  }
});
