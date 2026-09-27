import assert from 'node:assert/strict';
import test from 'node:test';
import { DRAWN_FOCUS_GRACE_MS, DRAWN_FOCUS_LIMIT_MS, drawnFocusStep } from './focusWhenDrawn';

test('a new season started from the keyboard focuses its welcome once it is drawn, however long that takes (walk 14 T2-01)', () => {
  // Still loading: wait, well past the old fixed 600 ms.
  assert.equal(drawnFocusStep({ elapsed: 2_500, idle: true, targetShown: false, readyFor: null }), 'wait');
  assert.equal(drawnFocusStep({ elapsed: 2_600, idle: true, targetShown: true, readyFor: 0 }), 'target');
});

test('a closed welcome leaves focus to the screen a moment after the season has loaded, not while it loads (walk 14 T2-01)', () => {
  assert.equal(drawnFocusStep({ elapsed: 1_400, idle: true, targetShown: false, readyFor: null }), 'wait');
  assert.equal(drawnFocusStep({ elapsed: 900, idle: true, targetShown: false, readyFor: DRAWN_FOCUS_GRACE_MS - 1 }), 'wait');
  assert.equal(drawnFocusStep({ elapsed: 1_000, idle: true, targetShown: false, readyFor: DRAWN_FOCUS_GRACE_MS }), 'fallback');
});

test('focus a player moved themselves is never taken back, and the wait ends (walk 14 T2-01)', () => {
  assert.equal(drawnFocusStep({ elapsed: 300, idle: false, targetShown: true, readyFor: 0 }), 'stop');
  assert.equal(drawnFocusStep({ elapsed: DRAWN_FOCUS_LIMIT_MS, idle: true, targetShown: false, readyFor: null }), 'stop');
});
