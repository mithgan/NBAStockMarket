import assert from 'node:assert/strict';
import test from 'node:test';
import { runNotice, runNoticeText, seasonEndAfterRun, withCancelledNote, withMoves, withRefusals } from './chromeView';

const weeks = (count: number) => Array.from({ length: count }, () => 'week' as const);
const END = 'Season complete. Final score +$4.13M, #2 of 5.';

test('a run of +1 week presses that plays the season out ends as Play to the end inside a run does (walk 17 T4-06)', () => {
  const text = runNoticeText({
    steps: weeks(25),
    games: 'Oct 21–Apr 12 games: your score rose $4.13M.',
    seasonEnd: END,
    note: null,
    moves: [],
    refusals: [],
  });
  assert.equal(text, 'Season complete. Final score +$4.13M, #2 of 5. Oct 21–Apr 12 games: your score rose $4.13M.');
  // Word for word what a Play to the end inside a run says.
  assert.equal(text, seasonEndAfterRun('Oct 21–Apr 12 games: your score rose $4.13M.', END));
  // Never the season's result alone, and never the queue's line.
  assert.notEqual(text, END);
  assert.ok(!/already queued/.test(text));
  // Led by the season's result: a short window's Roster still leaves it to the result card.
  assert.ok(text.startsWith('Season complete. Final score '));
});

test('a season-ending run keeps what it refused, what landed in it and a cancel, with no lock left to name', () => {
  const games = 'Oct 21–Apr 12 games: your score rose $4.13M. Moves pause for the Apr 13 games.';
  const moves = ['Luka Doncic dropped. $250 fee.'];
  const refusals = ['Devin Booker was not added: moves paused for the Oct 28 games.'];
  const text = runNoticeText({ steps: weeks(25), games, seasonEnd: END, note: 'Queued night cancelled.', moves, refusals });
  assert.equal(
    text,
    'Season complete. Final score +$4.13M, #2 of 5. Oct 21–Apr 12 games: your score rose $4.13M. Luka Doncic dropped. $250 fee. Devin Booker was not added: moves paused for the Oct 28 games. Queued night cancelled.',
  );
  assert.equal(text, withCancelledNote(seasonEndAfterRun(withRefusals(withMoves(games, moves), refusals), END), 'Queued night cancelled.'));
});

test('a run that stops before the season ends reads as before: its games with the steps it took', () => {
  const games = 'Oct 21–Nov 3 games: your score rose $353K. Moves pause for the Nov 5 games.';
  const refusals = ['Scottie Barnes was not dropped: moves paused for the Nov 5 games.'];
  const text = runNoticeText({ steps: ['week', 'week'], games, seasonEnd: null, note: null, moves: [], refusals });
  assert.equal(text, withRefusals(withMoves(withCancelledNote(runNotice(['week', 'week'], games), null), []), refusals));
  // The step count keeps its number and word together (a no-break space).
  assert.ok(text.startsWith('Oct 21–Nov 3 games (2\u00a0weeks): your score rose $353K.'));
  // A cancel still follows the games, before moves and refusals.
  assert.equal(
    runNoticeText({ steps: ['night', 'week'], games: 'Oct 21–28 games: your score rose $90K.', seasonEnd: null, note: 'Queued week cancelled.', moves: ['Luka Doncic dropped. $250 fee.'], refusals: [] }),
    'Oct 21–28 games (1\u00a0night and 1\u00a0week): your score rose $90K. Queued week cancelled. Luka Doncic dropped. $250 fee.',
  );
});
