import { useCallback, useEffect, useState } from 'react';

/**
 * The watchlist is client-only state: a short, ordered list of player ids the
 * user has starred. It never touches the server, so it persists straight to
 * localStorage. Every storage access is guarded — on native (or with storage
 * blocked) the list simply lives for the session.
 */
const STORAGE_KEY = 'nba-stock-market:watchlist:v1';

/** Hard cap on watched players. New stars push out the oldest entry. */
export const WATCHLIST_LIMIT = 8;

function readStored(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id) => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
}

export function useWatchlist() {
  const [watched, setWatched] = useState<string[]>([]);

  // Start empty and hydrate after mount so the first render never depends on
  // storage access succeeding.
  useEffect(() => setWatched(readStored()), []);

  const write = useCallback((next: string[]) => {
    setWatched(next);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {}
    }
  }, []);

  // Toggle goes through the functional updater so rapid taps compute against
  // the latest list; persistence rides along inside the updater so state and
  // storage cannot drift apart.
  const toggle = useCallback((playerId: string) => {
    setWatched((current) => {
      const next = current.includes(playerId)
        ? current.filter((id) => id !== playerId)
        : [playerId, ...current].slice(0, WATCHLIST_LIMIT);
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {}
      }
      return next;
    });
  }, []);

  return {
    watched,
    isWatched: useCallback((playerId: string) => watched.includes(playerId), [watched]),
    toggle,
    clear: useCallback(() => write([]), [write]),
    full: watched.length >= WATCHLIST_LIMIT,
  };
}
