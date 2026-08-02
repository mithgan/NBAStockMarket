import assert from 'node:assert/strict';
import test from 'node:test';

import { marketActionWidth, marketRowHeight } from './marketRowHeight';

test('default text size keeps the compact 64px scanning row', () => {
  assert.equal(marketRowHeight(1), 64);
});

test('row height grows with the OS text-size setting so copy is not clipped', () => {
  assert.equal(marketRowHeight(1.5), 96);
  assert.ok(marketRowHeight(1.3) > marketRowHeight(1));
});

test('row height is capped so a single listing can never fill the screen', () => {
  assert.equal(marketRowHeight(3), 128);
  assert.equal(marketRowHeight(2), 128);
});

test('shrinking font scales never make rows smaller than the touch target', () => {
  assert.equal(marketRowHeight(0.5), 64);
  assert.ok(marketRowHeight(0.5) >= 44);
});

test('the action column shares one width so BUY/SELL/SOLD OUT stay aligned', () => {
  assert.equal(marketActionWidth(1), 70);
});

test('the action column grows with text size so status labels are not truncated', () => {
  assert.equal(marketActionWidth(1.5), 105);
  assert.ok(marketActionWidth(1.4) > marketActionWidth(1));
  assert.equal(marketActionWidth(4), 140);
  assert.equal(marketActionWidth(Number.NaN), 70);
});

test('the action column never takes more than 30% of a narrow row', () => {
  // 320px phone at 2x text: the unbounded 152px would leave the player name
  // with almost nothing, so the column is bounded by the row instead.
  assert.equal(marketActionWidth(2, 320), 96);
  assert.ok(marketActionWidth(2, 320) < marketActionWidth(2));
  // Roomy viewports are unaffected by the ceiling.
  assert.equal(marketActionWidth(2, 1040), 140);
  assert.equal(marketActionWidth(1, 1040), 70);
});

test('the action ceiling never shrinks the column below its base width', () => {
  // 30% of a very narrow row would be under 76px; the base width still wins so
  // BUY/SELL stay legible.
  assert.equal(marketActionWidth(1, 200), 70);
  assert.equal(marketActionWidth(2, 100), 70);
});

test('a missing or invalid font scale falls back to the base height', () => {
  assert.equal(marketRowHeight(Number.NaN), 64);
  // Infinity is not a usable scale, so it is treated as absent rather than as
  // "as large as possible".
  assert.equal(marketRowHeight(Number.POSITIVE_INFINITY), 64);
});
