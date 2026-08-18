import assert from 'node:assert/strict';
import test from 'node:test';

import { dividendYield, marketAverageRate, summarizeDividends } from './dividendMetrics';
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
