import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const kit = readFileSync(resolve(__dirname, 'kit.tsx'), 'utf8');
const strip = kit.slice(kit.indexOf('export function ConfirmStrip('), kit.indexOf('export function ConfirmDialog('));

test('a question taller than its view folds its details and, if it still does not fit, opens at the question (walk 15 T3-04)', () => {
  // Measured against the list's view: taller folds the details behind "more ▾".
  assert.match(strip, /const tall = strip\.getBoundingClientRect\(\)\.height > room;/);
  assert.match(strip, /if \(tall && !folded && rest\.trim\(\)\) \{\s*setFolded\(true\);/);
  // Still read to a screen reader while folded (visually hidden, never removed).
  assert.match(strip, /<Text style=\{folded && !opened \? visuallyHidden : undefined\}>\{rest\}<\/Text>/);
  assert.match(strip, /accessibilityLabel=\{opened \? 'Less of the question' : 'More of the question'\}/);
  // Still too tall: focus the question itself (focusable by script), not Keep scrolled past it.
  assert.match(strip, /<Text ref=\{titleRef\} nativeID=\{titleId\} \{\.\.\.\(\{ tabIndex: -1 \} as object\)\}>\{title\}<\/Text>/);
  assert.match(strip, /\(titleRef\.current as unknown as \{ focus\?: \(options\?: object\) => void \} \| null\)\?\.focus\?\.\(\{ preventScroll: true \}\);/);
  // A question that fits keeps the way out focused.
  assert.match(strip, /if \(!tall\) \{[\s\S]*?keep\?\.focus\?\.\(\{ preventScroll: true \}\);/);
});

test('a question opened at its title reaches Keep before the costly answer (walk 16 T3-08)', () => {
  const kit = readFileSync(resolve(__dirname, 'kit.tsx'), 'utf8');
  const strip = kit.slice(kit.indexOf('export function ConfirmStrip('), kit.indexOf('export function ConfirmDialog('));
  // Focus on the title, then the answers in the dialogs' order.
  assert.match(strip, /\?\.focus\?\.\(\{ preventScroll: true \}\);\s+setAtTitle\(true\);/);
  assert.match(strip, /\{atTitle \? \[keepButton, confirmButton\] : \[confirmButton, keepButton\]\}/);
});
