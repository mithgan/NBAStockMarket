/**
 * Take the player to the Roster tab from inside the Market.
 *
 * The app keeps its tabs in browser history (`{ tab }` entries) and switches
 * tab on `popstate`, so the Market pushes a Roster entry and announces it the
 * same way Back would. Back from the Roster then returns to the Market.
 * Returns false where there is no browser history (then no button is shown).
 */
const ROSTER_TAB = 'portfolio';

export function canOpenRoster(): boolean {
  return typeof window !== 'undefined'
    && typeof window.history?.pushState === 'function'
    && typeof PopStateEvent === 'function';
}

export function openRoster(): boolean {
  if (!canOpenRoster()) return false;
  const state = { tab: ROSTER_TAB };
  window.history.pushState(state, '');
  window.dispatchEvent(new PopStateEvent('popstate', { state }));
  return true;
}
