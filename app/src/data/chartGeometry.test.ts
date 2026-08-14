import assert from 'node:assert/strict';
import test from 'node:test';

import { nearestPointIndex } from './chartGeometry';

const points = [
  { x: 10, y: 40 },
  { x: 160, y: 20 },
  { x: 310, y: 60 },
];

test('a pointer between plotted points snaps to the nearest one', () => {
  assert.equal(nearestPointIndex(points, 70, 320), 0);
  assert.equal(nearestPointIndex(points, 100, 320), 1);
  assert.equal(nearestPointIndex(points, 250, 320), 2);
});

test('a pointer skimming past either edge resolves to the edge point', () => {
  assert.equal(nearestPointIndex(points, -25, 320), 0);
  assert.equal(nearestPointIndex(points, 500, 320), 2);
});

test('an empty plot or a collapsed surface has nothing to snap to', () => {
  assert.equal(nearestPointIndex([], 50, 320), null);
  assert.equal(nearestPointIndex(points, 50, 0), null);
});
