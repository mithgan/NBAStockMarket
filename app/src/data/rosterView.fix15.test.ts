import assert from 'node:assert/strict';
import test from 'node:test';

import { formatAt, perGamePrecision } from './rosterView';

test('walk 15 T1-04: one game reads the same under Profit a game and Total', () => {
  // The tester's short: Cade Cunningham, credited $391,148, paid $384,000,
  // one game. His profit a game is his total.
  const net = 7_148;
  const total = 7_148;
  const precision = perGamePrecision(net, total);
  assert.equal(formatAt(net, precision, true), '+$7.15K');
  assert.equal(formatAt(total, 'fine', true), '+$7.15K');
  // A loss the same way, and cents of drift between the two sums.
  assert.equal(formatAt(-3_251.4, perGamePrecision(-3_251.4, -3_251), true), '-$3.25K');
});

test('walk 15 T1-04: other per-game figures stay compact, as on the Market', () => {
  // Two games: $3,574 a game against a $7,148 total are two amounts.
  assert.equal(perGamePrecision(3_574, 7_148), 'compact');
  assert.equal(formatAt(3_574, perGamePrecision(3_574, 7_148), true), '+$3.6K');
  // No games yet, and figures from $10K up read alike at either precision.
  assert.equal(perGamePrecision(null, 0), 'compact');
  assert.equal(formatAt(391_148, 'compact', false), formatAt(391_148, 'fine', false));
  assert.equal(formatAt(-12_480, 'compact', true), formatAt(-12_480, 'fine', true));
});
