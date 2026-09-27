/**
 * A scrolling pane with nothing inside to focus is a Tab stop of the
 * browser's own, unnamed (walk 13 T3-11). While it scrolls, make it a stop on
 * purpose: named, a region, with the app's ring drawn inside. The attributes
 * go on the element itself, so it keeps its tag and nothing inside redraws
 * when it starts or stops scrolling.
 */
const PANE_ATTRIBUTES = ['tabindex', 'role', 'aria-label', 'data-scroll-pane'] as const;

/** The name each pane should have now (null: not a stop). */
const wanted = new WeakMap<HTMLElement, string | null>();
/** Panes that stopped scrolling while focused, cleared once focus leaves. */
const clearOnBlur = new WeakSet<HTMLElement>();

function clear(node: HTMLElement): void {
  for (const attribute of PANE_ATTRIBUTES) node.removeAttribute(attribute);
}

export function setScrollPaneStop(node: HTMLElement | null, name: string | null): void {
  if (!node) return;
  wanted.set(node, name);
  if (name) {
    node.setAttribute('tabindex', '0');
    node.setAttribute('role', 'region');
    node.setAttribute('aria-label', name);
    node.setAttribute('data-scroll-pane', '');
    return;
  }
  if (!node.hasAttribute('data-scroll-pane')) return;
  if (node.ownerDocument.activeElement === node) {
    // The window grew under a focused pane: it keeps the focus (out of the
    // Tab order) until the player moves on, instead of dropping it to the page.
    node.setAttribute('tabindex', '-1');
    if (!clearOnBlur.has(node)) {
      clearOnBlur.add(node);
      node.addEventListener('blur', () => {
        clearOnBlur.delete(node);
        if (!wanted.get(node)) clear(node);
      }, { once: true });
    }
    return;
  }
  clear(node);
}
