import assert from 'node:assert/strict';
import test from 'node:test';

import { executeTrade, initialPortfolioState } from './portfolio';

const jokic = {
  id: '3112335',
  name: 'Nikola Jokic',
  tier: 'star' as const,
  listing_price: 57_985_817,
  actual_salary: 59_033_114,
};

test('buying the same player twice is blocked at one share', () => {
  const first = executeTrade(initialPortfolioState, jokic, 'buy');
  assert.equal(first.error, null);
  assert.equal(first.state.holdings.length, 1);

  const second = executeTrade(first.state, jokic, 'buy');
  assert.equal(second.error, 'One share per player maximum');
  assert.deepEqual(second.state, first.state);
});

test('buying is blocked when cash is below the listing price', () => {
  const result = executeTrade(
    { cash: 1_000, holdings: [] },
    jokic,
    'buy',
  );

  assert.equal(result.error, 'Not enough cash');
  assert.equal(result.state.cash, 1_000);
});
