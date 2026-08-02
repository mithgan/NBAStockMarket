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

import {
  MarketApiClient,
  MarketApiError,
  mutationFailureMayHaveCommitted,
} from '../api/client';
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
  mergeIncrementalBootstrap,
  serverRefreshNotice,
  type ServerPresentationState,
} from './serverState';
import { addIsoDays } from './simDates';

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
  canAdvanceSeason: boolean;
  advanceSeason: (calendarDays: 1 | 7) => Promise<boolean>;
  resetSeasonAccount: () => Promise<boolean>;
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
      const previous = bootstrapRef.current;
      const settledResultsAfter = previous?.game.last_settled_date ?? undefined;
      const incoming = await apiClient.bootstrap(settledResultsAfter);
      let bootstrap = incoming;
      if (previous && settledResultsAfter) {
        const merge = mergeIncrementalBootstrap(
          previous,
          incoming,
          settledResultsAfter,
        );
        bootstrap = merge.kind === 'reload'
          ? await apiClient.bootstrap()
          : merge.bootstrap;
      }
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
    if (mounted.current) setMessage(null);
    try {
      const refreshed = await loadSnapshot({
        checkLocalTransition: shouldInspectLocalTransition(
          localTransitionInspected,
          transitionRequired,
        ),
        showInitialLoader: false,
      });
      if (refreshed && mounted.current) setMessage(serverRefreshNotice(refreshed));
      return refreshed !== null;
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

  const trade = useCallback(async (player: Player, side: TradeSide) => {
    const key = `trade:${player.id}`;
    if (actionLock.current.has('account-refresh')) return false;
    if (!actionLock.current.acquire('account-mutation')) return false;
    if (!actionLock.current.acquire(key)) {
      actionLock.current.release('account-mutation');
      return false;
    }
    updatePendingActions();
    setMessage(null);
    let tradeCommitted = false;
    try {
      const previous = bootstrapRef.current;
      const settledResultsAfter = previous?.game.last_settled_date ?? undefined;
      const result = await apiClient.trade(player.id, side, settledResultsAfter);
      tradeCommitted = true;
      let incoming = result.bootstrap;
      if (!incoming) {
        incoming = await apiClient.bootstrap(settledResultsAfter);
      }
      let bootstrap = incoming;
      if (previous && settledResultsAfter) {
        const merge = mergeIncrementalBootstrap(
          previous,
          incoming,
          settledResultsAfter,
        );
        bootstrap = merge.kind === 'reload'
          ? await apiClient.bootstrap()
          : merge.bootstrap;
      }
      if (!mounted.current) return false;
      installBootstrap(bootstrap);
      setMessage(`${side === 'buy' ? 'Bought' : 'Sold'} one share of ${player.name}.`);
      return true;
    } catch (error) {
      if (mounted.current) {
        if (tradeCommitted || mutationFailureMayHaveCommitted(error)) {
          setServerError(
            tradeCommitted
              ? 'Your trade completed, but the latest account state could not be loaded. Retry before continuing.'
              : 'Your trade may have completed, but the latest account state could not be confirmed. Retry before continuing.',
          );
          setMessage(null);
        } else {
          setMessage(errorMessage(error));
        }
      }
      return false;
    } finally {
      actionLock.current.release(key);
      actionLock.current.release('account-mutation');
      updatePendingActions();
    }
  }, [apiClient, installBootstrap, updatePendingActions]);

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

  const advanceSeason = useCallback(async (calendarDays: 1 | 7) => {
    if (!apiClient.canAdvanceSeason) return false;
    if (actionLock.current.has('account-refresh')) return false;
    if (!actionLock.current.acquire('account-mutation')) return false;
    if (!actionLock.current.acquire('season-advance')) {
      actionLock.current.release('account-mutation');
      return false;
    }
    updatePendingActions();
    setMessage(null);
    let anySettled = false;
    try {
      let expected = bootstrapRef.current?.game.next_game_date ?? null;
      if (!expected) {
        if (mounted.current) setMessage('The season replay is already complete.');
        return false;
      }
      // Settle every game date inside the calendar span, so "+1 WEEK" collects
      // the same dividends the week would have paid one day at a time.
      const stop = addIsoDays(expected, calendarDays);
      let settled = 0;
      while (expected && expected < stop) {
        const result = await apiClient.advanceSettlement(expected);
        anySettled = true;
        settled += 1;
        expected = result.nextGameDate;
        if (result.isComplete) break;
      }
      const refreshed = await loadSnapshot({
        checkLocalTransition: false,
        showInitialLoader: false,
      });
      if (!refreshed) return false;
      if (mounted.current) {
        const label = `${settled} game ${settled === 1 ? 'date' : 'dates'}`;
        setMessage(expected === null
          ? `Settled ${label} — the season replay is complete.`
          : `Settled ${label}.`);
      }
      return true;
    } catch (error) {
      if (mounted.current) setMessage(errorMessage(error));
      if (anySettled) {
        await loadSnapshot({ checkLocalTransition: false, showInitialLoader: false });
      }
      return false;
    } finally {
      actionLock.current.release('season-advance');
      actionLock.current.release('account-mutation');
      updatePendingActions();
    }
  }, [apiClient, loadSnapshot, updatePendingActions]);

  const resetSeasonAccount = useCallback(() => runAction(
    'season-reset',
    async () => {
      const version = bootstrapRef.current?.portfolio.version;
      if (version === undefined) {
        throw new MarketApiError('Your account has not finished loading.', 'not_ready', null);
      }
      await apiClient.resetAccount(version);
    },
    'Account reset to the opening bankroll.',
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
    canAdvanceSeason: apiClient.canAdvanceSeason,
    advanceSeason,
    resetSeasonAccount,
  }), [
    advanceSeason,
    apiClient.canAdvanceSeason,
    armPlayerBoost,
    armShort,
    confirmLocalTransition,
    dismissNotice,
    resetSeasonAccount,
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
