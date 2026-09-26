import assert from 'node:assert/strict';
import test from 'node:test';

import { carrySeasons, takeCarriedSeasons, type PastSeason } from './practiceSession';

function memoryStore() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

const first: PastSeason = { score: 5_410_000, rank: '#1 of 5', finishedOn: '2026-04-12' };
const second: PastSeason = { score: -220_000, rank: '#4 of 5', finishedOn: '2026-04-12' };

test('finished seasons ride along to the page "Play another season" loads, once', () => {
  const store = memoryStore();
  carrySeasons(store, [first, second]);
  assert.deepEqual(takeCarriedSeasons(store), [first, second]);
  // The next load (a reload of the player's own) starts the list over.
  assert.deepEqual(takeCarriedSeasons(store), []);
  assert.equal(store.map.size, 0);
});

test('a plain reload clears a list nobody handed over, and junk is ignored', () => {
  const store = memoryStore();
  store.setItem('nba-stock-market:past-seasons', JSON.stringify([first]));
  assert.deepEqual(takeCarriedSeasons(store), []);
  assert.equal(store.map.size, 0);
  store.setItem('nba-stock-market:past-seasons', JSON.stringify([first, { score: 'x' }, null]));
  store.setItem('nba-stock-market:past-seasons-carry', '1');
  assert.deepEqual(takeCarriedSeasons(store), [first]);
});

test('only the latest twenty seasons are kept', () => {
  const store = memoryStore();
  const many = Array.from({ length: 25 }, (_, index) => ({ ...first, score: index }));
  carrySeasons(store, many);
  const kept = takeCarriedSeasons(store);
  assert.equal(kept.length, 20);
  assert.equal(kept[0].score, 5);
});
