import assert from 'node:assert/strict';
import test from 'node:test';

import {
  executeTrade,
  getPortfolioSummary,
  getPurchaseShortfall,
  initialPortfolioState,
  rankLeaderboard,
} from './portfolio';

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

test('purchase shortfall reports affordability and exact cash needed', () => {
  assert.equal(getPurchaseShortfall(58_000_000, jokic.listing_price), 0);
  assert.equal(getPurchaseShortfall(50_000_000, jokic.listing_price), 7_985_817);
});

test('live You row reflects a purchased holding and re-ranks against rivals', () => {
  const purchase = executeTrade(initialPortfolioState, jokic, 'buy');
  const repricedJokic = { ...jokic, listing_price: 90_000_000 };
  const summary = getPortfolioSummary(purchase.state, [repricedJokic]);
  const ranked = rankLeaderboard(
    [
      { name: 'Top Rival', value: 168_000_000, returnPct: 20 },
      { name: 'Second Rival', value: 161_000_000, returnPct: 15 },
    ],
    summary.total_value,
  );

  assert.equal(summary.total_value, 172_014_183);
  assert.deepEqual(ranked[0], {
    rank: 1,
    name: 'You',
    value: 172_014_183,
    returnPct: (172_014_183 / 140_000_000 - 1) * 100,
  });
  assert.equal(ranked[1].name, 'Top Rival');
  assert.equal(ranked[1].rank, 2);
});
