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
  feedNights,
  localDay,
  movesSummaryLine,
  nightSummaryLine,
  nightTotalPending,
  resultRowModel,
  type ResultsFeedItem,
  type ResultsFeedSource,
} from './resultsView';

/** Tests date ledger stamps in UTC so they pass in every time zone. */
const utcDay = (timestamp: string) => timestamp.slice(0, 10);

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
    createdAt: '2025-11-01T18:00:00Z',
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

test('a fee dated to a game night sits in that night and counts in its total', () => {
  const game = result({ positionId: 'pos-1', gameId: 'g1', gameDate: '2025-11-02', netPnl: 60_000 });
  const penalty = fee({ kind: 'penalty', gameDate: '2025-11-02', amountDollars: -5_000 });
  const feed = buildResultsFeed(source([game], [penalty], [position('pos-1', 'long')]));
  assert.deepEqual(shape(feed), ['night:2025-11-02', 'result:pos-1:g1', `fee:${penalty.entryId}`]);
  const [night] = feedNights(feed);
  assert.equal(night.gamesNet, 60_000);
  assert.equal(night.fees, -5_000);
  assert.equal(night.feeCount, 1);
  assert.equal(night.total, 55_000);
  assert.equal(nightSummaryLine(night), '1 of 1 beat their price · fees -$5K');
  const feeItem = feed[2];
  assert.ok(feeItem.type === 'fee');
  assert.equal(feeItem.date, '2025-11-02');
  assert.equal(feeItem.side, 'long');
});

test('fees with no game night become roster moves, placed where they happened', () => {
  cursor = 100;
  const openRoster = fee({ entryId: 'open-roster', positionId: 'pos-1', createdAt: '2025-10-31T20:00:00Z' });
  const openShort = fee({ entryId: 'open-short', positionId: 'pos-2', createdAt: '2025-10-31T20:05:00Z' });
  const nov1 = result({ positionId: 'pos-1', gameId: 'g1', gameDate: '2025-11-01' });
  const drop = fee({ entryId: 'drop-roster', kind: 'drop_fee', positionId: 'pos-1', createdAt: '2025-11-02T15:00:00Z' });
  const nov2 = result({ positionId: 'pos-2', gameId: 'g2', gameDate: '2025-11-02', side: 'short' });
  const late = fee({ entryId: 'open-late', positionId: 'pos-3', createdAt: '2025-11-03T12:00:00Z' });
  const feed = buildResultsFeed(source(
    [nov1, nov2],
    [openRoster, openShort, drop, late],
    [position('pos-1', 'long'), position('pos-2', 'short')],
  ), { dayOf: utcDay, nextGameDate: '2025-11-04' });
  assert.deepEqual(shape(feed), [
    'moves:open-late',
    'fee:open-late',
    'night:2025-11-02',
    'result:pos-2:g2',
    'moves:drop-roster',
    'fee:drop-roster',
    'night:2025-11-01',
    'result:pos-1:g1',
    'moves:open-short',
    'fee:open-short',
    'fee:open-roster',
  ]);
  const opening = feed.find((item) => item.key === 'moves:open-short');
  assert.ok(opening && opening.type === 'moves');
  assert.deepEqual(opening.moves, { date: '2025-10-31', before: '2025-11-01', after: null, total: -500, count: 2 });
  assert.equal(movesSummaryLine(opening.moves), '2 fees · Fri, Oct 31');
  const between = feed.find((item) => item.key === 'moves:drop-roster');
  assert.ok(between && between.type === 'moves');
  assert.deepEqual(between.moves, { date: '2025-11-02', before: '2025-11-02', after: '2025-11-01', total: -250, count: 1 });
  const top = feed.find((item) => item.key === 'moves:open-late');
  assert.ok(top && top.type === 'moves');
  assert.equal(movesSummaryLine(top.moves), '1 fee · Mon, Nov 3');
  const shortFee = feed.find((item) => item.key === 'fee:open-short');
  assert.ok(shortFee && shortFee.type === 'fee');
  assert.equal(shortFee.side, 'short');
  assert.equal(shortFee.date, null);
  const unknown = feed.find((item) => item.key === 'fee:open-late');
  assert.ok(unknown && unknown.type === 'fee');
  assert.equal(unknown.side, null, 'a position the bootstrap no longer lists has no known side');
  // Undated fees never touch a night's total.
  assert.deepEqual(feedNights(feed).map((night) => night.total), [50_000, 50_000]);
});

test('roster moves on different days get their own dated groups', () => {
  cursor = 200;
  const first = fee({ entryId: 'day-1', createdAt: '2025-11-04T10:00:00Z' });
  const second = fee({ entryId: 'day-2', createdAt: '2025-11-05T10:00:00Z', amountDollars: -500 });
  const feed = buildResultsFeed(source([], [first, second]), { dayOf: utcDay });
  assert.deepEqual(shape(feed), ['moves:day-2', 'fee:day-2', 'moves:day-1', 'fee:day-1']);
  assert.equal(feedNights(feed).length, 0);
  const newest = feed[0];
  assert.ok(newest.type === 'moves');
  assert.equal(movesSummaryLine(newest.moves), '1 fee · Wed, Nov 5');
});

test('a charge day that does not fit the season says where the moves sit instead', () => {
  // Practice mode stamps fees with the real clock while its nights replay 2025.
  cursor = 250;
  const opening = fee({ entryId: 'practice-open', createdAt: '2026-09-24T19:00:00Z' });
  const oct21 = result({ positionId: 'pos-1', gameId: 'g21', gameDate: '2025-10-21' });
  const oct22 = result({ positionId: 'pos-1', gameId: 'g22', gameDate: '2025-10-22' });
  const drop = fee({ entryId: 'practice-drop', kind: 'drop_fee', createdAt: '2026-09-24T19:30:00Z' });
  const feed = buildResultsFeed(
    source([oct21, oct22], [opening, drop], [position('pos-1', 'long')]),
    { dayOf: utcDay, nextGameDate: '2025-10-23' },
  );
  assert.deepEqual(shape(feed), [
    'moves:practice-drop',
    'fee:practice-drop',
    'night:2025-10-22',
    'result:pos-1:g22',
    'night:2025-10-21',
    'result:pos-1:g21',
    'moves:practice-open',
    'fee:practice-open',
  ]);
  const [after, , , , , , before] = feed;
  assert.ok(after.type === 'moves' && before.type === 'moves');
  assert.equal(after.moves.date, null);
  assert.equal(movesSummaryLine(after.moves), '1 fee · after the Wed, Oct 22 games');
  assert.equal(before.moves.date, null);
  assert.equal(movesSummaryLine(before.moves), '1 fee · before the Tue, Oct 21 games');

  // Opening night of practice: no night has settled, so the moves were for the next games.
  const opening2 = buildResultsFeed(source([], [opening]), { dayOf: utcDay, nextGameDate: '2025-10-21' })[0];
  assert.ok(opening2.type === 'moves');
  assert.equal(movesSummaryLine(opening2.moves), '1 fee · before the Tue, Oct 21 games');
});

test('a ledger timestamp is dated on the viewer\'s own calendar day', () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    assert.equal(localDay('2025-11-06T02:00:00Z'), '2025-11-05', '9pm Nov 5 in New York');
    assert.equal(localDay('2025-11-06T15:00:00Z'), '2025-11-06');
    process.env.TZ = 'Asia/Tokyo';
    assert.equal(localDay('2025-11-05T20:00:00Z'), '2025-11-06', '5am Nov 6 in Tokyo');
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
  assert.equal(localDay('2025-11-05'), '2025-11-05', 'a calendar day stays as it is');
});

test("the newest night's total matches recentEarnings' last night, corrections and dated fees included", () => {
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
    ledgerRow({ positionId: 'pos-1', gameId: 'g1', gameDate: '2025-11-05', resultRevision: 1, kind: 'game_cost', amountDollars: -100_000 }),
    ledgerRow({ positionId: 'pos-1', gameId: 'g1', gameDate: '2025-11-05', resultRevision: 1, kind: 'game_dividend', amountDollars: 150_000 }),
    ledgerRow({ positionId: 'pos-1', gameId: 'g1', gameDate: '2025-11-05', resultRevision: 2, kind: 'dividend_correction', amountDollars: -30_000 }),
    ledgerRow({ positionId: 'pos-2', gameId: 'g2', gameDate: '2025-11-05', resultRevision: 1, kind: 'game_cost', amountDollars: 80_000 }),
    ledgerRow({ positionId: 'pos-2', gameId: 'g2', gameDate: '2025-11-05', resultRevision: 1, kind: 'game_dividend', amountDollars: -95_000 }),
    fee({ kind: 'penalty', gameDate: '2025-11-05', amountDollars: -1_000 }),
    fee({ kind: 'open_fee', amountDollars: -250 }),
  ];
  const feed = buildResultsFeed(source([base, correction, short], ledger));
  const [night] = feedNights(feed);
  const earnings = recentEarnings(ledger, '2025-11-05');
  assert.ok(earnings);
  assert.equal(night.total, 4_000);
  assert.equal(night.total, earnings.night);
});

test('keys are unique and stable across rebuilds', () => {
  cursor = 400;
  const rows = [
    result({ positionId: 'pos-1', gameId: 'g1', gameDate: '2025-11-01' }),
    result({ positionId: 'pos-2', gameId: 'g1', gameDate: '2025-11-01' }),
    result({ positionId: 'pos-1', gameId: 'g2', gameDate: '2025-11-02' }),
  ];
  const ledger = [fee({ entryId: 'f1' }), fee({ entryId: 'f2', gameDate: '2025-11-02', kind: 'penalty' })];
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
// Row model: what each status shows, decided from the real settlement equation.

function rowFor(
  row: PerGameSettledResult,
  ledger: PerGameLedgerEntry[] = [],
  results: PerGameSettledResult[] = [row],
  ledgerComplete = true,
) {
  return resultRowModel(row, settlementEquation(row, ledger, results, { ledgerComplete }));
}

test('a settled roster game opens Dividend − Price paid = Net', () => {
  const model = rowFor(result({ lockedGameCost: 200_000, dividendDollars: 336_000, netPnl: 136_000 }));
  assert.equal(model.net, 136_000);
  assert.deepEqual(model.math, {
    firstLabel: 'Dividend',
    firstAmount: 336_000,
    secondLabel: 'Price paid',
    secondAmount: 200_000,
    net: 136_000,
  });
  assert.equal(model.adjustment, undefined);
  assert.equal(model.mismatch, false);
  assert.equal(model.correctionNumber, 0);
});

test('a settled short opens Price credited − Dividend paid = Net', () => {
  const model = rowFor(result({ side: 'short', lockedGameCost: 125_000, dividendDollars: 80_000, netPnl: 45_000 }));
  assert.deepEqual(model.math, {
    firstLabel: 'Price credited',
    firstAmount: 125_000,
    secondLabel: 'Dividend paid',
    secondAmount: 80_000,
    net: 45_000,
  });
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
  assert.equal(model.math?.firstLabel, 'Corrected dividend');
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
