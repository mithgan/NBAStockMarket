import assert from 'node:assert/strict';
import test from 'node:test';

import type { PerGamePosition, PerGameSettledResult } from '../api/contracts';
import {
  againRows,
  closedSpoken,
  earnLine,
  readingRevealTop,
  tipReading,
  valueMark,
  welcomeDetails,
  welcomeSteps,
  type ClosedRow,
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

function closedRow(overrides: Partial<ClosedRow> = {}): ClosedRow {
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

test('walk 10 T1-01: the welcome leads with three short steps, the details in a second part', () => {
  assert.deepEqual(welcomeSteps('2025-10-21'), [
    'Add any players you like: no budget',
    'Press +1 night to play Oct 21',
    "Beat each player's price to score",
  ]);
  assert.equal(welcomeSteps(null)[1], 'Press +1 night to play the first games');
  const details = welcomeDetails(earnLine(40_000), 250);
  // The $40K a net point, below zero, the fee and the reload, in that order.
  assert.match(details, /^Each game a player plays, you pay his price and collect his dividend: \$40K a net point/);
  assert.match(details, /below zero; you pay that too\. Each add or drop costs \$250\. Reloading starts over\.$/);
  assert.doesNotMatch(welcomeDetails(earnLine(40_000), 0), /costs/);
});

test('walk 10 T4-07: Add again stays on a player\'s newest shown row when his last stint never played', () => {
  const rows = [
    // Newest first: re-added, then dropped before he played again (folded into Fees).
    closedRow({ positionId: 'c3', unplayed: true, games: 0, total: 0, how: 'Dropped Oct 23 before he played' }),
    closedRow({ positionId: 'c2', how: 'Dropped Oct 22' }),
    closedRow({ positionId: 'c1', how: 'Dropped Oct 21', total: 194_500 }),
    closedRow({ positionId: 's1', playerId: 'cade', name: 'Cade Cunningham', side: 'short', how: 'Short ended Oct 27', endedByTerm: true }),
  ];
  const { readdable, reshortable } = againRows(rows);
  assert.deepEqual([...readdable], ['c2']);
  assert.deepEqual([...reshortable], ['s1']);
  // A player shorted after he was dropped keeps both moves, one on each side's newest row.
  const both = againRows([
    closedRow({ positionId: 's9', side: 'short', how: 'Short closed Oct 25' }),
    closedRow({ positionId: 'c9', how: 'Dropped Oct 22' }),
  ]);
  assert.deepEqual([...both.readdable], ['c9']);
  assert.deepEqual([...both.reshortable], ['s9']);
});

test('walk 10 T3-04: a Closed row is heard with its figure', () => {
  assert.equal(
    closedSpoken(closedRow({ name: 'Scottie Barnes', how: 'Dropped Oct 28 · last game Oct 27', games: 4 }), '-$612K'),
    'Scottie Barnes, dropped Oct 28 after 4 games, last game Oct 27: -$612K',
  );
  assert.equal(
    closedSpoken(closedRow({ name: 'Cade Cunningham', how: 'Short ended Oct 27', games: 5 }), '+$86.5K'),
    'Cade Cunningham, short ended Oct 27 after 5 games: +$86.5K',
  );
  assert.equal(
    closedSpoken(closedRow({ how: 'Dropped after Oct 21', games: 1 }), '+$12.9K', 'Back on your roster since Oct 22'),
    'Luka Doncic, dropped after Oct 21, 1 game: +$12.9K. Back on your roster since Oct 22',
  );
});

test('walk 10 T1-10: the first-games tip explains what is on screen', () => {
  // A short that ended inside the first week: no open row shows a tag.
  const cade = position({ positionId: 's1', playerId: 'cade', playerName: 'Cade Cunningham', side: 'short', status: 'closed', expiresOn: '2025-10-27' });
  const ended = closedRow({ positionId: 's1', playerId: 'cade', name: 'Cade Cunningham', side: 'short', total: 86_500, games: 5, how: 'Short ended Oct 27', endedByTerm: true });
  assert.deepEqual(tipReading([cade], [], [ended]), {
    side: 'short',
    tag: null,
    words: "Cade Cunningham's short ended +$86.5K: his dividends came in under his price. Results shows each game's math.",
  });
  const lost = tipReading([cade], [], [{ ...ended, total: -40_000 }]);
  assert.match(lost.words, /^Cade Cunningham's short ended -\$40K: he played well, so his dividends beat his price\./);
  // A dropped player.
  const dropped = tipReading([position({ status: 'closed' })], [], [closedRow({ name: 'Scottie Barnes', total: -612_000 })]);
  assert.equal(dropped.tag, null);
  assert.match(dropped.words, /^Scottie Barnes ended -\$612K when you dropped him: his dividends came in under your price\./);
  // An open row with a tag still leads, as before (walk 9 T1-14).
  const open = tipReading([position()], [result()], [ended]);
  assert.equal(open.tag, 'LOSING MONEY');
  assert.equal(open.words, " means his dividends came in under your price so far. Results shows each game's math.");
  // The tip side's rows show no tag, the other side's do: explain that one.
  const other = tipReading(
    [position({ positionId: 'l1', playerId: 'luka' }), position({ positionId: 's2', side: 'short', playerId: 'cade' })],
    [result({ positionId: 's2', side: 'short', dividendDollars: 100_000, netPnl: 160_000 })],
  );
  assert.equal(other.side, 'short');
  assert.equal(other.tag, 'PAYING OFF');
});

test('walk 10 T1-04: the chart names its high and low marks', () => {
  assert.equal(valueMark('zero', 0), '$0');
  assert.equal(valueMark('high', 4_560_000), 'High +$4.56M');
  assert.equal(valueMark('low', -334_000), 'Low -$334K');
});

test('walk 10 T1-07: a tapped night\'s reading comes into view, and a page that shows it stays put', () => {
  // The heading 33px above the top of the scrolling area: scroll up just past it.
  assert.equal(readingRevealTop(-33, 226), 189);
  assert.equal(readingRevealTop(0, 226), null);
  assert.equal(readingRevealTop(12, 226), null);
  // Never above the top of the page.
  assert.equal(readingRevealTop(-40, 10), 0);
});
