import { useCallback, useEffect, useState } from 'react';
import { loadPlayerHistory, type HistoricalPlayerSeason, type HistoryPlayer } from '../data/playerHistory';

type HistoryState =
  | { key: string; status: 'loading'; history: null }
  | { key: string; status: 'ready'; history: HistoricalPlayerSeason | null }
  | { key: string; status: 'error'; history: null };

/** Key the rendered state as well as canceling requests, so a switched player never flashes old stats. */
export function usePlayerHistory(player: HistoryPlayer, seasonId: string) {
  const key = JSON.stringify([player.playerId, player.name, seasonId]);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<HistoryState>({ key, status: 'loading', history: null });
  useEffect(() => {
    const controller = new AbortController();
    setState({ key, status: 'loading', history: null });
    void loadPlayerHistory(player, seasonId, { signal: controller.signal }).then(
      (history) => { if (!controller.signal.aborted) setState({ key, status: 'ready', history }); },
      () => { if (!controller.signal.aborted) setState({ key, status: 'error', history: null }); },
    );
    return () => controller.abort();
  }, [key, attempt]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { ...(state.key === key ? state : { key, status: 'loading' as const, history: null }), retry };
}
