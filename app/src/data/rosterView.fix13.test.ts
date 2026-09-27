import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHART_FIRST_MIN_HEIGHT,
  chartAfterLists,
  closeQuestion,
  earnLine,
  SHORTS_LATER,
  splitParts,
  welcomeAgainLine,
  welcomeDetails,
  welcomeSteps,
} from './rosterView';

test('walk 13 T2-04: a short one-column window puts the chart after the lists, so the score and the players share the first view', () => {
  // The laptop windows the tester used (960x600, 853x533) and a small phone.
  for (const height of [600, 533, 667, 390]) assert.equal(chartAfterLists({ height, wide: false, seasonOver: false }), true, `${height}`);
  // Tall phones and tablets keep the chart between the score and the lists.
  for (const height of [780, 812, 844, 1024, CHART_FIRST_MIN_HEIGHT]) assert.equal(chartAfterLists({ height, wide: false, seasonOver: false }), false, `${height}`);
  // The desktop columns keep the chart beside the table, and a finished
  // season keeps it under the result card (the season's story).
  assert.equal(chartAfterLists({ height: 600, wide: true, seasonOver: false }), false);
  assert.equal(chartAfterLists({ height: 533, wide: false, seasonOver: true }), false);
});

test('walk 13 T1-04, T1-02: the welcome says there is no budget and why minutes count, in its 320px room', () => {
  // No budget, in the steps the eye takes in first; with step 3 it says what counts.
  assert.deepEqual(welcomeSteps('2025-10-21'), [
    'Add any players you like: no budget',
    'Press +1 night to play Oct 21',
    "Beat each player's price to score",
  ]);
  assert.equal(welcomeSteps('2025-10-28', true)[1], 'Add any players you like: no budget');
  const details = welcomeDetails(earnLine(40_000), 250);
  // The Rules' reason for minutes played.
  assert.match(details, /minus misses, turnovers and minutes played, so he has to produce for his minutes\)/);
  // Every earlier part is still there: the rate, below zero, the fee, the reload.
  for (const part of [/\$40K a net point/, /below zero; you pay that too/, /Each add or drop costs \$250\./, /Reloading starts over\.$/]) assert.match(details, part);
  // Measured: up to 331 characters is seven lines at 320px (as before the
  // reason joined), so the roster still shows under the welcome at 320x640.
  assert.ok(details.length <= 331, `${details.length}`);
});

test('walk 13 T1-09: a second season in the same visit opens with one line, not the first visit\'s steps', () => {
  assert.equal(welcomeAgainLine('2025-10-21'), 'Pick your players, then press +1 night to play Oct 21.');
  assert.equal(welcomeAgainLine(null), 'Pick your players, then press +1 night to play the first games.');
  // A locked opening night leads with the step you can take, as the steps do.
  assert.equal(welcomeAgainLine('2025-10-28', true), 'Press +1 night to play Oct 28; moves are paused until then.');
});

test('walk 13 T4-07, T2-05: the day-0 shorts line is advice and says where shorts are, never "not yet"', () => {
  assert.match(SHORTS_LATER, /^Shorts: bet against a player on the Market's Short side\./);
  assert.match(SHORTS_LATER, /Many fans wait a few games first\.$/);
  assert.doesNotMatch(SHORTS_LATER, /Try after|until|not yet/i);
});

test('walk 13 T4-02: at season end each part keeps its own rounding, and the exact line says how they add up', () => {
  const raw = (roster: number, fees: number) => [
    { key: 'roster' as const, label: 'Roster', value: roster },
    { key: 'shorts' as const, label: 'Shorts', value: 0 },
    { key: 'closed' as const, label: 'Closed', value: 0 },
    { key: 'fees' as const, label: 'Fees', value: fees },
  ];
  // The tester's season: the players made $7,686,500 (+$7.69M, as "They made
  // +$7.69M before fees" says), fees -$2,500, final +$7,684,000 (+$7.68M).
  const t402 = splitParts(raw(7_686_500, -2_500), 7_684_000);
  assert.equal(t402.parts[0].value, 7_690_000);
  assert.equal(t402.parts[3].value, -2_500);
  assert.equal(t402.exact, 'Exactly +$7,684,000: roster +$7,686,500, fees -$2,500.');
  // Parts that add up as shown need no line (walk 14 T4-09 retired walk 6's
  // "Exactly +$4,129,750, fees -$750 included.", which corrected nothing).
  assert.equal(splitParts(raw(4_130_500, -750), 4_129_750).exact, null);
  assert.equal(splitParts(raw(148_449, -2_250), 146_199).exact, null);
});

test('walk 13 T1-13: closing a short early asks in two sentences, the free way in the question', () => {
  const asked = closeQuestion({ side: 'short', playerName: 'Cade Cunningham', feeDollars: 250, total: 0, endsFreeAfter: '2025-10-28', priceNow: 390_100, dropImpactBps: 25 });
  assert.equal(asked, 'Close your short on Cade Cunningham now for a $250 fee, or let it end by itself after Oct 28 at no cost? '
    + 'Only its $250 fee is in your score so far; shorting him again: about $391.1K a game, plus another $250 fee.');
  assert.equal(asked.split(/(?<=[.?])\s/).length, 2);
  // With games in it, what stays in the score; with no end date, the ask leads.
  assert.equal(
    closeQuestion({ side: 'short', playerName: 'Bam Adebayo', feeDollars: 250, total: -12_500, priceNow: 390_200, dropImpactBps: 25 }),
    'Close your short on Bam Adebayo for a $250 fee? Its -$12.5K stays in your score; shorting him again: about $391.2K a game, plus another $250 fee.',
  );
  // Drops keep the shared question (the Market and the profile ask it the same way).
  assert.match(closeQuestion({ side: 'long', playerName: 'Scottie Barnes', feeDollars: 250, total: -315_000, priceNow: 262_050, dropImpactBps: 25 }), /^Drop Scottie Barnes for a \$250 fee\? His -\$315K stays in your score\./);
});
