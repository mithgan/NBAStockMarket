import assert from 'node:assert/strict';
import { test } from 'node:test';
import { revealFocused } from './focusInView';

/**
 * The player profile's shape (walk 16 lead): a scroll region from 53px, a
 * pinned bar over its top from 53 to 114px, and the bar's line of text,
 * "Roster changes are locked…", from 74 to 92px. The chart the keyboard
 * lands on sits at 86px, its top under the bar.
 */
function profileScene() {
  const box = (top: number, bottom: number, left = 641, right = 1239) => ({
    top, bottom, left, right, width: right - left, height: bottom - top, x: left, y: top,
  }) as DOMRect;
  const scroller = {
    scrollTop: 525,
    scrollHeight: 2000,
    clientHeight: 747,
    parentElement: null,
    getBoundingClientRect: () => box(53, 800),
    scrollBy({ top }: { top: number }) {
      this.scrollTop += top;
    },
  };
  const chartTop = () => 86 + (525 - scroller.scrollTop);
  const chart = {
    parentElement: scroller,
    getBoundingClientRect: () => box(chartTop(), chartTop() + 200, 657, 1223),
    contains: (other: unknown) => other === chart,
  };
  const line = { getBoundingClientRect: () => box(74, 92, 657, 1000), contains: () => false };
  const bar = { getBoundingClientRect: () => box(53, 114), contains: () => false };
  const elementFromPoint = (x: number, y: number) => {
    if (y >= 74 && y <= 92 && x <= 1000) return line;
    if (y >= 53 && y <= 114) return bar;
    return chart;
  };
  return { scroller, chart, chartTop, elementFromPoint };
}

test('a focused control clears the whole pinned bar over it, not only the bar\'s first line (walk 16 lead)', () => {
  const scene = profileScene();
  const globals = globalThis as unknown as Record<string, unknown>;
  const saved = { document: globals.document, window: globals.window, getComputedStyle: globals.getComputedStyle };
  globals.document = { elementFromPoint: scene.elementFromPoint, scrollingElement: null };
  globals.window = { innerHeight: 800, innerWidth: 1280 };
  globals.getComputedStyle = (node: unknown) => ({ overflowY: node === scene.scroller ? 'auto' : 'visible' });
  try {
    revealFocused(scene.chart as unknown as HTMLElement);
  } finally {
    Object.assign(globals, saved);
  }
  // Clear of the bar's 114px bottom with the ring's 8px of air (it stopped at 100, under the bar).
  assert.equal(scene.chartTop(), 122);
});
