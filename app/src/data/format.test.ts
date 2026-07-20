import assert from 'node:assert/strict';
import test from 'node:test';

import { formatMoney, formatSignedMoney } from '../format';

test('money formatting places the sign before the currency symbol', () => {
  assert.equal(formatMoney(1_234_567.6), '$1,234,568');
  assert.equal(formatMoney(-400_000), '-$400,000');
  assert.equal(formatMoney(-0.4), '$0');
  assert.equal(formatSignedMoney(400_000), '+$400,000');
  assert.equal(formatSignedMoney(-400_000), '-$400,000');
});
