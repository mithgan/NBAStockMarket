import assert from 'node:assert/strict';
import test from 'node:test';

import type { PerGameLeaderboardRow } from '../api/contracts';
import { boardLag, boardList, leaderStanding, sortBoard, standingLines, standingPlace, type Standing } from './leadersView';

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
  assert.deepEqual(standingLines(standing), ['$12K behind #2', '$1.07M behind #1']);
});

test('second place names #1 once', () => {
  const standing = ranked(leaderStanding(board([
    ['Ava', 1_200_000],
    ['You', 125_000, true],
    ['Cal', -241_000],
  ])));
  assert.equal(standingPlace(standing), '#2');
  assert.deepEqual(standingLines(standing), ['$1.07M behind #1']);
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
  assert.deepEqual(standingLines(standing), ['$250 behind #4', '$790.9K behind #1']);
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

/** The list as "place name score [board note]" lines. */
function listed(entries: ReturnType<typeof boardList>): string[] {
  return entries.map((entry) => `#${entry.place}${entry.tied ? '=' : ''} ${entry.row.displayName} ${entry.score}${entry.boardScore === null ? '' : ` (board ${entry.boardScore})`}`);
}

test('the list shows a tie as one shared place, matching "Tied for #2"', () => {
  const rows = board([['Ava', 900_000], ['Ben', 125_000], ['You', 125_000, true], ['Cal', 10_000]]);
  assert.deepEqual(listed(boardList(rows, 125_000)), [
    '#1 Ava 900000',
    '#2= Ben 125000',
    '#2= You 125000',
    '#4 Cal 10000',
  ]);
  assert.deepEqual(listed(boardList(rows)), listed(boardList(rows, 125_000)), 'no account score: the board as it is');
});

test('while the board lags, your row sits at the score shown, with the board figure as a note', () => {
  // Day 0 after one add: everyone else at $0, you at -$250; the board still says $0.
  const day0 = boardList(board([['Ava', 0], ['Ben', 0], ['You', 0, true], ['Cal', 0], ['Dee', 0]]), -250);
  assert.deepEqual(listed(day0), [
    '#1= Ava 0',
    '#1= Ben 0',
    '#1= Cal 0',
    '#1= Dee 0',
    '#5 You -250 (board 0)',
  ]);
  const standing = ranked(leaderStanding(board([['Ava', 0], ['Ben', 0], ['You', 0, true], ['Cal', 0], ['Dee', 0]]), -250));
  assert.equal(standingPlace(standing), '#5', 'the headline and the list agree');

  // A score that has moved past someone takes their place in the list too.
  const passed = boardList(board([['Ava', 100_000], ['Ben', 60_000], ['You', 50_000, true], ['Cal', 10_000]]), 70_000);
  assert.deepEqual(listed(passed), ['#1 Ava 100000', '#2 You 70000 (board 50000)', '#3 Ben 60000', '#4 Cal 10000']);
});

test('gaps carry one more digit, so two different scores never read the same', () => {
  // #1 and #2 are $250 apart; rounded to $395K both gaps would look identical.
  const standing = ranked(leaderStanding(board([
    ['Ava', 395_438],
    ['Ben', 395_188],
    ['You', 0, true],
  ])));
  assert.deepEqual(standingLines(standing), ['$395.2K behind #2', '$395.4K behind #1']);
});

test('the board can lag your account score until the next games settle', () => {
  const rows = board([['Ava', 300_000], ['You', 125_000, true]]);
  assert.equal(boardLag(leaderStanding(rows, 125_000)), null, 'in step: no caption');
  assert.equal(boardLag(leaderStanding(rows)), null, 'no account score: the board is the score');
  const lagging = ranked(leaderStanding(rows, 124_750));
  assert.equal(boardLag(lagging), -250, 'a $250 fee since the last games');
  assert.equal(lagging.boardScore, 125_000);
  assert.equal(lagging.score, 124_750);
  assert.equal(boardLag({ kind: 'absent', of: 1 }), null);
  assert.equal(boardLag({ kind: 'empty' }), null);
});

test('you are placed by the score shown, not by a board row that lags it', () => {
  // Day 0: everyone at $0 on the board, and one add fee has taken you to -$250.
  const day0 = ranked(leaderStanding(board([
    ['You', 0, true], ['Ava', 0], ['Ben', 0], ['Cal', 0], ['Dee', 0],
  ]), -250));
  assert.equal(standingPlace(day0), '#5', 'last, not "Tied for #1"');
  assert.equal(day0.of, 5);
  assert.deepEqual(day0.tiedWith, []);
  assert.deepEqual(standingLines(day0), ['$250 behind #1']);
  assert.equal(boardLag(day0), -250);

  // After drops the gap is measured from the -$188.5K shown, not the board's -$187.5K.
  const afterDrops = ranked(leaderStanding(board([
    ['Ava', 100_000], ['Ben', -27_900], ['You', -187_500, true],
  ]), -188_500));
  assert.deepEqual(standingLines(afterDrops), ['$160.6K behind #2', '$288.5K behind #1']);
});

test('a score that has moved past or level with a board row takes that place', () => {
  const rows = board([['Ava', 100_000], ['Ben', 60_000], ['You', 50_000, true], ['Cal', 10_000]]);
  const passed = ranked(leaderStanding(rows, 70_000));
  assert.equal(standingPlace(passed), '#2');
  assert.deepEqual(standingLines(passed), ['$30K behind #1']);
  const level = ranked(leaderStanding(rows, 60_000));
  assert.equal(standingPlace(level), 'Tied for #2');
  assert.deepEqual(standingLines(level), ['Level with Ben', '$40K behind #1']);
  const leading = ranked(leaderStanding(rows, 150_000));
  assert.equal(standingPlace(leading), '#1');
  assert.deepEqual(standingLines(leading), ['$50K ahead of #2']);
});
