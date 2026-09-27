import assert from 'node:assert/strict';
import test from 'node:test';

import type { PerGameLedgerEntry } from '../api/contracts';
import { buildPnlSeries } from '../state/perGameState';
import {
  axisLabelIndexes,
  chartSummary,
  chartValueText,
  formatAt,
  holdShift,
  nightReadingParts,
  NOW_STEP,
  nightlySeries,
  plotXs,
  valueMark,
  valueTicks,
  weekStepIndex,
} from './rosterView';

let cursor = 0;
function entry(overrides: Partial<PerGameLedgerEntry>): PerGameLedgerEntry {
  cursor += 1;
  return {
    eventCursor: cursor,
    entryId: `e${cursor}`,
    positionId: 'luka',
    playerId: 'luka',
    gameId: null,
    gameDate: null,
    resultRevision: null,
    kind: 'open_fee',
    amountDollars: -250,
    adjustsEntryId: null,
    createdAt: '2025-10-20T23:45:00.000Z',
    ...overrides,
  };
}

function game(date: string, positionId: string, cost: number, dividend: number): PerGameLedgerEntry[] {
  const gameId = `${positionId}-${date}`;
  return [
    entry({ positionId, playerId: positionId, gameId, gameDate: date, resultRevision: 1, kind: 'game_cost', amountDollars: -cost }),
    entry({ positionId, playerId: positionId, gameId, gameDate: date, resultRevision: 1, kind: 'game_dividend', amountDollars: dividend }),
  ];
}

const fee = (kind: 'open_fee' | 'drop_fee', positionId: string, day: string) => (
  entry({ kind, positionId, playerId: positionId, createdAt: `${day}T23:45:00.000Z` })
);

/**
 * Walk 12 T2-07 / T4-03: add Luka and Barnes, play Oct 21 and Oct 22, drop
 * Barnes, play Oct 23 (none of your players played: no ledger entries), then
 * drop and add Luka again. Four fees after the last night your players played.
 */
function seasonWithFeesOnAnEmptyNight(): PerGameLedgerEntry[] {
  cursor = 0;
  return [
    fee('open_fee', 'luka', '2025-10-20'),
    fee('open_fee', 'barnes', '2025-10-20'),
    ...game('2025-10-21', 'luka', 400_000, 520_000),
    ...game('2025-10-21', 'barnes', 250_000, 50_000),
    ...game('2025-10-22', 'luka', 400_000, 350_000),
    ...game('2025-10-22', 'barnes', 250_000, 220_000),
    fee('drop_fee', 'barnes', '2025-10-22'),
    // Oct 23 plays: no game for Luka, so nothing is booked.
    fee('drop_fee', 'luka', '2025-10-23'),
    fee('open_fee', 'luka', '2025-10-23'),
  ];
}

const scoreOf = (entries: readonly PerGameLedgerEntry[]) => entries.reduce((sum, item) => sum + item.amountDollars, 0);

test('the score chart ends on the score when fees were paid around a night none of your players played (walk 12 T2-07, T4-03)', () => {
  const entries = seasonWithFeesOnAnEmptyNight();
  const score = scoreOf(entries);
  assert.equal(score, -161_250);
  const series = nightlySeries(buildPnlSeries(entries), entries);
  // Every point is drawn: the last one is the score, not the last night's.
  assert.deepEqual(series.map((point) => point.kind), ['start', 'night', 'night', 'now']);
  assert.equal(series.at(-1)!.cumulativePnl, score);
  assert.equal(series.at(-1)!.change, -750);
  assert.equal(series[2].cumulativePnl, score + 750);
  // The step of fees never takes the last date: Oct 22 stays the axis's end.
  assert.deepEqual(axisLabelIndexes(series, 360).map((index) => series[index].label), ['Start', 'Oct 21', 'Oct 22']);
  // Unselected, the slider reads the end of the line: the score.
  assert.equal(chartValueText(series, null), `After Oct 22: fees -$750, score ${formatAt(score, 'fine', true)}`);
});

test('the drawn Low is the spoken lowest, and the fees since the last night are said (walk 12 T3-08)', () => {
  const entries = seasonWithFeesOnAnEmptyNight();
  const score = scoreOf(entries);
  const series = nightlySeries(buildPnlSeries(entries), entries);
  const values = series.map((point) => point.cumulativePnl);
  const low = valueTicks(values, (value) => -value / 1_000, { minGap: 0 }).find((tick) => tick.kind === 'low')!;
  assert.equal(low.value, score);
  const drawn = valueMark('low', low.value);
  const summary = chartSummary(series);
  assert.equal(drawn, `Low ${formatAt(score, 'fine', true)}`);
  assert.ok(summary.includes(`lowest ${drawn.slice('Low '.length)} now.`), summary);
  assert.ok(summary.includes(`now ${formatAt(score, 'fine', true)} after $750 in fees since Oct 22.`), summary);
});

test('once the next night plays, the fees join its point and the line still ends on the score', () => {
  const entries = [...seasonWithFeesOnAnEmptyNight(), ...game('2025-10-24', 'luka', 400_000, 460_000)];
  const score = scoreOf(entries);
  const series = nightlySeries(buildPnlSeries(entries), entries);
  assert.deepEqual(series.map((point) => point.label), ['Start', 'Oct 21', 'Oct 22', 'Oct 24']);
  assert.equal(series.at(-1)!.cumulativePnl, score);
  // Its reading carries the fees paid since Oct 22, the empty Oct 23 included.
  assert.deepEqual(nightReadingParts(series[3], series[2]), { when: 'Fri, Oct 24', fees: -750 });
  assert.doesNotMatch(chartSummary(series), /fees since/);
});

test('an opened Closed row stays under the finger when the lists above it change, never undoing a scroll (fix 12 check)', () => {
  // 390x844: the list shows 146..793; the row sat at 653 (173 tall).
  const view = { viewTop: 146, viewBottom: 793, height: 173 };
  // A waiting drop lands: Luka's Closed row (+) replaces his roster row (-), net +16.
  assert.equal(holdShift({ ...view, previousTop: 653, top: 669, scrolled: false }), 16);
  // Chrome's own anchoring had scrolled it 87px on top of that: all of it is given back.
  assert.equal(holdShift({ ...view, previousTop: 653, top: 756, scrolled: false }), 103);
  // A scroll of yours since the last look is kept, whatever else moved.
  assert.equal(holdShift({ ...view, previousTop: 653, top: 533, scrolled: true }), 0);
  // A row scrolled out of sight never moves the list you are looking at.
  assert.equal(holdShift({ ...view, previousTop: 900, top: 916, scrolled: false }), 0);
  assert.equal(holdShift({ ...view, previousTop: -200, top: -184, scrolled: false }), 0);
  // Less than a pixel is no move.
  assert.equal(holdShift({ ...view, previousTop: 653, top: 653.4, scrolled: false }), 0);
});

test('the step of fees sits a short way after the last night, or a night apart when nights are closer', () => {
  const entries = seasonWithFeesOnAnEmptyNight();
  const series = nightlySeries(buildPnlSeries(entries), entries);
  const xs = plotXs(series, 50, 300);
  assert.equal(xs[0], 50);
  assert.equal(xs.at(-1), 350);
  // The last night keeps the right side; the fees are a short step past it.
  assert.equal(xs.at(-1)! - xs[2], NOW_STEP);
  assert.equal(xs[1] - xs[0], xs[2] - xs[1]);
  // No fees since the last night: nights spread over the whole span.
  const nightsOnly = series.slice(0, 3);
  assert.deepEqual(plotXs(nightsOnly, 0, 300), [0, 150, 300]);
  // Many nights: the step is never wider than a night's spacing.
  const many = [...Array.from({ length: 40 }, () => series[1]), series.at(-1)!];
  const manyXs = plotXs(many, 0, 200);
  const spacing = manyXs[1] - manyXs[0];
  assert.ok(Math.abs((manyXs.at(-1)! - manyXs.at(-2)!) - spacing) < 1e-9);
  // Page Down from the step goes a week back from the last night.
  assert.equal(weekStepIndex(series, 3, -1), 0);
});
