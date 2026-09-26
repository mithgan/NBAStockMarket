import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import {
  FigureLegend,
  ListFigures,
  StackedFigures,
  TableFigures,
  TableHeader,
} from '../components/roster/RowFigures';
import { ScoreHeader } from '../components/roster/ScoreHeader';
import { FirstNightTip, SeasonCompleteCard, SeasonSoFar, WelcomeCard } from '../components/roster/SeasonCards';
import { SectionHead } from '../components/roster/SectionHead';
import {
  closeActionName,
  closeVerb,
  confirmCloseButton,
  confirmCloseMessage,
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
  signedMoneyCompact,
  unbrokenName,
} from '../copy/terms';
import { chromeFolded, keepTogether, practiceProgress } from '../data/chromeView';
import { isSeasonOver } from '../data/marketView';
import { recentEarnings, scoreBreakdown, seasonSummary } from '../data/perGameMetrics';
import {
  breakdownParts,
  closedRows,
  earnLine,
  exactFinalLine,
  feeMoves,
  movesLine,
  pickValue,
  weekLabel,
  rankLine,
  rosterRowView,
  rowLayout,
  shortEndsNext,
  shownParts,
  slotLine,
  tipRetired,
  type ClosedRow,
  type RowLayout,
} from '../data/rosterView';
import { usePerGame } from '../state/PerGameContext';
import { openRules, openTab, takeRosterPick } from '../state/uiActions';
import { colors, control, fonts, radius, space, type, weight } from '../theme';
import { Button, ConfirmStrip, EmptyState, headingLevel, Tag, tapsSettling, useAriaDisabled, visuallyHidden } from '../ui/kit';
import { restartPractice } from '../web/practiceSession';

/** Desktop: score and chart beside the lists. */
const WIDE_MIN_WIDTH = 1024;
/** The score column; narrower on small laptops so the table keeps room for names. */
const summaryWidth = (width: number) => (width >= 1200 ? 360 : 320);
const ACTION_WIDTH = 72;
/** A second press on Drop this soon after it opened the confirm is a double tap: ignored. */
const DOUBLE_TAP_MS = 400;
/** Phone lists narrower than this leave out Profit a game (see `StackedFigures`). */
const NARROW_LIST_MAX_WIDTH = 380;

const WELCOME_HIDDEN_KEY = 'nba-stock-market:welcome-hidden';
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
  seasonOver,
  onOpenProfile,
  confirming,
  onConfirmOpen,
  onConfirmClose,
  actionRef,
  profileRef,
  marketPrice,
}: {
  position: PerGamePosition;
  layout: RowLayout;
  /** A phone list under 380 CSS px: three figures instead of four. */
  narrow: boolean;
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
}) {
  const { bootstrap, notify, pendingActions } = usePerGame();
  const nameFit = useTableNameFit(layout === 'table', position.playerName);
  const actionKey = `position:${position.side}:${position.playerId}`;
  // A move waiting its turn counts as this row's; another row's move does
  // not rest this one (its press would wait its turn; walk 5 T4-01).
  const pending = pendingActions.has(actionKey) || pendingActions.has(`queued:${actionKey}`);
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
    view.summary.avgNet === null ? null : `profit ${signedMoneyCompact(view.summary.avgNet)} a game`,
    `${short ? 'credited' : 'price'} ${moneyCompact(position.lockedGameCost)} a game${priceMoved ? `, now ${moneyCompact(marketPrice as number)}` : ''}`,
    view.summary.avgDividend === null ? null : `dividend ${moneyCompact(view.summary.avgDividend)} a game`,
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
    // LOCKED answers a tap with why and when (a silent button teaches nothing).
    if (rosterLocked) {
      notify(lockNotice(rosterLockDate));
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
        : pending ? (short ? `Closing your short on ${position.playerName}` : `Dropping ${position.playerName}`)
          : actionName}
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
        rosterLocked ? styles.actionLocked : disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {pending && !rosterLocked ? (
        <ActivityIndicator color={colors.muted} size="small" />
      ) : (
        <Text style={[styles.actionText, confirming && styles.actionTextArmed]}>
          {rosterLocked ? 'LOCKED' : verb.toUpperCase()}
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
      message={confirmCloseMessage({
        side: position.side,
        playerName: position.playerName,
        feeDollars: fee,
        total: position.cumulativePnl,
        // Left alone a short ends by itself on its last day, at no cost: the
        // question says so whenever it is asked (walk 3 T1-N3).
        endsFreeAfter: position.expiresOn,
        priceNow: marketPrice,
      })}
      onCancel={() => onConfirmClose(position, 'kept')}
      onConfirm={() => onConfirmClose(position, 'closed')}
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
    return (
      <View style={styles.tableItem}>
        <View style={styles.tableRow}>
          <Pressable {...profileProps} style={({ pressed }) => [styles.tableProfile, pressed && styles.pressed]}>
            <PlayerAvatar player={{ id: position.playerId, name: position.playerName }} size={36} />
            {identity}
            <TableFigures {...figures} />
          </Pressable>
          {/* The header reserves the action column; keep the totals under it. */}
          {action ?? <View style={{ width: ACTION_WIDTH }} />}
        </View>
        {strip}
      </View>
    );
  }

  if (layout === 'compact') {
    // Nothing shares a line it cannot fit on: the name takes the full width
    // (no headshot, no space held for the button), the figures list one a
    // line, and Drop sits below them.
    return (
      <View style={styles.compactRow}>
        <Pressable {...profileProps} style={({ pressed }) => [styles.compactProfile, pressed && styles.pressed]}>
          {identity}
          <View style={styles.compactFigures}>
            <ListFigures {...figures} />
          </View>
        </Pressable>
        {action ? <View style={styles.compactAction}>{action}</View> : null}
        {strip}
      </View>
    );
  }

  return (
    <View style={styles.stackRow}>
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
 * "Short again" on a short that ran its term: the same player at today's
 * price, one tap, as the market's Short button would. Unavailable (with the
 * reason in its name) while roster moves are locked or the shorts are full.
 */
function ShortAgainButton({ row, price, quoteVersion, reason, notice = null, onShorted, column = false }: {
  row: ClosedRow;
  price: number;
  quoteVersion: number;
  /** Why it cannot be pressed right now, or null. */
  reason: string | null;
  /** What a tap while it is unavailable says (as LOCKED does: when moves reopen); defaults to `reason`. */
  notice?: string | null;
  onShorted: (playerId: string) => void;
  /**
   * The roster table's action column: as wide as Drop and Close above it,
   * the words on two lines, so the row's figure keeps the Total column
   * (walk 4 T2-20).
   */
  column?: boolean;
}) {
  const { bootstrap, notify, openPosition, pendingActions } = usePerGame();
  // A dropped player is added again, an ended short shorted again: a new move
  // at today's price with its fee, not an undo (walk 7 T2-20).
  const side = row.side;
  const verb = side === 'long' ? 'Add' : 'Short';
  const pending = pendingActions.has(`position:${side}:${row.playerId}`) || pendingActions.has(`queued:position:${side}:${row.playerId}`);
  const fee = bootstrap?.ruleset.transactionFeeDollars ?? 0;
  const name = `${verb} ${row.name} again at ${perGame(price)}${fee > 0 ? `, ${exactMoney(fee)} fee` : ''}`;
  return (
    <Button
      accessibilityHint={reason ?? undefined}
      accessibilityLabel={pending ? `${side === 'long' ? 'Adding' : 'Shorting'} ${row.name}` : name}
      disabled={reason !== null || pending}
      focusableWhenDisabled
      label={pending ? (column ? 'Wait' : side === 'long' ? 'Adding…' : 'Shorting…') : `${verb} again`}
      // A tap while it is unavailable says why and when, like LOCKED (walk 6 T1-15).
      onDisabledPress={() => {
        if (reason !== null && !pending) notify(notice ?? reason);
      }}
      style={column ? styles.columnButton : undefined}
      textStyle={column ? styles.columnButtonText : undefined}
      width={column ? ACTION_WIDTH : undefined}
      onPress={() => {
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
  const shortWindow = chromeFolded(height);
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
  const [welcomeClosed, setWelcomeClosed] = useState(welcomeHidden);
  // How tall each list's pinned title and legend are (0 when not pinned).
  const [pinnedLong, setPinnedLong] = useState(0);
  const [pinnedShort, setPinnedShort] = useState(0);
  const actionRefs = useRef(new Map<string, View>());
  // Each row's name button: after a move adds a player, focus lands on his name.
  const profileRefs = useRef(new Map<string, View>());
  const rosterHeading = useRef<Text>(null);
  const shortsHeading = useRef<Text>(null);
  const latest = useRef(bootstrap);
  latest.current = bootstrap;

  const recent = useMemo(
    () => recentEarnings(bootstrap?.ledger.items, bootstrap?.game.lastSettledDate),
    [bootstrap?.game.lastSettledDate, bootstrap?.ledger.items],
  );
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
  // "Oct 21 games", "Oct 22–28 games": the week figure's days (walk 7 T1-13).
  const weekWords = useMemo(() => weekLabel(firstGameDate, lastSettledDate), [firstGameDate, lastSettledDate]);
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
  // The score's split: a statement in the desktop column, one a line when narrow, else two a line.
  const scoreVariant = wide ? 'panel' : layout === 'compact' ? 'narrow' : 'compact';
  const totalInset = layout === 'table' ? ACTION_WIDTH + space.sm : 0;
  const hadLongs = bootstrap.positions.some((position) => position.side === 'long' && position.status === 'closed');
  const hadShorts = bootstrap.positions.some((position) => position.side === 'short' && position.status === 'closed');
  const { longSlots, shortSlots } = bootstrap.account;
  const lockLine = rosterLocked ? `${rosterReopensLine(rosterLockDate)}.` : null;
  // Why Drop and Close are unavailable, in words on the screen (not only in a
  // hint react-native-web drops).
  // In a short window the folded frame already says "Moves reopen…", so the
  // list's header does not repeat it (walk 6 T1-08).
  const actionNote = seasonOver ? 'The season is over. Your roster is final.' : shortWindow ? undefined : lockLine ?? undefined;
  // The split in the app's one money format, the same as the score above it
  // (walk 6 T2-08, T4-09, T3-12): never exact dollars or a third decimal; the
  // parts nearest a rounding edge round the other way when needed, so the
  // parts as shown add up to the score as shown. Each list's total repeats
  // its part exactly.
  const parts = bootstrap.ledger.items.length > 0 ? shownParts(breakdownParts(breakdown), score) : null;
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
    layout === 'table' ? <TableHeader actionWidth={ACTION_WIDTH} side={side} />
      : layout === 'stacked' ? <FigureLegend narrow={narrow} side={side} /> : null
  );
  const rows = (positions: PerGamePosition[]) => positions.map((position) => (
    <PositionRow
      key={position.positionId}
      actionRef={actionRef(position.positionId)}
      confirming={confirmingId === position.positionId}
      profileRef={profileRef(position.positionId)}
      layout={layout}
      marketPrice={market.get(position.playerId)?.currentGameCost ?? null}
      narrow={narrow}
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

  // "Short again" goes on the latest closed row for a player whose short ran
  // its term, "Add again" on the latest row of a player you dropped (walk 7
  // T2-20), while he is not on either list again.
  const reshortable = new Set<string>();
  const readdable = new Set<string>();
  {
    const seen = new Set<string>();
    for (const row of closed) {
      if (seen.has(row.playerId)) continue;
      seen.add(row.playerId);
      if (row.endedByTerm) reshortable.add(row.positionId);
      if (row.side === 'long') readdable.add(row.positionId);
    }
  }
  const heldNow = new Set(active.map((position) => position.playerId));
  const shortReason = lockLine
    ?? (shortSlots.used >= shortSlots.limit ? 'Your shorts are full: close one to short again.' : null);
  const addReason = lockLine
    ?? (longSlots.used >= longSlots.limit ? 'Your roster is full: drop a player to add him again.' : null);
  const shortAgain = (row: ClosedRow) => {
    const listed = market.get(row.playerId);
    const again = row.side === 'long' ? readdable : reshortable;
    if (seasonOver || !again.has(row.positionId) || heldNow.has(row.playerId) || !listed) return null;
    return (
      <ShortAgainButton
        column={layout === 'table'}
        onShorted={row.side === 'long' ? onReadded : onShorted}
        notice={lockLine ? lockNotice(rosterLockDate) : null}
        price={listed.currentGameCost}
        quoteVersion={listed.quoteVersion}
        reason={row.side === 'long' ? addReason : shortReason}
        row={row}
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
      nextGameDate={bootstrap.game.nextGameDate}
      onHide={hideWelcome}
      onOpenMarket={() => onOpenMarket('long')}
      onOpenRules={() => {
        openRules();
      }}
    />
  ) : tipOpen ? (
    <FirstNightTip
      // Results at the end of the tip's words at every width, so the tip
      // keeps to a slim band (walk 6 T1-08, walk 7 T1-10).
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
      exactLine={parts ? exactFinalLine(parts, score) : null}
      movesText={movesText}
      parts={parts}
      precision={precision}
      summary={season}
      valueLine={started ? picks?.text ?? null : null}
      variant={scoreVariant}
    />
  ) : null;

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
          nextGameDate={bootstrap.game.nextGameDate}
          parts={parts}
          precision={precision}
          rank={started ? rankLine(bootstrap.leaderboard) : null}
          score={score}
          slots={wide ? slotLine(bootstrap.account) : null}
          started={started}
          title="Your score"
          valueLine={picks?.text ?? null}
          variant={scoreVariant}
          week={recent ? recent.week : null}
          weekWords={weekWords}
        />
      )}
      {/* On the opening eve the welcome says what the empty chart would. */}
      {showWelcome ? null : (
        <PerGamePnlChart
          entries={bootstrap.ledger.items}
          // Phones keep the plot short so roster rows start high; wider lists
          // afford more, and desktop is capped so nightly swings stay readable.
          plotHeight={wide ? 208 : layout === 'table' ? 120 : 68}
          seasonOver={seasonOver}
        />
      )}
      {wide && started && !seasonOver ? <SeasonSoFar fees={breakdown.fees} movesText={movesText} summary={season} /> : null}
    </>
  );
  const lists = (
    <>
      <View style={styles.section}>
        <SectionHead
          count={`${longSlots.used} of ${longSlots.limit}`}
          headingRef={rosterHeading}
          legend={longs.length > 0 ? legend('long') : undefined}
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
        {longs.length > 0 ? rows(longs) : (
          <EmptyState
            // The welcome above already offers the market on the opening eve.
            action={showWelcome || seasonOver ? undefined : lockLine ? (
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
            copy={seasonOver
              ? 'The season is over. There are no more players to add.'
              : lockLine ? `${lockLine} You can look around the market until then.` : ROSTER_EXPLAINER}
            style={styles.empty}
            title={hadLongs ? 'Your roster is empty' : seasonOver ? 'No players this season' : 'Add your first player'}
          />
        )}
      </View>
      <View style={styles.section}>
        <SectionHead
          caption={shorts.length > 0 ? SHORT_EXPLAINER : undefined}
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
        {shorts.length > 0 ? rows(shorts) : (
          <EmptyState
            // Once the season is over the market takes no new shorts, so the
            // empty section says so instead of sending you somewhere idle.
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
              ? 'The season is over, so there are no more shorts to open.'
              : lockLine ? `${lockLine} ${SHORT_EXPLAINER}` : SHORT_EXPLAINER}
            style={styles.empty}
            title={hadShorts ? 'No open shorts' : seasonOver ? 'No shorts this season' : 'No shorts yet'}
          />
        )}
      </View>
      <ClosedSection
        actionFor={shortAgain}
        precision={precision}
        rows={closed}
        total={shownPart('closed', breakdown.closed)}
        totalInset={totalInset}
      />
      <FeesLine
        feeEach={fee}
        fees={shownPart('fees', breakdown.fees)}
        moves={feeMoves(bootstrap.ledger.items)}
        precision={precision}
        totalInset={totalInset}
        unplayed={unplayed}
        unplayedShorts={closed.filter((row) => row.unplayed && row.side === 'short').map((row) => row.name)}
      />
    </>
  );

  return (
    <View style={styles.screen}>
      {/* The screen's title for screen readers (the tab bar names it on screen). */}
      <View style={visuallyHidden}>
        <Text accessibilityRole="header" {...headingLevel(1)}>Roster</Text>
      </View>
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
  },
  listContent: {
    // Clears a problem notice, which stays over the bottom of the screen
    // until it is dismissed, so the last row is never stuck under it.
    paddingBottom: 110,
  },
  section: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
  },
  empty: {
    paddingVertical: space.lg,
    paddingHorizontal: space.lg,
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
    alignItems: 'center',
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
  compactAction: {
    alignItems: 'flex-end',
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
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
  // "Short again" in the table's 72px action column: two short lines.
  columnButton: {
    paddingHorizontal: space.xs,
  },
  columnButtonText: {
    textAlign: 'center',
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
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.72,
  },
});
