import assert from 'node:assert/strict';
import test from 'node:test';

import type { PerGamePosition } from '../api/contracts';
import {
  closedFigures,
  compactActionBeside,
  formatAt,
  mergeClosedRows,
  oneGameFigure,
  rowLayout,
  sectionExact,
  tipReading,
  type ClosedRow,
} from './rosterView';

function position(overrides: Partial<PerGamePosition> = {}): PerGamePosition {
  return {
    positionId: 'p1',
    playerId: 'luka',
    playerName: 'Luka Doncic',
    side: 'long',
    status: 'closed',
    lockedGameCost: 260_000,
    openedEventSequence: 1,
    closedEventSequence: 2,
    expiresOn: null,
    cumulativeGameCost: 0,
    cumulativeDividend: 0,
    cumulativePnl: 0,
    ...overrides,
  };
}

function stint(overrides: Partial<ClosedRow> = {}): ClosedRow {
  return {
    positionId: 'c1',
    playerId: 'luka',
    name: 'Luka Doncic',
    side: 'long',
    total: 12_900,
    games: 1,
    how: 'Dropped Oct 22',
    endedByTerm: false,
    unplayed: false,
    ...overrides,
  };
}

// The tester's three stints, newest first: dropped Oct 23 before he played,
// then +$12.9K on Oct 22 and +$194.5K on Oct 21.
const lukaStints: ClosedRow[] = [
  stint({ positionId: 'c3', total: 0, games: 0, how: 'Dropped Oct 23 before he played', unplayed: true }),
  stint({ positionId: 'c2', total: 12_900, games: 1, how: 'Dropped Oct 22' }),
  stint({ positionId: 'c1', total: 194_500, games: 1, how: 'Dropped Oct 21' }),
];

test('walk 16 T4-04: the tip quotes a player dropped and added again as his Closed row shows him', () => {
  const reading = tipReading([position()], [], lukaStints);
  assert.deepEqual(reading, {
    side: 'long',
    tag: null,
    words: "Luka Doncic made +$207.4K over 3 stints: his dividends beat your prices. Results shows each game's math.",
  });
  // The figure is the row's own: the list's total for the group, never a stint inside it.
  const [row] = mergeClosedRows(lukaStints);
  assert.equal(formatAt(row.total, 'fine', true), '+$207.4K');
  assert.ok(reading.words.includes(`${formatAt(row.total, 'fine', true)} over ${row.how}`));
  assert.doesNotMatch(reading.words, /\$12\.9K|\$194\.5K|\$0/);
});

test('walk 16 T4-04: a group that lost, and a short group, read the same way', () => {
  const lost = tipReading([position()], [], [
    stint({ positionId: 'c2', total: -120_000, games: 2, how: 'Dropped Oct 24' }),
    stint({ positionId: 'c1', total: -248_400, games: 3, how: 'Dropped Oct 22' }),
  ]);
  assert.equal(lost.words, "Luka Doncic made -$368.4K over 2 stints: his dividends came in under your prices. Results shows each game's math.");
  const shorts = tipReading([position({ side: 'short', playerId: 'cade', playerName: 'Cade Cunningham' })], [], [
    stint({ positionId: 's2', playerId: 'cade', name: 'Cade Cunningham', side: 'short', total: 50_000, games: 2, how: 'Short closed Oct 26' }),
    stint({ positionId: 's1', playerId: 'cade', name: 'Cade Cunningham', side: 'short', total: 36_500, games: 3, how: 'Short ended Oct 24', endedByTerm: true }),
  ]);
  assert.equal(shorts.side, 'short');
  assert.equal(shorts.words, "Cade Cunningham made +$86.5K over 2 shorts: his dividends came in under his prices. Results shows each game's math.");
});

test('walk 16 T4-04: a row with no games is never the one quoted', () => {
  // A newer drop before he played (a fee only) steps aside for the newest row that played.
  const reading = tipReading([position()], [], [
    stint({ positionId: 'b1', playerId: 'barnes', name: 'Scottie Barnes', total: 0, games: 0, how: 'Dropped Oct 23 before he played', unplayed: true }),
    stint({ positionId: 'c1', total: 12_900, games: 1, how: 'Dropped Oct 22' }),
  ]);
  assert.equal(reading.words, "Luka Doncic ended +$12.9K when you dropped him: his dividends beat your price. Results shows each game's math.");
  // No row that played: the plain reading, no name and no figure.
  const none = tipReading([position()], [], [stint({ total: 0, games: 0, how: 'Dropped Oct 22 before he played', unplayed: true })]);
  assert.equal(none.tag, 'PAYING OFF');
  assert.doesNotMatch(none.words, /Luka|\$/);
});

test('walk 16 T4-04: one stint reads as before', () => {
  assert.equal(
    tipReading([position()], [], [stint({ name: 'Scottie Barnes', playerId: 'barnes', total: -612_000, games: 4 })]).words,
    "Scottie Barnes ended -$612K when you dropped him: his dividends came in under your price. Results shows each game's math.",
  );
});

test('walk 16 T1-05: a section whose rows as shown miss its total gets the exact line', () => {
  // Season end: rows read +$5.51M, -$559K and -$1.05M (a fan adds +$3.90M) under +$3.89M.
  const rows = [
    { name: 'Luka Doncic', value: 5_505_500 },
    { name: 'Scottie Barnes', value: -559_000 },
    { name: 'Jalen Duren', value: -1_054_500 },
  ];
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  assert.deepEqual(rows.map((row) => formatAt(row.value, 'fine', true)), ['+$5.51M', '-$559K', '-$1.05M']);
  assert.equal(formatAt(total, 'fine', true), '+$3.89M');
  assert.equal(
    sectionExact(rows, total),
    'Exactly +$3,892,000: Luka Doncic +$5,505,500, Scottie Barnes -$559,000, Jalen Duren -$1,054,500.',
  );
});

test('walk 16 T1-05: a section whose rows add up gets nothing, and a $0 row is not named', () => {
  assert.equal(sectionExact([{ name: 'Luka Doncic', value: 207_400 }, { name: 'Scottie Barnes', value: -40_500 }], 166_900), null);
  assert.equal(sectionExact([{ name: 'Luka Doncic', value: 5_505_500 }], 5_505_500), null);
  assert.equal(sectionExact([], 0), null);
  const line = sectionExact([
    { name: 'Luka Doncic', value: 5_505_500 },
    { name: 'Jalen Duren', value: -1_054_500 },
    { name: 'Scottie Barnes', value: 0 },
  ], 4_451_000);
  assert.equal(line, 'Exactly +$4,451,000: Luka Doncic +$5,505,500, Jalen Duren -$1,054,500.');
});

test('walk 16 T1-05: the Closed line names a player with a row on each side by his short', () => {
  const groups = mergeClosedRows([
    stint({ positionId: 's1', playerId: 'cade', name: 'Cade Cunningham', side: 'short', total: 86_500, games: 5, how: 'Short ended Oct 27', endedByTerm: true }),
    stint({ positionId: 'c1', playerId: 'cade', name: 'Cade Cunningham', total: -40_000, games: 2, how: 'Dropped Oct 24' }),
    ...lukaStints,
  ]);
  assert.deepEqual(closedFigures(groups), [
    { name: "Cade Cunningham's short", value: 86_500 },
    { name: 'Cade Cunningham', value: -40_000 },
    { name: 'Luka Doncic', value: 207_400 },
  ]);
});

test('walk 16 T4-05: a 320px row has Drop beside the name; 200% zoom and large text keep it below', () => {
  // The compact rows: a 320px phone, a 390px phone at 200% (195px), large text.
  assert.equal(rowLayout(320, 320, 1), 'compact');
  assert.equal(compactActionBeside(320, 1), true);
  assert.equal(compactActionBeside(195, 1), false);
  assert.equal(compactActionBeside(299, 1), false);
  assert.equal(compactActionBeside(390, 1.5), false);
  // 360 and wider phones are stacked rows, Drop beside the name as before.
  assert.equal(rowLayout(360, 360, 1), 'stacked');
});

test('walk 16 T4-05: one game writes Profit a game and Total once', () => {
  assert.equal(oneGameFigure(1, -29_000, -29_000), true);
  // Cents of drift between the two sums still read as one figure.
  assert.equal(oneGameFigure(1, 7_148, 7_148.4), true);
  // Two games: two amounts. No game yet, or a later correction: both lines.
  assert.equal(oneGameFigure(2, -253_500, -507_000), false);
  assert.equal(oneGameFigure(0, null, 0), false);
  assert.equal(oneGameFigure(1, 7_148, 12_000), false);
});
