import assert from 'node:assert/strict';
import test from 'node:test';

import type { PerGameBootstrap, PerGameLedgerEntry, PerGamePosition } from '../api/contracts';
import { refreshHasNews, refreshNotice } from './perGameNotices';

function short(positionId: string, playerName: string, status: 'active' | 'closed', cumulativePnl: number) {
  return { positionId, playerName, side: 'short', status, cumulativePnl } as PerGamePosition;
}

function night(gameDate: string, amountDollars: number): PerGameLedgerEntry {
  return {
    eventCursor: 1, entryId: `${gameDate}-${amountDollars}`, positionId: 'a', playerId: 'p', gameId: 'g',
    gameDate, resultRevision: 1, kind: 'game_dividend', amountDollars, adjustsEntryId: null,
    createdAt: `${gameDate}T23:30:00.000Z`,
  };
}

function snapshot(
  lastSettledDate: string | null,
  nextGameDate: string | null,
  cumulativePnl: number,
  positions: PerGamePosition[] = [],
  ledger: PerGameLedgerEntry[] = [],
) {
  return {
    game: { seasonId: 's', lastSettledDate, nextGameDate, eventCursor: 0 },
    account: { cumulativePnl },
    positions,
    ledger: { items: ledger, nextCursor: null },
  } as unknown as PerGameBootstrap;
}

test('newly settled games lead with what your players made over exactly those days', () => {
  const before = snapshot('2025-11-04', '2025-11-05', 100_000, [], [night('2025-11-04', 100_000)]);
  const oneNight = [night('2025-11-04', 100_000), night('2025-11-05', 323_000)];
  assert.equal(
    refreshNotice(before, snapshot('2025-11-05', '2025-11-06', 423_000, [], oneNight), false),
    'Nov 5 games: your score rose $323K.',
  );
  // A practice week: seven calendar days, games on five of them, one fee
  // booked before the week that must not be counted again.
  const fee: PerGameLedgerEntry = { ...night('2025-11-05', -250), entryId: 'fee', kind: 'open_fee', gameDate: null, createdAt: '2025-11-05T12:00:00.000Z' };
  const week = [
    night('2025-11-04', 100_000),
    fee,
    ...['2025-11-05', '2025-11-06', '2025-11-08', '2025-11-09', '2025-11-11'].map((day) => night(day, -14_000)),
  ];
  assert.equal(
    refreshNotice(before, snapshot('2025-11-11', '2025-11-12', 30_000, [], week), false),
    'Nov 5–11 games: your score fell $70K.',
  );
  // A player on the roster who had no game that night.
  const held = { positionId: 'a', playerName: 'Kon Knueppel', side: 'long', status: 'active', cumulativePnl: 100_000 } as PerGamePosition;
  const heldBefore = snapshot('2025-11-04', '2025-11-05', 100_000, [held], [night('2025-11-04', 100_000)]);
  assert.equal(
    refreshNotice(heldBefore, snapshot('2025-11-05', '2025-11-06', 100_000, [held], [night('2025-11-04', 100_000)]), false),
    'Nov 5 games: none of your players played.',
  );
});

test('a short that ran its term is named with what it made', () => {
  const before = snapshot('2025-11-04', '2025-11-05', 0, [short('s1', 'Tyrese Maxey', 'active', 200_000)]);
  const after = snapshot('2025-11-05', '2025-11-06', 345_000, [short('s1', 'Tyrese Maxey', 'closed', 345_000)], [night('2025-11-05', 145_000)]);
  assert.equal(
    refreshNotice(before, after, false),
    'Nov 5 games: your score rose $145K. Your short on Tyrese Maxey is over: it made +$345K in all, already in your score.',
  );
  const two = snapshot('2025-11-05', '2025-11-06', 0, [
    short('s1', 'A', 'closed', 345_000),
    short('s2', 'B', 'closed', -45_000),
  ]);
  const twoBefore = snapshot('2025-11-04', '2025-11-05', 0, [short('s1', 'A', 'active', 0), short('s2', 'B', 'active', 0)]);
  assert.match(refreshNotice(twoBefore, two, false), /2 shorts are over: they made \+\$300K in all, already in your score\.$/);
});

test('a score that moved without new games is reported as a change', () => {
  const before = snapshot('2025-11-05', '2025-11-06', 100_000);
  assert.equal(
    refreshNotice(before, snapshot('2025-11-05', '2025-11-06', 300_000), false),
    'Your score changed by +$200K since the last update.',
  );
});

test('a refresh with nothing new confirms the account is current', () => {
  const same = snapshot('2025-11-05', '2025-11-06', 100_000);
  assert.equal(refreshNotice(same, same, false), "You're up to date. Next games Thu, Nov 6.");
  assert.equal(
    refreshNotice(same, snapshot('2025-11-05', null, 100_000), false),
    "You're up to date. The next games are not scheduled yet.",
  );
  assert.equal(refreshHasNews(same, same), false);
  assert.equal(refreshHasNews(same, snapshot('2025-11-05', '2025-11-06', 90_000)), true);
  assert.equal(refreshHasNews(same, snapshot('2025-11-06', '2025-11-07', 100_000)), true);
});

test('reconciliation keeps its own message', () => {
  const same = snapshot('2025-11-05', '2025-11-06', 100_000);
  assert.equal(
    refreshNotice(same, same, true),
    'Your account is back in sync. You can make roster moves again.',
  );
});

test('a night that breaks even says so, and a new roster lock is announced', () => {
  const before = snapshot('2025-11-04', '2025-11-05', 0, [], []);
  const even = snapshot('2025-11-05', '2025-11-06', 0, [], [night('2025-11-05', 50_000), night('2025-11-05', -50_000)]);
  assert.equal(refreshNotice(before, even, false), 'Nov 5 games: your players broke even.');
  const locked = { ...even, ruleset: { rosterMutationsLocked: true, rosterLockGameDate: '2025-11-06' } } as unknown as PerGameBootstrap;
  assert.equal(
    refreshNotice(before, locked, false),
    'Nov 5 games: your players broke even. Roster moves pause for the Nov 6 games.',
  );
});

test('the last night of the season announces the final result', () => {
  const before = snapshot('2026-04-11', '2026-04-12', 900_000);
  const after = {
    ...snapshot('2026-04-12', null, 1_062_500),
    leaderboard: [
      { rank: 1, entryId: 'a', displayName: 'Fast Break FC', cumulativePnl: 2_000_000, isCurrentUser: false },
      { rank: 2, entryId: 'b', displayName: 'You', cumulativePnl: 1_062_500, isCurrentUser: true },
      { rank: 3, entryId: 'c', displayName: 'Deep Threes', cumulativePnl: -5_000, isCurrentUser: false },
    ],
  } as unknown as PerGameBootstrap;
  const complete = (b: PerGameBootstrap) => b.game.nextGameDate === null;
  assert.equal(refreshNotice(before, after, false, { seasonComplete: complete }), 'Season complete. Final score +$1.06M, #2 of 3.');
});

test('nights played with nobody on the roster say so (walk 4 T2-16)', () => {
  const before = snapshot('2025-10-20', '2025-10-21', 0, []);
  assert.equal(
    refreshNotice(before, snapshot('2025-10-21', '2025-10-22', 0, []), false),
    'Oct 21 games: nobody was on your roster, so your score did not move.',
  );
});
