import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { nextEventForPlayer, replayDays, weekKey, type ReplayDay } from '../data/replay';
import { players } from '../data/snapshot';
import type { Player } from '../data/types';
import {
  advanceReplayDay,
  armBoost,
  armWeeklyShort,
  createInitialGameState,
  getGameSummary,
  isGameStateForPlayers,
  tradePlayer,
  type GameState,
  type TradeSide,
  type TransitionResult,
} from './game';
import {
  enqueuePersistedReset,
  loadPersistedGame,
  persistenceErrorAfterSave,
  savePersistedGame,
} from './persistence';

interface PortfolioContextValue {
  state: GameState;
  summary: ReturnType<typeof getGameSummary>;
  message: string | null;
  persistenceError: string | null;
  isPersistenceBlocked: boolean;
  isHydrated: boolean;
  isGameplayReady: boolean;
  isResetting: boolean;
  isAdvancing: boolean;
  nextReplayDay: ReplayDay | null;
  latestSettledDate: string | null;
  currentWeek: string | null;
  trade: (player: Player, side: TradeSide) => boolean;
  owns: (playerId: string) => boolean;
  armShort: (player: Player) => boolean;
  armPlayerBoost: (player: Player) => boolean;
  nextPlayerGame: (playerId: string) => ReturnType<typeof nextEventForPlayer>;
  advanceDay: () => boolean;
  resetProgress: () => Promise<boolean>;
  dismissNotice: (kind: 'message' | 'persistence') => void;
}

const PortfolioContext = createContext<PortfolioContextValue | null>(null);
const replayDates = replayDays.map((day) => day.date);

function firstUnsettledDay(state: GameState): ReplayDay | null {
  const settled = new Set(state.settledDates);
  return replayDays.find((day) => !settled.has(day.date)) ?? null;
}

function followingReplayDay(day: ReplayDay): ReplayDay | null {
  const index = replayDays.findIndex((candidate) => candidate.date === day.date);
  return index >= 0 ? replayDays[index + 1] ?? null : null;
}

export function PortfolioProvider({ children }: { children: ReactNode }) {
  const initialState = useMemo(() => createInitialGameState(players), []);
  const [state, setState] = useState<GameState>(initialState);
  const stateRef = useRef(state);
  const [message, setMessage] = useState<string | null>(null);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isPersistenceBlocked, setIsPersistenceBlocked] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const advanceLock = useRef(false);
  const resetLock = useRef(false);
  const saveQueue = useRef(Promise.resolve());
  const autosaveEnabled = useRef(false);
  const mounted = useRef(true);

  useEffect(() => () => {
    mounted.current = false;
  }, []);

  useEffect(() => {
    let active = true;
    void loadPersistedGame(
      AsyncStorage,
      (value): value is GameState => isGameStateForPlayers(value, players, replayDates),
    ).then((result) => {
      if (!active) return;
      if (result.state) {
        stateRef.current = result.state;
        setState(result.state);
      }
      autosaveEnabled.current = result.canAutosave;
      setIsPersistenceBlocked(!result.canAutosave);
      setPersistenceError(result.error);
      setIsHydrated(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated || !autosaveEnabled.current) return;
    const snapshot = state;
    saveQueue.current = saveQueue.current.then(async () => {
      const result = await savePersistedGame(AsyncStorage, snapshot);
      if (mounted.current) {
        setPersistenceError((current) => persistenceErrorAfterSave(current, result));
        if (result.error) {
          autosaveEnabled.current = false;
          setIsPersistenceBlocked(true);
          setMessage(null);
        }
      }
    });
  }, [isHydrated, state]);

  const summary = useMemo(() => getGameSummary(state, players), [state]);
  const nextReplayDay = useMemo(() => firstUnsettledDay(state), [state]);
  const latestSettledDate = state.settledDates.at(-1) ?? null;
  const currentWeek = nextReplayDay ? weekKey(nextReplayDay.date) : null;
  const isGameplayReady = isHydrated && !isPersistenceBlocked && !isResetting;

  const applyTransition = useCallback(
    (result: TransitionResult, successMessage: string): boolean => {
      if (resetLock.current) {
        setMessage('Reset is already in progress.');
        return false;
      }
      if (!autosaveEnabled.current) {
        setMessage('Reset progress before continuing so new activity can be saved.');
        return false;
      }
      if (result.error) {
        setMessage(result.error);
        return false;
      }
      stateRef.current = result.state;
      setState(result.state);
      setMessage(successMessage);
      return true;
    },
    [],
  );

  const trade = useCallback((player: Player, side: TradeSide) => {
    const result = tradePlayer(stateRef.current, player, side);
    return applyTransition(
      result,
      `${side === 'buy' ? 'Bought' : 'Sold'} one share of ${player.name}.`,
    );
  }, [applyTransition]);

  const owns = useCallback(
    (playerId: string) => state.holdings.some((holding) => holding.player_id === playerId),
    [state.holdings],
  );

  const nextPlayerGame = useCallback(
    (playerId: string) => nextEventForPlayer(playerId, latestSettledDate),
    [latestSettledDate],
  );

  const armShort = useCallback((player: Player) => {
    const day = firstUnsettledDay(stateRef.current);
    if (!day) {
      setMessage('The replay season is complete.');
      return false;
    }
    return applyTransition(
      armWeeklyShort(stateRef.current, player, weekKey(day.date)),
      `Weekly short armed on ${player.name}.`,
    );
  }, [applyTransition]);

  const armPlayerBoost = useCallback((player: Player) => {
    const latestDate = stateRef.current.settledDates.at(-1) ?? null;
    const event = nextEventForPlayer(player.id, latestDate);
    if (!event) {
      setMessage(`${player.name} has no remaining replay game.`);
      return false;
    }
    return applyTransition(
      armBoost(stateRef.current, player, event.date, weekKey(event.date)),
      `${player.name} boosted for ${event.date}.`,
    );
  }, [applyTransition]);

  const advanceDay = useCallback(() => {
    if (resetLock.current) {
      setMessage('Reset is already in progress.');
      return false;
    }
    if (!autosaveEnabled.current) {
      setMessage('Reset progress before continuing so new activity can be saved.');
      return false;
    }
    if (advanceLock.current) return false;
    const day = firstUnsettledDay(stateRef.current);
    if (!day) {
      setMessage('The replay season is complete.');
      return false;
    }
    advanceLock.current = true;
    setIsAdvancing(true);
    const nextDay = followingReplayDay(day);
    const result = advanceReplayDay(
      stateRef.current,
      day.date,
      day.events,
      nextDay?.date ?? null,
      players,
    );
    const applied = applyTransition(
      result,
      `Settled ${day.date} with ${day.events.length} player results.`,
    );
    setTimeout(() => {
      advanceLock.current = false;
      if (mounted.current) setIsAdvancing(false);
    }, 120);
    return applied;
  }, [applyTransition]);

  const resetProgress = useCallback(async () => {
    if (resetLock.current) return false;
    resetLock.current = true;
    setIsResetting(true);
    const fresh = createInitialGameState(players);
    const resetOperation = enqueuePersistedReset(saveQueue.current, AsyncStorage, fresh);
    saveQueue.current = resetOperation.then(() => undefined);
    const result = await resetOperation;
    resetLock.current = false;
    if (mounted.current) setIsResetting(false);
    if (result.error) {
      autosaveEnabled.current = false;
      if (mounted.current) {
        setIsPersistenceBlocked(true);
        setPersistenceError(result.error);
      }
      return false;
    }
    if (!mounted.current) return false;
    autosaveEnabled.current = true;
    setIsPersistenceBlocked(false);
    stateRef.current = fresh;
    setState(fresh);
    setMessage('Progress reset. Your $140M bankroll is ready.');
    setPersistenceError(null);
    return true;
  }, []);

  const dismissNotice = useCallback((kind: 'message' | 'persistence') => {
    if (kind === 'message') setMessage(null);
    if (kind === 'persistence') setPersistenceError(null);
  }, []);

  const value = useMemo<PortfolioContextValue>(() => ({
    state,
    summary,
    message,
    persistenceError,
    isPersistenceBlocked,
    isHydrated,
    isGameplayReady,
    isResetting,
    isAdvancing,
    nextReplayDay,
    latestSettledDate,
    currentWeek,
    trade,
    owns,
    armShort,
    armPlayerBoost,
    nextPlayerGame,
    advanceDay,
    resetProgress,
    dismissNotice,
  }), [
    advanceDay,
    armPlayerBoost,
    armShort,
    currentWeek,
    dismissNotice,
    isAdvancing,
    isHydrated,
    isGameplayReady,
    isPersistenceBlocked,
    isResetting,
    latestSettledDate,
    message,
    nextPlayerGame,
    nextReplayDay,
    owns,
    persistenceError,
    resetProgress,
    state,
    summary,
    trade,
  ]);

  return <PortfolioContext.Provider value={value}>{children}</PortfolioContext.Provider>;
}

export function usePortfolio() {
  const context = useContext(PortfolioContext);
  if (!context) throw new Error('usePortfolio must be used within PortfolioProvider');
  return context;
}
