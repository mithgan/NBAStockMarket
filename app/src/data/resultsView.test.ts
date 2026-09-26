import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  PerGameLedgerEntry,
  PerGamePosition,
  PerGameSettledResult,
} from '../api/contracts';
import { settlementEquation } from '../state/perGameState';
import { earningsBetween, recentEarnings } from './perGameMetrics';
import {
  buildResultsFeed,
  dividendBasisLine,
  feeDay,
  feedNights,
  feesLineName,
  nightSummaryLine,
  nightTotalPending,
  resultRowModel,
  monthAnchors,
  nightSummaryWrapped,
  settlementLines,
  valuePair,
  visibleFeed,
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

test('a fee dated to a game night sits in that night on its own line, apart from what the players made', () => {
  const game = result({ positionId: 'pos-1', gameId: 'g1', gameDate: '2025-11-02', netPnl: 60_000 });
  const penalty = fee({ kind: 'penalty', gameDate: '2025-11-02', amountDollars: -5_000 });
  const feed = buildResultsFeed(source([game], [penalty], [position('pos-1', 'long')]));
  assert.deepEqual(shape(feed), ['night:2025-11-02', 'result:pos-1:g1', 'fees:2025-11-02', `fee:${penalty.entryId}`]);
  const [night] = feedNights(feed);
  assert.equal(night.total, 60_000, 'the header is games only');
  assert.equal(night.fees, -5_000);
  assert.equal(night.feeCount, 1);
  assert.equal(night.scoreChange, 55_000);
  assert.equal(nightSummaryLine(night), '1 of 1 beat their price');
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
    'fees:2025-11-04',
    'fee:open-c',
    'night:2025-11-03',
    'result:pos-2:g3',
    'night:2025-11-02',
    'fees:2025-11-02',
    'fee:drop-a',
    'night:2025-11-01',
    'result:pos-1:g1',
    'fees:2025-11-01',
    'fee:open-b',
    'fee:open-a',
  ]);
  const [upcoming, , quiet, opener] = feedNights(feed);
  assert.equal(upcoming.upcoming, true);
  assert.equal(upcoming.total, 0, 'no games yet: nothing made');
  assert.equal(upcoming.fees, -250);
  assert.equal(nightSummaryLine(upcoming), 'games still to come');
  assert.equal(quiet.upcoming, false);
  assert.equal(nightSummaryLine(quiet), 'none of your players played');
  assert.equal(opener.total, 50_000, 'the header is what the players made');
  assert.equal(opener.fees, -500, 'the moves made for that night are on their own line');
  assert.equal(opener.scoreChange, 49_500);
  assert.equal(nightSummaryLine(opener), '1 of 1 beat their price');
  const heading = feed.find((item) => item.key === 'fees:2025-11-01');
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
  assert.deepEqual(shape(feed), ['night:2025-11-01', 'result:pos-1:g1', 'night:', 'fees:', 'fee:nodate']);
  const undated = feedNights(feed)[1];
  assert.equal(undated.upcoming, false);
  assert.equal(undated.fees, -250);
  assert.equal(nightSummaryLine(undated), '');
});

test("each night's header is what the players made, equal to recentEarnings' games-only night; its fees line holds the rest", () => {
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
  // The header: the corrected +$20K and the short's -$15K, and no fees.
  assert.equal(nov5.total, 5_000);
  assert.equal(nov5.total, earnings.night, 'the newest night equals "Last night"');
  // The fees line: the add booked that day and the penalty dated to it.
  assert.equal(nov5.fees, -1_250);
  assert.equal(nov5.feeCount, 2);
  // Together they are everything the day did to the score.
  assert.equal(nov5.scoreChange, earningsBetween(ledger, '2025-11-04', '2025-11-05'));
  assert.equal(nov5.scoreChange, 3_750);
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

test('every row keeps one column order: price or credit, then dividend, then profit', () => {
  const roster = valuePair({ side: 'long', lockedGameCost: 137_500 }, 584_000);
  assert.deepEqual(roster, { first: { label: 'Price', amount: 137_500 }, second: { label: 'dividend', amount: 584_000 } });
  const short = valuePair({ side: 'short', lockedGameCost: 112_500 }, 328_000);
  assert.deepEqual(short, { first: { label: 'Credit', amount: 112_500 }, second: { label: 'dividend', amount: 328_000 } });
  // The dividend is always the second amount; the side says which way the profit runs.
  for (const [side, price, dividend] of [
    ['long', 137_500, 584_000], ['long', 100_000, -200_000], ['short', 112_500, 328_000], ['short', 112_500, -320_000],
  ] as const) {
    const pair = valuePair({ side, lockedGameCost: price }, dividend);
    assert.equal(pair.first.amount, price, `${side} ${dividend}: price first`);
    assert.equal(pair.second.amount, dividend, `${side} ${dividend}: dividend second`);
  }
});

test('the opened math lists each line by its effect on you, and the lines add up to the net', () => {
  const cases = [
    {
      input: { side: 'long', dividend: 584_000, price: 137_500, corrected: false },
      lines: [['Price charged', -137_500], ['Dividend collected', 584_000]],
    },
    {
      input: { side: 'long', dividend: -200_000, price: 100_000, corrected: false },
      lines: [['Price charged', -100_000], ['Bad game: his dividend was below zero, so you also paid $200,000', -200_000]],
    },
    {
      input: { side: 'short', dividend: 328_000, price: 112_500, corrected: false },
      lines: [['Price credited', 112_500], ['His dividend was $328,000, which a short pays', -328_000]],
    },
    {
      input: { side: 'short', dividend: -320_000, price: 112_500, corrected: false },
      lines: [['Price credited', 112_500], ['Bad game: his dividend was below zero, so your short also collected $320,000', 320_000]],
    },
    {
      input: { side: 'long', dividend: 0, price: 90_000, corrected: false },
      lines: [['Price charged', -90_000], ['Dividend', 0]],
    },
    {
      input: { side: 'short', dividend: -40_000, price: 90_000, corrected: true },
      lines: [['Price credited', 90_000], ['Bad game: his corrected dividend was below zero, so your short also collected $40,000', 40_000]],
    },
  ] as const;
  for (const { input, lines } of cases) {
    const got = settlementLines(input);
    assert.deepEqual(got.map((line) => [line.label, line.amount]), lines);
    const net = input.side === 'long' ? input.dividend - input.price : input.price - input.dividend;
    assert.equal(got.reduce((sum, line) => sum + line.amount, 0), net, 'the lines sum to the net');
    for (const line of got) {
      // "paid" never names a dividend on its own (it ran backwards for
      // shorts); it only ever says who paid: "you also paid" (walk 4 T2-09).
      assert.doesNotMatch(line.label.replace(/\byou also paid\b/, ''), /paid/i, `"paid" never names a dividend: ${line.label}`);
      assert.doesNotMatch(line.label, /^[−-]/, `no minus sign in front of a line: ${line.label}`);
      assert.doesNotMatch(line.label, /[−-]\$/, `no negative amount inside a line's words: ${line.label}`);
    }
  }
});

test('a dividend below zero reads as a plain cost on a roster spot, never a double negative (walk 4 T2-09)', () => {
  // Dec 1, Jalen Duren at $176K: his dividend was -$128K.
  const lines = settlementLines({ side: 'long', dividend: -128_000, price: 176_000, corrected: false });
  assert.deepEqual(lines, [
    { label: 'Price charged', amount: -176_000 },
    { label: 'Bad game: his dividend was below zero, so you also paid $128,000', amount: -128_000 },
  ]);
  assert.equal(lines.reduce((sum, line) => sum + line.amount, 0), -304_000, 'still adds up to the row');
  assert.doesNotMatch(lines[1].label, /which a roster spot pays|-\$/);
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

test('a settled roster game opens price charged and dividend collected', () => {
  const model = rowFor(result({ lockedGameCost: 200_000, dividendDollars: 336_000, netPnl: 136_000 }));
  assert.equal(model.net, 136_000);
  assert.ok(model.math);
  assert.deepEqual(model.math.pair, {
    first: { label: 'Price', amount: 200_000 },
    second: { label: 'dividend', amount: 336_000 },
  });
  assert.deepEqual(model.math.lines, [
    { label: 'Price charged', amount: -200_000 },
    { label: 'Dividend collected', amount: 336_000 },
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
    { label: 'Bad game: his dividend was below zero, so your short also collected $320,000', amount: 320_000 },
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
  assert.equal(model.math?.lines[1].label, 'Corrected dividend collected');
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

// ---------------------------------------------------------------------------
// One money format: nights carry no precision of their own.

test('no night or row carries a precision of its own: every amount uses the one money format', () => {
  cursor = 600;
  const drifted = result({ positionId: 'pos-d', gameId: 'd1', gameDate: '2025-11-06', lockedGameCost: 137_851, dividendDollars: 584_000, netPnl: 446_149 });
  const feed = buildResultsFeed(source([drifted], [fee({ createdAt: '2025-11-06T23:45:00.000Z' })]));
  for (const item of feed) {
    assert.ok(!('exact' in item), `${item.key} has no exact flag`);
    if (item.type === 'night') assert.ok(!('exact' in item.night), 'nor does its night');
  }
});

// ---------------------------------------------------------------------------
// Days with only moves

test('moves made before your first games read as moves, not as a night nobody played', () => {
  cursor = 700;
  // Practice Day 0: moves booked on the opening eve, which is the last settled day.
  const eve = [0, 1, 2].map((index) => fee({ entryId: `eve-${index}`, positionId: `pos-${index}`, createdAt: '2025-10-20T23:45:00.000Z' }));
  const feed = buildResultsFeed(source([], eve), { lastSettledDate: '2025-10-20' });
  assert.deepEqual(shape(feed), ['night:2025-10-20', 'fees:2025-10-20', 'fee:eve-2', 'fee:eve-1', 'fee:eve-0']);
  const [night] = feedNights(feed);
  assert.equal(night.beforeGames, true);
  assert.equal(night.upcoming, false);
  assert.equal(nightSummaryLine(night), '', 'no "none of your players played" before any game');
  const fold = feed[1];
  assert.ok(fold.type === 'fees');
  assert.deepEqual({ count: fold.count, total: fold.total, moves: fold.moves }, { count: 3, total: -750, moves: true });

  // Once games have been played, a later day with only moves still says why.
  const game = result({ positionId: 'pos-0', gameId: 'g1', gameDate: '2025-10-21' });
  const later = fee({ entryId: 'later', kind: 'drop_fee', createdAt: '2025-10-22T23:45:00.000Z' });
  const season = feedNights(buildResultsFeed(source([game], [...eve, later]), { lastSettledDate: '2025-10-22' }));
  assert.deepEqual(season.map((day) => [day.date, day.beforeGames, nightSummaryLine(day)]), [
    ['2025-10-22', false, 'none of your players played'],
    ['2025-10-21', false, '1 of 1 beat their price'],
    ['2025-10-20', true, ''],
  ]);
});

test('a day whose moves include a short is "Moves", not "Roster moves"', () => {
  cursor = 750;
  const adds = [0, 1].map((index) => fee({ entryId: `add-${index}`, positionId: `pos-${index}`, createdAt: '2025-10-20T23:45:00.000Z' }));
  const short = fee({ entryId: 'short', positionId: 'pos-9', createdAt: '2025-10-20T23:50:00.000Z' });
  const positions = [position('pos-0', 'long'), position('pos-1', 'long'), position('pos-9', 'short')];
  const folds = (ledger: PerGameLedgerEntry[]) => buildResultsFeed(source([], ledger, positions), { lastSettledDate: '2025-10-20' })
    .flatMap((item) => (item.type === 'fees' ? [feesLineName(item.moves, item.shorts)] : []));
  assert.deepEqual(folds(adds), ['Roster moves']);
  assert.deepEqual(folds([...adds, short]), ['Moves']);
  assert.deepEqual(folds([short]), ['Moves']);
  assert.equal(feesLineName(false, true), 'Fees', 'a penalty or account fee is still a fee');
});

test('fee rows stay folded under their day until that day is opened', () => {
  cursor = 800;
  const game = result({ positionId: 'pos-1', gameId: 'g1', gameDate: '2025-11-02' });
  const fees = [fee({ entryId: 'a', createdAt: '2025-11-02T23:45:00.000Z' }), fee({ entryId: 'b', createdAt: '2025-11-01T23:45:00.000Z' })];
  const feed = buildResultsFeed(source([game], fees));
  assert.deepEqual(shape(visibleFeed(feed, new Set())), ['night:2025-11-02', 'result:pos-1:g1', 'fees:2025-11-02', 'night:2025-11-01', 'fees:2025-11-01']);
  assert.deepEqual(shape(visibleFeed(feed, new Set(['2025-11-01']))), ['night:2025-11-02', 'result:pos-1:g1', 'fees:2025-11-02', 'night:2025-11-01', 'fees:2025-11-01', 'fee:b']);
});

// ---------------------------------------------------------------------------
// Night headers

test('a night header wraps between phrases, never inside one', () => {
  cursor = 900;
  const games = [
    result({ positionId: 'pos-1', gameId: 'w1', gameDate: '2025-11-03', netPnl: 10_000 }),
    result({ positionId: 'pos-2', gameId: 'w2', gameDate: '2025-11-03', side: 'short', netPnl: 20_000 }),
    result({ positionId: 'pos-3', gameId: 'w3', gameDate: '2025-11-03', side: 'short', netPnl: -5_000 }),
  ];
  const [night] = feedNights(buildResultsFeed(source(games)));
  assert.equal(nightSummaryLine(night), '1 of 1 beat their price · 1 of 2 shorts paid off');
  const wrapped = nightSummaryWrapped(night);
  // The only breakable space is between the two phrases; "off" stays with its phrase.
  assert.deepEqual(wrapped.split(' '), ['1 of 1 beat their price ·', '1 of 2 shorts paid off']);
});

// ---------------------------------------------------------------------------
// The math behind a dividend

test('the math shows the net points behind a dividend, and only when they multiply back exactly', () => {
  assert.equal(dividendBasisLine({ dividend: 296_000, rate: 40_000, basis: 'raw_net_points' }), '7.4 net points ×\u00a0$40,000 =\u00a0$296,000');
  assert.equal(dividendBasisLine({ dividend: -104_000, rate: 40_000, basis: 'raw_net_points' }), '-2.6 net points ×\u00a0$40,000 =\u00a0-$104,000');
  assert.equal(dividendBasisLine({ dividend: 0, rate: 40_000, basis: 'raw_net_points' }), '0.0 net points ×\u00a0$40,000 =\u00a0$0');
  assert.equal(
    dividendBasisLine({ dividend: 90_000, rate: 40_000, basis: 'surprise_vs_projection' }),
    '2.25 net points over his projection ×\u00a0$40,000 =\u00a0$90,000',
  );
  assert.equal(dividendBasisLine({ dividend: 123_457, rate: 40_000, basis: 'raw_net_points' }), null, 'no rounded equation');
  assert.equal(dividendBasisLine({ dividend: 296_000, rate: 0, basis: 'raw_net_points' }), null, 'no rate, no line');
});

// ---------------------------------------------------------------------------
// Long seasons: month jump

test('a long feed offers one jump per month, newest first, at that month\'s newest day', () => {
  cursor = 1000;
  const games = ['2025-12-02', '2025-11-30', '2025-11-02', '2025-10-22'].map((gameDate, index) => result({
    positionId: `pos-${index}`, gameId: `m${index}`, gameDate,
  }));
  const feed = buildResultsFeed(source(games, [fee({ entryId: 'eve', createdAt: '2025-10-20T23:45:00.000Z' })]));
  const anchors = monthAnchors(feed);
  assert.deepEqual(anchors.map((anchor) => [anchor.key, anchor.label, anchor.date]), [
    ['2025-12', 'Dec', '2025-12-02'],
    ['2025-11', 'Nov', '2025-11-30'],
    ['2025-10', 'Oct', '2025-10-22'],
  ]);
  for (const anchor of anchors) {
    const item = feed[anchor.index];
    assert.ok(item.type === 'night' && item.night.date === anchor.date, `${anchor.key} points at its header`);
  }
  assert.equal(anchors[0].name, 'December 2025');
  // Twelve months apart, the short label carries the year so two Octobers differ.
  const twoSeasons = monthAnchors(buildResultsFeed(source([
    result({ positionId: 'pos-a', gameId: 'y1', gameDate: '2026-10-21' }),
    result({ positionId: 'pos-b', gameId: 'y2', gameDate: '2025-10-21' }),
  ])));
  assert.deepEqual(twoSeasons.map((anchor) => anchor.label), ['Oct 26', 'Oct 25']);
});

test('a day\'s moves live inside their fold as one list, each read with the player named once (walk 3 T3-32)', async () => {
  const { foldedFeed, movesByDay, moveWords } = await import('./resultsView');
  cursor = 900;
  const game = result({ positionId: 'pos-1', gameId: 'g1', gameDate: '2025-11-02' });
  const fees = [
    fee({ entryId: 'a', createdAt: '2025-11-02T23:45:00.000Z' }),
    fee({ entryId: 'b', createdAt: '2025-11-01T23:45:00.000Z' }),
    fee({ entryId: 'c', createdAt: '2025-11-01T23:40:00.000Z' }),
  ];
  const feed = buildResultsFeed(source([game], fees));
  assert.deepEqual(shape(foldedFeed(feed)), ['night:2025-11-02', 'result:pos-1:g1', 'fees:2025-11-02', 'night:2025-11-01', 'fees:2025-11-01']);
  const days = movesByDay(feed);
  assert.deepEqual([...days.keys()], ['2025-11-02', '2025-11-01']);
  // In the feed's own order, which the fold keeps.
  assert.deepEqual(days.get('2025-11-01')?.map((item) => item.key), feed.filter((item) => item.type === 'fee' && item.date === '2025-11-01').map((item) => item.key));
  assert.equal(days.get('2025-11-01')?.length, 2);
  assert.equal(moveWords('Dyson Daniels', 'Short opened', -250), 'Dyson Daniels, short opened, fee $250');
  assert.equal(moveWords('OG Anunoby', 'Dropped from your roster', -250), 'OG Anunoby, dropped from your roster, fee $250');
  assert.equal(moveWords('OG Anunoby', 'Rules penalty', -1_000, 'penalty'), 'OG Anunoby, rules penalty, penalty $1,000');
  assert.equal(moveWords('OG Anunoby', 'Account fee', 250), 'OG Anunoby, account fee, fee refunded, $250');
});
