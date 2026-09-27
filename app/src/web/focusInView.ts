/**
 * Focus is never hidden (WCAG 2.4.11). A control the keyboard lands on can
 * end up under something drawn over its list: Results' month bar at 200% and
 * 400% zoom (walk 10 T3-06: 15 of 40 Tab stops showed only a name), the
 * frame over a Roster row (T3-13), the notice strip and tab bar over the
 * Market's skip link (T3-11) or a focused button's ring (T3-02). After the
 * browser has scrolled the control into its list, this looks along the
 * control's top and bottom edges; where something else is drawn on top, the
 * list scrolls just enough to clear it, with a little air for the ring.
 */

/** Room left for the focus ring (2px, offset 2px) and a little air. */
const RING_AIR = 8;

function scrollerOf(node: HTMLElement): HTMLElement | null {
  for (let el = node.parentElement; el; el = el.parentElement) {
    const style = getComputedStyle(el);
    if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1) return el;
  }
  const page = document.scrollingElement as HTMLElement | null;
  return page && page.scrollHeight > page.clientHeight + 1 ? page : null;
}

/** What is drawn over `node` along the line `y`, if anything. */
function coverAt(node: HTMLElement, rect: DOMRect, y: number): Element | null {
  if (y < 0 || y > window.innerHeight) return null;
  const inset = Math.min(12, rect.width / 3);
  for (const x of [rect.left + inset, rect.left + rect.width / 2, rect.right - inset]) {
    if (x < 0 || x > window.innerWidth) continue;
    const hit = document.elementFromPoint(x, y);
    if (hit && hit !== node && !node.contains(hit) && !hit.contains(node)) return hit;
  }
  return null;
}

/** Scroll the focused control clear of anything drawn over it. */
export function revealFocused(node: HTMLElement): void {
  if (node.getBoundingClientRect().height === 0) return;
  const scroller = scrollerOf(node);
  if (!scroller) return;
  const page = scroller === document.scrollingElement;
  const box = page ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect();
  const view = { top: Math.max(0, box.top), bottom: Math.min(window.innerHeight, box.bottom) };
  // Its top never leaves the list's visible top when scrolling down.
  const room = (rect: DOMRect) => Math.max(0, rect.top - view.top - RING_AIR);
  // 1. Inside its list's own window first: a control shown only while
  //    focused (the skip links) was never scrolled into view by the browser.
  let rect = node.getBoundingClientRect();
  const fits = rect.height + 2 * RING_AIR <= view.bottom - view.top;
  if (!fits) {
    // Taller than the window (a Roster row at 400%): its first line, the
    // player's name, at the top (walk 10 T3-13).
    scroller.scrollBy({ top: rect.top - RING_AIR - view.top });
  } else if (rect.top - RING_AIR < view.top) {
    scroller.scrollBy({ top: rect.top - RING_AIR - view.top });
  } else if (rect.bottom + RING_AIR > view.bottom) {
    scroller.scrollBy({ top: rect.bottom + RING_AIR - view.bottom });
  }
  // 2. Then clear of anything drawn over it in that window.
  // A band over its top (the frame, a pinned header): up past it. What the
  // edge meets first can end before its band does (a pinned bar's line of
  // text over the bar's own padding), so it looks again from there (walk 16
  // lead: the profile's chart stayed 14px under its Drop bar). A band pinned
  // over the list's upper half hides all of a short control the same way
  // (walk 18 T3-01: the profile's chart tabs, reached by Tab once the sheet
  // had scrolled, sat wholly under its Drop bar, and a band over all of a
  // control was taken for a floating bar below it).
  const upperBand = (cover: DOMRect) => cover.top <= view.top + RING_AIR || cover.top + cover.bottom < view.top + view.bottom;
  let topHit: Element | null = null;
  let cleared = false;
  for (let pass = 0; pass < 3; pass += 1) {
    rect = node.getBoundingClientRect();
    topHit = coverAt(node, rect, rect.top + 2);
    const cover = topHit?.getBoundingClientRect();
    if (!cover || (cover.bottom >= rect.bottom && !upperBand(cover))) break;
    const before = scroller.scrollTop;
    scroller.scrollBy({ top: -(cover.bottom + RING_AIR - rect.top) });
    cleared = true;
    if (scroller.scrollTop === before) break;
  }
  if (cleared) return;
  const lowHit = coverAt(node, rect, rect.bottom - 2) ?? topHit;
  if (!lowHit) return;
  const cover = lowHit.getBoundingClientRect();
  // A band over its lower part, or over all of it (a floating bar, the notice
  // strip): down until it sits above it, as far as there is room.
  const clear = rect.bottom + RING_AIR - Math.max(cover.top, view.top);
  if (clear > 0) scroller.scrollBy({ top: Math.min(clear, room(rect)) });
}

let installed = false;

/** Watch keyboard focus for the whole app (web only). */
export function installFocusInView(): void {
  if (installed || typeof document === 'undefined' || typeof window === 'undefined') return;
  installed = true;
  document.addEventListener('focusin', (event) => {
    const node = event.target as HTMLElement | null;
    if (!node || typeof node.matches !== 'function') return;
    // Keyboard focus only: a tap leaves the page where the finger put it.
    let keyboard = false;
    try {
      keyboard = node.matches(':focus-visible');
    } catch {
      keyboard = false;
    }
    if (!keyboard) return;
    // After the browser's own scroll into view (and any the screen does).
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (document.activeElement === node) revealFocused(node);
    }));
  }, true);
}
