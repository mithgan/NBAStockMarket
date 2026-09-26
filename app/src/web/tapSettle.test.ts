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

test('a tap somewhere else releases the quieted spot', async () => {
  mock.timers.enable({ apis: ['Date'], now: 5_000_000 });
  try {
    const { notePointer, settleTaps, tapsSettling } = await import('./tapSettle');
    notePointer(330, 400);
    settleTaps(250, 1200);
    // The side toggle, far away, 0.4 s later.
    mock.timers.tick(400);
    notePointer(120, 180);
    assert.equal(tapsSettling(), false);
    // Back on the first spot 0.8 s after the move: a new, deliberate tap.
    mock.timers.tick(400);
    notePointer(330, 402);
    assert.equal(tapsSettling(), false);
  } finally {
    mock.timers.reset();
  }
});

test('a deliberate scroll releases the quieted spot (walk 4 T2-04)', async () => {
  mock.timers.enable({ apis: ['Date'], now: 9_000_000 });
  try {
    const { noteScrollGesture, notePointer, settleTaps, tapsSettling } = await import('./tapSettle');
    notePointer(1160, 404);
    settleTaps(250, 1200);
    mock.timers.tick(300);
    // The wheel brings the next row's Add under the resting pointer.
    noteScrollGesture();
    mock.timers.tick(100);
    notePointer(1160, 404);
    assert.equal(tapsSettling(), false);
  } finally {
    mock.timers.reset();
  }
});

test('a screen switch keeps its spot through the new screen\'s own scroll (walk 8 T4-01)', async () => {
  mock.timers.enable({ apis: ['Date'], now: 20_000_000 });
  try {
    const { notePageScroll, notePointer, settleTaps, tapsSettling } = await import('./tapSettle');
    // "Choose who to drop" pressed at (200, 500): the Roster comes forward
    // and scrolls "Making room for …" into view 0.2 s later.
    notePointer(200, 500);
    settleTaps(0, 600, 'list', true);
    mock.timers.tick(200);
    notePageScroll();
    // The second tap of the double tap lands on a Roster row: ignored.
    mock.timers.tick(50);
    notePointer(201, 502);
    assert.equal(tapsSettling(), true);
    // A move's spot (no hold) is released by the same kind of scroll: what
    // a screen reader brought under the finger is a new choice.
    mock.timers.tick(1000);
    notePointer(200, 500);
    settleTaps(0, 1200, 'list');
    mock.timers.tick(200);
    notePageScroll();
    mock.timers.tick(50);
    notePointer(200, 500);
    assert.equal(tapsSettling(), false);
  } finally {
    mock.timers.reset();
  }
});

test('a lift still waiting for its click is the next tap, never the press being handled', async () => {
  mock.timers.enable({ apis: ['Date'], now: 30_000_000 });
  try {
    const { noteClick, notePointer, settleTaps, tapsSettling } = await import('./tapSettle');
    // Add on Donovan Mitchell, clicked.
    notePointer(339, 900, false);
    noteClick(339, 900);
    // A finger lifts from Jalen Brunson's Add; its click has not come yet
    // when a queued move quiets "the spot of the press being handled".
    mock.timers.tick(120);
    notePointer(339, 992, false);
    settleTaps(0, 1200, 'list');
    // Brunson's click arrives: it is a new press on another spot and acts.
    mock.timers.tick(20);
    noteClick(339, 992);
    assert.equal(tapsSettling(), false);
  } finally {
    mock.timers.reset();
  }
});

test('a double click whose second lift comes before the sheet quiets its spot still acts once (walk 7 T2-17)', async () => {
  mock.timers.enable({ apis: ['Date'], now: 40_000_000 });
  try {
    const { noteClick, notePointer, settleTaps, tapsSettling } = await import('./tapSettle');
    // The first click opens a player's profile.
    notePointer(500, 300, false);
    noteClick(500, 300);
    // The second lift comes before the sheet has quieted the spot.
    mock.timers.tick(40);
    notePointer(500, 300, false);
    settleTaps(0, 450);
    // Its click lands on the sheet's backdrop: ignored, the sheet stays.
    mock.timers.tick(5);
    noteClick(500, 300);
    assert.equal(tapsSettling(true), true);
  } finally {
    mock.timers.reset();
  }
});

test('a backdrop closing on the lift keeps that tap\'s click off what it uncovers (walk 10 T1-11)', async () => {
  mock.timers.enable({ apis: ['Date'], now: 70_000_000 });
  try {
    const { noteClick, notePointer, quietLift, tapsSettling } = await import('./tapSettle');
    // A finger lifts on the dimmed backdrop over +1 night; the backdrop
    // closes on that lift, before the tap's click.
    notePointer(640, 24, false);
    quietLift();
    // 77 ms later the click lands on +1 night, now uncovered: ignored.
    mock.timers.tick(77);
    noteClick(640, 24);
    assert.equal(tapsSettling(true), true);
    // A deliberate tap there a moment later acts.
    mock.timers.tick(700);
    notePointer(640, 24, false);
    noteClick(640, 24);
    assert.equal(tapsSettling(true), false);
  } finally {
    mock.timers.reset();
  }
});

test('a key press right after a click is the keyboard\'s, not a repeat tap', async () => {
  const { notePointer, notePressKey, pressedByPointer } = await import('./tapSettle');
  notePointer(10, 10);
  assert.equal(pressedByPointer(), true);
  notePressKey();
  assert.equal(pressedByPointer(), false);
});

test('a toggle wrapped by repeatSafe acts once for a double tap, twice for two taps apart', async () => {
  // Later than any real-clock quiet an earlier test left in the module.
  mock.timers.enable({ apis: ['Date'], now: Date.now() + 10_000_000 });
  try {
    const { notePointer, repeatSafe } = await import('./tapSettle');
    let flips = 0;
    const toggle = repeatSafe(() => { flips += 1; });
    notePointer(100, 100);
    toggle();
    mock.timers.tick(90);
    notePointer(101, 99);
    toggle();
    assert.equal(flips, 1);
    mock.timers.tick(600);
    notePointer(100, 100);
    toggle();
    assert.equal(flips, 2);
  } finally {
    mock.timers.reset();
  }
});
