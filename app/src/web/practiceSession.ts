/**
 * The practice season lives in browser memory and starts over on reload, by
 * design. These helpers keep that from happening by accident: while a season
 * has progress, the browser asks before the page is left or reloaded, and the
 * app's own Restart and Exit (which confirm first) skip that second question.
 */

import { pressedByPointer } from './tapSettle';

const isWeb = typeof window !== 'undefined';
const RESTARTED_KEY = 'nba-stock-market:practice-restarted';
// Restart and Exit load a new page. Whether the press came from the keyboard
// travels with it, so the new page moves focus for keyboard users without
// drawing a focus ring for a finger (walk 3 T1-15, T3-22).
const BY_KEYBOARD_KEY = 'nba-stock-market:arrived-by-keyboard';

function rememberHowPressed(): void {
  try {
    if (pressedByPointer()) window.sessionStorage.removeItem(BY_KEYBOARD_KEY);
    else window.sessionStorage.setItem(BY_KEYBOARD_KEY, '1');
  } catch {}
}

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
  rememberHowPressed();
  try {
    window.sessionStorage.setItem(RESTARTED_KEY, '1');
  } catch {}
  window.location.reload();
}

/** Leave practice for the live market (after the player confirmed). */
export function leavePractice(): void {
  if (!isWeb) return;
  leaving = true;
  rememberHowPressed();
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

/** True once, on the page a keyboard press on Restart or Exit loaded. */
export function consumeArrivedByKeyboard(): boolean {
  if (!isWeb) return false;
  try {
    const flag = window.sessionStorage.getItem(BY_KEYBOARD_KEY) === '1';
    window.sessionStorage.removeItem(BY_KEYBOARD_KEY);
    return flag;
  } catch {
    return false;
  }
}
