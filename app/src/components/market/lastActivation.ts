/**
 * Where the player's last press landed: inside the current screen (for
 * example the Roster's "Find a short") or in the app's frame (the tab bar).
 * The Market uses it to tell "take me to the Short side" from "back to the
 * Market as I left it". Pointer-down and Enter/Space are recorded in the
 * capture phase, so the press that switches tabs is always the one seen.
 */
let last = { at: 0, inScreen: false };
let listening = false;

function note(event: Event) {
  const target = event.target as { closest?: (selector: string) => unknown } | null;
  last = { at: Date.now(), inScreen: Boolean(target?.closest?.('#app-screen')) };
}

export function listenForActivations(): void {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  document.addEventListener('pointerdown', note, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') note(event);
  }, true);
}

/** Whether the press that just happened was inside a screen (not the tab bar). */
export function pressedInScreen(withinMs = 4000): boolean {
  return last.inScreen && Date.now() - last.at < withinMs;
}
