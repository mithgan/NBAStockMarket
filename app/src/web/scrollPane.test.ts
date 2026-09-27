import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { setScrollPaneStop } from './scrollPane';

/** Just enough of an element for the pane rule. */
function fakePane() {
  const attributes = new Map<string, string>();
  const listeners: Array<() => void> = [];
  const doc = { activeElement: null as unknown };
  const node = {
    ownerDocument: doc,
    setAttribute: (name: string, value: string) => void attributes.set(name, value),
    removeAttribute: (name: string) => void attributes.delete(name),
    hasAttribute: (name: string) => attributes.has(name),
    addEventListener: (_type: string, listener: () => void) => void listeners.push(listener),
  };
  const blur = () => {
    doc.activeElement = null;
    listeners.splice(0).forEach((listener) => listener());
  };
  return { node: node as unknown as HTMLElement, attributes, doc, blur };
}

test('a scrolling pane is a named region stop, and stops being one when it no longer scrolls (walk 14 lead)', () => {
  const pane = fakePane();
  setScrollPaneStop(pane.node, 'Leaders, scrolls');
  assert.equal(pane.attributes.get('tabindex'), '0');
  assert.equal(pane.attributes.get('role'), 'region');
  assert.equal(pane.attributes.get('aria-label'), 'Leaders, scrolls');
  setScrollPaneStop(pane.node, null);
  assert.equal(pane.attributes.size, 0);
});

test('a focused pane that stops scrolling keeps the focus until the player moves on (walk 14 lead)', () => {
  const pane = fakePane();
  setScrollPaneStop(pane.node, 'Leaders, scrolls');
  pane.doc.activeElement = pane.node;
  setScrollPaneStop(pane.node, null);
  setScrollPaneStop(pane.node, null);
  assert.equal(pane.attributes.get('tabindex'), '-1', 'still focusable, out of the Tab order');
  assert.equal(pane.attributes.get('aria-label'), 'Leaders, scrolls');
  pane.blur();
  assert.equal(pane.attributes.size, 0);
});

test('a pane that scrolls again before focus leaves stays a stop (walk 14 lead)', () => {
  const pane = fakePane();
  setScrollPaneStop(pane.node, 'Leaders, scrolls');
  pane.doc.activeElement = pane.node;
  setScrollPaneStop(pane.node, null);
  setScrollPaneStop(pane.node, 'Final standings, scrolls');
  pane.blur();
  assert.equal(pane.attributes.get('tabindex'), '0');
  assert.equal(pane.attributes.get('aria-label'), 'Final standings, scrolls');
});

test('the Leaders pane keeps its element, and the end-of-screen link never takes room (walk 14 lead)', () => {
  const leaders = readFileSync(resolve(__dirname, '../screens/PerGameLeaderboardScreen.tsx'), 'utf8');
  // A role prop on the ScrollView changes its tag (div <-> section) and redraws the board, dropping focus.
  assert.doesNotMatch(leaders, /role: 'region'/);
  assert.match(leaders, /setScrollPaneStop\(/);
  const simBar = readFileSync(resolve(__dirname, '../components/SimBar.tsx'), 'utf8');
  const shown = simBar.slice(simBar.indexOf('const shownStyle = ['), simBar.indexOf("].join(';');", simBar.indexOf('const shownStyle = [')));
  assert.match(shown, /'position:absolute'/, 'drawn over the foot of the screen, not in its flow');
  assert.match(simBar, /if \(document\.activeElement === link\) \{\s*keepLastOnBlur = true;/, 'a focused link is never moved');
});
