import { useSyncExternalStore } from 'react';

/**
 * The practice games playing right now, as they read before "games" ("Oct
 * 21", "Oct 21–27", "rest of the season's"), or null.
 * The practice controls publish it the moment +1 night or +1 week is pressed;
 * a move pressed meanwhile waits for those games, so the screens can say
 * "Waiting for the Oct 21–27 games" instead of a tick that may not hold
 * (walk 9 T4-04).
 */
let playing: string | null = null;
const listeners = new Set<() => void>();

export function setPracticePlaying(next: string | null): void {
  if (next === playing) return;
  playing = next;
  listeners.forEach((listener) => listener());
}

export function practicePlaying(): string | null {
  return playing;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The nights playing now, re-rendering when they start and land. */
export function usePracticePlaying(): string | null {
  return useSyncExternalStore(subscribe, practicePlaying, () => null);
}
