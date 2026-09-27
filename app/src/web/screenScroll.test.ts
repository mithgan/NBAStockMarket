import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { KEYBOARD_KEYS } from '../data/perGameRules';

const source = readFileSync(resolve(__dirname, 'screenScroll.ts'), 'utf8');

test('End on a screen goes to "Back to the practice controls", Home to its first control, and the Rules say so (walk 14 T3-N1)', () => {
  assert.match(source, /const BACK_TO_CONTROLS = 'Back to the practice controls';/);
  assert.match(source, /const target = event\.key === 'End' \? back : first;/);
  // Controls that use the keys themselves keep them: text, tabs, the chart slider, radios, menus.
  for (const own of ["'input'", "'textarea'", `'[role="tab"]'`, `'[role="slider"]'`, `'[role="radio"]'`, `'[role="menuitem"]'`]) {
    assert.ok(source.includes(own), `${own} keeps Home and End`);
  }
  const row = KEYBOARD_KEYS.find((entry) => entry.keys === 'Home and End');
  assert.ok(row && /Back to the practice controls/.test(row.does));
});
