/**
 * A short quiet period for taps. When something folds away under a finger
 * (a confirm strip that was just answered, a sheet closed by tapping
 * outside it), the rest of that tap, or the second tap of a double tap,
 * lands on whatever is now underneath: another player's Add, his profile,
 * or +1 night. For a moment after such a change, buttons and row taps that
 * check `tapsSettling()` ignore the press (walk 2: T4-02, T4-03, T4-13).
 */

const SETTLE_MS = 500;
let quietUntil = 0;

/** Start (or extend) the quiet period. */
export function settleTaps(ms = SETTLE_MS): void {
  quietUntil = Math.max(quietUntil, Date.now() + ms);
}

/** True while the quiet period lasts. */
export function tapsSettling(): boolean {
  return Date.now() < quietUntil;
}
