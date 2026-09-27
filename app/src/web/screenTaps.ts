import { useLayoutEffect, useState } from 'react';

/**
 * When the finger last went down on the screen (the #app-screen main area),
 * so a change that would take room from under a tapping finger can wait for
 * the taps to pause (walk 16 T1-11: in a short window a notice strip took
 * the list's foot a moment after an Add, and the next Add, pressed where its
 * row had just been, landed on the strip and was lost).
 */
let lastScreenTapAt = Number.NEGATIVE_INFINITY;

let installed = false;

/** Watch taps and clicks on the screen (web only). */
export function installScreenTaps(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('pointerdown', (event) => {
    const screen = document.getElementById('app-screen');
    if (screen && event.target instanceof Node && screen.contains(event.target)) lastScreenTapAt = Date.now();
  }, true);
}

/** How much longer a change should wait for the taps to pause (0: not at all). */
export function tapPauseWait(sinceLastTap: number, quietMs: number): number {
  return sinceLastTap >= quietMs ? 0 : quietMs - sinceLastTap;
}

/**
 * True while the change named by `key` should wait: the finger went down on
 * the screen less than `quietMs` ago, and has not rested that long since.
 */
export function useTapPause(active: boolean, key: unknown, quietMs: number): boolean {
  const [waiting, setWaiting] = useState(false);
  // Before paint, so a strip that has to wait is never drawn for a frame.
  useLayoutEffect(() => {
    if (!active) {
      setWaiting(false);
      return undefined;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = () => {
      const wait = tapPauseWait(Date.now() - lastScreenTapAt, quietMs);
      setWaiting(wait > 0);
      if (wait > 0) timer = setTimeout(check, wait);
    };
    check();
    return () => {
      if (timer !== null) clearTimeout(timer);
    };
  }, [active, key, quietMs]);
  return waiting;
}
