import assert from 'node:assert/strict';
import test from 'node:test';

import { countsAsPress } from '../components/market/lastActivation';
import { forgetMarket, MARKET_DEFAULT_SORT, marketMemory, openingSide, rememberMarket } from './marketViewMemory';

test('the market keeps side, sort, search and place for the session (T2-50, T4-16)', () => {
  forgetMarket();
  assert.equal(marketMemory().side, 'long');
  rememberMarket({ side: 'short', sort: 'value', query: 'an', watchedOnly: true, anchorId: 'p9', offset: 640, width: 390 });
  assert.deepEqual(
    { ...marketMemory() },
    { side: 'short', sort: 'value', reversed: false, query: 'an', watchedOnly: true, anchorId: 'p9', offset: 640, width: 390, lastInitialSide: null, valueTipSeen: false, seasonOver: false },
  );
  forgetMarket();
  assert.equal(marketMemory().query, '');
});

test('a press inside a screen asks for a side; the tab bar brings back the one you left', () => {
  const remembered = { side: 'short' as const, lastInitialSide: 'long' as const };
  // Tab bar (or Back): the app still passes its last request, so memory wins.
  assert.equal(openingSide({ initialSide: 'long', remembered, requestedFromScreen: false }), 'short');
  // The Roster's "Open market" asks for the Roster side: it wins.
  assert.equal(openingSide({ initialSide: 'long', remembered, requestedFromScreen: true }), 'long');
  // A new request from the app wins even without a recorded press.
  assert.equal(openingSide({ initialSide: 'short', remembered: { side: 'long', lastInitialSide: 'long' }, requestedFromScreen: false }), 'short');
  // First visit: the app's side.
  assert.equal(openingSide({ initialSide: 'long', remembered: { side: 'long', lastInitialSide: null }, requestedFromScreen: false }), 'long');
});

test('the tab bar\'s arrow, Home and End keys count as a frame press, so the side survives (T3-20)', () => {
  // Enter and Space press anything.
  assert.equal(countsAsPress('Enter', false), true);
  assert.equal(countsAsPress(' ', false), true);
  // Arrowing along the tab bar switches tabs: it is the press that brings the Market back.
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']) {
    assert.equal(countsAsPress(key, true), true, key);
    // The same key elsewhere (scrolling, a slider) is not a press.
    assert.equal(countsAsPress(key, false), false, key);
  }
  assert.equal(countsAsPress('Tab', true), false);
  assert.equal(countsAsPress('a', true), false);
});

test("a new fan's Market opens on Value, highest first; a choice made since wins (walk 4 NYI-6)", () => {
  forgetMarket();
  assert.equal(MARKET_DEFAULT_SORT, 'value');
  assert.equal(marketMemory().sort, 'value');
  assert.equal(marketMemory().reversed, false, 'Value in its natural order: highest first');
  rememberMarket({ sort: 'price' });
  assert.equal(marketMemory().sort, 'price', 'a remembered choice wins for the session');
  forgetMarket();
  assert.equal(marketMemory().sort, 'value', 'Restart starts fresh');
});
