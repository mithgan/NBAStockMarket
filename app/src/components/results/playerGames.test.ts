import assert from 'node:assert/strict';
import test from 'node:test';

import { peekProfileReturn, returnToProfile, takeProfileReturn } from './playerGames';

const view = { metric: 'price' as const, range: null, side: 'long' as const };

test('Back from his games returns once to the screen his profile was open over (walk 16 T2-05)', () => {
  returnToProfile({ playerId: 'p1', view, tab: 'market' });
  const request = peekProfileReturn();
  assert.ok(request);
  assert.equal(request.tab, 'market');
  assert.deepEqual(request.view, view);
  // The first sheet drawn there takes it; no other sheet opens him again.
  assert.equal(takeProfileReturn(request), true);
  assert.equal(takeProfileReturn(request), false);
  assert.equal(peekProfileReturn(), null);
});

test('a return nobody took expires, so it never opens a profile later', () => {
  returnToProfile({ playerId: 'p2', view, tab: 'portfolio' });
  const request = peekProfileReturn();
  assert.ok(request);
  assert.equal(peekProfileReturn(request.at + 10_000), null);
  assert.equal(takeProfileReturn(request), false);
});
