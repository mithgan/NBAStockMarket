import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Modal, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { resolvePublicAppConfig } from '../api/config';
import type { PerGameBootstrap } from '../api/contracts';
import {
  advanceMockDays,
  advanceMockNights,
  isMockActive,
  mockSeasonStart,
} from '../api/mockPerGameClient';
import {
  ADVANCE_DOUBLE_TAP_MS,
  advanceTap,
  advanceTapsAcross,
  type AdvanceTapState,
  advanceQuiet,
  asksBeforeEmptyNight,
  asksBeforeEmptyWeek,
  cancelHintFits,
  lockedWeekQuestion,
  emptyQuestionAfterGames,
  cancelQueuedLabel,
  seasonQueuedWeekName,
  menuResultText,
  CHROME_WIDE_MIN_WIDTH,
  questionLeadsWithNews,
  NO_ADVANCE_TAPS,
  playToEndLockedLine,
  playToEndOffersMarket,
  playToEndOffersNight,
  questionAnswerOrder,
  questionTight,
  playToEndShortsOnlyLines,
  playToEndSpanLine,
  queuedCancelControlName,
  queuedCancelHint,
  cancelPlace,
  queueEndedNotice,
  queueingAdvanceName,
  SEASON_DONE_SLOT,
  withCancelledNote,
  CHROME_FOLDED_ONE_LINE_MIN_WIDTH,
  chromeFolded,
  isGamesNotice,
  seasonEndRowShows,
  seasonEndStanding,
  tinyRowHoldsNight,
  chromeLayout,
  continuesRun,
  runSpanFrom,
  RUN_CONTINUE_MS,
  FRESH_SEASON_NOTICE,
  gamesInLine,
  heldLineEnds,
  lockIconName,
  lockShortText,
  lockSlotText,
  keepControlNames,
  playingHint,
  nightButtonName,
  weekButtonName,
  PHONE_SLOT_MIN_WIDTH,
  NIGHT_DATE_STACKED_MIN_WIDTH,
  stackedWeekLabel,
  WEEK_ONE_LINE_STACKED_MIN_WIDTH,
  PLAY_TO_END_LABEL,
  playToEndQuestion,
  playToEndQueuedLine,
  type PracticeAdvance,
  practiceAsksFirst,
  practiceHint,
  practiceHintShort,
  practiceOffersExit,
  practiceProgress,
  practiceQuestion,
  practiceSeasonEnd,
  practiceStakes,
  practiceWeekHint,
  savingHint,
  savingQueueHint,
  restartHasNothingToDo,
  queuedCancelledNotice,
  queuedCancelName,
  queuedLabel,
  queuedLine,
  queuedWaitLine,
  queuedAnswerLine,
  queuedThrough,
  queuedLineThrough,
  nightAfterQueue,
  questionFlightLine,
  movesInFlight,
  type MoveInFlight,
  queueFullLine,
  queueLastLine,
  QUEUE_LINE_PAUSE_MS,
  NOTHING_QUEUED_NAME,
  NOTHING_TO_CANCEL,
  queueHasRoom,
  seasonEndControl,
  resultSpan,
  mergeRefusals,
  runNoticeText,
  seasonEndAfterRun,
  mergeMoves,
  runMoves,
  runRefusals,
  withMoves,
  withRefusals,
  SEASON_TOTAL_DAYS,
  weekSpanLabel,
} from '../data/chromeView';
import type { PracticeRulesContext } from '../data/perGameRules';
import { humanDate, rosterReopensLine, seasonResultLine, spokenRanks } from '../copy/terms';
import { rankLine } from '../data/rosterView';
import { usePerGame } from '../state/PerGameContext';
import { isSeasonCompleteNotice, keepDatesTogether, newsFirst, refreshNotice } from '../state/perGameNotices';
import { setPracticePlaying, usePracticePlaying } from '../state/practicePlaying';
import { openTab } from '../state/uiActions';
import { SEASON_RESULT_HEADING_ID } from '../ui/domMarkers';
import { colors, fonts, headingStyle, radius, space, type, weight } from '../theme';
import { Button, headingLevel, settleTaps, visuallyHidden } from '../ui/kit';
import { useSheetHistory } from '../web/appHistory';
import { pressedByPointer, quietLift, unlessSettling } from '../web/tapSettle';
import { usePracticeHover } from './chrome/practiceHover';
import { leavePractice, restartPractice } from '../web/practiceSession';
import { ChromeButton } from './chrome/ChromeButton';
import { LockIcon, MoreIcon } from './chrome/ChromeIcons';

/**
 * Resolve once the browser has painted the frame now pending, so a press
 * shows "Playing…" before the night's heavy work starts: on a slow phone the
 * label waited for the whole night (walk 5 T4-11). A hidden tab paints no
 * frames, so it does not wait; the timer is only a safety net.
 */
const PAINT_FALLBACK_MS = 500;

/**
 * A second tap on the same advance button sooner than this is the same press
 * bouncing (a double tap, or a double-click by habit), not a second night: it
 * is ignored. A deliberate second press, a moment later, is queued and plays
 * (walk 5 T3-11, T4-06; walk 6 T2-09, T4-01). Keyboard presses have no spot
 * and always count.
 */
// A steady run of taps plays every press; only an isolated pair is a double
// tap (walk 9 T4-11, chromeView.advanceTap). Near the season's end (or when
// the press asks first) something else takes the button's spot, so the old
// same-spot guard keeps a double tap's second click off it.
const advanceTaps: Record<'night' | 'week', AdvanceTapState> = { night: NO_ADVANCE_TAPS, week: NO_ADVANCE_TAPS };

/**
 * The latest finger (or mouse) press on the page: where, and when it went
 * down by the event's own clock. A frame busy drawing the week that just
 * landed holds back the click that presses the button, not the touch: timed
 * by the click, a steady run's second tap (265 ms after the first) read as
 * 404 ms and was dropped as a double tap's bounce, on a slow connection only
 * (walk 13 T4-01). Taps are judged by when the finger went down.
 */
let lastPointerDown: { x: number; y: number; at: number } | null = null;
let pointerDownsWatched = false;
/** A press's finger-down older than this is not the press being handled. */
const POINTER_DOWN_FRESH_MS = 2000;

function watchPointerDowns(): void {
  if (pointerDownsWatched || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  pointerDownsWatched = true;
  window.addEventListener('pointerdown', (event) => {
    // How long ago the finger went down, by the page's own clock (a busy
    // frame delays this listener too), taken off the wall clock the taps
    // are compared on.
    const since = typeof performance !== 'undefined' && event.timeStamp > 0
      ? Math.min(POINTER_DOWN_FRESH_MS, Math.max(0, performance.now() - event.timeStamp))
      : 0;
    lastPointerDown = { x: event.clientX, y: event.clientY, at: Date.now() - since };
  }, { capture: true, passive: true });
}

/** When the press being handled went down (its click can come late), else now. */
function pressDownAt(now: number): number {
  const down = lastPointerDown;
  return down && down.at <= now && now - down.at < POINTER_DOWN_FRESH_MS ? down.at : now;
}

/**
 * Where the last +1 night / +1 week tap went down, and when the season ended
 * after a press: a tap on that spot within SEASON_END_REPEAT_MS of the end is
 * the same steady run of taps, not a choice to start a new season (walk 13
 * T4-10: on a 320px phone the fifth tap landed on "New season").
 */
let lastAdvanceSpot: { x: number; y: number } | null = null;
let seasonEndedAt: number | null = null;
const SEASON_END_REPEAT_MS = 1500;
const SEASON_END_SPOT_RADIUS = 48;

function seasonEndRepeat(now = Date.now()): boolean {
  if (!pressedByPointer() || seasonEndedAt === null || now - seasonEndedAt > SEASON_END_REPEAT_MS) return false;
  const down = lastPointerDown;
  if (!down || !lastAdvanceSpot) return false;
  return Math.hypot(down.x - lastAdvanceSpot.x, down.y - lastAdvanceSpot.y) <= SEASON_END_SPOT_RADIUS;
}

const pressAdvance = (step: 'night' | 'week', run: () => void, guardSpot = false) => () => {
  if (pressedByPointer() && lastPointerDown) lastAdvanceSpot = { x: lastPointerDown.x, y: lastPointerDown.y };
  if (guardSpot) {
    settleTaps(0, ADVANCE_DOUBLE_TAP_MS);
    run();
    return;
  }
  // Keyboard presses have no spot and always count.
  if (!pressedByPointer()) {
    run();
    return;
  }
  const before = advanceTaps[step];
  const tap = advanceTap(advanceTaps[step], pressDownAt(Date.now()));
  // A run can mix the two buttons: its rhythm counts taps on either (walk 16 T4-07).
  const otherStep = step === 'night' ? 'week' : 'night';
  const across = advanceTapsAcross(before, tap.state, advanceTaps[otherStep]);
  advanceTaps[step] = across.own;
  advanceTaps[otherStep] = across.other;
  for (let press = 0; press < tap.plays; press += 1) run();
};

function afterPaint(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function'
    || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(() => setTimeout(go, 0));
    setTimeout(go, PAINT_FALLBACK_MS);
  });
}

// The settled date on which the roster was last seen empty. Every place that
// shows the practice hint (the line under the buttons on phones, the status
// row on desktop) reads this one record, so they say the same thing and a
// layout change that remounts the controls does not forget it.
let rosterEmptyOn: string | null = null;

/**
 * "Play anyway" to the empty-roster question, once this practice season:
 * after that +1 night / +1 week just play, and the hint line says "Nobody on
 * your roster: nights play without you" (walk 3 T1-19, T2-14). A new season
 * is a new page (Restart reloads it), so each season starts unanswered.
 */
let playedWithoutRoster = false;
const playedListeners = new Set<() => void>();

function setPlayedWithoutRoster(): void {
  if (playedWithoutRoster) return;
  playedWithoutRoster = true;
  playedListeners.forEach((listener) => listener());
}

function subscribePlayed(listener: () => void): () => void {
  playedListeners.add(listener);
  return () => {
    playedListeners.delete(listener);
  };
}

function usePlayedWithoutRoster(): boolean {
  return useSyncExternalStore(subscribePlayed, () => playedWithoutRoster, () => false);
}

/** Adds and shorts still saving (walk 12 T2-08): they count as held for the frame. */
function savingHolds(pendingActions: ReadonlySet<string>, bootstrap: PerGameBootstrap): MoveInFlight[] {
  return movesInFlight(pendingActions, bootstrap.positions, new Map())
    .filter((move) => move.verb === 'add' || move.verb === 'short');
}

/**
 * The practice hint beside +1 night / +1 week: "Add a player first…" while
 * the roster is empty (or the nights-without-you line once the player chose
 * to play anyway), then "Ready. +1 night plays the Oct 21 games." from the
 * moment a player lands until the next night is played. The line keeps its
 * place through the first add (a line vanishing mid-tap would move the list
 * under the finger) and goes once the player advances. `short`: the form
 * for rows with no line to spare ("Add a player first", walk 4 T1-09).
 */
export function usePracticeHint(short = false): string | null {
  const { bootstrap, pendingActions } = usePerGame();
  const played = usePlayedWithoutRoster();
  const playingNow = usePracticePlaying();
  const queuedNow = useSyncExternalStore(subscribeQueued, () => queuedPresses, () => NO_QUEUE);
  if (!bootstrap || !isMockActive()) return null;
  const settledOn = bootstrap.game.lastSettledDate ?? '';
  const emptyRoster = !bootstrap.positions.some((position) => position.status === 'active');
  if (emptyRoster) rosterEmptyOn = settledOn;
  // The first adds still saving count as held: "Add a player first" sat
  // beside rows reading "ADDED ✓" (walk 12 T2-08). Any add still saving
  // while the line would say "Ready…" too, as the slot line counts it: it
  // said "Ready" beside "3 of 10 · 1 saving" (walk 15 T2-03).
  const saving = (emptyRoster || rosterEmptyOn === settledOn) && !playingNow ? savingHolds(pendingActions, bootstrap) : [];
  if (saving.length > 0 && !practiceProgress(mockSeasonStart(), bootstrap.game.lastSettledDate).complete) {
    // Presses waiting behind the save: the line describes the queue they
    // make, not the one night a press would have played (walk 15 T2-03).
    if (queuedNow.length > 0 && !short) {
      return keepControlNames(savingQueueHint(saving, queuedNow, bootstrap.game.lastSettledDate, practiceSeasonEnd(mockSeasonStart())));
    }
    return keepControlNames(savingHint(saving, short, bootstrap.game.nextGameDate));
  }
  const input = {
    complete: practiceProgress(mockSeasonStart(), bootstrap.game.lastSettledDate).complete,
    emptyRoster,
    playedWithoutRoster: played,
    justFilled: rosterEmptyOn === settledOn,
    nextGameDate: bootstrap.game.nextGameDate,
    // Someone was held before (a closed player, an ended short): "Add a
    // player first" read as if a week of shorts never happened (walk 8 T4-10).
    heldBefore: bootstrap.positions.length > 0,
    // A locked next night: say when moves reopen (walk 9 T4-03).
    locked: bootstrap.ruleset.rosterMutationsLocked,
    lockGameDate: bootstrap.ruleset.rosterLockGameDate,
  };
  const hint = short ? practiceHintShort(input) : practiceHint(input);
  // While a night or week plays the hint follows it, in its place (walk 11
  // T1-08), and "+1 night" never splits across lines (walk 11 T4-04).
  if (hint && playingNow) return playingHint(playingNow, short);
  return hint ? keepControlNames(hint) : null;
}

/**
 * The latest presses of the practice clock (step, and the settled date each
 * started from), oldest first, so the status row can name the span a +1 week
 * played ("Oct 21–27 games -$32.5K") until the next advance lands (walk 3
 * T1-20; chromeView.resultSpan). Two are kept: the one on screen and the one
 * playing now.
 */
let recentAdvances: readonly PracticeAdvance[] = [];
const NO_ADVANCES: readonly PracticeAdvance[] = [];
const advanceListeners = new Set<() => void>();

function recordAdvance(advance: PracticeAdvance): void {
  recentAdvances = [...recentAdvances.slice(-1), advance];
  advanceListeners.forEach((listener) => listener());
}

function subscribeAdvances(listener: () => void): () => void {
  advanceListeners.add(listener);
  return () => {
    advanceListeners.delete(listener);
  };
}

export function useRecentAdvances(): readonly PracticeAdvance[] {
  return useSyncExternalStore(subscribeAdvances, () => recentAdvances, () => NO_ADVANCES);
}

/**
 * Practice's rivals and calendar for the rules ("In practice you play 4
 * computer rivals over one season, Oct 21 to Apr 12 (174 days)."); null in
 * the live market, whose rules do not change with the season.
 */
export function usePracticeRulesContext(): PracticeRulesContext | null {
  const { bootstrap } = usePerGame();
  if (!bootstrap || !isMockActive()) return null;
  const start = mockSeasonStart();
  const end = practiceSeasonEnd(start);
  if (!start || !end) return null;
  const opening = new Date(Date.parse(`${start}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return {
    rivals: Math.max(0, bootstrap.leaderboard.length - 1),
    opens: humanDate(opening),
    ends: humanDate(end),
    days: SEASON_TOTAL_DAYS,
  };
}

/**
 * A reader's own text spacing (WCAG 1.4.12: wider letters, words and lines
 * from their stylesheet) grew the frame to 40% of a 320x640 window, one
 * Market row at a time (walk 8 T3-08). The app never sets word spacing, so a
 * non-zero one means those styles are on; then, once the frame takes more
 * than a third of the window's height, it folds into its one row + More, as
 * a short window's does. It stays folded for that window size: unfolding
 * would only grow it again. Without the reader's spacing nothing changes.
 */
let spacingFold: string | null = null;
const spacingListeners = new Set<() => void>();

function setSpacingFold(size: string | null): void {
  if (size === spacingFold) return;
  spacingFold = size;
  spacingListeners.forEach((listener) => listener());
}

function subscribeSpacingFold(listener: () => void): () => void {
  spacingListeners.add(listener);
  return () => {
    spacingListeners.delete(listener);
  };
}

/** Whether the frame is folded for a reader's text spacing (see setSpacingFold). */
export function useSpacingFold(): boolean {
  return useSyncExternalStore(subscribeSpacingFold, () => spacingFold !== null, () => false);
}

/** Whether a reader's own text spacing is on (the same watch). */
let readerSpacing = false;

function setReaderSpacing(next: boolean): void {
  if (next === readerSpacing) return;
  readerSpacing = next;
  spacingListeners.forEach((listener) => listener());
}

export function useReaderSpacing(): boolean {
  return useSyncExternalStore(subscribeSpacingFold, () => readerSpacing, () => false);
}

/** Watches for a reader's text spacing and the frame's height (mounted once, by SimBar). */
function useSpacingFoldWatch(): void {
  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return undefined;
    const check = () => {
      const screen = document.getElementById('app-screen');
      if (!screen) return;
      const size = `${window.innerWidth}x${window.innerHeight}`;
      const spaced = parseFloat(getComputedStyle(screen).wordSpacing) > 0;
      setReaderSpacing(spaced);
      if (!spaced) {
        setSpacingFold(null);
        return;
      }
      if (spacingFold === size) return;
      if (spacingFold !== null) {
        // A new window size: unfold, and look again once it has laid out.
        setSpacingFold(null);
        return;
      }
      if (screen.getBoundingClientRect().top > window.innerHeight / 3) setSpacingFold(size);
    };
    const observers: Array<{ disconnect: () => void }> = [];
    if (typeof ResizeObserver !== 'undefined') {
      const resize = new ResizeObserver(check);
      const screen = document.getElementById('app-screen');
      if (screen) resize.observe(screen);
      observers.push(resize);
    }
    if (typeof MutationObserver !== 'undefined') {
      // A reader's stylesheet arrives as a new style element.
      const styles = new MutationObserver(check);
      styles.observe(document.head, { childList: true });
      observers.push(styles);
    }
    window.addEventListener('resize', check);
    const first = setTimeout(check, 0);
    return () => {
      clearTimeout(first);
      window.removeEventListener('resize', check);
      observers.forEach((observer) => observer.disconnect());
    };
  }, []);
}

/** The hint line's DOM id: +1 night points at it (aria-describedby). */
export const PRACTICE_HINT_ID = 'practice-hint';
/** +1 week's own description (practiceWeekHint), spoken only. */
const PRACTICE_WEEK_HINT_ID = 'practice-hint-week';

/**
 * Point a control at the hint line while one shows, so a screen reader says
 * it after the button's name (walk 3 T3-21). react-native-web has no
 * describedby prop, so it is written on the element. No-op off the web.
 * Only a line that is on the page: the folded row draws it in the status
 * row, and not at all on a locked night.
 */
function useDescribedBy(ref: { current: unknown }, id: string | null): void {
  useEffect(() => {
    const node = ref.current as { setAttribute?: (name: string, value: string) => void; removeAttribute?: (name: string) => void } | null;
    if (!node?.setAttribute || !node.removeAttribute) return;
    if (id && typeof document !== 'undefined' && document.getElementById(id)) node.setAttribute('aria-describedby', id);
    else node.removeAttribute('aria-describedby');
  });
}

/**
 * Whether this site has a live market for Exit to go to: the app's public
 * config resolves. Without one, Exit threw the season away to reach "The live
 * market isn't open yet" (walk 4 T2-10, T4-05, T1-12), so it is not offered.
 * The config is fixed at build time, so it is read once.
 */
let exitOffered: boolean | null = null;

export function liveMarketToExitTo(): boolean {
  if (exitOffered === null) exitOffered = practiceOffersExit(resolvePublicAppConfig());
  return exitOffered;
}

/** The questions the practice controls ask (Play another season asks none). */
type Question = 'restart' | 'exit' | 'empty-night' | 'empty-week' | 'play-to-end';

/**
 * Run `action` once the dialog that asked for it has closed and its history
 * entry is gone, so a reload or a new page never keeps a stale sheet entry.
 */
function afterDialogCloses(action: () => void): void {
  if (typeof window === 'undefined') {
    action();
    return;
  }
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    window.removeEventListener('popstate', go);
    action();
  };
  window.addEventListener('popstate', go);
  setTimeout(go, 350);
}

/**
 * The open practice question (Restart, Play again, Exit, or playing with an
 * empty roster) lives outside the controls. Rotating a phone moves them
 * (practice bar, folded status row, desktop row), which mounts them afresh,
 * and the question has to survive that (walk 2 T4-27): SimBar, which stays
 * mounted, draws the dialog (PracticeQuestionHost).
 */
type AskedQuestion = {
  kind: Question;
  fromMenu: boolean;
  /**
   * +1 night / +1 week asked within a moment of games landing: their news,
   * which the question's scrim hides, and whether a short was held as they
   * began (emptyQuestionAfterGames; walk 18 T4-06).
   */
  news?: string | null;
  shortsEnded?: boolean;
};
let askedQuestion: AskedQuestion | null = null;
const questionListeners = new Set<() => void>();

function setAskedQuestion(next: AskedQuestion | null): void {
  askedQuestion = next;
  questionListeners.forEach((listener) => listener());
}

function subscribeQuestion(listener: () => void): () => void {
  questionListeners.add(listener);
  return () => {
    questionListeners.delete(listener);
  };
}

/** The mounted controls' advance, for "Play anyway" (one set is mounted at a time). */
let advanceFromQuestion: ((step: 'night' | 'week') => void) | null = null;
/** The mounted controls' "Play to the end", for its question's confirm. */
let playToEndFromQuestion: (() => void) | null = null;

/**
 * Focus the control that asked, wherever it is now: More when the question
 * came from the menu, else the button itself, whichever exists after a
 * rotation.
 */
function focusAsker({ kind, fromMenu }: AskedQuestion): void {
  if (typeof document === 'undefined') return;
  // Once the dialog's history entry has gone: the app puts focus on the
  // current tab when an entry pops, and the asker should have the last word.
  afterDialogCloses(() => setTimeout(() => {
    const find = (match: (name: string) => boolean) => Array.from(
      document.querySelectorAll<HTMLElement>('[role="button"][aria-label]'),
    ).find((node) => match(node.getAttribute('aria-label') ?? ''));
    const more = () => find((name) => name === 'More practice controls');
    const direct = () => find(kind === 'exit' ? (name) => name === 'Exit practice'
      : kind === 'play-to-end' ? (name) => name.startsWith(PLAY_TO_END_LABEL)
      : kind === 'empty-night' ? (name) => name.startsWith('+1 night')
        : kind === 'empty-week' ? (name) => name.startsWith('+1 week')
          : (name) => /restart practice$/i.test(name));
    (fromMenu ? more() ?? direct() : direct() ?? more())?.focus();
  }, 30));
}

/** Focus `ref` once a closing sheet's history entry has gone (see focusAsker). */
function focusAfterClose(ref: { current: unknown }): void {
  afterDialogCloses(() => focusLater(ref, 30));
}

/**
 * The presses waiting behind the one playing, as the mounted controls hold
 * them, so the practice question can say that they wait for its answer
 * (walk 8 T4-06).
 */
type QueuedPresses = ReadonlyArray<'night' | 'week'>;
const NO_QUEUE: QueuedPresses = [];
let queuedPresses: QueuedPresses = NO_QUEUE;
/** The nights playing now ("Nov 4–10"), which cannot wait. */
let playingNow: string | null = null;
const queueListeners = new Set<() => void>();

function publishQueued(next: QueuedPresses): void {
  if (next === queuedPresses) return;
  queuedPresses = next;
  queueListeners.forEach((listener) => listener());
}

/** The step playing now, for where a queued run ends (queuedThrough). */
let playingStepNow: 'night' | 'week' | null = null;

function publishPlaying(next: string | null, step: 'night' | 'week' | null = null): void {
  // Every screen can see what is playing (a move pressed now waits for it).
  setPracticePlaying(next);
  playingStepNow = next === null ? null : step;
  if (next === playingNow) return;
  playingNow = next;
  queueListeners.forEach((listener) => listener());
}

/**
 * Where the queued run of weeks ends ("2026-02-09"), for the status row's
 * "Queued through Feb 9" (walk 11 T4-N2); null when nothing waits.
 */
export function useQueuedThrough(): string | null {
  const { bootstrap } = usePerGame();
  const queued = useSyncExternalStore(subscribeQueued, () => queuedPresses, () => NO_QUEUE);
  // Subscribed so the step playing (read below) is current.
  useSyncExternalStore(subscribeQueued, () => playingNow, () => null);
  // From the first queued press, also while the presses wait for a move
  // still saving (walk 15 T2-03: it showed only once the first week played).
  if (!bootstrap || !isMockActive()) return null;
  return queuedThrough(bootstrap.game.lastSettledDate, playingStepNow, queued, practiceSeasonEnd(mockSeasonStart()));
}

function subscribeQueued(listener: () => void): () => void {
  queueListeners.add(listener);
  return () => {
    queueListeners.delete(listener);
  };
}

/**
 * A practice run's working state lives here, above the frame layouts, not in
 * the controls that draw it. A rotation or a window resize across a layout
 * break swaps which PracticeControls is mounted (the phone bar, the status
 * row's, the folded row's), and the queue, the run and the step playing went
 * with the one torn down: queued weeks vanished without a word and the notice
 * named only the last week, contradicting the status row (walk 13 T4-09).
 * Only one set of controls is mounted at a time; a layout change now only
 * redraws them. A practice restart reloads the page, which starts these over.
 */
type Shared<T> = { current: T };
const shared = <T,>(current: T): Shared<T> => ({ current });

interface SharedState<T> {
  get: () => T;
  set: (next: T | ((current: T) => T)) => void;
  subscribe: (listener: () => void) => () => void;
}

function sharedState<T>(initial: T): SharedState<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      const resolved = typeof next === 'function' ? (next as (current: T) => T)(value) : next;
      if (Object.is(resolved, value)) return;
      value = resolved;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function useSharedState<T>(state: SharedState<T>): [T, SharedState<T>['set']] {
  return [useSyncExternalStore(state.subscribe, state.get, state.get), state.set];
}

type Timer = ReturnType<typeof setTimeout> | null;
type PlayingStep = { step: 'night' | 'week' | 'end'; date: string | null } | null;

const practiceEngine = {
  /** The run the presses belong to, while one plays (see PracticeRun). */
  run: shared<PracticeRun | null>(null),
  /** The last run that landed with nothing behind it, and when (continuesRun). */
  landedRun: shared<{ run: PracticeRun; at: number } | null>(null),
  /** A step landed while another press waited: its own notice comes down. */
  holdStepNotice: shared(false),
  /** The run a queued Play to the end waited behind (walk 16 T2-01). */
  endRun: shared<PracticeRun | null>(null),
  /** The run a playing Play to the end continues: the season's end names its whole span. */
  seasonEndRun: shared<PracticeRun | null>(null),
  /** A cancel that landed while a single step played, said with its result. */
  cancelNote: shared<string | null>(null),
  speakRun: shared<Timer>(null),
  queuedSteps: shared<Array<'night' | 'week'>>([]),
  endQueued: shared(false),
  queueFullSaid: shared(false),
  cancelHintSaid: shared(false),
  queueLineTimer: shared<Timer>(null),
  queueLineStep: shared<'night' | 'week'>('week'),
  runSlotTimer: shared<Timer>(null),
  busyLineTimer: shared<Timer>(null),
  advancing: shared(false),
  playingDate: shared<string | null>(null),
  playingStep: shared<'night' | 'week' | null>(null),
  /** The season's last step was pressed here (focus goes to the result). */
  advanced: shared(false),
  lastSettled: shared<string | null>(null),
  /** The mounted controls' own "end the run's Cancel slot", for timers set by earlier ones. */
  endRunSlot: shared<(() => void) | null>(null),
};
const playingState = sharedState<PlayingStep>(null);
const runOverState = sharedState<PracticeRun | null>(null);
const appendNoteState = sharedState<string | null>(null);
const endQueuedState = sharedState(false);
const runSlotState = sharedState(false);
const busyLineState = sharedState('');

/**
 * Whether Cancel queued shows now: anything queued, or a run still playing
 * (it keeps its place for the whole run). A folded row's facts leave out the
 * games figure meanwhile, so Cancel fits before +1 night (walk 15 T4-01).
 */
export function useQueuedCancelShows(): boolean {
  const { bootstrap } = usePerGame();
  const queued = useSyncExternalStore(subscribeQueued, () => queuedPresses, () => NO_QUEUE);
  const [runSlot] = useSharedState(runSlotState);
  if (!bootstrap || !isMockActive()) return false;
  const complete = practiceProgress(mockSeasonStart(), bootstrap.game.lastSettledDate).complete;
  return queued.length > 0 || (runSlot && !complete);
}

/**
 * How long the last +1 night / +1 week took to land, so the queued line says
 * "Press Cancel…" only when the queue will last long enough to act on it
 * (chromeView.cancelHintFits; walk 10 T3-09). Null until a step is timed.
 */
let lastStepMs: number | null = null;

/** The screen on show, by its name ("Roster", "Market"), read from the main region. */
function readScreenName(): string | null {
  if (typeof document === 'undefined') return null;
  return document.getElementById('app-screen')?.getAttribute('aria-label') ?? null;
}

export function useScreenName(): string | null {
  const [name, setName] = useState<string | null>(readScreenName);
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return undefined;
    const screen = document.getElementById('app-screen');
    setName(readScreenName());
    if (!screen) return undefined;
    const observer = new MutationObserver(() => setName(readScreenName()));
    observer.observe(screen, { attributes: true, attributeFilter: ['aria-label'] });
    return () => observer.disconnect();
  }, []);
  return name;
}


/**
 * The season just ended by the player's own press: take them to how they did
 * (walk 10 T2-02). From any tab the Roster opens with the result card in view
 * and focus on its heading; the Market had said "The season is over" and
 * nothing pointed to the card. Returns false when the frame cannot switch.
 */
function showSeasonResult(): boolean {
  if (typeof document === 'undefined') return false;
  if (readScreenName() !== 'Roster' && !openTab('portfolio', { focusScreen: false })) return false;
  let tries = 0;
  const find = () => {
    // The Roster's result card heading (roster/SeasonCards FinalCard).
    const heading = document.getElementById(SEASON_RESULT_HEADING_ID);
    if (!heading || readScreenName() !== 'Roster') {
      tries += 1;
      if (tries < 40) setTimeout(find, 50);
      return;
    }
    // After the frame has put focus on the new screen (App's switch waits
    // for the screen's name, then 60 ms).
    setTimeout(() => {
      if (!heading.isConnected) return;
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
      // The card's own top ("Season complete") in view, not only its title.
      (heading.parentElement ?? heading).scrollIntoView?.({ block: 'nearest' });
    }, 180);
  };
  setTimeout(find, 0);
  return true;
}

/** A tap sooner than this after a question opens is the opening tap's second click. */
const QUESTION_TAP_GUARD_MS = 400;
/** …except on the action a player aims at deliberately (as ConfirmDialog does). */
const QUESTION_AIMED_GUARD_MS = 150;

/**
 * Every practice question draws its answers here, in one order (walk 11
 * T2-06; chromeView.questionAnswerOrder): the way out first ("Not now",
 * "Keep playing"), the action that plays or throws the season away next,
 * and a recommended move (Open market, "+1 night instead") last, in gold.
 * Left to right in a row, top to bottom when stacked on a phone, so Tab
 * follows the eye (walk 9 T2-06); focus starts on the way out, which changes
 * nothing. Escape, Back and a tap outside answer as the way out does: on a
 * phone there is no Escape (walk 8 T1-05).
 */
function PracticeChoices({ title, lines, onSafe, onRisky, riskyLabel, safeLabel = 'Not now', riskyTone = 'neutral', recommendedLabel, onRecommended }: {
  title: string;
  lines: string[];
  onSafe: () => void;
  onRisky: () => void;
  riskyLabel: string;
  safeLabel?: string;
  /** 'danger' when the action throws the season away (Start over). */
  riskyTone?: 'danger' | 'neutral';
  recommendedLabel?: string;
  onRecommended?: () => void;
}) {
  const { width } = useWindowDimensions();
  const [linesHeight, setLinesHeight] = useState(0);
  const openedAt = useRef(Date.now());
  const guard = (fn: () => void, ms = QUESTION_TAP_GUARD_MS) => () => {
    if (Date.now() - openedAt.current < ms) return;
    // The scrim closes on the lift: what it uncovers must not take the
    // click that follows (walk 10 T1-11).
    quietLift();
    fn();
  };
  const safeRef = useRef<View>(null);
  const titleRef = useRef<Text>(null);
  const panelRef = useRef<View>(null);
  useEffect(() => {
    type Focusable = { focus?: (options?: object) => void } | null;
    const safe = safeRef.current as unknown as Focusable;
    const panel = panelRef.current as unknown as HTMLElement | null;
    // The panel's ScrollView: its scrolling node, two levels up.
    const scroller = panel?.parentElement?.parentElement ?? null;
    // Taller than its window (400% zoom), the question opens at its title,
    // focused, and the way out is the next Tab: focus on Not now scrolled
    // the title and the first lines out of sight (walk 15 T3-05, as the
    // kit's ConfirmStrip does). Where it fits, focus starts on the way out.
    if (panel?.getBoundingClientRect && scroller && panel.getBoundingClientRect().height > scroller.clientHeight + 1) {
      scroller.scrollTop = 0;
      (titleRef.current as unknown as Focusable)?.focus?.({ preventScroll: true });
      return;
    }
    safe?.focus?.();
  }, []);
  const stacked = width < EMPTY_QUESTION_ROW_MIN_WIDTH;
  // A phone at 400% zoom (98px): the margins and padding left a 53px column
  // that broke words ("scor / e", "won' / t"; walk 12 T4-15).
  const tight = questionTight(width);
  const recommended = recommendedLabel && onRecommended ? (
    <Button key="recommended" label={recommendedLabel} onPress={guard(onRecommended)} steady variant="primary" />
  ) : null;
  const answers = {
    safe: <Button key="safe" ref={safeRef} label={safeLabel} onPress={guard(onSafe)} steady style={styles.questionNotNow} variant="quiet" />,
    risky: (
      <Button
        key="risky"
        label={riskyLabel}
        onPress={guard(onRisky, QUESTION_AIMED_GUARD_MS)}
        steady
        variant={riskyTone === 'danger' ? 'danger' : 'secondary'}
      />
    ),
    recommended,
  };
  return (
    // Named by its heading and described by its lines, which stay in the
    // reading order: a listener can re-read what an answer would lose (walk
    // 13 T3-04: the lines lived only in the dialog's name).
    <Modal
      {...({ 'aria-labelledby': QUESTION_TITLE_ID, 'aria-describedby': QUESTION_LINES_ID } as object)}
      animationType="none"
      onRequestClose={onSafe}
      transparent
      visible
    >
      <View style={[styles.questionLayer, tight && styles.questionLayerTight]}>
        <View onResponderRelease={guard(onSafe)} onStartShouldSetResponder={() => true} style={styles.questionScrim} />
        {/* Taller than the window (400% zoom), the panel scrolls from its
            title: centred, its top was cut off out of reach (walk 12 T4-15). */}
        <ScrollView contentContainerStyle={styles.questionScrollContent} style={styles.questionScroll}>
        <View ref={panelRef} style={[styles.questionPanel, tight && styles.questionPanelTight]}>
          <Text
            accessibilityRole="header"
            {...headingLevel(2)}
            {...({ tabIndex: -1 } as object)}
            nativeID={QUESTION_TITLE_ID}
            ref={titleRef}
            style={[styles.questionTitle, tight && styles.questionTitleTight]}
          >
            {title}
          </Text>
          {/* The dialog's description, read after its name on open and in the
              reading order after. The lines never get shorter while it is
              open (a line that updates once something in flight lands), so
              the answers under them stay put (walk 12 T4-01). */}
          <View
            nativeID={QUESTION_LINES_ID}
            onLayout={(event) => {
              const next = Math.round(event.nativeEvent.layout.height);
              setLinesHeight((current) => Math.max(current, next));
            }}
            style={[styles.questionLines, { minHeight: linesHeight }]}
          >
            {lines.map((line) => (
              <Text key={line} style={styles.questionLine}>{keepControlNames(line)}</Text>
            ))}
          </View>
          <View style={[styles.questionButtons, stacked ? styles.questionButtonsStacked : styles.questionButtonsRow]}>
            {questionAnswerOrder(recommended !== null).order.map((answer) => answers[answer])}
          </View>
        </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

/** The practice question's heading and lines, for its name and description. */
const QUESTION_TITLE_ID = 'practice-question-title';
const QUESTION_LINES_ID = 'practice-question-lines';

/** From this width the empty-roster question's three answers share a row. */
const EMPTY_QUESTION_ROW_MIN_WIDTH = 480;

/** The practice question's dialog, drawn from SimBar so it outlives the controls. */
function PracticeQuestionHost() {
  const asked = useSyncExternalStore(subscribeQuestion, () => askedQuestion, () => null);
  const queued = useSyncExternalStore(subscribeQueued, () => queuedPresses, () => NO_QUEUE);
  const playingDates = useSyncExternalStore(subscribeQueued, () => playingNow, () => null);
  const { bootstrap, isRefreshing, pendingActions } = usePerGame();
  // Keep playing (or Escape, Back, a tap outside): the question closes and
  // focus returns to the control that asked it.
  const close = () => {
    const was = askedQuestion;
    setAskedQuestion(null);
    if (was) focusAsker(was);
  };
  useSheetHistory(asked !== null, close);
  // The question holds the figures it opened with while anything is in
  // flight (the step playing, adds still saving): they rewrote themselves
  // under the finger (walk 11 T4-02). One line says what they wait for; once
  // all of it is in, the figures update once, in place, and that line says
  // why, so two different "what you'd lose" figures never sit side by side
  // (walk 12 T4-01, T4-04).
  const openedWith = useRef<{
    asked: AskedQuestion;
    bootstrap: PerGameBootstrap;
    playing: string | null;
    moves: MoveInFlight[];
    landed: PerGameBootstrap | null;
  } | null>(null);
  if (!asked || !bootstrap) {
    openedWith.current = null;
    return null;
  }
  const names = new Map(bootstrap.market.map((row) => [row.playerId, row.name] as const));
  bootstrap.positions.forEach((position) => {
    if (!names.has(position.playerId)) names.set(position.playerId, position.playerName);
  });
  const movesNow = movesInFlight(pendingActions, bootstrap.positions, names);
  if (openedWith.current?.asked !== asked) {
    openedWith.current = { asked, bootstrap, playing: playingDates, moves: movesNow, landed: null };
  }
  const opened = openedWith.current;
  const hadFlight = opened.playing !== null || opened.moves.length > 0;
  if (hadFlight && !opened.landed && playingDates === null && movesNow.length === 0 && !isRefreshing) {
    opened.landed = bootstrap;
  }
  const shown = opened.landed ?? opened.bootstrap;
  const stakesOf = (view: PerGameBootstrap, saving: readonly MoveInFlight[]) => {
    const held = view.positions.filter((position) => position.status === 'active');
    const savingPlayers = saving.filter((move) => move.verb === 'add').length;
    const savingShorts = saving.filter((move) => move.verb === 'short').length;
    return practiceStakes({
      progress: practiceProgress(mockSeasonStart(), view.game.lastSettledDate),
      players: held.filter((position) => position.side === 'long').length + savingPlayers,
      shorts: held.filter((position) => position.side === 'short').length + savingShorts,
      score: view.account.cumulativePnl,
      savingPlayers,
      savingShorts,
    });
  };
  const outcomes = opened.landed
    ? opened.moves.map((move) => {
      const holds = opened.landed?.positions.some((position) => position.playerId === move.id
        && position.side === move.side && position.status === 'active') ?? false;
      return move.verb === 'add' || move.verb === 'short' ? holds : !holds;
    })
    : null;
  const flightLine = questionFlightLine({ playing: opened.playing, moves: opened.moves, outcomes });
  return (
    <PracticeQuestionView
      asked={asked}
      bootstrap={shown}
      close={close}
      playingLine={flightLine}
      queued={queued}
      saving={opened.landed ? [] : opened.moves}
      stakes={stakesOf(shown, opened.landed ? [] : opened.moves)}
    />
  );
}

/** The practice question as it opened (PracticeQuestionHost). */
function PracticeQuestionView({ asked, bootstrap, close, playingLine, queued, saving, stakes }: {
  asked: AskedQuestion;
  bootstrap: PerGameBootstrap;
  close: () => void;
  playingLine: string | null;
  queued: QueuedPresses;
  /** Moves still saving that the figures wait for (walk 12 T4-04). */
  saving: readonly MoveInFlight[];
  stakes: string;
}) {
  const { width } = useWindowDimensions();
  const progress = practiceProgress(mockSeasonStart(), bootstrap.game.lastSettledDate);
  const open = bootstrap.positions.filter((position) => position.status === 'active');
  // Adds still saving count as players: the question does not offer the
  // Market to a roster that is filling (walk 12 T2-08).
  const savingAdds = saving.filter((move) => move.verb === 'add').length;
  const savingShorts = saving.filter((move) => move.verb === 'short').length;
  // "Play to the end" says what it plays and what stays (walk 6 T2-N1, T4-N3).
  const rosterPlayers = open.filter((position) => position.side === 'long').length + savingAdds;
  const shortEnds = open.filter((position) => position.side === 'short').map((position) => position.expiresOn);
  const lockedNow = bootstrap.ruleset.rosterMutationsLocked;
  const endPrompt = asked.kind === 'play-to-end'
    ? playToEndQuestion(SEASON_TOTAL_DAYS - progress.day, open.length + savingAdds + savingShorts === 0, shortEnds, practiceSeasonEnd(mockSeasonStart()))
    : null;
  // Only shorts: after the last one ends nobody plays for you (walk 9 T4-12).
  const shortsOnly = endPrompt && rosterPlayers === 0 && shortEnds.length > 0 ? playToEndShortsOnlyLines(shortEnds) : null;
  const prompt = endPrompt
    ? (shortsOnly ? { ...endPrompt, lines: [playToEndSpanLine(SEASON_TOTAL_DAYS - progress.day), ...shortsOnly] } : endPrompt)
    : practiceQuestion(
      asked.kind === 'play-to-end' ? 'restart' : asked.kind,
      stakes,
      bootstrap.game.nextGameDate ? humanDate(bootstrap.game.nextGameDate) : null,
    );
  // Start over / Play again / Leave practice / Play anyway: close the
  // question first, then act.
  const confirm = () => {
    const { kind } = asked;
    setAskedQuestion(null);
    if (kind === 'play-to-end') {
      // Focus goes back to the control that asked, and on to Play another
      // season once the last night is in.
      focusAsker(asked);
      playToEndFromQuestion?.();
      return;
    }
    if (kind === 'empty-night' || kind === 'empty-week') {
      // +1 night asks once a season: from now on the hint line says it (walk
      // 3 T1-19). +1 week asks every time nobody is held (walk 14 T1-06).
      setPlayedWithoutRoster();
      focusAsker({ kind, fromMenu: false });
      advanceFromQuestion?.(kind === 'empty-night' ? 'night' : 'week');
      return;
    }
    afterDialogCloses(kind === 'exit' ? leavePractice : restartPractice);
  };
  const empty = asked.kind === 'empty-night' || asked.kind === 'empty-week';
  // "Open market": close the question, then take the player to the Market.
  const openMarket = () => {
    // Asked before the question closes: the press is still fresh.
    const focusScreen = !pressedByPointer();
    setAskedQuestion(null);
    afterDialogCloses(() => openTab('market', { focusScreen }));
  };
  // "+1 night instead": close the question and play just the locked night,
  // after which moves reopen (walk 9 T4-03, walk 11 T4-03).
  const nightInstead = () => {
    setAskedQuestion(null);
    focusAsker({ kind: 'empty-night', fromMenu: false });
    advanceFromQuestion?.('night');
  };
  // Asked as games landed: their news first, as the notice under the scrim
  // draws it at this width (walk 18 T4-06).
  const afterGames = {
    news: asked.news ? keepDatesTogether(width < CHROME_WIDE_MIN_WIDTH ? newsFirst(asked.news) : asked.news) : null,
    shortsEnded: Boolean(asked.shortsEnded),
  };
  if (empty && lockedNow && asked.kind === 'empty-week') {
    // Nothing can be added before the locked games: the recommended answer
    // plays just them, then moves reopen (walk 9 T4-03).
    const locked = emptyQuestionAfterGames(lockedWeekQuestion(bootstrap.ruleset.rosterLockGameDate), afterGames);
    return (
      <PracticeChoices
        lines={locked.lines}
        onRecommended={nightInstead}
        onRisky={confirm}
        onSafe={close}
        recommendedLabel={locked.primaryLabel}
        riskyLabel={locked.secondLabel}
        title={locked.title}
      />
    );
  }
  if (empty) {
    const emptyPrompt = emptyQuestionAfterGames(prompt, afterGames);
    return (
      <PracticeChoices
        lines={emptyPrompt.lines}
        onRecommended={openMarket}
        onRisky={confirm}
        onSafe={close}
        recommendedLabel={emptyPrompt.cancelLabel}
        riskyLabel={emptyPrompt.confirmLabel}
        title={emptyPrompt.title}
      />
    );
  }
  if (asked.kind === 'play-to-end' && playToEndOffersMarket(rosterPlayers, lockedNow)) {
    // Nobody on the roster: the Market first, then playing on (walk 9 T4-12).
    return (
      <PracticeChoices
        lines={prompt.lines}
        onRecommended={openMarket}
        onRisky={confirm}
        onSafe={close}
        recommendedLabel="Open market"
        riskyLabel={PLAY_TO_END_LABEL}
        title={prompt.title}
      />
    );
  }
  if (asked.kind === 'play-to-end' && playToEndOffersNight(rosterPlayers, lockedNow)) {
    // A lock eve with nobody on the roster: the Market cannot add anyone
    // before the locked games, so it says why and offers that one night, as
    // +1 week does there (walk 11 T4-03).
    return (
      <PracticeChoices
        lines={[
          playToEndLockedLine(bootstrap.ruleset.rosterLockGameDate),
          ...(shortsOnly ?? ["Nobody is on your roster, so your score won't move."]),
        ]}
        onRecommended={nightInstead}
        onRisky={confirm}
        onSafe={close}
        recommendedLabel="+1 night instead"
        riskyLabel={PLAY_TO_END_LABEL}
        title={prompt.title}
      />
    );
  }
  // Presses queued before the question wait for its answer (the controls
  // hold them while it is open), and it says so (walk 8 T4-06); the step
  // playing when it opened has its own line (walk 11 T4-02).
  // Restart and Exit say what each answer does to them (walk 15 T4-02).
  const queuedLine = asked.kind === 'restart' || asked.kind === 'exit'
    ? queuedAnswerLine(queued, prompt.cancelLabel, prompt.confirmLabel)
    : queuedWaitLine(queued, null);
  const waiting = [playingLine, queuedLine].filter((line): line is string => Boolean(line));
  return (
    <PracticeChoices
      lines={[...prompt.lines, ...waiting]}
      onRisky={confirm}
      onSafe={close}
      riskyLabel={prompt.confirmLabel}
      // Nothing is lost by playing on: a plain button, not a red one.
      riskyTone={asked.kind === 'play-to-end' ? 'neutral' : 'danger'}
      safeLabel={prompt.cancelLabel}
      title={prompt.title}
    />
  );
}

/** The More menu's panel (its DOM id on the web). */
const MORE_PANEL_ID = 'practice-more';
/** The window gutter the panel keeps when it runs past More (walk 14 T1-01). */
const MORE_PANEL_GUTTER = 8;
/** The caret under More: its size, and the gap it spans. */
const MORE_CARET_SIZE = 10;
const MORE_CARET_GAP = 7;

function focusLater(ref: { current: unknown }, delay = 60): void {
  setTimeout(() => (ref.current as { focus?: () => void } | null)?.focus?.(), delay);
}

/**
 * More: a small menu under its button for the controls a short or narrow
 * frame has no room for. It floats over the screen (a transparent modal, so
 * the list keeps its place and nothing paints over it), and it closes on
 * Escape (focus back on More), on a tap anywhere else, when the window
 * changes size, and once an item is used.
 */
function MoreMenu({ open, setOpen, buttonRef, children, footer = null }: {
  open: boolean;
  setOpen: (open: boolean) => void;
  buttonRef: { current: View | null };
  children: ReactNode;
  /**
   * Pinned under the scrolling items, whole: the latest result at 400% zoom.
   * Under the buttons inside the scroller it showed "Oct 21 games: your"
   * and the rest needed scrolling (walk 7 T3-17). Pinned below, the scroller
   * gets shorter from the bottom, so the buttons at its top stay put.
   */
  footer?: ReactNode;
}) {
  const { width, height } = useWindowDimensions();
  const [anchor, setAnchor] = useState<{ top: number; right: number; caret: number } | null>(null);
  // The scroll area is never a stop of its own: at 400% zoom Tab landed on
  // it, unnamed and with the browser's thin ring, between Settings and +1
  // night (walk 8 T3-02). It leaves the Tab order, and when the modal's
  // focus trap wraps onto it (the trap focuses the first element that takes
  // focus) it hands focus on to the first item. It already scrolls to follow
  // focus from item to item.
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    if (!open) return undefined;
    const node = (scrollRef.current as unknown as { getScrollableNode?: () => unknown } | null)?.getScrollableNode?.() as HTMLElement | undefined;
    if (!node?.setAttribute || !node.addEventListener) return undefined;
    node.setAttribute('tabindex', '-1');
    const onFocus = (event: FocusEvent) => {
      if (event.target === node) node.querySelector<HTMLElement>('[role="button"]')?.focus();
    };
    node.addEventListener('focus', onFocus);
    return () => node.removeEventListener('focus', onFocus);
  }, [open]);
  // Back closes the menu first, like any sheet, rather than changing the tab
  // under it or leaving the app (walk 2 T4-21). While it is open the page
  // behind it is inert and its scrim covers the tabs, so no tab can change
  // under it either.
  useSheetHistory(open, () => {
    setOpen(false);
    focusAfterClose(buttonRef);
  });
  const size = `${width}x${height}`;
  const sizeRef = useRef(size);
  useEffect(() => {
    if (sizeRef.current === size) return;
    sizeRef.current = size;
    setOpen(false);
  }, [size, setOpen]);
  useEffect(() => {
    if (!open) return;
    const node = buttonRef.current as unknown as { getBoundingClientRect?: () => DOMRect } | null;
    const box = node?.getBoundingClientRect?.();
    if (!box) return;
    // With a control right of More (Settings, a phone on its side) the
    // panel runs to the window's gutter: what sits there is right-aligned
    // (a tip's button, a figure), so it is covered whole, not cut, and a
    // caret keeps the panel on More (walk 14 T1-01: a sliver of the tip's
    // button showed beside it, and the "$" of a figure was cut).
    const fromRight = width - box.right;
    const right = fromRight > MORE_PANEL_GUTTER * 3 ? MORE_PANEL_GUTTER : Math.max(fromRight, 2);
    setAnchor({ top: box.bottom + MORE_CARET_GAP, right, caret: width - (box.left + box.width / 2) - right });
  }, [open, width, buttonRef]);
  // It looks and acts like a menu, so the arrows move through it too:
  // ArrowDown / ArrowUp step (and wrap), Home and End jump to the ends. Tab
  // still cycles and Escape still closes (walk 2 T3-15).
  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
      const panel = document.getElementById(MORE_PANEL_ID);
      const focused = document.activeElement;
      if (!panel || !(focused instanceof HTMLElement) || !panel.contains(focused)) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>('[role="button"]')).filter((item) => item.tabIndex >= 0);
      if (items.length === 0) return;
      const at = items.indexOf(focused);
      const last = items.length - 1;
      const next = event.key === 'Home' ? 0
        : event.key === 'End' ? last
          : event.key === 'ArrowDown' ? (at < 0 || at === last ? 0 : at + 1)
            : (at <= 0 ? last : at - 1);
      event.preventDefault();
      items[next].focus();
    };
    document.addEventListener('keydown', onKey);
    // Open on the first item. When the list scrolls (400% zoom) the modal's
    // focus trap would otherwise land on the scroller itself.
    const first = setTimeout(() => {
      const panel = document.getElementById(MORE_PANEL_ID);
      const focused = document.activeElement;
      if (!panel || (focused instanceof HTMLElement && focused.getAttribute('role') === 'button' && panel.contains(focused))) return;
      panel.querySelector<HTMLElement>('[role="button"]')?.focus();
    }, 30);
    return () => {
      clearTimeout(first);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <>
      <ChromeButton
        ref={buttonRef}
        // The name stays clear of "restart" so nothing that looks for the
        // Restart button by name can land on More instead.
        accessibilityLabel="More practice controls"
        expanded={open}
        hasPopup="dialog"
        icon={(color) => <MoreIcon color={color} />}
        label="More"
        onPress={unlessSettling(() => setOpen(!open))}
        placement="stacked"
      />
      {open ? (
        <Modal
          accessibilityLabel="More practice controls"
          animationType="none"
          onRequestClose={() => {
            setOpen(false);
            focusAfterClose(buttonRef);
          }}
          transparent
          visible
        >
          {/* A tap outside closes the menu; the scrim is never a focus stop. */}
          <View
            onResponderRelease={unlessSettling(() => setOpen(false))}
            onStartShouldSetResponder={() => true}
            style={styles.menuScrim}
          />
          {/* Never wider or taller than the window: at 400% zoom it holds
              every control and scrolls inside itself. */}
          <View
            nativeID={MORE_PANEL_ID}
            style={[
              styles.morePanel,
              anchor ?? styles.morePanelFallback,
              {
                minWidth: Math.min(150, width - 4),
                maxWidth: width - 4,
                maxHeight: height - (anchor?.top ?? 48) - 2,
              },
            ]}
          >
            {anchor ? <View aria-hidden style={[styles.moreCaret, { right: anchor.caret - MORE_CARET_SIZE / 2 - 1 }]} /> : null}
            <ScrollView ref={scrollRef} contentContainerStyle={styles.moreItems} style={styles.moreScroll}>
              {children}
            </ScrollView>
            {footer}
          </View>
        </Modal>
      ) : null}
    </>
  );
}
/**
 * After a night is played the screen must refresh from the client. If a
 * refresh is already running (it may have read the client before this night
 * settled), try again shortly, so the screen never stays a night behind.
 */
const ADVANCE_REFRESH_ATTEMPTS = 8;
const ADVANCE_RETRY_MS = 150;
/**
 * Below this width +1 night / +1 week put the "+1" over the word: two buttons
 * and More need about 218px of row for one-line labels.
 */
const STACKED_LABEL_MAX_WIDTH = 240;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A run: a press and every press queued behind it, played back to back. Its
 * notice covers the whole run ("Oct 21–Nov 3 games (2 weeks): …"), not only
 * the last step (walk 6 T4-N2, T2-09).
 */
interface PracticeRun {
  /** The account before the run's first step. */
  start: PerGameBootstrap;
  steps: Array<'night' | 'week'>;
  /** The settled date the run's last step started from. */
  lastFrom: string | null;
  /** Queued presses cancelled while it played, said at the end of its notice (walk 9 T1-15). */
  note?: string | null;
  /** Moves refused while it played, carried in its notice (walk 15 T4-04, T4-08). */
  refusals?: string[];
  /** Moves that went through while it played ("Luka Doncic dropped. $250 fee."), kept in its notice too. */
  moves?: string[];
}

/** How soon after a run's last step a refused move still belongs to that run. */
const RUN_REFUSAL_JOIN_MS = 3000;

/**
 * A run's notice: its games, any queued presses it cancelled, and any moves
 * it refused. One that played the season out leads with the season's result,
 * then its whole span, as Play to the end inside a run does (walk 17 T4-06).
 */
function runText(run: PracticeRun, now: PerGameBootstrap): string {
  const start = spanStart(run);
  return runNoticeText({
    steps: run.steps,
    games: refreshNotice(start, now, false),
    seasonEnd: runEndedSeason(run, now) ? refreshNotice(start, now, false, { seasonComplete: seasonOver }) : null,
    note: run.note ?? null,
    moves: run.moves ?? [],
    refusals: run.refusals ?? [],
  });
}

/**
 * The account a run's span counts from: from its first night with games
 * when it began with +1 night or is Play to the end on its own (runSpanFrom;
 * walk 18 T2-10, T2-03).
 */
function spanStart(run: PracticeRun): PerGameBootstrap {
  const from = runSpanFrom(run.start.game.lastSettledDate, run.start.game.nextGameDate, run.steps[0] ?? null);
  if (from === run.start.game.lastSettledDate) return run.start;
  return { ...run.start, game: { ...run.start.game, lastSettledDate: from } };
}

/** The run's last step played the season out: nothing is left to continue it. */
const runEndedSeason = (run: PracticeRun, now: PerGameBootstrap) => seasonOver(now) && !seasonOver(run.start);

/**
 * A run's games from its first step to the season's end, one headline
 * ("Oct 21–Apr 12 games: your score rose $3.75M."), with what it refused.
 */
function seasonSpanText(run: PracticeRun, end: PerGameBootstrap): string {
  return withRefusals(withMoves(refreshNotice(spanStart(run), end, false), run.moves ?? []), run.refusals ?? []);
}

/** The practice season is over (its last day has settled), as the notices judge it. */
const seasonOver = (snapshot: PerGameBootstrap) => (
  practiceProgress(mockSeasonStart(), snapshot.game.lastSettledDate).complete
);

/**
 * +1 night settles the next game night: the night "Last night" and the notice
 * after it both report. Once a night on or after the season's last day
 * (day 174) has settled, which is exactly when practiceProgress calls the
 * season complete, there is no night left to play.
 */
function playPracticeNight(lastSettled: string | null, seasonEnd: string | null): void {
  if (lastSettled && seasonEnd && lastSettled >= seasonEnd) return;
  advanceMockNights(1);
}

/**
 * +1 week is seven calendar days on the track (Day 16 → Day 23): every game
 * night in them settles and the clock moves the full seven even when the last
 * day has no games, so the notice after it covers the same seven days as the
 * Roster's week figure. It never runs past the season's last day (day 174);
 * the final press stops there.
 */
function playPracticeWeek(): void {
  advanceMockDays(7, practiceSeasonEnd(mockSeasonStart()));
}

/**
 * The practice clock controls: +1 night and +1 week (the point of practice,
 * so they carry the gold), then restart and exit, quiet. On a phone they are
 * the practice bar's one row; on a desktop the status row mounts them beside
 * its facts so the whole frame is a single line (see chromeLayout). On a phone
 * at high zoom, Restart and Exit move behind a More control so the row still
 * fits and the screen keeps its room.
 */
export function PracticeControls({ inline = false, folded = false, tiny = false, endBeside = false, onRules, onSettings }: {
  inline?: boolean;
  /** The short-window row: +1 night, +1 week and More (Rules, Restart, Exit). */
  folded?: boolean;
  /**
   * The season is over and More sits beside Settings on the status row's
   * line (a 320px phone's Roster): no blank slot before it (walk 16 T4-06).
   */
  endBeside?: boolean;
  /** A folded row at 400% zoom: More alone, holding every control (walk 2 T3-11). */
  tiny?: boolean;
  /** Opens the rules; folded rows list Rules under More. */
  onRules?: () => void;
  /** Opens Settings; tiny rows list it under More. */
  onSettings?: () => void;
}) {
  const { fontScale, width } = useWindowDimensions();
  // Where Cancel queued is drawn, so the words that name it say where
  // (walk 15 T4-01: "Cancel drops it" while it sat unseen inside More).
  const cancelAt = cancelPlace(folded, tiny, width);
  const {
    bootstrap,
    dismissNotice,
    isGameplayReady,
    isRefreshing,
    message,
    noticeSeq,
    noticeTone,
    notify,
    pendingActions,
    refreshData,
    speakNotice,
  } = usePerGame();
  const [moreOpen, setMoreOpen] = useState(false);
  // At 400% zoom +1 night and +1 week live in More, which stays open for the
  // next press; the notice strip is hidden under it. The result shows in the
  // menu, under the buttons: the latest notice since it opened, kept until it
  // closes (walk 6 T3-04). Screen readers hear the notice itself.
  const [menuNotice, setMenuNotice] = useState<string | null>(null);
  const menuSeq = useRef<number | null>(null);
  // The short hint More opened on ("Ready for +1 night") stays at its top
  // while it is open, so +1 night does not move up under the finger when the
  // night lands (it went, and a second tap on +1 night hit +1 week).
  const [menuOpenHint, setMenuOpenHint] = useState<string | null>(null);
  const [menuNotesHeight, setMenuNotesHeight] = useState(0);
  useEffect(() => {
    if (!moreOpen) {
      menuSeq.current = null;
      setMenuNotice(null);
      setMenuOpenHint(null);
      setMenuNotesHeight(0);
      return;
    }
    if (menuSeq.current === null) {
      menuSeq.current = noticeSeq;
      setMenuOpenHint(hintShort);
    } else if (noticeSeq !== menuSeq.current && message) setMenuNotice(message);
  }, [moreOpen, noticeSeq, message]);
  // The result pinned under More's items shortens the scroll area from the
  // bottom; the keyboard's item (+1 week, low in the list) then sat half
  // under it (walk 8 T3-15). It scrolls up into view above the result. A
  // tapped item is left where the finger is.
  useEffect(() => {
    if (!menuNotice || typeof document === 'undefined' || typeof requestAnimationFrame === 'undefined') return undefined;
    const frame = requestAnimationFrame(() => {
      const panel = document.getElementById(MORE_PANEL_ID);
      const active = document.activeElement as HTMLElement | null;
      if (!panel || !active || !panel.contains(active) || !active.matches?.(':focus-visible')) return;
      active.scrollIntoView?.({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [menuNotice]);
  // The run the presses belong to, while one plays (see PracticeRun), and a
  // finished run of two or more steps waiting for its notice.
  // Both live above the layouts (practiceEngine), so a rotation keeps them.
  const runRef = practiceEngine.run;
  const [runOver, setRunOver] = useSharedState(runOverState);
  // The last run that landed with nothing waiting behind it, and when: a
  // press soon after continues it (continuesRun), so two quick presses with
  // no network delay still get one notice (walk 7 T4-03, T2-05).
  const landedRun = practiceEngine.landedRun;
  // A step that landed while another press waited behind it: its own notice
  // comes down before it paints, so the run is seen and heard once, with one
  // total (walk 7 T3-12: "rose $194.5K", then "rose $205K").
  const holdStepNotice = practiceEngine.holdStepNotice;
  useLayoutEffect(() => {
    if (!holdStepNotice.current) return;
    holdStepNotice.current = false;
    // The step played the season out with presses still waiting behind it
    // (+1 night passes nights without games, so queued nights can outlast
    // the season; Play to the end may wait too): nothing is left to play
    // them, so the run ends here, with the season's result and the run's
    // whole span, heard once it settles as any run is. Neither the queue's
    // line nor the season's result alone stands in for it (walk 17 T4-06).
    const endedRun = runRef.current ?? practiceEngine.endRun.current;
    if (endedRun && bootstrap && runEndedSeason(endedRun, bootstrap)) {
      runRef.current = null;
      practiceEngine.endRun.current = null;
      const text = runText(endedRun, bootstrap);
      composedRun.current = text;
      notify(text, { spoken: '', tone: endedRun.refusals?.length ? 'problem' : 'success' });
      stopSpeakRun();
      speakRun.current = setTimeout(() => {
        speakRun.current = null;
        speakNotice();
      }, RUN_CONTINUE_MS);
      return;
    }
    // While the rest of the season is queued, that stays on screen (heard
    // once) instead of the step's news: it flashed for one week (walk 10 T4-02).
    if (queueFullSaid.current && queuedSteps.current.length > 0) {
      notify(queueFullLine(practiceSeasonEnd(mockSeasonStart()), cancelAt), { spoken: '' });
      return;
    }
    // The run so far takes the step's place, silent until the run settles:
    // taking the step's notice down left the logo for most of a second
    // between "Oct 21–27 games…" and the three weeks' notice, as if the
    // first week's result had been taken back (walk 14 T1-11). From the
    // first week too: on a slow connection the step lands after the next
    // press is already waiting, and its own notice came down before it
    // was ever seen (walk 15 T2-11: the logo for 1.6 s at latency 1500).
    const run = runRef.current;
    if (run && bootstrap) {
      const text = runText(run, bootstrap);
      composedRun.current = text;
      notify(text, { spoken: '', tone: run.refusals?.length ? 'problem' : 'success' });
      return;
    }
    // Play to the end waits behind this step: the step's result is heard
    // with the season's end, without its lock (walk 14 T4-02).
    if (endQueuedRef.current && isGamesNotice(message)) notify(message as string, { spoken: '' });
    dismissNotice();
  }, [noticeSeq, dismissNotice]);
  // A move refused while a run plays (a lock the games brought, a price
  // that moved) is kept for the run's notice, which would otherwise replace
  // it with the next week's news; one refused after the run's last step
  // names the whole run, not only its last week (walk 15 T4-04, T4-08).
  const composedRun = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (noticeTone !== 'problem' || !message || !bootstrap || message === composedRun.current) return;
    const landed = landedRun.current;
    const run = runRef.current ?? (landed && Date.now() - landed.at < RUN_REFUSAL_JOIN_MS ? landed.run : null);
    if (!run) return;
    const known = run.refusals ?? [];
    const fresh = runRefusals(message).filter((line) => !known.includes(line));
    if (fresh.length === 0) return;
    run.refusals = mergeRefusals(known, fresh);
    if (runRef.current || run.steps.length < 2) return;
    // The run is heard now, with its refusals, in place of the refusal's own
    // words (replaced before they reached the screen) and of the run's later
    // announcement.
    stopSpeakRun();
    const text = runText(run, bootstrap);
    composedRun.current = text;
    notify(text, { tone: 'problem' });
  }, [message, noticeTone]);
  // A move that goes through while a run plays (a Drop confirmed during its
  // first week) is kept for the run's notice, as a refused one is: the next
  // week's notice replaced "…Luka Doncic dropped. $250 fee." (walk 16 lead
  // note). One soon after the run landed joins its notice on screen already,
  // and is kept in case a press continues the run.
  useLayoutEffect(() => {
    if (noticeTone !== 'success' || !message || message === composedRun.current) return;
    const landed = landedRun.current;
    const run = runRef.current ?? (landed && Date.now() - landed.at < RUN_REFUSAL_JOIN_MS ? landed.run : null);
    if (!run) return;
    const known = run.moves ?? [];
    const fresh = runMoves(message).filter((line) => !known.includes(line));
    if (fresh.length > 0) run.moves = mergeMoves(known, fresh);
  }, [message, noticeTone]);
  // In the render that shows the run's last nights, before it paints, so the
  // last step's own notice never shows on its own.
  useLayoutEffect(() => {
    if (!runOver || !bootstrap) return;
    setRunOver(null);
    const settled = bootstrap.game.lastSettledDate;
    if (!settled || (runOver.lastFrom !== null && settled <= runOver.lastFrom)) return;
    // Shown now, heard once the run settles (see speakRun).
    const text = runText(runOver, bootstrap);
    composedRun.current = text;
    notify(text, { spoken: '', tone: runOver.refusals?.length ? 'problem' : 'success' });
  }, [runOver, bootstrap, notify]);
  // The season's end after a run it continued (Play to the end within the
  // run's moment): the run's whole span, then the season's result, shown
  // and heard once, before it paints (walk 16 T2-01).
  useLayoutEffect(() => {
    const run = practiceEngine.seasonEndRun.current;
    if (!run || !bootstrap || !isSeasonCompleteNotice(message) || !seasonOver(bootstrap)) return;
    practiceEngine.seasonEndRun.current = null;
    const text = seasonEndAfterRun(seasonSpanText(run, bootstrap), message as string);
    composedRun.current = text;
    notify(text, { spoken: '', tone: run.refusals?.length ? 'problem' : 'success' });
    speakNotice();
  }, [noticeSeq, bootstrap]);
  // A cancel that landed while a single step played: its words join the
  // step's result, which replaced them at once (walk 9 T1-15).
  const cancelNote = practiceEngine.cancelNote;
  const [appendNote, setAppendNote] = useSharedState(appendNoteState);
  useLayoutEffect(() => {
    if (!appendNote) return;
    setAppendNote(null);
    if (message && !message.startsWith(appendNote)) notify(withCancelledNote(message, appendNote), { spoken: '' });
  }, [appendNote, message, notify]);
  // A run is heard once, when it settles: each step's notice shows at once
  // but stays silent, and the run's line is spoken when no press has
  // continued it for RUN_CONTINUE_MS (walk 8 T3-10: three quick presses were
  // spoken three times in 0.6 s). A single press is heard then too.
  // Its timer outlives a rotation: the new controls' run is the same run.
  const speakRun = practiceEngine.speakRun;
  const stopSpeakRun = () => {
    if (speakRun.current) clearTimeout(speakRun.current);
    speakRun.current = null;
  };
  // What is playing right now, for the busy label: the night's date as it
  // was when the press landed ("Playing Oct 21…"), or the week.
  // "end": Play to the end is playing the rest of the season.
  const [playing, setPlaying] = useSharedState(playingState);
  const advancing = playing !== null;
  const [busyLine, setBusyLine] = useSharedState(busyLineState);
  const busyLineTimer = practiceEngine.busyLineTimer;
  // A press while a night or week is still playing, or while your last move
  // is being saved (an Add a moment ago; walk 5 T2-12), is not dropped: it is
  // queued, once, and plays as soon as the screen has caught up. The pressed
  // button says so ("+1 week" over "queued") and a polite line tells
  // screen readers (it said "Still playing" and did nothing, so a steady run
  // of presses advanced every other time; walk 5 T3-11, T4-06, T4-N2). A key
  // held down is one press (react-native-web presses on key up).
  const queuedSteps = practiceEngine.queuedSteps;
  const queued = useSyncExternalStore(subscribeQueued, () => queuedPresses, () => NO_QUEUE);
  // Play to the end confirmed while a night plays or a move saves: it waits
  // its turn too (walk 7 T2-04: the confirm did nothing right after a night).
  const endQueuedRef = practiceEngine.endQueued;
  const [endQueued, setEndQueued] = useSharedState(endQueuedState);
  // Cancel keeps its place for the whole run, from the first press that
  // queues until the run settles, quiet (dashed) while nothing waits: it
  // came and went between weeks, too briefly to hit (walk 10 T2-06, T3-09).
  const [runSlot, setRunSlot] = useSharedState(runSlotState);
  // Cancel reads "Nothing queued" the moment the queue empties, and a press
  // then answers on itself, leaving the notice (a run's result) alone (walk
  // 11 T1-14, walk 18 T4-04).
  const [secondaryWidth, setSecondaryWidth] = useState(0);
  const runSlotTimer = practiceEngine.runSlotTimer;
  const cancelNodeRef = useRef<View>(null);
  // Said once a run: the rest of the season is queued; Press Cancel.
  const queueFullSaid = practiceEngine.queueFullSaid;
  const cancelHintSaid = practiceEngine.cancelHintSaid;
  const stopRunSlotTimer = () => {
    if (runSlotTimer.current) clearTimeout(runSlotTimer.current);
    runSlotTimer.current = null;
  };
  const endRunSlot = () => {
    stopRunSlotTimer();
    queueFullSaid.current = false;
    cancelHintSaid.current = false;
    // Focus on Cancel as it goes moves to +1 week, where the presses were made.
    const node = cancelNodeRef.current as unknown as { contains?: (other: unknown) => boolean } | null;
    if (typeof document !== 'undefined' && node?.contains?.(document.activeElement)) focusLater(weekRef, 0);
    setRunSlot(false);
  };
  // A run's timers set by controls a rotation took away end the slot of the
  // controls on screen now.
  practiceEngine.endRunSlot.current = endRunSlot;
  // Every change to the queue goes through here, so the practice question
  // (drawn by SimBar) can say what waits for its answer (walk 8 T4-06).
  const setQueue = (next: Array<'night' | 'week'>) => {
    // A shorter queue (a queued press started, or Cancel) makes the hidden
    // "2 weeks queued…" line stale: it goes at once, and the buttons' names
    // carry the count now (walk 10 T4-01: it said so 2 s after the queue emptied).
    if (next.length < queuedSteps.current.length) {
      if (busyLineTimer.current) clearTimeout(busyLineTimer.current);
      busyLineTimer.current = null;
      setBusyLine('');
    }
    queuedSteps.current = next;
    publishQueued(next.length === 0 ? NO_QUEUE : [...next]);
  };
  // Controls that unmount (a rotation, a window resized across a layout
  // break) leave the queue and the run as they are: the controls mounted in
  // their place draw them and play them (walk 13 T4-09).
  // A question on screen (Restart, Exit, Play to the end) holds the queue:
  // presses made before it wait for the answer instead of playing under it
  // and rewriting its summary (walk 8 T4-06). The one already playing
  // finishes. `questionComing`: asked from More, it opens a moment later.
  const questionOpen = useSyncExternalStore(subscribeQuestion, () => askedQuestion !== null, () => false);
  const questionComing = useRef(false);
  const sayBusy = (line: string) => {
    // The same words twice still count as news for the live region.
    setBusyLine((current) => (current === line ? `${line} ` : line));
    if (busyLineTimer.current) clearTimeout(busyLineTimer.current);
    busyLineTimer.current = setTimeout(() => setBusyLine(''), 4000);
  };
  // The queue's spoken line waits for the presses to pause, then says the
  // count once, as it stands then ("5 weeks queued. They play once Oct 28–
  // Nov 3 is in."), with the way to drop them once a run when the queue will
  // last long enough to act on it (walk 9 T3-12; walk 10 T3-09).
  const queueLineTimer = practiceEngine.queueLineTimer;
  const lastSettledRef = practiceEngine.lastSettled;
  lastSettledRef.current = bootstrap?.game.lastSettledDate ?? null;
  const queueLineStep = practiceEngine.queueLineStep;
  const stopQueueLine = () => {
    if (queueLineTimer.current) clearTimeout(queueLineTimer.current);
    queueLineTimer.current = null;
  };
  const sayQueueLine = () => {
    queueLineTimer.current = null;
    const step = queueLineStep.current;
    const count = queuedSteps.current.filter((entry) => entry === step).length;
    if (count === 0) return;
    // Where a run of weeks ends (walk 11 T4-N2): "12 weeks queued, through Feb 9."
    const through = queuedThrough(lastSettledRef.current, playingStepRef.current, queuedSteps.current, practiceSeasonEnd(mockSeasonStart()));
    const line = queuedLineThrough(queuedLine(step, playingDateRef.current, count), through);
    const hint = !cancelHintSaid.current && cancelHintFits(queuedSteps.current.length, lastStepMs);
    if (hint) cancelHintSaid.current = true;
    sayBusy(hint ? `${line} ${queuedCancelHint(queuedSteps.current.length, cancelAt)}` : line);
  };
  const queuePress = (pressed: 'night' | 'week', playingDate: string | null) => {
    // Every deliberate press waits its turn (a bounce on the same spot is
    // already ignored), as far as the season's last day, and the pressed
    // button counts them ("+1 week" over "×2 queued"): a second press on a
    // queued button was swallowed without a word (walk 7 T2-06), and presses
    // past five were thrown away in silence (walk 10 T4-02).
    stopRunSlotTimer();
    setRunSlot(true);
    const day = practiceProgress(mockSeasonStart(), bootstrap?.game.lastSettledDate ?? null).day;
    const playingDays = !advancingRef.current ? 0 : playingStepRef.current === 'week' ? 7 : 1;
    if (!queueHasRoom(queuedSteps.current, SEASON_TOTAL_DAYS - day - playingDays)) {
      // Beyond the season's end: said once (seen and heard), never silent.
      // Heard on its own, in place of the count the presses were building
      // (walk 11 T3-15: it came merged with a week's result, then again with
      // the cancel), and shown without being queued up to be said again.
      if (!queueFullSaid.current) {
        const full = queueFullLine(practiceSeasonEnd(mockSeasonStart()), cancelAt);
        stopQueueLine();
        notify(full, { spoken: '' });
        sayBusy(full);
      }
      queueFullSaid.current = true;
      return;
    }
    setQueue([...queuedSteps.current, pressed]);
    // The count is said once the presses pause (walk 11 T3-15), as it stands then.
    queueLineStep.current = pressed;
    if (queueLineTimer.current) clearTimeout(queueLineTimer.current);
    queueLineTimer.current = setTimeout(sayQueueLine, QUEUE_LINE_PAUSE_MS);
  };
  const pressWhileBusy = (pressed: 'night' | 'week') => {
    // Busy with nothing that will finish (the game is still loading), or
    // playing the season out (nothing will be left to play): no queue.
    if (playing?.step === 'end' || endQueuedRef.current || (!playing && pendingActions.size === 0 && !isRefreshing)) return;
    queuePress(pressed, playing?.date ?? null);
  };
  // State updates land a render later; a second tap in the same frame still
  // sees the old props. The ref closes the door synchronously (that tap is
  // queued like any other).
  const advancingRef = practiceEngine.advancing;
  const playingDateRef = practiceEngine.playingDate;
  const playingStepRef = practiceEngine.playingStep;
  const advancedRef = practiceEngine.advanced;
  const restartRef = useRef<View>(null);
  const exitRef = useRef<View>(null);
  const nightRef = useRef<View>(null);
  const weekRef = useRef<View>(null);
  const moreRef = useRef<View>(null);
  usePracticeHover(nightRef, weekRef);
  // "Play anyway" in the shared question plays through this set of controls.
  const advanceRef = useRef<((step: 'night' | 'week') => void) | null>(null);
  // A queued press goes through the buttons' own press (it asks first with
  // nobody on the roster, as a press would); `queued`: it waited behind
  // another, so it continues that press's run.
  const pressRef = useRef<((step: 'night' | 'week', queued?: boolean) => void) | null>(null);
  useEffect(() => {
    const run = (step: 'night' | 'week') => advanceRef.current?.(step);
    advanceFromQuestion = run;
    return () => {
      if (advanceFromQuestion === run) advanceFromQuestion = null;
    };
  }, []);
  // "Play to the end" confirmed in the shared question plays through this set.
  const playToEndRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const run = () => playToEndRef.current?.();
    playToEndFromQuestion = run;
    return () => {
      if (playToEndFromQuestion === run) playToEndFromQuestion = null;
    };
  }, []);
  const complete = practiceProgress(mockSeasonStart(), bootstrap?.game.lastSettledDate ?? null).complete;
  const screenName = useScreenName();
  const readerSpacing = useReaderSpacing();
  const hintText = usePracticeHint();
  const hintShort = usePracticeHint(true);
  const playedAnyway = usePlayedWithoutRoster();
  // The hint line under the buttons ("Ready. +1 night plays the Oct 21
  // games.") keeps its place once the night is in, as "Oct 21 games in.", so
  // the frame does not get 24px shorter under the finger (walk 6 T4-13). It
  // never goes by itself: it went after 3 s without a touch and everything
  // under it jumped 24px while the player read (walk 7 T1-14). It goes at the
  // player's next press of +1 night, +1 week or Play to the end (the buttons
  // above it stay put), or at a tab switch, when the whole screen changes
  // anyway. Set before paint, so no frame goes without it.
  const advances = useRecentAdvances();
  const [held, setHeld] = useState(false);
  const hadHint = useRef(hintText !== null);
  useLayoutEffect(() => {
    const had = hadHint.current;
    hadHint.current = hintText !== null;
    if (hintText !== null || complete) setHeld(false);
    else if (had) setHeld(true);
  }, [hintText, complete]);
  useEffect(() => {
    if (!held || typeof document === 'undefined' || typeof MutationObserver === 'undefined') return undefined;
    // The screen's name changes with the tab ("Market", "Roster").
    const screen = document.getElementById('app-screen');
    if (!screen) return undefined;
    const observer = new MutationObserver(() => {
      if (heldLineEnds('tab-switch')) setHeld(false);
    });
    observer.observe(screen, { attributes: true, attributeFilter: ['aria-label'] });
    return () => observer.disconnect();
  }, [held]);
  // The queue's line under the buttons (Cancel queued) gives its place to
  // the held "Oct 21 games in." line when the queue empties, at the same
  // height, rather than going and moving the screen up by itself (walk 7
  // T1-14). The next press lets both go.
  const [lineFloor, setLineFloor] = useState(0);
  // Cancel shows for the whole run (runSlot), or while anything waits.
  const showCancel = queued.length > 0 || (runSlot && !complete);
  const hadQueue = useRef(false);
  useLayoutEffect(() => {
    const had = hadQueue.current;
    hadQueue.current = showCancel;
    if (had && !showCancel && hintText === null && !complete) setHeld(true);
  }, [showCancel, hintText, complete]);
  useLayoutEffect(() => {
    if (!held && !showCancel) setLineFloor(0);
  }, [held, showCancel]);
  // Presses queued behind the one playing can be dropped where they show
  // (walk 8 T4-N1): the one playing finishes, and the notice says so.
  const cancelQueued = () => {
    const dropped = queuedSteps.current;
    if (dropped.length === 0) return;
    const byKeyboard = !pressedByPointer();
    setQueue([]);
    // Said now, and again at the end of the playing step's result, which
    // takes the notice moments later (walk 9 T1-15). Heard on its own: a
    // notice shown silently before it (the rest of the season queued) was
    // said again in front of it (walk 11 T3-15).
    if (advancingRef.current) cancelNote.current = queuedCancelledNotice(dropped, null);
    stopQueueLine();
    const reply = queuedCancelledNotice(dropped, playingDateRef.current);
    notify(reply, { spoken: '' });
    sayBusy(reply);
    // Keyboard focus goes back to the button the presses were made on (the
    // Cancel control leaves with the queue).
    if (byKeyboard) focusLater(dropped[dropped.length - 1] === 'night' ? nightRef : weekRef, 30);
  };
  const lastSettledNow = bootstrap?.game.lastSettledDate ?? null;
  const heldText = held && lastSettledNow
    ? gamesInLine(resultSpan(advances, lastSettledNow)?.label ?? humanDate(lastSettledNow))
    : null;
  // The hint shows under the buttons (phones), at the end of the status row
  // (desktop), beside or under the day in a folded row, and atop More at
  // 400% zoom, short where the row is tight (walk 4 T1-09, T3-11).
  const hintId = hintText ? PRACTICE_HINT_ID : null;
  useDescribedBy(nightRef, hintId);
  // +1 week says what the week plays, not what +1 night does (walk 7 T3-02).
  // The days +1 week plays next ("Oct 30–Nov 5"): its name and description.
  const nextWeekSpan = lastSettledNow && !complete ? weekSpanLabel(lastSettledNow, practiceSeasonEnd(mockSeasonStart())) : null;
  const weekHint = practiceWeekHint(hintText, nextWeekSpan);
  useDescribedBy(weekRef, weekHint ? PRACTICE_WEEK_HINT_ID : null);

  // Restart or Exit asks first (SimBar draws the question). An item in More
  // closes the menu and lets its history entry go before the question adds
  // its own, so Back and the entries stay in step.
  const askQuestion = (kind: Question | 'play-again', afterGames?: Pick<AskedQuestion, 'news' | 'shortsEnded'>) => {
    // Nothing to lose (the opening eve with no moves, or a finished season):
    // Restart just restarts, Exit just leaves, and Play another season
    // starts the next one, as the result card's button does (walk 4 T1-13).
    // An add still saving, a step playing or a press queued counts: the
    // season is about to hold it (walk 12 T1-07).
    const held = bootstrap ? {
      day: practiceProgress(mockSeasonStart(), bootstrap.game.lastSettledDate).day,
      moves: bootstrap.ledger.items.length,
      inFlight: advancingRef.current || queuedSteps.current.length > 0 || endQueuedRef.current
        || movesInFlight(pendingActions, bootstrap.positions, new Map()).length > 0,
    } : null;
    // Restart with nothing to restart: say so (a reload into the same screen
    // looked like a dead button; walk 7 T1-09, T2-08).
    // From More it closes the menu first and says so where it can be seen:
    // under the open menu the sentence was only heard (walk 10 T4-08).
    if (kind === 'restart' && held && restartHasNothingToDo(held)) {
      if (!moreOpen) {
        notify(FRESH_SEASON_NOTICE);
        return;
      }
      setMoreOpen(false);
      afterDialogCloses(() => {
        focusLater(moreRef, 0);
        notify(FRESH_SEASON_NOTICE);
      });
      return;
    }
    if ((kind === 'restart' || kind === 'exit' || kind === 'play-again') && bootstrap && held
      && !practiceAsksFirst(kind, held)) {
      if (kind === 'exit') leavePractice();
      else if (kind === 'play-again') restartPractice(seasonResultLine(bootstrap.account.cumulativePnl, rankLine(bootstrap.leaderboard)));
      else restartPractice();
      return;
    }
    if (kind === 'play-again') return;
    if (!moreOpen) {
      setAskedQuestion({ kind, fromMenu: false, ...afterGames });
      return;
    }
    setMoreOpen(false);
    questionComing.current = true;
    afterDialogCloses(() => {
      questionComing.current = false;
      setAskedQuestion({ kind, fromMenu: true, ...afterGames });
    });
  };
  // The last night is in: the advance buttons have nothing left to play, so
  // focus moves to Restart rather than falling to the page.
  // The season just ended by a press here (Play to the end, or the last
  // week): the Roster opens on the result card, its heading focused (walk 10
  // T2-02). Without a frame to switch, focus moves to the way on.
  useEffect(() => {
    watchPointerDowns();
  }, []);
  useEffect(() => {
    if (!complete) return;
    endRunSlot();
    if (!advancedRef.current) return;
    advancedRef.current = false;
    // A tap on the advance buttons' spot a moment from now is the same run.
    seasonEndedAt = Date.now();
    if (!showSeasonResult()) focusLater(restartRef, 150);
  }, [complete]);
  // Play the queued press once the controls are free: the nights before it
  // are on screen, or your move is saved. Nothing is left to play once the
  // season is over.
  const busyNow = !isGameplayReady || isRefreshing || pendingActions.size > 0 || advancing;
  useEffect(() => {
    if (busyNow || questionOpen || questionComing.current) return;
    if (endQueuedRef.current) {
      // The rest of the season plays now; presses queued before it have
      // nothing left to play.
      endQueuedRef.current = false;
      setEndQueued(false);
      setQueue([]);
      if (!complete) playToEndRef.current?.();
      return;
    }
    if (queuedSteps.current.length === 0) return;
    const [step, ...rest] = queuedSteps.current;
    setQueue(complete ? [] : rest);
    if (!complete) pressRef.current?.(step, true);
    else runRef.current = null;
  }, [busyNow, complete, endQueued, queued, questionOpen]);
  // "…Cancel drops it." goes the moment nothing waits: the notice says what
  // is playing in its place (walk 11 T4-06). Shown, not said again.
  const seasonEndDate = practiceSeasonEnd(mockSeasonStart());
  useLayoutEffect(() => {
    if (queued.length > 0 || !advancingRef.current || message !== queueFullLine(seasonEndDate, cancelAt)) return;
    notify(queueLastLine(playingStepRef.current === 'night' ? 'night' : 'week', seasonEndDate), { spoken: '' });
  }, [queued, message, notify, seasonEndDate]);
  if (!bootstrap || !isMockActive() || typeof window === 'undefined') return null;

  const layout = chromeLayout(width, fontScale);
  const compact = layout.compact && !inline;
  const narrow = layout.narrow && !inline;
  const disabled = !isGameplayReady || isRefreshing || pendingActions.size > 0;
  const progress = practiceProgress(mockSeasonStart(), bootstrap.game.lastSettledDate);
  // While a night plays the buttons go quiet but keep their Tab stop and
  // focus, so Enter can play the next night once it is in.
  const advanceBusy = disabled || advancing;
  // A press then queues: the buttons stay available and their names say what
  // a press does (walk 13 T3-06: announced "unavailable" while every press
  // queued a week). aria-disabled only where a press does nothing: the game
  // is loading, the rest of the season is playing or already queued, or the
  // season is over (the press says why).
  const playingDaysNow = playing?.step === 'week' ? 7 : playing?.step === 'night' ? 1 : 0;
  const pressQueues = advanceBusy && isGameplayReady && playing?.step !== 'end' && !endQueued
    && queueHasRoom(queued, SEASON_TOTAL_DAYS - progress.day - playingDaysNow);
  const advanceUnavailable = progress.complete || (advanceBusy && !pressQueues);
  const queueingPlaying = playing && playing.step !== 'end' ? { step: playing.step, date: playing.date } : null;

  const open = bootstrap.positions.filter((position) => position.status === 'active');
  // Nothing to play for yet: +1 night / +1 week stay quiet (the first move is
  // adding a player), ask before playing, and a line under them says what
  // they do. Once the player has said "Play anyway" this season +1 night
  // just plays (walk 3 T1-19, T2-14); +1 week asks every time and both stay
  // quiet while nobody is held (walk 14 T1-06).
  // Adds still saving count: the buttons light at once and a press waits
  // for the saves, as moves wait for nights (walk 12 T2-08).
  const emptyRoster = open.length === 0 && savingHolds(pendingActions, bootstrap).length === 0 && !progress.complete;
  // +1 night on a locked night with nobody held just plays (walk 9 T4-03);
  // +1 week there always asks, "+1 night instead" first (walk 10 T2-14).
  const lockedNight = bootstrap.ruleset.rosterMutationsLocked && !progress.complete;
  const asksFirst = asksBeforeEmptyWeek(emptyRoster, playedAnyway, lockedNight);
  const asksNight = asksBeforeEmptyNight(emptyRoster, playedAnyway, lockedNight);
  // Quiet while nobody is held, whatever was answered before: "Play anyway"
  // answers one press, and the welcome's Open market stays the one gold
  // call (walk 14 T1-06).
  // The rest of the season already queued: a press does nothing but say so,
  // so both draw quiet, outlined in muted ink; in gold they read as live
  // (walk 15 T4-03). The queue's count stays on +1 week.
  const seasonQueued = advanceBusy && isGameplayReady && !progress.complete && playing?.step !== 'end' && !endQueued && !pressQueues;
  const quietNight = advanceQuiet('night', emptyRoster, lockedNight) || seasonQueued;
  const quietWeek = advanceQuiet('week', emptyRoster, lockedNight) || seasonQueued;
  // Near the end something else takes the buttons' spot (Play another
  // season), so a double tap's second click is kept off it there.
  const nearEnd = SEASON_TOTAL_DAYS - progress.day <= 7;
  const lineText = hintText ?? heldText;
  // Cancel queued: where the queue shows (walk 8 T4-N1). Under the buttons
  // on a phone, in More in a folded row; a wide screen's status row draws it
  // after its facts (QueuedCancelButton).
  // Through the whole run it keeps its place: with nothing waiting it is
  // dashed (reachable, unavailable) and a press says why (walk 10 T2-06).
  const cancelButton = (placement: 'line' | 'menu' | 'slot' | 'row' | 'fold') => (!showCancel ? null : (
    <Button
      ref={placement === 'menu' ? undefined : cancelNodeRef}
      accessibilityLabel={queued.length > 0 ? queuedCancelControlName(queued) : NOTHING_QUEUED_NAME}
      disabled={queued.length === 0}
      focusableWhenDisabled
      label={cancelQueuedLabel(queued, placement === 'fold')}
      onDisabledPress={() => {
        // On the button, never over the notice: a late tap replaced a run's
        // result with "Nothing is queued." (walk 11 T1-14).
        sayBusy(`${NOTHING_TO_CANCEL}.`);
      }}
      onPress={cancelQueued}
      style={[styles.quiet, placement !== 'menu' && styles.quietEdge, placement === 'line' && styles.cancelLine, placement === 'slot' && styles.cancelSlot, placement === 'row' && styles.cancelRow, placement === 'fold' && styles.cancelFold]}
      textStyle={[
        placement === 'fold' ? [styles.cancelLineText, styles.cancelFoldText] : placement !== 'menu' ? styles.cancelLineText : queued.length > 0 ? styles.menuItemText : undefined,
        queued.length === 0 && placement !== 'menu' && styles.cancelNothingText,
      ]}
      variant="quiet"
    />
  ));
  const hint = inline || folded ? null : showCancel ? (
    <View
      onLayout={(event) => {
        const next = Math.round(event.nativeEvent.layout.height);
        setLineFloor((current) => Math.max(current, next));
      }}
      style={styles.hintRow}
    >
      {cancelButton('line')}
    </View>
  ) : lineText ? (
    <Text
      maxFontSizeMultiplier={1.5}
      nativeID={hintText ? PRACTICE_HINT_ID : undefined}
      style={[styles.hint, !hintText && lineFloor > 0 && { minHeight: lineFloor }]}
    >
      {lineText}
    </Text>
  ) : null;
  // "Next week queued. It plays once Oct 21–27 is in." for screen readers,
  // after a press that landed mid-play (the button shows it too).
  const busyAnnouncer = (
    <View style={visuallyHidden}>
      <Text accessibilityLiveRegion="polite">{busyLine}</Text>
      {/* Read as +1 week's description only, never on its own. */}
      {weekHint ? <Text aria-hidden nativeID={PRACTICE_WEEK_HINT_ID}>{weekHint}</Text> : null}
    </View>
  );

  // One night (or week) per press, and the next press waits for the screen
  // to catch up with this one (it is queued, once): the client and the
  // screen stay on the same day.
  const advance = async (step: 'night' | 'week', queuedPress = false) => {
    if (advancingRef.current) {
      queuePress(step, playingDateRef.current);
      return;
    }
    advancingRef.current = true;
    advancedRef.current = true;
    const startedAt = Date.now();
    // The last step's notice still waiting to be heard: a press that starts
    // a run of its own (continuesRun) lets it be heard first, so each night
    // stepped through one by one is heard once (walk 18 T2-10).
    const unheard = speakRun.current !== null;
    // This press continues the run (or starts one): its line is not heard yet.
    stopSpeakRun();
    stopRunSlotTimer();
    // The player's own press: the held "Oct 21 games in." line goes now,
    // under the button being pressed, not later by itself (walk 7 T1-14).
    if (heldLineEnds(queuedPress ? 'queued-press' : 'press')) setHeld(false);
    const from = bootstrap.game.lastSettledDate ?? null;
    // A press that waited behind another continues its run, and so does a
    // press soon after the last step landed (continuesRun); any other
    // starts one, from the account as it stands now.
    const landed = landedRun.current;
    landedRun.current = null;
    const continued = queuedPress ? runRef.current
      : landed && continuesRun(false, Date.now() - landed.at, step) ? landed.run : null;
    if (!continued && landed && unheard) speakNotice();
    const run: PracticeRun = continued
      ? { ...continued, steps: [...continued.steps, step], lastFrom: from }
      : { start: bootstrap, steps: [step], lastFrom: from };
    runRef.current = run;
    const date = step === 'night' ? nightDate
      : from ? weekSpanLabel(from, practiceSeasonEnd(mockSeasonStart())) : null;
    playingDateRef.current = date;
    playingStepRef.current = step;
    setPlaying({ step, date });
    publishPlaying(date, step);
    let stepIn = false;
    try {
      // "Playing Oct 21…" paints before the night's heavy work (walk 5 T4-11).
      await afterPaint();
      recordAdvance({
        step,
        from,
        emptyRoster: open.length === 0,
        runFrom: continued ? runSpanFrom(run.start.game.lastSettledDate, run.start.game.nextGameDate, run.steps[0] ?? null) : undefined,
      });
      if (step === 'week') playPracticeWeek();
      else playPracticeNight(from, practiceSeasonEnd(mockSeasonStart()));
      for (let attempt = 0; attempt < ADVANCE_REFRESH_ATTEMPTS; attempt += 1) {
        if (await refreshData({ silent: true })) {
          stepIn = true;
          break;
        }
        await wait(ADVANCE_RETRY_MS);
      }
    } finally {
      // The nights are in: the buttons take presses at once, in the render
      // that shows them (they rested another 0.45 s, and a press then was
      // dropped; walk 5 T3-11, T4-06). A queued press plays now.
      advancingRef.current = false;
      playingDateRef.current = null;
      playingStepRef.current = null;
      if (stepIn) lastStepMs = Date.now() - startedAt;
      setPlaying(null);
      publishPlaying(null);
      if (queuedSteps.current.length === 0 && !endQueuedRef.current) {
        // The run's Cancel stays while a press could still continue it.
        stopRunSlotTimer();
        runSlotTimer.current = setTimeout(() => practiceEngine.endRunSlot.current?.(), RUN_CONTINUE_MS);
        // Nothing waits behind it: the run is over for now, and a run of two
        // or more steps gets one notice for all of it (in the render that
        // shows it). A press in the next moment picks it up again.
        runRef.current = null;
        landedRun.current = stepIn ? { run, at: Date.now() } : null;
        const note = cancelNote.current;
        cancelNote.current = null;
        if (run.steps.length > 1) setRunOver({ ...run, note });
        else if (note && stepIn) setAppendNote(note);
        if (stepIn) {
          speakRun.current = setTimeout(() => {
            speakRun.current = null;
            speakNotice();
          }, RUN_CONTINUE_MS);
        }
      } else {
        // Another press waits: this step's own notice never shows, the
        // run's does once it is all in (Play to the end says its own).
        if (stepIn) holdStepNotice.current = true;
        if (endQueuedRef.current) {
          // Play to the end waits behind it: its notice covers this run too.
          practiceEngine.endRun.current = run;
          runRef.current = null;
        }
      }
    }
  };
  advanceRef.current = (step) => {
    void advance(step);
  };
  // The rest of the season in one go, once its question is answered (walk 6
  // T2-N1, T4-N3): a week at a time, letting the page paint between weeks,
  // then one refresh, so one notice says how the season ended.
  const playToEnd = async () => {
    if (advancingRef.current || pendingActions.size > 0 || isRefreshing) {
      // Confirmed while a night plays or a move saves: it waits its turn and
      // says so, rather than doing nothing (walk 7 T2-04).
      endQueuedRef.current = true;
      setEndQueued(true);
      sayBusy(playToEndQueuedLine(playingDateRef.current));
      return;
    }
    const end = practiceSeasonEnd(mockSeasonStart());
    const from = bootstrap.game.lastSettledDate ?? null;
    // Inside a run (its last step not heard yet, or the step this waited
    // behind), the season's end names the run's whole span, never the last
    // night's headline alone (walk 16 T2-01: "Oct 21 games: your score rose
    // $74.5K. Season complete…"). The step's own notice stays, silent, until
    // the season's end replaces it; neither lock is said (walk 14 T4-02).
    const continued = speakRun.current ? landedRun.current?.run ?? null : practiceEngine.endRun.current;
    practiceEngine.endRun.current = null;
    // Pressed on its own it is a run of its own: its notice carries the span
    // it played too ("Season complete. Final score +$3.96M, #2 of 5. Nov
    // 19–Apr 12 games: your score rose $3.93M."), as a run's does; 145 days
    // went by on one press and only the season's totals were said (walk 18
    // T2-03).
    practiceEngine.seasonEndRun.current = continued ?? { start: bootstrap, steps: [], lastFrom: from };
    if (speakRun.current) {
      stopSpeakRun();
      if (isGamesNotice(message)) notify(message as string, { spoken: '' });
    }
    // Presses that waited for its question are part of the rest of the season.
    setQueue([]);
    endRunSlot();
    advancingRef.current = true;
    advancedRef.current = true;
    runRef.current = null;
    landedRun.current = null;
    setPlaying({ step: 'end', date: end ? humanDate(end) : null });
    setPracticePlaying("rest of the season's");
    try {
      await afterPaint();
      recordAdvance({ step: 'week', from, emptyRoster: open.length === 0 });
      const weeks = Math.ceil((SEASON_TOTAL_DAYS - progress.day) / 7);
      for (let week = 0; week < weeks; week += 1) {
        advanceMockDays(7, end);
        await wait(0);
      }
      // The season's end comes in silent and is heard as the run's notice,
      // its span with it (in the render that shows it, above).
      let landedEnd = false;
      for (let attempt = 0; attempt < ADVANCE_REFRESH_ATTEMPTS; attempt += 1) {
        if (await refreshData({ silent: true })) {
          landedEnd = true;
          break;
        }
        await wait(ADVANCE_RETRY_MS);
      }
      if (!landedEnd) {
        practiceEngine.seasonEndRun.current = null;
        speakNotice();
      }
    } finally {
      advancingRef.current = false;
      setPlaying(null);
      setPracticePlaying(null);
    }
  };
  playToEndRef.current = () => {
    void playToEnd();
  };
  pressRef.current = (step, queuedPress = false) => {
    if (step === 'night' ? asksNight : asksFirst) {
      // Presses still queued behind this one do not play: said with why,
      // never dropped in silence (walk 13 T4-09).
      // Asked as games land (a press queued behind them, or one pressed as
      // their notice came in), the question leads with their news: its scrim
      // hides the notice (walk 18 T4-06).
      const landed = landedRun.current;
      const newsRun = questionLeadsWithNews(queuedPress, landed ? Date.now() - landed.at : null)
        ? (queuedPress ? runRef.current : landed?.run ?? null)
        : null;
      const shortsEnded = Boolean(newsRun?.start.positions.some((position) => position.side === 'short' && position.status === 'active'));
      const news = newsRun && bootstrap.game.lastSettledDate !== newsRun.start.game.lastSettledDate ? runText(newsRun, bootstrap) : null;
      const ended = queuedPress ? queueEndedNotice(queuedSteps.current, 'empty-roster', shortsEnded) : null;
      runRef.current = null;
      landedRun.current = null;
      setQueue([]);
      askQuestion(step === 'night' ? 'empty-night' : 'empty-week', { news, shortsEnded });
      if (ended) notify(ended);
    } else void advance(step, queuedPress);
  };

  const stackLabels = (compact || folded) && width < STACKED_LABEL_MAX_WIDTH;
  // Portrait phones: +1 night, +1 week, a slot, More (walk 9 T1-13).
  const phoneRow = !inline && !folded && !layout.wide;
  const slotRow = phoneRow && width >= PHONE_SLOT_MIN_WIDTH;
  // +1 night names the game night it plays ("Oct 25"), so a day without
  // games that it skips is no surprise.
  const nightDate = !progress.complete && bootstrap.game.nextGameDate
    ? humanDate(bootstrap.game.nextGameDate)
    : null;
  // Folded and narrow: the controls get their own line and share it evenly.
  const foldFill = folded && width < CHROME_FOLDED_ONE_LINE_MIN_WIDTH;
  // At 400% zoom on a desktop (320x200) +1 night stays in the row beside
  // More, the step the welcome names (walk 14 T3-02); the rest is in More.
  const nightInRow = folded && tiny && tinyRowHoldsNight(width, progress.complete, lockedNight);
  // While a night (or week) plays, the pressed button says so and keeps its
  // full ink (walk 2 T4-07); the other one dims. A press queued behind it
  // shows on the button it was made on, in full ink: "+1 week" over
  // "queued".
  const playingNight = playing?.step === 'night';
  const playingWeek = playing?.step === 'week';
  const playingText = playing?.date ? `Playing ${playing.date}…` : 'Playing…';
  const nightsQueued = queued.filter((step) => step === 'night').length;
  const weeksQueued = queued.length - nightsQueued;
  const inkNight = playingNight || nightsQueued > 0;
  const inkWeek = playingWeek || weeksQueued > 0;
  // Stacked labels still name the night where the row allows: "+1 NIGHT"
  // over "OCT 21", the night button taking the larger share (walk 4 T3-11).
  const stackedDate = stackLabels && nightDate !== null && width >= NIGHT_DATE_STACKED_MIN_WIDTH;
  // The pressed button's busy words: the night it plays.
  const busyLabel = (withDate: boolean) => (
    withDate && !stackLabels && playing?.date ? `Playing\n${playing.date}…` : 'Playing…'
  );
  // "…, to the Oct 28 games. Next night queued." (a sentence of its own).
  const queuedName = (step: 'night' | 'week', name: string) => {
    const count = step === 'night' ? nightsQueued : weeksQueued;
    if (count === 0) return name;
    return `${name}${/[.…]$/.test(name) ? '' : '.'} ${count === 1 ? `Next ${step} queued.` : `${count} ${step}s queued.`}`;
  };
  // While weeks play or wait, +1 night plays after them: no date the queue
  // will already play (walk 12 T4-08).
  const afterQueue = nightsQueued > 0 || playingNight ? null
    : nightAfterQueue(lastSettledNow, playing?.step === 'week' ? 'week' : null, queued, practiceSeasonEnd(mockSeasonStart()), playing?.step === 'week' ? playing.date : null);
  const nightLabel = nightsQueued > 0 ? queuedLabel('night', stackLabels, nightsQueued)
    : playingNight ? busyLabel(true)
      // Its date dropped while weeks play or wait: "+1 NIGHT" stays on one
      // line where the dated label had it so (195px; walk 14 T4-06).
      : afterQueue ? (stackedDate ? '+1\u00a0night' : stackLabels ? '+1\nnight' : '+1 night')
        : stackedDate ? `+1 night\n${nightDate}` : stackLabels ? '+1\nnight' : nightDate ? `+1 night\n${nightDate}` : '+1 night';
  // Its visible words first ("+1 night Oct 21: play the Oct 21 games"), so a
  // voice command matches what it shows (walk 10 T3-05).
  const nightName = queuedName('night', afterQueue && !playingNight ? afterQueue.name
    : pressQueues ? queueingAdvanceName('night', queueingPlaying, nightsQueued)
      : playingNight ? `+1 night: advance one night. ${playingText}`
        : nightButtonName(nightDate, stackedDate || (!stackLabels && nightDate !== null)));
  const nightButton = (
      <Button
        ref={nightRef}
        accessibilityLabel={nightName}
        disabled={advanceUnavailable}
        focusableWhenDisabled={!progress.complete}
        label={nightLabel}
        onDisabledPress={pressAdvance('night', () => pressWhileBusy('night'), nearEnd)}
        steady
        onPress={advanceBusy ? pressAdvance('night', () => pressWhileBusy('night'), nearEnd)
          : pressAdvance('night', () => pressRef.current?.('night'), nearEnd || asksNight)}
        // In a folded row (a phone on its side) +1 night keeps +1 week's
        // width, so the two read as a pair: it was 64px on two lines beside
        // a 104px +1 week (walk 12 T1-03).
        style={[styles.advance, narrow && styles.advanceNarrow, compact && !slotRow && styles.advanceCompact, slotRow && styles.advancePhone, folded && styles.advanceFolded, folded && !stackLabels && !foldFill && styles.advanceWeekReserve, foldFill && !nightInRow && styles.advanceFill, nightInRow && styles.advanceTinyRow, stackLabels && styles.advanceStacked, stackedDate && styles.advanceDated, quietNight && styles.advanceQuiet, inkNight && styles.advancePlaying]}
        textStyle={[quietNight ? styles.advanceTextQuiet : styles.advanceText, stackLabels && inkNight && styles.advanceTextBusyStacked]}
        variant="secondary"
      />
  );
  const weekButton = (
      <Button
        ref={weekRef}
        // The span it plays is in the name; the label keeps the button's width.
        // The rest of the season queued: named for what a press does (walk
        // 18 T3-12), the queue's count in it.
        accessibilityLabel={seasonQueued ? seasonQueuedWeekName(practiceSeasonEnd(mockSeasonStart()), queued, cancelAt)
          : queuedName('week', pressQueues ? queueingAdvanceName('week', queueingPlaying, weeksQueued)
            : playingWeek ? `+1 week: advance one week. ${playingText}` : weekButtonName(nextWeekSpan))}
        disabled={advanceUnavailable}
        focusableWhenDisabled={!progress.complete}
        label={weeksQueued > 0 ? queuedLabel('week', stackLabels, weeksQueued) : playingWeek ? busyLabel(false) : stackLabels ? stackedWeekLabel(width) : '+1 week'}
        onDisabledPress={pressAdvance('week', () => pressWhileBusy('week'), nearEnd)}
        steady
        onPress={advanceBusy ? pressAdvance('week', () => pressWhileBusy('week'), nearEnd)
          : pressAdvance('week', () => pressRef.current?.('week'), nearEnd || asksFirst)}
        style={[styles.advance, narrow && styles.advanceNarrow, compact && !slotRow && styles.advanceCompact, slotRow && styles.advancePhone, folded && styles.advanceFolded, foldFill && styles.advanceFill, stackLabels && styles.advanceStacked, stackLabels && width >= WEEK_ONE_LINE_STACKED_MIN_WIDTH && styles.advanceWeekOneLine, !stackLabels && !slotRow && !foldFill && styles.advanceWeekReserve, quietWeek && styles.advanceQuiet, inkWeek && styles.advancePlaying]}
        textStyle={[quietWeek ? styles.advanceTextQuiet : styles.advanceText, stackLabels && inkWeek && styles.advanceTextBusyStacked]}
        variant="secondary"
      />
  );
  const advanceButtons = (
    <>
      {nightButton}
      {weekButton}
    </>
  );
  // "Play to the end": beside Restart where the row has room (on a phone as
  // "Play to" over "the end"), and in More wherever More holds Restart. It
  // always asks first (walk 6 T2-N1, T4-N3).
  const playingEnd = playing?.step === 'end';
  const playToEndButton = (stacked: boolean, inMenu = false) => (progress.complete ? null : (
    <Button
      accessibilityLabel={`${PLAY_TO_END_LABEL} of the season${playingEnd ? '. Playing the rest of the season…' : endQueued ? '. Queued: it plays once the games on screen are in.' : ''}`}
      // It opens its question while a night plays or a move saves (it did
      // nothing then); its confirm waits its turn (walk 7 T2-04).
      disabled={playingEnd || endQueued || !isGameplayReady}
      focusableWhenDisabled
      label={playingEnd ? 'Playing…' : endQueued ? 'Queued' : stacked ? 'Play to\nthe end' : PLAY_TO_END_LABEL}
      onPress={() => askQuestion('play-to-end')}
      style={[styles.quiet, !inMenu && styles.quietEdge, narrow && styles.quietNarrow, stacked && styles.quietStacked, playingEnd && styles.advancePlaying]}
      textStyle={stacked ? styles.quietStackedText : inMenu && !playingEnd && !endQueued ? styles.menuItemText : undefined}
      variant="quiet"
    />
  ));
  // In the row, Restart and Exit are outlined like the controls beside them
  // (bare words read as captions; walk 7 T1-01); in More they are menu items.
  const seasonEnd = seasonEndControl(progress.complete && screenName === 'Roster');
  const secondaryButtons = (inMenu = false) => (
    <>
      {/* Both lose the whole season, so both ask first (ConfirmDialog says
          what would be lost). Start over reloads into a fresh season, which
          restarts the in-memory client and its provider together. */}
      {/* Once the season is complete, Restart is the way on, named as the
          result card names it, "Play another season", and like the card's
          button it starts the next season at once: nothing is left to lose
          (walk 4 T1-13). Its name keeps "restart" for anyone looking. */}
      <Button
        ref={restartRef}
        accessibilityLabel={progress.complete ? seasonEnd.name : 'Restart practice'}
        // One name for the way on at season end, as the card and status row
        // say it (walk 3 T1-11, T4-04); on the Roster, beside the card's own
        // gold button, a quiet "New season" (walk 10 T4-03).
        label={progress.complete ? seasonEnd.label : 'Restart'}
        onPress={() => {
          // A steady run's next tap on the spot +1 night was on, just as the
          // season ended, is that run, not a new season (walk 13 T4-10).
          if (progress.complete && seasonEndRepeat()) return;
          askQuestion(progress.complete ? 'play-again' : 'restart');
        }}
        // At season end it is the way on, so it looks like one (it read as a
        // disabled grey slab on Results and Leaders; walk 5 T2-09).
        style={progress.complete && seasonEnd.primary ? undefined : [styles.quiet, !inMenu && styles.quietEdge, narrow && styles.quietNarrow]}
        // In More an action reads as one: the quiet grey read as disabled in
        // Navy (walk 13 T1-06).
        textStyle={inMenu && !(progress.complete && seasonEnd.primary) ? styles.menuItemText : undefined}
        variant={progress.complete && seasonEnd.primary ? 'primary' : 'quiet'}
      />
      {/* Exit only where there is a live market to go to (walk 4 T2-10). */}
      {liveMarketToExitTo() ? (
        <Button
          ref={exitRef}
          accessibilityLabel="Exit practice"
          label="Exit"
          onPress={() => askQuestion('exit')}
          style={[styles.quiet, !inMenu && styles.quietEdge, narrow && styles.quietNarrow]}
          textStyle={inMenu ? styles.menuItemText : undefined}
          variant="quiet"
        />
      ) : null}
    </>
  );

  // At the end of the season there is nothing left to advance (the status
  // row says "Season complete"), so Restart and Exit take the row themselves.
  // Not in a folded row: there they sat where +1 night was (walk 13 T4-10).
  if ((compact || phoneRow) && progress.complete && !folded) {
    const onRoster = screenName === 'Roster';
    // The Roster's result card holds the gold Play another season, so the
    // row goes there: it held only "New season", pushed right (walk 14 T1-04).
    if (!seasonEndRowShows(onRoster, liveMarketToExitTo())) return null;
    // Elsewhere the row leads with the final place, in words where +1 night
    // was, and the way on keeps the row's end (walk 13 T4-10).
    const standing = onRoster ? null : seasonEndStanding(rankLine(bootstrap.leaderboard));
    return (
      <View style={[styles.controls, styles.controlsNarrow, styles.seasonEndRow]}>
        {standing ? (
          <View style={styles.seasonEndStanding}>
            <Text aria-hidden maxFontSizeMultiplier={1.3} numberOfLines={2} style={styles.seasonEndStandingText}>{standing}</Text>
            <Text style={visuallyHidden}>{spokenRanks(standing)}</Text>
          </View>
        ) : null}
        <View style={[styles.group, styles.moreRow]}>
          {secondaryButtons()}
        </View>
      </View>
    );
  }

  // Rules joins More only where the frame folds and the status row has no
  // room for its own Rules control.
  const rulesItem = onRules ? (
    <Button
      accessibilityLabel="Rules: show the game rules"
      label="Rules"
      onPress={() => {
        // The menu's history entry goes before the rules add theirs, and
        // More holds focus as they open, so closing them returns it there.
        setMoreOpen(false);
        afterDialogCloses(() => {
          (moreRef.current as unknown as { focus?: () => void } | null)?.focus?.();
          onRules();
        });
      }}
      style={styles.quiet}
      textStyle={styles.menuItemText}
      variant="quiet"
    />
  ) : null;
  const menu = (items: ReactNode) => (
    <MoreMenu buttonRef={moreRef} open={moreOpen} setOpen={setMoreOpen}>
      {items}
    </MoreMenu>
  );

  // Tiny: More holds everything. +1 night and +1 week keep it open, so a
  // run of nights needs no reopening; the busy label shows in it.
  if (folded && tiny) {
    const settingsItem = onSettings ? (
      <Button
        accessibilityLabel="Settings"
        label="Settings"
        onPress={() => {
          setMoreOpen(false);
          afterDialogCloses(() => {
            (moreRef.current as unknown as { focus?: () => void } | null)?.focus?.();
            onSettings();
          });
        }}
        style={styles.quiet}
        textStyle={styles.menuItemText}
        variant="quiet"
      />
    ) : null;
    // The row has room for a named padlock only, so More opens on the lock's
    // words: "Locked · Nov 1" (walk 3 T3-29). Not a menu item: arrows and
    // the first focus pass over it.
    const lockDate = bootstrap.ruleset.rosterLockGameDate;
    const lockNote = bootstrap.ruleset.rosterMutationsLocked && !progress.complete ? (
      <View aria-label={lockIconName(lockDate)} role="img" style={styles.moreNote}>
        <View style={styles.moreNoteIcon}>
          <LockIcon color={colors.goldInk} size={12} />
        </View>
        <Text maxFontSizeMultiplier={1.5} style={styles.moreNoteText}>{lockShortText(lockDate)}</Text>
      </View>
    ) : null;
    // The row has no room for the hint either: More opens on its short form,
    // above the buttons it explains (walk 4 T3-11). Not a menu item.
    const menuHint = hintShort ?? menuOpenHint;
    const hintNote = menuHint && !lockNote ? (
      <Text maxFontSizeMultiplier={1.5} nativeID={nightInRow ? undefined : PRACTICE_HINT_ID} style={[styles.moreNote, styles.moreHint]}>{menuHint}</Text>
    ) : null;
    // How the night (or week) pressed here went, under the buttons, while
    // the menu stays open for the next press (walk 6 T3-04). Not an item.
    // Above the items, under the lock's note, news first (menuResultText):
    // pinned under them it sat over RULES at 400% zoom (walk 18 T3-06).
    const resultNote = menuNotice ? (
      <Text maxFontSizeMultiplier={1.5} style={[styles.moreNote, styles.moreResult, styles.moreResultTop]}>
        {keepDatesTogether(menuResultText(menuNotice, newsFirst))}
      </Text>
    ) : null;
    return (
      <View style={styles.foldedControls}>
        {nightInRow ? nightButton : null}
        {/* +1 night's whole hint, for its description (aria-describedby),
            and the busy line, which a press in the row speaks. */}
        {nightInRow && hintText ? <Text nativeID={PRACTICE_HINT_ID} style={visuallyHidden}>{hintText}</Text> : null}
        {nightInRow ? busyAnnouncer : null}
        <MoreMenu buttonRef={moreRef} open={moreOpen} setOpen={setMoreOpen}>
          {/* The notes above the buttons never get shorter while the menu is
              open (a lock that lifts, say), so the buttons stay put. */}
          <View
            onLayout={(event) => {
              const next = Math.round(event.nativeEvent.layout.height);
              setMenuNotesHeight((current) => Math.max(current, next));
            }}
            style={{ minHeight: menuNotesHeight }}
          >
            {lockNote}
            {hintNote}
            {resultNote}
          </View>
          {progress.complete ? null : nightInRow ? weekButton : advanceButtons}
          {cancelButton('menu')}
          {nightInRow ? null : busyAnnouncer}
          {rulesItem}
          {playToEndButton(false, true)}
          {/* Restart, which wipes the season, is its own group in every
              More panel (walk 15 T1-07). */}
          {progress.complete ? null : <View style={styles.menuDivider} />}
          {secondaryButtons(true)}
          {settingsItem}
        </MoreMenu>
      </View>
    );
  }

  // A short window: one row with +1 night and +1 week (Restart and Exit once
  // the season is over), then More. The status row adds the day and Settings.
  // At season end the spot +1 night and +1 week held says "Season complete"
  // and takes no press; the way on waits in More (and on the Roster's result
  // card): a steady tap through the last night landed on "New season" there
  // and started season 2 before the result was seen (walk 13 T4-10).
  if (folded) {
    // Cancel queued in the row, before +1 night, wherever the row has room
    // (landscape phones, a laptop at 150%): inside More it was out of sight
    // while the queue played on (walk 15 T4-01, T2-08). The status row
    // leaves out the games figure meanwhile, so nothing else moves.
    const cancelInRow = cancelAt === 'night' && !progress.complete;
    return (
      <View style={[styles.foldedControls, foldFill && styles.foldedFill]}>
        {cancelInRow ? cancelButton('fold') : null}
        {progress.complete && endBeside ? null : progress.complete ? (
          <View style={[styles.seasonDone, foldFill ? styles.advanceFill : styles.seasonDoneFixed]}>
            {/* On the Roster the result card's gold Play another season sits
                right below: the frame pointed to More over it (walk 15
                T1-06). The slot keeps its place, blank; the status row
                beside it already says "Season complete" and the final score. */}
            {screenName === 'Roster' ? null : (
              <Text maxFontSizeMultiplier={1.3} numberOfLines={2} style={styles.seasonDoneNext}>{SEASON_DONE_SLOT}</Text>
            )}
          </View>
        ) : advanceButtons}
        {menu(progress.complete ? <>{secondaryButtons(true)}{rulesItem}</> : <>{cancelInRow ? null : cancelButton('menu')}{rulesItem}{playToEndButton(false, true)}<View style={styles.menuDivider} />{secondaryButtons(true)}</>)}
        {busyAnnouncer}
      </View>
    );
  }

  if (slotRow) {
    // The slot beside +1 week: Cancel queued while presses wait (beside the
    // button they were made on, next in Tab order; walk 9 T3-12), else the
    // lock, else the short hint. It never adds a line, so nothing under the
    // buttons moves when a week lands on a lock (walk 9 T4-08).
    const lockDate = bootstrap.ruleset.rosterLockGameDate;
    const slot = showCancel ? cancelButton('slot') : lockedNight ? (
      <View aria-hidden style={styles.slotLock}>
        <View style={styles.moreNoteIcon}>
          <LockIcon color={colors.goldInk} size={12} />
        </View>
        {/* A reader's own text spacing grows the words: no clamp then, and
            the date alone beside the padlock on a narrow phone (walk 11 T3-04). */}
        <Text maxFontSizeMultiplier={1.3} numberOfLines={readerSpacing ? undefined : 2} style={styles.slotLockText}>
          {lockSlotText(lockDate, width, readerSpacing)}
        </Text>
      </View>
    ) : hintShort && !advancing ? (
      // Blank while a night plays: the button beside it says so (walk 11 T1-08).
      <Text aria-hidden maxFontSizeMultiplier={1.3} numberOfLines={2} style={styles.slotHint}>{hintShort}</Text>
    ) : null;
    return (
      <View style={[styles.controls, narrow && styles.controlsNarrow, styles.phoneControls]}>
        {advanceButtons}
        <View style={styles.slot}>{slot}</View>
        {menu(<>{playToEndButton(false, true)}{progress.complete ? null : <View style={styles.menuDivider} />}{secondaryButtons(true)}</>)}
        {/* +1 night's whole hint, for its description (aria-describedby). */}
        {hintText ? <Text nativeID={PRACTICE_HINT_ID} style={visuallyHidden}>{hintText}</Text> : null}
        {busyAnnouncer}
      </View>
    );
  }

  if (compact || phoneRow) {
    return (
      <View style={[styles.controls, styles.controlsNarrow]}>
        <View style={[styles.group, styles.groupFill]}>
          {/* Nothing left to play at season end: no dimmed advance buttons. */}
          {progress.complete ? secondaryButtons() : (
            <>
              {advanceButtons}
              {menu(<>{playToEndButton(false, true)}<View style={styles.menuDivider} />{secondaryButtons(true)}</>)}
            </>
          )}
        </View>
        {hint}
        {busyAnnouncer}
      </View>
    );
  }

  // Desktop's one row: for a run, Cancel takes the place of Play to the end
  // and Restart at their width, right after +1 week (next in Tab order), so
  // nothing else in the row moves (walk 10 T2-06, T3-09; the status row's
  // 24px Cancel was 500px away and skipped by Tab).
  // A tablet (the bar's own row, 720-899px) is laid out the same way, with
  // the hint beside the buttons: its line under them came and went with the
  // hint, "Playing…", "games in." and Cancel, and the screen jumped 40px on
  // a press (walk 15 L1). The row is one height whatever it holds.
  const tabletRow = !inline;
  const rowCancel = showCancel && !progress.complete;
  return (
    <View style={[styles.controls, narrow && styles.controlsNarrow, inline && styles.controlsInline, tabletRow && styles.controlsTablet]}>
      {progress.complete ? null : (
        <View style={[styles.group, narrow && styles.groupNarrow]}>
          {advanceButtons}
        </View>
      )}
      {tabletRow && !progress.complete ? (
        <View style={styles.tabletHintSlot}>
          {hintText ? (
            <Text maxFontSizeMultiplier={1.3} nativeID={PRACTICE_HINT_ID} numberOfLines={2} style={styles.tabletHint}>
              {hintText}
            </Text>
          ) : null}
        </View>
      ) : null}
      <View
        onLayout={rowCancel ? undefined : (event) => setSecondaryWidth(Math.round(event.nativeEvent.layout.width))}
        style={[styles.group, styles.secondary, narrow && styles.secondaryNarrow, inline && styles.secondaryInline, rowCancel && secondaryWidth > 0 && { width: secondaryWidth }]}
      >
        {rowCancel ? cancelButton('row') : (
          <>
            {playToEndButton(!layout.wide)}
            {secondaryButtons()}
          </>
        )}
      </View>
      {busyAnnouncer}
    </View>
  );
}

/**
 * The practice bar, directly under the status row. The date, the day count and
 * last night's result live in the status row, so nothing here repeats them.
 * The thin rule along the bottom is the season's progress and the frame's
 * bottom edge. Outside practice this bar renders nothing: the status row
 * carries the one "Practice" entry instead.
 */
/** Its words, as the Market's list end says them. */
export const BACK_TO_CONTROLS_LABEL = 'Back to the practice controls';

/** Focus +1 night (More where the row folds it away or the season is over). */
function focusPracticeControls(): void {
  if (typeof document === 'undefined') return;
  const buttons = Array.from(document.querySelectorAll('[role="button"], button')) as HTMLElement[];
  const shown = (node: HTMLElement) => node.getClientRects().length > 0;
  const named = (pattern: RegExp) => buttons.find((node) => pattern.test(node.getAttribute('aria-label') ?? node.textContent ?? '') && shown(node));
  // At season end the way on: the frame's Play another season, or on a
  // phone's Roster, whose frame row goes, the result card's (walk 14 T1-04).
  const target = named(/^\+1\s*night/i) ?? named(/^More\b/) ?? named(/^Play another season/i) ?? named(/^New season/i);
  target?.focus();
  target?.scrollIntoView?.({ block: 'nearest' });
}

const BACK_LINK_HIDDEN = 'position:absolute;width:1px;height:1px;overflow:hidden;opacity:0;margin:0;padding:0;';

/**
 * "Back to the practice controls" as the last stop of every screen, as the
 * Market's list already ends: a keyboard player at the end of the Roster,
 * Results or Leaders reaches +1 night in one press instead of a Shift+Tab
 * through the whole screen (walk 13 T3-N1). Drawn only while focused, at the
 * foot of the screen. Web only; built on the page because the screens are
 * not this bar's to change. Not on the Market, whose list has its own.
 */
function useBackToControlsLink(): void {
  const screenName = useScreenName();
  const linkRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined' || !isMockActive()) return undefined;
    const screen = document.getElementById('app-screen');
    if (!screen) return undefined;
    const link = document.createElement('div');
    link.setAttribute('role', 'link');
    link.setAttribute('tabindex', '0');
    link.setAttribute('data-practice-back', '');
    link.textContent = BACK_TO_CONTROLS_LABEL;
    // Drawn over the foot of the screen, not in its flow: a link that took
    // room as it appeared shrank the screen under it, so the Leaders board
    // began to scroll, redrew its pane and the focus fell to the page.
    const shownStyle = [
      'position:absolute', 'left:12px', 'right:12px', 'bottom:8px', 'z-index:30',
      'display:flex', 'align-items:center', 'min-height:44px', 'box-sizing:border-box', 'margin:0',
      'padding:10px 14px', 'border-radius:8px', `border:2px solid ${colors.focus}`, `background:${colors.surfaceRaised}`,
      `color:${colors.text}`, `font-family:${fonts.body}`, 'font-size:15px', 'font-weight:700', 'cursor:pointer',
    ].join(';');
    // Moving an element takes its focus away: a screen drawn in while the
    // link has focus waits until focus leaves before the link goes last again.
    let keepLastOnBlur = false;
    const keepLast = () => {
      if (screen.lastElementChild === link) return;
      if (document.activeElement === link) {
        keepLastOnBlur = true;
        return;
      }
      screen.appendChild(link);
    };
    link.style.cssText = BACK_LINK_HIDDEN;
    const jump = (event: Event) => {
      event.preventDefault();
      focusPracticeControls();
    };
    link.addEventListener('focus', () => {
      link.style.cssText = shownStyle;
    });
    link.addEventListener('blur', () => {
      link.style.cssText = BACK_LINK_HIDDEN;
      if (keepLastOnBlur) {
        keepLastOnBlur = false;
        // After the focus has moved on.
        setTimeout(keepLast, 0);
      }
    });
    link.addEventListener('click', jump);
    link.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') jump(event);
    });
    screen.appendChild(link);
    linkRef.current = link;
    // A new screen drawn into the main region lands after it: keep it last.
    const observer = new MutationObserver(keepLast);
    observer.observe(screen, { childList: true });
    return () => {
      observer.disconnect();
      link.remove();
      linkRef.current = null;
    };
  }, []);
  useEffect(() => {
    const link = linkRef.current;
    if (!link) return;
    link.hidden = screenName === 'Market';
  }, [screenName]);
}

export function SimBar() {
  const { fontScale, height, width } = useWindowDimensions();
  const { bootstrap } = usePerGame();
  useSpacingFoldWatch();
  useBackToControlsLink();
  const spacingFolded = useSpacingFold();
  if (!bootstrap || !isMockActive()) return null;

  const layout = chromeLayout(width, fontScale);
  // Desktop and short windows carry the controls in the status row, so this
  // bar is just the frame's bottom edge there. The season's progress sits
  // beside "Day 16 of 174" in the status row, where the words label it.
  const inStatusRow = layout.merged || chromeFolded(height, width) || spacingFolded;

  return (
    <View nativeID="practice-bar" style={styles.bar}>
      {inStatusRow ? null : <PracticeControls />}
      <PracticeQuestionHost />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.chromeSoft,
    borderBottomColor: colors.borderStrong,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    // Enlarged text wraps onto a second row instead of truncating.
    flexWrap: 'wrap',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingBottom: 2,
  },
  controlsNarrow: {
    gap: 6,
    paddingHorizontal: space.md,
  },
  controlsInline: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    marginRight: space.sm,
  },
  group: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  groupNarrow: {
    gap: 6,
  },
  // Compact: +1 night and +1 week share the row with More, edge to edge.
  groupFill: {
    flexGrow: 1,
    flexBasis: '100%',
    gap: 6,
  },
  // Season end on a phone: the final place, then the way on at the row's end.
  seasonEndRow: {
    flexWrap: 'nowrap',
  },
  // In line with the status row's words above it.
  seasonEndStanding: {
    flexShrink: 1,
    minWidth: 0,
    marginLeft: 4,
  },
  seasonEndStandingText: {
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: type.caption,
    fontWeight: weight.bold,
    lineHeight: 16,
  },
  // Outlined buttons never touch (Exit beside Play another season).
  moreRow: {
    marginLeft: 'auto',
    gap: 4,
  },
  // More's menu floats over the screen, right-aligned under the button.
  menuScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  morePanel: {
    position: 'absolute',
    minWidth: 150,
    padding: space.xs,
    gap: 2,
    alignItems: 'stretch',
    backgroundColor: colors.background,
    // A clear 3:1 edge over whatever it covers (walk 14 T1-01).
    borderColor: colors.controlBorder,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  // Points at More from the panel's top edge (walk 14 T1-01).
  moreCaret: {
    position: 'absolute',
    top: -(MORE_CARET_SIZE / 2) - 1,
    width: MORE_CARET_SIZE,
    height: MORE_CARET_SIZE,
    backgroundColor: colors.background,
    borderColor: colors.controlBorder,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    transform: [{ rotate: '45deg' }],
    pointerEvents: 'none',
  },
  moreScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  moreItems: {
    gap: 2,
    alignItems: 'stretch',
  },
  // More's actions in the primary ink, with a hairline between Play to the
  // end and Restart: in Navy the quiet grey read as greyed out (walk 13 T1-06).
  menuItemText: {
    color: colors.text,
  },
  menuDivider: {
    height: 1,
    marginHorizontal: space.xs,
    backgroundColor: colors.border,
  },
  // The lock's words at the top of More in the tiniest row: not an item.
  // The words wrap beside the padlock ("Locked ·" over "Nov 1"), never under it.
  moreNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    columnGap: 4,
    paddingHorizontal: space.xs,
    paddingVertical: space.xs,
  },
  moreNoteIcon: {
    paddingTop: 2,
  },
  moreNoteText: {
    flexShrink: 1,
    color: colors.goldInk,
    fontFamily: fonts.display,
    fontSize: type.caption,
    fontWeight: weight.bold,
    lineHeight: 15,
  },
  // The practice hint atop More in the tiniest row, in the muted words the
  // hint line uses elsewhere.
  moreHint: {
    color: colors.muted,
    fontFamily: fonts.body,
    fontSize: type.caption,
    lineHeight: 15,
  },
  // The latest result under +1 night / +1 week in the tiniest row's More, in
  // full ink: it is the answer to the press. It wraps in the menu's width
  // rather than widening it (the buttons would move under the finger).
  moreResult: {
    flexShrink: 0,
    width: 0,
    minWidth: '100%',
    borderTopColor: colors.borderStrong,
    borderTopWidth: StyleSheet.hairlineWidth,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: type.caption,
    lineHeight: 15,
  },
  // Above the items (walk 18 T3-06): its edge under it, between it and them.
  moreResultTop: {
    borderTopWidth: 0,
    borderBottomColor: colors.borderStrong,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  morePanelFallback: {
    top: 48,
    right: space.xs,
  },
  // Folded (short window): the controls sit in the status row, edge to edge.
  foldedControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  // "Season complete" where +1 night and +1 week were: words, not a control.
  seasonDone: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: space.xs,
  },
  seasonDoneFixed: {
    minWidth: 184,
  },
  seasonDoneNext: {
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: type.caption,
    fontWeight: weight.bold,
    lineHeight: 16,
  },
  advanceFolded: {
    minWidth: 0,
    paddingHorizontal: space.xs,
  },
  advanceFill: {
    flexGrow: 1,
    flexBasis: 0,
  },
  foldedFill: {
    flexGrow: 1,
  },
  secondary: {
    marginLeft: 'auto',
    gap: 6,
  },
  secondaryNarrow: {
    gap: 4,
  },
  secondaryInline: {
    marginLeft: 0,
  },
  // A tonal gold: the practice clock is the bar's point, but it is not a trade,
  // so it does not take the solid gold the money actions use. Its edge is the
  // gold ink, 3:1 or more against the bar in every theme (the gold line was
  // 2.4-2.85:1, walk 3 T3-26).
  // +1 week keeps the width of its widest queued label ("+1 WEEK ×24
  // QUEUED"), so +1 night beside it never moves under the pointer when a
  // press queues (it moved 18px on a desktop).
  advanceWeekReserve: {
    minWidth: 104,
  },
  // +1 night beside More in a tiny row (400% zoom, 320x200): its own width,
  // "+1 NIGHT" over "OCT 21" (walk 14 T3-02).
  advanceTinyRow: {
    flexShrink: 0,
    minWidth: 84,
  },
  // "+1 WEEK" on one line in a stacked row (50px of words, 2px padding).
  advanceWeekOneLine: {
    minWidth: 58,
  },
  advance: {
    minWidth: 76,
    paddingHorizontal: space.md,
    backgroundColor: colors.goldSoft,
    borderColor: colors.goldInk,
    // Never dashed: dashed means locked, and these are how a lock ends. A
    // night playing shows in the words ("PLAYING…"; walk 9 T4-02).
    borderStyle: 'solid',
  },
  // A phone's row: each keeps the width its words at rest and "PLAYING…"
  // need, so the row never reflows while a week plays (walk 9 T4-08).
  advancePhone: {
    flexGrow: 0,
    flexShrink: 0,
    minWidth: 80,
    paddingHorizontal: 6,
  },
  phoneControls: {
    flexWrap: 'nowrap',
    paddingBottom: space.xs,
  },
  slot: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    minHeight: 44,
    justifyContent: 'center',
  },
  slotHint: {
    color: colors.muted,
    fontFamily: fonts.body,
    fontSize: type.caption,
    lineHeight: 15,
  },
  slotLock: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    columnGap: 4,
  },
  slotLockText: {
    flexShrink: 1,
    color: colors.goldInk,
    fontFamily: fonts.display,
    fontSize: type.caption,
    fontWeight: weight.bold,
    lineHeight: 15,
  },
  cancelSlot: {
    minWidth: 0,
    minHeight: 44,
    paddingHorizontal: 6,
  },
  // The button that is playing keeps its ink while it ignores taps.
  advancePlaying: {
    opacity: 1,
  },
  advanceNarrow: {
    minWidth: 0,
    paddingHorizontal: space.sm,
  },
  advanceCompact: {
    flexGrow: 1,
    flexBasis: 0,
    paddingHorizontal: 6,
  },
  // Stacked labels ("+1" over "WEEK") need little padding; the words keep
  // the width (a 195px row, walk 4 T3-11).
  advanceStacked: {
    paddingHorizontal: 2,
  },
  // "+1 NIGHT" over "OCT 21" in a stacked row: the night button takes the
  // larger share so its first line fits (54px of words at 195px).
  advanceDated: {
    flexGrow: 1.35,
  },
  advanceText: {
    color: colors.goldInk,
    textAlign: 'center',
  },
  // Nobody on the roster or shorts, whatever was answered before (walk 14
  // T1-06): no gold, and a muted solid 3:1 edge beside the line that says what to do
  // first (the plain border was 1.2-1.3:1, walk 3 T3-26). Not dashed: dashed
  // means "not available now, press to learn why" (LOCKED, FULL, a night
  // still playing), and these still play, after one question (walk 4 T2-03).
  advanceQuiet: {
    backgroundColor: 'transparent',
    borderColor: colors.controlBorder,
  },
  advanceTextQuiet: {
    color: colors.muted,
    textAlign: 'center',
  },
  // "PLAYING…" in a stacked row's narrow button (55px at 195px) ran over its
  // edge; while it plays the words set a size tighter.
  advanceTextBusyStacked: {
    fontSize: 10,
    letterSpacing: 0,
  },
  // A tablet's one row: the buttons, the hint between them, and a little air
  // above the screen (the 59px frame it had with nothing under the buttons).
  controlsTablet: {
    flexWrap: 'nowrap',
    paddingBottom: 14,
  },
  // The hint takes the room between +1 week and Play to the end, up to two
  // lines inside the buttons' 44px, so it never adds height.
  tabletHintSlot: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  tabletHint: {
    color: colors.muted,
    fontFamily: fonts.body,
    fontSize: type.caption,
    lineHeight: 16,
  },
  // The queue's line: Cancel queued, compact, where the hint line sits.
  hintRow: {
    flexBasis: '100%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  // 44px like the frame's other controls: on a touch tablet it is the one
  // control needed quickly, and it was the smallest at 32px (walk 14 T2-10).
  cancelLine: {
    minHeight: 44,
    paddingHorizontal: space.sm,
  },
  // A folded row: "CANCEL" over "3 QUEUED", before +1 night, one width
  // whatever the count (its right edge beside +1 night never moves).
  cancelFold: {
    minHeight: 44,
    minWidth: 84,
    paddingHorizontal: 6,
  },
  cancelFoldText: {
    textAlign: 'center',
  },
  // Desktop: Cancel fills the place of Play to the end and Restart.
  cancelRow: {
    flexGrow: 1,
    minHeight: 44,
  },
  // Centred, so a label that wraps (a narrow slot) never hugs the left edge.
  cancelLineText: {
    fontSize: type.caption,
    textAlign: 'center',
  },
  // "NOTHING QUEUED" keeps to the one line "CANCEL QUEUED" had (107px set
  // tight; 118px at the buttons' spacing wrapped in a 390px phone's slot).
  cancelNothingText: {
    letterSpacing: 0,
  },
  // The practice questions (PracticeChoices), drawn as ConfirmDialog is.
  questionLayer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  questionScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  questionLayerTight: {
    padding: space.xs,
  },
  questionScroll: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '100%',
    flexGrow: 0,
    flexShrink: 1,
  },
  questionScrollContent: {
    flexGrow: 0,
  },
  questionPanelTight: {
    gap: space.sm,
    padding: space.sm,
  },
  // Words wrap at spaces, never inside one, in the narrowest column.
  questionTitleTight: {
    fontSize: type.value,
  },
  questionPanel: {
    width: '100%',
    maxWidth: 420,
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  questionTitle: {
    ...headingStyle,
    letterSpacing: 0,
  },
  questionLines: {
    gap: space.md,
  },
  questionLine: {
    color: colors.text,
    fontSize: type.body,
    lineHeight: 19,
  },
  questionButtons: {
    gap: space.sm,
    marginTop: space.sm,
  },
  // Stacked on a phone: the way out on top, a recommended move last (questionAnswerOrder).
  questionButtonsStacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  // A row on a wide screen: the way out on the left, Tab left to right.
  questionButtonsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  // A quiet way out with a 3:1 control edge, so it reads as a button.
  questionNotNow: {
    borderColor: colors.controlBorder,
  },
  hint: {
    flexBasis: '100%',
    color: colors.muted,
    fontFamily: fonts.body,
    fontSize: type.caption,
    lineHeight: 16,
  },
  quiet: {
    paddingHorizontal: space.sm + 2,
  },
  // A quiet control in the row: the 3:1 control edge, no fill, so Play to
  // the end, Restart and Exit read as buttons of the same family as +1
  // night and +1 week, only quieter (walk 7 T1-01).
  quietEdge: {
    borderColor: colors.controlBorder,
  },
  // Outlined, the pair keeps to the row's one line down to 320px.
  quietNarrow: {
    paddingHorizontal: 6,
  },
  // "Play to" over "the end" in a phone's row, beside Restart.
  quietStacked: {
    minWidth: 0,
    paddingHorizontal: 6,
  },
  quietStackedText: {
    textAlign: 'center',
  },
});
