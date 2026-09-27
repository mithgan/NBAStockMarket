/**
 * What kind of pointer made the last press: a mouse, a finger or a pen. The
 * folded "Search & sort" puts the caret in its search box for a mouse click,
 * as it does for a key, so what a desktop player types next lands there
 * (walk 13 T2-10); a finger's tap leaves focus where it was, so no on-screen
 * keyboard pops up over the list.
 */
let lastDown: { type: string; at: number } | null = null;

/** A pointer that went down this recently belongs to the press being handled. */
const FRESH_MS = 1500;

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('pointerdown', (event) => {
    lastDown = { type: (event as PointerEvent).pointerType || 'mouse', at: Date.now() };
  }, true);
}

/** The pointer type of the press being handled ('mouse', 'touch', 'pen'), or null for none lately. */
export function lastPointerType(): string | null {
  if (!lastDown || Date.now() - lastDown.at >= FRESH_MS) return null;
  return lastDown.type;
}
