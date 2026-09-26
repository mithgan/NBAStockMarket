import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

test('a repeat on the answered spot is ignored longer than a tap elsewhere (walk 3 T4-13, T4-14)', async () => {
  mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  try {
    const { notePointer, pressedByPointer, settleTaps, tapsSettling } = await import('./tapSettle');
    // Keep in a Drop question, answered with a finger at (330, 540).
    notePointer(330, 540);
    assert.equal(pressedByPointer(), true);
    settleTaps(400, 1400);
    // A second tap 0.2 s later anywhere is part of the same gesture.
    mock.timers.tick(200);
    notePointer(120, 300);
    assert.equal(tapsSettling(), true);
    // 0.6 s later: the same spot is still the same intent (the row below slid
    // under the finger); a tap elsewhere is a new intent and goes through.
    mock.timers.tick(400);
    notePointer(334, 546);
    assert.equal(tapsSettling(), true);
    notePointer(330, 700);
    assert.equal(tapsSettling(), false);
    // 1.5 s after answering, even the same spot is a deliberate new tap.
    mock.timers.tick(900);
    notePointer(330, 540);
    assert.equal(tapsSettling(), false);
    // A keyboard press has no fresh pointer: only the short quiet applies.
    mock.timers.tick(1000);
    assert.equal(pressedByPointer(), false);
    settleTaps(250, 1200);
    mock.timers.tick(300);
    assert.equal(tapsSettling(), false);
  } finally {
    mock.timers.reset();
  }
});
