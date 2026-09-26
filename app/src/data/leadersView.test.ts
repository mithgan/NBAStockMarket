import assert from 'node:assert/strict';
import test from 'node:test';

import type { PerGameLeaderboardRow } from '../api/contracts';
import { boardLag, boardList, closeCallNotes, feesOnly, lagLine, leaderStanding, levelOrder, ordinalWords, sortBoard, spokenLagLine, spokenPlace, spokenRanks, standingLines, standingPlace, type Standing } from './leadersView';

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
  // Day 0 after one add: everyone is level at $0 until the first games, fees or not.
  const day0 = boardList(board([['Ava', 0], ['Ben', 0], ['You', 0, true], ['Cal', 0], ['Dee', 0]]), -250);
  // You first, the rest A to Z: no order that reads as places (walk 9 T2-05).
  assert.deepEqual(listed(day0), ['#1= You 0', '#1= Ava 0', '#1= Ben 0', '#1= Cal 0', '#1= Dee 0']);
  const standing = leaderStanding(board([['Ava', 0], ['Ben', 0], ['You', 0, true], ['Cal', 0], ['Dee', 0]]), -250);
  assert.deepEqual(standing, { kind: 'level', of: 5, score: -250 }, 'no last place on a level board');

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
  // Day 0: everyone at $0 on the board. One add fee has taken you to -$250,
  // but nobody has a place yet: one sentence, and your fees as a note.
  const day0 = leaderStanding(board([
    ['You', 0, true], ['Ava', 0], ['Ben', 0], ['Cal', 0], ['Dee', 0],
  ]), -250);
  assert.equal(day0.kind, 'level');
  assert.deepEqual(standingLines(day0), ['Everyone is level at $0 until the first games']);
  assert.equal(boardLag(day0), null);

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

test('scores that read alike keep the one format and say how far apart they are', () => {
  // The walk-2 final board: "+$4.5M" twice beside #1 and #2 would look like a tie.
  const rows = board([
    ['Fast Break FC', 4_502_103],
    ['Deep Threes', 4_501_912],
    ['Glass Cleaners', 3_910_000],
    ['You', -8_160_000, true],
  ]);
  const list = boardList(rows);
  assert.deepEqual(list.map((entry) => entry.closeCalls), [
    ['$191 ahead of #2'],
    ['$191 behind #1'],
    [],
    [],
  ]);
  // No row switches to exact dollars: every entry is written the app's one way.
  assert.equal('precision' in list[0], false);
});

test('a close call in the middle of three says both gaps, and a tie gets no note', () => {
  assert.deepEqual(closeCallNotes([
    { score: 4_504_000, place: 1 },
    { score: 4_501_000, place: 2 },
    { score: 4_498_000, place: 3 },
    { score: 1_200_000, place: 4 },
  ]), [
    ['$3K ahead of #2'],
    ['$3K behind #1', '$3K ahead of #3'],
    ['$3K behind #2'],
    [],
  ]);
  // An exact tie shares its place; a different score nearby is still told apart.
  assert.deepEqual(closeCallNotes([
    { score: 245_000, place: 1 },
    { score: 245_000, place: 1 },
    { score: 244_960, place: 3 },
  ]), [['$40 ahead of #3'], ['$40 ahead of #3'], ['$40 behind #1']]);
  // Scores that already read apart need nothing.
  assert.deepEqual(closeCallNotes([{ score: 395_438, place: 1 }, { score: 395_188, place: 2 }]), [[], []]);
});

test('your row is told apart by the score shown, and a level board has no notes', () => {
  const rows = board([['Ava', 125_100], ['You', 125_000, true]]);
  assert.deepEqual(boardList(rows, 125_080).map((entry) => entry.closeCalls), [['$20 ahead of #2'], ['$20 behind #1']]);
  const level = boardList(board([['Ava', 0], ['You', 0, true]]), -250);
  assert.deepEqual(level.map((entry) => entry.closeCalls), [[], []]);
});

test('your seasons this visit: final score and place, newest first, numbered in the order played (walk 5 T2 NYI-1)', async () => {
  const { pastSeasonLines } = await import('./leadersView');
  assert.deepEqual(pastSeasonLines([]), []);
  // The session lists seasons oldest first; a practice calendar ends every season on the same day.
  const lines = pastSeasonLines([
    { score: 7_940_000, rank: '#1 of 5', finishedOn: '2026-04-12' },
    { score: -86_300, rank: '#3 of 5', finishedOn: '2026-04-12' },
    { score: 0, rank: null, finishedOn: '2026-04-12' },
  ]);
  assert.deepEqual(lines.map((line) => line.label), ['Season 3', 'Season 2', 'Season 1']);
  assert.deepEqual(lines.map((line) => line.place), [null, '#3 of 5', '#1 of 5']);
  assert.deepEqual(lines.map((line) => line.spoken), [
    'Season 3: $0',
    'Season 2: -$86.3K, third of 5',
    'Season 1: +$7.94M, first of 5',
  ]);
  // Wall-clock finish times sort newest first too.
  const clock = pastSeasonLines([
    { score: 1_000, rank: '#2 of 5', finishedOn: '2026-09-26T10:00:00Z' },
    { score: 2_000, rank: '#1 of 5', finishedOn: '2026-09-26T11:00:00Z' },
  ]);
  assert.deepEqual(clock.map((line) => line.label), ['Season 2', 'Season 1']);
});

test('your seasons this visit read safely from a session module with or without pastSeasonResults', async () => {
  const { readPastSeasons } = await import('./leadersView');
  assert.deepEqual(readPastSeasons({}), []);
  assert.deepEqual(readPastSeasons(null), []);
  assert.deepEqual(readPastSeasons({ pastSeasonResults: () => { throw new Error('storage blocked'); } }), []);
  assert.deepEqual(readPastSeasons({ pastSeasonResults: () => 'nope' }), []);
  const good = { score: 12_500, rank: '#2 of 5', finishedOn: '2026-04-12' };
  assert.deepEqual(readPastSeasons({ pastSeasonResults: () => [good, { score: 'x' }, null] }), [good]);
});

test('places are said in words, never as "#" (walk 6 T3-09, T3-07)', () => {
  assert.deepEqual([1, 2, 3, 5, 10].map(ordinalWords), ['first', 'second', 'third', 'fifth', 'tenth']);
  assert.deepEqual([11, 12, 13, 21, 22, 23, 101, 111, 112].map(ordinalWords), ['11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th', '112th']);
  assert.equal(spokenPlace(1, 5), 'First of 5');
  assert.equal(spokenPlace(2, 5, true), 'Tied for second of 5');
  assert.equal(spokenRanks('#1 of 5'), 'first of 5');
  assert.equal(spokenRanks('Tied for #2 of 5'), 'Tied for second of 5');
  assert.equal(spokenRanks('$12K behind #2'), '$12K behind second place');
  assert.equal(spokenRanks('$30K ahead of #2'), '$30K ahead of second place');
  assert.equal(spokenRanks('Level with Ava'), 'Level with Ava');
  assert.doesNotMatch(spokenRanks('$1.2M behind #14'), /#/);
});

test('a board figure that differs only by fees says why, and the row shows one figure (walk 8 T3-06)', () => {
  // The tester's case: -$121.3K your score, the board's -$121K before the $250 drop fee.
  const rows = board([['Ava', 300_000], ['Ben', 100_000], ['Cal', -50_000], ['You', -121_050, true], ['Dee', -400_000]]);
  const standing = leaderStanding(rows, -121_300);
  assert.equal(lagLine(standing, 250), "Board -$121K · your score -$121.3K: today's $250 fee joins the board after the next games.");
  assert.equal(lagLine(leaderStanding(rows, -121_550), 250), "Board -$121K · your score -$121.5K: today's $500 in fees join the board after the next games.");
  // Anything but whole fees keeps the board's own figure.
  assert.equal(lagLine(leaderStanding(rows, -121_300), 300), 'The board still has you at -$121K until the next games settle.');
  assert.equal(lagLine(leaderStanding(rows, -121_050), 250), null, 'in step: no line');
  assert.equal(feesOnly(-250, 250), 1);
  assert.equal(feesOnly(-750, 250), 3);
  assert.equal(feesOnly(250, 250), null, 'a gap above the board is not a fee');
  assert.equal(feesOnly(-250, 0), null);
  // The You row: one figure when the gap is whole fees; the note stays for anything else.
  const you = (list: ReturnType<typeof boardList>) => list.find((entry) => entry.row.isCurrentUser);
  assert.equal(you(boardList(rows, -121_300, 250))?.boardScore, null);
  assert.equal(you(boardList(rows, -121_300, 250))?.score, -121_300);
  assert.equal(you(boardList(rows, -121_300))?.boardScore, -121_050, 'no fee given: the note as before');
  assert.equal(you(boardList(rows, -121_300, 300))?.boardScore, -121_050);
});

test('the fee note names both figures, and only when they read apart (walk 9 T2-10)', () => {
  // The tester's case: +$194.25K on the board, a $250 add since: +$194K.
  const rows = board([['Ava', 203_190], ['You', 194_250, true], ['Ben', 20_000], ['Cal', -5_000], ['Dee', -90_000]]);
  const line = lagLine(leaderStanding(rows, 194_000), 250);
  assert.equal(line, "Board +$194.3K · your score +$194K: today's $250 fee joins the board after the next games.");
  assert.equal(spokenLagLine(line ?? ''), "Board +$194.3K: today's $250 fee joins the board after the next games", 'the score is said just before it');
  // A fee that leaves both figures reading "+$1.23M": nothing to compare, no note.
  const big = board([['Ava', 2_000_000], ['You', 1_234_567, true]]);
  assert.equal(lagLine(leaderStanding(big, 1_234_317), 250), null);
  // The same goes for any other gap, and for the row's own "board" note.
  assert.equal(lagLine(leaderStanding(big, 1_234_267), 300), null);
  const you = boardList(big, 1_234_267, 300).find((entry) => entry.row.isCurrentUser);
  assert.equal(you?.boardScore, null, 'a board note reading "+$1.23M" under "+$1.23M" says nothing');
  assert.equal(you?.score, 1_234_267);
});

test('a level board lists you first, then everyone else A to Z (walk 9 T2-05)', () => {
  const rows = board([['Fast Break FC', 0], ['deep Threes', 0], ['You', 0, true], ['Glass Cleaners', 0], ['Pick and Roll Club', 0]]);
  assert.deepEqual(levelOrder(rows).map((row) => row.displayName), ['You', 'deep Threes', 'Fast Break FC', 'Glass Cleaners', 'Pick and Roll Club']);
  assert.deepEqual(boardList(rows, -250, 250).map((entry) => entry.row.displayName), ['You', 'deep Threes', 'Fast Break FC', 'Glass Cleaners', 'Pick and Roll Club']);
  // Once the games settle the board's own order returns.
  const played = board([['Fast Break FC', 90_000], ['Deep Threes', 40_000], ['You', 10_000, true]]);
  assert.deepEqual(boardList(played, 10_000).map((entry) => entry.row.displayName), ['Fast Break FC', 'Deep Threes', 'You']);
});
