/**
 * The practice season lives in browser memory and starts over on reload, by
 * design. These helpers keep that from happening by accident: while a season
 * has progress, the browser asks before the page is left or reloaded, and the
 * app's own Restart and Exit (which confirm first) skip that second question.
 */

const isWeb = typeof window !== 'undefined';
const RESTARTED_KEY = 'nba-stock-market:practice-restarted';

let hasProgress = false;
let leaving = false;
let installed = false;

function beforeUnload(event: BeforeUnloadEvent) {
  if (!hasProgress || leaving) return undefined;
  event.preventDefault();
  // Older browsers need a return value to show the prompt.
  event.returnValue = '';
  return '';
}

/** Tell the guard whether the current practice season has anything to lose. */
export function setPracticeProgress(progress: boolean): void {
  hasProgress = progress;
  if (isWeb && !installed) {
    window.addEventListener('beforeunload', beforeUnload);
    installed = true;
  }
}

/** Start a fresh practice season (after the player confirmed). */
export function restartPractice(): void {
  if (!isWeb) return;
  leaving = true;
  try {
    window.sessionStorage.setItem(RESTARTED_KEY, '1');
  } catch {}
  window.location.reload();
}

/** Leave practice for the live market (after the player confirmed). */
export function leavePractice(): void {
  if (!isWeb) return;
  leaving = true;
  window.location.search = '';
}

/** True once, right after a Restart, so the new season can be announced. */
export function consumePracticeRestarted(): boolean {
  if (!isWeb) return false;
  try {
    const flag = window.sessionStorage.getItem(RESTARTED_KEY) === '1';
    window.sessionStorage.removeItem(RESTARTED_KEY);
    return flag;
  } catch {
    return false;
  }
}
