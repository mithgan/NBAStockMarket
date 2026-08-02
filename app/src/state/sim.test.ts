import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addDays,
  clampToSeason,
  clipTrends,
  collectDividends,
  daysBetween,
  seasonDayNumber,
  seasonProgress,
  SEASON_END,
  SEASON_TOTAL_DAYS,
  SIM_START,
} from './sim';

const trends = {
  jokic: [
    { date: '2025-10-21', np: 30, expected_np: 25, dividend_per_holder: 200_000 },
    { date: '2025-10-25', np: 20, expected_np: 26, dividend_per_holder: -240_000 },
    { date: '2025-11-02', np: 40, expected_np: 27, dividend_per_holder: 520_000 },
  ],
  wemby: [
    { date: '2025-10-25', np: 35, expected_np: 24, dividend_per_holder: 440_000 },
  ],
};

const holdings = [
  { player_id: 'jokic', shares: 1 as const, average_price: 50_000_000 },
  { player_id: 'wemby', shares: 1 as const, average_price: 47_000_000 },
];

test('calendar math is UTC-safe and season bounds hold', () => {
  assert.equal(addDays('2025-10-20', 1), '2025-10-21');
  assert.equal(addDays('2025-12-31', 1), '2026-01-01');
  assert.equal(daysBetween(SIM_START, SEASON_END), SEASON_TOTAL_DAYS);
  assert.equal(clampToSeason('2020-01-01'), SIM_START);
  assert.equal(clampToSeason('2030-01-01'), SEASON_END);
  assert.equal(seasonDayNumber(SIM_START), 0);
  assert.equal(seasonProgress(SEASON_END), 1);
});

test('collecting a window credits only games inside (from, to]', () => {
  const first = collectDividends(holdings, trends, SIM_START, '2025-10-21');
  assert.equal(first.total, 200_000);
  assert.equal(first.events.length, 1);

  const week = collectDividends(holdings, trends, '2025-10-21', '2025-10-28');
  assert.equal(week.total, 440_000 - 240_000);
  assert.equal(week.events.length, 2);

  const nothing = collectDividends(holdings, trends, '2025-11-03', SEASON_END);
  assert.equal(nothing.total, 0);
  assert.equal(nothing.events.length, 0);
});

test('collection only pays held players and sorts newest first', () => {
  const jokicOnly = collectDividends([holdings[0]], trends, SIM_START, SEASON_END);
  assert.equal(jokicOnly.total, 200_000 - 240_000 + 520_000);
  const all = collectDividends(holdings, trends, SIM_START, SEASON_END);
  assert.deepEqual(
    all.events.map((event) => event.date),
    ['2025-11-02', '2025-10-25', '2025-10-25', '2025-10-21'],
  );
});

test('clipTrends hides games after the sim date', () => {
  assert.equal(clipTrends(trends.jokic, '2025-10-24').length, 1);
  assert.equal(clipTrends(trends.jokic, SEASON_END).length, 3);
  assert.equal(clipTrends(trends.jokic, SIM_START).length, 0);
});
