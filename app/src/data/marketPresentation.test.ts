import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatOwnership,
  formatSignedMetric,
  formatSignedPercent,
  formatTradeVolume,
  lineChartCoordinates,
  metricDirection,
  priceChangePercent,
  recentForm,
  smoothLinePath,
} from './marketPresentation';

test('market metrics format authoritative ownership and activity values', () => {
  assert.equal(formatOwnership(3_425), '34.3% owned');
  assert.equal(formatOwnership(100), '1% owned');
  assert.equal(formatOwnership(undefined), 'Ownership unavailable');
  assert.equal(formatTradeVolume(1), '1 trade / 30d');
  assert.equal(formatTradeVolume(18), '18 trades / 30d');
  assert.equal(formatTradeVolume(undefined), 'Activity unavailable');
});

test('price change is measured against the model opening price', () => {
  assert.equal(priceChangePercent(55, 50), 10);
  assert.equal(priceChangePercent(45, 50), -10);
  assert.equal(priceChangePercent(50, 0), null);
  assert.equal(formatSignedPercent(4.24), '+4.2%');
  assert.equal(formatSignedPercent(-4.24), '-4.2%');
  assert.equal(formatSignedPercent(-0.04), '0.0%');
  assert.equal(formatSignedMetric(2.04), '+2.0');
  assert.equal(formatSignedMetric(-0.46), '-0.5');
  assert.equal(formatSignedMetric(-0.04), '0.0');
  assert.equal(metricDirection(-0.04), 0);
  assert.equal(metricDirection(-0.05), -1);
});

test('recent form uses only the last five supplied settled games', () => {
  const points = Array.from({ length: 7 }, (_, index) => ({
    date: `2025-10-${String(index + 1).padStart(2, '0')}`,
    np: index + 2,
    expected_np: index,
    dividend_per_holder: 0,
  }));

  assert.deepEqual(recentForm(points), { games: 5, averageSurprise: 2 });
  assert.equal(recentForm([]), null);
});

test('line chart helpers produce a bounded non-empty path', () => {
  const coordinates = lineChartCoordinates([0, 100, -50, 75], 58, 32);
  const path = smoothLinePath(coordinates);

  assert.equal(coordinates.length, 4);
  assert.ok(coordinates.every((point) => point.x >= 3 && point.x <= 55));
  assert.ok(coordinates.every((point) => point.y >= 3 && point.y <= 29));
  assert.match(path, /^M 3 /);
  assert.match(path, / C /);
  assert.equal(smoothLinePath([]), '');
});
