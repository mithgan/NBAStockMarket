import { AppState } from 'react-native';
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
  PerGameApiClient,
  PerGameApiError,
  perGameMutationOutcomeMayHaveCommitted,
} from '../api/perGameClient';
import type {
  PerGameBootstrap,
  PerGameMarketPlayer,
  PerGameOpenPositionIntent,
  PerGamePosition,
} from '../api/contracts';
import { isAppResume } from './appResume';
import { ActionLock } from './actionLock';
import { loadPerGameBootstrapSnapshot } from './perGameBootstrapLoader';
import {
  MutationReconciliationCoordinator,
  type ReconciliationReason,
} from './reconciliationCoordinator';

interface PerGameContextValue {
  state: PerGameBootstrap | null;
  bootstrap: PerGameBootstrap | null;
  players: PerGameMarketPlayer[];
  displayName: string | null;
  latestSettledDate: string | null;
  nextGameDate: string | null;
  message: string | null;
  serverError: string | null;
  transitionError: null;
  transitionRequired: false;
  legacySavePresent: false;
  isLoading: boolean;
  isRefreshing: boolean;
  reconciliationRequired: boolean;
  isTransitioning: false;
  isGameplayReady: boolean;
  pendingActions: ReadonlySet<string>;
  refreshData: () => Promise<boolean>;
  openPosition: (intent: PerGameOpenPositionIntent) => Promise<boolean>;
  closePosition: (position: PerGamePosition) => Promise<boolean>;
  dismissNotice: () => void;
  confirmLocalTransition: () => Promise<false>;
}

const PerGameContext = createContext<PerGameContextValue | null>(null);

function errorMessage(error: unknown): string {
  if (error instanceof PerGameApiError) return error.message;
  return 'The per-game market could not load. Try again.';
}

export function PerGameProvider({
  apiClient,
  children,
}: {
  apiClient: PerGameApiClient;
  userId: string;
  children: ReactNode;
}) {
  const [bootstrap, setBootstrap] = useState<PerGameBootstrap | null>(null);
  const bootstrapRef = useRef<PerGameBootstrap | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [reconciliationRequired, setReconciliationRequired] = useState(false);
  const [pendingActions, setPendingActions] = useState<ReadonlySet<string>>(new Set());
  const actionLock = useRef(new ActionLock());
  const reconciliation = useRef<MutationReconciliationCoordinator | null>(null);
  if (reconciliation.current === null) {
    reconciliation.current = new MutationReconciliationCoordinator(actionLock.current);
  }
  const mounted = useRef(true);
  const requestGeneration = useRef(0);
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const installBootstrap = useCallback((next: PerGameBootstrap) => {
    bootstrapRef.current = next;
    setBootstrap(next);
  }, []);

  const loadSnapshot = useCallback(async ({
    initial = false,
    incremental = true,
  }: {
    initial?: boolean;
    incremental?: boolean;
  } = {}): Promise<PerGameBootstrap | null> => {
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    if (initial) setIsLoading(true);
    else setIsRefreshing(true);
    try {
      const previous = bootstrapRef.current;
      const next = await loadPerGameBootstrapSnapshot({
        previous,
        incremental,
        fetchBootstrap: (afterCursor) => apiClient.bootstrap(afterCursor),
        isCurrent: () => mounted.current && generation === requestGeneration.current,
      });
      if (!mounted.current || generation !== requestGeneration.current) return null;
      if (!next) {
        if (mounted.current) {
          setMessage('The server returned an older account snapshot. Reconcile again before making roster changes.');
        }
        return null;
      }
      if (!mounted.current || generation !== requestGeneration.current) return null;
      installBootstrap(next);
      setServerError(null);
      return next;
    } catch (error) {
      if (mounted.current && generation === requestGeneration.current) {
        if (bootstrapRef.current) {
          setMessage(`The latest per-game market could not refresh. ${errorMessage(error)}`);
        } else {
          setServerError(errorMessage(error));
        }
      }
      return null;
    } finally {
      if (mounted.current && generation === requestGeneration.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [apiClient, installBootstrap]);

  useEffect(() => {
    void loadSnapshot({ initial: true, incremental: false });
  }, [loadSnapshot]);

  const updatePendingActions = useCallback(() => {
    if (mounted.current) {
      setPendingActions(actionLock.current.snapshot());
      setReconciliationRequired(reconciliation.current?.requiresReconciliation ?? false);
    }
  }, []);

  const refreshData = useCallback(async () => {
    const coordinator = reconciliation.current;
    if (!coordinator) return false;
    const attempt = coordinator.beginRefresh();
    if (!attempt) return false;
    updatePendingActions();
    let succeeded = false;
    try {
      const refreshed = await loadSnapshot();
      succeeded = refreshed !== null;
      if (refreshed && mounted.current) {
        const nextDate = refreshed.game.nextGameDate;
        setMessage(attempt.reconciliationReason
          ? 'Account reconciled. Roster actions are available again.'
          : nextDate
            ? `Per-game market updated. Next game date: ${nextDate}.`
            : 'Per-game market updated. Waiting for the next schedule date.');
      }
      return succeeded;
    } finally {
      coordinator.finishRefresh(attempt, succeeded);
      updatePendingActions();
    }
  }, [loadSnapshot, updatePendingActions]);

  useEffect(() => {
    if (isLoading || bootstrapRef.current === null) return undefined;
    appState.current = AppState.currentState;
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previousState = appState.current;
      appState.current = nextState;
      if (isAppResume(previousState, nextState)) void refreshData();
    });
    return () => subscription.remove();
  }, [isLoading, refreshData]);

  const runPositionAction = useCallback(async <T,>(
    key: string,
    action: () => Promise<T>,
    successMessage: string | ((result: T) => string),
  ): Promise<boolean> => {
    const coordinator = reconciliation.current;
    if (!coordinator || !coordinator.beginMutation()) return false;
    if (!actionLock.current.acquire(key)) {
      coordinator.finishMutation(null);
      return false;
    }
    updatePendingActions();
    setMessage(null);
    let reconciliationReason: ReconciliationReason | null = null;
    try {
      const result = await action();
      const refreshed = await loadSnapshot();
      if (!refreshed) {
        reconciliationReason = 'confirmed-global';
        if (mounted.current) {
          setMessage('Your roster action completed, but the latest account could not sync. Reconcile before making another roster change.');
        }
        return false;
      }
      if (mounted.current) {
        setMessage(typeof successMessage === 'function' ? successMessage(result) : successMessage);
      }
      return true;
    } catch (error) {
      const uncertain = perGameMutationOutcomeMayHaveCommitted(error);
      if (uncertain) reconciliationReason = 'ambiguous';
      if (mounted.current) {
        const suffix = uncertain
          ? ' The result is uncertain. Reconcile before making another roster change.'
          : '';
        setMessage(`${errorMessage(error)}${suffix}`);
      }
      return false;
    } finally {
      actionLock.current.release(key);
      coordinator.finishMutation(reconciliationReason);
      updatePendingActions();
    }
  }, [loadSnapshot, updatePendingActions]);

  const openPosition = useCallback(({
    playerId,
    playerName,
    side,
    expectedQuoteVersion,
  }: PerGameOpenPositionIntent) => {
    const accountVersion = bootstrapRef.current?.account.version;
    if (accountVersion === undefined) return Promise.resolve(false);
    return runPositionAction(
      `position:${side}:${playerId}`,
      () => apiClient.openPosition({
        playerId,
        side,
        expectedAccountVersion: accountVersion,
        expectedQuoteVersion,
      }),
      (result) => result.side === 'long'
        ? `${playerName} added at a locked ${result.lockedGameCost.toLocaleString('en-US')} dollars per game.`
        : `${playerName} inverse position opened at a locked ${result.lockedGameCost.toLocaleString('en-US')} dollars per game.`,
    );
  }, [apiClient, runPositionAction]);

  const closePosition = useCallback((position: PerGamePosition) => {
    const accountVersion = bootstrapRef.current?.account.version;
    if (accountVersion === undefined) return Promise.resolve(false);
    return runPositionAction(
      `position:${position.side}:${position.playerId}`,
      () => apiClient.closePosition(position.positionId, accountVersion),
      position.side === 'long'
        ? `${position.playerName} dropped. Future games will not affect your P&L.`
        : `${position.playerName} inverse position closed.`,
    );
  }, [apiClient, runPositionAction]);

  const dismissNotice = useCallback(() => setMessage(null), []);
  const confirmLocalTransition = useCallback(async (): Promise<false> => false, []);
  const isGameplayReady = Boolean(bootstrap && !isLoading && !serverError);

  const value = useMemo<PerGameContextValue>(() => ({
    state: bootstrap,
    bootstrap,
    players: bootstrap?.market ?? [],
    displayName: bootstrap?.account.displayName ?? null,
    latestSettledDate: bootstrap?.game.lastSettledDate ?? null,
    nextGameDate: bootstrap?.game.nextGameDate ?? null,
    message,
    serverError,
    transitionError: null,
    transitionRequired: false,
    legacySavePresent: false,
    isLoading,
    isRefreshing,
    reconciliationRequired,
    isTransitioning: false,
    isGameplayReady,
    pendingActions,
    refreshData,
    openPosition,
    closePosition,
    dismissNotice,
    confirmLocalTransition,
  }), [
    bootstrap,
    closePosition,
    confirmLocalTransition,
    dismissNotice,
    isGameplayReady,
    isLoading,
    isRefreshing,
    reconciliationRequired,
    message,
    openPosition,
    pendingActions,
    refreshData,
    serverError,
  ]);

  return <PerGameContext.Provider value={value}>{children}</PerGameContext.Provider>;
}

export function usePerGame() {
  const context = useContext(PerGameContext);
  if (!context) throw new Error('usePerGame must be used within PerGameProvider');
  return context;
}
