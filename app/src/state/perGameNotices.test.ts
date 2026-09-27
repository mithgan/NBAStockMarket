import assert from 'node:assert/strict';
import test from 'node:test';

import type { PerGameBootstrap, PerGameLedgerEntry, PerGamePosition } from '../api/contracts';
import { coversGames, isSeasonCompleteNotice, newsFirst, outcomeFirst, refreshHasNews, refreshNotice } from './perGameNotices';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
  // +1 night over a day without games: the one game night, not a span.
  const skip = snapshot('2025-10-25', '2025-10-27', 0, [], []);
  assert.equal(
    refreshNotice(skip, snapshot('2025-10-27', '2025-10-28', 112_000, [], [night('2025-10-27', 112_000)]), false),
    'Oct 27 games: your score rose $112K.',
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
    "Nov 5 games: your score rose $145K. Tyrese Maxey's short ended after 7 days: +$345K in all.",
  );
  const two = snapshot('2025-11-05', '2025-11-06', 0, [
    short('s1', 'Cade Cunningham', 'closed', 86_500),
    short('s2', 'Karl-Anthony Towns', 'closed', -310_000),
  ]);
  const twoBefore = snapshot('2025-11-04', '2025-11-05', 0, [short('s1', 'Cade Cunningham', 'active', 0), short('s2', 'Karl-Anthony Towns', 'active', 0)]);
  // Two are told apart by name, each with its whole run (walk 9 T2-08).
  assert.match(refreshNotice(twoBefore, two, false), /2 shorts ended after 7 days: Cunningham \+\$86\.5K, Towns -\$310K\.$/);
  const three = snapshot('2025-11-05', '2025-11-06', 0, [
    short('s1', 'A B', 'closed', 345_000),
    short('s2', 'C D', 'closed', -45_000),
    short('s3', 'Jaren Jackson Jr.', 'closed', 0),
  ]);
  const threeBefore = snapshot('2025-11-04', '2025-11-05', 0, [short('s1', 'A B', 'active', 0), short('s2', 'C D', 'active', 0), short('s3', 'Jaren Jackson Jr.', 'active', 0)]);
  assert.match(refreshNotice(threeBefore, three, false), /3 shorts ended after 7 days: \+\$300K in all\.$/);
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
    'Nov 5 games: your players broke even. Moves pause for the Nov 6 games.',
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
  assert.equal(refreshNotice(before, after, false, { seasonComplete: complete }), 'Season complete. Final score +$1.06M, #2\u00a0of\u00a03.');
});

test('in a short window the Roster\'s result card stands in for the season-end strip, which is still spoken (walk 14 lead, walk 13 T2-09)', () => {
  const before = snapshot('2026-04-11', '2026-04-12', 900_000);
  const after = snapshot('2026-04-12', null, 1_062_500);
  const complete = (b: PerGameBootstrap) => b.game.nextGameDate === null;
  assert.equal(isSeasonCompleteNotice(refreshNotice(before, after, false, { seasonComplete: complete })), true);
  assert.equal(isSeasonCompleteNotice('Oct 21 games: your score rose $194.5K.'), false);
  assert.equal(isSeasonCompleteNotice(null), false);
  const app = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf8');
  assert.match(app, /const cardSaysIt = noticePlacement === 'dock' && activeTab === 'portfolio' && isSeasonCompleteNotice\(message\);/);
  assert.match(app, /message && !cardSaysIt && !\(noticePlacement === 'dock' && dockWaits\) && \(noticeTone === 'problem' \|\| !sheetOpen\)/);
  // The live region still speaks the message itself.
  assert.match(app, /spoken\(authError \?\? \(message \? noticeSpoken \?\? message : null\)/);
});

test('nights played with nobody on the roster say so (walk 4 T2-16)', () => {
  const before = snapshot('2025-10-20', '2025-10-21', 0, []);
  assert.equal(
    refreshNotice(before, snapshot('2025-10-21', '2025-10-22', 0, []), false),
    'Oct 21 games: nobody on your roster, so your score held.',
  );
});

test('a narrow strip leads a games notice with its news, and leaves other notices alone (walk 14 T4-07)', () => {
  assert.equal(outcomeFirst('Oct 21–Nov 17 games (4 weeks): your score rose $1.20M.'), 'Your score rose $1.20M in the Oct 21–Nov 17 games (4 weeks).');
  assert.equal(
    outcomeFirst('Oct 21 games: your score fell $120.5K. Moves pause for the Oct 28 games.'),
    'Your score fell $120.5K in the Oct 21 games. Moves pause for the Oct 28 games.',
  );
  assert.equal(
    outcomeFirst('Oct 21–23 games (3 nights): your score rose $205K. 2 queued weeks cancelled.'),
    'Your score rose $205K in the Oct 21–23 games (3 nights). 2 queued weeks cancelled.',
  );
  // A millions figure keeps its decimal point.
  assert.equal(outcomeFirst('Oct 21–Apr 12 games (25 weeks): your score rose $4.95M.'), 'Your score rose $4.95M in the Oct 21–Apr 12 games (25 weeks).');
  for (const unchanged of [
    'Oct 21–27 games: nobody on your roster, so your score held.',
    'Oct 21 games: none of your players played.',
    'Luka Doncic added at $417.5K a game, locked in. $250 fee.',
    'Season complete. Final score +$4.95M, #1 of 5.',
  ]) assert.equal(outcomeFirst(unchanged), unchanged);
});

test('a bar narrower than a desktop\'s leads with moves that did not happen, then the figure (walk 16 T4-02, T4-09)', () => {
  // Three refused adds were cut at "…rose $205K. Devin" on a 390px phone.
  assert.equal(
    newsFirst('Oct 21–27 games: your score rose $205K. Devin Booker, Jalen Duren and OG Anunoby were not added: their prices moved to $330K, $179.1K and $166K a game.'),
    'Devin Booker, Jalen Duren and OG Anunoby were not added: their prices moved to $330K, $179.1K and $166K a game. Your score rose $205K in the Oct 21–27 games.',
  );
  // A run's refusal leads; the lock still ahead stays last.
  assert.equal(
    newsFirst('Oct 21–Nov 10 games (3 weeks): your score fell $529K. Jalen Duren was not added: moves paused for the Oct 28 games. Moves pause for the Nov 11 games.'),
    'Jalen Duren was not added: moves paused for the Oct 28 games. Your score fell $529K in the Oct 21–Nov 10 games (3 weeks). Moves pause for the Nov 11 games.',
  );
  assert.equal(
    newsFirst('Oct 21–27 games: your score fell $167.5K. Moves pause for the Oct 28 games, so Jalen Duren was not added.'),
    'Moves pause for the Oct 28 games, so Jalen Duren was not added. Your score fell $167.5K in the Oct 21–27 games.',
  );
  // With nothing refused it is the figure first, as below 300px before.
  assert.equal(newsFirst('Oct 21–Nov 10 games (3 weeks): your score fell $529K.'), 'Your score fell $529K in the Oct 21–Nov 10 games (3 weeks).');
  // A name's "Jr." is no sentence end, and other notices are left alone.
  assert.equal(
    newsFirst('Oct 21 games: your score rose $84K. Jaren Jackson Jr. was not added: his price moved to $200K a game.'),
    'Jaren Jackson Jr. was not added: his price moved to $200K a game. Your score rose $84K in the Oct 21 games.',
  );
  for (const unchanged of [
    'Luka Doncic added at $417.5K a game, locked in. $250 fee.',
    'Your roster is locked. Moves reopen after Nov 11.',
    'Season complete. Final score +$4.95M, #1 of 5.',
  ]) assert.equal(newsFirst(unchanged), unchanged);
});

test('a run\'s notice covers the notice of its own first week, and nothing else (walk 16 T4-11)', () => {
  const week = 'Oct 21–27 games: your score fell $167.5K. Moves pause for the Oct 28 games, so Jalen Duren was not added.';
  const run = 'Oct 21–Nov 10 games (3 weeks): your score fell $529K. Jalen Duren was not added: moves paused for the Oct 28 games. Moves pause for the Nov 11 games.';
  assert.equal(coversGames(run, week), true);
  assert.equal(coversGames('Oct 21–23 games (3 nights): your score rose $205K.', 'Oct 21 games: your score rose $84K.'), true);
  // Later weeks start elsewhere; a new season's first night ends before the old week did.
  assert.equal(coversGames('Oct 28–Nov 3 games: your score rose $9K.', week), false);
  assert.equal(coversGames('Oct 21 games: your score rose $84K.', week), false);
  // Across the new year: Dec 30–Jan 5 covers Dec 30.
  assert.equal(coversGames('Dec 30–Jan 5 games: your score rose $1K.', 'Dec 30 games: your score rose $1K.'), true);
  assert.equal(coversGames('Luka Doncic added at $417.5K a game, locked in. $250 fee.', week), false);
  assert.equal(coversGames(week, week), false);
});

test('the season\'s end after a run keeps its words on a phone: only a date span leads a games notice (walk 17 T1-08)', () => {
  const end = 'Season complete. Final score +$4.95M, #1 of 5. Oct 21–Apr 12 games: your score rose $4.95M.';
  assert.equal(outcomeFirst(end), end);
  assert.equal(newsFirst(end), end);
  // Spans still turn around.
  assert.equal(outcomeFirst('Oct 21–Apr 12 games (25 weeks): your score rose $4.95M.'), 'Your score rose $4.95M in the Oct 21–Apr 12 games (25 weeks).');
  assert.equal(outcomeFirst('Oct 22 games: your score fell $9K.'), 'Your score fell $9K in the Oct 22 games.');
});
