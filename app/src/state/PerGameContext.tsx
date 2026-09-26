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
import { settleTaps } from '../web/tapSettle';

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
  /**
   * Counts every notice, including one that repeats the last word for word
   * (a second LOCKED press): the notice restarts its timer and screen readers
   * hear it again instead of silence (walk 5 T3-10).
   */
  noticeSeq: number;
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
  const [noticeSeq, setNoticeSeq] = useState(0);
  // The fee is part of every move's confirmation, so it is never a surprise.
  // "$250 fee" never splits across lines (walk 5 T1-01 found "fee." alone).
  const feeNote = () => {
    const fee = bootstrapRef.current?.ruleset.transactionFeeDollars ?? 0;
    return fee > 0 ? ` ${exactMoney(fee)}\u00a0fee.` : '';
  };
  const say = useCallback((text: string, tone: NoticeTone = 'problem') => {
    setNoticeTone(tone);
    setMessage(text);
    setNoticeSeq((seq) => seq + 1);
  }, []);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [reconciliationRequired, setReconciliationRequired] = useState(false);
  const [pendingActions, setPendingActions] = useState<ReadonlySet<string>>(new Set());
  const actionLock = useRef(new ActionLock());
  // Moves pressed while another saves (see queueMove).
  const moveChain = useRef<Promise<unknown>>(Promise.resolve());
  const queuedMoves = useRef(new Set<string>());
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
      // A move waiting its turn counts as pending too, so +1 night pressed
      // after two quick Adds plays once both have saved.
      const pending = actionLock.current.snapshot();
      queuedMoves.current.forEach((key) => pending.add(`queued:${key}`));
      setPendingActions(pending);
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
    // The second tap of a double tap on a money button must not land on
    // whatever the move brings under the finger (walk 3 T4-01: a double tap
    // on "Short again" re-shorted the next player): a repeat on the same spot
    // is ignored for 1.2 s. A tap anywhere else is a new choice and acts at
    // once (walk 5 T4-01: adding down the list lost every other player).
    settleTaps(0, 1200, 'list');
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

  // Moves save one at a time (the account has one version), but a move
  // pressed while another saves waits its turn instead of vanishing: a player
  // adding down the list, or adding the next search result, gets every one
  // (walk 5 T4-01, T4-12). The same move pressed twice runs once. Each move
  // reads the account version when its turn comes, not when it was pressed.
  const queueMove = useCallback((key: string, run: () => Promise<boolean>): Promise<boolean> => {
    if (queuedMoves.current.has(key)) return Promise.resolve(false);
    queuedMoves.current.add(key);
    updatePendingActions();
    const turn = moveChain.current.then(run, run).finally(() => {
      queuedMoves.current.delete(key);
      updatePendingActions();
    });
    moveChain.current = turn.catch(() => undefined);
    return turn;
  }, [updatePendingActions]);

  const openPosition = useCallback(({
    playerId,
    playerName,
    side,
    expectedQuoteVersion,
  }: PerGameOpenPositionIntent) => {
    const key = `position:${side}:${playerId}`;
    return queueMove(key, () => {
      const accountVersion = bootstrapRef.current?.account.version;
      if (accountVersion === undefined) return Promise.resolve(false);
      return runPositionAction(
        key,
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
    });
  }, [apiClient, queueMove, runPositionAction]);

  const closePosition = useCallback((position: PerGamePosition) => {
    const key = `position:${position.side}:${position.playerId}`;
    return queueMove(key, () => {
      const accountVersion = bootstrapRef.current?.account.version;
      if (accountVersion === undefined) return Promise.resolve(false);
      return runPositionAction(
        key,
        () => apiClient.closePosition(position.positionId, accountVersion),
        position.side === 'long'
          ? `${position.playerName} dropped. His next games won't count toward your score.${feeNote()}`
          : `Short on ${position.playerName} closed.${feeNote()}`,
      );
    });
  }, [apiClient, queueMove, runPositionAction]);

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
    noticeSeq,
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
    noticeSeq,
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
