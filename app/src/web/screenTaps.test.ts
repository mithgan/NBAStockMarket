import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tapPauseWait } from './screenTaps';

test('a change that would move the screen\'s foot waits until the taps pause (walk 16 T1-11)', () => {
  // Adds 0.3, 0.7 and 1.3 s apart all found the strip in walk 16: the pause is 1.5 s.
  assert.equal(tapPauseWait(300, 1500), 1200);
  assert.equal(tapPauseWait(1300, 1500), 200);
  assert.equal(tapPauseWait(1500, 1500), 0);
  // No tap yet: nothing waits.
  assert.equal(tapPauseWait(Number.POSITIVE_INFINITY, 1500), 0);
});
