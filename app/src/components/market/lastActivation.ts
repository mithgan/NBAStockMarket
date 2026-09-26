/**
 * Where the player's last press landed: inside the current screen (for
 * example the Roster's "Find a short") or in the app's frame (the tab bar).
 * The Market uses it to tell "take me to the Short side" from "back to the
 * Market as I left it". Pointer-down and the keys that press or switch are
 * recorded in the capture phase, so the press that switches tabs is always
 * the one seen: Enter or Space anywhere, and the tab bar's own keys (arrows,
 * Home, End) on a tab. Without those, a keyboard user who pressed Enter in
 * the Market and then arrowed back to it was taken for a screen asking for a
 * side, and lost the Short side (walk 3 T3-20).
 */
let last = { at: 0, inScreen: false };
let listening = false;

const TAB_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);

/** Whether a key press counts as a press: Enter/Space anywhere, tab-bar keys on a tab. */
export function countsAsPress(key: string, onTab: boolean): boolean {
  if (key === 'Enter' || key === ' ' || key === 'Spacebar') return true;
  return onTab && TAB_KEYS.has(key);
}

type Target = { closest?: (selector: string) => unknown } | null;

function note(event: Event) {
  const target = event.target as Target;
  last = { at: Date.now(), inScreen: Boolean(target?.closest?.('#app-screen')) };
}

export function listenForActivations(): void {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  document.addEventListener('pointerdown', note, true);
  document.addEventListener('keydown', (event) => {
    const target = event.target as Target;
    if (countsAsPress(event.key, Boolean(target?.closest?.('[role="tab"]')))) note(event);
  }, true);
}

/** Whether the press that just happened was inside a screen (not the tab bar). */
export function pressedInScreen(withinMs = 4000): boolean {
  return last.inScreen && Date.now() - last.at < withinMs;
}
