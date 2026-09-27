import { useSyncExternalStore } from 'react';

/**
 * "Reduce motion" (Settings; walk 5 T3 NYI-4). The app already follows the
 * system's reduced-motion setting, but on a shared or locked device a player
 * cannot change that, so the app offers its own switch on top: motion is
 * reduced when either says so (hooks/useReducedMotion).
 *
 * Read, write and subscribe, as noticePreference: kept in localStorage where
 * there is one (the web), in memory otherwise; storage that is missing or
 * throws (private windows, blocked storage) never breaks the switch.
 *
 * On the web the choice also marks the page (`html[data-reduce-motion="on"]`)
 * with the same rule the system setting triggers in the global styles, so CSS
 * transitions and animations stop too, not only the ones the app times.
 */
export const REDUCE_MOTION_STORAGE_KEY = 'nba-stock-market.reduce-motion';
export const REDUCE_MOTION_ATTRIBUTE = 'data-reduce-motion';
const REDUCE_MOTION_STYLE_ID = 'reduce-motion-choice';

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): PreferenceStorage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

let storage: PreferenceStorage | null | undefined;
let cached: boolean | null = null;
const listeners = new Set<() => void>();

function currentStorage(): PreferenceStorage | null {
  if (storage === undefined) storage = browserStorage();
  return storage;
}

/** The saved choice in `from`: on only when it was saved on. */
export function readReduceMotion(from: PreferenceStorage | null): boolean {
  try {
    return from?.getItem(REDUCE_MOTION_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** The page-wide rule for the choice: the global styles' reduced-motion rule, keyed to the attribute. */
export function reduceMotionCss(): string {
  const on = `html[${REDUCE_MOTION_ATTRIBUTE}="on"]`;
  return `${on} *, ${on} *::before, ${on} *::after {
  animation-duration: 0.01ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.01ms !important;
  scroll-behavior: auto !important;
}`;
}

/** Mark (or unmark) the page, adding the rule once. No-op without a DOM. */
function reflectOnPage(on: boolean): void {
  if (typeof document === 'undefined' || !document.documentElement) return;
  try {
    if (on) document.documentElement.setAttribute(REDUCE_MOTION_ATTRIBUTE, 'on');
    else document.documentElement.removeAttribute(REDUCE_MOTION_ATTRIBUTE);
    if (on && document.head && !document.getElementById(REDUCE_MOTION_STYLE_ID)) {
      const style = document.createElement('style');
      style.id = REDUCE_MOTION_STYLE_ID;
      style.textContent = reduceMotionCss();
      document.head.appendChild(style);
    }
  } catch {
    // A page that refuses the mark still gets the app's own still motion.
  }
}

/** Whether the player turned Reduce motion on (off unless they did). */
export function reduceMotionChosen(): boolean {
  if (cached === null) {
    cached = readReduceMotion(currentStorage());
    reflectOnPage(cached);
  }
  return cached;
}

/** Turn it on or off, save it where possible, and tell every subscriber. */
export function setReduceMotion(next: boolean): void {
  if (reduceMotionChosen() === next) return;
  cached = next;
  try {
    currentStorage()?.setItem(REDUCE_MOTION_STORAGE_KEY, next ? '1' : '0');
  } catch {
    // Unavailable storage: the choice still holds for this visit.
  }
  reflectOnPage(next);
  listeners.forEach((listener) => listener());
}

export function subscribeReduceMotion(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The choice, kept current in a component. */
export function useReduceMotionChoice(): boolean {
  return useSyncExternalStore(subscribeReduceMotion, reduceMotionChosen, () => false);
}

/** Tests: read and write `next` (null for none) and forget the cached value. */
export function setMotionPreferenceStorageForTests(next: PreferenceStorage | null): void {
  storage = next;
  cached = null;
}
