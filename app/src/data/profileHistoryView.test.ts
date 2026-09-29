import assert from 'node:assert/strict';
import test from 'node:test';

import type { HistoricalGame } from './playerHistory';
import { historyGameLabel, historyPointsChart, historySeasonView } from './profileHistoryView';

// Test inputs exercise display math; product history comes from the Databallr API.
function game(overrides: Partial<HistoricalGame> = {}): HistoricalGame {
  return {
    gameId: 'test-game', date: '2024-10-22', opponent: 'NYK', venue: 'home',
    minutes: 30, points: 20, rebounds: 8, assists: 5, ...overrides,
  };
}

test('empty history has no averages, extrema or chart', () => {
  assert.deepEqual(historySeasonView([]), {
    games: [], gameCount: 0, averages: null, lowPoints: null, highPoints: null,
  });
  assert.equal(historyPointsChart([], 288, 160), null);
});

test('every played game contributes, including zero points and fractional minutes', () => {
  const view = historySeasonView([
    game({ gameId: 'first', points: 0, minutes: 12.5, rebounds: 1, assists: 0 }),
    game({ gameId: 'second', date: '2024-10-24', points: 25, minutes: 35, rebounds: 12, assists: 9 }),
    game({ gameId: 'third', date: '2024-10-26', points: 23, minutes: 32, rebounds: 7, assists: 8 }),
  ]);
  assert.equal(view.gameCount, 3);
  assert.deepEqual(view.averages, { points: 16, rebounds: 20 / 3, assists: 17 / 3, minutes: 26.5 });
  assert.equal(view.averages?.rebounds.toFixed(1), '6.7');
  assert.equal(view.averages?.assists.toFixed(1), '5.7');
  assert.equal(view.lowPoints, 0);
  assert.equal(view.highPoints, 25);
});

test('history is chronological across years without mutating the source', () => {
  const games = Object.freeze([
    game({ gameId: 'last', date: '2025-04-13' }),
    game({ gameId: 'first', date: '2024-10-22' }),
    game({ gameId: 'middle', date: '2025-01-01' }),
  ]);
  assert.deepEqual(historySeasonView(games).games.map((item) => item.gameId), ['first', 'middle', 'last']);
  assert.deepEqual(games.map((item) => item.gameId), ['last', 'first', 'middle']);
});

test('a single zero-point game keeps a visible scale and a centered point', () => {
  const chart = historyPointsChart([game({ points: 0 })], 288, 160);
  assert.ok(chart);
  assert.equal(chart.maxPoints, 10);
  assert.equal(chart.points.length, 1);
  assert.equal(chart.points[0].x, (chart.left + chart.right) / 2);
  assert.equal(chart.points[0].y, chart.bottom);
  assert.equal(chart.averageY, chart.bottom);
  assert.ok(Number.isFinite(chart.points[0].x));
  assert.ok(Number.isFinite(chart.points[0].y));
});

test('the chart projects all games and the exact average on the same zero-based scale', () => {
  const chart = historyPointsChart([
    game({ gameId: 'last', date: '2025-04-13', points: 41 }),
    game({ gameId: 'first', points: 0 }),
    game({ gameId: 'middle', date: '2025-01-01', points: 19 }),
  ], 500, 180);
  assert.ok(chart);
  assert.equal(chart.maxPoints, 50);
  assert.deepEqual(chart.points.map((point) => point.game.gameId), ['first', 'middle', 'last']);
  assert.equal(chart.points[0].x, chart.left);
  assert.equal(chart.points[2].x, chart.right);
  assert.equal(chart.points[0].y, chart.bottom);
  assert.equal(chart.averageY, chart.bottom - (20 / 50) * (chart.bottom - chart.top));
  for (const point of chart.points) {
    assert.ok(point.x >= chart.left && point.x <= chart.right);
    assert.ok(point.y >= chart.top && point.y <= chart.bottom);
  }
});

test('collapsed, negative and non-finite chart dimensions do not generate invalid SVG', () => {
  for (const [width, height] of [[0, 160], [-1, 160], [288, -1], [10, 10], [NaN, 160], [288, Infinity]]) {
    assert.equal(historyPointsChart([game()], width, height), null);
  }
});

test('game readouts preserve the calendar date and distinguish away opponents', () => {
  assert.equal(historyGameLabel(game()), 'Oct 22, 2024 · vs NYK');
  assert.equal(historyGameLabel(game({ date: '2025-03-09', venue: 'away', opponent: 'LAL' })), 'Mar 9, 2025 · at LAL');
  assert.equal(historyGameLabel(game({ venue: null, opponent: null })), 'Oct 22, 2024');
  assert.equal(historyGameLabel(game({ venue: null, opponent: 'LAL' })), 'Oct 22, 2024 · LAL');
});
