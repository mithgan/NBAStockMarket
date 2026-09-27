import assert from 'node:assert/strict';
import test from 'node:test';

import { marketPriceWords, NIGHT_REACH_MIN, nearestIndex, outsideNights, welcomeDetails } from './rosterView';

test('walk 18 T2-04: a press in the value marks\' gutter or past the last point is on no night', () => {
  // A week on a phone: the gutter holds "$0" and "Low -$334K" left of Start.
  const xs = [60, 110, 160, 210, 260, 310, 360];
  // In the gutter, beyond half a step (25px) left of Start: no night.
  assert.equal(outsideNights(xs, 6), true);
  assert.equal(outsideNights(xs, 34), true);
  // Within half a step of Start, it still reads Start (the nearest night).
  assert.equal(outsideNights(xs, 36), false);
  assert.equal(nearestIndex(xs, 36), 0);
  // Every point and the space between points read a night.
  for (const x of [60, 85, 135, 200, 333, 360]) assert.equal(outsideNights(xs, x), false, `${x}`);
  // Past the last point by more than half a step: no night.
  assert.equal(outsideNights(xs, 384), false);
  assert.equal(outsideNights(xs, 386), true);
});

test('walk 18 T2-04: a long season\'s tight points still leave a finger\'s reach around its ends', () => {
  // 174 nights over 300px: under 2px a step, so the reach is the minimum.
  const xs = Array.from({ length: 175 }, (_, index) => 50 + (index * 300) / 174);
  assert.equal(outsideNights(xs, 50 - NIGHT_REACH_MIN + 1), false);
  assert.equal(outsideNights(xs, 50 - NIGHT_REACH_MIN - 1), true);
  assert.equal(outsideNights(xs, 350 + NIGHT_REACH_MIN - 1), false);
  assert.equal(outsideNights(xs, 350 + NIGHT_REACH_MIN + 1), true);
  // One point (Start only): only its reach reads it; no points reads nothing.
  assert.equal(outsideNights([80], 80 + NIGHT_REACH_MIN), false);
  assert.equal(outsideNights([80], 80 - NIGHT_REACH_MIN - 1), true);
  assert.equal(outsideNights([], 80), true);
});

test('walk 18 T2-02: at season end the Roster table calls his market price his last, never "now"', () => {
  assert.deepEqual(marketPriceWords('$439.5K', true), { shown: 'last $439.5K', spoken: 'his last price $439.5K a game' });
  // While the season runs, what re-adding him costs today.
  assert.deepEqual(marketPriceWords('$113.5K', false), { shown: 'now $113.5K', spoken: 'market price now $113.5K a game' });
  assert.doesNotMatch(Object.values(marketPriceWords('$439.5K', true)).join(' '), /\bnow\b/);
});

test('walk 18 T1-02: the welcome says in a few words what a net point is, in its three short lines', () => {
  const details = welcomeDetails(40_000, 250);
  assert.equal(details.length, 3);
  // Money first, then what the unit is: his box score in one number, what
  // counts for him and what against, then why a game can go below zero.
  assert.match(details[0], /^\$40K for each net point, his box score in one number: points, rebounds and assists for him, misses and turnovers against him\. A bad game can go below zero\.$/);
  assert.deepEqual(details.slice(1), ['$250 for each add or drop.', 'Practice starts over if you reload.']);
  // The exact formula (steals, blocks, minutes) stays in How scoring works.
  assert.doesNotMatch(details.join(' '), /minutes|steals|\(/);
  // Within the measured budget for 320x640 (seven lines; fix 13).
  assert.ok(details.join(' ').length <= 331);
});
