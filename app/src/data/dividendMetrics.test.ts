import assert from 'node:assert/strict';
import test from 'node:test';

import { dividendYield, earningsWindows, marketAverageRate, settlementRecapSince, summarizeDividends } from './dividendMetrics';
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
  assert.equal(summary.paidNights, 2);
  assert.equal(summary.total, 600_000);
  assert.equal(summary.perGame, 200_000);
});

test('summarizeDividends has no rate before the first game', () => {
  const summary = summarizeDividends([]);
  assert.equal(summary.gamesPlayed, 0);
  assert.equal(summary.paidNights, 0);
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

test('earningsWindows reads tonight and the trailing week from settlements', () => {
  const settlements = [
    { game_date: '2025-11-17', current_user_dividend_cents: 32_300_000 },
    { game_date: '2025-11-15', current_user_dividend_cents: -9_900_000 },
    { game_date: '2025-11-11', current_user_dividend_cents: 50_000_000 },
    { game_date: '2025-11-10', current_user_dividend_cents: 90_000_000 }, // 8 days back
  ];
  assert.deepEqual(earningsWindows(settlements, '2025-11-17'), { tonight: 323_000, week: 724_000 });
});

test('earningsWindows ignores dates after the settled clock and empty worlds', () => {
  assert.deepEqual(earningsWindows([{ game_date: '2025-11-20', current_user_dividend_cents: 100 }], '2025-11-17'), { tonight: 0, week: 0 });
  assert.deepEqual(earningsWindows([], '2025-11-17'), { tonight: 0, week: 0 });
  assert.deepEqual(earningsWindows([{ game_date: '2025-11-17', current_user_dividend_cents: 500 }], null), { tonight: 0, week: 0 });
});

test('earningsWindows spans month boundaries correctly', () => {
  const settlements = [
    { game_date: '2025-11-01', current_user_dividend_cents: 10_000_000 },
    { game_date: '2025-10-27', current_user_dividend_cents: 5_000_000 },
    { game_date: '2025-10-25', current_user_dividend_cents: 700_000 }, // outside
  ];
  assert.deepEqual(earningsWindows(settlements, '2025-11-01'), { tonight: 100_000, week: 150_000 });
});

test('settlementRecapSince counts only authoritative settlements in range', () => {
  const settlements = [
    { game_date: '2026-01-16', current_user_dividend_cents: 99_000_000 },
    { game_date: '2026-01-14', current_user_dividend_cents: 33_100_000 },
    { game_date: '2026-01-12', current_user_dividend_cents: 16_100_000 },
  ];
  assert.deepEqual(settlementRecapSince(settlements, '2026-01-12', '2026-01-14'), { paid: 331_000, nights: 1 });
  assert.deepEqual(settlementRecapSince(settlements, null, '2026-01-14'), { paid: 492_000, nights: 2 });
  assert.deepEqual(settlementRecapSince(settlements, '2026-01-14', '2026-01-14'), { paid: 0, nights: 0 });
});
