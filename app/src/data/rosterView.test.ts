import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  PerGameLeaderboardRow,
  PerGameLedgerEntry,
  PerGamePosition,
  PerGameSettledResult,
} from '../api/contracts';
import { buildPnlSeries, pnlChartDomain } from '../state/perGameState';
import { scoreBreakdown } from './perGameMetrics';
import {
  axisLabelIndexes,
  axisMoney,
  breakdownParts,
  breakdownPrecision,
  chartSummary,
  closedRows,
  expiryLine,
  feeMoves,
  figureCaptions,
  formatAt,
  gamesLine,
  hasNights,
  nearestIndex,
  nightlySeries,
  placeAxisLabels,
  rankLine,
  rosterRowView,
  rowLayout,
  slotLine,
  valueTicks,
  verdictTag,
  WEEK_LABEL,
} from './rosterView';

function position(overrides: Partial<PerGamePosition> = {}): PerGamePosition {
  return {
    positionId: 'p1',
    playerId: 'jokic',
    playerName: 'Nikola Jokic',
    side: 'long',
    status: 'active',
    lockedGameCost: 100_000,
    openedEventSequence: 1,
    closedEventSequence: null,
    expiresOn: null,
    cumulativeGameCost: 0,
    cumulativeDividend: 0,
    cumulativePnl: 0,
    ...overrides,
  };
}

function result(overrides: Partial<PerGameSettledResult> = {}): PerGameSettledResult {
  return {
    eventCursor: 1,
    positionId: 'p1',
    playerId: 'jokic',
    gameId: 'g1',
    gameDate: '2025-10-21',
    resultRevision: 1,
    side: 'long',
    kind: 'base',
    status: 'settled',
    lockedGameCost: 100_000,
    dividendDollars: 245_000,
    netPnl: 145_000,
    adjustsResultRevision: null,
    ...overrides,
  };
}

let cursor = 0;
function entry(overrides: Partial<PerGameLedgerEntry>): PerGameLedgerEntry {
  cursor += 1;
  return {
    eventCursor: cursor,
    entryId: `e${cursor}`,
    positionId: 'p1',
    playerId: 'jokic',
    gameId: null,
    gameDate: null,
    resultRevision: null,
    kind: 'open_fee',
    amountDollars: -250,
    adjustsEntryId: null,
    createdAt: '2025-10-20T12:00:00Z',
    ...overrides,
  };
}

/** A settled game as the ledger records it: cost then dividend, same game and revision. */
function game(date: string, positionId: string, cost: number, dividend: number, revision = 1): PerGameLedgerEntry[] {
  const gameId = `${positionId}-${date}`;
  return [
    entry({ positionId, gameId, gameDate: date, resultRevision: revision, kind: 'game_cost', amountDollars: -cost }),
    entry({ positionId, gameId, gameDate: date, resultRevision: revision, kind: 'game_dividend', amountDollars: dividend }),
  ];
}

test('verdict tags say in words whether a player is paying for himself', () => {
  assert.deepEqual(verdictTag('profit'), { label: 'Paying off', tone: 'green' });
  assert.deepEqual(verdictTag('loss'), { label: 'Losing money', tone: 'red' });
  assert.deepEqual(verdictTag('even'), { label: 'Break-even', tone: 'neutral' });
  assert.deepEqual(verdictTag('untested'), { label: 'No games yet', tone: 'neutral' });
});

test('the games line counts settled games and names the nights that did not count', () => {
  assert.equal(gamesLine({ games: 0, dnp: 0, pending: 0 }), '');
  assert.equal(gamesLine({ games: 1, dnp: 0, pending: 0 }), '1 game');
  assert.equal(gamesLine({ games: 11, dnp: 1, pending: 0 }), '11 games · 1 DNP');
  assert.equal(gamesLine({ games: 0, dnp: 2, pending: 1 }), '2 DNP · 1 unsettled');
});

test('only a short with an end date shows when it ends, in plain dates', () => {
  assert.equal(expiryLine({ side: 'short', expiresOn: '2025-11-20' }), 'Ends Nov 20');
  // In its last games a short says it ends by itself, so nobody pays to close it.
  assert.equal(expiryLine({ side: 'short', expiresOn: '2025-11-20' }, '2025-11-19'), 'Ends Nov 20');
  assert.equal(
    expiryLine({ side: 'short', expiresOn: '2025-11-20' }, '2025-11-20'),
    'Ends by itself after the next games, no need to close',
  );
  // Past its term with no game left in it: nothing more can change.
  assert.equal(
    expiryLine({ side: 'short', expiresOn: '2025-11-20' }, '2025-11-22'),
    'Term over Nov 20: it ends by itself, nothing more can change',
  );
  assert.equal(expiryLine({ side: 'short', expiresOn: null }), null);
  assert.equal(expiryLine({ side: 'long', expiresOn: '2025-11-20' }), null);
});

test('captions say what each side pays or gets per game, never jargon', () => {
  assert.deepEqual(figureCaptions('long'), {
    price: 'Price a game', dividend: 'Dividend a game', net: 'Profit a game', total: 'Total',
  });
  assert.equal(figureCaptions('short').price, 'Credit a game');
  for (const side of ['long', 'short'] as const) {
    const words = Object.values(figureCaptions(side)).join(' ');
    assert.doesNotMatch(words, /inverse|\/GM|divs|cumulative/i);
  }
});

test('a row reads its per-game truth from the latest revision of each game', () => {
  const view = rosterRowView(position(), [
    result({ gameId: 'g1', eventCursor: 1, dividendDollars: 245_000, netPnl: 145_000 }),
    result({ gameId: 'g2', eventCursor: 2, gameDate: '2025-10-23', dividendDollars: 60_000, netPnl: -40_000 }),
    // A correction replaces g2's base result instead of adding a third game.
    result({
      gameId: 'g2', eventCursor: 3, gameDate: '2025-10-23', resultRevision: 2, kind: 'correction',
      dividendDollars: 80_000, netPnl: -20_000, adjustsResultRevision: 1,
    }),
    result({ gameId: 'g3', eventCursor: 4, gameDate: '2025-10-25', status: 'verified_dnp', dividendDollars: null, netPnl: null }),
    result({ positionId: 'other', gameId: 'g9', eventCursor: 5, netPnl: -999_000 }),
  ]);
  assert.equal(view.summary.games, 2);
  assert.equal(view.summary.avgDividend, 162_500);
  assert.equal(view.summary.avgNet, 62_500);
  assert.equal(view.verdict, 'profit');
  assert.deepEqual(view.tag, { label: 'Paying off', tone: 'green' });
  assert.equal(view.games, '2 games · 1 DNP');
  assert.equal(view.expiry, null);
});

test('a row with no settled games is untested, and a DNP-only player says so', () => {
  const fresh = rosterRowView(position(), []);
  assert.equal(fresh.verdict, 'untested');
  assert.equal(fresh.summary.avgNet, null);
  assert.equal(fresh.games, '');
  const benched = rosterRowView(position(), [
    result({ status: 'verified_dnp', dividendDollars: null, netPnl: null }),
  ]);
  assert.equal(benched.tag.label, 'No games yet');
  assert.equal(benched.games, '1 DNP');
});

test('a losing short reads as losing money and shows when it ends', () => {
  const view = rosterRowView(position({ side: 'short', expiresOn: '2025-11-20' }), [
    result({ side: 'short', dividendDollars: 300_000, netPnl: -200_000 }),
  ]);
  assert.equal(view.verdict, 'loss');
  assert.deepEqual(view.tag, { label: 'Losing money', tone: 'red' });
  assert.equal(view.expiry, 'Ends Nov 20');
});

test('slot use and rank read as plain counts', () => {
  const slots = (used: number, limit: number) => ({ used, limit, remaining: limit - used });
  assert.equal(
    slotLine({ longSlots: slots(8, 10), shortSlots: slots(1, 5) }),
    '8 of 10 on your roster · 1 of 5 shorts',
  );
  const row = (rank: number, isCurrentUser: boolean): PerGameLeaderboardRow => ({
    rank, entryId: `r${rank}`, displayName: `T${rank}`, cumulativePnl: 0, isCurrentUser,
  });
  assert.equal(rankLine([row(1, false), row(2, false), row(3, true), row(4, false)]), '#3 of 4');
  assert.equal(rankLine([row(1, false), row(2, false)]), null);
  assert.equal(rankLine([]), null);
  assert.equal(rankLine(undefined), null);
  // A page of the standings: the total is unknown, so only the rank shows.
  assert.equal(rankLine([row(1, false), row(312, true)]), '#312');
});

test('the chart keeps one point per night: the score after it settled', () => {
  cursor = 0;
  const entries = [
    entry({ positionId: 'p1' }),
    entry({ positionId: 'p2' }),
    ...game('2025-10-21', 'p1', 100_000, 245_000),
    ...game('2025-10-21', 'p2', 150_000, 90_000),
    ...game('2025-10-22', 'p1', 100_000, 60_000),
  ];
  const series = nightlySeries(buildPnlSeries(entries), entries);
  assert.deepEqual(series.map((point) => [point.kind, point.label, point.cumulativePnl, point.change]), [
    ['start', 'Start', 0, 0],
    // Opening fees are carried into the first night; "change" is that night's games.
    ['night', 'Oct 21', -500 + 145_000 - 60_000, 85_000],
    ['night', 'Oct 22', -500 + 85_000 - 40_000, -40_000],
  ]);
  assert.equal(hasNights(series), true);
  // The chart domain still starts from $0 and covers every plotted night.
  const domain = pnlChartDomain(series);
  assert.ok(domain.minimum <= 0 && domain.maximum >= series[1].cumulativePnl);
});

test('fees after the last night end the line on your real score', () => {
  cursor = 0;
  const entries = [
    ...game('2025-10-21', 'p1', 100_000, 245_000),
    entry({ kind: 'drop_fee', positionId: 'p1' }),
  ];
  const series = nightlySeries(buildPnlSeries(entries), entries);
  const end = series.at(-1)!;
  assert.equal(end.kind, 'now');
  assert.equal(end.label, 'Now');
  assert.equal(end.cumulativePnl, 145_000 - 250);
  assert.equal(end.change, -250);
});

test('a correction posted later moves the night it was posted, not an old one', () => {
  cursor = 0;
  const entries = [
    ...game('2025-10-21', 'p1', 100_000, 245_000),
    ...game('2025-10-22', 'p1', 100_000, 60_000),
    // Posted after Oct 22 settled: Oct 21's dividend is revised down by $20K.
    entry({
      gameId: 'p1-2025-10-21', gameDate: '2025-10-21', resultRevision: 2,
      kind: 'dividend_correction', amountDollars: -20_000,
    }),
  ];
  const series = nightlySeries(buildPnlSeries(entries), entries);
  assert.deepEqual(series.map((point) => point.label), ['Start', 'Oct 21', 'Oct 22']);
  assert.equal(series[1].cumulativePnl, 145_000);
  assert.equal(series[2].cumulativePnl, 145_000 - 40_000 - 20_000);
});

test('fees alone draw no night, so the chart shows its $0 start instead', () => {
  cursor = 0;
  const entries = [entry({}), entry({ positionId: 'p2' })];
  const series = nightlySeries(buildPnlSeries(entries), entries);
  assert.equal(hasNights(series), false);
  assert.deepEqual(nightlySeries([], []).map((point) => point.kind), ['start']);
  assert.match(chartSummary(series), /starts at \$0/);
});

test('x-axis labels name the first night and the last point, plus a middle one when wide', () => {
  const make = (count: number) => {
    const entries = Array.from({ length: count }, (_, index) => (
      game(`2025-11-${String(index + 1).padStart(2, '0')}`, 'p1', 100_000, 150_000)
    )).flat();
    return nightlySeries(buildPnlSeries(entries), entries);
  };
  assert.deepEqual(axisLabelIndexes(make(0), 360), []);
  assert.deepEqual(axisLabelIndexes(make(1), 360), [1]);
  assert.deepEqual(axisLabelIndexes(make(3), 360), [1, 3]);
  assert.deepEqual(axisLabelIndexes(make(9), 360), [1, 5, 9]);
  assert.deepEqual(axisLabelIndexes(make(9), 240), [1, 9]);
  // Fees since the last night add a final point that never takes the last date.
  const withFees = [...make(3), { eventCursor: 99, cumulativePnl: -250, kind: 'now' as const, date: null, label: 'Now', change: -250 }];
  assert.deepEqual(axisLabelIndexes(withFees, 360), [1, 3]);
});

test('a pointer snaps to the nearest real night', () => {
  assert.equal(nearestIndex([], 10), null);
  assert.equal(nearestIndex([0, 50, 100], -20), 0);
  assert.equal(nearestIndex([0, 50, 100], 70), 1);
  assert.equal(nearestIndex([0, 50, 100], 400), 2);
});

test('the chart summary reads the range, the end, and the best and worst nights', () => {
  cursor = 0;
  const entries = [
    ...game('2025-10-21', 'p1', 100_000, 400_000),
    ...game('2025-10-22', 'p1', 100_000, 0),
    ...game('2025-10-23', 'p1', 100_000, 150_000),
  ];
  const summary = chartSummary(nightlySeries(buildPnlSeries(entries), entries));
  assert.equal(
    summary,
    'Your score by night from Oct 21 to Oct 23: started at $0, now +$250K. '
      + 'Best +$300K after Oct 21, lowest +$200K after Oct 22.',
  );
  assert.doesNotMatch(summary, /\d{4}-\d{2}-\d{2}/);
});

test('rows reflow under 330 CSS px or with very large text, and read as a table when the list is wide', () => {
  assert.equal(rowLayout(390, 390, 1), 'stacked');
  assert.equal(rowLayout(360, 360, 1), 'stacked');
  // A 390px phone at 200% zoom is 195 CSS px wide: fontScale stays 1 on web.
  assert.equal(rowLayout(195, 195, 1), 'compact');
  assert.equal(rowLayout(329, 329, 1), 'compact');
  assert.equal(rowLayout(390, 390, 2), 'compact');
  assert.equal(rowLayout(768, 768, 1), 'table');
  // A narrow tablet list keeps the phone rows rather than squeezing names.
  assert.equal(rowLayout(640, 640, 1), 'stacked');
  assert.equal(rowLayout(704, 1024, 1), 'table');
  assert.equal(rowLayout(840, 1440, 1), 'table');
  assert.equal(rowLayout(840, 1440, 2), 'compact');
});

test('the breakdown reads by source, adds up to the score and names Other only when needed', () => {
  const positions = [
    position({ positionId: 'l1', side: 'long', cumulativePnl: 1_240_000 }),
    position({ positionId: 'l2', side: 'long', cumulativePnl: -300_000 }),
    position({ positionId: 's1', side: 'short', cumulativePnl: 345_000 }),
    position({ positionId: 'c1', side: 'short', status: 'closed', cumulativePnl: 579_300 }),
  ];
  cursor = 0;
  const ledger = [entry({ kind: 'open_fee' }), entry({ kind: 'drop_fee' }), entry({ kind: 'open_fee' })];
  const score = 1_240_000 - 300_000 + 345_000 + 579_300 - 750;
  const parts = breakdownParts(scoreBreakdown(score, positions, ledger));
  assert.deepEqual(parts.map((part) => [part.label, part.value]), [
    ['Roster', 940_000], ['Shorts', 345_000], ['Closed', 579_300], ['Fees', -750],
  ]);
  assert.equal(parts.reduce((sum, part) => sum + part.value, 0), score);
  const off = breakdownParts(scoreBreakdown(score + 5_000, positions, ledger));
  assert.deepEqual(off.at(-1), { key: 'other', label: 'Other', value: 5_000 });
  assert.equal(feeMoves(ledger), 3);
  for (const part of parts) assert.doesNotMatch(part.label, /earned|paid/i);
});

test('closed rows keep dropped players and ended shorts, newest first, with how each closed', () => {
  cursor = 0;
  const ledger = [
    // Practice books a move's fee on the day the player made it.
    entry({ positionId: 'dropped', kind: 'drop_fee', createdAt: '2025-11-06T12:00:00.000Z' }),
    entry({ positionId: 'closedShort', kind: 'drop_fee', createdAt: '2025-10-26T12:00:00.000Z' }),
    entry({ positionId: 'unplayed', kind: 'drop_fee', createdAt: '2025-10-21T12:00:00.000Z' }),
  ];
  const rows = closedRows([
    position({ positionId: 'active', status: 'active' }),
    position({ positionId: 'expired', playerName: 'Tyrese Maxey', side: 'short', status: 'closed', closedEventSequence: 5, expiresOn: '2025-10-28', cumulativePnl: 345_000 }),
    position({ positionId: 'dropped', playerName: 'Nikola Jokic', status: 'closed', closedEventSequence: 9, cumulativePnl: 1_632_000 }),
    position({ positionId: 'closedShort', playerName: 'Scottie Barnes', side: 'short', status: 'closed', closedEventSequence: 3, expiresOn: '2025-10-28', cumulativePnl: -194_000 }),
    position({ positionId: 'unplayed', playerName: 'Derrick White', status: 'closed', closedEventSequence: 1 }),
  ], ledger, [
    result({ positionId: 'dropped', gameId: 'a', gameDate: '2025-11-03' }),
    result({ positionId: 'dropped', gameId: 'b', gameDate: '2025-11-05' }),
    result({ positionId: 'expired', gameId: 'c', side: 'short' }),
    result({ positionId: 'closedShort', gameId: 'd', side: 'short', gameDate: '2025-10-25' }),
  ]);
  assert.deepEqual(rows.map((row) => [row.name, row.how, row.games, row.total, row.unplayed]), [
    ['Nikola Jokic', 'Dropped Nov 6 · last game Nov 5', 2, 1_632_000, false],
    ['Tyrese Maxey', 'Short ended Oct 28', 1, 345_000, false],
    ['Scottie Barnes', 'Short closed Oct 26 · last game Oct 25', 1, -194_000, false],
    // Dropped before his first game: nothing but fees moved, so it folds into Fees.
    ['Derrick White', 'Dropped Oct 21 before he played', 0, 0, true],
  ]);
  // Only a short that ran its term can be shorted again from the Closed list.
  assert.deepEqual(rows.map((row) => row.endedByTerm), [false, true, false, false]);
  // Without a fee on record the row still dates itself by his last game.
  const [feeless] = closedRows([
    position({ positionId: 'dropped', playerName: 'Nikola Jokic', status: 'closed' }),
  ], [], [result({ positionId: 'dropped', gameId: 'a', gameDate: '2025-11-03' })]);
  assert.equal(feeless.how, 'Dropped after Nov 3');
});

test('the week figure is labelled in calendar days, as recentEarnings counts it', () => {
  assert.equal(WEEK_LABEL, 'Games, last 7 days');
});

test('breakdown parts take the precision at which they visibly add up to the hero', () => {
  // "-$1.05M + $552K - $3,000" reads -$501K beside a "-$503K" hero; one more
  // digit on the millions ("-$1.052M") makes the parts add up.
  const parts = [-1_052_000, 0, 552_000, -3_000];
  const score = parts.reduce((sum, part) => sum + part, 0);
  assert.equal(breakdownPrecision(parts, score), 'fine3');
  // Rigor's case: the hero shows $100s ("-$503K"), which "-$1.052M + $552.1K
  // - $3,000" (-$502.9K) still misses, so the parts read in exact dollars.
  const rigor = [-1_052_100, 0, 552_100, -3_000];
  assert.equal(breakdownPrecision(rigor, rigor.reduce((sum, part) => sum + part, 0)), 'exact');
  assert.equal(formatAt(-1_052_100, 'fine3', true), '-$1.052M');
  assert.equal(formatAt(552_100, 'fine3', true), '+$552.1K');
  assert.equal(formatAt(-3_000, 'fine3', true), '-$3K');
  assert.equal(formatAt(1_050_000, 'fine3', true), '+$1.05M');
  assert.equal(formatAt(0, 'fine3', true), '$0');
  assert.equal(formatAt(-1_052_100, 'exact', true), '-$1,052,100');
  // Parts that already add up keep the lighter precision.
  assert.equal(breakdownPrecision([-418_500, 0, 546_500, -3_000], 125_000), 'fine');
  // Million-scale parts beside a thousand-scale hero: $10K and $1K rounding
  // both miss "+$500K" ($490K, $501K), so the parts fall back to exact dollars.
  const edge = [1_004_500, 1_004_500, -1_508_999];
  assert.equal(breakdownPrecision(edge, 500_001), 'exact');
});

test('x-axis dates never touch: the most recent date wins a crowded axis', () => {
  // Wide: three labels fit.
  assert.deepEqual(placeAxisLabels([0, 50, 150, 300], [1, 2, 3], 320, 64).map((label) => label.index), [1, 2, 3]);
  // Narrow (a phone at 200% zoom): the first night sits too close to the last.
  const crowded = placeAxisLabels([48, 105, 157], [1, 2], 163, 64);
  assert.deepEqual(crowded.map((label) => label.index), [2]);
  assert.equal(crowded[0].align, 'right');
  const edges = placeAxisLabels([30, 290], [0, 1], 320, 64);
  assert.deepEqual(edges.map((label) => label.align), ['left', 'right']);
  for (let i = 1; i < edges.length; i += 1) assert.ok(edges[i].left - edges[i - 1].left >= 64);
});

test('value marks fit the gutter: three significant figures at most', () => {
  assert.equal(axisMoney(-348_300), '-$348K');
  assert.equal(axisMoney(1_062_500), '+$1.06M');
  assert.equal(axisMoney(-8_046_000), '-$8.05M');
  assert.equal(axisMoney(9_500), '+$9.5K');
  assert.equal(axisMoney(999_700), '+$1M');
  assert.equal(axisMoney(250), '+$250');
  assert.equal(axisMoney(0), '$0');
});

test('the y-axis marks $0 and the season high and low, each at its line when there is room', () => {
  const yOf = (value: number) => 100 - value / 10_000;
  assert.deepEqual(valueTicks([0, 400_000, -300_000], yOf).map((tick) => [tick.kind, tick.value, tick.labelY]), [
    ['high', 400_000, 60], ['zero', 0, 100], ['low', -300_000, 130],
  ]);
  // Never below $0: no low mark. A high only 5px above $0 keeps its line and
  // its mark, the words stepped up clear of "$0" (walk 4 T4-09: no longer dropped).
  assert.deepEqual(valueTicks([0, 50_000], yOf).map((tick) => [tick.kind, tick.y, tick.labelY]), [['high', 95, 82], ['zero', 100, 100]]);
  assert.deepEqual(valueTicks([0, 900_000], yOf).map((tick) => tick.kind), ['high', 'zero']);
  // A high that would read "$0" is no second mark.
  assert.deepEqual(valueTicks([0, 0.4], yOf).map((tick) => tick.kind), ['zero']);
});

test('the score chart marks both its high and its low when they differ, inside a short phone plot (walk 4 T4-09)', () => {
  // The phone chart: a 68px plot, 8px inset top and bottom.
  const plot = (low: number, high: number) => (value: number) => 8 + ((high - value) / (high - low)) * 52;
  const readable = (ticks: ReturnType<typeof valueTicks>) => {
    for (const tick of ticks) assert.ok(tick.labelY >= 7 && tick.labelY <= 61, `${tick.kind} inside the plot: ${tick.labelY}`);
    for (let index = 1; index < ticks.length; index += 1) {
      assert.ok(ticks[index].labelY - ticks[index - 1].labelY >= 17.99, `${ticks[index].kind} clear of ${ticks[index - 1].kind}`);
    }
  };
  // (a) Peaked at +$22.8K, now -$8,000: the low sat 13.5px under $0 and went unlabelled.
  const peak = valueTicks([0, 22_800, 5_000, -8_000], plot(-8_000, 22_800), { height: 68 });
  assert.deepEqual(peak.map((tick) => [tick.kind, tick.value]), [['high', 22_800], ['zero', 0], ['low', -8_000]]);
  readable(peak);
  assert.equal(peak[0].labelY, peak[0].y, 'the high reads at its line');
  // (b) A -$1.56M season that went a little above $0 in January: the high is named too.
  const season = valueTicks([0, -400_000, 40_000, -1_560_000], plot(-1_560_000, 40_000), { height: 68 });
  assert.deepEqual(season.map((tick) => [tick.kind, tick.value]), [['high', 40_000], ['zero', 0], ['low', -1_560_000]]);
  readable(season);
  // Lines stay at their values; only the words step aside.
  assert.deepEqual(season.map((tick) => Math.round(tick.y)), [8, 9, 60]);
  // A plot too short for three marks keeps the extreme farther from $0.
  assert.deepEqual(valueTicks([0, 22_800, -8_000], plot(-8_000, 22_800), { height: 40 }).map((tick) => tick.kind), ['high', 'zero']);
});

test('the hero score shrinks to fit a 200% zoom phone and stays full size elsewhere (walk 3 T3-28)', async () => {
  const { heroFontSize } = await import('./rosterView');
  // 195px wide, 16px sides: 163px for "+$139.5K" (8 characters).
  const size = heroFontSize('+$139.5K', 163, 46);
  assert.ok(size < 46);
  assert.ok(size * 0.62 * 8 <= 163);
  assert.equal(heroFontSize('+$139.5K', 358, 46), 46);
  assert.equal(heroFontSize('$0', 163, 46), 46);
  // Never smaller than the floor, even for a long figure in a sliver.
  assert.equal(heroFontSize('-$12.34M', 60, 46), 26);
});

test('value against results compares like with like: last season beside what the same games made, dropped and ended ones included (walk 5 T1-07)', async () => {
  const { pickValue } = await import('./rosterView');
  // Doncic held, Barnes dropped after one game, Duren held, Cunningham shorted
  // for his term (ended by itself).
  const positions = [
    position({ positionId: 'don', playerId: 'don', lockedGameCost: 400_000, cumulativePnl: 0 }),
    position({ positionId: 'bar', playerId: 'bar', lockedGameCost: 250_000, status: 'closed', closedEventSequence: 9 }),
    position({ positionId: 'dur', playerId: 'dur', lockedGameCost: 180_000 }),
    position({ positionId: 'cun', playerId: 'cun', side: 'short', lockedGameCost: 300_000, status: 'closed', expiresOn: '2025-10-24' }),
  ];
  // Last season, a game: Doncic +$20K over his price, Barnes +$30K, Duren +$10K, Cunningham $40K under
  // the credit (a short's edge: +$40K).
  const prior: Record<string, number> = { don: 420_000, bar: 280_000, dur: 190_000, cun: 260_000 };
  const games = [
    result({ positionId: 'don', playerId: 'don', gameId: 'd1', eventCursor: 1, lockedGameCost: 400_000, dividendDollars: 430_000, netPnl: 30_000 }),
    result({ positionId: 'don', playerId: 'don', gameId: 'd2', eventCursor: 2, gameDate: '2025-10-23', lockedGameCost: 400_000, dividendDollars: 390_000, netPnl: -10_000 }),
    // Dropped after this game: it still counts in both halves.
    result({ positionId: 'bar', playerId: 'bar', gameId: 'b1', eventCursor: 3, lockedGameCost: 250_000, dividendDollars: 0, netPnl: -250_000 }),
    result({ positionId: 'dur', playerId: 'dur', gameId: 'u1', eventCursor: 4, lockedGameCost: 180_000, dividendDollars: 230_000, netPnl: 50_000 }),
    // The short's two games before it ended.
    result({ positionId: 'cun', playerId: 'cun', gameId: 'c1', eventCursor: 5, side: 'short', lockedGameCost: 300_000, dividendDollars: 320_000, netPnl: -20_000 }),
    result({ positionId: 'cun', playerId: 'cun', gameId: 'c2', eventCursor: 6, side: 'short', gameDate: '2025-10-23', lockedGameCost: 300_000, dividendDollars: 290_000, netPnl: 10_000 }),
  ];
  const value = pickValue(positions, (id) => prior[id] ?? null, games, { fees: -1_250 });
  assert.ok(value);
  // 2 x 20K + 30K + 10K + 2 x 40K.
  assert.equal(value.byLastSeason, 160_000);
  // Every game's net: the Roster, Shorts and Closed parts added up, the score before fees.
  assert.equal(value.soFar, 30_000 - 10_000 - 250_000 + 50_000 - 20_000 + 10_000);
  assert.equal(value.games, 6);
  assert.equal(value.allGames, 6);
  assert.equal(value.players, 4);
  assert.equal(
    value.text,
    "On last season's numbers, the 6 games your picks played would have made +$160K. They made -$190K before fees. A few weeks is mostly luck.",
  );
  // The made half reconciles with the score: the positions' results plus fees.
  const breakdown = scoreBreakdown(
    -190_000 - 1_250,
    positions.map((row) => ({ ...row, cumulativePnl: games.filter((game) => game.positionId === row.positionId).reduce((sum, game) => sum + (game.netPnl ?? 0), 0) })),
    [entry({ kind: 'open_fee', amountDollars: -1_250 })],
  );
  assert.equal(breakdown.roster + breakdown.shorts + breakdown.closed, value.soFar);
  assert.equal(breakdown.other, 0);
  // Dropping the loser does not flatter the line: his game stays in both halves.
  const afterDrop = pickValue(positions, (id) => prior[id] ?? null, games, { fees: -1_500 });
  assert.equal(afterDrop?.soFar, value.soFar);
});

test('value against results names its base when a rookie has no last season, and speaks of one game as one (walk 5 T1-07)', async () => {
  const { pickValue } = await import('./rosterView');
  const positions = [
    position({ positionId: 'a', playerId: 'a', lockedGameCost: 100_000 }),
    position({ positionId: 'k', playerId: 'k', lockedGameCost: 90_000 }),
  ];
  const prior: Record<string, number | null> = { a: 130_000, k: null };
  const games = [
    result({ positionId: 'a', playerId: 'a', gameId: 'a1', eventCursor: 1, dividendDollars: 80_000, netPnl: -20_000 }),
    result({ positionId: 'a', playerId: 'a', gameId: 'a2', eventCursor: 2, gameDate: '2025-10-23', dividendDollars: 100_000, netPnl: 0 }),
    result({ positionId: 'k', playerId: 'k', gameId: 'k1', eventCursor: 3, lockedGameCost: 90_000, dividendDollars: 190_000, netPnl: 100_000 }),
  ];
  // The rookie's game is left out of both halves, and the words say so (no "before fees": not every game).
  assert.equal(
    pickValue(positions, (id) => prior[id] ?? null, games, { fees: -500 })?.text,
    "On last season's numbers, 2 of the 3 games your picks played would have made +$60K. Those 2 made -$20K. A few weeks is mostly luck.",
  );
  // One game: "the 1 game", "It made".
  assert.equal(
    pickValue(positions.slice(0, 1), (id) => prior[id] ?? null, games.slice(0, 1), { fees: -250 })?.text,
    "On last season's numbers, the 1 game your pick played would have made +$30K. It made -$20K before fees. A few weeks is mostly luck.",
  );
  // No fees on record (a live account before its first move fee): nothing to be "before".
  assert.equal(
    pickValue(positions.slice(0, 1), (id) => prior[id] ?? null, games.slice(0, 2))?.text,
    "On last season's numbers, the 2 games your pick played would have made +$60K. They made -$20K. A few weeks is mostly luck.",
  );
});

test('value against results is hidden with nothing to compare: before games, or no last season for anyone', async () => {
  const { pickValue } = await import('./rosterView');
  const held = [position({ positionId: 'a', playerId: 'a' })];
  const played = [result({ positionId: 'a', playerId: 'a' })];
  assert.equal(pickValue(held, () => 120_000, []), null);
  assert.equal(pickValue(held, () => null, played), null);
  assert.equal(pickValue([], () => 120_000, played), null);
  // A night he did not play is no game to compare.
  assert.equal(pickValue(held, () => 120_000, [result({ positionId: 'a', playerId: 'a', status: 'verified_dnp', netPnl: null, dividendDollars: null })]), null);
  // A corrected game counts once, at its latest revision.
  const corrected = pickValue(held, () => 120_000, [
    result({ positionId: 'a', playerId: 'a', netPnl: 10_000, dividendDollars: 110_000 }),
    result({ positionId: 'a', playerId: 'a', eventCursor: 2, resultRevision: 2, kind: 'correction', netPnl: 15_000, dividendDollars: 115_000 }),
  ]);
  assert.equal(corrected?.games, 1);
  assert.equal(corrected?.soFar, 15_000);
});

test('value against results uses the price you locked, and calls the gap luck only while the games are few', async () => {
  const { EARLY_GAMES_EACH, pickValue } = await import('./rosterView');
  const held = [position({ positionId: 'a', playerId: 'a', lockedGameCost: 100_000 })];
  const games = (count: number) => Array.from({ length: count }, (_, index) => result({
    positionId: 'a',
    playerId: 'a',
    gameId: `a${index}`,
    eventCursor: index + 1,
    dividendDollars: 110_000,
    netPnl: 10_000,
  }));
  // Last season paid $90K against the $100K locked (today's market price plays no part).
  const early = pickValue(held, () => 90_000, games(EARLY_GAMES_EACH - 1), { fees: -250 });
  assert.equal(early?.text, "On last season's numbers, the 19 games your pick played would have made -$190K. They made +$190K before fees. A few weeks is mostly luck.");
  const later = pickValue(held, () => 90_000, games(EARLY_GAMES_EACH), { fees: -250, over: true });
  assert.equal(later?.text, "On last season's numbers, the 20 games your pick played would have made -$200K. They made +$200K before fees. Last season is a guide, not a promise.");
});

test('the season card says what the moves were and what they cost (walk 5 T1-13)', async () => {
  const { movesLine } = await import('./rosterView');
  const positions = [
    position({ positionId: 'a', side: 'long' }),
    position({ positionId: 'b', side: 'long', status: 'closed' }),
    position({ positionId: 'c', side: 'long' }),
    position({ positionId: 's', side: 'short' }),
    position({ positionId: 't', side: 'short', status: 'closed' }),
  ];
  const fee = (kind: PerGameLedgerEntry['kind'], positionId: string) => entry({ kind, positionId, amountDollars: -250 });
  // Three adds and a short: "4 (3 adds, 1 short) · $1K in fees".
  const opens = [fee('open_fee', 'a'), fee('open_fee', 'b'), fee('open_fee', 'c'), fee('open_fee', 's')];
  assert.equal(movesLine(opens, positions, -1_000), '4 (3 adds, 1 short) · $1K in fees');
  // A drop and a short closed early are moves too, named by side; game results are not moves.
  const more = [...opens, fee('open_fee', 't'), fee('drop_fee', 'b'), fee('drop_fee', 't'), entry({ kind: 'game_dividend', positionId: 'a', amountDollars: 50_000 })];
  assert.equal(movesLine(more, positions, -1_750), '7 (3 adds, 2 shorts, 1 drop, 1 close) · $1.75K in fees');
  assert.equal(movesLine([fee('open_fee', 'a')], positions, -250), '1 (1 add) · $250 in fees');
  assert.equal(movesLine([], positions, 0), '0');
});

test('a touch on the score chart selects a night only on a tap or a mostly sideways drag (walk 5 T1-21)', async () => {
  const { chartTouchIsTap, chartTouchMove, CHART_SLIDE_MIN } = await import('./rosterView');
  // A thumb scrolling the page: mostly up, a little sideways, is never a slide.
  assert.equal(chartTouchMove(3, -40, false), 'scroll');
  assert.equal(chartTouchMove(12, -30, false), 'scroll');
  assert.equal(chartTouchMove(0, CHART_SLIDE_MIN, false), 'scroll');
  // Clearly sideways scrubs; a diagonal is not "mostly sideways".
  assert.equal(chartTouchMove(CHART_SLIDE_MIN, 0, false), 'slide');
  assert.equal(chartTouchMove(-20, 8, false), 'slide');
  assert.equal(chartTouchMove(12, 10, false), 'wait');
  // Barely moved: undecided. Once sliding, it stays a slide whichever way the finger drifts.
  assert.equal(chartTouchMove(2, 3, false), 'wait');
  assert.equal(chartTouchMove(1, 30, true), 'slide');
  // A tap lifts close to where it landed.
  assert.equal(chartTouchIsTap(3, -4), true);
  assert.equal(chartTouchIsTap(0, 25), false);
});
