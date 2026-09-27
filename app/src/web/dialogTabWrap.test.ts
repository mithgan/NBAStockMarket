import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { dialogWrapTarget } from './dialogTabWrap';

// Nodes as page positions: a stop's number is where it sits in the dialog.
const order = (a: number, b: number) => Math.sign(a - b);
// Done (1), the scroll body (2), a section link inside it (3), "Got it" (9).
const stops = [1, 2, 3, 9];

test('Shift+Tab on a dialog\'s first stop goes to its last, never to the scroll body (walk 16 T3-01)', () => {
  assert.equal(dialogWrapTarget(stops, 1, true, order), 9);
  // From the body, the browser's own order runs (back to Done).
  assert.equal(dialogWrapTarget(stops, 2, true, order), null);
  assert.equal(dialogWrapTarget(stops, 9, true, order), null);
});

test('Tab on a dialog\'s last stop goes to its first; between them the browser moves (walk 16 T3-01)', () => {
  assert.equal(dialogWrapTarget(stops, 9, false, order), 1);
  assert.equal(dialogWrapTarget(stops, 1, false, order), null);
  assert.equal(dialogWrapTarget(stops, 3, false, order), null);
});

test('a heading a section link focused lets Tab go on to the control after its section (walk 16 T3-02)', () => {
  // The Locks heading sits at 5, between the link (3) and "Got it" (9).
  assert.equal(dialogWrapTarget(stops, 5, false, order), null);
  assert.equal(dialogWrapTarget(stops, 5, true, order), null);
  // Something focused before every stop (a title, the dialog itself) goes back to the last.
  assert.equal(dialogWrapTarget(stops, 0, true, order), 9);
  // Something after every stop goes on to the first.
  assert.equal(dialogWrapTarget(stops, 12, false, order), 1);
  assert.equal(dialogWrapTarget([], 1, true, order), null);
});

test('the wrap is installed once for every dialog, and the Rules headings leave Tab alone (walk 16 T3-01, T3-02)', () => {
  const app = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf8');
  assert.match(app, /installDialogTabWrap\(\);/);
  const strip = readFileSync(resolve(__dirname, '../components/PerGameStatusStrip.tsx'), 'utf8');
  assert.doesNotMatch(strip, /tabToDone/);
});
