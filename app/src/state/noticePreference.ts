import { useSyncExternalStore } from 'react';

/**
 * "Keep notices until I close them" (Settings; walk 4 T3-N1, WCAG 2.2.1).
 * Success notices clear by themselves after a few seconds, which is too soon
 * for someone reading at 200-400% zoom, through a magnifier, or from the
 * keyboard (they cannot hover a notice to hold it). With this on, a notice
 * stays until it is closed.
 *
 * Read, write and subscribe. Kept in localStorage where there is one (the
 * web), in memory otherwise; storage that is missing or throws (private
 * windows, blocked storage) never breaks the switch, as with the theme
 * (theme/variantPersistence). The notice layer reads it with
 * keepNoticesUntilClosed() when it times a notice, or useKeepNotices().
 */
export const KEEP_NOTICES_STORAGE_KEY = 'nba-stock-market.keep-notices';

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
export function readKeepNotices(from: PreferenceStorage | null): boolean {
  try {
    return from?.getItem(KEEP_NOTICES_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Whether notices stay until closed (off unless the player turned it on). */
export function keepNoticesUntilClosed(): boolean {
  if (cached === null) cached = readKeepNotices(currentStorage());
  return cached;
}

/** Turn it on or off, save it where possible, and tell every subscriber. */
export function setKeepNoticesUntilClosed(next: boolean): void {
  if (cached === next) return;
  cached = next;
  try {
    currentStorage()?.setItem(KEEP_NOTICES_STORAGE_KEY, next ? '1' : '0');
  } catch {
    // Unavailable storage: the choice still holds for this visit.
  }
  listeners.forEach((listener) => listener());
}

export function subscribeKeepNotices(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The choice, kept current in a component. */
export function useKeepNotices(): boolean {
  return useSyncExternalStore(subscribeKeepNotices, keepNoticesUntilClosed, () => false);
}

/** Tests: read and write `next` (null for none) and forget the cached value. */
export function setNoticePreferenceStorageForTests(next: PreferenceStorage | null): void {
  storage = next;
  cached = null;
}
