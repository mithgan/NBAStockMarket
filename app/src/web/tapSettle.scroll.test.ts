import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

// A page with one scrolling list under every point, set up before the module
// loads (it listens to the page when there is one).
const list = {
  scrollTop: 0,
  scrollLeft: 0,
  scrollHeight: 3000,
  clientHeight: 700,
  scrollWidth: 1200,
  clientWidth: 1200,
  parentElement: null,
  isConnected: true,
};
const page = globalThis as unknown as { window?: unknown; document?: unknown };
page.window = { addEventListener: () => {}, scrollX: 0, scrollY: 0 };
page.document = { elementFromPoint: () => list };

test('a list that moved since the press releases its spot before the browser says it scrolled', async () => {
  mock.timers.enable({ apis: ['Date'], now: 50_000_000 });
  try {
    const { noteClick, notePointer, settleTaps, tapsSettling } = await import('./tapSettle');
    // Add on Donovan Mitchell at (1247, 845).
    notePointer(1247, 845, false);
    noteClick(1247, 845);
    settleTaps(0, 1200, 'list');
    // 0.58 s later a click scrolls Jalen Brunson's Add 28px into view and
    // lands 33px from Mitchell's spot, a frame before the scroll event.
    mock.timers.tick(580);
    list.scrollTop = 28;
    notePointer(1247, 878, false);
    noteClick(1247, 878);
    assert.equal(tapsSettling(), false);
  } finally {
    mock.timers.reset();
  }
});

test('the tap\'s own scroll, already reported, still keeps the spot for a double tap', async () => {
  mock.timers.enable({ apis: ['Date'], now: 60_000_000 });
  try {
    const { noteClick, notePageScroll, notePointer, settleTaps, tapsSettling } = await import('./tapSettle');
    list.scrollTop = 0;
    notePointer(600, 500, false);
    noteClick(600, 500);
    settleTaps(0, 1400, 'list');
    // The press's own question scrolls into view at once, and says so.
    mock.timers.tick(30);
    list.scrollTop = 40;
    notePageScroll();
    // The second tap of the double tap, 0.2 s later on the same spot.
    mock.timers.tick(170);
    notePointer(601, 502, false);
    noteClick(601, 502);
    assert.equal(tapsSettling(), true);
  } finally {
    mock.timers.reset();
  }
});
