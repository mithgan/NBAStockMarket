import assert from 'node:assert/strict';
import test from 'node:test';

import type { ServerAdvanceResult } from '../api/contracts';
import {
  SeasonReplayError,
  settleRemainingSeason,
  type SeasonReplayProgress,
} from './seasonReplay';

function result(gameDate: string, nextGameDate: string | null): ServerAdvanceResult {
  return {
    replayed: false,
    game_date: gameDate,
    next_game_date: nextGameDate,
    is_complete: nextGameDate === null,
    event_count: 10,
    payout_count: 2,
    net_cash_cents: 500,
    cash_breakdown_cents: { dividends: 500, boosts: 0, weekly_shorts: 0 },
  };
}

test('season replay follows authoritative dates through completion', async () => {
  const dates = ['2025-10-20', '2025-10-22', '2025-10-23'];
  const requested: string[] = [];
  const progress: SeasonReplayProgress[] = [];

  const summary = await settleRemainingSeason(
    dates[0],
    async (date) => {
      requested.push(date);
      const index = dates.indexOf(date);
      return result(date, dates[index + 1] ?? null);
    },
    (update) => progress.push(update),
  );

  assert.deepEqual(requested, dates);
  assert.equal(summary.completedDates, 3);
  assert.equal(summary.lastSettledDate, '2025-10-23');
  assert.equal(summary.nextGameDate, null);
  assert.equal(progress.at(-1)?.completedDates, 3);
});

test('season replay stops on the first failure and reports saved progress', async () => {
  await assert.rejects(
    settleRemainingSeason('2025-10-20', async (date) => {
      if (date === '2025-10-20') return result(date, '2025-10-21');
      throw new Error('network failed');
    }),
    (error: unknown) => {
      assert.ok(error instanceof SeasonReplayError);
      assert.equal(error.completedDates, 1);
      assert.match(error.message, /1 game dates were saved/);
      return true;
    },
  );
});

test('season replay rejects repeated or inconsistent server clocks', async () => {
  await assert.rejects(
    settleRemainingSeason('2025-10-20', async (date) => result(date, date)),
    (error: unknown) => {
      assert.ok(error instanceof SeasonReplayError);
      assert.equal(error.completedDates, 0);
      return true;
    },
  );

  await assert.rejects(
    settleRemainingSeason('2025-10-20', async () => result('2025-10-21', null)),
    SeasonReplayError,
  );
});
