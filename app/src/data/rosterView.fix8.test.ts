import assert from 'node:assert/strict';
import test from 'node:test';

import { resultSpan } from './chromeView';
import { belowZeroNote, BELOW_ZERO_WELCOME, chartValueText, pressLine, tipSide, tipWords } from './rosterView';

test('the score block names the games the last press played, as the status row does (walk 8 T2-01)', () => {
  // +1 night after a week: the night alone, not a rolling Oct 24-30.
  const night = resultSpan([{ step: 'night', from: '2025-10-29' }], '2025-10-30');
  assert.deepEqual(pressLine(night, -40_500), { label: 'Oct 30 games', spoken: 'Oct 30 games', value: -40_500 });
  // A run of two weeks: the whole run, from where it started.
  const run = resultSpan([{ step: 'week', from: '2025-11-03', runFrom: '2025-10-27' }], '2025-11-10');
  assert.deepEqual(pressLine(run, 96_000), { label: 'Oct 28–Nov 10 games', spoken: 'Oct 28 to Nov 10 games', value: 96_000 });
  // +1 week: its seven days.
  const week = resultSpan([{ step: 'week', from: '2025-10-20' }], '2025-10-27');
  assert.equal(pressLine(week, 1)?.label, 'Oct 21–27 games');
  // Nothing settled: no line.
  assert.equal(pressLine(null, null), null);
  assert.equal(pressLine(resultSpan([], null), 0), null);
});

test('a below-zero dividend is explained on its row, for either side (walk 8 T1-01)', () => {
  assert.equal(belowZeroNote('long', { games: 1, avgDividend: -56_000 }), 'Bad night: below zero, so you paid his price and $56K more.');
  assert.equal(
    belowZeroNote('long', { games: 3, avgDividend: -12_500 }),
    'Bad games: below zero on average, so you paid his price and $12.5K more a game.',
  );
  assert.match(belowZeroNote('short', { games: 1, avgDividend: -56_000 }) ?? '', /^Bad night for him: below zero, so you kept his price and \$56K more\.$/);
  // Nothing to explain at or above zero, or before a game.
  assert.equal(belowZeroNote('long', { games: 1, avgDividend: 0 }), null);
  assert.equal(belowZeroNote('long', { games: 1, avgDividend: -0.4 }), null);
  assert.equal(belowZeroNote('long', { games: 2, avgDividend: 30_000 }), null);
  assert.equal(belowZeroNote('long', { games: 0, avgDividend: null }), null);
  assert.match(BELOW_ZERO_WELCOME, /bad game can push his dividend below zero/);
});

test('the first-night tip speaks to shorts when you have only shorted (walk 8 T4-10)', () => {
  assert.equal(tipSide([{ side: 'short' }, { side: 'short' }]), 'short');
  assert.equal(tipSide([{ side: 'short' }, { side: 'long' }]), 'long');
  assert.equal(tipSide([]), 'long');
  assert.match(tipWords('short'), /^ on a short means his dividends came in under his price so far\./);
  assert.match(tipWords('long'), /^ means his dividends beat your price so far\./);
});

test('the score chart draws played nights only, and its value text is always a night (walk 8 T2-02, T3-03)', async () => {
  const { nightlySeries } = await import('./rosterView');
  const { buildPnlSeries } = await import('../state/perGameState');
  const entry = (eventCursor: number, amountDollars: number, gameDate: string | null, kind = 'game') => ({
    eventCursor, amountDollars, gameDate, kind, gameId: gameDate ? `g${eventCursor}` : null, positionId: 'p', playerId: 'x',
    createdAt: gameDate ? `${gameDate}T23:00:00Z` : '2025-10-21T23:30:00Z',
  });
  // A night, then a $250 drop before the next night.
  const entries = [entry(1, -85_000, '2025-10-21'), entry(2, -250, null, 'drop_fee')] as never[];
  const all = nightlySeries(buildPnlSeries(entries), entries);
  assert.deepEqual(all.map((point) => point.kind), ['start', 'night', 'now']);
  const drawn = all.filter((point) => point.kind !== 'now');
  assert.deepEqual(drawn.map((point) => point.label), ['Start', 'Oct 21']);
  // The next night's reading carries the fee paid before it.
  const next = [...entries, entry(3, 10_000, '2025-10-22')] as never[];
  const withNext = nightlySeries(buildPnlSeries(next), next).filter((point) => point.kind !== 'now');
  assert.match(chartValueText(withNext, null), /^Wed, Oct 22: that night \+\$10K, fees -\$250, score -\$75\.3K$/);
  // Unselected: the last night; selected: that night; never empty.
  assert.match(chartValueText(drawn, null), /^Tue, Oct 21: that night -\$85K, score -\$85K$/);
  assert.equal(chartValueText(drawn, 0), 'Start: everyone begins at $0');
  assert.equal(chartValueText(drawn, 9), chartValueText(drawn, null));
  assert.ok(chartValueText([], null).length > 0);
});
