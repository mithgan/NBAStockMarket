import assert from 'node:assert/strict';
import test, { before } from 'node:test';

import {
  DOLLARS_PER_NET_POINT,
  advanceReplayDay,
  createInitialGameState,
  isGameState,
  tradePlayer,
} from '../state/game';
import { dividendEvents, players } from './snapshot';
import { playerTrends } from './trends';

const CORRUPT_PLAYER_ID = '__non_finite_test_player__';

let replayModule: typeof import('./replay') | null = null;

before(async () => {
  playerTrends[CORRUPT_PLAYER_ID] = [
    { date: '2025-10-23', np: Number.NaN, expected_np: 10, dividend_per_holder: 100 },
    { date: '2025-10-24', np: 10, expected_np: Number.POSITIVE_INFINITY, dividend_per_holder: 100 },
    { date: '2025-10-25', np: 10, expected_np: 10, dividend_per_holder: Number.NEGATIVE_INFINITY },
  ];

  try {
    replayModule = await import('./replay');
  } finally {
    delete playerTrends[CORRUPT_PLAYER_ID];
  }
});

function replay() {
  assert.ok(replayModule, 'replay module should load before tests run');
  return replayModule;
}

test('calendar dates are sorted, unique, and indexed by date', () => {
  const { replayDayByDate, replayDays } = replay();
  const dates = replayDays.map((day) => day.date);

  assert.ok(dates.length > 0);
  assert.deepEqual(dates, [...new Set(dates)].sort());
  assert.equal(Object.keys(replayDayByDate).length, dates.length);

  for (const day of replayDays) {
    assert.equal(replayDayByDate[day.date], day);
  }
});

test('day events are deterministic, finite, and unique per player and date', () => {
  const { replayDays } = replay();
  const seenEvents = new Set<string>();

  for (const day of replayDays) {
    const playerIds = day.events.map((event) => event.playerId);
    assert.deepEqual(playerIds, [...playerIds].sort());

    for (const event of day.events) {
      assert.equal(event.date, day.date);
      assert.equal(Number.isFinite(event.actualNetPoints), true);
      assert.equal(Number.isFinite(event.expectedNetPoints), true);
      assert.equal(Number.isFinite(event.dividendPerHolder), true);
      assert.ok(
        Math.abs(
          event.dividendPerHolder
          - (event.actualNetPoints - event.expectedNetPoints) * DOLLARS_PER_NET_POINT
        ) <= 1,
        `unexpected dividend rate for ${event.playerId}:${event.date}`,
      );

      const eventKey = `${event.playerId}:${event.date}`;
      assert.equal(seenEvents.has(eventKey), false, `duplicate replay event ${eventKey}`);
      seenEvents.add(eventKey);
    }
  }
});

test('non-finite source rows are not exported', () => {
  const { replayDays } = replay();
  const corruptEvents = replayDays.flatMap((day) =>
    day.events.filter((event) => event.playerId === CORRUPT_PLAYER_ID),
  );

  assert.deepEqual(corruptEvents, []);
});

test('retains the Jokic Christmas dividend source spot check', () => {
  const { replayDayByDate } = replay();
  const event = replayDayByDate['2025-12-25']?.events.find(
    (candidate) => candidate.playerId === '3112335',
  );

  assert.deepEqual(event, {
    playerId: '3112335',
    date: '2025-12-25',
    actualNetPoints: 59.35,
    expectedNetPoints: 25.97274,
    dividendPerHolder: 2670180.73,
  });
});

test('snapshot dividend examples use the selected owned-player rate', () => {
  for (const event of dividendEvents) {
    const expectedDividend = (
      event.actual_net_points - event.expected_net_points
    ) * DOLLARS_PER_NET_POINT;
    assert.ok(
      Math.abs(event.dividend_per_holder - expectedDividend) <= 5,
      `unexpected snapshot dividend rate for ${event.player_id}:${event.game_date}`,
    );
  }
});

test('weekKey matches the authoritative ISO Monday-Sunday week identifier', () => {
  const { weekKey } = replay();

  assert.equal(weekKey('2025-12-22'), '2025-W52');
  assert.equal(weekKey('2025-12-25'), '2025-W52');
  assert.equal(weekKey('2025-12-28'), '2025-W52');
  assert.equal(weekKey('2025-12-29'), '2026-W01');
  assert.equal(weekKey('2026-01-04'), '2026-W01');
});

test('nextEventForPlayer returns the first event strictly after the requested date', () => {
  const { nextEventForPlayer, replayDays } = replay();
  const jokicEvents = replayDays
    .flatMap((day) => day.events)
    .filter((event) => event.playerId === '3112335');

  assert.ok(jokicEvents.length > 1);
  assert.deepEqual(nextEventForPlayer('3112335', null), jokicEvents[0]);
  assert.deepEqual(nextEventForPlayer('3112335', jokicEvents[0].date), jokicEvents[1]);
  assert.equal(nextEventForPlayer('3112335', jokicEvents.at(-1)?.date ?? null), null);
  assert.equal(nextEventForPlayer('missing-player', null), null);
});

test('a valid high-salary roster replays through dividend volatility', () => {
  const { replayDays } = replay();
  const roster = new Set([
    'Derrick White',
    'Kevin Durant',
    'Devin Booker',
    'Dyson Daniels',
  ]);
  let state = createInitialGameState(players);

  for (const player of players.filter((candidate) => roster.has(candidate.name))) {
    const bought = tradePlayer(state, player, 'buy');
    assert.equal(bought.error, null, `could not buy ${player.name}`);
    state = bought.state;
  }

  for (let index = 0; index < replayDays.length; index += 1) {
    const day = replayDays[index];
    if (day.date > '2025-11-21') break;
    const settled = advanceReplayDay(
      state,
      day.date,
      day.events,
      replayDays[index + 1]?.date ?? null,
      players,
    );
    assert.equal(settled.error, null, `replay stalled on ${day.date}`);
    state = settled.state;
  }

  assert.equal(state.settledDates.at(-1), '2025-11-21');
  assert.equal(Number.isFinite(state.cash), true);
  assert.equal(isGameState(state), true);
});
