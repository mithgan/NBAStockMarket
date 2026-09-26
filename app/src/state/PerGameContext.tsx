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
} from '../api/perGameClient';
import type {
  PerGameBootstrap,
  PerGameMarketPlayer,
  PerGameOpenPositionIntent,
  PerGamePosition,
} from '../api/contracts';
import { isMockActive, mockSeasonStart } from '../api/mockPerGameClient';
import { exactMoney, perGame } from '../copy/terms';
import { practiceProgress } from '../data/chromeView';
import { isAppResume } from './appResume';
import { ActionLock } from './actionLock';
import { loadPerGameBootstrapSnapshot } from './perGameBootstrapLoader';
import { refreshHasNews, refreshNotice } from './perGameNotices';
import { runPerGameMutation } from './perGameMutation';
import {
  MutationReconciliationCoordinator,
  type ReconciliationReason,
} from './reconciliationCoordinator';

/**
 * How a notice should behave: a success confirms what the player just did and
 * can clear itself; a problem needs the player to read it and stays until
 * dismissed.
 */
export type NoticeTone = 'success' | 'problem';

interface PerGameContextValue {
  state: PerGameBootstrap | null;
  bootstrap: PerGameBootstrap | null;
  players: PerGameMarketPlayer[];
  displayName: string | null;
  latestSettledDate: string | null;
  nextGameDate: string | null;
  message: string | null;
  noticeTone: NoticeTone;
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
  /**
   * Reload the account. `quietUnlessChanged` is for automatic refreshes (the
   * app coming back to the foreground): they only announce newly settled
   * games, so switching tabs does not pop a notice every time.
   */
  refreshData: (options?: { quietUnlessChanged?: boolean }) => Promise<boolean>;
  openPosition: (intent: PerGameOpenPositionIntent) => Promise<boolean>;
  closePosition: (position: PerGamePosition) => Promise<boolean>;
  dismissNotice: () => void;
  /** A short informational notice (clears itself), e.g. why a LOCKED button did nothing. */
  notify: (text: string) => void;
  confirmLocalTransition: () => Promise<false>;
}

const PerGameContext = createContext<PerGameContextValue | null>(null);

function errorMessage(error: unknown): string {
  if (error instanceof PerGameApiError) return error.message;
  return 'The per-game market could not load. Try again.';
}

/**
 * Whether the season is over: practice ends on its 174th day; a live season
 * ends when games have settled and none are scheduled.
 */
function seasonComplete(snapshot: PerGameBootstrap): boolean {
  if (isMockActive()) return practiceProgress(mockSeasonStart(), snapshot.game.lastSettledDate).complete;
  return snapshot.game.lastSettledDate !== null && snapshot.game.nextGameDate === null;
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
  const minimumSnapshotRef = useRef<PerGameBootstrap | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<NoticeTone>('problem');
  // The fee is part of every move's confirmation, so it is never a surprise.
  const feeNote = () => {
    const fee = bootstrapRef.current?.ruleset.transactionFeeDollars ?? 0;
    return fee > 0 ? ` ${exactMoney(fee)} fee.` : '';
  };
  const say = useCallback((text: string, tone: NoticeTone = 'problem') => {
    setNoticeTone(tone);
    setMessage(text);
  }, []);
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
    if (!mounted.current) return null;
    if (initial) setIsLoading(true);
    else setIsRefreshing(true);
    try {
      const previous = bootstrapRef.current;
      const next = await loadPerGameBootstrapSnapshot({
        previous,
        incremental,
        minimumSnapshot: minimumSnapshotRef.current,
        fetchBootstrap: (afterCursor) => apiClient.bootstrap(afterCursor),
        isCurrent: () => mounted.current && generation === requestGeneration.current,
      });
      if (!mounted.current || generation !== requestGeneration.current) return null;
      if (!next) {
        if (mounted.current) {
          say('The server returned an older account snapshot. Reconcile again before making roster changes.');
        }
        return null;
      }
      if (!mounted.current || generation !== requestGeneration.current) return null;
      minimumSnapshotRef.current = null;
      installBootstrap(next);
      setServerError(null);
      return next;
    } catch (error) {
      if (mounted.current && generation === requestGeneration.current) {
        if (bootstrapRef.current) {
          say(`The latest per-game market could not refresh. ${errorMessage(error)}`);
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
  }, [apiClient, installBootstrap, say]);

  useEffect(() => {
    void loadSnapshot({ initial: true, incremental: false });
  }, [loadSnapshot]);

  const updatePendingActions = useCallback(() => {
    if (mounted.current) {
      setPendingActions(actionLock.current.snapshot());
      setReconciliationRequired(reconciliation.current?.requiresReconciliation ?? false);
    }
  }, []);

  const refreshData = useCallback(async (options?: { quietUnlessChanged?: boolean }) => {
    // Press handlers may pass their event object straight through; only an
    // explicit `true` makes a refresh quiet.
    const quietUnlessChanged = options?.quietUnlessChanged === true;
    const coordinator = reconciliation.current;
    if (!coordinator) return false;
    const attempt = coordinator.beginRefresh();
    if (!attempt) return false;
    updatePendingActions();
    let succeeded = false;
    const previous = bootstrapRef.current;
    try {
      const refreshed = await loadSnapshot();
      succeeded = refreshed !== null;
      if (
        refreshed && mounted.current
        && (!quietUnlessChanged || refreshHasNews(previous, refreshed) || attempt.reconciliationReason)
      ) {
        say(refreshNotice(previous, refreshed, Boolean(attempt.reconciliationReason), { seasonComplete }), 'success');
      }
      return succeeded;
    } finally {
      coordinator.finishRefresh(attempt, succeeded);
      updatePendingActions();
    }
  }, [loadSnapshot, say, updatePendingActions]);

  useEffect(() => {
    if (isLoading || bootstrapRef.current === null) return undefined;
    appState.current = AppState.currentState;
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previousState = appState.current;
      appState.current = nextState;
      if (isAppResume(previousState, nextState)) void refreshData({ quietUnlessChanged: true });
    });
    return () => subscription.remove();
  }, [isLoading, refreshData]);

  const runPositionAction = useCallback(async <T extends { accountVersion: number },>(
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
    const actionSnapshot = bootstrapRef.current;
    try {
      const outcome = await runPerGameMutation({
        action,
        acknowledge: (version) => {
          if (mounted.current && actionSnapshot) {
            minimumSnapshotRef.current = {
              ...actionSnapshot,
              account: { ...actionSnapshot.account, version },
            };
          }
        },
        refresh: async () => Boolean(await loadSnapshot()),
      });
      reconciliationReason = outcome.reconciliationReason;
      if (!mounted.current) return false;
      if (outcome.result) {
        if (!outcome.refreshed) {
          say('Your roster action completed, but the latest account could not sync. Reconcile before making another roster change.');
          return false;
        }
        say(typeof successMessage === 'function' ? successMessage(outcome.result) : successMessage, 'success');
        return true;
      }
      const suffix = outcome.reconciliationReason === 'ambiguous'
        ? ' The result is uncertain. Reconcile before making another roster change.'
        : outcome.reconciliationReason === 'conflict'
          ? ' The latest account could not sync. Reconcile before making another roster change.'
          : outcome.refreshed
            ? ' Market refreshed. Review the updated roster and quote before trying again.'
            : '';
      say(`${errorMessage(outcome.error)}${suffix}`);
      return false;
    } finally {
      actionLock.current.release(key);
      coordinator.finishMutation(reconciliationReason);
      updatePendingActions();
    }
  }, [loadSnapshot, say, updatePendingActions]);

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
        ? `${playerName} added at ${perGame(result.lockedGameCost)}, locked in.${feeNote()}`
        : `Shorted ${playerName} at ${perGame(result.lockedGameCost)}, locked in.${feeNote()}`,
    );
  }, [apiClient, runPositionAction]);

  const closePosition = useCallback((position: PerGamePosition) => {
    const accountVersion = bootstrapRef.current?.account.version;
    if (accountVersion === undefined) return Promise.resolve(false);
    return runPositionAction(
      `position:${position.side}:${position.playerId}`,
      () => apiClient.closePosition(position.positionId, accountVersion),
      position.side === 'long'
        ? `${position.playerName} dropped. His next games won't count toward your score.${feeNote()}`
        : `Short on ${position.playerName} closed.${feeNote()}`,
    );
  }, [apiClient, runPositionAction]);

  const dismissNotice = useCallback(() => setMessage(null), []);
  const notify = useCallback((text: string) => say(text, 'success'), [say]);
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
    noticeTone,
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
    notify,
    confirmLocalTransition,
  }), [
    bootstrap,
    closePosition,
    confirmLocalTransition,
    dismissNotice,
    notify,
    isGameplayReady,
    isLoading,
    isRefreshing,
    reconciliationRequired,
    message,
    noticeTone,
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
