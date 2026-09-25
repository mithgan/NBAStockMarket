import assert from 'node:assert/strict';
import test from 'node:test';

import type { PerGameLeaderboardRow } from '../api/contracts';
import { boardPlaces, leaderStanding, sortBoard, standingLines, standingPlace, type Standing } from './leadersView';

function board(scores: Array<[string, number, boolean?]>): PerGameLeaderboardRow[] {
  return scores.map(([displayName, cumulativePnl, isCurrentUser], index) => ({
    rank: index + 1,
    entryId: `entry-${displayName}`,
    displayName,
    cumulativePnl,
    isCurrentUser: isCurrentUser === true,
  }));
}

function ranked(standing: Standing) {
  assert.equal(standing.kind, 'ranked');
  return standing as Extract<Standing, { kind: 'ranked' }>;
}

test('in the middle: the gap to the rank above and to #1', () => {
  const standing = ranked(leaderStanding(board([
    ['Ava', 1_200_000],
    ['Ben', 137_000],
    ['You', 125_000, true],
    ['Cal', -241_000],
    ['Dee', -575_000],
  ])));
  assert.equal(standing.rank, 3);
  assert.equal(standing.of, 5);
  assert.equal(standing.score, 125_000);
  assert.equal(standingPlace(standing), '#3');
  assert.deepEqual(standingLines(standing), ['$12K behind #2', '$1.1M behind #1']);
});

test('second place names #1 once', () => {
  const standing = ranked(leaderStanding(board([
    ['Ava', 1_200_000],
    ['You', 125_000, true],
    ['Cal', -241_000],
  ])));
  assert.equal(standingPlace(standing), '#2');
  assert.deepEqual(standingLines(standing), ['$1.1M behind #1']);
  assert.equal(standing.first, null);
});

test('leading alone: the margin over #2', () => {
  const standing = ranked(leaderStanding(board([
    ['You', 430_000, true],
    ['Ava', 400_000],
    ['Ben', 10_000],
  ])));
  assert.equal(standing.leading, true);
  assert.equal(standingPlace(standing), '#1');
  assert.deepEqual(standingLines(standing), ['$30K ahead of #2']);
});

test('last place still sees the next rank up and the leader', () => {
  const standing = ranked(leaderStanding(board([
    ['Ava', 395_438],
    ['Ben', 395_188],
    ['Cal', 0],
    ['Dee', -395_250],
    ['You', -395_500, true],
  ])));
  assert.equal(standingPlace(standing), '#5');
  assert.deepEqual(standingLines(standing), ['$250 behind #4', '$791K behind #1']);
});

test('a tie shares the best rank, whatever order the server listed it in', () => {
  const standing = ranked(leaderStanding(board([
    ['Ava', 900_000],
    ['Ben', 125_000],
    ['You', 125_000, true],
    ['Cal', 10_000],
  ])));
  assert.equal(standing.rank, 2);
  assert.equal(standingPlace(standing), 'Tied for #2');
  assert.deepEqual(standing.tiedWith, ['Ben']);
  assert.deepEqual(standingLines(standing), ['Level with Ben', '$775K behind #1']);
});

test('tied for the lead: who with, and the margin over the next score', () => {
  const standing = ranked(leaderStanding(board([
    ['Ava', 500_000],
    ['You', 500_000, true],
    ['Ben', 350_000],
  ])));
  assert.equal(standing.leading, true);
  assert.equal(standingPlace(standing), 'Tied for #1');
  assert.deepEqual(standingLines(standing), ['Level with Ava', '$150K ahead of #3']);
});

test('a tie above you is named by the place it holds', () => {
  const standing = ranked(leaderStanding(board([
    ['Ava', 100_000],
    ['Ben', 50_000],
    ['Cal', 50_000],
    ['You', 30_000, true],
  ])));
  assert.deepEqual(standingLines(standing), ['$20K behind #2', '$70K behind #1']);
  const topTie = ranked(leaderStanding(board([
    ['Ava', 100_000],
    ['Ben', 100_000],
    ['You', 50_000, true],
  ])));
  assert.deepEqual(standingLines(topTie), ['$50K behind #1']);
});

test('alone on the board', () => {
  const standing = ranked(leaderStanding(board([['You', -3_000, true]])));
  assert.equal(standingPlace(standing), '#1');
  assert.equal(standing.of, 1);
  assert.deepEqual(standingLines(standing), ['No one else is on the board yet.']);
});

test('not on the board, and an empty board', () => {
  const absent = leaderStanding(board([['Ava', 10], ['Ben', 5]]));
  assert.deepEqual(absent, { kind: 'absent', of: 2 });
  assert.deepEqual(standingLines(absent), ["You're not on the board yet."]);
  assert.deepEqual(leaderStanding([]), { kind: 'empty' });
  assert.deepEqual(standingLines({ kind: 'empty' }), []);
});

test('the board is shown in rank order even when the payload is not', () => {
  const rows = board([['Ava', 300], ['Ben', 200], ['You', 100, true]]).reverse();
  assert.deepEqual(sortBoard(rows).map((row) => row.displayName), ['Ava', 'Ben', 'You']);
  assert.equal(ranked(leaderStanding(rows)).rank, 3);
});

test('the list shows a tie as one shared place, matching "Tied for #2"', () => {
  const rows = board([['Ava', 900_000], ['Ben', 125_000], ['You', 125_000, true], ['Cal', 10_000]]);
  const places = boardPlaces(rows);
  assert.deepEqual(places.get('entry-Ben'), { place: 2, tied: true });
  assert.deepEqual(places.get('entry-You'), { place: 2, tied: true });
  assert.deepEqual(places.get('entry-Ava'), { place: 1, tied: false });
  assert.deepEqual(places.get('entry-Cal'), { place: 4, tied: false });
});
