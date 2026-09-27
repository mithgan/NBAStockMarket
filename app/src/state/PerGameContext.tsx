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
import { exactMoney, humanDate, lockNotice, moneyCompact, moneyFine, perGame, rosterReopensLine } from '../copy/terms';
import { practiceProgress } from '../data/chromeView';
import { isAppResume } from './appResume';
import { ActionLock } from './actionLock';
import { loadPerGameBootstrapSnapshot } from './perGameBootstrapLoader';
import { coversGames, refreshHasNews, refreshNotice } from './perGameNotices';
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

/** A lock that begins with the settled games, as the refresh notice says it. */
const LOCK_SENTENCE = / Moves pause for the (?:[A-Z][a-z]{2} \d{1,2}|next) games\./;

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
  /**
   * What screen readers hear for the notice, when it says more than the
   * drawn one: a new lock ("Moves pause for the Oct 28 games.") is spoken,
   * while the eye reads it in the status row's gold lock line instead of a
   * third or fourth notice line (walk 7 T3-18, T2-21, T4-13).
   */
  noticeSpoken: string | null;
  /**
   * The last notices, newest first, each as screen readers heard it, so a
   * player who missed one can read it again (walk 8 T3-I2, T4-N2).
   */
  recentNotices: readonly PerGameNoticeRecord[];
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
  refreshData: (options?: { quietUnlessChanged?: boolean; silent?: boolean }) => Promise<boolean>;
  openPosition: (intent: PerGameOpenPositionIntent) => Promise<boolean>;
  /**
   * `also`: one more sentence for the move's notice, so a screen reader hears
   * one message, not two a moment apart ("Room made for Kawhi Leonard.";
   * walk 6 T3-11).
   */
  closePosition: (position: PerGamePosition, options?: { also?: string }) => Promise<boolean>;
  dismissNotice: () => void;
  /** A short informational notice (clears itself), e.g. why a LOCKED button did nothing. */
  /** `tone: 'problem'` keeps it until closed (a run's notice that carries a refused move). */
  notify: (text: string, options?: { spoken?: string; tone?: NoticeTone }) => void;
  /**
   * A press on a LOCKED Add / Short / Drop: named with the games' notice when
   * it raced the lock the games just brought, else the lock's own sentence.
   */
  /** Answers a LOCKED press; true when it raced the lock and is told as a refused move. */
  lockedPress: (move: { name: string; verb: string }) => boolean;
  /**
   * Speak the notice on screen, shown silently a moment ago (`silent`, or
   * `spoken: ''`): a run of quick +1 night presses is heard once, when it
   * settles, not once per press (walk 8 T3-10). Nothing if another notice
   * has taken its place.
   */
  speakNotice: () => void;
  confirmLocalTransition: () => Promise<false>;
}

const PerGameContext = createContext<PerGameContextValue | null>(null);

/** One notice as it was said, and when. */
export interface PerGameNoticeRecord {
  text: string;
  tone: NoticeTone;
  at: number;
  /** Tells two notices apart (a key for lists). */
  id: number;
}

/** How many past notices the app keeps for re-reading. */
const RECENT_NOTICES_MAX = 10;

/** Moves that land this close together share one notice. */
const MOVE_BURST_MS = 1500;

/** "Luka Doncic", "Luka Doncic and Scottie Barnes", "A, B and C". */
function nameList(names: string[]): string {
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** How long a move waits for a refresh (a practice night) before it says so. */
const MOVE_WAITS_FOR_REFRESH_MS = 10_000;
/**
 * A success that comes while a refused move's notice shows joins it for this
 * long, so the refusal stays in view with its × (walk 12 T4-14: "Scottie
 * Barnes was not added" lasted 1.5 s under a waiting drop's "dropped").
 */
const PROBLEM_JOIN_MS = 8000;
/** A refusal this soon after waiting moves were told is told with them again. */
const WAITED_REJOIN_MS = 2000;
/** How soon a fuller notice replaces its shorter form in Recent notices. */
const NOTICE_GREW_MS = 3000;
/** How far back a run's notice finds its own first week's in Recent notices (a long run takes seconds). */
const RUN_GREW_MS = 60_000;
/** A notice that leads with the games it reports ("Oct 21–27 games: …", "Oct 21–Nov 3 games (2 weeks): …"). */
const GAMES_HEADLINE = /^[A-Z][a-z]{2} \d{1,2}(?:–(?:[A-Z][a-z]{2} )?\d{1,2})? games\b/;

function firstSentence(text: string): string {
  return text.split(/(?<=[.!?])\s+/)[0] ?? text;
}
/**
 * A press on a button that turned LOCKED this soon after the lock began raced
 * it: the finger was aimed at Add or Drop. Later it is a question about a
 * button already locked, answered with when moves reopen (walk 17 T4-01,
 * T4-07: during a run a games notice lands every half second, so timing from
 * the last notice made every LOCKED press a "refused" move, "Scottie Barnes
 * was not dropped" for a Drop never asked for).
 */
const LOCK_RACE_MS = 700;

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
  // What the notice area shows now, for a success that must not hide a
  // refusal (walk 12 T4-14).
  const shownTone = useRef<NoticeTone>('problem');
  shownTone.current = noticeTone;
  const shownAt = useRef(0);
  const [noticeSeq, setNoticeSeq] = useState(0);
  const [noticeSpoken, setNoticeSpoken] = useState<string | null>(null);
  // The fee is part of every move's confirmation, so it is never a surprise.
  // "$250 fee" never splits across lines (walk 5 T1-01 found "fee." alone).
  const feeNote = () => {
    const fee = bootstrapRef.current?.ruleset.transactionFeeDollars ?? 0;
    return fee > 0 ? ` ${exactMoney(fee)}\u00a0fee.` : '';
  };
  const [recentNotices, setRecentNotices] = useState<readonly PerGameNoticeRecord[]>([]);
  const noticeIds = useRef(0);
  const silentNotice = useRef<{ text: string; tone: NoticeTone; id: number } | null>(null);
  // The whole sentence as it was heard; a repeat of the last one (a second
  // LOCKED press) only moves its time.
  const remember = useCallback((heard: string, tone: NoticeTone, id: number, replaces: number | null = null) => {
    setRecentNotices((list) => {
      const last = list[0];
      const now = Date.now();
      if (last?.text === heard) return [{ ...last, at: now }, ...list.slice(1)];
      const entry = { text: heard, tone, at: now, id };
      // Quick moves shown as one notice are one entry, as the screen showed
      // them (walk 16 T4-12: ten quick adds pushed the season's results out).
      if (replaces !== null && list.some((item) => item.id === replaces)) {
        return [entry, ...list.filter((item) => item.id !== replaces)];
      }
      // A notice that grew a moment later (one more refused name, the same
      // games) takes its place: one entry for one event (walk 15 T4-05).
      if (last && now - last.at < NOTICE_GREW_MS && firstSentence(last.text) === firstSentence(heard) && heard.length > last.text.length) {
        return [entry, ...list.slice(1)];
      }
      // So does a run's notice, for its own first week's (walk 16 T4-11: a
      // refusal in that week left both, the refusal said twice).
      const covered = list.findIndex((item) => now - item.at < RUN_GREW_MS && coversGames(heard, item.text));
      if (covered >= 0) return [entry, ...list.filter((_, index) => index !== covered)];
      return [entry, ...list].slice(0, RECENT_NOTICES_MAX);
    });
  }, []);
  /**
   * `spoken`: what screen readers hear instead, when it differs. `recent`:
   * what Recent notices keeps instead, and the entry it takes the place of.
   * Returns the notice's id.
   */
  const say = useCallback((
    text: string,
    tone: NoticeTone = 'problem',
    spoken?: string,
    recent?: { text: string; replaces: number | null },
    /** The words this notice grows from, when they already ended a joined notice (a burst's last). */
    replacesTail: string | null = null,
  ): number => {
    const lock = tone === 'success' ? text.match(LOCK_SENTENCE) : null;
    const visible = lock && lock.index !== undefined && lock.index > 0 ? text.slice(0, lock.index) + text.slice(lock.index + lock[0].length) : text;
    // A refused move still on screen stays there: the success joins it, and
    // only the success is heard (walk 12 T4-14). So does the games' result a
    // waiting move lands behind: it was spoken with it but left the screen
    // (walk 15 T4-07: "Oct 21–27 games: …" gave way to "Luka Doncic dropped.").
    const shownSilent = silentNotice.current;
    const joinsGames = tone === 'success' && spoken !== '' && shownMessage.current !== null
      && shownSilent !== null && shownSilent.id === noticeIds.current
      && GAMES_HEADLINE.test(shownMessage.current) && Date.now() - shownAt.current < PROBLEM_JOIN_MS;
    const joins = joinsGames || (tone === 'success' && spoken !== '' && shownMessage.current !== null
      && shownTone.current === 'problem' && Date.now() - shownAt.current < PROBLEM_JOIN_MS);
    shownAt.current = Date.now();
    setNoticeTone(joins && !joinsGames ? 'problem' : joinsGames ? shownTone.current : tone);
    // A burst that joined a refused move's notice grows in place: "Amen
    // Thompson and Derrick White added. $500 in fees." takes the place of
    // "Amen Thompson added at …" at the end, never beside it (walk 18 T2-18).
    const shownNow = shownMessage.current;
    const joinedTo = joins && shownNow !== null && replacesTail && shownNow.endsWith(` ${replacesTail}`)
      ? shownNow.slice(0, shownNow.length - replacesTail.length - 1)
      : shownNow;
    setMessage(joins ? `${joinedTo} ${visible}` : visible);
    // The words as written, lock sentence and all, of a notice shown on its own.
    shownWritten.current = joins ? null : text;
    setNoticeSpoken(spoken ?? (lock || joins ? text : null));
    setNoticeSeq((seq) => seq + 1);
    noticeIds.current += 1;
    const id = noticeIds.current;
    // A silent notice is kept to be spoken later (speakNotice), and enters
    // the list then. A spoken notice that takes its place says it first, so
    // a night's result is heard even when a waiting move's notice follows at
    // once ("Oct 21 games: … Scottie Barnes was not added. …").
    const pending = silentNotice.current;
    silentNotice.current = spoken === '' ? { text, tone, id } : null;
    if (spoken === '') return id;
    const heard = spoken ?? text;
    if (pending) {
      remember(pending.text, pending.tone, pending.id);
      setNoticeSpoken(`${pending.text} ${heard}`);
    }
    remember(recent?.text ?? heard, tone, id, recent?.replaces ?? null);
    return id;
  }, [remember]);
  const shownMessage = useRef<string | null>(null);
  shownMessage.current = message;
  const shownWritten = useRef<string | null>(null);
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

  // When the current lock began (the moment the account first said so).
  const lockBeganAt = useRef<number | null>(null);
  const installBootstrap = useCallback((next: PerGameBootstrap) => {
    const before = bootstrapRef.current?.ruleset;
    const locked = next.ruleset.rosterMutationsLocked;
    if (!locked) lockBeganAt.current = null;
    else if (!before?.rosterMutationsLocked || before.rosterLockGameDate !== next.ruleset.rosterLockGameDate) lockBeganAt.current = Date.now();
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

  const refreshData = useCallback(async (options?: { quietUnlessChanged?: boolean; silent?: boolean }) => {
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
        const headline = refreshNotice(previous, refreshed, Boolean(attempt.reconciliationReason), { seasonComplete });
        lastRefreshNotice.current = { text: headline, at: Date.now() };
        say(headline, 'success', options?.silent === true ? '' : undefined);
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

  // Queued moves that fail one after another for the same reason (racing
  // Adds into the last slot) are told together, not only the last one (walk
  // 7 T4-01: "Kawhi Leonard" was never named).
  const recentFailure = useRef<{ verb: string; reason: string; names: string[]; at: number } | null>(null);
  const failureNotice = useCallback((move: { name: string; verb: string }, reason: string): string => {
    const now = Date.now();
    const last = recentFailure.current;
    const names = last && last.verb === move.verb && last.reason === reason && now - last.at < 4000 && !last.names.includes(move.name)
      ? [...last.names, move.name]
      : [move.name];
    recentFailure.current = { verb: move.verb, reason, names, at: now };
    return `${nameList(names)} ${names.length === 1 ? 'was' : 'were'} not ${move.verb}. ${reason}`;
  }, []);

  // Quick moves of one kind share one notice, so a fast fill of the roster
  // (or "Keep notices") shows all of them, not only the last (walk 8 T4-N2):
  // "Luka Doncic and Scottie Barnes added. $500 in fees." Screen readers
  // still hear each move's own sentence, with its price.
  const recentMoves = useRef<{ verb: string; names: string[]; shown: string; at: number } | null>(null);
  // The Recent notices entry of the last move that succeeded: a quick move
  // after it, shown with it, takes its place there too.
  const lastMoveEntry = useRef<number | null>(null);
  const burstNotice = useCallback((move: { name: string; verb: string }, text: string): string => {
    const now = Date.now();
    const last = recentMoves.current;
    const shownNow = shownMessage.current;
    const names = last && last.verb === move.verb && now - last.at < MOVE_BURST_MS
      && (shownNow === last.shown || (shownNow?.endsWith(` ${last.shown}`) ?? false)) && !last.names.includes(move.name)
      ? [...last.names, move.name]
      : [move.name];
    const fee = bootstrapRef.current?.ruleset.transactionFeeDollars ?? 0;
    // Totals read in K like every other figure ("$1.25K in fees", walk 9 T4-01).
    const fees = fee > 0 ? ` ${moneyFine(fee * names.length)}\u00a0in fees.` : '';
    const shown = names.length === 1 ? text
      : names.length <= 3 ? `${nameList(names)} ${move.verb}.${fees}`
        // The count first, then who came last (walk 10 T2-05: "Jalen Brunson
        // added: 10 players in a row" read as one player added ten times).
        : `${names.length} players ${move.verb}, the last ${move.name}.${fees}`;
    recentMoves.current = { verb: move.verb, names, shown, at: now };
    return shown;
  }, []);

  // Moves that waited for games which ended on a lock fail at once, in one
  // notice that keeps the games' result (walk 9 T4-04): "Oct 21–27 games: …
  // Moves pause for the Oct 28 games, so Scottie Barnes and Devin Booker were
  // not added." They are said together once the last of them has failed.
  const lastRefreshNotice = useRef<{ text: string; at: number } | null>(null);
  // A move that waited for games is checked before any call: moves locked by
  // those games, or whose price moved with them, fail at once and are told
  // together in one notice after the games' result (walk 9 T4-04, walk 10
  // T4-05: two refusals 0.4 s apart hid the night's result): "Oct 21 games:
  // your score rose $194.5K. Scottie Barnes and Devin Booker were not added:
  // their prices moved to $261.4K and $336.1K a game. Add them again if you
  // still want them."
  // `lockDate`: the lock that refused it (null: its price moved).
  // `gone`: a Drop or Close that waited for games which ended the short (or
  // took the player off the roster) had nothing left to do (walk 18 T4-09).
  type WaitedMove = { verb: string; name: string; locked: boolean; cost: number | null; lockDate?: string | null; gone?: boolean };
  const waitedMoves = useRef<{ moves: WaitedMove[]; base: string | null } | null>(null);
  // The last waiting moves told, so a refusal a moment later is told with
  // them, not over them (walk 12 T4-07: a second add refused as the week
  // landed replaced the first one's notice, and neither named both).
  const lastWaited = useRef<{ moves: WaitedMove[]; base: string | null; at: number } | null>(null);
  const sayWaitedMove = useCallback((move: WaitedMove) => {
    const batch = waitedMoves.current;
    if (batch) {
      if (!batch.moves.some((entry) => entry.name === move.name && entry.verb === move.verb)) batch.moves.push(move);
      return;
    }
    const last = lastWaited.current;
    // Told again only with moves the same lock refused: a move refused at the
    // Nov 5 lock was said again under the Nov 11 one (walk 17 T4-01).
    const sameLock = (entry: WaitedMove) => !entry.locked || !move.locked || (entry.lockDate ?? null) === (move.lockDate ?? null);
    if (last && Date.now() - last.at < WAITED_REJOIN_MS && last.moves.every(sameLock)) {
      const moves = last.moves.filter((entry) => !(entry.name === move.name && entry.verb === move.verb));
      waitedMoves.current = { moves: [...moves, move], base: last.base };
    } else {
      const recent = lastRefreshNotice.current;
      // A run's notice on screen that covers those games is the base: the
      // refusal joins the run's words as they stand, so the span and figure
      // never fall back to the last week alone (walk 18 T1-11: "$890.5K in
      // the Oct 21–Nov 3 games (2 weeks)" became "$436.5K in the Oct 28–Nov 3
      // games" for a moment).
      // Only a run wider than those games, and in its written words: the one
      // on screen leaves out its lock sentence ("Moves pause for the Oct 28
      // games"), which the refusal is told under.
      const written = shownMessage.current !== null ? shownWritten.current : null;
      const fresh = recent && Date.now() - recent.at < 6000 ? recent.text : null;
      const base = fresh && written && coversGames(written, fresh) && !coversGames(fresh, written) ? written : fresh;
      waitedMoves.current = { moves: [move], base };
    }
    setTimeout(() => {
      const done = waitedMoves.current;
      waitedMoves.current = null;
      if (!done) return;
      const verbs = [...new Set(done.moves.map((entry) => entry.verb))];
      const parts: string[] = [];
      let base = done.base;
      const locked = done.moves.filter((entry) => entry.locked);
      if (locked.length > 0) {
        const who = verbs
          .filter((verb) => locked.some((entry) => entry.verb === verb))
          .map((verb) => {
            const names = locked.filter((entry) => entry.verb === verb).map((entry) => entry.name);
            return `${nameList(names)} ${names.length === 1 ? 'was' : 'were'} not ${verb}`;
          })
          .join(', and ');
        if (base && LOCK_SENTENCE.test(` ${base}`)) {
          parts.push(`${base.replace(/\.$/, '')}, so ${who}.`);
        } else {
          if (base) parts.push(base);
          parts.push(`${who}. Your roster is locked. ${rosterReopensLine(bootstrapRef.current?.ruleset.rosterLockGameDate)}.`);
        }
        base = null;
      } else if (base) {
        parts.push(base);
      }
      for (const verb of verbs) {
        const moved = done.moves.filter((entry) => !entry.locked && !entry.gone && entry.verb === verb);
        if (moved.length === 0) continue;
        const one = moved.length === 1;
        const prices = moved.map((entry) => (entry.cost === null ? null : moneyCompact(entry.cost)));
        const known = prices.every((price) => price !== null);
        // The new price is the whole message: the row's Add (or Short) is one
        // tap away, so no "again if you still want him" line (walk 11 T1-09:
        // five lines at 390px, held until closed).
        const again = known ? '' : ` ${verb === 'shorted' ? 'Short' : 'Add'} ${one ? 'him' : 'them'} again at the new price if you still want ${one ? 'him' : 'them'}.`;
        parts.push(`${nameList(moved.map((entry) => entry.name))} ${one ? 'was' : 'were'} not ${verb}: ${one ? 'his price' : 'their prices'} moved${known ? ` to ${nameList(prices as string[])} a game` : ''}.${again}`);
      }
      // Nothing left to do: calm words after the games' result, never a
      // failure ("That position is not open", walk 18 T4-09).
      const gone = done.moves.filter((entry) => entry.gone && !entry.locked);
      // A close is named "Your short on <player>" for its own notices.
      const player = (name: string) => name.replace(/^Your short on /, '');
      const goneShorts = gone.filter((entry) => entry.verb === 'closed').map((entry) => player(entry.name));
      const goneHeld = gone.filter((entry) => entry.verb !== 'closed').map((entry) => entry.name);
      if (goneShorts.length > 0) {
        parts.push(goneShorts.length === 1
          ? `Closing ${goneShorts[0]}'s short was not needed: it had ended. No fee.`
          : `Closing the shorts on ${nameList(goneShorts)} was not needed: they had ended. No fees.`);
      }
      if (goneHeld.length > 0) {
        parts.push(goneHeld.length === 1
          ? `Dropping ${goneHeld[0]} was not needed: he was already off your roster. No fee.`
          : `Dropping ${nameList(goneHeld)} was not needed: they were already off your roster. No fees.`);
      }
      // The games' own notice is inside this one: it is not said again.
      silentNotice.current = null;
      say(parts.join(' '), gone.length === done.moves.length ? 'success' : 'problem');
      lastWaited.current = { moves: done.moves, base: done.base, at: Date.now() };
    }, 0);
  }, [say]);

  // A press on Add (or Short) that turned LOCKED as the games landed raced the
  // lock: it is a move that failed, named with the others in the games'
  // notice. A LOCKED pressed later only explains the lock (walk 12 T4-07).
  const lockedPress = useCallback((move: { name: string; verb: string }): boolean => {
    const began = lockBeganAt.current;
    // Only an Add or a Short acts on the press; a Drop or Close only opens a
    // question, so one that meets a lock was never tried: it is told the lock,
    // never "was not dropped" (walk 17 T4-01).
    const acts = move.verb === 'added' || move.verb === 'shorted';
    if (acts && began !== null && Date.now() - began < LOCK_RACE_MS) {
      sayWaitedMove({ verb: move.verb, name: move.name, locked: true, cost: null, lockDate: bootstrapRef.current?.ruleset.rosterLockGameDate ?? null });
      return true;
    }
    const date = bootstrapRef.current?.ruleset.rosterLockGameDate ?? null;
    const answer = lockNotice(date);
    // A notice on screen that already says this lock (a run's result ending
    // "Moves pause for the Nov 11 games.") stays; the answer is heard (walk 17
    // T4-01: the run's result gave way to the lock's words alone).
    const shown = shownMessage.current;
    if (shown && date && shown.includes(`Moves pause for the ${humanDate(date)} games`)) {
      say(shown, shownTone.current, answer);
      return false;
    }
    say(answer);
    return false;
  }, [say, sayWaitedMove]);

  const runPositionAction = useCallback(async <T extends { accountVersion: number },>(
    key: string,
    action: () => Promise<T>,
    successMessage: string | ((result: T) => string),
    /** Which move failed, said first ("Kawhi Leonard was not added."): a move
     * that waited its turn can fail after the player has moved on. `priceMoved`
     * says what his price is now when the quote moved under the move. */
    failedMove: { name: string; verb: string; priceMoved?: () => string; movedCost?: () => number | null; folds?: boolean } | null = null,
  ): Promise<boolean> => {
    const coordinator = reconciliation.current;
    if (!coordinator) return false;
    // Moves are locked now (it waited for the games that brought the lock;
    // every button says LOCKED otherwise): no call that must fail.
    if (failedMove && bootstrapRef.current?.ruleset.rosterMutationsLocked) {
      sayWaitedMove({ verb: failedMove.verb, name: failedMove.name, locked: true, cost: null, lockDate: bootstrapRef.current?.ruleset.rosterLockGameDate ?? null });
      return false;
    }
    // His price moved since the press (it waited for games): the call would
    // be refused, so it is told with the others instead.
    const movedCost = failedMove?.movedCost?.() ?? null;
    if (failedMove && movedCost !== null) {
      sayWaitedMove({ verb: failedMove.verb, name: failedMove.name, locked: false, cost: movedCost });
      return false;
    }
    if (!coordinator.beginMutation()) {
      // Never silence: a move that cannot start says so (walk 8 T4-03).
      if (failedMove) {
        say(failureNotice(failedMove, coordinator.requiresReconciliation
          ? 'Reconcile before making another roster change.'
          : 'The market was still updating. Try again in a moment.'));
      }
      return false;
    }
    if (!actionLock.current.acquire(key)) {
      coordinator.finishMutation(null);
      return false;
    }
    updatePendingActions();
    // The last move's notice stays until this one lands: clearing it here
    // wiped a queued move's result before anyone saw or heard it (walk 7
    // T3-16: with any network delay the first of two moves was never spoken).
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
        const text = typeof successMessage === 'function' ? successMessage(outcome.result) : successMessage;
        const before = recentMoves.current?.shown ?? null;
        const shown = failedMove?.folds ? burstNotice(failedMove, text) : text;
        const grouped = shown !== text;
        lastMoveEntry.current = say(shown, 'success', grouped ? text : undefined, grouped ? { text: shown, replaces: lastMoveEntry.current } : undefined, grouped ? before : null);
        return true;
      }
      // A Drop or Close that waited for games which ended the short or took
      // him off the roster: nothing left to do, told with the games' result.
      const gone = outcome.error instanceof PerGameApiError && !outcome.reconciliationReason && outcome.error.code === 'position_not_found';
      if (failedMove && gone && (failedMove.verb === 'closed' || failedMove.verb === 'dropped')) {
        sayWaitedMove({ verb: failedMove.verb, name: failedMove.name, locked: false, cost: null, gone: true });
        return false;
      }
      const suffix = outcome.reconciliationReason === 'ambiguous'
        ? ' The result is uncertain. Reconcile before making another roster change.'
        : outcome.reconciliationReason === 'conflict'
          ? ' The latest account could not sync. Reconcile before making another roster change.'
          : outcome.refreshed
            ? ' Market refreshed. Review the updated roster and quote before trying again.'
            : '';
      // A named move whose price moved (it waited behind a night) or that met
      // a lock says just that, and the price or the reopening, in one line.
      const code = outcome.error instanceof PerGameApiError && !outcome.reconciliationReason ? outcome.error.code : null;
      const reason = failedMove?.priceMoved && (code === 'quote_conflict' || code === 'quote_version_conflict')
        ? failedMove.priceMoved()
        : failedMove && code === 'roster_locked'
          ? errorMessage(outcome.error)
          : `${errorMessage(outcome.error)}${suffix}`;
      say(failedMove ? failureNotice(failedMove, reason) : reason);
      return false;
    } finally {
      actionLock.current.release(key);
      coordinator.finishMutation(reconciliationReason);
      updatePendingActions();
    }
  }, [burstNotice, failureNotice, loadSnapshot, say, sayWaitedMove, updatePendingActions]);

  // Moves save one at a time (the account has one version), but a move
  // pressed while another saves waits its turn instead of vanishing: a player
  // adding down the list, or adding the next search result, gets every one
  // (walk 5 T4-01, T4-12). The same move pressed twice runs once. Each move
  // reads the account version when its turn comes, not when it was pressed.
  // A move pressed while the market refreshes (a practice night playing, the
  // app coming back) waits for the refresh too, then reads the account and
  // his price as they stand: it vanished without a word (walk 8 T4-03).
  const untilRefreshed = useCallback(async () => {
    const deadline = Date.now() + MOVE_WAITS_FOR_REFRESH_MS;
    while (actionLock.current.has('account-refresh') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }, []);

  const queueMove = useCallback((key: string, run: () => Promise<boolean>): Promise<boolean> => {
    if (queuedMoves.current.has(key)) return Promise.resolve(false);
    // The second tap of a double tap on a money button must not land on
    // whatever the move brings under the finger (walk 3 T4-01: a double tap
    // on "Short again" re-shorted the next player): a repeat on the same spot
    // is ignored for 1.2 s. A tap anywhere else is a new choice and acts at
    // once (walk 5 T4-01: adding down the list lost every other player). The
    // spot is the press's own, taken now: when a queued move's turn came it
    // was wherever the next tap had just lifted, and that tap was lost.
    settleTaps(0, 1200, 'list');
    queuedMoves.current.add(key);
    updatePendingActions();
    const inTurn = () => untilRefreshed().then(run);
    const turn = moveChain.current.then(inTurn, inTurn).finally(() => {
      queuedMoves.current.delete(key);
      updatePendingActions();
    });
    moveChain.current = turn.catch(() => undefined);
    return turn;
  }, [untilRefreshed, updatePendingActions]);

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
        {
          name: playerName,
          verb: side === 'long' ? 'added' : 'shorted',
          folds: true,
          movedCost: () => {
            const now = bootstrapRef.current?.market.find((row) => row.playerId === playerId);
            return now && now.quoteVersion !== expectedQuoteVersion ? now.currentGameCost : null;
          },
          priceMoved: () => {
            const again = side === 'long' ? 'Add him again' : 'Short him again';
            const now = bootstrapRef.current?.market.find((row) => row.playerId === playerId);
            return now && now.quoteVersion !== expectedQuoteVersion
              ? `His price moved to ${perGame(now.currentGameCost)}. ${again} if you still want him.`
              : `His price moved. ${again} at the new price if you still want him.`;
          },
        },
      );
    });
  }, [apiClient, queueMove, runPositionAction]);

  const closePosition = useCallback((position: PerGamePosition, options?: { also?: string }) => {
    const key = `position:${position.side}:${position.playerId}`;
    const also = options?.also ? ` ${options.also}` : '';
    return queueMove(key, () => {
      const accountVersion = bootstrapRef.current?.account.version;
      if (accountVersion === undefined) return Promise.resolve(false);
      return runPositionAction(
        key,
        () => apiClient.closePosition(position.positionId, accountVersion),
        position.side === 'long'
          // Two lines on a phone, so the brand bar keeps its height: the Drop
          // question already said what stays in your score (walk 9 T1-10).
          ? `${position.playerName} dropped.${feeNote()}${also}`
          : `Short on ${position.playerName} closed.${feeNote()}${also}`,
        position.side === 'long'
          // A drop that made room says so itself; it never folds.
          ? { name: position.playerName, verb: 'dropped', folds: !options?.also }
          : { name: `Your short on ${position.playerName}`, verb: 'closed' },
      );
    });
  }, [apiClient, queueMove, runPositionAction]);

  const dismissNotice = useCallback(() => setMessage(null), []);
  const notify = useCallback((text: string, options?: { spoken?: string; tone?: NoticeTone }) => say(text, options?.tone ?? 'success', options?.spoken), [say]);
  const speakNotice = useCallback(() => {
    const silent = silentNotice.current;
    if (!silent || silent.id !== noticeIds.current) return;
    silentNotice.current = null;
    setNoticeSpoken(silent.text);
    remember(silent.text, silent.tone, silent.id);
  }, [remember]);
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
    noticeSpoken,
    recentNotices,
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
    lockedPress,
    speakNotice,
    confirmLocalTransition,
  }), [
    bootstrap,
    closePosition,
    confirmLocalTransition,
    dismissNotice,
    notify,
    lockedPress,
    speakNotice,
    isGameplayReady,
    isLoading,
    isRefreshing,
    reconciliationRequired,
    message,
    noticeSeq,
    noticeSpoken,
    noticeTone,
    recentNotices,
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
