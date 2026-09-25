/**
 * App-wide actions any screen can trigger without owning the UI that performs
 * them: the welcome card's "How scoring works" opens the Rules sheet, which the
 * status bar owns. The owner registers its opener; callers just call.
 */

type Opener = () => void;

let rulesOpener: Opener | null = null;
let settingsOpener: Opener | null = null;

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
