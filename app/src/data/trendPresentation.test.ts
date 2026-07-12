import assert from 'node:assert/strict';
import test from 'node:test';

import { selectTrendRange, sparklineHeights, trendDirection } from './trendPresentation';

test('trend direction compares the first and last real dividend values', () => {
  assert.equal(trendDirection([-10, 5, 20]), 'up');
  assert.equal(trendDirection([20, 5, -10]), 'down');
  assert.equal(trendDirection([4, 4]), 'up');
});

test('sparkline heights preserve relative values in a compact visible range', () => {
  assert.deepEqual(sparklineHeights([-100, 0, 100]), [5, 17.5, 30]);
  assert.deepEqual(sparklineHeights([8, 8]), [17.5, 17.5]);
});

test('trend range selects the most recent 5 or 15 points without mutating the series', () => {
  const points = Array.from({ length: 18 }, (_, index) => ({ index }));

  assert.deepEqual(selectTrendRange(points, 'L5').map((point) => point.index), [13, 14, 15, 16, 17]);
  assert.deepEqual(selectTrendRange(points, 'L15').map((point) => point.index), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  assert.equal(points.length, 18);
});
