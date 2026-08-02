import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cumulativeValues,
  selectHighLowPoints,
  selectSettledTrendPoints,
  selectTrendRange,
  sparklineHeights,
  trendDirection,
} from './trendPresentation';

test('trend direction compares the first and last real dividend values', () => {
  assert.equal(trendDirection([-10, 5, 20]), 'up');
  assert.equal(trendDirection([20, 5, -10]), 'down');
  assert.equal(trendDirection([4, 4]), 'up');
});

test('sparkline heights preserve relative values in a compact visible range', () => {
  assert.deepEqual(sparklineHeights([-100, 0, 100]), [5, 17.5, 30]);
  assert.deepEqual(sparklineHeights([8, 8]), [17.5, 17.5]);
});

test('trend range selects the most recent 5, 15, or full-season points without mutating the series', () => {
  const points = Array.from({ length: 18 }, (_, index) => ({ index }));

  assert.deepEqual(selectTrendRange(points, 'L5').map((point) => point.index), [13, 14, 15, 16, 17]);
  assert.deepEqual(selectTrendRange(points, 'L15').map((point) => point.index), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  assert.deepEqual(selectTrendRange(points, 'Season').map((point) => point.index), points.map((point) => point.index));
  assert.equal(points.length, 18);
});

test('settled trend points never expose future replay results', () => {
  const points = [
    { date: '2025-10-21', value: 1 },
    { date: '2025-10-23', value: 2 },
    { date: '2025-10-25', value: 3 },
  ];

  assert.deepEqual(selectSettledTrendPoints(points, null), []);
  assert.deepEqual(selectSettledTrendPoints(points, '2025-10-23'), points.slice(0, 2));
  assert.equal(points.length, 3);
});

test('cumulative chart values and high/low points are deterministic', () => {
  const cumulative = cumulativeValues([100, -250, 500, -50]);

  assert.deepEqual(cumulative, [100, -150, 350, 300]);
  assert.deepEqual(selectHighLowPoints(cumulative), {
    high: { index: 2, value: 350 },
    low: { index: 1, value: -150 },
  });
  assert.deepEqual(selectHighLowPoints([]), { high: null, low: null });
});
