import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { openRules, registerRulesOpener } from '../state/uiActions';
import { KEYBOARD_SHORTCUTS_LABEL, RULES_CONTENTS, rulesFoldKeyboard } from './perGameRules';

const strip = () => readFileSync(resolve(import.meta.dirname, '../components/PerGameStatusStrip.tsx'), 'utf8');

test('the Rules open with a contents line whose links jump to real headings (walk 15 T1-N1)', () => {
  assert.deepEqual(RULES_CONTENTS.map((entry) => entry.label), ['Scoring', 'Shorts', 'Fees', 'Prices', 'Locks', 'Words']);
  // Every link names a heading the sheet draws (rulesSections' headings, and the glossary's).
  const headings = ['Goal', 'Scoring', 'Shorts', 'Fees', 'Prices', 'Locks', 'Words in the game'];
  for (const entry of RULES_CONTENTS) assert.ok(headings.includes(entry.heading), entry.heading);
  const source = strip();
  assert.match(source, /aria-label="Rules contents" role="navigation"/);
  assert.match(source, /\{\.\.\.jumpable\(part\.heading\)\}/);
  assert.match(source, /\{\.\.\.jumpable\('Words in the game'\)\}/);
});

test('touch-only devices fold the Keyboard section behind a toggle that says whether it is open (walk 15 T1-01)', () => {
  assert.equal(rulesFoldKeyboard(true, false), true);
  assert.equal(rulesFoldKeyboard(true, true), false);
  assert.equal(rulesFoldKeyboard(false, true), false);
  assert.equal(rulesFoldKeyboard(false, false), false);
  assert.equal(KEYBOARD_SHORTCUTS_LABEL, 'Keyboard shortcuts');
  const source = strip();
  assert.match(source, /expanded=\{keysOpen\}/);
  assert.match(source, /\{foldKeys && !keysOpen \? null : \(/);
});

test('openRules can open at a section, focused; Tab goes on from it in the page\'s order (walk 15 T3-03, walk 16 T3-02)', () => {
  const calls: Array<string | undefined> = [];
  const unregister = registerRulesOpener((section) => calls.push(section));
  assert.equal(openRules('Scoring'), true);
  assert.equal(openRules(), true);
  unregister();
  assert.equal(openRules('Scoring'), false);
  assert.deepEqual(calls, ['Scoring', undefined]);
  const source = strip();
  assert.match(source, /const timer = setTimeout\(\(\) => jumpTo\(section\), 120\);/);
  // A jumped-to heading is focusable but no stop of its own, and it leaves Tab to the browser: the next
  // Tab reaches the control after its section, not Done at the top (walk 16 T3-02).
  assert.match(source, /\.\.\.\(\{ tabIndex: -1 \} as object\),/);
  assert.doesNotMatch(source, /tabToDone/);
});
