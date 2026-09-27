import assert from 'node:assert/strict';
import test from 'node:test';
import { moreBesideSettings, rulesContentsPinned, NOTHING_QUEUED, NOTHING_QUEUED_NAME, NOTHING_TO_CANCEL, QUEUED_CANCEL_LABEL, advanceTap, advanceTapsAcross, mergeMoves, mergeRefusals, NO_ADVANCE_TAPS, runMoves, runRefusals, seasonEndAfterRun, withMoves, withRefusals } from './chromeView';

test('a Play to the end inside a run names the whole span, never the last night alone (walk 16 T2-01)', () => {
  const end = 'Season complete. Final score +$3.75M, #2 of 5.';
  const grown = seasonEndAfterRun('Oct 21–Apr 12 games: your score rose $3.75M.', end);
  assert.equal(grown, 'Season complete. Final score +$3.75M, #2 of 5. Oct 21–Apr 12 games: your score rose $3.75M.');
  // Led by the season's result, so a short window's Roster leaves it to the result card.
  assert.ok(grown.startsWith('Season complete. Final score '));
  // A finished season has no lock ahead: the run's lock sentence goes.
  assert.equal(
    seasonEndAfterRun('Oct 21–Apr 12 games: your score rose $3.75M. Moves pause for the Oct 28 games.', end),
    'Season complete. Final score +$3.75M, #2 of 5. Oct 21–Apr 12 games: your score rose $3.75M.',
  );
  // What the run refused stays with it.
  assert.equal(
    seasonEndAfterRun('Oct 21–Apr 12 games: your score rose $3.75M. Devin Booker was not added: moves paused for the Oct 28 games.', end),
    'Season complete. Final score +$3.75M, #2 of 5. Oct 21–Apr 12 games: your score rose $3.75M. Devin Booker was not added: moves paused for the Oct 28 games.',
  );
  assert.equal(seasonEndAfterRun('', end), end);
});

test('a run keeps the moves that landed in it, with their fees, before its lock (walk 16 lead note)', () => {
  const fee = '$250\u00a0fee.';
  assert.deepEqual(runMoves(`Oct 21–27 games: your score fell $458K. Luka Doncic dropped. ${fee}`), [`Luka Doncic dropped. ${fee}`]);
  assert.deepEqual(
    runMoves(`Oct 21 games: your score rose $74.5K. Shorted Cade Cunningham at $261.4K a game, locked in. ${fee} Short on Jalen Duren closed. ${fee}`),
    [`Shorted Cade Cunningham at $261.4K a game, locked in. ${fee}`, `Short on Jalen Duren closed. ${fee}`],
  );
  assert.deepEqual(runMoves(`Luka Doncic dropped. ${fee} Room made for Scottie Barnes.`), [`Luka Doncic dropped. ${fee} Room made for Scottie Barnes.`]);
  // Games, ended shorts, locks and refusals are not moves.
  assert.deepEqual(runMoves("Oct 21–27 games: your score rose $540.5K. Cade Cunningham's short ended after 7 days: +$86.5K in all. Moves pause for the Oct 28 games, so Devin Booker was not added."), []);
  // Quick moves of one kind grow into one line.
  const kept = mergeMoves([`Luka Doncic dropped. ${fee}`], ['Luka Doncic and Scottie Barnes dropped. $500\u00a0in fees.']);
  assert.deepEqual(kept, ['Luka Doncic and Scottie Barnes dropped. $500\u00a0in fees.']);
  assert.deepEqual(mergeMoves(kept, [`Devin Booker added at $336.1K a game, locked in. ${fee}`]).length, 2);
  assert.equal(
    withRefusals(withMoves('Oct 21–Nov 10 games (3 weeks): your score fell $159K. Moves pause for the Nov 11 games.', [`Luka Doncic dropped. ${fee}`]), ['Devin Booker was not added: moves paused for the Oct 28 games.']),
    `Oct 21–Nov 10 games (3 weeks): your score fell $159K. Luka Doncic dropped. ${fee} Devin Booker was not added: moves paused for the Oct 28 games. Moves pause for the Nov 11 games.`,
  );
});

test('a quick run mixing +1 week and +1 night counts every press; an isolated pair after a pause still counts once (walk 16 T4-07)', () => {
  const plays = (taps: Array<['night' | 'week', number]>) => {
    const state = { night: NO_ADVANCE_TAPS, week: NO_ADVANCE_TAPS };
    const count = { night: 0, week: 0 };
    for (const [step, at] of taps) {
      const other = step === 'night' ? 'week' : 'night';
      const before = state[step];
      const tap = advanceTap(before, at);
      const across = advanceTapsAcross(before, tap.state, state[other]);
      state[step] = across.own;
      state[other] = across.other;
      count[step] += tap.plays;
    }
    return count;
  };
  // The walk's two runs (pointerdown gaps 198/183/182/365 and 288/283/422/273 ms): 2 weeks and 3 nights.
  assert.deepEqual(plays([['week', 0], ['night', 198], ['night', 381], ['week', 563], ['night', 928]]), { night: 3, week: 2 });
  assert.deepEqual(plays([['week', 0], ['night', 288], ['night', 571], ['week', 993], ['night', 1266]]), { night: 3, week: 2 });
  // The finger moved to the other button between two quick taps: both count.
  assert.deepEqual(plays([['night', 0], ['week', 150], ['night', 300]]), { night: 2, week: 1 });
  // A pair that starts after a pause on both buttons is a double tap.
  assert.deepEqual(plays([['night', 0], ['night', 289]]), { night: 1, week: 0 });
  assert.deepEqual(plays([['week', 0], ['night', 3000], ['night', 3289]]), { night: 1, week: 1 });
  // Four steady taps on one button still count four; a bounce never counts.
  assert.deepEqual(plays([['night', 0], ['night', 290], ['night', 554], ['night', 982]]), { night: 4, week: 0 });
  assert.deepEqual(plays([['week', 0], ['night', 200], ['night', 221]]), { night: 1, week: 1 });
});

test('a run names each refused move once, a later sentence mixing verbs included (walk 16 item 9, lead)', () => {
  const jalen = runRefusals('Oct 21–27 games: your score fell $458K. Moves pause for the Oct 28 games, so Jalen Duren was not added.');
  const both = runRefusals('Oct 21–27 games: your score fell $458K. Moves pause for the Oct 28 games, so Jalen Duren was not added, and Luka Doncic was not dropped.');
  const kept = mergeRefusals(jalen, both);
  assert.deepEqual(kept, ['Jalen Duren was not added, and Luka Doncic was not dropped: moves paused for the Oct 28 games.']);
  assert.equal(
    withRefusals('Oct 21–Nov 10 games (3 weeks): your score fell $529K. Moves pause for the Nov 11 games.', kept),
    'Oct 21–Nov 10 games (3 weeks): your score fell $529K. Jalen Duren was not added, and Luka Doncic was not dropped: moves paused for the Oct 28 games. Moves pause for the Nov 11 games.',
  );
  // Refused one at a time by the same lock: one sentence, each move once.
  const luka = runRefusals('x. Moves pause for the Oct 28 games, so Luka Doncic was not dropped.');
  assert.deepEqual(mergeRefusals(mergeRefusals(jalen, luka), jalen), ['Jalen Duren was not added, and Luka Doncic was not dropped: moves paused for the Oct 28 games.']);
  // A narrower later sentence adds nothing to the wider one said first.
  assert.deepEqual(mergeRefusals(both, jalen), both);
});

test('a Cancel with nothing queued answers in the button\'s own words, as short as "Cancel queued" (walk 16 T1-10)', () => {
  assert.equal(NOTHING_QUEUED, 'Nothing queued');
  assert.ok(NOTHING_QUEUED.length <= QUEUED_CANCEL_LABEL.length + 1);
  // Its name starts with what is drawn and still says what the press meant.
  assert.equal(NOTHING_QUEUED_NAME, 'Nothing queued: nothing to cancel');
  assert.ok(NOTHING_QUEUED_NAME.endsWith(NOTHING_TO_CANCEL.toLowerCase()));
});

test('at season end a 320px phone\'s Roster keeps More beside Settings, never on a line of its own (walk 16 T4-06)', () => {
  assert.equal(moreBesideSettings(true, true, 'Roster'), true);
  // Other tabs keep "New season is in More" and More on the second line.
  assert.equal(moreBesideSettings(true, true, 'Market'), false);
  // Before the end, and in a one-line fold, nothing changes.
  assert.equal(moreBesideSettings(true, false, 'Roster'), false);
  assert.equal(moreBesideSettings(false, true, 'Roster'), false);
});

test('the Rules keep their section links pinned under the title where the sheet has room (walk 16 T2-N2)', () => {
  assert.equal(rulesContentsPinned(1440, 900), true);
  assert.equal(rulesContentsPinned(390, 844), true);
  assert.equal(rulesContentsPinned(360, 740), true);
  // A short window and a phone at 400% zoom keep them at the top of the text.
  assert.equal(rulesContentsPinned(844, 390), false);
  assert.equal(rulesContentsPinned(320, 568), false);
  assert.equal(rulesContentsPinned(98, 800), false);
});
