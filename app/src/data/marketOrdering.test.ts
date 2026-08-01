import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMarketRows, type BuildMarketRowsInput } from './marketOrdering';
import type { Player } from './types';
import type { TrendPoint } from './trendPresentation';

function player(id: string, name: string, listingPrice: number, extra: Partial<Player> = {}): Player {
  return {
    id,
    name,
    tier: 'mid',
    listing_price: listingPrice,
    actual_salary: listingPrice,
    available_shares: 100,
    buy_fee: Math.round(listingPrice * 0.0025),
    ownership_bps: 100,
    shares_outstanding: 100,
    volume_30d: 10,
    ...extra,
  };
}

function trend(surprise: number): TrendPoint[] {
  return [{ date: '2025-11-01', np: 20 + surprise, expected_np: 20, dividend_per_holder: surprise * 40_000 }];
}

const players = [
  player('a', 'Cody Alpha', 10_000_000),
  player('b', 'Bo Beta', 30_000_000),
  player('c', 'Ann Gamma', 20_000_000),
];

const baseInput: BuildMarketRowsInput = {
  players,
  prices: { a: 12_000_000, b: 27_000_000, c: 20_000_000 },
  trends: { a: trend(5), b: trend(-3) },
  freeCash: 15_000_000,
  isHeld: (id) => id === 'b',
  query: '',
  sort: 'value',
  filter: 'all',
};

test('value sort ranks by live price, not the opening listing', () => {
  const rows = buildMarketRows(baseInput);
  assert.deepEqual(rows.map((row) => row.player.id), ['b', 'c', 'a']);
  assert.equal(rows[0].currentPrice, 27_000_000);
});

test('move sort ranks by percentage change since listing', () => {
  const rows = buildMarketRows({ ...baseInput, sort: 'move' });
  // a is +20%, c is flat, b is -10%.
  assert.deepEqual(rows.map((row) => row.player.id), ['a', 'c', 'b']);
});

test('form sort ranks by recent surprise and pushes players without games last', () => {
  const rows = buildMarketRows({ ...baseInput, sort: 'form' });
  assert.deepEqual(rows.map((row) => row.player.id), ['a', 'b', 'c']);
  assert.equal(rows.at(-1)!.formSurprise, null);
});

test('name sort is alphabetical regardless of price', () => {
  const rows = buildMarketRows({ ...baseInput, sort: 'name' });
  assert.deepEqual(rows.map((row) => row.player.name), ['Ann Gamma', 'Bo Beta', 'Cody Alpha']);
});

test('owned filter keeps only held players', () => {
  const rows = buildMarketRows({ ...baseInput, filter: 'held' });
  assert.deepEqual(rows.map((row) => row.player.id), ['b']);
  assert.equal(rows[0].held, true);
});

test('affordable filter excludes held, sold out, and too-expensive listings', () => {
  const soldOut = player('d', 'Dee Delta', 1_000_000, { available_shares: 0 });
  const rows = buildMarketRows({
    ...baseInput,
    players: [...players, soldOut],
    prices: { ...baseInput.prices, d: 1_000_000 },
    filter: 'affordable',
  });
  // b is held, c costs 20M against 15M cash, d is sold out — only a survives.
  assert.deepEqual(rows.map((row) => row.player.id), ['a']);
});

test('affordable filter hides players blocked by an active weekly short', () => {
  // A shorted player is unowned, in stock, and cheap enough — only the block
  // keeps it out of a filter that promises the row is buyable.
  const unblocked = buildMarketRows({ ...baseInput, filter: 'affordable' });
  assert.deepEqual(unblocked.map((row) => row.player.id), ['a']);

  const blocked = buildMarketRows({
    ...baseInput,
    filter: 'affordable',
    isBlocked: (id) => id === 'a',
  });
  assert.deepEqual(blocked.map((row) => row.player.id), []);
});

test('blocked players still appear under the all filter', () => {
  const rows = buildMarketRows({ ...baseInput, isBlocked: (id) => id === 'a' });
  assert.ok(rows.some((row) => row.player.id === 'a'));
  assert.equal(rows.find((row) => row.player.id === 'a')!.affordable, false);
});

test('affordability accounts for the account-specific buy fee', () => {
  const rows = buildMarketRows({
    ...baseInput,
    // Exactly the price but not the fee on top of it.
    freeCash: 12_000_000,
    filter: 'affordable',
  });
  assert.deepEqual(rows.map((row) => row.player.id), []);
});

test('search matches on any part of the name, case insensitively', () => {
  assert.deepEqual(
    buildMarketRows({ ...baseInput, query: 'gamma' }).map((row) => row.player.id),
    ['c'],
  );
  assert.deepEqual(
    buildMarketRows({ ...baseInput, query: '  BO  ' }).map((row) => row.player.id),
    ['b'],
  );
  assert.deepEqual(buildMarketRows({ ...baseInput, query: 'zzz' }), []);
});

test('search and filter combine instead of overriding each other', () => {
  const rows = buildMarketRows({ ...baseInput, query: 'a', filter: 'held' });
  assert.deepEqual(rows.map((row) => row.player.id), ['b']);
});

test('ordering never mutates the caller player list', () => {
  const original = players.map((entry) => entry.id);
  buildMarketRows({ ...baseInput, sort: 'name' });
  assert.deepEqual(players.map((entry) => entry.id), original);
});
