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

/**
 * "Choose who to drop" from a full Market: the Roster, when it opens next,
 * brings its list forward (focus on "Your roster") and says why the player
 * is there. One shot: taken by the Roster when it mounts.
 */
export interface RosterPick {
  reason: string;
  side: 'long' | 'short';
  /** The player the room is for, so the Roster can offer him once there is room. */
  target?: { playerId: string; playerName: string };
}

let rosterPick: RosterPick | null = null;

/** `side` picks the list: "Your roster" (long) or "Your shorts" (short). */
export function requestRosterPick(
  reason: string,
  side: 'long' | 'short' = 'long',
  target?: { playerId: string; playerName: string },
): void {
  rosterPick = { reason, side, target };
}

export function takeRosterPick(): RosterPick | null {
  const pick = rosterPick;
  rosterPick = null;
  return pick;
}

/**
 * Rules opened from Settings: when Rules closes, Settings comes back (Back
 * and Done return to where the player was, walk 2 T3-28/T4-20). 'asked' until
 * Rules has opened, then 'open' until it closes.
 */
let settingsReturn: 'none' | 'asked' | 'open' = 'none';

export function returnToSettingsAfterRules(): void {
  settingsReturn = 'asked';
}

/** Rules could not open: nothing to hand back from. */
export function cancelSettingsReturn(): void {
  settingsReturn = 'none';
}

/** Called by the frame as sheets open and close; true when Settings should come back. */
export function settingsReturnStep(sheetsOpen: boolean): boolean {
  if (settingsReturn === 'asked' && sheetsOpen) settingsReturn = 'open';
  else if (settingsReturn === 'open' && !sheetsOpen) {
    settingsReturn = 'none';
    return true;
  }
  return false;
}
