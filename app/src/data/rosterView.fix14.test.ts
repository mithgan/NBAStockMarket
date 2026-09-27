import assert from 'node:assert/strict';
import test from 'node:test';

import { signedMoney } from '../copy/terms';
import { chromeFolded } from './chromeView';
import { axisLabelIndexes, figuresKeptWithLabels, formatAt, holdShift, placeAxisLabels, scoreArrangement, shortsQuiet, splitParts, type BreakdownPart, type NightPoint } from './rosterView';

const raw = (roster: number, fees: number, closed = 0, shorts = 0): BreakdownPart[] => [
  { key: 'roster', label: 'Roster', value: roster },
  { key: 'shorts', label: 'Shorts', value: shorts },
  { key: 'closed', label: 'Closed', value: closed },
  { key: 'fees', label: 'Fees', value: fees },
];

test('walk 14 T4-01: in season the split is never nudged, so one amount reads one figure', () => {
  // The tester's run: ten adds on Oct 20 ($2,500 in fees), five weeks. The
  // rows add up to -$2,074,000 and the games' notice says "-$2.07M"; the
  // score is -$2,076,500 ("-$2.08M").
  const run = splitParts(raw(-2_074_000, -2_500), -2_076_500);
  assert.equal(signedMoney(run.parts[0].value), '-$2.07M');
  assert.equal(signedMoney(-2_074_000), '-$2.07M');
  assert.equal(formatAt(-2_076_500, 'fine', true), '-$2.08M');
  assert.equal(run.parts[3].value, -2_500);
  // "-$2.07M" and "-$2.5K" read -$2.07M, not the score's -$2.08M: one line
  // says how, every figure in dollars.
  assert.equal(run.exact, 'Exactly -$2,076,500: roster -$2,074,000, fees -$2,500.');
});

test('walk 14 T4-09, T2-02: the exact line is all dollars, and only there when the parts as shown disagree', () => {
  // T4-09: "Exactly +$4,648,000, fees -$1.5K included." beside Roster +$4.65M:
  // the parts as shown already read +$4.65M, so there is no line.
  assert.equal(splitParts(raw(4_649_500, -1_500), 4_648_000).exact, null);
  // T2-02: Roster +$4.57M, Closed +$9.5K, Fees -$1.25K under +$4.58M add up as shown.
  const t202 = splitParts(raw(4_570_000, -1_250, 9_500), 4_578_250);
  assert.deepEqual(t202.parts.map((part) => signedMoney(part.value)), ['+$4.57M', '$0', '+$9.5K', '-$1.25K']);
  assert.equal(t202.exact, null);
  // The 853x533 season: Roster +$6.18M, fees -$500, final +$6.18M.
  assert.equal(splitParts(raw(6_181_000, -500), 6_180_500).exact, null);
  // Parts that do not read as the score: every non-zero part named, in dollars.
  const mixed = splitParts(raw(1_204_000, -2_500, -862_000), 339_500);
  assert.equal(formatAt(339_500, 'fine', true), '+$339.5K');
  assert.equal(mixed.exact, 'Exactly +$339,500: roster +$1,204,000, closed -$862,000, fees -$2,500.');
  assert.doesNotMatch(mixed.exact ?? '', /\d[KM]\b|included/);
  // Before the first game only fees: nothing to reconcile.
  assert.equal(splitParts(raw(0, -750), -750).exact, null);
});

test('walk 14 T4-01: the drawn exact line keeps each figure with its label, so a phone wraps it after a comma', () => {
  const drawn = figuresKeptWithLabels('Exactly -$2,076,500: roster -$2,074,000, fees -$2,500.');
  assert.equal(drawn, 'Exactly\u00a0-$2,076,500: roster\u00a0-$2,074,000, fees\u00a0-$2,500.');
  // The only places left to wrap are after the colon and the commas.
  assert.deepEqual(drawn.split(' '), ['Exactly\u00a0-$2,076,500:', 'roster\u00a0-$2,074,000,', 'fees\u00a0-$2,500.']);
});

test('walk 14 T1-08: a short window side by side draws the score as one tight band; phones and tall windows keep theirs', () => {
  const at = (width: number, height: number) => scoreArrangement('compact', width, chromeFolded(height, width));
  // The tester's landscape phone, and a short laptop window.
  assert.equal(at(844, 390), 'tight');
  assert.equal(at(853, 533), 'tight');
  // Tall enough: the week and rank beside the full-size score.
  assert.equal(at(1024, 768), 'beside');
  assert.equal(at(960, 600), 'beside');
  // Portrait phones stack, short or not; the desktop column and 200% zoom never go beside.
  assert.equal(at(390, 844), 'stacked');
  assert.equal(at(320, 568), 'stacked');
  assert.equal(scoreArrangement('panel', 1280, false), 'stacked');
  assert.equal(scoreArrangement('narrow', 844, true), 'stacked');
});

test('walk 14 T4-05: an open question the first night pushes down is scrolled back by as much, unless you scrolled', () => {
  // The tester's phone: Keep at y 718-762 over a 790 tab bar; the chart and
  // the tip drawn above pushed the question about 250px, under the tab bar.
  const pushed = { top: 968, previousTop: 718, height: 290, viewTop: 146, viewBottom: 790 };
  assert.equal(holdShift({ ...pushed, scrolled: false }), 250);
  // A scroll of yours in between is kept.
  assert.equal(holdShift({ ...pushed, scrolled: true }), 0);
  // A question you had scrolled out of view is left alone.
  assert.equal(holdShift({ ...pushed, previousTop: 900, top: 1150, scrolled: false }), 0);
});

test('walk 14 T1-12: day 0 keeps the one-line shorts advice whether or not the welcome is closed', () => {
  const day0 = { welcome: true, dayZero: true, seasonOver: false, openShorts: 0, hadShorts: false };
  assert.equal(shortsQuiet(day0), true);
  // The tester closed the welcome with × before any game: still the advice, no Find a short.
  assert.equal(shortsQuiet({ ...day0, welcome: false }), true);
  // From the first played night the card (and its Find a short) comes, unless the welcome is still up.
  assert.equal(shortsQuiet({ ...day0, welcome: false, dayZero: false }), false);
  assert.equal(shortsQuiet({ ...day0, dayZero: false }), true);
  // A short opened, one held before, or the season over: never the advice line.
  assert.equal(shortsQuiet({ ...day0, openShorts: 1 }), false);
  assert.equal(shortsQuiet({ ...day0, hadShorts: true }), false);
  assert.equal(shortsQuiet({ ...day0, seasonOver: true }), false);
});

test('walk 14 T2-03: one night on the chart names its start, so it reads as one step, not a long climb', () => {
  const start: NightPoint = { eventCursor: 0, cumulativePnl: 0, kind: 'start', date: null, label: 'Start', change: 0 };
  const night: NightPoint = { eventCursor: 5, cumulativePnl: -121_000, kind: 'night', date: '2025-10-21', label: 'Oct 21', change: -120_500 };
  const one = [start, night];
  assert.deepEqual(axisLabelIndexes(one, 360).map((index) => one[index].label), ['Start', 'Oct 21']);
  // Both labels fit, one at each end.
  assert.deepEqual(placeAxisLabels([0, 360], axisLabelIndexes(one, 360), 360, 56).map((label) => label.align), ['left', 'right']);
  // Fees since the night keep the date on the night; the start is still named.
  const now: NightPoint = { eventCursor: 9, cumulativePnl: -121_250, kind: 'now', date: null, label: 'Now', change: -250 };
  const withFees = [start, night, now];
  assert.deepEqual(axisLabelIndexes(withFees, 360).map((index) => withFees[index].label), ['Start', 'Oct 21']);
  // Two nights and more keep their dates only (the first night sits near the start).
  const two = [start, night, { ...night, eventCursor: 7, date: '2025-10-22', label: 'Oct 22' }];
  assert.deepEqual(axisLabelIndexes(two, 360).map((index) => two[index].label), ['Oct 21', 'Oct 22']);
});
