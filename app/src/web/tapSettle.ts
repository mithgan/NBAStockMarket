/**
 * A short quiet period for taps. When something folds away under a finger
 * (a confirm strip that was just answered, a sheet closed by tapping
 * outside it), the rest of that tap, or the second tap of a double tap,
 * lands on whatever is now underneath: another player's Add, his profile,
 * or +1 night. For a moment after such a change, buttons and row taps that
 * check `tapsSettling()` ignore the press (walk 2: T4-02, T4-03, T4-13).
 *
 * A hurried repeat of the same tap can come later than a double tap (walk 3
 * T4-13, T4-14: "keep, keep" or "drop, drop" most of a second apart), so a
 * move can also quiet its own spot for longer: a tap that lands where the
 * answered button was, soon after, is the same intent repeated and is
 * ignored, while a tap anywhere else goes through once the short period ends.
 */

const SETTLE_MS = 500;
/** How near the answered button a repeat tap counts as the same spot (px). */
const SPOT_RADIUS = 40;
/** A pointer lifted this recently belongs to the press being handled now. */
const POINTER_FRESH_MS = 300;

let quietUntil = 0;
let spot: { x: number; y: number; until: number } | null = null;
let lastPointer: { x: number; y: number; at: number } | null = null;

/** Record where a finger or mouse lifted (the page's pointerup, or a test). */
export function notePointer(x: number, y: number): void {
  lastPointer = { x, y, at: Date.now() };
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  // Where the finger or mouse last lifted: presses fire on that lift, so this
  // is where the press being handled happened. Keyboard presses have none.
  window.addEventListener('pointerup', (event) => notePointer(event.clientX, event.clientY), true);
}

function currentPointer(): { x: number; y: number } | null {
  return lastPointer && Date.now() - lastPointer.at < POINTER_FRESH_MS ? lastPointer : null;
}

/**
 * Start (or extend) the quiet period. With `sameSpotMs`, a pointer press also
 * quiets the spot it was made on for that long.
 */
export function settleTaps(ms = SETTLE_MS, sameSpotMs = 0): void {
  const now = Date.now();
  quietUntil = Math.max(quietUntil, now + ms);
  const at = sameSpotMs > 0 ? currentPointer() : null;
  if (at) spot = { x: at.x, y: at.y, until: now + sameSpotMs };
}

/** True while the quiet period lasts, or while a repeat lands on a quieted spot. */
export function tapsSettling(): boolean {
  const now = Date.now();
  if (now < quietUntil) return true;
  if (!spot || now >= spot.until) return false;
  const at = currentPointer();
  return at !== null && Math.hypot(at.x - spot.x, at.y - spot.y) <= SPOT_RADIUS;
}

/** True when the press being handled came from a finger or mouse, not a key. */
export function pressedByPointer(): boolean {
  return currentPointer() !== null;
}
