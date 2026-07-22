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

import { MarketApiClient, MarketApiError } from '../api/client';
import type { ServerBootstrap } from '../api/contracts';
import type { TrendPoint } from '../data/trendPresentation';
import type { Player } from '../data/types';
import { ActionLock } from './actionLock';
import { type GameLeaderboardEntry, type GameState, getGameSummary, type TradeSide } from './game';
import {
  finalizeLocalTransition,
  inspectLocalTransition,
  shouldInspectLocalTransition,
} from './localTransition';
import {
  isServerAccountPristine,
  mapServerBootstrap,
  type ServerPresentationState,
} from './serverState';

interface PortfolioContextValue {
  state: GameState | null;
  players: Player[];
  leaderboard: GameLeaderboardEntry[];
  summary: ReturnType<typeof getGameSummary> | null;
  displayName: string | null;
  message: string | null;
  serverError: string | null;
  transitionError: string | null;
  transitionRequired: boolean;
  legacySavePresent: boolean;
  isLoading: boolean;
  isRefreshing: boolean;
  isTransitioning: boolean;
  isGameplayReady: boolean;
  pendingActions: ReadonlySet<string>;
  shortSlots: { used: number; total: number; remaining: number };
  boostSlots: { used: number; total: number; remaining: number };
  weeklyShortTargets: ServerPresentationState['weeklyShortTargets'];
  boostTargets: ServerPresentationState['boostTargets'];
  playerTrends: Record<string, TrendPoint[]>;
  nextGameDate: string | null;
  settledGameDateCount: number;
  latestSettledDate: string | null;
  currentWeek: string | null;
  trade: (player: Player, side: TradeSide) => Promise<boolean>;
  owns: (playerId: string) => boolean;
  armShort: (player: Player) => Promise<boolean>;
  armPlayerBoost: (player: Player, gameDate: string) => Promise<boolean>;
  refreshData: () => Promise<boolean>;
  confirmLocalTransition: () => Promise<boolean>;
  dismissNotice: () => void;
}

const PortfolioContext = createContext<PortfolioContextValue | null>(null);

function errorMessage(error: unknown): string {
  if (error instanceof MarketApiError) return error.message;
  return 'The server could not load your account. Try again.';
}

export function PortfolioProvider({
  apiClient,
  userId,
  children,
}: {
  apiClient: MarketApiClient;
  userId: string;
  children: ReactNode;
}) {
  const [presentation, setPresentation] = useState<ServerPresentationState | null>(null);
  const bootstrapRef = useRef<ServerBootstrap | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [transitionRequired, setTransitionRequired] = useState(false);
  const [localTransitionInspected, setLocalTransitionInspected] = useState(false);
  const [legacySavePresent, setLegacySavePresent] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const actionLock = useRef(new ActionLock());
  const [pendingActions, setPendingActions] = useState<ReadonlySet<string>>(new Set());
  const mounted = useRef(true);
  const loadVersion = useRef(0);

  useEffect(() => () => {
    mounted.current = false;
  }, []);

  const installBootstrap = useCallback((bootstrap: ServerBootstrap) => {
    bootstrapRef.current = bootstrap;
    setPresentation(mapServerBootstrap(bootstrap));
  }, []);

  const loadSnapshot = useCallback(async ({
    checkLocalTransition,
    showInitialLoader,
  }: {
    checkLocalTransition: boolean;
    showInitialLoader: boolean;
  }): Promise<ServerBootstrap | null> => {
    const version = ++loadVersion.current;
    if (showInitialLoader) setIsLoading(true);
    else setIsRefreshing(true);
    setServerError(null);
    try {
      const bootstrap = await apiClient.bootstrap();
      if (!mounted.current || version !== loadVersion.current) return null;
      installBootstrap(bootstrap);
      if (checkLocalTransition) {
        const inspection = await inspectLocalTransition(AsyncStorage, userId);
        if (!mounted.current || version !== loadVersion.current) return null;
        setLocalTransitionInspected(true);
        setTransitionError(inspection.error);
        setLegacySavePresent(inspection.legacySavePresent);
        setTransitionRequired(Boolean(inspection.error) || inspection.legacySavePresent);
      }
      return bootstrap;
    } catch (error) {
      if (mounted.current && version === loadVersion.current) {
        setServerError(errorMessage(error));
      }
      return null;
    } finally {
      if (mounted.current && version === loadVersion.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [apiClient, installBootstrap, userId]);

  useEffect(() => {
    void loadSnapshot({ checkLocalTransition: true, showInitialLoader: true });
  }, [loadSnapshot]);

  const updatePendingActions = useCallback(() => {
    if (mounted.current) setPendingActions(actionLock.current.snapshot());
  }, []);

  const refreshData = useCallback(async () => {
    if (actionLock.current.has('account-mutation')) return false;
    if (!actionLock.current.acquire('account-refresh')) return false;
    updatePendingActions();
    try {
      return (await loadSnapshot({
        checkLocalTransition: shouldInspectLocalTransition(
          localTransitionInspected,
          transitionRequired,
        ),
        showInitialLoader: false,
      })) !== null;
    } finally {
      actionLock.current.release('account-refresh');
      updatePendingActions();
    }
  }, [loadSnapshot, localTransitionInspected, transitionRequired, updatePendingActions]);

  const runAction = useCallback(async (
    key: string,
    action: () => Promise<unknown>,
    successMessage: string,
  ): Promise<boolean> => {
    if (!actionLock.current.acquire('account-mutation')) return false;
    if (!actionLock.current.acquire(key)) {
      actionLock.current.release('account-mutation');
      return false;
    }
    updatePendingActions();
    setMessage(null);
    try {
      await action();
      const refreshed = await loadSnapshot({
        checkLocalTransition: false,
        showInitialLoader: false,
      });
      if (!refreshed) return false;
      if (mounted.current) setMessage(successMessage);
      return true;
    } catch (error) {
      if (mounted.current) setMessage(errorMessage(error));
      return false;
    } finally {
      actionLock.current.release(key);
      actionLock.current.release('account-mutation');
      updatePendingActions();
    }
  }, [loadSnapshot, updatePendingActions]);

  const trade = useCallback((player: Player, side: TradeSide) => runAction(
    `trade:${player.id}`,
    () => apiClient.trade(player.id, side),
    `${side === 'buy' ? 'Bought' : 'Sold'} one share of ${player.name}.`,
  ), [apiClient, runAction]);

  const armShort = useCallback((player: Player) => runAction(
    `short:${player.id}`,
    () => apiClient.armWeeklyShort(player.id),
    `Weekly short armed on ${player.name}.`,
  ), [apiClient, runAction]);

  const armPlayerBoost = useCallback((player: Player, gameDate: string) => runAction(
      `boost:${player.id}`,
      () => apiClient.armBoost(player.id, gameDate),
      `${player.name} boosted for ${gameDate}.`,
  ), [apiClient, runAction]);

  const confirmLocalTransition = useCallback(async () => {
    if (isTransitioning || !bootstrapRef.current || !legacySavePresent) return false;
    setIsTransitioning(true);
    setTransitionError(null);
    try {
      let refreshed: ServerBootstrap;
      if (isServerAccountPristine(bootstrapRef.current)) {
        try {
          await apiClient.resetAccount(bootstrapRef.current.portfolio.version);
        } catch (error) {
          if (!(error instanceof MarketApiError)
            || !['account_version_conflict', 'reset_not_eligible'].includes(error.code)) {
            throw error;
          }
        }
      }
      refreshed = await apiClient.bootstrap();
      installBootstrap(refreshed);
      const finalized = await finalizeLocalTransition(AsyncStorage, userId);
      if (!finalized.complete) {
        setTransitionError(finalized.error);
        return false;
      }
      setTransitionRequired(false);
      setLegacySavePresent(false);
      setMessage('Server account ready. Prototype progress was removed from this device.');
      return true;
    } catch (error) {
      setTransitionError(errorMessage(error));
      return false;
    } finally {
      if (mounted.current) setIsTransitioning(false);
    }
  }, [apiClient, installBootstrap, isTransitioning, legacySavePresent, userId]);

  const state = presentation?.state ?? null;
  const players = presentation?.players ?? [];
  const summary = useMemo(
    () => (state ? getGameSummary(state, players) : null),
    [players, state],
  );
  const owns = useCallback(
    (playerId: string) => Boolean(state?.holdings.some((holding) => holding.player_id === playerId)),
    [state?.holdings],
  );
  const isGameplayReady = Boolean(
    presentation
    && !isLoading
    && !isRefreshing
    && !serverError
    && !transitionRequired
    && !isTransitioning,
  );
  const dismissNotice = useCallback(() => setMessage(null), []);

  const value = useMemo<PortfolioContextValue>(() => ({
    state,
    players,
    leaderboard: presentation?.leaderboard ?? [],
    summary,
    displayName: presentation?.displayName ?? null,
    message,
    serverError,
    transitionError,
    transitionRequired,
    legacySavePresent,
    isLoading,
    isRefreshing,
    isTransitioning,
    isGameplayReady,
    pendingActions,
    shortSlots: presentation?.shortSlots
      ? { ...presentation.shortSlots, remaining: Math.max(0, presentation.shortSlots.total - presentation.shortSlots.used) }
      : { used: 0, total: 0, remaining: 0 },
    boostSlots: presentation?.boostSlots
      ? { ...presentation.boostSlots, remaining: Math.max(0, presentation.boostSlots.total - presentation.boostSlots.used) }
      : { used: 0, total: 0, remaining: 0 },
    weeklyShortTargets: presentation?.weeklyShortTargets ?? [],
    boostTargets: presentation?.boostTargets ?? [],
    playerTrends: presentation?.playerTrends ?? {},
    nextGameDate: presentation?.nextGameDate ?? null,
    settledGameDateCount: presentation?.settledGameDateCount ?? 0,
    latestSettledDate: presentation?.latestSettledDate ?? null,
    currentWeek: presentation?.currentWeek ?? null,
    trade,
    owns,
    armShort,
    armPlayerBoost,
    refreshData,
    confirmLocalTransition,
    dismissNotice,
  }), [
    armPlayerBoost,
    armShort,
    confirmLocalTransition,
    dismissNotice,
    isGameplayReady,
    isLoading,
    isRefreshing,
    isTransitioning,
    legacySavePresent,
    message,
    owns,
    pendingActions,
    players,
    presentation,
    refreshData,
    serverError,
    state,
    summary,
    trade,
    transitionError,
    transitionRequired,
  ]);

  return <PortfolioContext.Provider value={value}>{children}</PortfolioContext.Provider>;
}

export function usePortfolio() {
  const context = useContext(PortfolioContext);
  if (!context) throw new Error('usePortfolio must be used within PortfolioProvider');
  return context;
}
