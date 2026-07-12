import assert from 'node:assert/strict';
import test from 'node:test';

import { sparklineHeights, trendDirection } from './trendPresentation';

test('trend direction compares the first and last real dividend values', () => {
  assert.equal(trendDirection([-10, 5, 20]), 'up');
  assert.equal(trendDirection([20, 5, -10]), 'down');
  assert.equal(trendDirection([4, 4]), 'up');
});

test('sparkline heights preserve relative values in a compact visible range', () => {
  assert.deepEqual(sparklineHeights([-100, 0, 100]), [5, 17.5, 30]);
  assert.deepEqual(sparklineHeights([8, 8]), [17.5, 17.5]);
});
