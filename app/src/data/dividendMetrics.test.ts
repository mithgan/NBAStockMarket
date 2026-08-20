import assert from 'node:assert/strict';
import test from 'node:test';

import { dividendYield, marketAverageRate, settlementRecapSince, summarizeDividends } from './dividendMetrics';
import type { TrendPoint } from './trendPresentation';

function night(date: string, dividend: number): TrendPoint {
  return { date, np: 20, expected_np: 20, dividend_per_holder: dividend };
}

test('summarizeDividends reads rate, exposure, and total from settled rows', () => {
  const summary = summarizeDividends([
    night('2025-11-01', 400_000),
    night('2025-11-03', -100_000),
    night('2025-11-05', 300_000),
  ]);
  assert.equal(summary.gamesPlayed, 3);
  assert.equal(summary.total, 600_000);
  assert.equal(summary.perGame, 200_000);
});

test('summarizeDividends has no rate before the first game', () => {
  const summary = summarizeDividends([]);
  assert.equal(summary.gamesPlayed, 0);
  assert.equal(summary.total, 0);
  assert.equal(summary.perGame, null);
});

test('a negative window keeps its sign — no clamping at zero', () => {
  const summary = summarizeDividends([night('2025-11-01', -250_000)]);
  assert.equal(summary.total, -250_000);
  assert.equal(summary.perGame, -250_000);
});

test('dividendYield is total over price', () => {
  assert.equal(dividendYield(500_000, 50_000_000), 0.01);
  assert.equal(dividendYield(-500_000, 50_000_000), -0.01);
});

test('dividendYield refuses prices that cannot carry one', () => {
  assert.equal(dividendYield(500_000, 0), null);
  assert.equal(dividendYield(500_000, -5), null);
  assert.equal(dividendYield(500_000, Number.NaN), null);
});

test('marketAverageRate averages per-game rates, skipping unplayed players', () => {
  const average = marketAverageRate([
    [night('2025-11-01', 200_000), night('2025-11-02', 400_000)], // rate 300K
    [night('2025-11-01', 100_000)], // rate 100K
    [], // never played — excluded, not counted as zero
  ]);
  assert.equal(average, 200_000);
});

test('marketAverageRate is null when nobody has played', () => {
  assert.equal(marketAverageRate([[], []]), null);
  assert.equal(marketAverageRate([]), null);
});

test('settlementRecapSince sums only dated entries after the cutoff', () => {
  const activity = [
    { game_date: null, amount_cents: -5_180_000_000 }, // a trade — never counted
    { game_date: '2025-11-08', amount_cents: 35_100_000 },
    { game_date: '2025-11-08', amount_cents: -2_000_000 },
    { game_date: '2025-11-07', amount_cents: 16_100_000 },
    { game_date: '2025-11-05', amount_cents: 67_200_000 },
  ];
  assert.deepEqual(settlementRecapSince(activity, '2025-11-07'), { paid: 331_000, nights: 1 });
  assert.deepEqual(settlementRecapSince(activity, '2025-11-05'), { paid: 492_000, nights: 2 });
  assert.deepEqual(settlementRecapSince(activity, null), { paid: 1_164_000, nights: 3 });
});

test('settlementRecapSince reports quiet spans as zero nights', () => {
  assert.deepEqual(settlementRecapSince([], null), { paid: 0, nights: 0 });
  assert.deepEqual(
    settlementRecapSince([{ game_date: '2025-11-01', amount_cents: 100 }], '2025-11-01'),
    { paid: 0, nights: 0 },
  );
});
