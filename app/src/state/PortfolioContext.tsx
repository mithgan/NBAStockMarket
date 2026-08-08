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
  canAdvanceDay: boolean;
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
  armShort: (player: Player, gameDate: string) => Promise<boolean>;
  armPlayerBoost: (player: Player, gameDate: string) => Promise<boolean>;
  refreshData: () => Promise<boolean>;
  advanceDay: () => Promise<boolean>;
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
    isCommitted: (bootstrap: ServerBootstrap) => boolean,
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
      if (!mutationFailureMayHaveCommitted(error)) {
        if (mounted.current) setMessage(errorMessage(error));
        return false;
      }
      const refreshed = await loadSnapshot({
        checkLocalTransition: false,
        showInitialLoader: false,
      });
      if (!refreshed) return false;
      const committed = isCommitted(refreshed);
      if (mounted.current) {
        setMessage(
          committed
            ? `${successMessage} The response was interrupted, but the server state is confirmed.`
            : 'The interrupted request did not change your account. You can safely try again.',
        );
      }
      return committed;
    } finally {
      actionLock.current.release(key);
      actionLock.current.release('account-mutation');
      updatePendingActions();
    }
  }, [loadSnapshot, updatePendingActions]);

  const advanceDay = useCallback(async () => {
    const nextGameDate = bootstrapRef.current?.game.next_game_date ?? null;
    if (!nextGameDate || !bootstrapRef.current?.capabilities.can_advance_day) return false;
    if (!actionLock.current.acquire('account-mutation')) return false;
    if (!actionLock.current.acquire('advance-day')) {
      actionLock.current.release('account-mutation');
      return false;
    }
    updatePendingActions();
    setMessage(null);
    try {
      await apiClient.settleNext(nextGameDate);
      const refreshed = await loadSnapshot({
        checkLocalTransition: false,
        showInitialLoader: false,
      });
      if (!refreshed) return false;
      if (mounted.current) setMessage(`Settled ${nextGameDate}.`);
      return true;
    } catch (error) {
      if (!mutationFailureMayHaveCommitted(error)) {
        if (mounted.current) setMessage(errorMessage(error));
        return false;
      }
      const refreshed = await loadSnapshot({
        checkLocalTransition: false,
        showInitialLoader: false,
      });
      if (!refreshed) return false;
      const committed = refreshed.game.next_game_date !== nextGameDate;
      if (mounted.current) {
        setMessage(
          committed
            ? `Settled ${nextGameDate}. The response was interrupted, but the server state is confirmed.`
            : 'The interrupted settlement did not advance the replay. You can safely try again.',
        );
      }
      return committed;
    } finally {
      actionLock.current.release('advance-day');
      actionLock.current.release('account-mutation');
      updatePendingActions();
    }
  }, [apiClient, loadSnapshot, updatePendingActions]);

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
      const result = await apiClient.trade(
        player.id,
        side,
        player.market_version ?? 0,
        settledResultsAfter,
      );
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

  const armShort = useCallback((player: Player, gameDate: string) => {
    const target = bootstrapRef.current?.portfolio.instruments.weekly_short_targets.find(
      (candidate) => candidate.player_id === player.id && candidate.game_date === gameDate,
    );
    if (!target) return Promise.resolve(false);
    const existingPositionIds = new Set(
      bootstrapRef.current?.portfolio.instruments.weekly_shorts.map(
        (position) => position.id,
      ) ?? [],
    );
    return runAction(
      `short:${player.id}`,
      () => apiClient.armWeeklyShort(
        player.id,
        target.game_date,
        player.market_version ?? 0,
      ),
      `Weekly short armed on ${player.name}.`,
      (refreshed) => refreshed.portfolio.instruments.weekly_shorts.some(
        (position) => position.player_id === player.id
          && !existingPositionIds.has(position.id),
      ),
    );
  }, [apiClient, runAction]);

  const armPlayerBoost = useCallback((player: Player, gameDate: string) => {
    const existingPositionIds = new Set(
      bootstrapRef.current?.portfolio.instruments.boosts.map(
        (position) => position.id,
      ) ?? [],
    );
    return runAction(
      `boost:${player.id}`,
      () => apiClient.armBoost(player.id, gameDate, player.market_version ?? 0),
      `${player.name} boosted for ${gameDate}.`,
      (refreshed) => refreshed.portfolio.instruments.boosts.some(
        (position) => position.player_id === player.id
          && position.game_date === gameDate
          && !existingPositionIds.has(position.id),
      ),
    );
  }, [apiClient, runAction]);

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
    canAdvanceDay: presentation?.canAdvanceDay ?? false,
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
    advanceDay,
    confirmLocalTransition,
    dismissNotice,
  }), [
    armPlayerBoost,
    armShort,
    advanceDay,
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
