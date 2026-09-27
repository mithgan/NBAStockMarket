/**
 * Tab and Shift+Tab at a dialog's edges (walk 16 T3-01). react-native-web's
 * modal trap sends focus that leaves a dialog back in, and Shift+Tab from
 * the first control went to the first focusable it met from the end, trying
 * a container before what is inside it. In the Rules, Settings and a
 * player's profile the body is a scroll region you can focus (to scroll it
 * with the keys), so Shift+Tab from Done landed on the body, and Shift+Tab
 * from the body went back to Done: the two traded focus and nothing inside
 * the body could be reached backwards. A dialog now wraps its own edges:
 * Shift+Tab on its first stop goes to its last, Tab on its last to its
 * first. Between them the browser's own order runs, so a heading a section
 * link focused goes on to the control after it (walk 16 T3-02).
 */

const CANDIDATES = [
  'a[href]',
  'area[href]',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[tabindex]',
].join(', ');

/** -1 when `a` comes before `b` in the page, 1 when after, 0 for the same node. */
export type DocumentOrder<T> = (a: T, b: T) => number;

/**
 * Where Tab (or Shift+Tab) from `active` should go instead of the browser's
 * own next stop, or null to let the browser move. `stops` are the dialog's
 * Tab stops in page order; `active` may be one of them or another focused
 * node inside the dialog (a heading a link focused, the dialog itself).
 */
export function dialogWrapTarget<T>(stops: readonly T[], active: T, backwards: boolean, order: DocumentOrder<T>): T | null {
  if (stops.length === 0) return null;
  const first = stops[0];
  const last = stops[stops.length - 1];
  const isStop = stops.includes(active);
  if (backwards) {
    // From the first stop, or from something before it (nothing to go back to).
    return active === first || (!isStop && order(active, first) < 0) ? last : null;
  }
  return active === last || (!isStop && order(active, last) > 0) ? first : null;
}

function rendered(node: HTMLElement): boolean {
  if (node.getClientRects().length === 0) return false;
  return getComputedStyle(node).visibility !== 'hidden';
}

/** The dialog's Tab stops, in page order. */
export function dialogTabStops(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(CANDIDATES)).filter((node) => (
    node.tabIndex >= 0
    && !(node as HTMLButtonElement).disabled
    && !node.closest('[inert]')
    && rendered(node)
  ));
}

function documentOrder(a: Node, b: Node): number {
  if (a === b) return 0;
  const position = a.compareDocumentPosition(b);
  // b inside a, or after it: a comes first.
  if (position & (Node.DOCUMENT_POSITION_FOLLOWING | Node.DOCUMENT_POSITION_CONTAINED_BY)) return -1;
  return 1;
}

let installed = false;

/** Wrap Tab at the edges of whichever dialog holds focus (web only). */
export function installDialogTabWrap(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const active = document.activeElement as HTMLElement | null;
    const dialog = active?.closest<HTMLElement>('[aria-modal="true"]');
    if (!active || !dialog) return;
    const target = dialogWrapTarget(dialogTabStops(dialog), active, event.shiftKey, documentOrder);
    if (!target || target === active) return;
    event.preventDefault();
    target.focus();
  }, true);
}
