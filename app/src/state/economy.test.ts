import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BASE_DIVIDEND_DOLLARS_PER_NET_POINT,
  STARTING_BANKROLL,
  WEEKLY_SHORT_DOLLARS_PER_NET_POINT,
} from './economy';

test('live presentation uses the deployed economy constants', () => {
  assert.equal(STARTING_BANKROLL, 207_824_000);
  assert.equal(BASE_DIVIDEND_DOLLARS_PER_NET_POINT, 80_000);
  assert.equal(WEEKLY_SHORT_DOLLARS_PER_NET_POINT, 40_000);
});
