/**
 * App-wide actions any screen can trigger without owning the UI that performs
 * them: the welcome card's "How scoring works" opens the Rules sheet, which the
 * status bar owns. The owner registers its opener; callers just call.
 */

type Opener = () => void;

/** The app's tabs by key: Roster, Market, Results, Leaders. */
export type AppTab = 'portfolio' | 'market' | 'plays' | 'leaderboard';

let rulesOpener: Opener | null = null;
let settingsOpener: Opener | null = null;
let tabOpener: ((tab: AppTab) => void) | null = null;

/** Register the Rules sheet opener; returns an unregister function. */
export function registerRulesOpener(open: Opener): () => void {
  rulesOpener = open;
  return () => {
    if (rulesOpener === open) rulesOpener = null;
  };
}

/** Register the Settings sheet opener; returns an unregister function. */
export function registerSettingsOpener(open: Opener): () => void {
  settingsOpener = open;
  return () => {
    if (settingsOpener === open) settingsOpener = null;
  };
}

/** Register the tab switcher (the app frame); returns an unregister function. */
export function registerTabOpener(open: (tab: AppTab) => void): () => void {
  tabOpener = open;
  return () => {
    if (tabOpener === open) tabOpener = null;
  };
}

/**
 * Switch to a tab the way pressing it would (it lands in browser history, so
 * Back returns). Returns false when no frame is mounted.
 */
export function openTab(tab: AppTab): boolean {
  if (!tabOpener) return false;
  tabOpener(tab);
  return true;
}

/** Open the game rules. Returns false when no Rules sheet is mounted. */
export function openRules(): boolean {
  if (!rulesOpener) return false;
  rulesOpener();
  return true;
}

/** Open Settings. Returns false when no Settings sheet is mounted. */
export function openSettings(): boolean {
  if (!settingsOpener) return false;
  settingsOpener();
  return true;
}
