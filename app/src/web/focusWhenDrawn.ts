/**
 * Focus for a page that just loaded after a keyboard press (Restart, Play
 * another season): its screen is drawn only once the new season has loaded,
 * which on a busy device can take a second or more, so a fixed wait left the
 * page itself focused and the next Tab began again at the top (walk 14
 * T2-01). This waits for the target to be drawn; once the season has loaded
 * (its practice bar is drawn) without it (a welcome the player closed), the
 * screen's main region takes focus after a short grace. The main region
 * itself is on the page while the season still loads, so it is no sign of
 * the screen being ready. A player who has already moved focus keeps it.
 */

export type DrawnFocusStep = 'target' | 'fallback' | 'wait' | 'stop';

export interface DrawnFocusState {
  /** ms since the wait began. */
  elapsed: number;
  /** Focus is on nothing yet (the page itself). */
  idle: boolean;
  targetShown: boolean;
  /** ms since the page was first seen ready (the season loaded), or null. */
  readyFor: number | null;
}

export const DRAWN_FOCUS_GRACE_MS = 400;
export const DRAWN_FOCUS_LIMIT_MS = 10_000;

/** What to do on this check (pure, for tests). */
export function drawnFocusStep(state: DrawnFocusState): DrawnFocusStep {
  if (!state.idle) return 'stop';
  if (state.targetShown) return 'target';
  if (state.readyFor !== null && state.readyFor >= DRAWN_FOCUS_GRACE_MS) return 'fallback';
  if (state.elapsed >= DRAWN_FOCUS_LIMIT_MS) return 'stop';
  return 'wait';
}

function shownElement(id: string): HTMLElement | null {
  const node = document.getElementById(id);
  return node instanceof HTMLElement && node.getClientRects().length > 0 ? node : null;
}

/**
 * Focus `id` once it is drawn, or `fallbackId` once `readyId` has been drawn
 * a moment without it; returns a stop function.
 */
export function focusWhenDrawn(id: string, readyId = 'practice-bar', fallbackId = 'app-screen'): () => void {
  if (typeof document === 'undefined') return () => {};
  const started = Date.now();
  let readySeenAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const check = () => {
    if (stopped) return;
    const now = Date.now();
    const active = document.activeElement;
    const target = shownElement(id);
    if (readySeenAt === null && document.getElementById(readyId)) readySeenAt = now;
    const step = drawnFocusStep({
      elapsed: now - started,
      idle: !active || active === document.body || active === document.documentElement,
      targetShown: target !== null,
      readyFor: readySeenAt === null ? null : now - readySeenAt,
    });
    if (step === 'wait') {
      timer = setTimeout(check, 100);
      return;
    }
    stopped = true;
    if (step === 'target') target?.focus({ preventScroll: true });
    if (step === 'fallback') shownElement(fallbackId)?.focus({ preventScroll: true });
  };
  timer = setTimeout(check, 0);
  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
  };
}
