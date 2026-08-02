import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addIsoDays,
  daysBetween,
  SEASON_TOTAL_DAYS,
  seasonDayNumber,
  seasonProgress,
  SIM_START,
} from './simDates';

test('season calendar math is UTC-safe and clamped to the season', () => {
  assert.equal(addIsoDays('2025-10-31', 1), '2025-11-01');
  assert.equal(addIsoDays('2025-12-28', 7), '2026-01-04');
  assert.equal(daysBetween('2025-10-20', '2025-10-21'), 1);
  assert.equal(SEASON_TOTAL_DAYS, 174);

  assert.equal(seasonDayNumber(SIM_START), 0);
  assert.equal(seasonDayNumber('2025-10-21'), 1);
  assert.equal(seasonDayNumber(null), SEASON_TOTAL_DAYS);
  assert.equal(seasonDayNumber('2024-01-01'), 0);
  assert.equal(seasonDayNumber('2027-01-01'), SEASON_TOTAL_DAYS);

  assert.equal(seasonProgress(null), 1);
  assert.equal(seasonProgress(SIM_START), 0);
});
