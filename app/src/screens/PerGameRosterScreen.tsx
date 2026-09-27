import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type ViewStyle,
} from 'react-native';

import type { PerGamePosition } from '../api/contracts';
import { isMockActive, mockPlayerTrends, mockSeasonStart } from '../api/mockPerGameClient';
import { PerGamePnlChart } from '../components/PerGamePnlChart';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { PlayerProfileSheet } from '../components/PlayerProfileSheet';
import { ClosedSection, FeesLine } from '../components/roster/ClosedSection';
import { FullSideNote } from '../components/roster/FullSideNote';
import {
  FigureLegend,
  ListFigures,
  StackedFigures,
  TableFigures,
  TableGhostRow,
  TableHeader,
} from '../components/roster/RowFigures';
import { ScoreHeader } from '../components/roster/ScoreHeader';
import { FirstNightTip, SeasonCompleteCard, SeasonSoFar, WelcomeCard } from '../components/roster/SeasonCards';
import { SectionHead } from '../components/roster/SectionHead';
import { useHoldInView } from '../components/roster/useHoldInView';
import { useRecentAdvances } from '../components/SimBar';
import {
  closeActionName,
  closeVerb,
  confirmCloseButton,
  exactMoney,
  moneyCompact,
  perGame,
  ROSTER_EXPLAINER,
  confirmCloseName,
  lockNotice,
  rosterReopensLine,
  seasonResultLine,
  SHORT_EXPLAINER,
  sideHeading,
  signedMoney,
  unbrokenName,
} from '../copy/terms';
import { chromeFolded, keepTogether, practiceProgress, resultSpan } from '../data/chromeView';
import { isSeasonOver, waitingActionName } from '../data/marketView';
import { earningsBetween, scoreBreakdown, seasonSummary } from '../data/perGameMetrics';
import {
  againRows,
  breakdownParts,
  chartAfterLists,
  closedRows,
  closeQuestion,
  compactActionBeside,
  earnLine,
  feeMoves,
  figureCaptions,
  formatAt,
  movesLine,
  oneGameFigure,
  perGamePrecision,
  pickValue,
  pressLine,
  rankLine,
  rosterRowView,
  rowLayout,
  shortEndsNext,
  shortsQuiet,
  slotLine,
  splitParts,
  sectionExact,
  tipReading,
  tipRetired,
  belowZeroNote,
  backLines,
  SHORTS_LATER,
  type ClosedRow,
  type RowLayout,
} from '../data/rosterView';
import { usePerGame } from '../state/PerGameContext';
import { practicePlaying, usePracticePlaying } from '../state/practicePlaying';
import { openRules, openTab, takeRosterPick } from '../state/uiActions';
import { colors, control, fonts, radius, space, type, weight } from '../theme';
import { Button, ConfirmStrip, EmptyState, headingLevel, repeatSafe, Tag, tapsSettling, useAriaDisabled, visuallyHidden } from '../ui/kit';
import { pastSeasonCount, restartPractice } from '../web/practiceSession';

/** Desktop: score and chart beside the lists. */
const WIDE_MIN_WIDTH = 1024;
/** The score column; narrower on small laptops so the table keeps room for names. */
const summaryWidth = (width: number) => (width >= 1200 ? 360 : 320);
const ACTION_WIDTH = 72;
/** The table's columns while the season runs: Player, the four figures, Drop or Close. */
const TABLE_COLUMN_COUNT = 6;
/** A second press on Drop this soon after it opened the confirm is a double tap: ignored. */
const DOUBLE_TAP_MS = 400;
/** A pinned section title lets go this far before its section ends: about one row (`stickyScope`). */
const STICKY_RELEASE = 60;
/** Phone lists narrower than this leave out Profit a game (see `StackedFigures`). */
const NARROW_LIST_MAX_WIDTH = 380;

const WELCOME_HIDDEN_KEY = 'nba-stock-market:welcome-hidden';
/** A list's rows as its exact line names them, each by the Total it shows (walk 16 T1-05). */
function sectionFigures(positions: readonly PerGamePosition[]) {
  return positions.map((position) => ({ name: position.playerName, value: position.cumulativePnl }));
}

const TIP_DONE_KEY = 'nba-stock-market:first-night-tip-done';

/** A flag kept for this tab's visit (web sessionStorage); false when storage is unavailable. */
function visitFlag(key: string): boolean {
  try {
    return Platform.OS === 'web' && window.sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function setVisitFlag(key: string): void {
  try {
    if (Platform.OS === 'web') window.sessionStorage.setItem(key, '1');
  } catch {}
}

/**
 * The welcome stays hidden for the rest of this visit once the player closes
 * it (walk 6 T1-07): Restart and "Play another season" load a new page, so
 * the choice is kept in the tab's session, like the seasons list.
 */
let welcomeHidden = visitFlag(WELCOME_HIDDEN_KEY);

/**
 * The first-night tip (walk 5 T1-N4): whether it is done for this visit
 * (hidden with ×, its Results used, or the season's first week of game
 * nights over; walk 6 T1-17). Kept for the visit like the welcome, so a new
 * season does not bring it back.
 */
const firstNightTip: { done: boolean } = { done: visitFlag(TIP_DONE_KEY) };

function retireFirstNightTip(): void {
  firstNightTip.done = true;
  setVisitFlag(TIP_DONE_KEY);
}

type FocusTarget = {
  focus?: (options?: { preventScroll?: boolean }) => void;
  setAttribute?: (name: string, value: string) => void;
  hasAttribute?: (name: string) => boolean;
};

/**
 * Move keyboard focus to a rendered element (web). A heading gets
 * tabindex="-1" first, so it can hold focus without becoming a Tab stop.
 */
function focusElement(node: unknown, options?: { preventScroll?: boolean }) {
  const element = node as FocusTarget | null | undefined;
  if (!element?.focus) return;
  if (element.hasAttribute && element.setAttribute && !element.hasAttribute('tabindex')) {
    element.setAttribute('tabindex', '-1');
  }
  element.focus(options);
}

/**
 * Web: the browser brings a focused control into view below this much of the
 * list's top, so a row reached by Shift+Tab lands under the pinned title and
 * legend instead of behind them (walk 3 T3-27). The Drop button sits `space.sm`
 * below its row's top edge, so that much more keeps the whole row, name
 * included, in view.
 */
function keepFocusClear(pinnedHeight: number): ViewStyle | null {
  if (Platform.OS !== 'web' || pinnedHeight <= 0) return null;
  return { scrollPaddingTop: pinnedHeight + space.sm } as unknown as ViewStyle;
}

type ConfirmOutcome = 'kept' | 'closed';

/**
 * Web, table rows: whether a name needs the next size down to fit its one
 * line, measured (a user's text spacing or a late font changes the answer),
 * and re-measured when the column's width changes.
 */
function useTableNameFit(table: boolean, name: string) {
  const ref = useRef<Text>(null);
  const [small, setSmall] = useState(false);
  useLayoutEffect(() => {
    if (!table || Platform.OS !== 'web' || typeof ResizeObserver === 'undefined') {
      setSmall(false);
      return undefined;
    }
    const node = ref.current as unknown as HTMLElement | null;
    if (!node) return undefined;
    const measure = () => {
      // Fractional: a name 0.4px too long already ends in "…".
      const room = node.getBoundingClientRect().width;
      if (!(room > 0) || !node.parentElement) return;
      // The name's own width at full size, whatever it is drawn at now: an
      // ellipsis hides the overflow from scrollWidth, so an unseen copy on
      // one line is measured instead (it takes the user's text spacing too).
      const probe = node.cloneNode(true) as HTMLElement;
      Object.assign(probe.style, {
        position: 'absolute',
        visibility: 'hidden',
        width: 'max-content',
        maxWidth: 'none',
        overflow: 'visible',
        whiteSpace: 'nowrap',
        fontSize: `${type.value}px`,
      });
      node.parentElement.appendChild(probe);
      const full = probe.getBoundingClientRect().width;
      probe.remove();
      setSmall(full > room + 0.01);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, [name, table]);
  return { ref, small };
}

function PositionRow({
  position,
  layout,
  narrow,
  actionBeside = false,
  seasonOver,
  onOpenProfile,
  confirming,
  onConfirmOpen,
  onConfirmClose,
  actionRef,
  profileRef,
  holdRef,
  marketPrice,
}: {
  position: PerGamePosition;
  layout: RowLayout;
  /** A phone list under 380 CSS px: three figures instead of four. */
  narrow: boolean;
  /** A compact row's Drop beside the name and tag line (`compactActionBeside`, walk 16 T4-05). */
  actionBeside?: boolean;
  seasonOver: boolean;
  onOpenProfile: (playerId: string) => void;
  /** This row's Drop/Close question is open. */
  confirming: boolean;
  onConfirmOpen: (position: PerGamePosition) => void;
  onConfirmClose: (position: PerGamePosition, outcome: ConfirmOutcome) => void;
  actionRef: (node: View | null) => void;
  /** The row's name button, where focus lands after a move adds him (walk 6 T2-06, T3-03). */
  profileRef: (node: View | null) => void;
  /** His price a game in the market today, when he is listed. */
  marketPrice: number | null;
  /** The row's outer view, held in view while its question is open (walk 14 T4-05). */
  holdRef?: (node: unknown) => void;
}) {
  const { bootstrap, lockedPress, notify, pendingActions } = usePerGame();
  const nameFit = useTableNameFit(layout === 'table', position.playerName);
  const actionKey = `position:${position.side}:${position.playerId}`;
  // A move waiting its turn counts as this row's; another row's move does
  // not rest this one (its press would wait its turn; walk 5 T4-01).
  const pending = pendingActions.has(actionKey) || pendingActions.has(`queued:${actionKey}`);
  // A Drop or Close confirmed while games play waits for them (he plays
  // them, then goes): the button says "Waiting" and names those games, as the
  // Market's does ("Waiting for the Oct 21–27 games to drop Luka Doncic"),
  // never "Dropping" as if it were under way (walk 15 lead note). The games
  // are the ones playing when it was confirmed. Once they are in, it is only
  // saving (the spinner) until the row leaves.
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  const playingNow = usePracticePlaying();
  useEffect(() => {
    if (!pending) setWaitingFor(null);
  }, [pending]);
  const waitingName = pending && waitingFor !== null && playingNow !== null
    ? waitingActionName(position.side, position.playerName, waitingFor, 'close')
    : null;
  const rosterLocked = bootstrap?.ruleset.rosterMutationsLocked ?? true;
  const rosterLockDate = bootstrap?.ruleset.rosterLockGameDate ?? null;
  const nextGameDate = bootstrap?.game.nextGameDate ?? null;
  const rosterLockHint = `${rosterReopensLine(rosterLockDate)}.`;
  const disabled = pending || rosterLocked;
  // The button stays enabled for the browser, so a tap on LOCKED or on a
  // pending Drop is caught here instead of falling through to the row (which
  // would open the profile); its disabled state is written for assistive tech.
  const ownAction = useRef<View | null>(null);
  useAriaDisabled(ownAction, disabled);
  const setActionRef = useCallback((node: View | null) => {
    ownAction.current = node;
    actionRef(node);
  }, [actionRef]);
  // When this row's question last opened (see onActionPress).
  const openedAt = useRef(0);
  useEffect(() => {
    if (confirming && Date.now() - openedAt.current >= DOUBLE_TAP_MS) openedAt.current = Date.now();
  }, [confirming]);
  // A lock that begins while the question is open would refuse its answer.
  useEffect(() => {
    if (confirming && rosterLocked) onConfirmClose(position, 'kept');
  }, [confirming, onConfirmClose, position, rosterLocked]);

  const settled = bootstrap?.settledResults;
  const view = useMemo(
    // At season end the tags read in the past tense (walk 6 T1-10c).
    () => rosterRowView(position, settled ?? [], nextGameDate, seasonOver),
    [nextGameDate, position, seasonOver, settled],
  );
  const short = position.side === 'short';
  const verb = closeVerb(position.side);
  const fee = bootstrap?.ruleset.transactionFeeDollars ?? 0;
  const actionName = closeActionName(position.side, position.playerName);
  const endsNext = shortEndsNext(position, nextGameDate);
  const priceMoved = marketPrice !== null && Math.round(marketPrice) !== Math.round(position.lockedGameCost);
  const belowZero = belowZeroNote(position.side, view.summary);

  // Screen readers hear the whole row in one breath, lifetime totals included.
  // What a listener needs to compare rows, in the order they decide: who, how
  // he is doing, then the row's figures, and the season's sums last (a row
  // used to read ~40 words, with the sums in the middle; walk 3 lead check).
  const profileLabel = [
    position.playerName,
    view.tag.label,
    // The tag already says "No games yet" when he has none.
    view.games || null,
    `total ${signedMoney(position.cumulativePnl)}`,
    // A per-game figure that is the total's money is heard as the total (walk 15 T1-04).
    view.summary.avgNet === null ? null : `profit ${formatAt(view.summary.avgNet, perGamePrecision(view.summary.avgNet, position.cumulativePnl), true)} a game`,
    `${short ? 'credited' : 'price'} ${formatAt(position.lockedGameCost, perGamePrecision(position.lockedGameCost, position.cumulativePnl), false)} a game${priceMoved ? `, now ${moneyCompact(marketPrice as number)}` : ''}`,
    view.summary.avgDividend === null ? null : `dividend ${formatAt(view.summary.avgDividend, perGamePrecision(view.summary.avgDividend, position.cumulativePnl), false)} a game`,
    belowZero ? belowZero.replace(/\.$/, '') : null,
    view.expiry ? view.expiry.replace(/ · /g, ', ') : null,
    // The season's sums, last and short: what the total is made of.
    view.summary.games === 0 ? null : short
      ? `season ${moneyCompact(position.cumulativeGameCost)} credited, ${moneyCompact(position.cumulativeDividend)} paid out`
      : `season ${moneyCompact(position.cumulativeDividend)} in dividends, ${moneyCompact(position.cumulativeGameCost)} in prices`,
    'View profile',
  ].filter(Boolean).join(', ');

  const identity = (
    <View style={styles.identity}>
      {/* A table row keeps every name on one line, as tall as the rest (walk
          7 T4-10): a long name first steps down one size, so "Shai
          Gilgeous-Alexander" still reads in full at 1024px (walk 3 T2-15);
          only a name that fits at neither size ends in an ellipsis (the row's
          spoken name and the profile carry it whole). Phones wrap it. */}
      <Text
        ref={nameFit.ref}
        numberOfLines={layout === 'table' ? 1 : undefined}
        style={[styles.name, nameFit.small && styles.nameSmall]}
      >
        {unbrokenName(position.playerName)}
      </Text>
      <View style={styles.meta}>
        <Tag tone={view.tag.tone}>{view.tag.label}</Tag>
        {view.games ? <Text style={styles.metaText}>{keepTogether(view.games)}</Text> : null}
        {view.expiry && !endsNext ? <Text style={styles.metaText}>{keepTogether(view.expiry)}</Text> : null}
      </View>
      {/* In its last games a short says so in one sentence, on its own line
          so it never splits beside the tag. */}
      {view.expiry && endsNext ? <Text style={[styles.metaText, styles.metaEnds, styles.endsLine]}>{view.expiry}</Text> : null}
      {/* A below-zero dividend, explained where it shows (walk 8 T1-01). */}
      {belowZero ? <Text style={[styles.metaText, styles.endsLine]}>{belowZero}</Text> : null}
    </View>
  );
  const figures = {
    side: position.side,
    price: position.lockedGameCost,
    dividend: view.summary.avgDividend,
    net: view.summary.avgNet,
    total: position.cumulativePnl,
    now: marketPrice,
  };
  const onActionPress = () => {
    if (tapsSettling()) return;
    // LOCKED answers a tap with why and when (a silent button teaches nothing);
    // a Drop pressed as the games brought the lock is named with the games'
    // notice (walk 12 T4-07).
    if (rosterLocked) {
      lockedPress({ name: position.playerName, verb: position.side === 'long' ? 'dropped' : 'closed' });
      return;
    }
    // A tap on Waiting says what it waits for (as on the Market).
    if (waitingName) {
      notify(`${waitingName}.`);
      return;
    }
    if (disabled) return;
    if (!confirming) {
      // Stamped here, in the press itself: a second tap handled before the
      // effect above has run would otherwise read the stamp of an older
      // question and fold this one (walk 4 T1-05).
      openedAt.current = Date.now();
      onConfirmOpen(position);
      return;
    }
    // A double tap's second press lands here: it must not close the
    // question the first press just opened.
    if (Date.now() - openedAt.current < DOUBLE_TAP_MS) return;
    onConfirmClose(position, 'kept');
  };
  // At season end there is nothing left to do with a row, so no button.
  const action = seasonOver ? null : (
    <Pressable
      ref={setActionRef}
      accessibilityHint={rosterLocked ? rosterLockHint : undefined}
      // react-native-web drops accessibilityHint, so the name carries the reason.
      accessibilityLabel={rosterLocked
        ? `${actionName}: locked. ${rosterLockHint}`
        : waitingName ?? (pending ? (short ? `Closing your short on ${position.playerName}` : `Dropping ${position.playerName}`)
          : actionName)}
      accessibilityRole="button"
      // A locked button stays in the Tab order (aria-disabled only), so a
      // keyboard or screen-reader user reaches it and hears why.
      accessibilityState={{ disabled }}
      aria-expanded={confirming}
      onPress={onActionPress}
      style={({ pressed }) => [
        styles.action,
        confirming && styles.actionArmed,
        // LOCKED is read and pressed for its reason: full-contrast words and a
        // dashed edge, not a faded button (walk 3 T3-16).
        // Waiting is read, not faded: it says what the move waits for.
        rosterLocked ? styles.actionLocked : waitingName ? null : disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {pending && !rosterLocked && !waitingName ? (
        <ActivityIndicator color={colors.muted} size="small" />
      ) : (
        <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={[styles.actionText, confirming && styles.actionTextArmed, waitingName !== null && styles.actionTextWaiting]}>
          {rosterLocked ? 'LOCKED' : waitingName ? 'WAITING' : verb.toUpperCase()}
        </Text>
      )}
    </Pressable>
  );
  // The question opens under the row, never on the button itself: the
  // costly answer sits away from where Drop was, Keep takes focus, and
  // Escape or Keep backs out. Nothing times out while you read it.
  const strip = confirming ? (
    <ConfirmStrip
      confirmAccessibilityLabel={confirmCloseName(position.side, position.playerName, fee)}
      confirmLabel={confirmCloseButton(position.side, fee)}
      message={closeQuestion({
        side: position.side,
        playerName: position.playerName,
        feeDollars: fee,
        total: position.cumulativePnl,
        // Left alone a short ends by itself on its last day, at no cost: the
        // question says so whenever it is asked (walk 3 T1-N3).
        endsFreeAfter: position.expiresOn,
        // The comeback price as the Closed row will show it right after
        // (walk 11 T1-05).
        priceNow: marketPrice,
        dropImpactBps: bootstrap?.ruleset.quoteDropImpactBps ?? 0,
      })}
      onCancel={() => onConfirmClose(position, 'kept')}
      onConfirm={() => {
        setWaitingFor(practicePlaying());
        onConfirmClose(position, 'closed');
      }}
      style={styles.strip}
    />
  ) : null;
  const profileProps = {
    ref: profileRef,
    accessibilityLabel: profileLabel,
    accessibilityRole: 'button' as const,
    onPress: () => {
      if (tapsSettling()) return;
      onOpenProfile(position.playerId);
    },
  };

  if (layout === 'table') {
    // A table row to screen readers (walk 8 T3-09): the name is the profile
    // button in the Player cell, each figure a cell under its column header,
    // Drop in the last cell. A mouse or a finger still opens the profile from
    // anywhere on the row; keyboards and screen readers use the name.
    // The name keeps the verdict and the total, so a Tab alone still says how
    // he is doing; the cells carry every figure under its header.
    // The row header says what its cell shows; the total is its own column,
    // read there (walk 9 T3-02, as the Market's row header).
    const tableName = [
      position.playerName,
      view.tag.label,
      view.games || null,
      view.expiry ? view.expiry.replace(/ · /g, ', ') : null,
      belowZero ? belowZero.replace(/\.$/, '') : null,
      'View profile',
    ].filter(Boolean).join(', ');
    // The row header's own short name, the player and how he is doing, which
    // a screen reader repeats before each figure as you move along the row
    // or down a column; "View profile" and the rest stay on the name button
    // inside it (walk 13 T3-03).
    const headerName = `${position.playerName}, ${view.tag.label}`;
    return (
      <View ref={holdRef as never} style={styles.tableItem}>
        <View role="row" style={styles.tableRow}>
          <Pressable
            accessible={false}
            focusable={false}
            // Never a Tab stop of its own: the name is the row's button.
            tabIndex={-1}
            onPress={profileProps.onPress}
            style={({ pressed }) => [styles.tableProfile, pressed && styles.pressed]}
          >
            {/* The row's header (walk 9 T3-02): moving down a column, a
                screen reader names the player before each figure. */}
            <View aria-label={headerName} role="rowheader" style={styles.tablePlayerCell}>
              <PlayerAvatar player={{ id: position.playerId, name: position.playerName }} size={36} />
              <Pressable
                ref={profileRef}
                accessibilityLabel={tableName}
                accessibilityRole="button"
                onPress={profileProps.onPress}
                style={styles.tableNameButton}
              >
                {identity}
              </Pressable>
            </View>
            <TableFigures {...figures} />
          </Pressable>
          {/* At season end there is no action column: Total ends the row,
              on the table's right edge (walk 13 T4-03, T2-03). */}
          {action ? <View role="cell" style={styles.tableActionCell}>{action}</View> : null}
        </View>
        {/* The Drop / Close question is a row of the table, one cell across
            its columns, right under his row: a reader walking the table by
            rows or cells meets it in place (walk 13 T3-07). */}
        {strip ? (
          <View role="row">
            <View role="cell" {...({ 'aria-colspan': TABLE_COLUMN_COUNT } as object)}>{strip}</View>
          </View>
        ) : null}
      </View>
    );
  }

  if (layout === 'compact') {
    // Nothing shares a line it cannot fit on: no headshot, the figures list
    // one a line. Where it fits (a 320px phone) Drop sits beside the name and
    // tag line, as on wider phones; otherwise (200% zoom, large text) the
    // name takes the full width and Drop sits below the figures. With one
    // game, Profit a game and Total are one line (walk 16 T4-05).
    const beside = actionBeside && Boolean(action);
    return (
      <View ref={holdRef as never} style={[styles.compactRow, beside && styles.compactRowBeside]}>
        <Pressable {...profileProps} style={({ pressed }) => [styles.compactProfile, pressed && styles.pressed]}>
          {beside ? <View style={styles.compactTop}>{identity}</View> : identity}
          <View style={styles.compactFigures}>
            <ListFigures {...figures} oneGame={oneGameFigure(view.summary.games, figures.net, figures.total)} />
          </View>
        </Pressable>
        {action ? <View style={beside ? styles.compactActionBeside : styles.compactAction}>{action}</View> : null}
        {strip}
      </View>
    );
  }

  return (
    <View ref={holdRef as never} style={styles.stackRow}>
      <Pressable {...profileProps} style={({ pressed }) => [styles.stackProfile, pressed && styles.pressed]}>
        <View style={[styles.stackTop, action ? null : styles.stackTopFull]}>
          <PlayerAvatar player={{ id: position.playerId, name: position.playerName }} size={36} />
          {identity}
        </View>
        <View style={styles.stackFigures}>
          <StackedFigures {...figures} narrow={narrow} />
        </View>
      </Pressable>
      {action ? <View style={styles.stackAction}>{action}</View> : null}
      {strip}
    </View>
  );
}

/**
 * "Short again" on a closed short, "Add again" on a dropped player: the same
 * player at today's price, shown on the button ("Add again · $261.4K"; walk 8
 * T2-04), one tap, as the market's buttons would. Unavailable (with the
 * reason in its name) while roster moves are locked. On a full side it is
 * the Market's live FULL (walk 9 T4-05): "Full · make room", solid-edged,
 * its press opening and folding the way to make room (`onFull`, walk 8
 * T4-12); dashed stays for LOCKED.
 */
function ShortAgainButton({ row, price, quoteVersion, reason, notice = null, onShorted, onFull, fullOpen = false, buttonRef }: {
  row: ClosedRow;
  price: number;
  quoteVersion: number;
  /** Why it cannot be pressed right now, or null. */
  reason: string | null;
  /** What a tap while it is unavailable says (as LOCKED does: when moves reopen); defaults to `reason`. */
  notice?: string | null;
  onShorted: (playerId: string) => void;
  /** Set when his side is full: the button offers the way to make room instead. */
  onFull?: () => void;
  /** The full side's note is open under the row. */
  fullOpen?: boolean;
  buttonRef?: (node: View | null) => void;
}) {
  const { bootstrap, notify, openPosition, pendingActions } = usePerGame();
  // A dropped player is added again, an ended short shorted again: a new move
  // at today's price with its fee, not an undo (walk 7 T2-20).
  const side = row.side;
  const verb = side === 'long' ? 'Add' : 'Short';
  const pending = pendingActions.has(`position:${side}:${row.playerId}`) || pendingActions.has(`queued:position:${side}:${row.playerId}`);
  const fee = bootstrap?.ruleset.transactionFeeDollars ?? 0;
  const name = `${verb} ${row.name} again at ${perGame(price)}${fee > 0 ? `, ${exactMoney(fee)} fee` : ''}`;
  const full = onFull !== undefined && !pending;
  const own = useRef<View | null>(null);
  // FULL opens a note, as on the Market: it says whether the note is open.
  useEffect(() => {
    const node = own.current as unknown as { setAttribute?: (name: string, value: string) => void; removeAttribute?: (name: string) => void } | null;
    if (!node?.setAttribute || !node.removeAttribute) return;
    if (full) node.setAttribute('aria-expanded', fullOpen ? 'true' : 'false');
    else node.removeAttribute('aria-expanded');
  });
  // A double tap opens the note once (a toggle).
  const onFullRef = useRef(onFull);
  onFullRef.current = onFull;
  const toggleFull = useMemo(() => repeatSafe(() => onFullRef.current?.()), []);
  const buttonRefRef = useRef(buttonRef);
  buttonRefRef.current = buttonRef;
  const setRef = useCallback((node: View | null) => {
    own.current = node;
    buttonRefRef.current?.(node);
  }, []);
  return (
    <Button
      ref={setRef}
      accessibilityHint={full ? undefined : reason ?? undefined}
      accessibilityLabel={pending
        ? `${side === 'long' ? 'Adding' : 'Shorting'} ${row.name}`
        : full
          ? side === 'long'
            ? `Full, make room: drop a player to add ${row.name} again`
            : `Full, make room: close a short to short ${row.name} again`
          : name}
      disabled={full ? false : reason !== null || pending}
      focusableWhenDisabled
      // Today's price on the button, as the Market's price column shows it:
      // a re-add is a new move at a new price (walk 8 T2-04). One line
      // wherever there is room (walk 9 T2-07); zoomed in, the dot goes with
      // the words after it, never ending a line (walk 7 T1-12).
      label={pending ? (side === 'long' ? 'Adding…' : 'Shorting…')
        : full ? 'Full \u00b7\u00a0make room' : `${verb} again \u00b7\u00a0${moneyCompact(price)}`}
      // A tap while it is unavailable says why and when, like LOCKED (walk 6 T1-15).
      onDisabledPress={() => {
        if (reason === null || pending) return;
        notify(notice ?? reason);
      }}
      style={fullOpen && full ? styles.againArmed : undefined}
      textStyle={fullOpen && full ? styles.actionTextArmed : undefined}
      onPress={() => {
        if (full) {
          toggleFull();
          return;
        }
        void openPosition({
          playerId: row.playerId,
          playerName: row.name,
          side,
          expectedQuoteVersion: quoteVersion,
        }).then((ok) => {
          if (ok) onShorted(row.playerId);
        });
      }}
    />
  );
}

export function PerGameRosterScreen({
  onOpenMarket,
}: {
  onOpenMarket: (side: PerGamePosition['side']) => void;
}) {
  const { bootstrap, closePosition, notify, openPosition, pendingActions } = usePerGame();
  const { width, height, fontScale } = useWindowDimensions();
  // A phone on its side: the folded frame already says when moves reopen.
  const shortWindow = chromeFolded(height, width);
  // Sent from a full Market to make room for a player: a slim banner keeps
  // the errand in view and offers him the moment there is room (walk 3 T2-07).
  const [making, setMaking] = useState<{ side: PerGamePosition['side']; playerId: string; playerName: string } | null>(null);
  // Read inside callbacks: whether a drop on this side is the errand's.
  const makingRef = useRef(making);
  makingRef.current = making;
  // The banner's "Add at $239K": where focus goes once the drop makes room.
  const errandAddRef = useRef<View>(null);
  // The banner's sentence: where focus lands on arrival, so it is read once.
  const errandTextRef = useRef<Text>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [listWidth, setListWidth] = useState<number | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  // The Closed row whose full-side note is open (walk 8 T4-12).
  const [fullFor, setFullFor] = useState<string | null>(null);
  const [welcomeClosed, setWelcomeClosed] = useState(welcomeHidden);
  // How tall each list's pinned title and legend are (0 when not pinned).
  const [pinnedLong, setPinnedLong] = useState(0);
  const [pinnedShort, setPinnedShort] = useState(0);
  const actionRefs = useRef(new Map<string, View>());
  // Each Closed row's "Add again" / "Short again": OK on a full-side note returns focus to it.
  const closedAgainRefs = useRef(new Map<string, View>());
  // Each row's name button: after a move adds a player, focus lands on his name.
  const profileRefs = useRef(new Map<string, View>());
  const rosterHeading = useRef<Text>(null);
  const shortsHeading = useRef<Text>(null);
  const latest = useRef(bootstrap);
  latest.current = bootstrap;

  // The score block's recent line is the games the last press played, the
  // span and figure the status row and the notice give (walk 8 T2-01): a
  // rolling seven days beside them read as a second answer, even in sign.
  const advances = useRecentAdvances();
  const emptyNow = !(bootstrap?.positions ?? []).some((position) => position.status === 'active');
  const lastPress = useMemo(() => {
    const span = resultSpan(advances, bootstrap?.game.lastSettledDate, emptyNow);
    const items = bootstrap?.ledger.items;
    return pressLine(span, span && items ? earningsBetween(items, span.after, span.through, { gamesOnly: true }) : null);
  }, [advances, bootstrap?.game.lastSettledDate, bootstrap?.ledger.items, emptyNow]);
  const breakdown = useMemo(
    () => scoreBreakdown(
      bootstrap?.account.cumulativePnl ?? 0,
      bootstrap?.positions ?? [],
      bootstrap?.ledger.items ?? [],
    ),
    [bootstrap?.account.cumulativePnl, bootstrap?.ledger.items, bootstrap?.positions],
  );
  const closed = useMemo(
    () => closedRows(bootstrap?.positions ?? [], bootstrap?.ledger.items ?? [], bootstrap?.settledResults ?? []),
    [bootstrap?.ledger.items, bootstrap?.positions, bootstrap?.settledResults],
  );
  // A player on a list again says so on his old Closed row (walk 9 T4-N2).
  const backOn = useMemo(
    () => backLines(closed, bootstrap?.positions ?? [], bootstrap?.ledger.items ?? []),
    [bootstrap?.ledger.items, bootstrap?.positions, closed],
  );
  const season = useMemo(
    () => seasonSummary({
      score: bootstrap?.account.cumulativePnl ?? 0,
      positions: bootstrap?.positions ?? [],
      ledger: bootstrap?.ledger.items ?? [],
      leaderboard: bootstrap?.leaderboard ?? [],
    }),
    [bootstrap?.account.cumulativePnl, bootstrap?.leaderboard, bootstrap?.ledger.items, bootstrap?.positions],
  );
  const market = useMemo(
    () => new Map((bootstrap?.market ?? []).map((row) => [row.playerId, row])),
    [bootstrap?.market],
  );
  // One rule with the Market: practice ends on its last day, a live season
  // when games have settled and none are left.
  const seasonOver = bootstrap ? isSeasonOver({
    practiceComplete: isMockActive() && practiceProgress(mockSeasonStart(), bootstrap.game.lastSettledDate).complete,
    lastSettledDate: bootstrap.game.lastSettledDate,
    nextGameDate: bootstrap.game.nextGameDate,
  }) : false;
  // Value against results: what the games your picks played would have made
  // on last season's numbers, beside what they made (walk 3 T1-N1), over
  // every game, dropped players included, so it reads as the score before
  // fees (walk 5 T1-07).
  const picks = useMemo(
    () => pickValue(
      bootstrap?.positions ?? [],
      (playerId) => market.get(playerId)?.priorSeasonValuePerGame ?? null,
      bootstrap?.settledResults ?? [],
      { over: seasonOver, fees: breakdown.fees },
    ),
    [bootstrap?.positions, bootstrap?.settledResults, breakdown.fees, market, seasonOver],
  );

  // How to read the first night, in the welcome's place once your first
  // games have settled, until the next night settles or it is hidden.
  const lastSettledDate = bootstrap?.game.lastSettledDate ?? null;
  const hasGames = bootstrap?.ledger.items.some((entry) => entry.gameDate !== null) ?? false;
  // The season's first game night: the tip's week counts from it, not from
  // the first visit to this screen (walk 6 T1-17).
  const firstGameDate = useMemo(() => (bootstrap?.ledger.items ?? []).reduce<string | null>(
    (first, entry) => (entry.gameDate && (first === null || entry.gameDate < first) ? entry.gameDate : first),
    null,
  ), [bootstrap?.ledger.items]);
  const [tipClosed, setTipClosed] = useState(firstNightTip.done);
  const tipEligible = isMockActive() && !seasonOver && hasGames && !tipClosed;
  // Through the first week of game nights (walk 6 T1-17).
  const tipOpen = tipEligible && !tipRetired(firstGameDate, lastSettledDate, false);
  useEffect(() => {
    if (!tipEligible) return;
    if (tipRetired(firstGameDate, lastSettledDate, false)) {
      retireFirstNightTip();
      setTipClosed(true);
    }
  }, [firstGameDate, lastSettledDate, tipEligible]);

  const onConfirmOpen = useCallback((position: PerGamePosition) => {
    setConfirmingId(position.positionId);
  }, []);
  // An open Drop or Close question stays where you read it while +1 night
  // draws the chart and the tip above it (walk 14 T4-05), as an opened Closed
  // group does; it lets go once answered, and a scroll of yours wins.
  const questionHold = useHoldInView();
  const { hold: holdQuestion, release: releaseQuestion } = questionHold;
  useEffect(() => {
    if (confirmingId) holdQuestion(confirmingId, { throughTaps: true });
    else releaseQuestion();
  }, [confirmingId, holdQuestion, releaseQuestion]);
  const onConfirmClose = useCallback((position: PerGamePosition, outcome: ConfirmOutcome) => {
    setConfirmingId((current) => (current === position.positionId ? null : current));
    if (outcome === 'kept') {
      focusElement(actionRefs.current.get(position.positionId));
      return;
    }
    // Making room for a player (sent from a full Market): once the drop is
    // in, focus goes to the offer to add him, the reason for the detour, not
    // to the next player's Drop (walk 4 T3-09). Until then the list heading
    // holds focus, so it is not lost when the row goes.
    if (makingRef.current?.side === position.side) {
      focusElement(position.side === 'long' ? rosterHeading.current : shortsHeading.current, { preventScroll: true });
      // One message for the move and its errand (walk 6 T3-11): the drop's
      // notice ends "Room made for Kawhi Leonard.", and the banner's own
      // "Room made" line is not announced again.
      void closePosition(position, { also: `Room made for ${makingRef.current.playerName}.` }).then((ok) => {
        if (ok) setTimeout(() => focusElement(errandAddRef.current), 150);
      });
      return;
    }
    // Focus moves on before the row goes, to the list's heading: somewhere
    // neutral, never the next player's Drop, where one more Enter would open
    // a question about a player you never meant to touch (walk 6 T2-05,
    // T3-03). The notice then says who went.
    focusElement(position.side === 'long' ? rosterHeading.current : shortsHeading.current, { preventScroll: true });
    void closePosition(position);
  }, [closePosition]);
  // Sent here to make room ("Choose who to drop" in a full Market): bring the
  // roster list forward and say why.
  useEffect(() => {
    const pick = takeRosterPick();
    if (!pick) return undefined;
    if (pick.target) setMaking({ side: pick.side, ...pick.target });
    const timer = setTimeout(() => {
      const target = pick.side === 'short' ? shortsHeading.current : rosterHeading.current;
      const heading = target as unknown as { scrollIntoView?: (options?: object) => void } | null;
      heading?.scrollIntoView?.({ block: 'start' });
      // Making room for a player: the banner under the heading says why, so
      // it is the one message (no notice repeating it above; walk 4 T1-16),
      // and focus lands on its sentence so a screen reader reads it too.
      if (errandTextRef.current) {
        focusElement(errandTextRef.current, { preventScroll: true });
        return;
      }
      focusElement(target, { preventScroll: true });
      notify(pick.reason);
    }, 80);
    return () => clearTimeout(timer);
  }, [notify]);
  const actionRef = useCallback((positionId: string) => (node: View | null) => {
    if (node) actionRefs.current.set(positionId, node);
    else actionRefs.current.delete(positionId);
  }, []);
  const profileRef = useCallback((positionId: string) => (node: View | null) => {
    if (node) profileRefs.current.set(positionId, node);
    else profileRefs.current.delete(positionId);
  }, []);
  // After a move adds a player ("Short again", the errand's Add), focus lands
  // on his new row's name, never its Close (walk 6 T2-05, T2-06, T3-03); the
  // list's heading when the row is not there.
  const focusNewRow = useCallback((side: PerGamePosition['side'], playerId: string) => {
    setTimeout(() => {
      const fresh = (latest.current?.positions ?? []).find(
        (row) => row.status === 'active' && row.side === side && row.playerId === playerId,
      );
      const heading = side === 'long' ? rosterHeading.current : shortsHeading.current;
      focusElement((fresh ? profileRefs.current.get(fresh.positionId) : null) ?? heading);
    }, 60);
  }, []);
  const onShorted = useCallback((playerId: string) => focusNewRow('short', playerId), [focusNewRow]);
  const onReadded = useCallback((playerId: string) => focusNewRow('long', playerId), [focusNewRow]);
  // Desktop: the chart spans the Roster while "Full width" is on (walk 15 T2-02).
  const [chartWide, setChartWide] = useState(false);
  // The night picked on the chart stays picked when Full width or Narrow
  // moves it (walk 16 T2-N4).
  const [chartPin, setChartPin] = useState<number | null>(null);
  const [chartFocus, setChartFocus] = useState(false);
  const onChartFocused = useCallback(() => setChartFocus(false), []);

  if (!bootstrap) return null;
  const profilePosition = profileId
    ? bootstrap.positions.find(
      (row) => row.playerId === profileId && row.status === 'active',
    ) ?? null
    : null;
  // Not listed in the market (the season card can open a player you dropped):
  // his latest stint with you names him.
  const profileStint = profileId
    ? profilePosition ?? [...bootstrap.positions].reverse().find((row) => row.playerId === profileId) ?? null
    : null;
  const profilePlayer = profileId
    ? bootstrap.market.find((row) => row.playerId === profileId)
      ?? (profileStint
        ? {
            playerId: profileStint.playerId,
            name: profileStint.playerName,
            tier: '',
            quoteVersion: 0,
            currentGameCost: profileStint.lockedGameCost,
            priorSeasonValuePerGame: null,
          }
        : null)
    : null;
  const profileResults = profileId
    ? bootstrap.settledResults.filter((result) => result.playerId === profileId)
    : [];
  const active = bootstrap.positions.filter((position) => position.status === 'active');
  const longs = active.filter((position) => position.side === 'long');
  const shorts = active.filter((position) => position.side === 'short');
  const score = bootstrap.account.cumulativePnl;
  const started = bootstrap.ledger.items.some((entry) => entry.gameDate !== null);
  const rosterLocked = bootstrap.ruleset.rosterMutationsLocked;
  const rosterLockDate = bootstrap.ruleset.rosterLockGameDate;
  const practice = isMockActive();
  // The welcome stays until a player of yours has played a game (not just
  // until a night passes): +1 night with an empty roster must not skip it.
  const openingEve = practice && !seasonOver && !started;
  const showWelcome = openingEve && !welcomeClosed;
  const hideWelcome = () => {
    welcomeHidden = true;
    setVisitFlag(WELCOME_HIDDEN_KEY);
    setWelcomeClosed(true);
    focusElement(rosterHeading.current, { preventScroll: true });
  };
  const wide = width >= WIDE_MIN_WIDTH;
  const layout = rowLayout(listWidth ?? (wide ? width - summaryWidth(width) : width), width, fontScale);
  const narrow = layout === 'stacked' && (listWidth ?? width) < NARROW_LIST_MAX_WIDTH;
  // A 320px phone's Drop beside the name (walk 16 T4-05).
  const actionBeside = layout === 'compact' && compactActionBeside(width, fontScale);
  // The score's split: a statement in the desktop column, one a line when narrow, else two a line.
  const scoreVariant = wide ? 'panel' : layout === 'compact' ? 'narrow' : 'compact';
  // The table's action column (Drop, Close) and its gap, which the totals
  // sit clear of; none once the season is over (walk 13 T4-03, T2-03).
  const totalInset = layout === 'table' && !seasonOver ? ACTION_WIDTH + space.sm : 0;
  const hadLongs = bootstrap.positions.some((position) => position.side === 'long' && position.status === 'closed');
  const hadShorts = bootstrap.positions.some((position) => position.side === 'short' && position.status === 'closed');
  // The welcome carries the way to the Market while nobody is held: the
  // empty roster card does not repeat it (walk 11 T1-01, T3-01).
  const welcomeMarket = showWelcome && active.length === 0;
  // The first visit on a wide screen: the empty table shows its columns and
  // one ghost row, so the room says what will fill it (walk 13 T2-02).
  const ghostTable = welcomeMarket && layout === 'table';
  // Before any short, while the welcome is up or before the first games
  // settle (welcome closed or not), shorts are one quiet line (walk 14 T1-12).
  const quietShorts = shortsQuiet({
    welcome: showWelcome,
    dayZero: practice && practiceProgress(mockSeasonStart(), bootstrap.game.lastSettledDate).day === 0,
    seasonOver,
    openShorts: shorts.length,
    hadShorts,
  });
  const { longSlots, shortSlots } = bootstrap.account;
  const lockLine = rosterLocked ? `${rosterReopensLine(rosterLockDate)}.` : null;
  // Why Drop and Close are unavailable, in words on the screen (not only in a
  // hint react-native-web drops).
  // In a short window the folded frame already says "Moves reopen…", so the
  // list's header does not repeat it (walk 6 T1-08).
  const actionNote = seasonOver ? 'The season is over. Your roster is final.' : shortWindow ? undefined : lockLine ?? undefined;
  // The split in the app's one money format, the same as the score above it
  // (walk 6 T2-08, T4-09, T3-12), each part at its own rounding, in season
  // and at season end: one amount reads one figure in the split, its list's
  // total, the status row and the notices (walk 14 T4-01; walk 13 T4-02).
  // When the parts as shown visibly disagree with the score as shown, one
  // line under them says how they add up, every figure in dollars.
  const split = bootstrap.ledger.items.length > 0 ? splitParts(breakdownParts(breakdown), score) : null;
  const parts = split ? split.parts : null;
  const shownPart = (key: 'roster' | 'shorts' | 'closed' | 'fees', fallback: number) => (
    parts?.find((part) => part.key === key)?.value ?? fallback
  );
  const precision = 'fine' as const;
  // Who was dropped (or whose short closed) before playing, by name (walk 7 T2-18).
  const unplayed = closed.filter((row) => row.unplayed && row.side === 'long').map((row) => row.name);
  // "4 (3 adds, 1 short) · $1K in fees" (walk 5 T1-13).
  const movesText = movesLine(bootstrap.ledger.items, bootstrap.positions, breakdown.fees);
  // The title and the one-line legend pin while the rows scroll, in the
  // phone list and in the table (landscape phones, tablets, desktop), so the
  // figures never lose their labels (walk 5 T1-20).
  const sticky = layout === 'stacked' || layout === 'table';
  // One list is pinned at a time; the taller one's height clears both.
  const focusClear = keepFocusClear(Math.max(pinnedLong, pinnedShort));
  const legend = (side: PerGamePosition['side']) => (
    layout === 'table' ? <TableHeader actionWidth={seasonOver ? 0 : ACTION_WIDTH} side={side} />
      : layout === 'stacked' ? <FigureLegend narrow={narrow} side={side} /> : null
  );
  // The desktop table, as a table to screen readers (walk 8 T3-09): its
  // column headers (the drawn legend above is pinned and hidden from them).
  const tableOf = (side: PerGamePosition['side'], content: ReactNode) => {
    if (layout !== 'table') return content;
    const captions = figureCaptions(side);
    const headers = ['Player', captions.price, captions.dividend, captions.net, captions.total, ...(seasonOver ? [] : [closeVerb(side)])];
    return (
      <View aria-label={side === 'long' ? 'Your roster' : 'Your shorts'} role="table">
        <View role="row" style={visuallyHidden}>
          {headers.map((header) => <Text key={header} role="columnheader">{header}</Text>)}
        </View>
        {content}
      </View>
    );
  };
  const rows = (positions: PerGamePosition[]) => positions.map((position) => (
    <PositionRow
      key={position.positionId}
      actionRef={actionRef(position.positionId)}
      confirming={confirmingId === position.positionId}
      holdRef={questionHold.rowRef(position.positionId)}
      profileRef={profileRef(position.positionId)}
      layout={layout}
      marketPrice={market.get(position.playerId)?.currentGameCost ?? null}
      narrow={narrow}
      actionBeside={actionBeside}
      onConfirmClose={onConfirmClose}
      onConfirmOpen={onConfirmOpen}
      onOpenProfile={setProfileId}
      position={position}
      seasonOver={seasonOver}
    />
  ));
  const onListLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    setListWidth((current) => (current === next ? current : next));
  };

  // "Short again" goes on the latest closed row of any short, closed early
  // or run to its term (walk 8 T2-05), "Add again" on the latest row of a
  // player you dropped (walk 7 T2-20), while he is not on either list again:
  // his newest shown row, even when his last stint never played (walk 10 T4-07).
  const { readdable, reshortable } = againRows(closed);
  const heldNow = new Set(active.map((position) => position.playerId));
  const sideFull = (side: PerGamePosition['side']) => (
    side === 'long' ? longSlots.used >= longSlots.limit : shortSlots.used >= shortSlots.limit
  );
  // Why a closed row's button cannot be pressed, naming him (walk 8 T4-12).
  const againReason = (row: ClosedRow) => lockLine
    ?? (!sideFull(row.side) ? null : row.side === 'long'
      ? `Your roster is full: drop a player to add ${row.name} again.`
      : `Your shorts are full: close one to short ${row.name} again.`);
  const shortAgain = (row: ClosedRow) => {
    const listed = market.get(row.playerId);
    const again = row.side === 'long' ? readdable : reshortable;
    if (seasonOver || !again.has(row.positionId) || heldNow.has(row.playerId) || !listed) return null;
    return (
      <ShortAgainButton
        buttonRef={(node) => {
          if (node) closedAgainRefs.current.set(row.positionId, node);
          else closedAgainRefs.current.delete(row.positionId);
        }}
        fullOpen={fullFor === row.positionId}
        // Its press opens the way to make room and a second folds it, as
        // the Market's FULL does (walk 9 T4-05).
        onFull={!lockLine && sideFull(row.side) ? () => setFullFor((current) => (current === row.positionId ? null : row.positionId)) : undefined}
        onShorted={row.side === 'long' ? onReadded : onShorted}
        notice={lockLine ? lockNotice(rosterLockDate) : null}
        price={listed.currentGameCost}
        quoteVersion={listed.quoteVersion}
        reason={againReason(row)}
        row={row}
      />
    );
  };
  // A full side's answer under the Closed row, as the Market's FULL gives
  // it: why, naming him, and "Choose who to drop", which brings the list
  // forward with the banner that offers him once there is room (walk 8 T4-12).
  const fullNoteFor = (row: ClosedRow) => {
    if (fullFor !== row.positionId || seasonOver || lockLine || !sideFull(row.side) || heldNow.has(row.playerId)) return null;
    const limit = row.side === 'long' ? longSlots.limit : shortSlots.limit;
    return (
      <FullSideNote
        actionLabel={row.side === 'long' ? 'Choose who to drop' : 'Choose a short to close'}
        message={row.side === 'long'
          ? `Your roster is full (${limit} of ${limit}). Drop a player to add ${row.name} again.`
          : `All ${limit} short slots are in use. Close a short to short ${row.name} again.`}
        onAction={() => {
          if (tapsSettling()) return;
          setFullFor(null);
          setMaking({ side: row.side, playerId: row.playerId, playerName: row.name });
          // As "Choose who to drop" from the Market: the list comes forward
          // and focus lands on the banner's sentence, so it is read once.
          setTimeout(() => {
            const heading = (row.side === 'long' ? rosterHeading.current : shortsHeading.current) as unknown as { scrollIntoView?: (options?: object) => void } | null;
            heading?.scrollIntoView?.({ block: 'start' });
            focusElement(errandTextRef.current ?? heading, { preventScroll: true });
          }, 80);
        }}
        onClose={() => {
          setFullFor(null);
          focusElement(closedAgainRefs.current.get(row.positionId), { preventScroll: true });
        }}
      />
    );
  };

  const fee = bootstrap.ruleset.transactionFeeDollars;
  // The errand banner: "Making room for Chet Holmgren", then, once a spot is
  // free, "Add him at $239K" in one tap. Gone once he is added or on Not now.
  const makingFor = making && !bootstrap.positions.some((row) => row.status === 'active' && row.playerId === making.playerId)
    ? making
    : null;
  const errand = (side: PerGamePosition['side']) => {
    if (!makingFor || makingFor.side !== side || seasonOver) return null;
    const slots = side === 'long' ? longSlots : shortSlots;
    const room = slots.used < slots.limit;
    const listed = market.get(makingFor.playerId);
    const verb = side === 'long' ? 'Add' : 'Short';
    const opening = pendingActions.has(`position:${side}:${makingFor.playerId}`);
    return (
      <View style={styles.errand}>
        {/* The first line: why you are here, and the way out beside it
            (walk 4 T1-16). The sentence keeps its place when room is made,
            so the change is announced; only the sentence is announced, the
            buttons are read as focus reaches them (walk 4 T3-10). */}
        <View style={styles.errandHead}>
          {/* Two elements, so the change to "Room made" is never announced:
              the drop's notice already says it (walk 6 T3-11). */}
          {room ? (
            <Text key="made" ref={errandTextRef} style={styles.errandText}>
              {`Room made for ${makingFor.playerName}.`}
            </Text>
          ) : (
            <Text key="making" ref={errandTextRef} accessibilityLiveRegion="polite" style={styles.errandText}>
              {`Making room for ${makingFor.playerName}: ${side === 'long' ? 'drop a player' : 'close a short'} below.`}
            </Text>
          )}
          {room ? null : <Button label="Cancel" onPress={() => setMaking(null)} style={styles.errandCancel} variant="quiet" />}
        </View>
        {room ? (
          <View style={styles.errandActions}>
            {listed && !rosterLocked ? (
              <Button
                ref={errandAddRef}
                accessibilityLabel={`${verb} ${makingFor.playerName} at ${perGame(listed.currentGameCost)}${fee > 0 ? `, ${exactMoney(fee)} fee` : ''}`}
                disabled={opening}
                focusableWhenDisabled
                label={opening ? 'Wait' : `${verb} at ${moneyCompact(listed.currentGameCost)}`}
                onPress={() => {
                  void openPosition({
                    playerId: makingFor.playerId,
                    playerName: makingFor.playerName,
                    side,
                    expectedQuoteVersion: listed.quoteVersion,
                  }).then((ok) => {
                    if (!ok) return;
                    setMaking(null);
                    focusNewRow(side, makingFor.playerId);
                  });
                }}
                variant="primary"
              />
            ) : null}
            <Button
              label="Not now"
              onPress={() => {
                setMaking(null);
                // The banner (and this button) goes: focus the list's heading, not the page.
                focusElement(side === 'long' ? rosterHeading.current : shortsHeading.current, { preventScroll: true });
              }}
              variant="quiet"
            />
          </View>
        ) : null}
      </View>
    );
  };
  const opening = showWelcome ? (
    <WelcomeCard
      earn={earnLine(bootstrap.ruleset.dividendDollarsPerNetPoint)}
      feeDollars={fee}
      hasPlayers={active.length > 0}
      locked={rosterLocked}
      nextGameDate={bootstrap.game.nextGameDate}
      onHide={hideWelcome}
      // A visit's second season opens with one line (walk 13 T1-09).
      season={pastSeasonCount() + 1}
      onOpenMarket={() => onOpenMarket('long')}
      // "How scoring works" opens the Rules at Scoring, focused there (walk 15 T3-03).
      onOpenRules={() => {
        openRules('Scoring');
      }}
    />
  ) : tipOpen ? (
    <FirstNightTip
      // It explains the tag the rows show (walk 9 T1-14), or with none on
      // screen the newest Closed row (walk 10 T1-10).
      reading={tipReading(bootstrap.positions, bootstrap.settledResults ?? [], closed)}
      // Results at the end of the tip's words at every width, so the tip
      // keeps to a slim band (walk 6 T1-08, walk 7 T1-10); in a short
      // window one line of its controls' height (walk 14 T1-08).
      slim={shortWindow}
      onHide={() => {
        retireFirstNightTip();
        setTipClosed(true);
        focusElement(rosterHeading.current, { preventScroll: true });
      }}
      onOpenResults={() => {
        // Used: its job is done (walk 6 T1-17).
        retireFirstNightTip();
        setTipClosed(true);
        openTab('plays');
      }}
    />
  ) : seasonOver ? (
    <SeasonCompleteCard
      fees={breakdown.fees}
      // Best and Worst open that player's profile: "why did he lose so much?"
      onOpenPlayer={(name) => {
        const player = bootstrap.positions.find((row) => row.playerName === name);
        if (player) setProfileId(player.playerId);
      }}
      // The next season's notice says how this one finished.
      onPlayAgain={practice
        ? () => restartPractice(seasonResultLine(bootstrap.account.cumulativePnl, rankLine(bootstrap.leaderboard)))
        : undefined}
      exactLine={split ? split.exact : null}
      movesText={movesText}
      parts={parts}
      precision={precision}
      summary={season}
      // A short window: the way on sits under the final score, in the first
      // view, never half under the notice strip (walk 13 T2-09).
      actionFirst={shortWindow}
      valueLine={started ? picks?.text ?? null : null}
      variant={scoreVariant}
    />
  ) : null;

  // On the opening eve the welcome says what the empty chart would.
  const chartSpans = wide && chartWide;
  const chart = showWelcome ? null : (
    <PerGamePnlChart
      entries={bootstrap.ledger.items}
      // A phone's plot is tall enough from the first night to read a
      // week of swings and to pick a night with a finger (walk 9 T1-11):
      // it scrolls with the page. Desktop is capped so nightly swings stay
      // readable. At season end the chart is the season's story, and a
      // finger picks one of 174 nights: it gets more room (walk 8 T1-09).
      plotHeight={wide ? (chartSpans ? 180 : 208) : seasonOver ? 140 : 120}
      seasonOver={seasonOver}
      // Desktop: "Full width" spans the chart across the Roster, above both
      // columns, so a mouse can pick one night of a whole season (walk 15
      // T2-02); "Narrow" puts it back beside the score. Focus follows the
      // toggle to the chart's new place.
      widen={wide ? {
        wide: chartWide,
        onToggle: () => {
          setChartFocus(true);
          setChartWide((current) => !current);
        },
        focus: chartFocus,
        onFocused: onChartFocused,
      } : undefined}
      pin={wide ? { night: chartPin, onPin: setChartPin } : undefined}
    />
  );
  // A short one-column window (a laptop at 960x600, a phone on its side)
  // shows the score and your players first; the chart follows the lists
  // (walk 13 T2-04).
  const chartLast = chartAfterLists({ height, wide, seasonOver });
  // The welcome and the season's result lead the screen: on a phone above the
  // score, on a desktop at the top of the score column, which is otherwise
  // mostly empty before the first games. Once the season is over the result
  // card is the score block (final score, place and the split), so the score
  // is not shown twice and the season's chart comes up under it (walk 4 T2-07).
  const summary = (
    <>
      {opening}
      {seasonOver ? null : (
        <ScoreHeader
          // The welcome's steps name the first games' date, so the score
          // does not say it a third time and the roster shows under them on
          // a 320px phone (walk 10 T1-01).
          nextGameDate={showWelcome ? null : bootstrap.game.nextGameDate}
          exactLine={split ? split.exact : null}
          parts={parts}
          precision={precision}
          rank={started ? rankLine(bootstrap.leaderboard) : null}
          score={score}
          short={shortWindow}
          slots={wide ? slotLine(bootstrap.account) : null}
          started={started}
          title="Your score"
          valueLine={picks?.text ?? null}
          variant={scoreVariant}
          week={lastPress ? lastPress.value : null}
          weekWords={lastPress}
        />
      )}
      {chartLast || chartSpans ? null : chart}
      {wide && started && !seasonOver ? <SeasonSoFar fees={breakdown.fees} movesText={movesText} summary={season} /> : null}
    </>
  );
  const lists = (
    <>
      <View style={[styles.section, sticky && longs.length > 0 && styles.stickySection]}>
        <View>
        <SectionHead
          count={`${longSlots.used} of ${longSlots.limit}`}
          exact={longs.length > 0 ? sectionExact(sectionFigures(longs), breakdown.roster) : null}
          headingRef={rosterHeading}
          legend={longs.length > 0 || ghostTable ? legend('long') : undefined}
          note={actionNote}
          onPinnedHeight={setPinnedLong}
          precision={precision}
          sticky={sticky && longs.length > 0}
          title={sideHeading('long')}
          total={longs.length > 0 ? shownPart('roster', breakdown.roster) : undefined}
          totalInset={totalInset}
          totalLabel="Roster total"
        />
        {errand('long')}
        {longs.length > 0 ? tableOf('long', rows(longs)) : ghostTable ? <TableGhostRow actionWidth={ACTION_WIDTH} /> : (
          <EmptyState
            // Always a way to the Market (walk 8 T1-02), but one at a time:
            // while the welcome carries its own (nobody held), the first
            // screen has one Open market, and this card just says no one is
            // here yet (walk 11 T1-01, T3-01).
            action={seasonOver || welcomeMarket ? undefined : lockLine ? (
              <Button
                accessibilityLabel="Browse the player market"
                label="Browse the market"
                onPress={() => onOpenMarket('long')}
              />
            ) : (
              <Button
                accessibilityLabel="Open market: browse players to add"
                label="Open market"
                onPress={() => onOpenMarket('long')}
                variant="primary"
              />
            )}
            // Once the season is over the section's own line says so ("The
            // season is over. Your roster is final."); the card under it
            // said it again.
            copy={seasonOver
              ? undefined
              // Beside the welcome the list's note (or the folded frame)
              // already says when moves reopen, and the welcome explains.
              : welcomeMarket ? undefined
                : lockLine ? `${lockLine} You can look around the market until then.` : ROSTER_EXPLAINER}
            style={styles.empty}
            title={hadLongs ? 'Your roster is empty' : seasonOver ? 'No players this season' : welcomeMarket ? 'No players yet' : 'Add your first player'}
          />
        )}
        {sticky && longs.length > 0 ? <View style={styles.stickyRelease} /> : null}
        </View>
      </View>
      {quietShorts ? (
        // Before your first games the short side is one quiet line, not a
        // card with its own button: the welcome's one next step stays the
        // Market (walk 11 T1-01).
        <View style={styles.section}>
          <Text style={styles.shortsLater}>{SHORTS_LATER}</Text>
        </View>
      ) : (
      <View style={[styles.section, sticky && shorts.length > 0 && styles.stickySection]}>
        <View>
        <SectionHead
          caption={shorts.length > 0 ? SHORT_EXPLAINER : undefined}
          exact={shorts.length > 0 ? sectionExact(sectionFigures(shorts), breakdown.shorts) : null}
          count={`${shortSlots.used} of ${shortSlots.limit}`}
          headingRef={shortsHeading}
          legend={shorts.length > 0 ? legend('short') : undefined}
          onPinnedHeight={setPinnedShort}
          precision={precision}
          sticky={sticky && shorts.length > 0}
          title={sideHeading('short')}
          total={shorts.length > 0 ? shownPart('shorts', breakdown.shorts) : undefined}
          totalInset={totalInset}
          totalLabel="Shorts total"
        />
        {errand('short')}
        {shorts.length > 0 ? tableOf('short', rows(shorts)) : (
          <EmptyState
            // Once the season is over the market takes no new shorts, so the
            // empty section offers none; its title says so, and the roster's
            // line above already says the season is over (on a desktop table
            // both lines showed at once).
            // While moves are locked it says when shorts reopen and offers a
            // look at the market rather than a dead end.
            action={seasonOver ? undefined : (
              <Button
                accessibilityLabel={lockLine ? 'Browse shorts in the player market' : 'Find a short in the player market'}
                label={lockLine ? 'Browse shorts' : 'Find a short'}
                onPress={() => onOpenMarket('short')}
              />
            )}
            copy={seasonOver
              ? undefined
              : lockLine ? `${lockLine} ${SHORT_EXPLAINER}` : SHORT_EXPLAINER}
            style={styles.empty}
            title={hadShorts ? 'No open shorts' : seasonOver ? 'No shorts this season' : 'No shorts yet'}
          />
        )}
        {sticky && shorts.length > 0 ? <View style={styles.stickyRelease} /> : null}
        </View>
      </View>
      )}
      <ClosedSection
        actionFor={shortAgain}
        backFor={(row) => backOn.get(row.positionId) ?? null}
        noteFor={fullNoteFor}
        precision={precision}
        rows={closed}
        table={layout === 'table'}
        total={shownPart('closed', breakdown.closed)}
        totalInset={totalInset}
      />
      <FeesLine
        feeEach={fee}
        fees={shownPart('fees', breakdown.fees)}
        moves={feeMoves(bootstrap.ledger.items)}
        precision={precision}
        table={layout === 'table'}
        totalInset={totalInset}
        unplayed={unplayed}
        unplayedShorts={closed.filter((row) => row.unplayed && row.side === 'short').map((row) => row.name)}
      />
      {chartLast && chart ? <View style={styles.chartLast}>{chart}</View> : null}
    </>
  );

  return (
    <View style={styles.screen}>
      {/* The screen's title for screen readers (the tab bar names it on screen). */}
      <View style={visuallyHidden}>
        <Text accessibilityRole="header" {...headingLevel(1)}>Roster</Text>
      </View>
      {chartSpans && chart ? <View style={styles.chartBand}>{chart}</View> : null}
      {wide ? (
        <View style={styles.columns}>
          <ScrollView contentContainerStyle={styles.summaryContent} style={[styles.summaryColumn, { width: summaryWidth(width) }]}>
            {summary}
          </ScrollView>
          <ScrollView contentContainerStyle={styles.listContent} onLayout={onListLayout} style={[styles.listColumn, focusClear]}>
            {lists}
          </ScrollView>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.listContent} onLayout={onListLayout} style={[styles.scroll, focusClear]}>
          {summary}
          {lists}
        </ScrollView>
      )}
      <PlayerProfileSheet
        dividendRate={bootstrap.ruleset.dividendDollarsPerNetPoint}
        latestSettledDate={bootstrap.game.lastSettledDate}
        onClose={() => setProfileId(null)}
        player={profilePlayer}
        position={profilePosition}
        results={profileResults}
        trends={profileId !== null && isMockActive() ? mockPlayerTrends(profileId) : undefined}
        visible={profileId !== null && profilePlayer !== null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    minHeight: 0,
  },
  scroll: {
    flex: 1,
  },
  columns: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'row',
  },
  // The chart across the whole Roster (desktop, "Full width"): in the layout
  // above both columns, never over them.
  chartBand: {
    flexShrink: 0,
  },
  summaryColumn: {
    flexGrow: 0,
    flexShrink: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.borderStrong,
  },
  listColumn: {
    flex: 1,
  },
  summaryContent: {
    paddingBottom: space.xl,
    // A vertical list never pans sideways, even when a reader's text spacing
    // widens a line past the screen and focus scrolls it into view (walk 14
    // T3-01). Clip, not hidden: pinned headers still pin.
    ...({ overflowX: 'clip' } as object),
  },
  listContent: {
    // Clears a problem notice, which stays over the bottom of the screen
    // until it is dismissed, so the last row is never stuck under it.
    paddingBottom: 110,
    ...({ overflowX: 'clip' } as object),
  },
  section: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
  },
  // A pinned title's scope (walk 15 T2-10): CSS sticky keeps a title inside
  // its parent's content box. The release spacer, the scope's last child,
  // pulls that box's end up one row (a negative top margin), and the section
  // pads the same back, so nothing moves: the title leaves with its last row
  // instead of staying pinned over the next section when the list cannot
  // scroll its section away.
  stickySection: {
    paddingBottom: STICKY_RELEASE,
  },
  stickyRelease: {
    height: 0,
    marginTop: -STICKY_RELEASE,
  },
  // Score by night under the lists in a short window (walk 13 T2-04): ruled
  // off from the Fees line, as the lists are from each other.
  chartLast: {
    marginTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderStrong,
  },
  empty: {
    paddingVertical: space.lg,
    paddingHorizontal: space.lg,
  },
  // The short side before your first games: one quiet line.
  shortsLater: {
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    color: colors.muted,
    fontFamily: fonts.body,
    fontSize: type.body,
  },
  stackRow: {
    position: 'relative',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  stackProfile: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.sm,
  },
  stackTop: {
    minHeight: control.height,
    flexDirection: 'row',
    // The photo sits beside the name, whatever lines follow under it (a
    // "Bad night" line; walk 9 T1-02), never centred on the whole block.
    alignItems: 'flex-start',
    gap: space.md,
    // Keeps the name and verdict clear of the Drop button that sits over this corner.
    paddingRight: ACTION_WIDTH + space.sm,
  },
  stackTopFull: {
    paddingRight: 0,
  },
  stackFigures: {
    marginTop: 6,
  },
  stackAction: {
    position: 'absolute',
    top: space.sm,
    right: space.lg,
  },
  errand: {
    marginHorizontal: space.lg,
    marginVertical: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    gap: space.sm,
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: radius.sm,
    backgroundColor: colors.goldSoft,
  },
  // Sentence and Cancel share a line; too narrow for both (200% zoom), Cancel
  // takes the next line rather than squeezing the words into a sliver.
  errandHead: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
  },
  errandText: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 160,
    minWidth: 0,
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.caption,
    fontWeight: weight.bold,
  },
  // A quiet button at the line's end: its words, not its box, line up with the edge.
  errandCancel: {
    marginLeft: 'auto',
    marginVertical: -space.xs,
    marginRight: -space.sm,
  },
  errandActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  strip: {
    marginHorizontal: space.lg,
    marginBottom: space.sm,
  },
  compactRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingBottom: space.sm,
  },
  compactProfile: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
  },
  compactFigures: {
    marginTop: space.sm,
  },
  // Drop ends at the right edge, in line with the figures above it (walk 10
  // T1-06): a row, so the button's own centring (alignSelf) is vertical here.
  compactAction: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
  },
  // Drop beside the name and tag line (walk 16 T4-05), as on wider phones:
  // over the row's top corner, the name kept clear of it.
  compactRowBeside: {
    position: 'relative',
  },
  compactTop: {
    minHeight: control.height,
    flexDirection: 'row',
    paddingRight: ACTION_WIDTH + space.sm,
  },
  compactActionBeside: {
    position: 'absolute',
    top: space.sm,
    right: space.lg,
  },
  tableItem: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: space.sm,
    paddingRight: space.lg,
  },
  tablePlayerCell: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    // Beside the name, as on a phone (walk 9 T1-02).
    alignItems: 'flex-start',
    gap: space.sm,
  },
  tableNameButton: {
    flex: 1,
    minWidth: 0,
    // A 44px target, whatever its two lines add up to.
    minHeight: 44,
    justifyContent: 'center',
  },
  tableActionCell: {
    justifyContent: 'center',
  },
  tableProfile: {
    flex: 1,
    minWidth: 0,
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingLeft: space.lg,
    paddingVertical: space.sm,
  },
  identity: {
    flex: 1,
    minWidth: 0,
    marginLeft: 4,
  },
  name: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
  },
  // One size down for a long name on a table row's one line (walk 7 T4-10).
  nameSmall: {
    fontSize: type.body,
  },
  meta: {
    minHeight: 20,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: space.sm,
    rowGap: 2,
    marginTop: 3,
  },
  metaText: {
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.caption,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
  },
  metaEnds: {
    color: colors.goldInk,
  },
  endsLine: {
    marginTop: 2,
  },
  action: {
    alignSelf: 'center',
    width: ACTION_WIDTH,
    minHeight: control.height,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.controlBorder,
    // Outlined, not filled: dropping is a secondary move on a row whose job
    // is to show how the player is doing.
    backgroundColor: 'transparent',
  },
  actionLocked: {
    borderStyle: 'dashed',
  },
  // FULL with its note open: the Roster's "question open" look, as on the Market.
  againArmed: {
    borderColor: colors.gold,
    backgroundColor: colors.goldSoft,
  },
  actionArmed: {
    borderColor: colors.gold,
    backgroundColor: colors.goldSoft,
  },
  actionText: {
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.black,
    letterSpacing: 0.8,
  },
  actionTextArmed: {
    color: colors.goldInk,
  },
  // "WAITING" keeps inside the 72px button.
  actionTextWaiting: {
    letterSpacing: 0.3,
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.72,
  },
});
