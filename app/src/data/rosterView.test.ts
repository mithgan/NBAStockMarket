import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  PerGameLeaderboardRow,
  PerGameLedgerEntry,
  PerGamePosition,
  PerGameSettledResult,
} from '../api/contracts';
import { buildPnlSeries, pnlChartDomain } from '../state/perGameState';
import {
  axisLabelIndexes,
  chartSummary,
  expiryLine,
  figureCaptions,
  gamesLine,
  hasNights,
  nearestIndex,
  nightlySeries,
  rankLine,
  rosterRowView,
  slotLine,
  verdictTag,
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
  assert.equal(expiryLine({ side: 'short', expiresOn: null }), null);
  assert.equal(expiryLine({ side: 'long', expiresOn: '2025-11-20' }), null);
});

test('captions say what each side pays or gets per game, never jargon', () => {
  assert.deepEqual(figureCaptions('long'), {
    price: 'Price a game', dividend: 'Dividend a game', net: 'Net a game', total: 'Total',
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
