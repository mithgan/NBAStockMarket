import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatCompactMoney,
  formatCompactSignedMoney,
  formatMoney,
} from './format';

test('compact money keeps market-scale values readable', () => {
  assert.equal(formatCompactMoney(34_300_000), '$34.3M');
  assert.equal(formatCompactMoney(138_000), '$138K');
  assert.equal(formatCompactMoney(999_999), '$1M');
  assert.equal(formatCompactMoney(1_250_000_000), '$1.3B');
  assert.equal(formatCompactMoney(-34_300_000), '-$34.3M');
});

test('compact signed money places the sign before the currency symbol', () => {
  assert.equal(formatCompactSignedMoney(138_000), '+$138K');
  assert.equal(formatCompactSignedMoney(-1_250_000), '-$1.3M');
  assert.equal(formatCompactSignedMoney(0), '+$0');
});

test('exact money formatting remains unchanged for transaction surfaces', () => {
  assert.equal(formatMoney(34_300_000), '$34,300,000');
});
