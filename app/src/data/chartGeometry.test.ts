import assert from 'node:assert/strict';
import test from 'node:test';

import { chartCoordinates, portfolioPeriodChange } from './chartGeometry';

test('a one-day portfolio history renders a visible point in the chart center', () => {
  assert.deepEqual(chartCoordinates([140_000_000], 320, 124), [
    { x: 160, y: 62 },
  ]);
});

test('flat multi-day histories use the chart midpoint instead of the top edge', () => {
  assert.deepEqual(chartCoordinates([140_000_000, 140_000_000], 320, 124), [
    { x: 10, y: 62 },
    { x: 310, y: 62 },
  ]);
});

test('a one-day portfolio period includes that day change', () => {
  assert.equal(
    portfolioPeriodChange([
      { totalValue: 140_500_000 },
    ], 140_000_000),
    500_000,
  );
});

test('a multi-day portfolio period compares with the point before the visible range', () => {
  assert.equal(
    portfolioPeriodChange([
      { totalValue: 140_500_000 },
      { totalValue: 140_200_000 },
      { totalValue: 141_000_000 },
    ], 139_900_000),
    1_100_000,
  );
});
