import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Modal, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import {
  advanceMockDays,
  advanceMockNights,
  isMockActive,
  mockSeasonStart,
} from '../api/mockPerGameClient';
import {
  CHROME_FOLDED_ONE_LINE_MIN_WIDTH,
  chromeFolded,
  chromeLayout,
  EMPTY_ROSTER_HINT,
  readyHint,
  practiceProgress,
  practiceQuestion,
  practiceSeasonEnd,
  practiceStakes,
} from '../data/chromeView';
import { humanDate } from '../copy/terms';
import { usePerGame } from '../state/PerGameContext';
import { openTab } from '../state/uiActions';
import { colors, fonts, radius, space, type } from '../theme';
import { Button, ConfirmDialog } from '../ui/kit';
import { useSheetHistory } from '../web/appHistory';
import { leavePractice, restartPractice } from '../web/practiceSession';
import { ChromeButton } from './chrome/ChromeButton';
import { MoreIcon } from './chrome/ChromeIcons';

/**
 * After a night or week has played, the advance buttons rest this long before
 * they take another press, so a double tap plays one night, not two.
 */
const ADVANCE_COOLDOWN_MS = 450;

// The settled date on which the roster was last seen empty. Every place that
// shows the practice hint (the line under the buttons on phones, the status
// row on desktop) reads this one record, so they say the same thing and a
// layout change that remounts the controls does not forget it.
let rosterEmptyOn: string | null = null;

/**
 * The practice hint beside +1 night / +1 week: "Add a player first…" while
 * the roster is empty, then "Ready. +1 night plays the Oct 21 games." from
 * the moment a player lands until the next night is played. The line keeps
 * its place through the first add (a line vanishing mid-tap would move the
 * list under the finger) and goes once the player advances.
 */
export function usePracticeHint(): string | null {
  const { bootstrap } = usePerGame();
  if (!bootstrap || !isMockActive()) return null;
  const settledOn = bootstrap.game.lastSettledDate ?? '';
  if (practiceProgress(mockSeasonStart(), bootstrap.game.lastSettledDate).complete) return null;
  if (!bootstrap.positions.some((position) => position.status === 'active')) {
    rosterEmptyOn = settledOn;
    return EMPTY_ROSTER_HINT;
  }
  return rosterEmptyOn === settledOn ? readyHint(bootstrap.game.nextGameDate) : null;
}

type Question = 'restart' | 'play-again' | 'exit' | 'empty-night' | 'empty-week';

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
type AskedQuestion = { kind: Question; fromMenu: boolean };
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

/** The practice question's dialog, drawn from SimBar so it outlives the controls. */
function PracticeQuestionHost() {
  const asked = useSyncExternalStore(subscribeQuestion, () => askedQuestion, () => null);
  const { bootstrap } = usePerGame();
  // Keep playing (or Escape, Back, a tap outside): the question closes and
  // focus returns to the control that asked it.
  const close = () => {
    const was = askedQuestion;
    setAskedQuestion(null);
    if (was) focusAsker(was);
  };
  useSheetHistory(asked !== null, close);
  if (!asked || !bootstrap) return null;
  const progress = practiceProgress(mockSeasonStart(), bootstrap.game.lastSettledDate);
  const open = bootstrap.positions.filter((position) => position.status === 'active');
  const stakes = practiceStakes({
    progress,
    players: open.filter((position) => position.side === 'long').length,
    shorts: open.filter((position) => position.side === 'short').length,
    score: bootstrap.account.cumulativePnl,
  });
  const prompt = practiceQuestion(
    asked.kind,
    stakes,
    bootstrap.game.nextGameDate ? humanDate(bootstrap.game.nextGameDate) : null,
  );
  // Start over / Play again / Leave practice / Play anyway: close the
  // question first, then act.
  const confirm = () => {
    const { kind } = asked;
    setAskedQuestion(null);
    if (kind === 'empty-night' || kind === 'empty-week') {
      focusAsker({ kind, fromMenu: false });
      advanceFromQuestion?.(kind === 'empty-night' ? 'night' : 'week');
      return;
    }
    afterDialogCloses(kind === 'exit' ? leavePractice : restartPractice);
  };
  const empty = asked.kind === 'empty-night' || asked.kind === 'empty-week';
  // "Open market": close the question, then take the player to the Market.
  const openMarket = () => {
    setAskedQuestion(null);
    afterDialogCloses(() => openTab('market'));
  };
  return (
    <ConfirmDialog
      cancelLabel={prompt.cancelLabel}
      confirmLabel={prompt.confirmLabel}
      confirmTone={empty ? 'neutral' : 'danger'}
      lines={prompt.lines}
      onCancel={empty ? openMarket : close}
      onConfirm={confirm}
      onDismiss={close}
      title={prompt.title}
      visible
    />
  );
}

/** The More menu's panel (its DOM id on the web). */
const MORE_PANEL_ID = 'practice-more';

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
function MoreMenu({ open, setOpen, buttonRef, children }: {
  open: boolean;
  setOpen: (open: boolean) => void;
  buttonRef: { current: View | null };
  children: ReactNode;
}) {
  const { width, height } = useWindowDimensions();
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
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
    if (box) setAnchor({ top: box.bottom + 2, right: Math.max(width - box.right, 2) });
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
        icon={(color) => <MoreIcon color={color} />}
        label="More"
        onPress={() => setOpen(!open)}
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
            onResponderRelease={() => setOpen(false)}
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
            <ScrollView contentContainerStyle={styles.moreItems} style={styles.moreScroll}>
              {children}
            </ScrollView>
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
export function PracticeControls({ inline = false, folded = false, tiny = false, onRules, onSettings }: {
  inline?: boolean;
  /** The short-window row: +1 night, +1 week and More (Rules, Restart, Exit). */
  folded?: boolean;
  /** A folded row at 400% zoom: More alone, holding every control (walk 2 T3-11). */
  tiny?: boolean;
  /** Opens the rules; folded rows list Rules under More. */
  onRules?: () => void;
  /** Opens Settings; tiny rows list it under More. */
  onSettings?: () => void;
}) {
  const { fontScale, width } = useWindowDimensions();
  const {
    bootstrap,
    isGameplayReady,
    isRefreshing,
    pendingActions,
    refreshData,
  } = usePerGame();
  const [moreOpen, setMoreOpen] = useState(false);
  // What is playing right now, for the busy label: the night's date as it
  // was when the press landed ("Playing Oct 21…"), or the week.
  const [playing, setPlaying] = useState<{ step: 'night' | 'week'; date: string | null } | null>(null);
  const advancing = playing !== null;
  // State updates land a render later; a second tap in the same frame still
  // sees the old props. The ref closes the door synchronously, and stays
  // closed for a short rest after each advance (a double tap plays once).
  const advancingRef = useRef(false);
  const readyAtRef = useRef(0);
  const advancedRef = useRef(false);
  const restartRef = useRef<View>(null);
  const exitRef = useRef<View>(null);
  const nightRef = useRef<View>(null);
  const weekRef = useRef<View>(null);
  const moreRef = useRef<View>(null);
  // "Play anyway" in the shared question plays through this set of controls.
  const advanceRef = useRef<((step: 'night' | 'week') => void) | null>(null);
  useEffect(() => {
    const run = (step: 'night' | 'week') => advanceRef.current?.(step);
    advanceFromQuestion = run;
    return () => {
      if (advanceFromQuestion === run) advanceFromQuestion = null;
    };
  }, []);
  const complete = practiceProgress(mockSeasonStart(), bootstrap?.game.lastSettledDate ?? null).complete;
  const hintText = usePracticeHint();

  // Restart or Exit asks first (SimBar draws the question). An item in More
  // closes the menu and lets its history entry go before the question adds
  // its own, so Back and the entries stay in step.
  const askQuestion = (kind: Question) => {
    // Nothing to lose yet (the opening eve, no moves): Restart just restarts
    // and Exit just leaves, as a reload does without a warning.
    if ((kind === 'restart' || kind === 'exit') && bootstrap
      && practiceProgress(mockSeasonStart(), bootstrap.game.lastSettledDate).day === 0
      && bootstrap.ledger.items.length === 0) {
      if (kind === 'restart') restartPractice();
      else leavePractice();
      return;
    }
    if (!moreOpen) {
      setAskedQuestion({ kind, fromMenu: false });
      return;
    }
    setMoreOpen(false);
    afterDialogCloses(() => setAskedQuestion({ kind, fromMenu: true }));
  };
  // The last night is in: the advance buttons have nothing left to play, so
  // focus moves to Restart rather than falling to the page.
  useEffect(() => {
    if (!complete || !advancedRef.current) return;
    advancedRef.current = false;
    focusLater(restartRef, 150);
  }, [complete]);
  if (!bootstrap || !isMockActive() || typeof window === 'undefined') return null;

  const layout = chromeLayout(width, fontScale);
  const compact = layout.compact && !inline;
  const narrow = layout.narrow && !inline;
  const disabled = !isGameplayReady || isRefreshing || pendingActions.size > 0;
  const progress = practiceProgress(mockSeasonStart(), bootstrap.game.lastSettledDate);
  // While a night plays the buttons go quiet but keep their Tab stop and
  // focus (aria-disabled), so Enter can play the next night once it is in.
  const advanceBusy = disabled || advancing;

  const open = bootstrap.positions.filter((position) => position.status === 'active');
  // Nothing to play for yet: +1 night / +1 week stay quiet (the first move is
  // adding a player) and a line under them says what they do.
  const emptyRoster = open.length === 0 && !progress.complete;
  const hint = hintText && !inline && !folded ? (
    <Text maxFontSizeMultiplier={1.5} style={styles.hint}>{hintText}</Text>
  ) : null;

  // One night (or week) per tap, and never a second one before the screen has
  // caught up with the first: the client and the screen stay on the same day.
  const advance = async (step: 'night' | 'week') => {
    if (advancingRef.current || Date.now() < readyAtRef.current) return;
    advancingRef.current = true;
    advancedRef.current = true;
    setPlaying({ step, date: step === 'night' ? nightDate : null });
    try {
      if (step === 'week') playPracticeWeek();
      else playPracticeNight(bootstrap.game.lastSettledDate, practiceSeasonEnd(mockSeasonStart()));
      for (let attempt = 0; attempt < ADVANCE_REFRESH_ATTEMPTS; attempt += 1) {
        if (await refreshData()) break;
        await wait(ADVANCE_RETRY_MS);
      }
    } finally {
      readyAtRef.current = Date.now() + ADVANCE_COOLDOWN_MS;
      advancingRef.current = false;
      setTimeout(() => setPlaying(null), ADVANCE_COOLDOWN_MS);
    }
  };
  advanceRef.current = (step) => {
    void advance(step);
  };

  const stackLabels = (compact || folded) && width < STACKED_LABEL_MAX_WIDTH;
  // +1 night names the game night it plays ("Oct 25"), so a day without
  // games that it skips is no surprise.
  const nightDate = !progress.complete && bootstrap.game.nextGameDate
    ? humanDate(bootstrap.game.nextGameDate)
    : null;
  // Folded and narrow: the controls get their own line and share it evenly.
  const foldFill = folded && width < CHROME_FOLDED_ONE_LINE_MIN_WIDTH;
  // While a night (or week) plays, the pressed button says so and keeps its
  // full ink, so extra taps are visibly ignored rather than silently dropped
  // (walk 2 T4-07); the other one dims.
  const playingNight = playing?.step === 'night';
  const playingWeek = playing?.step === 'week';
  const playingNightText = playing?.date ? `Playing ${playing.date}…` : 'Playing…';
  const nightLabel = playingNight
    ? (stackLabels || !playing?.date ? 'Playing…' : `Playing\n${playing.date}…`)
    : stackLabels ? '+1\nnight' : nightDate ? `+1 night\n${nightDate}` : '+1 night';
  const nightName = playingNight
    ? `+1 night: advance one night. ${playingNightText}`
    : nightDate ? `+1 night: advance one night, to the ${nightDate} games` : '+1 night: advance one night';
  const advanceButtons = (
    <>
      <Button
        ref={nightRef}
        accessibilityLabel={nightName}
        disabled={advanceBusy || progress.complete}
        focusableWhenDisabled={!progress.complete}
        label={nightLabel}
        onPress={() => {
          if (emptyRoster) askQuestion('empty-night');
          else void advance('night');
        }}
        style={[styles.advance, narrow && styles.advanceNarrow, compact && styles.advanceCompact, folded && styles.advanceFolded, foldFill && styles.advanceFill, emptyRoster && styles.advanceQuiet, playingNight && styles.advancePlaying]}
        textStyle={emptyRoster ? styles.advanceTextQuiet : styles.advanceText}
        variant="secondary"
      />
      <Button
        ref={weekRef}
        accessibilityLabel={playingWeek ? '+1 week: advance one week. Playing the week…' : '+1 week: advance one week'}
        disabled={advanceBusy || progress.complete}
        focusableWhenDisabled={!progress.complete}
        label={playingWeek ? 'Playing…' : stackLabels ? '+1\nweek' : '+1 week'}
        onPress={() => {
          if (emptyRoster) askQuestion('empty-week');
          else void advance('week');
        }}
        style={[styles.advance, narrow && styles.advanceNarrow, compact && styles.advanceCompact, folded && styles.advanceFolded, foldFill && styles.advanceFill, emptyRoster && styles.advanceQuiet, playingWeek && styles.advancePlaying]}
        textStyle={emptyRoster ? styles.advanceTextQuiet : styles.advanceText}
        variant="secondary"
      />
    </>
  );
  const secondaryButtons = (
    <>
      {/* Both lose the whole season, so both ask first (ConfirmDialog says
          what would be lost). Start over reloads into a fresh season, which
          restarts the in-memory client and its provider together. */}
      {/* Once the season is complete, Restart is the way on: "Play again",
          the action the status row and the result card call "Play another
          season" (walk 2 T2-17). Its name keeps "restart" for anyone looking. */}
      <Button
        ref={restartRef}
        accessibilityLabel={progress.complete ? 'Play another season: restart practice' : 'Restart practice'}
        // One name for the way on at season end, as the card and status row
        // say it (walk 3 T1-11, T4-04).
        label={progress.complete ? 'Play another season' : 'Restart'}
        onPress={() => askQuestion(progress.complete ? 'play-again' : 'restart')}
        style={[styles.quiet, narrow && styles.quietNarrow]}
        variant="quiet"
      />
      <Button
        ref={exitRef}
        accessibilityLabel="Exit practice"
        label="Exit"
        onPress={() => askQuestion('exit')}
        style={[styles.quiet, narrow && styles.quietNarrow]}
        variant="quiet"
      />
    </>
  );

  // At the end of the season there is nothing left to advance (the status
  // row says "Season complete"), so Restart and Exit take the row themselves.
  if (compact && progress.complete && !(folded && tiny)) {
    return (
      <View style={[styles.controls, styles.controlsNarrow]}>
        <View style={[styles.group, styles.moreRow]}>
          {secondaryButtons}
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
        variant="quiet"
      />
    ) : null;
    return (
      <View style={styles.foldedControls}>
        <MoreMenu buttonRef={moreRef} open={moreOpen} setOpen={setMoreOpen}>
          {progress.complete ? null : advanceButtons}
          {rulesItem}
          {secondaryButtons}
          {settingsItem}
        </MoreMenu>
      </View>
    );
  }

  // A short window: one row with +1 night and +1 week (Restart and Exit once
  // the season is over), then More. The status row adds the day and Settings.
  if (folded) {
    return (
      <View style={[styles.foldedControls, foldFill && styles.foldedFill]}>
        {progress.complete ? secondaryButtons : advanceButtons}
        {menu(progress.complete ? rulesItem : <>{rulesItem}{secondaryButtons}</>)}
      </View>
    );
  }

  if (compact) {
    return (
      <View style={[styles.controls, styles.controlsNarrow]}>
        <View style={[styles.group, styles.groupFill]}>
          {/* Nothing left to play at season end: no dimmed advance buttons. */}
          {progress.complete ? secondaryButtons : (
            <>
              {advanceButtons}
              {menu(secondaryButtons)}
            </>
          )}
        </View>
        {hint}
      </View>
    );
  }

  return (
    <View style={[styles.controls, narrow && styles.controlsNarrow, inline && styles.controlsInline]}>
      {progress.complete ? null : (
        <View style={[styles.group, narrow && styles.groupNarrow]}>
          {advanceButtons}
        </View>
      )}
      <View style={[styles.group, styles.secondary, inline && styles.secondaryInline]}>
        {secondaryButtons}
      </View>
      {hint}
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
export function SimBar() {
  const { fontScale, height, width } = useWindowDimensions();
  const { bootstrap } = usePerGame();
  if (!bootstrap || !isMockActive()) return null;

  const layout = chromeLayout(width, fontScale);
  // Desktop and short windows carry the controls in the status row, so this
  // bar is just the frame's bottom edge there. The season's progress sits
  // beside "Day 16 of 174" in the status row, where the words label it.
  const inStatusRow = layout.merged || chromeFolded(height);

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
  moreRow: {
    marginLeft: 'auto',
    gap: 0,
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
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  moreScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  moreItems: {
    gap: 2,
    alignItems: 'stretch',
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
    gap: 0,
  },
  secondaryInline: {
    marginLeft: 0,
  },
  // A tonal gold: the practice clock is the bar's point, but it is not a trade,
  // so it does not take the solid gold the money actions use.
  advance: {
    minWidth: 76,
    paddingHorizontal: space.md,
    backgroundColor: colors.goldSoft,
    borderColor: colors.goldLine,
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
  advanceText: {
    color: colors.goldInk,
    textAlign: 'center',
  },
  // Empty roster: neutral outline, no gold, until there is a player to play.
  advanceQuiet: {
    backgroundColor: 'transparent',
    borderColor: colors.border,
  },
  advanceTextQuiet: {
    color: colors.muted,
    textAlign: 'center',
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
  quietNarrow: {
    paddingHorizontal: space.sm,
  },
});
