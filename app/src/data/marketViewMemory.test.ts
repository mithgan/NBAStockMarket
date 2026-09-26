import assert from 'node:assert/strict';
import test from 'node:test';

import { forgetMarket, marketMemory, openingSide, rememberMarket } from './marketViewMemory';

test('the market keeps side, sort, search and place for the session (T2-50, T4-16)', () => {
  forgetMarket();
  assert.equal(marketMemory().side, 'long');
  rememberMarket({ side: 'short', sort: 'value', query: 'an', watchedOnly: true, anchorId: 'p9', offset: 640, width: 390 });
  assert.deepEqual(
    { ...marketMemory() },
    { side: 'short', sort: 'value', reversed: false, query: 'an', watchedOnly: true, anchorId: 'p9', offset: 640, width: 390, lastInitialSide: null },
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
