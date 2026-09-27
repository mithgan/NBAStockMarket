import { openTab } from '../../state/uiActions';

/**
 * Take the player to the Roster tab from inside the Market, the way pressing
 * the tab would (so Back returns to the Market). Falls back to a history
 * entry the frame reads on `popstate` when no tab opener is mounted.
 * Returns false where neither is possible (then no button is shown).
 */
const ROSTER_TAB = 'portfolio';

export function canOpenRoster(): boolean {
  return typeof window !== 'undefined'
    && typeof window.history?.pushState === 'function'
    && typeof PopStateEvent === 'function';
}

export function openRoster(): boolean {
  if (openTab(ROSTER_TAB)) return true;
  if (!canOpenRoster()) return false;
  const state = { tab: ROSTER_TAB };
  window.history.pushState(state, '');
  window.dispatchEvent(new PopStateEvent('popstate', { state }));
  return true;
}
