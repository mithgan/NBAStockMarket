import assert from 'node:assert/strict';
import test from 'node:test';

import {
  againRows,
  closedGroupSpoken,
  closeQuestion,
  earnLine,
  mergeClosedRows,
  priceAfterClose,
  SHORTS_LATER,
  stintParts,
  stintSpoken,
  valueMark,
  welcomeSteps,
  type ClosedRow,
} from './rosterView';

function closedRow(overrides: Partial<ClosedRow> = {}): ClosedRow {
  return {
    positionId: 'c1',
    playerId: 'barnes',
    name: 'Scottie Barnes',
    side: 'long',
    total: -53_400,
    games: 1,
    how: 'Dropped Oct 22',
    endedByTerm: false,
    unplayed: false,
    ...overrides,
  };
}

// Walk 11 T2-10's cycle, newest first: dropped before he played, then two played stints.
const barnes = [
  closedRow({ positionId: 'c3', total: 0, games: 0, how: 'Dropped Oct 23 before he played', unplayed: true }),
  closedRow({ positionId: 'c2' }),
  closedRow({ positionId: 'c1', total: -315_000, how: 'Dropped Oct 21' }),
];

test('walk 11 T1-11, T2-10: one Closed row per player and side, with his total and his stints', () => {
  const rows = mergeClosedRows([
    ...barnes,
    closedRow({ positionId: 's1', playerId: 'cade', name: 'Cade Cunningham', side: 'short', total: 86_500, games: 5, how: 'Short ended Oct 27', endedByTerm: true }),
    closedRow({ positionId: 'l1', playerId: 'luka', name: 'Luka Doncic', total: 12_900, how: 'Dropped after Oct 21' }),
  ]);
  assert.equal(rows.length, 3);
  const [group, cade, luka] = rows;
  // "Scottie Barnes · 3 stints · 2 games · -$368.4K": the unplayed stint counts as a stint.
  assert.equal(group.how, '3 stints');
  assert.equal(group.games, 2);
  assert.equal(group.total, -368_400);
  assert.equal(group.unplayed, false);
  assert.deepEqual(group.stints.map((stint) => stint.positionId), ['c3', 'c2', 'c1']);
  // It keeps his newest shown stint's id: Add again and "Back on your roster" find it there.
  assert.equal(group.positionId, 'c2');
  assert.deepEqual([...againRows([...barnes]).readdable], [group.positionId]);
  // A single stint reads as before.
  assert.equal(cade.how, 'Short ended Oct 27');
  assert.equal(cade.stints.length, 1);
  assert.equal(luka.how, 'Dropped after Oct 21');
});

test('walk 11 T1-11: the same player on both sides keeps a row on each; all-unplayed stays in Fees', () => {
  const rows = mergeClosedRows([
    closedRow({ positionId: 's9', side: 'short', how: 'Short closed Oct 25', total: 20_000 }),
    closedRow({ positionId: 'c9' }),
    closedRow({ positionId: 's8', side: 'short', how: 'Short closed Oct 22', total: -5_000 }),
  ]);
  assert.deepEqual(rows.map((row) => `${row.side}:${row.how}`), ['short:2 shorts', 'long:Dropped Oct 22']);
  assert.equal(rows[0].total, 15_000);
  const folded = mergeClosedRows([
    closedRow({ positionId: 'u2', total: 0, games: 0, unplayed: true, how: 'Dropped Oct 23 before he played' }),
    closedRow({ positionId: 'u1', total: 0, games: 0, unplayed: true, how: 'Dropped Oct 21 before he played' }),
  ]);
  assert.equal(folded.length, 1);
  assert.equal(folded[0].unplayed, true);
});

test('walk 11 T1-11: a merged row is heard as one sentence with the total, each stint with its figure', () => {
  const [group] = mergeClosedRows(barnes);
  assert.equal(
    closedGroupSpoken(group, '-$368.4K', 'Back on your roster since Oct 24'),
    'Scottie Barnes, 3 stints, 2 games in all: -$368.4K. Back on your roster since Oct 24',
  );
  // One stint: as walk 10 T3-04 has it.
  const [single] = mergeClosedRows([closedRow({ how: 'Dropped Oct 28 · last game Oct 27', games: 4 })]);
  assert.equal(closedGroupSpoken(single, '-$612K'), 'Scottie Barnes, dropped Oct 28 after 4 games, last game Oct 27: -$612K');
  assert.deepEqual(stintParts(barnes[1]), ['Dropped Oct 22', '1 game']);
  assert.deepEqual(stintParts(barnes[0]), ['Dropped Oct 23 before he played', 'fee in Fees']);
  assert.equal(stintSpoken(barnes[2], '-$315K'), 'Dropped Oct 21, 1 game: -$315K');
});

test('walk 11 T1-10: on a locked night the welcome leads with the step you can take', () => {
  assert.deepEqual(welcomeSteps('2025-10-28', true), [
    'Press +1 night to play Oct 28 (moves are paused)',
    'Add players from the Market',
    "Beat each player's price to score",
  ]);
  // An open night keeps walk 10's order.
  assert.equal(welcomeSteps('2025-10-21')[0], 'Add players from the Market');
});

test('walk 11 T1-01: before your first games the short side is one quiet line', () => {
  assert.equal(SHORTS_LATER, 'Shorts: bet against a player. Try after your first games.');
});

test('walk 11 T1-02: the welcome says what a net point is, in the terms Rules uses', () => {
  const line = earnLine(40_000);
  assert.match(line, /\$40K for every net point \(points, rebounds, assists, steals and blocks, minus misses, turnovers and minutes played\)\.$/);
  // Everything Rules > Scoring counts is named.
  for (const word of ['points', 'rebounds', 'assists', 'steals', 'blocks', 'misses', 'turnovers', 'minutes']) assert.match(line, new RegExp(word));
});

test('walk 11 T1-04: the chart\'s High and Low read in the score\'s own format', () => {
  // The score block shows formatAt(score, 'fine', true): "+$194.3K".
  assert.equal(valueMark('high', 194_300), 'High +$194.3K');
  assert.equal(valueMark('low', -165_140), 'Low -$165.1K');
  assert.equal(valueMark('high', 4_560_000), 'High +$4.56M');
  assert.equal(valueMark('low', -9_460), 'Low -$9.46K');
  assert.equal(valueMark('zero', 0), '$0');
});

test('walk 11 T1-05: the drop and close questions quote the comeback price the Closed row will show', () => {
  // 25 bps: a drop moves $262,050 down to $261,395, a closed short $390,200 up to $391,176.
  assert.equal(priceAfterClose('long', 262_050, 25), 261_395);
  assert.equal(priceAfterClose('short', 390_200, 25), 391_176);
  assert.equal(
    closeQuestion({ side: 'long', playerName: 'Scottie Barnes', feeDollars: 250, total: -315_000, priceNow: 262_050, dropImpactBps: 25 }),
    'Drop Scottie Barnes for a $250 fee? His -$315K stays in your score. Adding him back later costs his price at that time, '
      + 'plus another $250 fee. His price right after this drop: about $261.4K a game.',
  );
  assert.match(
    closeQuestion({ side: 'short', playerName: 'Bam Adebayo', feeDollars: 250, total: -12_500, endsFreeAfter: '2025-10-27', priceNow: 390_200, dropImpactBps: 25 }),
    /ends by itself after Oct 27, at no cost\. Shorting him again later sets a new price, plus another \$250 fee\. His price right after this close: about \$391\.2K a game\.$/,
  );
  // No impact in the ruleset: today's price; no quote: the question as before.
  assert.match(closeQuestion({ side: 'long', playerName: 'X', feeDollars: 0, total: 0, priceNow: 98_800 }), /His price today: about \$98\.8K a game\.$/);
  assert.equal(
    closeQuestion({ side: 'long', playerName: 'LeBron James', feeDollars: 0, total: 0 }),
    'Drop LeBron James? His games have not changed your score yet. Adding him back later costs his price at that time.',
  );
});
