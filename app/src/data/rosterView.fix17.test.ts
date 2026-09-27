import assert from 'node:assert/strict';
import test from 'node:test';

import {
  axisLabelIndexes,
  CHART_FIRST_MIN_HEIGHT,
  lowInsideIndex,
  lowInsidePlace,
  MARK_MIN_GAP,
  placeAxisLabels,
  seasonActionFirst,
  valueTicks,
  welcomeDetails,
  whyBesideScore,
  type NightPoint,
} from './rosterView';

test('walk 17 T2-04: in any window under 720px tall Play another season sits under the final score', () => {
  // The tester's laptop windows (960x600, 853x533, 1024x700) and a small phone.
  for (const height of [600, 533, 700, 667, 390]) assert.equal(seasonActionFirst(height), true, `${height}`);
  // Taller windows keep it at the card's foot, after Best, Worst and Moves.
  for (const height of [CHART_FIRST_MIN_HEIGHT, 768, 844, 900, 1180]) assert.equal(seasonActionFirst(height), false, `${height}`);
});

test('walk 17 T1-06: "vs last season ›" is one line beside the score only where it and the widest score fit', () => {
  // The block is the window less its 16px sides. 390 and 375px phones have room.
  for (const width of [390, 375, 414, 430]) assert.equal(whyBesideScore(width - 32), true, `${width}`);
  // A 360px phone, a 320px phone and 200% zoom put it under the score instead.
  for (const width of [360, 320, 195]) assert.equal(whyBesideScore(width - 32), false, `${width}`);
});

test('walk 17 T1-07: the welcome small print is three short lines, money first, the formula left to the rules', () => {
  assert.deepEqual(welcomeDetails(40_000, 250), [
    // Walk 18 T1-02: the rate says in a few words what a net point is.
    '$40K for each net point, his box score in one number: points, rebounds and assists for him, misses and turnovers against him. A bad game can go below zero.',
    '$250 for each add or drop.',
    'Practice starts over if you reload.',
  ]);
  // No fee, no fee line; no rate, the box score in plain words.
  assert.deepEqual(welcomeDetails(40_000, 0), [welcomeDetails(40_000, 250)[0], 'Practice starts over if you reload.']);
  assert.equal(welcomeDetails(null, 250)[0], 'Each game pays out his box score. A bad game can go below zero.');
  // The net-point formula (minutes played, brackets) is not in the welcome;
  // since walk 18 T1-02 a few words say what a net point counts.
  assert.doesNotMatch(welcomeDetails(40_000, 250).join(' '), /minutes|\(/);
});

test('walk 17 T2-03: the chart says "Start" under its first point at every length, never a date', () => {
  const start: NightPoint = { eventCursor: 0, cumulativePnl: 0, kind: 'start', date: null, label: 'Start', change: 0 };
  const nights = (count: number): NightPoint[] => [start, ...Array.from({ length: count }, (_, index) => ({
    eventCursor: index + 1, cumulativePnl: -1_000 * (index + 1), kind: 'night' as const,
    date: `2025-10-${String(21 + (index % 9)).padStart(2, '0')}`, label: `N${index + 1}`, change: -1_000,
  }))];
  const spread = (series: NightPoint[], left: number, right: number) => series.map((_, index) => left + ((right - left) * index) / (series.length - 1));
  const shown = (series: NightPoint[], width: number, left = 52) => placeAxisLabels(spread(series, left, width - 6), axisLabelIndexes(series, width), width, 64).map((label) => series[label.index].label);
  // A week on a wide plot (820px): Start, the first night, the middle, the last.
  assert.deepEqual(shown(nights(7), 788), ['Start', 'N1', 'N4', 'N7']);
  // A week on the desktop column (327px): the first night is too close to the start: Start stays.
  assert.deepEqual(shown(nights(7), 327), ['Start', 'N4', 'N7']);
  // A whole season at 360px: Start, the middle and the last date.
  assert.deepEqual(shown(nights(174), 358), ['Start', 'N88', 'N174']);
  // One night: Start and its date, one at each end (walk 14 T2-03).
  assert.deepEqual(shown(nights(1), 358), ['Start', 'N1']);
  // The start's label is never a date under the $0 point.
  for (const count of [1, 2, 7, 30, 174]) {
    for (const width of [163, 327, 358, 788]) {
      const labels = placeAxisLabels(spread(nights(count), 52, width - 6), axisLabelIndexes(nights(count), width), width, 64);
      if (labels.length > 0 && labels[0].index === 0) continue;
      assert.fail(`${count} nights at ${width}px: first label is ${labels[0] ? nights(count)[labels[0].index].label : 'none'}`);
    }
  }
});

test('walk 17 T4 idea 6: a low that crowds $0 is named inside the plot, under its dip', () => {
  // The tester's season: an early dip to -$848.3K, then a climb to +$4.13M, on a 140px plot.
  const values = [0, -300_000, -848_300, -200_000, 1_000_000, 4_130_000];
  const range = (4_130_000 + 848_300) * 1.16;
  const yOf = (value: number) => 8 + ((4_130_000 + 0.08 * (4_130_000 + 848_300) - value) / range) * (140 - 16);
  const ticks = valueTicks(values, yOf, { height: 140, minGap: MARK_MIN_GAP });
  // The gutter keeps High and $0; the low gives way to "$0" there ...
  assert.deepEqual(ticks.map((tick) => tick.kind), ['high', 'zero']);
  // ... and is named under its dip instead.
  assert.equal(lowInsideIndex(values, ticks), 2);
  // A low with its own gutter mark, or no low below $0, is not named twice.
  const deep = [0, -3_000_000, 1_000_000];
  const deepY = (value: number) => 8 + ((1_000_000 - value) / 4_000_000) * 124;
  assert.equal(lowInsideIndex(deep, valueTicks(deep, deepY, { height: 140, minGap: MARK_MIN_GAP })), null);
  assert.equal(lowInsideIndex([0, 10_000, 50_000], ticks.filter((tick) => tick.kind !== 'low')), null);
  assert.equal(lowInsideIndex([], []), null);
  // Its words sit centred under the dip, or hang from the plot's edge near one.
  assert.deepEqual(lowInsidePlace(200, 96, 52, 354), { left: 152, align: 'center', width: 96 });
  assert.deepEqual(lowInsidePlace(70, 96, 52, 354), { left: 52, align: 'left', width: 96 });
  assert.deepEqual(lowInsidePlace(340, 96, 52, 354), { left: 258, align: 'right', width: 96 });
  // At 200% zoom a 161px plot with an 82px gutter has 73px: the box shrinks to it, never past the edge.
  assert.deepEqual(lowInsidePlace(108.5, 96, 82, 155), { left: 82, align: 'left', width: 73 });
});
