import assert from 'node:assert/strict';
import test from 'node:test';

import { explainerDone, forgetMarket, markExplained, marketMemory } from './marketViewMemory';

test('a side\'s explainer gives its room back after a move on that side or its × (walk 16 T1-01)', () => {
  forgetMarket();
  assert.deepEqual(marketMemory().explained, { long: false, short: false }, 'a new visit explains both sides');
  assert.equal(explainerDone(false, 0), false, 'before any move it shows');
  assert.equal(explainerDone(false, 2), true, 'someone held on that side: a move was made');
  markExplained('long');
  assert.deepEqual(marketMemory().explained, { long: true, short: false }, 'one side at a time');
  assert.equal(explainerDone(marketMemory().explained.long, 0), true, 'a × or a move made earlier this visit');
  assert.equal(explainerDone(marketMemory().explained.short, 0), false);
  forgetMarket();
  assert.equal(marketMemory().explained.long, false, 'Restart starts over');
});
