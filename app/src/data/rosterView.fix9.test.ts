import assert from 'node:assert/strict';
import test from 'node:test';

import type { PerGameLedgerEntry, PerGamePosition, PerGameSettledResult } from '../api/contracts';
import {
  backLines,
  countedNames,
  feesDetail,
  MARK_MIN_GAP,
  spokenRepeats,
  tipTag,
  tipVerdict,
  tipWords,
  valueTicks,
  weekStepIndex,
  widestReading,
  type ClosedRow,
  type NightPoint,
} from './rosterView';

function position(overrides: Partial<PerGamePosition> = {}): PerGamePosition {
  return {
    positionId: 'p1',
    playerId: 'barnes',
    playerName: 'Scottie Barnes',
    side: 'long',
    status: 'active',
    lockedGameCost: 260_000,
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
    playerId: 'barnes',
    gameId: 'g1',
    gameDate: '2025-10-21',
    resultRevision: 1,
    side: 'long',
    kind: 'base',
    status: 'settled',
    lockedGameCost: 260_000,
    dividendDollars: 100_000,
    netPnl: -160_000,
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
    playerId: 'barnes',
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

function closedRow(overrides: Partial<ClosedRow> = {}): ClosedRow {
  return {
    positionId: 'old',
    playerId: 'barnes',
    name: 'Scottie Barnes',
    side: 'long',
    total: -366_000,
    games: 2,
    how: 'Dropped Oct 22',
    endedByTerm: false,
    unplayed: false,
    ...overrides,
  };
}

test('the Fees line names a player dropped again and again once, with his count (walk 9 T4-09)', () => {
  assert.deepEqual(countedNames(['Luka Doncic', 'Luka Doncic', 'Luka Doncic']), ['Luka Doncic ×3']);
  assert.deepEqual(
    countedNames(['Luka Doncic', 'Scottie Barnes', 'Luka Doncic']),
    ['Luka Doncic ×2', 'Scottie Barnes'],
  );
  assert.equal(
    feesDetail({ moves: 6, feeEach: 250, dropped: ['Luka Doncic', 'Luka Doncic', 'Luka Doncic'], closedShorts: [] }),
    '6 moves · $250 each · 3 dropped before playing (Luka Doncic ×3)',
  );
  assert.equal(
    feesDetail({ moves: 4, feeEach: 250, dropped: [], closedShorts: ['Cade Cunningham', 'Cade Cunningham'] }),
    '4 moves · $250 each · 2 shorts closed before playing (Cade Cunningham ×2)',
  );
  // One of each still reads as before.
  assert.equal(
    feesDetail({ moves: 13, feeEach: 250, dropped: ['Derrick White'], closedShorts: [] }),
    '13 moves · $250 each · 1 dropped before playing (Derrick White)',
  );
  // Screen readers hear the count in words.
  assert.equal(
    spokenRepeats('3 dropped before playing (Luka Doncic ×2 and Scottie Barnes)'),
    '3 dropped before playing (Luka Doncic 2 times and Scottie Barnes)',
  );
});

test('the first-night tip explains the tag the rows show (walk 9 T1-14)', () => {
  const short = position({ positionId: 's1', playerId: 'cade', playerName: 'Cade Cunningham', side: 'short' });
  const shortLost = result({ positionId: 's1', playerId: 'cade', side: 'short', netPnl: -31_500 });
  // A shorts-only player whose short lost hears what LOSING MONEY means on a short.
  assert.equal(tipVerdict([short], [shortLost], 'short'), 'loss');
  assert.equal(tipTag('loss'), 'LOSING MONEY');
  assert.equal(
    tipWords('short', 'loss'),
    " on a short means he played well: his dividends beat his price so far. Results shows each game's math.",
  );
  // Every roster row losing: the roster's reading of LOSING MONEY.
  const long = position();
  assert.equal(tipVerdict([long], [result()], 'long'), 'loss');
  assert.equal(tipWords('long', 'loss'), " means his dividends came in under your price so far. Results shows each game's math.");
  // Any row paying off keeps PAYING OFF, as before.
  const luka = position({ positionId: 'p2', playerId: 'luka', playerName: 'Luka Doncic' });
  const lukaWon = result({ positionId: 'p2', playerId: 'luka', netPnl: 194_500 });
  assert.equal(tipVerdict([long, luka], [result(), lukaWon], 'long'), 'profit');
  assert.equal(tipTag('profit'), 'PAYING OFF');
  assert.equal(tipWords('long'), " means his dividends beat your price so far. Results shows each game's math.");
  // Only rows on the tip's side, and only open ones, count; nothing played yet reads PAYING OFF.
  assert.equal(tipVerdict([long], [result()], 'short'), 'profit');
  assert.equal(tipVerdict([{ ...long, status: 'closed' }], [result()], 'long'), 'profit');
  assert.equal(tipVerdict([long], [], 'long'), 'profit');
});

test('a player on a list again says so on his latest Closed row (walk 9 T4-N2)', () => {
  const active = position({ positionId: 'new', openedEventSequence: 9 });
  const ledger = [entry({ positionId: 'new', kind: 'open_fee', createdAt: '2025-10-22T18:00:00Z' })];
  const latest = closedRow({ positionId: 'old' });
  const older = closedRow({ positionId: 'older', how: 'Dropped Oct 20' });
  assert.deepEqual(
    [...backLines([latest, older], [active], ledger)],
    [['old', 'Back on your roster since Oct 22']],
  );
  // Now on the other side, said as such; a short back in the shorts too.
  const shorted = position({ positionId: 'new', side: 'short' });
  assert.equal(backLines([latest], [shorted], ledger).get('old'), 'In your shorts since Oct 22');
  assert.equal(backLines([closedRow({ side: 'short' })], [shorted], ledger).get('old'), 'Back in your shorts since Oct 22');
  // A row folded into the Fees line is skipped for the shown one.
  const folded = closedRow({ positionId: 'folded', unplayed: true, games: 0, total: 0 });
  assert.equal(backLines([folded, latest], [active], ledger).get('old'), 'Back on your roster since Oct 22');
  // Not held now: nothing to say; no fee day: no date.
  assert.equal(backLines([latest], [], ledger).size, 0);
  assert.equal(backLines([latest], [active], []).get('old'), 'Back on your roster');
});

function night(date: string, cumulativePnl: number, change: number): NightPoint {
  return { eventCursor: 0, cumulativePnl, kind: 'night', date, label: date.slice(5), change };
}

const START: NightPoint = { eventCursor: 0, cumulativePnl: 0, kind: 'start', date: null, label: 'Start', change: 0 };

test('Page Up and Page Down on the score chart step a week by date (walk 9 T3-N1)', () => {
  // Nights on most days, with gaps: Oct 21-27, Oct 29, Nov 1-4.
  const dates = ['2025-10-21', '2025-10-22', '2025-10-23', '2025-10-24', '2025-10-25', '2025-10-26', '2025-10-27',
    '2025-10-29', '2025-11-01', '2025-11-02', '2025-11-03', '2025-11-04'];
  const series = [START, ...dates.map((date, index) => night(date, index * 1000, 1000))];
  const at = (date: string) => series.findIndex((point) => point.date === date);
  // A week back from Nov 4 is the last night on or before Oct 28: Oct 27.
  assert.equal(weekStepIndex(series, at('2025-11-04'), -1), at('2025-10-27'));
  // A week on from Oct 22 is the first night on or after Oct 29.
  assert.equal(weekStepIndex(series, at('2025-10-22'), 1), at('2025-10-29'));
  // The start counts as the day before the first night: a week on is Oct 27.
  assert.equal(weekStepIndex(series, 0, 1), at('2025-10-27'));
  // Nothing that far: the ends.
  assert.equal(weekStepIndex(series, at('2025-10-25'), -1), 0);
  assert.equal(weekStepIndex(series, at('2025-10-29'), 1), series.length - 1);
  assert.equal(weekStepIndex([START], 0, 1), 0);
});

test('the chart heading keeps the room of its longest reading (walk 9 T1-03)', () => {
  // Oct 22 carries a fee since the night before: its reading adds "Fees -$250".
  const series = [START, night('2025-10-21', -120_500, -120_500), night('2025-10-22', -161_250, -40_500), night('2025-10-23', -100_000, 61_250)];
  assert.equal(widestReading(series), 2);
  assert.equal(widestReading([START]), 0);
});

test('a high or low mark gives way when its words come within 12px of "$0" (walk 9 T1-11)', () => {
  // A 120px phone plot, 8px inset: -$334K at the bottom, +$232K near the top.
  const yOf = (value: number) => 8 + ((232_000 - value) / (232_000 + 334_000)) * 104;
  const values = [0, 232_000, -334_000];
  assert.deepEqual(valueTicks(values, yOf, { height: 120, minGap: MARK_MIN_GAP }).map((tick) => tick.kind), ['high', 'zero', 'low']);
  // A high whose mark would sit 20px from $0 (8px of air) gives way; $0 stays.
  const close = (value: number) => 50 - value / 1000 * 20 / 100;
  assert.deepEqual(valueTicks([0, 100_000], close, { height: 120, minGap: MARK_MIN_GAP }).map((tick) => tick.kind), ['zero']);
  // 26px away (12px of air) it keeps its mark.
  const clear = (value: number) => 50 - value / 1000 * 26 / 100;
  assert.deepEqual(valueTicks([0, 100_000], clear, { height: 120, minGap: MARK_MIN_GAP }).map((tick) => tick.kind), ['high', 'zero']);
});
