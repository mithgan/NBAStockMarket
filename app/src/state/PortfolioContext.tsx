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
import type { ServerBootstrap, ServerPortfolio } from '../api/contracts';
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
  MutationReconciliationCoordinator,
  SnapshotGeneration,
  mutationOutcomeMayHaveCommitted,
  stageMutationThenReconcile,
} from './mutationReconciliation';
import {
  applyPortfolioValuationToSummary,
  applyServerPortfolioToPresentation,
  isServerAccountPristine,
  mapServerBootstrap,
  mergeIncrementalBootstrap,
  serverRefreshNotice,
  type MutationPriceUpdate,
  type ServerPresentationState,
} from './serverState';
import {
  SeasonReplayError,
  settleRemainingSeason,
  type SeasonReplayProgress,
} from './seasonReplay';
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
  canAdvanceDay: boolean;
  seasonReplayProgress: SeasonReplayProgress | null;
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
  advanceDay: () => Promise<boolean>;
  advanceSeason: () => Promise<boolean>;
  refreshData: () => Promise<boolean>;
  confirmLocalTransition: () => Promise<boolean>;
  dismissNotice: () => void;
  canAdvanceSandbox: boolean;
  advanceSandboxDays: (calendarDays: 1 | 7) => Promise<boolean>;
  resetSeasonAccount: () => Promise<boolean>;
}

const PortfolioContext = createContext<PortfolioContextValue | null>(null);

interface ReconciledActionResult {
  portfolio: ServerPortfolio;
  priceUpdate?: MutationPriceUpdate;
}

function errorMessage(error: unknown): string {
  if (error instanceof MarketApiError) return error.message;
  if (error instanceof SeasonReplayError) return error.message;
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
  const [seasonReplayProgress, setSeasonReplayProgress] = useState<SeasonReplayProgress | null>(null);
  const actionLock = useRef(new ActionLock());
  const [pendingActions, setPendingActions] = useState<ReadonlySet<string>>(new Set());
  const mounted = useRef(true);
  const snapshotGeneration = useRef(new SnapshotGeneration());
  const reconciliationCoordinator = useRef(
    new MutationReconciliationCoordinator(actionLock.current),
  );

  useEffect(() => () => {
    mounted.current = false;
  }, []);

  const installBootstrap = useCallback((bootstrap: ServerBootstrap) => {
    bootstrapRef.current = bootstrap;
    setPresentation(mapServerBootstrap(bootstrap));
  }, []);

  const loadSnapshot = useCallback(async ({
    checkLocalTransition,
    errorMode = 'blocking',
    showInitialLoader,
    showRefreshIndicator = !showInitialLoader,
  }: {
    checkLocalTransition: boolean;
    errorMode?: 'blocking' | 'nonblocking' | 'confirmed-reconciliation' | 'ambiguous-reconciliation';
    showInitialLoader: boolean;
    showRefreshIndicator?: boolean;
  }): Promise<ServerBootstrap | null> => {
    const generation = snapshotGeneration.current.begin();
    if (showInitialLoader) setIsLoading(true);
    else if (showRefreshIndicator) setIsRefreshing(true);
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
      if (!mounted.current || !snapshotGeneration.current.isCurrent(generation)) return null;
      setServerError(null);
      installBootstrap(bootstrap);
      if (checkLocalTransition) {
        const inspection = await inspectLocalTransition(AsyncStorage, userId);
        if (!mounted.current || !snapshotGeneration.current.isCurrent(generation)) return null;
        setLocalTransitionInspected(true);
        setTransitionError(inspection.error);
        setLegacySavePresent(inspection.legacySavePresent);
        setTransitionRequired(Boolean(inspection.error) || inspection.legacySavePresent);
      }
      return bootstrap;
    } catch (error) {
      if (mounted.current && snapshotGeneration.current.isCurrent(generation)) {
        if (errorMode === 'blocking') {
          setServerError(errorMessage(error));
        } else if (errorMode === 'nonblocking') {
          setMessage(`The latest market could not refresh. Your previous snapshot is still visible. ${errorMessage(error)}`);
        } else if (errorMode === 'confirmed-reconciliation') {
          const reason = errorMessage(error);
          setMessage(`Your action was saved, but the latest market could not sync. Refresh before another move. ${reason}`);
        } else {
          const reason = errorMessage(error);
          setMessage(`The previous action's result is still uncertain because the latest market could not sync. Try again before another move. ${reason}`);
        }
      }
      return null;
    } finally {
      if (mounted.current && snapshotGeneration.current.isCurrent(generation)) {
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
    const refreshAttempt = reconciliationCoordinator.current.beginRefresh(
      () => actionLock.current.acquire('account-refresh'),
      () => actionLock.current.acquire('account-mutation'),
    );
    if (!refreshAttempt) return false;
    const { reconciliationReason } = refreshAttempt;
    updatePendingActions();
    if (mounted.current) setMessage(null);
    let succeeded = false;
    try {
      const refreshed = await loadSnapshot({
        checkLocalTransition: shouldInspectLocalTransition(
          localTransitionInspected,
          transitionRequired,
        ),
        errorMode: reconciliationReason === 'confirmed-staged'
          ? 'confirmed-reconciliation'
          : reconciliationReason === 'ambiguous'
            ? 'ambiguous-reconciliation'
            : reconciliationReason === 'confirmed-global'
              ? 'blocking'
              : bootstrapRef.current
                ? 'nonblocking'
                : 'blocking',
        showInitialLoader: false,
      });
      if (refreshed && mounted.current) {
        succeeded = true;
        setMessage(serverRefreshNotice(refreshed));
      }
      return refreshed !== null;
    } finally {
      reconciliationCoordinator.current.finishRefresh(refreshAttempt, succeeded);
      updatePendingActions();
    }
  }, [loadSnapshot, localTransitionInspected, transitionRequired, updatePendingActions]);

  const runReconciledAction = useCallback(async (
    key: string,
    action: () => Promise<ReconciledActionResult>,
    successMessage: string,
  ): Promise<boolean> => {
    if (!reconciliationCoordinator.current.beginMutation(
      () => actionLock.current.acquire('account-mutation'),
    )) return false;
    if (!actionLock.current.acquire(key)) {
      reconciliationCoordinator.current.finishMutation(null);
      return false;
    }
    updatePendingActions();
    setMessage(null);
    let reconciliationReason: 'confirmed-staged' | 'ambiguous' | null = null;
    try {
      const { snapshot: refreshed } = await stageMutationThenReconcile({
        mutate: action,
        stage: (result) => {
          if (!mounted.current) return;
          setPresentation((current) => (
            current
              ? applyServerPortfolioToPresentation(
                current,
                result.portfolio,
                result.priceUpdate,
              )
              : current
          ));
          setMessage(`${successMessage} Syncing the latest market...`);
        },
        reconcile: () => loadSnapshot({
          checkLocalTransition: false,
          errorMode: 'confirmed-reconciliation',
          showInitialLoader: false,
          showRefreshIndicator: false,
        }),
      });
      if (!refreshed) {
        if (mounted.current) {
          reconciliationReason = 'confirmed-staged';
          setMessage(`${successMessage} Your portfolio is updated, but the latest quotes could not sync. Tap CLOSE to retry before another move.`);
        }
        return false;
      }
      if (mounted.current) setMessage(successMessage);
      return true;
    } catch (error) {
      reconciliationReason = mutationOutcomeMayHaveCommitted(error)
        ? 'ambiguous'
        : null;
      if (mounted.current) {
        setMessage(
          reconciliationReason
            ? `${errorMessage(error)} The result is uncertain. Tap CLOSE to sync before another move.`
            : errorMessage(error),
        );
      }
      return false;
    } finally {
      actionLock.current.release(key);
      reconciliationCoordinator.current.finishMutation(reconciliationReason);
      updatePendingActions();
    }
  }, [loadSnapshot, updatePendingActions]);

  const runFullRefreshAction = useCallback(async (
    key: string,
    action: () => Promise<unknown>,
    successMessage: string,
  ): Promise<boolean> => {
    if (!reconciliationCoordinator.current.beginMutation(
      () => actionLock.current.acquire('account-mutation'),
    )) return false;
    if (!actionLock.current.acquire(key)) {
      reconciliationCoordinator.current.finishMutation(null);
      return false;
    }
    updatePendingActions();
    setMessage(null);
    let reconciliationReason: 'confirmed-global' | 'ambiguous' | null = null;
    try {
      await action();
      const refreshed = await loadSnapshot({
        checkLocalTransition: false,
        showInitialLoader: false,
      });
      if (!refreshed) {
        reconciliationReason = 'confirmed-global';
        return false;
      }
      if (mounted.current) setMessage(successMessage);
      return true;
    } catch (error) {
      reconciliationReason = mutationOutcomeMayHaveCommitted(error)
        ? 'ambiguous'
        : null;
      if (mounted.current) {
        setMessage(
          reconciliationReason
            ? `${errorMessage(error)} The result is uncertain. Tap CLOSE to sync before another move.`
            : errorMessage(error),
        );
      }
      return false;
    } finally {
      actionLock.current.release(key);
      reconciliationCoordinator.current.finishMutation(reconciliationReason);
      updatePendingActions();
    }
  }, [loadSnapshot, updatePendingActions]);

  const currentQuoteVersion = useCallback((playerId: string) => {
    const version = bootstrapRef.current?.market.find(
      (listing) => listing.id === playerId,
    )?.version;
    if (version === undefined) {
      throw new MarketApiError(
        'The displayed quote is unavailable. Refresh before making a move.',
        'quote_unavailable',
        null,
      );
    }
    return version;
  }, []);

  const currentGameDate = useCallback(() => {
    const gameDate = bootstrapRef.current?.game.next_game_date;
    if (!gameDate) {
      throw new MarketApiError(
        'The replay day is unavailable. Refresh before using a weekly play.',
        'clock_unavailable',
        null,
      );
    }
    return gameDate;
  }, []);

  const trade = useCallback((player: Player, side: TradeSide) => runReconciledAction(
    `trade:${player.id}`,
    async () => {
      const result = await apiClient.trade(
        player.id,
        side,
        currentQuoteVersion(player.id),
      );
      return {
        portfolio: result.portfolio,
        priceUpdate: {
          playerId: result.trade.player_id,
          currentPriceCents: result.trade.new_price_cents,
        },
      };
    },
    `${side === 'buy' ? 'Bought' : 'Sold'} one share of ${player.name}.`,
  ), [apiClient, currentQuoteVersion, runReconciledAction]);

  const armShort = useCallback((player: Player) => runReconciledAction(
    `short:${player.id}`,
    async () => {
      const result = await apiClient.armWeeklyShort(
        player.id,
        currentGameDate(),
        currentQuoteVersion(player.id),
      );
      return { portfolio: result.portfolio };
    },
    `Weekly short armed on ${player.name}.`,
  ), [apiClient, currentGameDate, currentQuoteVersion, runReconciledAction]);

  const armPlayerBoost = useCallback((player: Player, gameDate: string) => runReconciledAction(
      `boost:${player.id}`,
      async () => {
        const result = await apiClient.armBoost(
          player.id,
          gameDate,
          currentQuoteVersion(player.id),
        );
        return { portfolio: result.portfolio };
      },
      `${player.name} boosted for ${gameDate}.`,
  ), [apiClient, currentQuoteVersion, runReconciledAction]);

  const advanceDay = useCallback(async () => {
    const nextGameDate = bootstrapRef.current?.game.next_game_date;
    if (!nextGameDate) {
      if (mounted.current) setMessage('The historical replay is complete.');
      return false;
    }
    return runFullRefreshAction(
      'advance',
      () => apiClient.advanceDay(nextGameDate),
      `${nextGameDate} settled. Prices and portfolios are updated.`,
    );
  }, [apiClient, runFullRefreshAction]);

  const advanceSeason = useCallback(async () => {
    const nextGameDate = bootstrapRef.current?.game.next_game_date;
    if (!nextGameDate) {
      if (mounted.current) setMessage('The historical replay is complete.');
      return false;
    }
    setSeasonReplayProgress(null);
    try {
      return await runFullRefreshAction(
        'advance-season',
        () => settleRemainingSeason(
          nextGameDate,
          (date) => apiClient.advanceDay(date),
          (progress) => {
            if (mounted.current) setSeasonReplayProgress(progress);
          },
        ),
        'The historical season is fully settled. Prices and portfolios are updated.',
      );
    } finally {
      if (mounted.current) setSeasonReplayProgress(null);
    }
  }, [apiClient, runFullRefreshAction]);

  const advanceSandboxDays = useCallback(async (calendarDays: 1 | 7) => {
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
        const result = await apiClient.advanceDay(expected);
        anySettled = true;
        settled += 1;
        expected = result.next_game_date;
        if (result.is_complete) break;
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

  const resetSeasonAccount = useCallback(() => runFullRefreshAction(
    'season-reset',
    async () => {
      const version = bootstrapRef.current?.portfolio.version;
      if (version === undefined) {
        throw new MarketApiError('Your account has not finished loading.', 'not_ready', null);
      }
      await apiClient.resetAccount(version);
    },
    'Account reset to the opening bankroll.',
  ), [apiClient, runFullRefreshAction]);

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
    () => (
      state && presentation
        ? applyPortfolioValuationToSummary(
          getGameSummary(state, players),
          presentation.portfolioValuation,
        )
        : null
    ),
    [players, presentation, state],
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
  const dismissNotice = useCallback(() => {
    if (reconciliationCoordinator.current.requiresReconciliation) {
      void refreshData();
      return;
    }
    setMessage(null);
  }, [refreshData]);

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
    canAdvanceDay: (presentation?.canAdvanceDay ?? false) || apiClient.canAdvanceSeason,
    seasonReplayProgress,
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
    advanceDay,
    advanceSeason,
    refreshData,
    confirmLocalTransition,
    dismissNotice,
    canAdvanceSandbox: apiClient.canAdvanceSeason,
    advanceSandboxDays,
    resetSeasonAccount,
  }), [
    advanceSeason,
    advanceSandboxDays,
    apiClient.canAdvanceSeason,
    armPlayerBoost,
    armShort,
    advanceDay,
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
    seasonReplayProgress,
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
