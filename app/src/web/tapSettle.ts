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
/**
 * A quiet period that only matters to things that can move with a list
 * (rows and their buttons): a money move or an answered question reflows
 * the list, but the frame's +1 night / +1 week stay where they are, so a
 * press there is meant (walk 5 T2-12: +1 week 0.1 s after an Add vanished).
 */
let listQuietUntil = 0;
let spot: { x: number; y: number; until: number } | null = null;
let lastPointer: { x: number; y: number; at: number } | null = null;
/** When Enter or Space last went down: a press after it is the keyboard's. */
let lastPressKeyAt = 0;

/** Record an Enter or Space press (the page's keydown, or a test). */
export function notePressKey(): void {
  lastPressKeyAt = Date.now();
}

/** Record where a finger or mouse lifted (the page's pointerup, or a test). */
export function notePointer(x: number, y: number): void {
  lastPointer = { x, y, at: Date.now() };
  // A tap somewhere else, once the short quiet is over, is a new intent: the
  // quieted spot is released, so a later deliberate tap there (Short, then
  // Roster side, then Add in the same place) is not taken for a repeat (walk
  // 4 T3 note). Inside the short quiet it is part of the same flurry.
  if (spot && Date.now() >= Math.max(quietUntil, listQuietUntil) && Math.hypot(x - spot.x, y - spot.y) > SPOT_RADIUS) spot = null;
}

/**
 * The player scrolled on purpose (a wheel, or a finger dragging the list):
 * whatever is under the old spot now is something they chose to bring there,
 * so a tap on it is new, not a repeat (walk 4 T2-04: scrolling one row so the
 * next Add sat under the pointer, then clicking it, was ignored).
 */
export function noteScrollGesture(): void {
  spot = null;
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  // Where the finger or mouse last lifted: presses fire on that lift, so this
  // is where the press being handled happened. Keyboard presses have none.
  window.addEventListener('pointerup', (event) => notePointer(event.clientX, event.clientY), true);
  // A key press soon after a click is still a key press (walk 6 T2-10: Enter
  // on "Play another season" 0.2 s after a click was taken for a tap).
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') notePressKey();
  }, true);
  window.addEventListener('wheel', noteScrollGesture, { capture: true, passive: true });
  // Typing changes the list on purpose too: after adding one search result,
  // the next search's first Add sits where the last one was, and a tap on
  // it is the next purchase, not a repeat (walk 5 T4-12).
  window.addEventListener('input', noteScrollGesture, { capture: true, passive: true });
  let touchStartY: number | null = null;
  window.addEventListener('touchstart', (event) => {
    touchStartY = event.touches[0]?.clientY ?? null;
  }, { capture: true, passive: true });
  window.addEventListener('touchmove', (event) => {
    const y = event.touches[0]?.clientY;
    // A tap's own jitter is a few pixels; a drag that scrolls is more.
    if (touchStartY !== null && y !== undefined && Math.abs(y - touchStartY) > 12) noteScrollGesture();
  }, { capture: true, passive: true });
}

function currentPointer(): { x: number; y: number } | null {
  if (!lastPointer || lastPointer.at <= lastPressKeyAt) return null;
  return Date.now() - lastPointer.at < POINTER_FRESH_MS ? lastPointer : null;
}

/**
 * Start (or extend) the quiet period. With `sameSpotMs`, a pointer press also
 * quiets the spot it was made on for that long.
 */
export function settleTaps(ms = SETTLE_MS, sameSpotMs = 0, scope: 'all' | 'list' = 'all'): void {
  const now = Date.now();
  if (scope === 'all') quietUntil = Math.max(quietUntil, now + ms);
  else listQuietUntil = Math.max(listQuietUntil, now + ms);
  const at = sameSpotMs > 0 ? currentPointer() : null;
  if (at) spot = { x: at.x, y: at.y, until: now + sameSpotMs };
}

/**
 * True while the quiet period lasts, or while a repeat lands on a quieted
 * spot. A `steady` control (it never moves when a list reflows) skips the
 * list-only quiet.
 */
export function tapsSettling(steady = false): boolean {
  const now = Date.now();
  if (now < quietUntil) return true;
  if (!steady && now < listQuietUntil) return true;
  if (!spot || now >= spot.until) return false;
  const at = currentPointer();
  return at !== null && Math.hypot(at.x - spot.x, at.y - spot.y) <= SPOT_RADIUS;
}

/** True when the press being handled came from a finger or mouse, not a key. */
export function pressedByPointer(): boolean {
  return currentPointer() !== null;
}
