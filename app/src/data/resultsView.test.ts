import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  PerGameLedgerEntry,
  PerGamePosition,
  PerGameSettledResult,
} from '../api/contracts';
import { settlementEquation } from '../state/perGameState';
import { recentEarnings } from './perGameMetrics';
import {
  buildResultsFeed,
  feeDay,
  feedNights,
  nightSummaryLine,
  nightTotalPending,
  resultRowModel,
  settlementLines,
  valuePair,
  type ResultsFeedItem,
  type ResultsFeedSource,
} from './resultsView';

let cursor = 0;
function result(overrides: Partial<PerGameSettledResult>): PerGameSettledResult {
  cursor += 1;
  return {
    eventCursor: cursor,
    positionId: 'pos-1',
    playerId: 'p1',
    gameId: 'g1',
    gameDate: '2025-11-01',
    resultRevision: 1,
    side: 'long',
    kind: 'base',
    status: 'settled',
    lockedGameCost: 100_000,
    dividendDollars: 150_000,
    netPnl: 50_000,
    adjustsResultRevision: null,
    ...overrides,
  };
}

function fee(overrides: Partial<PerGameLedgerEntry>): PerGameLedgerEntry {
  cursor += 1;
  return {
    eventCursor: cursor,
    entryId: `fee-${cursor}`,
    positionId: 'pos-1',
    playerId: 'p1',
    gameId: null,
    gameDate: null,
    resultRevision: null,
    kind: 'open_fee',
    amountDollars: -250,
    adjustsEntryId: null,
    createdAt: '2025-11-01T12:00:00.000Z',
    ...overrides,
  };
}

function position(positionId: string, side: 'long' | 'short'): PerGamePosition {
  return {
    positionId,
    playerId: positionId.replace('pos', 'p'),
    playerName: `Player ${positionId}`,
    side,
    status: 'active',
    lockedGameCost: 100_000,
    openedEventSequence: 1,
    closedEventSequence: null,
    expiresOn: null,
    cumulativeGameCost: 0,
    cumulativeDividend: 0,
    cumulativePnl: 0,
  };
}

function source(
  settledResults: PerGameSettledResult[],
  ledger: PerGameLedgerEntry[] = [],
  positions: PerGamePosition[] = [],
): ResultsFeedSource {
  return { settledResults, ledger: { items: ledger, nextCursor: null }, positions };
}

/** A compact picture of the feed: "night:2025-11-02", "result:pos-1:g1", … */
function shape(items: readonly ResultsFeedItem[]): string[] {
  return items.map((item) => item.key);
}

// ---------------------------------------------------------------------------
// Grouping

test('nights run newest first, each header followed by its own rows', () => {
  const feed = buildResultsFeed(source([
    result({ positionId: 'pos-1', gameId: 'a1', gameDate: '2025-11-01', netPnl: 10_000 }),
    result({ positionId: 'pos-1', gameId: 'a2', gameDate: '2025-11-03', netPnl: -20_000, dividendDollars: 80_000 }),
    result({ positionId: 'pos-2', gameId: 'b2', gameDate: '2025-11-03', netPnl: 40_000, dividendDollars: 140_000 }),
    result({ positionId: 'pos-2', gameId: 'b1', gameDate: '2025-11-02', netPnl: 5_000, dividendDollars: 105_000 }),
  ]));
  assert.deepEqual(shape(feed), [
    'night:2025-11-03',
    'result:pos-2:b2',
    'result:pos-1:a2',
    'night:2025-11-02',
    'result:pos-2:b1',
    'night:2025-11-01',
    'result:pos-1:a1',
  ]);
  const [newest] = feedNights(feed);
  assert.equal(newest.date, '2025-11-03');
  assert.equal(newest.total, 20_000);
  assert.equal(newest.games, 2);
  assert.equal(newest.wins, 1);
  assert.equal(newest.results, 2);
  assert.equal(nightSummaryLine(newest), '1 of 2 beat their price');
});

test('inside a night: best result first, then games waiting on stats, then did-not-play', () => {
  const feed = buildResultsFeed(source([
    result({ positionId: 'pos-dnp', gameId: 'g-dnp', status: 'verified_dnp', dividendDollars: 0, netPnl: 0 }),
    result({ positionId: 'pos-loss', gameId: 'g-loss', netPnl: -30_000, dividendDollars: 70_000 }),
    result({ positionId: 'pos-wait', gameId: 'g-wait', status: 'unsettled', dividendDollars: null, netPnl: null }),
    result({ positionId: 'pos-win', gameId: 'g-win', netPnl: 60_000, dividendDollars: 160_000 }),
  ]));
  assert.deepEqual(shape(feed), [
    'night:2025-11-01',
    'result:pos-win:g-win',
    'result:pos-loss:g-loss',
    'result:pos-wait:g-wait',
    'result:pos-dnp:g-dnp',
  ]);
});

test('a correction replaces its base: one row, and the night counts it once', () => {
  const base = result({ positionId: 'pos-1', gameId: 'g1', netPnl: 50_000, dividendDollars: 150_000 });
  const other = result({ positionId: 'pos-2', gameId: 'g2', netPnl: 20_000, dividendDollars: 120_000 });
  const corrected = result({
    positionId: 'pos-1',
    gameId: 'g1',
    resultRevision: 2,
    kind: 'correction',
    adjustsResultRevision: 1,
    dividendDollars: 90_000,
    netPnl: -10_000,
  });
  const feed = buildResultsFeed(source([base, other, corrected]));
  const rows = feed.filter((item) => item.type === 'result');
  assert.equal(rows.length, 2, 'the base row is replaced, not listed beside its correction');
  const row = rows.find((item) => item.key === 'result:pos-1:g1');
  assert.ok(row && row.type === 'result');
  assert.equal(row.result.kind, 'correction');
  assert.equal(row.result.netPnl, -10_000);
  const [night] = feedNights(feed);
  assert.equal(night.total, 10_000, '-$10K corrected + $20K, never the stale +$50K');
  assert.equal(night.corrections, 1);
  assert.equal(night.games, 2);
  assert.equal(night.wins, 1);
  assert.equal(nightSummaryLine(night), '1 of 2 beat their price · 1 corrected');
});

test('a verified did-not-play game charges nothing and is said plainly', () => {
  const feed = buildResultsFeed(source([
    result({ positionId: 'pos-1', gameId: 'g1', netPnl: 40_000, dividendDollars: 140_000 }),
    result({ positionId: 'pos-2', gameId: 'g2', status: 'verified_dnp', dividendDollars: 0, netPnl: 0 }),
  ]));
  const [night] = feedNights(feed);
  assert.equal(night.total, 40_000);
  assert.equal(night.games, 1);
  assert.equal(night.dnp, 1);
  assert.equal(nightSummaryLine(night), "1 of 1 beat their price · 1 didn't play");
});

test('a night where nobody played totals $0 and is not waiting on anything', () => {
  const feed = buildResultsFeed(source([
    result({ positionId: 'pos-1', gameId: 'g1', status: 'verified_dnp', dividendDollars: 0, netPnl: 0 }),
    result({ positionId: 'pos-2', gameId: 'g2', status: 'verified_dnp', dividendDollars: 0, netPnl: 0 }),
  ]));
  const [night] = feedNights(feed);
  assert.equal(night.total, 0);
  assert.equal(night.games, 0);
  assert.equal(nightTotalPending(night), false);
  assert.equal(nightSummaryLine(night), "2 didn't play");
});

test('unsettled games, including a missing projection, stay listed and pending', () => {
  const feed = buildResultsFeed(source([
    result({ positionId: 'pos-1', gameId: 'g1', status: 'unsettled', dividendDollars: null, netPnl: null }),
    result({
      positionId: 'pos-2',
      gameId: 'g2',
      status: 'unsettled_missing_projection',
      dividendDollars: null,
      netPnl: null,
    }),
  ]));
  assert.equal(feed.filter((item) => item.type === 'result').length, 2);
  const [night] = feedNights(feed);
  assert.equal(night.pending, 2);
  assert.equal(night.games, 0);
  assert.equal(nightTotalPending(night), true, 'no settled game yet: the total is unknown, not $0');
  assert.equal(nightSummaryLine(night), '2 waiting on stats');

  const partial = feedNights(buildResultsFeed(source([
    result({ positionId: 'pos-1', gameId: 'g1', netPnl: 25_000, dividendDollars: 125_000 }),
    result({ positionId: 'pos-2', gameId: 'g2', status: 'unsettled', dividendDollars: null, netPnl: null }),
  ])))[0];
  assert.equal(partial.total, 25_000);
  assert.equal(nightTotalPending(partial), false);
  assert.equal(nightSummaryLine(partial), '1 of 1 beat their price · 1 waiting on stats');
});

test('shorts are counted as paying off, not as beating their price', () => {
  const feed = buildResultsFeed(source([
    result({ positionId: 'pos-1', gameId: 'g1', side: 'long', netPnl: 30_000, dividendDollars: 130_000 }),
    result({ positionId: 'pos-2', gameId: 'g2', side: 'long', netPnl: -30_000, dividendDollars: 70_000 }),
    result({ positionId: 'pos-3', gameId: 'g3', side: 'short', netPnl: 45_000, dividendDollars: 55_000 }),
  ]));
  const [night] = feedNights(feed);
  assert.equal(night.rosterGames, 2);
  assert.equal(night.rosterWins, 1);
  assert.equal(night.shortGames, 1);
  assert.equal(night.shortWins, 1);
  assert.equal(nightSummaryLine(night), '1 of 2 beat their price · 1 of 1 short paid off');
});

// ---------------------------------------------------------------------------
// Fees

test('a fee counts on its game date, or else on the day it was booked', () => {
  assert.equal(feeDay(fee({ kind: 'penalty', gameDate: '2025-11-02' })), '2025-11-02');
  assert.equal(feeDay(fee({ createdAt: '2025-11-03T12:00:00.000Z' })), '2025-11-03');
  assert.equal(feeDay(fee({ createdAt: '' })), null);
});

test('a fee dated to a game night sits in that night, under a heading, and counts in its total', () => {
  const game = result({ positionId: 'pos-1', gameId: 'g1', gameDate: '2025-11-02', netPnl: 60_000 });
  const penalty = fee({ kind: 'penalty', gameDate: '2025-11-02', amountDollars: -5_000 });
  const feed = buildResultsFeed(source([game], [penalty], [position('pos-1', 'long')]));
  assert.deepEqual(shape(feed), ['night:2025-11-02', 'result:pos-1:g1', 'fees:2025-11-02', `fee:${penalty.entryId}`]);
  const [night] = feedNights(feed);
  assert.equal(night.gamesNet, 60_000);
  assert.equal(night.fees, -5_000);
  assert.equal(night.feeCount, 1);
  assert.equal(night.total, 55_000);
  assert.equal(nightSummaryLine(night), '1 of 1 beat their price · fees\u00a0-$5,000');
  const heading = feed[2];
  assert.ok(heading.type === 'fees');
  assert.equal(heading.moves, false, 'a penalty is a fee, not a roster move');
  const feeItem = feed[3];
  assert.ok(feeItem.type === 'fee');
  assert.equal(feeItem.date, '2025-11-02');
  assert.equal(feeItem.side, 'long');
});

test('add and drop fees join the night they were booked on, or make a day of their own', () => {
  cursor = 100;
  const opening = fee({ entryId: 'open-a', positionId: 'pos-1', createdAt: '2025-11-01T12:00:00.000Z' });
  const openingShort = fee({ entryId: 'open-b', positionId: 'pos-2', createdAt: '2025-11-01T12:00:00.000Z' });
  const nov1 = result({ positionId: 'pos-1', gameId: 'g1', gameDate: '2025-11-01' });
  // Dropped for the Nov 2 games, which none of your players then played.
  const drop = fee({ entryId: 'drop-a', kind: 'drop_fee', positionId: 'pos-1', createdAt: '2025-11-02T12:00:00.000Z' });
  const nov3 = result({ positionId: 'pos-2', gameId: 'g3', gameDate: '2025-11-03', side: 'short' });
  // Added for the Nov 4 games, which have not been played yet.
  const late = fee({ entryId: 'open-c', positionId: 'pos-3', createdAt: '2025-11-04T12:00:00.000Z' });
  const feed = buildResultsFeed(
    source([nov1, nov3], [opening, openingShort, drop, late], [position('pos-1', 'long'), position('pos-2', 'short')]),
    { lastSettledDate: '2025-11-03' },
  );
  assert.deepEqual(shape(feed), [
    'night:2025-11-04',
    'fee:open-c',
    'night:2025-11-03',
    'result:pos-2:g3',
    'night:2025-11-02',
    'fee:drop-a',
    'night:2025-11-01',
    'result:pos-1:g1',
    'fees:2025-11-01',
    'fee:open-b',
    'fee:open-a',
  ]);
  const [upcoming, , quiet, opener] = feedNights(feed);
  assert.equal(upcoming.upcoming, true);
  assert.equal(upcoming.total, -250);
  assert.equal(nightSummaryLine(upcoming), '1 roster move · games still to come');
  assert.equal(quiet.upcoming, false);
  assert.equal(nightSummaryLine(quiet), '1 roster move · none of your players played');
  assert.equal(opener.total, 50_000 - 500, 'the night the moves were made for carries their fees');
  assert.equal(nightSummaryLine(opener), '1 of 1 beat their price · fees\u00a0-$500');
  const heading = feed.find((item) => item.type === 'fees');
  assert.ok(heading && heading.type === 'fees');
  assert.deepEqual({ count: heading.count, total: heading.total, moves: heading.moves }, { count: 2, total: -500, moves: true });
  const shortFee = feed.find((item) => item.key === 'fee:open-b');
  assert.ok(shortFee && shortFee.type === 'fee');
  assert.equal(shortFee.side, 'short');
  const unknown = feed.find((item) => item.key === 'fee:open-c');
  assert.ok(unknown && unknown.type === 'fee');
  assert.equal(unknown.side, null, 'a position the bootstrap no longer lists has no known side');
});

test('a fee with no date at all still shows, after every dated day', () => {
  cursor = 200;
  const feed = buildResultsFeed(source(
    [result({ positionId: 'pos-1', gameId: 'g1', gameDate: '2025-11-01' })],
    [fee({ entryId: 'nodate', createdAt: '' })],
  ));
  assert.deepEqual(shape(feed), ['night:2025-11-01', 'result:pos-1:g1', 'night:', 'fee:nodate']);
  const undated = feedNights(feed)[1];
  assert.equal(undated.upcoming, false);
  assert.equal(nightSummaryLine(undated), '1 roster move');
});

test("every night's total matches recentEarnings for that day: corrections, dated fees and booked moves included", () => {
  cursor = 300;
  const base = result({ positionId: 'pos-1', gameId: 'g1', gameDate: '2025-11-05', dividendDollars: 150_000, netPnl: 50_000 });
  const correction = result({
    positionId: 'pos-1',
    gameId: 'g1',
    gameDate: '2025-11-05',
    resultRevision: 2,
    kind: 'correction',
    adjustsResultRevision: 1,
    dividendDollars: 120_000,
    netPnl: 20_000,
  });
  const short = result({
    positionId: 'pos-2',
    gameId: 'g2',
    gameDate: '2025-11-05',
    side: 'short',
    lockedGameCost: 80_000,
    dividendDollars: 95_000,
    netPnl: -15_000,
  });
  const ledgerRow = (overrides: Partial<PerGameLedgerEntry>) => fee({ kind: 'game_cost', ...overrides });
  const ledger = [
    fee({ kind: 'open_fee', amountDollars: -250, createdAt: '2025-11-05T12:00:00.000Z' }),
    ledgerRow({ positionId: 'pos-1', gameId: 'g1', gameDate: '2025-11-05', resultRevision: 1, kind: 'game_cost', amountDollars: -100_000 }),
    ledgerRow({ positionId: 'pos-1', gameId: 'g1', gameDate: '2025-11-05', resultRevision: 1, kind: 'game_dividend', amountDollars: 150_000 }),
    ledgerRow({ positionId: 'pos-1', gameId: 'g1', gameDate: '2025-11-05', resultRevision: 2, kind: 'dividend_correction', amountDollars: -30_000 }),
    ledgerRow({ positionId: 'pos-2', gameId: 'g2', gameDate: '2025-11-05', resultRevision: 1, kind: 'game_cost', amountDollars: 80_000 }),
    ledgerRow({ positionId: 'pos-2', gameId: 'g2', gameDate: '2025-11-05', resultRevision: 1, kind: 'game_dividend', amountDollars: -95_000 }),
    fee({ kind: 'penalty', gameDate: '2025-11-05', amountDollars: -1_000 }),
    // Booked for the next games: not part of Nov 5.
    fee({ kind: 'drop_fee', amountDollars: -250, createdAt: '2025-11-06T12:00:00.000Z' }),
  ];
  const nights = feedNights(buildResultsFeed(source([base, correction, short], ledger), { lastSettledDate: '2025-11-05' }));
  const nov5 = nights.find((night) => night.date === '2025-11-05');
  const earnings = recentEarnings(ledger, '2025-11-05');
  assert.ok(nov5 && earnings);
  assert.equal(nov5.total, 3_750);
  assert.equal(nov5.total, earnings.night);
  assert.equal(nights[0].date, '2025-11-06');
  assert.equal(nights[0].upcoming, true);
});

test('keys are unique and stable across rebuilds', () => {
  cursor = 400;
  const rows = [
    result({ positionId: 'pos-1', gameId: 'g1', gameDate: '2025-11-01' }),
    result({ positionId: 'pos-2', gameId: 'g1', gameDate: '2025-11-01' }),
    result({ positionId: 'pos-1', gameId: 'g2', gameDate: '2025-11-02' }),
  ];
  const ledger = [
    fee({ entryId: 'f1', createdAt: '2025-11-02T12:00:00.000Z' }),
    fee({ entryId: 'f2', gameDate: '2025-11-02', kind: 'penalty' }),
  ];
  const first = shape(buildResultsFeed(source(rows, ledger)));
  assert.equal(new Set(first).size, first.length);
  assert.deepEqual(shape(buildResultsFeed(source([...rows].reverse(), [...ledger].reverse()))), first);
});

test('an account with no games and no fees has an empty feed', () => {
  assert.deepEqual(buildResultsFeed(source([], [])), []);
});

test('game cost and dividend ledger rows are not listed as fees', () => {
  cursor = 500;
  const game = result({ positionId: 'pos-1', gameId: 'g1' });
  const feed = buildResultsFeed(source([game], [
    fee({ kind: 'game_cost', gameId: 'g1', gameDate: '2025-11-01', resultRevision: 1, amountDollars: -100_000 }),
    fee({ kind: 'game_dividend', gameId: 'g1', gameDate: '2025-11-01', resultRevision: 1, amountDollars: 150_000 }),
  ]));
  assert.deepEqual(shape(feed), ['night:2025-11-01', 'result:pos-1:g1']);
});

// ---------------------------------------------------------------------------
// The words on a row and in its math

test('a row pairs dividend and price for a roster spot, credit and dividend for a short, in subtracting order', () => {
  const roster = valuePair({ side: 'long', lockedGameCost: 137_500 }, 584_000);
  assert.deepEqual(roster, { first: { label: 'Dividend', amount: 584_000 }, second: { label: 'price', amount: 137_500 } });
  const short = valuePair({ side: 'short', lockedGameCost: 112_500 }, 328_000);
  assert.deepEqual(short, { first: { label: 'Credit', amount: 112_500 }, second: { label: 'dividend', amount: 328_000 } });
  // First minus second is the net, whatever the signs.
  for (const [side, price, dividend] of [
    ['long', 137_500, 584_000], ['long', 100_000, -200_000], ['short', 112_500, 328_000], ['short', 112_500, -320_000],
  ] as const) {
    const pair = valuePair({ side, lockedGameCost: price }, dividend);
    const net = side === 'long' ? dividend - price : price - dividend;
    assert.equal(pair.first.amount - pair.second.amount, net, `${side} ${dividend}`);
  }
});

test('the opened math lists each line by its effect on you, and the lines add up to the net', () => {
  const cases = [
    {
      input: { side: 'long', dividend: 584_000, price: 137_500, corrected: false },
      lines: [['Dividend collected', 584_000], ['Price charged', -137_500]],
    },
    {
      input: { side: 'long', dividend: -200_000, price: 100_000, corrected: false },
      lines: [['His dividend was -$200,000, which a roster spot pays', -200_000], ['Price charged', -100_000]],
    },
    {
      input: { side: 'short', dividend: 328_000, price: 112_500, corrected: false },
      lines: [['Price credited', 112_500], ['His dividend was $328,000, which a short pays', -328_000]],
    },
    {
      input: { side: 'short', dividend: -320_000, price: 112_500, corrected: false },
      lines: [['Price credited', 112_500], ['His dividend was -$320,000, which a short collects', 320_000]],
    },
    {
      input: { side: 'long', dividend: 0, price: 90_000, corrected: false },
      lines: [['Dividend', 0], ['Price charged', -90_000]],
    },
    {
      input: { side: 'short', dividend: -40_000, price: 90_000, corrected: true },
      lines: [['Price credited', 90_000], ['His corrected dividend was -$40,000, which a short collects', 40_000]],
    },
  ] as const;
  for (const { input, lines } of cases) {
    const got = settlementLines(input);
    assert.deepEqual(got.map((line) => [line.label, line.amount]), lines);
    const net = input.side === 'long' ? input.dividend - input.price : input.price - input.dividend;
    assert.equal(got.reduce((sum, line) => sum + line.amount, 0), net, 'the lines sum to the net');
    for (const line of got) {
      assert.doesNotMatch(line.label, /paid/i, `"paid" never names a dividend: ${line.label}`);
      assert.doesNotMatch(line.label, /^[−-]/, `no minus sign in front of a line: ${line.label}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Row model: what each status shows, decided from the real settlement equation.

function rowFor(
  row: PerGameSettledResult,
  ledger: PerGameLedgerEntry[] = [],
  results: PerGameSettledResult[] = [row],
  ledgerComplete = true,
) {
  return resultRowModel(row, settlementEquation(row, ledger, results, { ledgerComplete }));
}

test('a settled roster game opens dividend collected and price charged', () => {
  const model = rowFor(result({ lockedGameCost: 200_000, dividendDollars: 336_000, netPnl: 136_000 }));
  assert.equal(model.net, 136_000);
  assert.ok(model.math);
  assert.deepEqual(model.math.pair, {
    first: { label: 'Dividend', amount: 336_000 },
    second: { label: 'price', amount: 200_000 },
  });
  assert.deepEqual(model.math.lines, [
    { label: 'Dividend collected', amount: 336_000 },
    { label: 'Price charged', amount: -200_000 },
  ]);
  assert.equal(model.math.net, 136_000);
  assert.equal(model.adjustment, undefined);
  assert.equal(model.mismatch, false);
  assert.equal(model.correctionNumber, 0);
});

test('a settled short with a negative dividend opens with no double negative', () => {
  const model = rowFor(result({ side: 'short', lockedGameCost: 112_500, dividendDollars: -320_000, netPnl: 432_500 }));
  assert.ok(model.math);
  assert.deepEqual(model.math.pair, {
    first: { label: 'Credit', amount: 112_500 },
    second: { label: 'dividend', amount: -320_000 },
  });
  assert.deepEqual(model.math.lines, [
    { label: 'Price credited', amount: 112_500 },
    { label: 'His dividend was -$320,000, which a short collects', amount: 320_000 },
  ]);
  assert.equal(model.math.net, 432_500);
  assert.equal(model.mismatch, false);
});

test('a correction shows its P&L adjustment from the complete ledger, and numbers later corrections', () => {
  const base = result({ positionId: 'pos-c', gameId: 'gc', dividendDollars: 150_000, netPnl: 50_000 });
  const corrected = result({
    positionId: 'pos-c',
    gameId: 'gc',
    resultRevision: 2,
    kind: 'correction',
    adjustsResultRevision: 1,
    dividendDollars: 174_000,
    netPnl: 74_000,
  });
  const ledger = [fee({
    kind: 'dividend_correction',
    positionId: 'pos-c',
    gameId: 'gc',
    gameDate: '2025-11-01',
    resultRevision: 2,
    amountDollars: 24_000,
  })];
  const model = rowFor(corrected, ledger, [base, corrected]);
  assert.equal(model.correctionNumber, 1);
  assert.equal(model.adjustment, 24_000);
  assert.equal(model.net, 74_000);
  assert.equal(model.math?.lines[0].label, 'Corrected dividend collected');
  assert.equal(model.mismatch, false);

  const again = result({
    positionId: 'pos-c',
    gameId: 'gc',
    resultRevision: 3,
    kind: 'correction',
    adjustsResultRevision: 2,
    dividendDollars: 164_000,
    netPnl: 64_000,
  });
  assert.equal(rowFor(again, [], [base, corrected, again]).correctionNumber, 2);
});

test('a correction whose amount cannot be known says so instead of guessing', () => {
  // A paginated ledger with no correction rows and no earlier revision to compare.
  const settled = result({
    positionId: 'pos-o',
    gameId: 'go',
    resultRevision: 2,
    kind: 'correction',
    adjustsResultRevision: 1,
    dividendDollars: 130_000,
    netPnl: 30_000,
  });
  const model = rowFor(settled, [], [settled], false);
  assert.equal(model.correctionNumber, 1);
  assert.equal(model.adjustment, null, 'null renders "Adjustment amount unavailable."');
  assert.equal(model.net, 30_000);
  assert.ok(model.math, 'the corrected arithmetic still opens');

  // Corrected to a did-not-play: still a correction line, still no guessed amount.
  const dnp = result({
    positionId: 'pos-d',
    gameId: 'gd',
    resultRevision: 2,
    kind: 'correction',
    adjustsResultRevision: 1,
    status: 'verified_dnp',
    dividendDollars: 0,
    netPnl: 0,
  });
  const dnpModel = rowFor(dnp, [], [dnp], false);
  assert.equal(dnpModel.adjustment, null);
  assert.equal(dnpModel.math, null);
  assert.equal(dnpModel.net, 0);
});

test('a verified did-not-play game is a final $0 with nothing to open', () => {
  const model = rowFor(result({ status: 'verified_dnp', dividendDollars: 0, netPnl: 0 }));
  assert.equal(model.net, 0);
  assert.equal(model.math, null);
  assert.equal(model.adjustment, undefined);
  assert.equal(model.mismatch, false);
});

test('unsettled games and missing projections show no net at all', () => {
  for (const status of ['unsettled', 'unsettled_missing_projection'] as const) {
    const model = rowFor(result({ status, dividendDollars: null, netPnl: null }));
    assert.equal(model.net, null, `${status}: "Net profit and loss unavailable"`);
    assert.equal(model.math, null);
    assert.equal(model.mismatch, false);
  }
  // Even a provisional number is withheld until the game settles.
  assert.equal(rowFor(result({ status: 'unsettled', dividendDollars: 90_000, netPnl: -10_000 })).net, null);
  // A settled row missing its dividend is incomplete, not final.
  assert.equal(rowFor(result({ dividendDollars: null, netPnl: 5_000 })).net, null);
});

test('amounts that do not add up are flagged, and the math still opens', () => {
  const model = rowFor(result({ lockedGameCost: 100_000, dividendDollars: 150_000, netPnl: 40_000 }));
  assert.equal(model.mismatch, true, 'renders "This result does not reconcile."');
  assert.ok(model.math);
  const dnp = rowFor(result({ status: 'verified_dnp', dividendDollars: 12_000, netPnl: 0 }));
  assert.equal(dnp.mismatch, true);
});
