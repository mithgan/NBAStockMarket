import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react';
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewToken,
} from 'react-native';

import type { PerGamePositionSide } from '../api/contracts';
import { isMockActive, mockPlayerTrends, mockSeasonStart } from '../api/mockPerGameClient';
import { FullNote } from '../components/market/FullNote';
import { LockIcon, StarIcon } from '../components/market/icons';
import { ListEnd, SkipLink } from '../components/market/SkipLink';
import { ExplainerTip } from '../components/market/ExplainerTip';
import { peekProfileReturn, takeProfileReturn, type ProfileReturn, type ProfileView } from '../components/results/playerGames';
import { OrderLine } from '../components/market/OrderLine';
import { listenForActivations, pressedInScreen } from '../components/market/lastActivation';
import { spaceToggles } from '../components/market/switchKeys';
import { useAriaDisabled } from '../components/market/useAriaDisabled';
import { lastPointerType } from '../components/market/pointerKind';
import { pressedByPointer, unlessSettling } from '../web/tapSettle';
import { revealFocused } from '../web/focusInView';
import { ControlsToggle, MarketColumnHeader, MarketSearch, SortControl, WatchingToggle } from '../components/market/MarketControls';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { PlayerProfileSheet } from '../components/PlayerProfileSheet';
import {
  ROSTER_EXPLAINER,
  SHORT_EXPLAINER,
  confirmCloseButton,
  confirmCloseMessage,
  money,
  perGameShort,
  confirmCloseName,
  rosterReopensLine,
  signedMoney,
  unbrokenName,
  moneyCompact,
  signedMoneyCompact,
} from '../copy/terms';
import { practiceProgress } from '../data/chromeView';
import {
  didYouMeanLine,
  nearestNames,
  type NameSuggestion,
  accountValueByPlayer,
  actionableFirst,
  actionName,
  actionWord,
  collapseControls,
  echoQuery,
  feeHint,
  feeLine,
  filterMarketRows,
  fullActionName,
  FULL_BUTTON_WORDS,
  fullNote,
  headerStatus,
  heldDetail,
  heldPriceCaption,
  heldPlayedWordings,
  heldStepFloor,
  heldFirstStep,
  heldDropsAverage,
  heldValueLine,
  heldValuePhrase,
  HELD_NOW_MIN_WIDTH,
  HELD_VALUE_CAPTION,
  heldPriceSaysYours,
  isSeasonOver,
  JUST_OPENED_MS,
  keptAnnouncement,
  reopenAsks,
  reopenQuestion,
  tickPressNotice,
  justClosedName,
  justOpenedName,
  perGameFigure,
  keepNamesWhole,
  KICKER_TIER_MIN_WIDTH,
  listCountLine,
  marketColumns,
  marketLayout,
  marketSortOptions,
  netTone,
  nextSortState,
  orderLine,
  orderLineForm,
  lockLineShort,
  lockLineUnbroken,
  slotLineNarrow,
  otherSideGroup,
  otherSideGroupLine,
  questionScrollDelta,
  otherSideReason,
  otherSideSaving,
  phoneRowPhoto,
  slotLineBeside,
  slotRoomFirst,
  foldedSlotBeside,
  fullTierFits,
  rowActions,
  rowKicker,
  rowHeaderLabel,
  rowHeaderName,
  rowProfileLabel,
  rowTier,
  pinnedChromeTooTall,
  heldLineWordings,
  heldTag,
  endedShortTag,
  seasonEndSlotLine,
  seasonEndStatusShown,
  unlistedGuessLine,
  unlistedSearch,
  unlistedStarLine,
  seasonEndExplainer,
  priceWidthReserve,
  rowsUnderToolbarTooFew,
  rowValueEdge,
  shortTableFolds,
  slotLinesCrowded,
  crowdedToolbarFolds,
  tablePinsChrome,
  shortTierLabel,
  ROOMY_MIN_HEIGHT,
  sameMarketRowProps,
  tierLabel,
  SEARCH_NEEDS_LETTERS,
  searchHasLetters,
  rosterPickReason,
  SHORT_WINDOW_BELOW,
  slotLine,
  flippedSortNote,
  sortedLine,
  sortMarketRows,
  keepListOrder,
  lastSlotTakenBy,
  savingMoves,
  spokenForNote,
  heldOrderLine,
  resortName,
  resortedLine,
  resortsAfterRun,
  sameOrder,
  shortTermLine,
  unheldProfitWords,
  unheldValueLines,
  valueDefinition,
  listHeading,
  surnameFontSize,
  searchFocusOnOpen,
  searchWidens,
  SEARCH_WIDENS_BELOW,
  searchFooterLine,
  searchMatchLine,
  stillFilteredLine,
  valueLineParts,
  watchingLine,
  VALUE_ONE_LINE_MIN_WIDTH,
  valueByPosition,
  valueColumnExplanation,
  waitingActionName,
  waitingForLine,
  REFUSED_MARK_MS,
  refusedActionName,
  refusedWord,
  valueSignal,
  type MarketColumnSet,
  type MarketLayout,
  type MarketSort,
  type SignalTone,
} from '../data/marketView';
import {
  MARKET_DEFAULT_SORT,
  marketMemory,
  explainerDone,
  markExplained,
  openingSide,
  rememberMarket,
  restoresPlace,
  rememberTierAfterSurname,
  tierAfterSurnameKey,
  tierAfterSurnameKnown,
} from '../data/marketViewMemory';
import type { ValueSummary } from '../data/perGameMetrics';
import { positionSlotHint } from '../data/perGameRules';
import { splitPlayerName } from '../data/playerName';
import { usePerGame } from '../state/PerGameContext';
import { practicePlaying, usePracticePlaying } from '../state/practicePlaying';
import { buildPerGameMarketRows, type PerGameMarketRow } from '../state/perGameState';
import { requestRosterPick } from '../state/uiActions';
import { useWatchlist } from '../state/watchlist';
import { colors, control, fonts, labelStyle, space, type, weight } from '../theme';
import { rowMarker } from '../ui/domMarkers';
import { Button, ConfirmStrip, EmptyState, headingLevel, repeatSafe, Segmented, Tag, tapsSettling, useCooldown, visuallyHidden } from '../ui/kit';

// Start listening at load, so the press that first opens the Market is seen.
listenForActivations();

const PHONE_ACTION_WIDTH = 76;
/**
 * Header spacer for the table rows' watch star: the row puts space.sm + a
 * 44px star + space.sm before the avatar; the header's own inset and gap
 * make up the rest, so the columns stay aligned.
 */
const STAR_LEAD = space.sm + control.height + space.sm - space.lg - 12;
const PHONE_AVATAR = 34;
/**
 * Lists up to this long are drawn whole, so a screen reader's element list
 * and find reach every player at any zoom (walk 7 T3-11: 18-25 of 30 at
 * 195x422); longer ones render in windows as before.
 */
const WHOLE_LIST_MAX = 60;
/** From this width the toolbar's lock line keeps to one line. */
const LOCK_LINE_ROOMY_WIDTH = 1280;
/**
 * Below this height (a laptop: 1366x768, 1152x720) the tall table's
 * sentence slot gives way to the one-line order strip once the first games
 * are in, so a row more shows (walk 9 T2-12).
 */
const LAPTOP_HEIGHT_BELOW = 820;
/** Phone row padding: 44px band + one value line keeps six rows above the fold. */
const ROW_PAD = 6;
/** A second press on Drop/Close this soon after it opened its question is the same tap bouncing (the Roster's 400 ms). */
const QUESTION_DOUBLE_TAP_MS = 400;
/** Folds the one FULL note that is open, if any (walk 8 T4-09: one at a time). */
let openFullNote: (() => void) | null = null;
/**
 * The Drop or Close question open on a row, with the layout that drew it: the
 * table and the phone list draw different rows, so a resize or a rotation
 * across the breakpoint remounts every row, and the question vanished with
 * focus thrown to the top (walk 11 T4-05). The row drawn in the other layout
 * reopens it, and the strip puts focus on Keep again. Coming back to the
 * Market in the same layout starts without it.
 */
let openQuestion: { key: string; layout: MarketLayout } | null = null;
// Widths where a part of the slot line wrapped past two lines beside the side
// toggle (a reader's text spacing): there it sits under the toggle for the
// rest of the visit, so coming back draws it in place at once (walk 15 T3-01).
const slotUnderWidths = new Set<number>();
// The step of a held row's second line every held row shows, per width,
// layout and side, for the rest of the visit (walk 15 T1-02).
const heldFloorMemory = new Map<string, number>();
// Where a held row had to drop its per-game average, every held row drops it,
// per width, layout and side, for the rest of the visit (walk 16 T1-13).
const averageDroppedAt = new Set<string>();

/** The player whose Drop or Close question is open on `side`, if any. */
function askingOn(side: PerGamePositionSide): string | null {
  const prefix = `${side}:`;
  return openQuestion?.key.startsWith(prefix) ? openQuestion.key.slice(prefix.length) : null;
}


/** Keep the last two words together ("Oct 31", "to add"), so no line ends in a lone word. */
function unbrokenTail(text: string): string {
  return text.replace(/ (\S+)$/, '\u00A0$1');
}

/**
 * Runs `run` once the browser has painted the frame a press drew: a timer
 * after the next animation frame. A move's work (the whole app redraws with
 * the new snapshot) then never holds back the button's own answer.
 */
function afterPaint(run: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(run, 0));
  else setTimeout(run, 0);
}

/** Marks a phone row's given name (`data-kicker-given`), so the list can tell when one is cut. */
const givenMarker = { dataSet: { kickerGiven: '1' } } as object;

/** The row's hover marker, plus its player (`data-player`), so the list can find its place by player. */
function playerMarker(playerId: string): object {
  return rowMarker.dataSet ? { dataSet: { ...rowMarker.dataSet, player: playerId } } : rowMarker;
}

/**
 * True when a sheet's close came from a tap on its dimmed backdrop right over
 * the row of `playerId` (the row that opened it). Read from the page: the
 * backdrop is the empty, full-window layer on top at the tap's point, and his
 * row's box (inert behind it) holds that point. A close from a button or a
 * key has no such point.
 */
function scrimTapOnPlayer(event: unknown, playerId: string | null): boolean {
  if (!playerId || typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') return false;
  const native = (event as { nativeEvent?: { pageX?: unknown; pageY?: unknown } } | null | undefined)?.nativeEvent;
  if (typeof native?.pageX !== 'number' || typeof native.pageY !== 'number') return false;
  const x = native.pageX - window.scrollX;
  const y = native.pageY - window.scrollY;
  const top = document.elementFromPoint(x, y);
  if (!top || top.childElementCount > 0) return false;
  const box = top.getBoundingClientRect();
  if (box.width < window.innerWidth * 0.9 || box.height < window.innerHeight * 0.9) return false;
  return Array.from(document.querySelectorAll('[data-player]')).some((node) => {
    if (node.getAttribute('data-player') !== playerId) return false;
    const row = node.getBoundingClientRect();
    return row.width > 0 && x >= row.left && x <= row.right && y >= row.top && y <= row.bottom;
  });
}

/** The id of a phone row's list item, owned by the list before the rows. */
function listItemId(side: PerGamePositionSide, playerId: string): string {
  return `market-item-${side}-${playerId}`;
}

type AnchorNode = {
  getBoundingClientRect: () => { top: number; bottom: number };
  querySelectorAll: (selector: string) => ArrayLike<AnchorNode & { getAttribute: (name: string) => string | null }>;
  scrollTop: number;
};

/** The list's first visible player and how far his row's top sits below the list's top (web). */
function readAnchor(node: AnchorNode | undefined): { id: string; dy: number } | null {
  if (!node?.querySelectorAll) return null;
  const top = node.getBoundingClientRect().top;
  const rows = node.querySelectorAll('[data-player]');
  for (let index = 0; index < rows.length; index += 1) {
    const rect = rows[index].getBoundingClientRect();
    const id = rows[index].getAttribute('data-player');
    // The first row mostly in view: a sliver of the one above him is not the
    // player you are looking at (walk 14 T4-04: a 7px sliver was kept, and
    // the player under it came back half under the table's pinned labels).
    if (id && rect.bottom > top + Math.max(1, (rect.bottom - rect.top) / 2)) return { id, dy: rect.top - top };
  }
  return null;
}

/** Why a locked button is dimmed, in the app's one lock sentence. */
function rosterLockMessage(gameDate: string | null): string {
  return `Roster changes are locked. ${rosterReopensLine(gameDate)}.`;
}

/**
 * Lays its children over one another and takes the tallest one's height: the
 * first is shown, the rest are invisible stand-ins for what the row will say
 * after an Add or a Drop. A phone row therefore keeps its height when a
 * player is added, so the next row's Add never moves under the finger
 * (lead L-01).
 */
function SameHeight({ children, ghosts }: { children: ReactNode; ghosts: ReactNode[] }) {
  return (
    <View style={styles.sameHeight}>
      <View style={styles.sameHeightLayer}>{children}</View>
      {ghosts.map((ghost, index) => (
        <View
          key={index}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.sameHeightLayer, styles.sameHeightGhost, NO_POINTER]}
          {...({ 'aria-hidden': true } as object)}
        >
          {ghost}
        </View>
      ))}
    </View>
  );
}

/** The context's moves, behind one stable object so a row's props do not change with every snapshot. */
type MarketMoves = Pick<ReturnType<typeof usePerGame>, 'closePosition' | 'dismissNotice' | 'lockedPress' | 'notify' | 'openPosition'>;

const TONE_COLOR: Record<SignalTone, string> = {
  gain: colors.green,
  loss: colors.red,
  even: colors.muted,
  none: colors.faint,
};

function MarketRow({
  row,
  layout,
  columns,
  currentValue,
  pastValue,
  fee,
  dropImpactBps,
  wholeNames,
  seasonOver,
  width,
  priceReserve,
  fullTier,
  tierAfterSurname,
  onOpenProfile,
  onAnnounce,
  watched,
  onToggleWatch,
  dimmed = false,
  heldFloor = 0,
  onHeldStep,
  dropAverage = false,
  onAverageDropped,
  pending,
  ownSaving,
  busyElsewhere,
  tableRoles = false,
  lastSlotTo,
  onClaimSlot,
  onReleaseSlot,
  rosterLocked,
  rosterLockGameDate,
  slotLimit,
  moves,
}: {
  row: PerGameMarketRow;
  layout: MarketLayout;
  columns: MarketColumnSet;
  /** The position you hold on this side now (positionValue: the Roster row's numbers). */
  currentValue: ValueSummary | undefined;
  /** Every earlier stint with him on this side, for a player you do not hold now. */
  pastValue: ValueSummary | undefined;
  fee: number;
  /** The ruleset's drop impact: the drop question quotes his price right after (walk 11 T1-05). */
  dropImpactBps: number;
  /** Keep hyphenated names whole (there is room for them on this width). */
  wholeNames: boolean;
  /** No games are left: the row carries no button, so nothing can charge a fee. */
  seasonOver: boolean;
  /** The screen width: below 380px the kicker leaves out the tier. */
  width: number;
  /** The widest price text the list can show (priceWidthReserve): the phone price box's width. */
  priceReserve: string;
  /** The list says "Role player" at this width (fullTierFits), else "Role" on every row. */
  fullTier: boolean;
  /** Some given name was cut beside its tier: the tier goes after the surname on every row. */
  tierAfterSurname: boolean;
  onOpenProfile: (playerId: string) => void;
  onAnnounce: (message: string) => void;
  /** On your watchlist; the table row carries a star to change it in place. */
  watched: boolean;
  onToggleWatch: (playerId: string) => void;
  /** Unwatched while the Watching filter is on: kept in place, dimmed, until the filter changes. */
  dimmed?: boolean;
  /** The step every held row of this list shows at least (heldStepFloor, walk 15 T1-02). */
  heldFloor?: number;
  /** A held row whose second line needs a more compact step than the list's says so here. */
  onHeldStep?: (step: number) => void;
  /** Every held row of this list leaves out its per-game average (heldFirstStep, walk 16 T1-13). */
  dropAverage?: boolean;
  /** A held row that could not keep its average on its line says so here. */
  onAverageDropped?: () => void;
  /** This row's own move is on its way (or waiting its turn). */
  pending: boolean;
  /** An Add pressed on this side of this screen is still saving: "Added ✓" holds, even after a side switch. */
  ownSaving: boolean;
  /** A row of the tall desktop's table (walk 8 T3-09): row and cells for screen readers. */
  tableRoles?: boolean;
  /** His Add (or Short) on the other side is still saving: busy here, with no button (walk 8 T4-07). */
  busyElsewhere: { tag: string; reason: string } | null;
  /** Another player's Add still saving takes this side's last free slot: FULL now, says whose. */
  lastSlotTo: string | null;
  /** Claims a free slot for this row's press; the name of whose Add took the last one when none is left. */
  onClaimSlot: (side: PerGamePositionSide, playerId: string) => string | null;
  onReleaseSlot: (side: PerGamePositionSide, playerId: string) => void;
  rosterLocked: boolean;
  rosterLockGameDate: string | null;
  /** How many players this side holds at most (the FULL note says it). */
  slotLimit: number;
  moves: MarketMoves;
}) {
  const { closePosition, dismissNotice, lockedPress, notify, openPosition } = moves;
  const { player, position, side } = row;
  const rosterLockHint = rosterLockMessage(rosterLockGameDate);
  // Another move saving does not rest this row: a press joins the queue and
  // plays when that move lands (walk 5 T4-01, with a slow connection too).
  // Spoken for: another Add still saving takes the last slot (walk 7 T4-01).
  const spokenFor = lastSlotTo !== null && !position;
  const disabled = !row.canSubmit || spokenFor || pending || rosterLocked || seasonOver;
  const currentGameCost = player.currentGameCost;
  const priorSeasonValuePerGame = player.priorSeasonValuePerGame;
  const { given, surname } = splitPlayerName(player.name);
  const whole = (text: string) => (wholeNames ? unbrokenName(text) : text);
  // One tier word per list: a narrow table's held rows need "Role" beside
  // their chip, so every row there says "Role" (walk 6 T1-01, T4-03).
  const tableTier = columns.yours === 0 ? shortTierLabel(player.tier) : tierLabel(player.tier);
  const kicker = whole(layout === 'table'
    ? (tableTier ? `${given}\u00A0· ${tableTier}` : given)
    : rowKicker(given, player.tier, width));
  // A phone row names the tier on every row, held or not, in the list's one
  // word for this width and in one place for this width: beside the given
  // name from 380px (a long given name is cut short first), after the
  // surname below that (walk 6 T4-06; walk 5 T1-03).
  const phone = layout === 'phone';
  const fitted = rowTier({ given, tier: player.tier, width, fullTier });
  // A given name cut on any row (a text-spacing style, walk 7 T3-07) puts
  // every row's tier after the surname, as narrow phones do.
  const phoneTier = tierAfterSurname ? { ...fitted, place: 'after' as const } : fitted;
  // Below 380px (the large-text row) the tier follows the surname, so every
  // width says the same thing. The chevron says the row opens more.
  const tierAfter = phone
    ? (phoneTier.place === 'after' ? phoneTier.tier : '')
    : width < KICKER_TIER_MIN_WIDTH && player.tier ? tierLabel(player.tier) : '';
  // The surname keeps its plain hyphen: a line that holds it keeps it whole,
  // and one that cannot (a text-spacing style at 320px) breaks at the hyphen,
  // never inside a word ("Gilgeous-Alexand / er", walk 9 T3-11).
  const nameLine = (
    <>
      {surname}
      {/* One span, kept together, so a wrapped line never splits it. */}
      <Text style={tierAfter ? styles.tierInline : styles.chevron}>
        {tierAfter ? `\u2002${tierAfter.replace(' ', '\u00A0')}\u00A0›` : '\u2002›'}
      </Text>
    </>
  );
  const [priceAmount, priceUnit] = perGameShort(currentGameCost).split('/');
  // A large-text row's surname shrinks until its longest word fits its line,
  // never broken mid-word (walk 7 T4-08: "Antetokounm / po" at 180px).
  const largeNameSize = layout === 'large'
    ? surnameFontSize(whole(surname), width - 2 * space.md - PHONE_AVATAR - 10, type.value)
    : type.value;

  // After an Add or Short the same spot shows "Added ✓" for a moment and takes
  // no taps, so a double or triple tap never lands on Drop or Close. The
  // cooldown starts on the tap and restarts when the add lands.
  const [cooling, startCooling] = useCooldown(JUST_OPENED_MS);
  const lastAction = useRef<'open' | 'close' | null>(null);
  // The press paints its result at once (walk 5 T2-18: 350 ms on a slow
  // laptop): "Added ✓" shows while the move is on its way, and a move that
  // fails reverts it while the notice says why.
  const [optimistic, setOptimistic] = useState<'open' | 'close' | null>(null);
  // An Add or Short pressed while practice games play waits for them (walk 9
  // T4-04): the button says "Waiting" in neutral ink, not a tick the games
  // may take back, until the move goes through ("Added ✓") or reverts.
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  // An Add or Short that waited for games and was refused as they landed (his
  // price moved, or they brought a lock) marks this row for a few seconds:
  // "Not added", named with the new price, and still pressable (walk 16
  // T4-09: the rows went straight back to plain ADD). Read from the row's own
  // figures, so it says the price the row shows.
  const [refusedAt, setRefusedAt] = useState<number | null>(null);
  useEffect(() => {
    if (refusedAt === null) return undefined;
    const timer = setTimeout(() => setRefusedAt(null), REFUSED_MARK_MS);
    return () => clearTimeout(timer);
  }, [refusedAt]);
  const pressedQuote = useRef<number | null>(null);
  // Rows are keyed by side, so the tick stays on the side it was pressed on
  // (walk 8 T4-07); coming back to that side while it saves shows it again.
  const opening = optimistic === 'open' || (optimistic === null && ownSaving && !position);
  // A Drop confirmed while games play waits for them: he stays held (he
  // plays them) and the button says "Waiting", never "Dropped ✓" (walk 15 T4-06).
  const closingWaits = optimistic === 'close' && waitingFor !== null;
  const shownHeld = opening ? true : optimistic === 'close' && !closingWaits ? false : position !== null;
  // Held for as long as the move is on its way (a queued move can outlast the
  // cooldown), then for the cooldown once it lands.
  const justOpened = opening || (cooling && lastAction.current === 'open' && position !== null);
  const justClosed = optimistic === 'close' || (cooling && lastAction.current === 'close' && position === null);

  // Drop and Close ask in a strip under the row (fee, what stays, what coming
  // back costs). It waits for Keep, Escape or the costly button: no timeout.
  const questionKey = `${side}:${player.playerId}`;
  const [confirming, setConfirmingState] = useState(() => (
    openQuestion !== null && openQuestion.key === questionKey && openQuestion.layout !== layout && position !== null
  ));
  const confirmingRef = useRef(confirming);
  confirmingRef.current = confirming;
  const setConfirming = (on: boolean) => {
    if (on) openQuestion = { key: questionKey, layout };
    else if (openQuestion?.key === questionKey) openQuestion = null;
    setConfirmingState(on);
  };
  // Once drawn, this layout owns the question (or a stale record goes).
  useEffect(() => {
    if (openQuestion?.key !== questionKey) return;
    openQuestion = confirmingRef.current ? { key: questionKey, layout } : null;
  }, [questionKey, layout]);
  // A new position or a row that can no longer act folds the question; a
  // remount (the table/list switch) does not.
  const questionDeps = useRef(`${position?.positionId ?? ''}|${disabled}`);
  useEffect(() => {
    const deps = `${position?.positionId ?? ''}|${disabled}`;
    if (questionDeps.current === deps) return;
    questionDeps.current = deps;
    setConfirming(false);
  }, [position?.positionId, disabled]);
  // Keyboard focus stays in the row: the button keeps its focus through
  // "Wait" and "Added ✓" (it stays focusable), and when the strip closes
  // (Keep, Escape or the costly button) focus returns to the row's button.
  const actionRef = useRef<View>(null);
  const refocus = useRef(false);
  const closeStrip = () => {
    refocus.current = true;
    setConfirming(false);
  };
  // FULL answers a tap: a note under the row says why and offers the Roster.
  const fullOffer = (row.isFull || spokenFor) && !position && !pending && !rosterLocked && !seasonOver;
  const [noting, setNoting] = useState(false);
  const closeNote = useCallback(() => {
    refocus.current = true;
    setNoting(false);
  }, []);
  useEffect(() => {
    if (!fullOffer) setNoting(false);
  }, [fullOffer]);
  // One FULL note open at a time: opening another folds the last one, which
  // leaves focus where it is, on the new note (walk 8 T4-09).
  const [foldNote] = useState(() => () => setNoting(false));
  useEffect(() => {
    if (!noting) return undefined;
    if (openFullNote && openFullNote !== foldNote) openFullNote();
    openFullNote = foldNote;
    return () => {
      if (openFullNote === foldNote) openFullNote = null;
    };
  }, [noting, foldNote]);
  useEffect(() => {
    if (confirming || noting || !refocus.current) return;
    refocus.current = false;
    (actionRef.current as unknown as { focus?: () => void } | null)?.focus?.();
  }, [confirming, noting]);
  const waiting = waitingFor !== null && (opening || optimistic === 'close');
  // Add or Short him: painted at once, then saved (or queued behind games).
  const openNow = () => {
    // A press in the same moment as another Add into the last slot:
    // FULL's note says whose Add took it, and nothing is painted added.
    const takenBy = onClaimSlot(side, player.playerId);
    if (takenBy) {
      dismissNotice();
      setNoting(true);
      return;
    }
    closedAt.current = 0;
    lastAction.current = 'open';
    setOptimistic('open');
    setRefusedAt(null);
    const waited = practicePlaying();
    pressedQuote.current = player.quoteVersion;
    setWaitingFor(waited);
    startCooling();
    // The move starts once "Added ✓" (or "Waiting") is on screen.
    afterPaint(() => {
      void openPosition({
        playerId: player.playerId,
        playerName: player.name,
        side,
        expectedQuoteVersion: player.quoteVersion,
      }).then((opened) => {
        setOptimistic(null);
        setWaitingFor(null);
        onReleaseSlot(side, player.playerId);
        if (opened) startCooling();
        else if (waited !== null) setRefusedAt(Date.now());
      }, () => {
        setOptimistic(null);
        setWaitingFor(null);
        onReleaseSlot(side, player.playerId);
      });
    });
  };
  // The mark shows while he is still unheld and nothing else is under way.
  // A lock the games brought is the reason first: his price moves with every
  // night, so a price check first named a price for a move the lock refused
  // ("Not added: his price moved to $332.1K" under "Moves pause for the Oct
  // 28 games, so … were not added"; walk 16 lead).
  const refusal = refusedAt !== null && !position && !waiting && !opening && !justOpened && !justClosed && !confirming
    ? rosterLocked
      ? refusedActionName(side, player.name, currentGameCost, true)
      : player.quoteVersion !== pressedQuote.current ? refusedActionName(side, player.name, currentGameCost) : null
    : null;
  const word = waiting ? 'Waiting' : refusal ? refusedWord(side) : actionWord({
    side,
    held: shownHeld,
    pending,
    rosterLocked,
    full: row.isFull || spokenFor,
    justOpened,
    justClosed,
  });
  // FULL is a way to make room, not a switched-off button (walk 8 T1-11): a
  // live, solid-edged button whose press opens the note. LOCKED rests, dashed.
  const fullButton = word === 'Full' && fullOffer;
  // The button rests (dimmed, taps ignored, still in the Tab order) while it
  // cannot act, and says so to assistive tech. With its question open it does
  // not rest: it looks pressed, as on the Roster, and a second tap folds the
  // question like Keep (walk 6 T4-05, T1-14: dashed read as "you can't").
  const resting = (disabled || justOpened || justClosed) && !fullButton;
  useAriaDisabled(actionRef, resting);
  const askedAt = useRef(0);
  // When his Drop or Close landed: for a few seconds after, Add or Short asks
  // before buying him back (walk 13 T4-11).
  const closedAt = useRef(0);
  const reopening = confirming && !position;
  useEffect(() => {
    const node = actionRef.current as unknown as { setAttribute?: (name: string, value: string) => void; removeAttribute?: (name: string) => void } | null;
    if (!node?.setAttribute || !node.removeAttribute) return;
    // Only Drop/Close (its question) and FULL (its note) open something; the
    // "Added ✓" beat is neither, so it is never "collapsed" (walk 8 T3-04).
    // A quick comeback's question is open while it asks.
    if (position && !resting) node.setAttribute('aria-expanded', confirming ? 'true' : 'false');
    else if (fullButton) node.setAttribute('aria-expanded', noting ? 'true' : 'false');
    else if (reopening) node.setAttribute('aria-expanded', 'true');
    else node.removeAttribute('aria-expanded');
  });
  // A double tap opens the note once (a toggle, walk 6 T4-11).
  const toggleNote = repeatSafe(() => {
    dismissNotice();
    setNoting((open) => !open);
  });

  // One line of meaning under the name: your stake when you hold him on this
  // side, the other side's tag when that blocks this side, otherwise last
  // season against his price today.
  const signal = valueSignal(player, side);
  const held = position ? heldDetail(currentValue, position.lockedGameCost) : null;
  // A held phone row's first value line leads with the total and adds the
  // average while both fit on its one line (walk 10 T1-05); measured before
  // paint, so a line that would wrap never shows (every row keeps one height).
  // It tries shorter wordings until one fits (the why short, the total
  // alone, the figure alone), so no line ends with one word left over (walk
  // 12 T1-05: "(a below-zero" / "night)" at 360px).
  const heldFirstRef = useRef<Text>(null);
  const wordings = held ? heldLineWordings(held, width < HELD_NOW_MIN_WIDTH) : null;
  const fitKey = `${width}|${layout}|${heldTag(side, seasonOver)}|${held?.text ?? ''}|${held?.why ?? ''}`;
  const [fit, setFit] = useState<{ key: string; step: number } | null>(null);
  const ownFitStep = wordings ? Math.min(fit && fit.key === fitKey ? fit.step : 0, wordings.length - 1) : 0;
  const hasAverage = held !== null && held.text !== held.total;
  const fitStep = wordings ? heldFirstStep(ownFitStep, dropAverage, hasAverage, wordings.length) : 0;
  const heldShown = wordings ? wordings[fitStep] : null;
  useLayoutEffect(() => {
    if (!wordings) return;
    if (!dropAverage && heldDropsAverage(ownFitStep, hasAverage)) onAverageDropped?.();
    if (fitStep >= wordings.length - 1) return;
    const node = heldFirstRef.current as unknown as HTMLElement | null;
    const box = node?.getBoundingClientRect?.();
    if (!node || !box || !(box.height > 0)) return;
    // detailText is one 17px line; two lines are 34.
    const line = typeof getComputedStyle === 'function' ? parseFloat(getComputedStyle(node).lineHeight) : NaN;
    if (box.height > (line > 0 ? line * 1.5 : 26)) setFit({ key: fitKey, step: fitStep + 1 });
  });
  // Once he has played for you, the second line leads with today's price and
  // says last season as history where it fits (walk 14 T1-09), the fullest
  // wording that keeps one line, measured before paint like the first line.
  const played = position !== null && currentValue !== undefined && currentValue.avgNet !== null && currentValue.games > 0;
  const heldSecondRef = useRef<Text>(null);
  const playedWordings = position && played ? heldPlayedWordings(player, side, position.lockedGameCost) : null;
  const secondKey = `${width}|${layout}|${playedWordings?.join('|') ?? ''}`;
  const [secondFit, setSecondFit] = useState<{ key: string; step: number } | null>(null);
  // Its own step, and the list's: every held row shows the most compact any
  // of them needs, so the rows say the same things (walk 15 T1-02).
  const ownSecondStep = playedWordings ? Math.min(secondFit && secondFit.key === secondKey ? secondFit.step : 0, playedWordings.length - 1) : 0;
  const secondStep = playedWordings ? Math.min(Math.max(ownSecondStep, heldFloor), playedWordings.length - 1) : 0;
  const playedShown = playedWordings ? playedWordings[secondStep] : null;
  useLayoutEffect(() => {
    if (!playedWordings) return;
    if (ownSecondStep > heldFloor) onHeldStep?.(ownSecondStep);
    if (secondStep >= playedWordings.length - 1) return;
    const node = heldSecondRef.current as unknown as HTMLElement | null;
    const box = node?.getBoundingClientRect?.();
    if (!node || !box || !(box.height > 0)) return;
    const line = typeof getComputedStyle === 'function' ? parseFloat(getComputedStyle(node).lineHeight) : NaN;
    if (box.height > (line > 0 ? line * 1.5 : 26)) setSecondFit({ key: secondKey, step: secondStep + 1 });
  });
  // His move on the other side still saving: shown as he will be once it
  // saves (no button here), in place, saying it is on its way.
  const busy = busyElsewhere !== null && !position && !row.blockedByOpposingPosition;
  const blocked = (row.blockedByOpposingPosition || busy) && !position;
  // At season end a player held on the other side only says where he is (walk 10 T2-04).
  const blockedReason = otherSideReason(side, row.unavailableReason, seasonOver);
  const tagText = position
    ? heldTag(side, seasonOver)
    : busy && busyElsewhere
      ? busyElsewhere.tag
      : blocked ? heldTag(side === 'long' ? 'short' : 'long', seasonOver) : null;
  const table = layout === 'table';
  const large = layout === 'large';
  const actionWidth = table ? columns.action : PHONE_ACTION_WIDTH;

  // A held row: your result so far, then his Value at the price you locked
  // (the Roster's figure) and today's price (walk 5 T4-02, T1-02, T2-06).
  // Every phone row breaks its value after the first line, so each row has
  // the same height (walk 5 T1-04); a phone turned sideways keeps one line.
  const oneLine = width >= VALUE_ONE_LINE_MIN_WIDTH;
  const valueLines = (first: ReactNode, second: ReactNode) => (
    <View style={oneLine ? styles.detailLine : styles.detailLines}>
      {first}
      {second}
    </View>
  );
  // No line ever ends on a lone "·" (walk 7 T1-02): on two lines the first
  // drops it; on one line it leads the second part (valueLineParts).
  const joiner = valueLineParts('', '', oneLine).joiner;
  const heldLine = (text: string, tone: SignalTone, value: ReturnType<typeof heldValueLine>, why: string | null = null, firstRef?: RefObject<Text | null>, playedLine: string | null = null) => valueLines(
    <Text ref={firstRef} maxFontSizeMultiplier={1.6} style={[styles.detailText, styles.heldText]}>
      {`${heldTag(side, seasonOver)} · `}
      <Text style={{ color: TONE_COLOR[tone] }}>{text}</Text>
      {/* Why a result is bigger than his price, muted (walk 10 T1-03). */}
      {why ? <Text style={styles.leadText}>{` (${why})`}</Text> : null}
    </Text>,
    // Last season against your price, in neutral ink: the row's only
    // coloured figure is what he made you (walk 9 T1-06). Once he has
    // played for you, today's price leads and last season is history.
    <Text ref={playedLine !== null ? heldSecondRef : undefined} maxFontSizeMultiplier={1.6} style={[styles.detailText, styles.leadText]}>
      {joiner ? <Text style={styles.leadText}>{joiner}</Text> : null}
      {playedLine ?? value.value}
      {playedLine === null && width >= HELD_NOW_MIN_WIDTH ? <Text style={styles.leadText}>{` ·\u00A0${value.now}`}</Text> : null}
    </Text>,
  );
  const unheldLineFor = (shown: typeof signal) => {
    const lines = unheldValueLines(shown);
    const parts = valueLineParts(lines.first, lines.second, oneLine);
    return valueLines(
      <Text maxFontSizeMultiplier={1.6} style={[styles.detailText, styles.leadText]}>{parts.first}</Text>,
      // At season end the figures only say how he did, in muted ink, never a
      // green invitation ("+$67.9K for a short", walk 11 T1-13).
      <Text maxFontSizeMultiplier={1.6} style={[styles.detailText, { color: seasonOver ? colors.muted : TONE_COLOR[shown.tone] }]}>
        {parts.joiner ? <Text style={styles.leadText}>{parts.joiner}</Text> : null}
        {parts.second}
      </Text>,
    );
  };
  const unheldLine = unheldLineFor(signal);
  // The held row's invisible copy of its unheld line uses the price it was
  // added at, i.e. the words the row showed a moment before the Add, so the
  // copy wraps exactly as they did.
  const unheldGhost = position
    ? unheldLineFor(valueSignal({ ...player, currentGameCost: position.lockedGameCost }, side))
    : unheldLine;
  // An unheld row's copy of its held line locks today's price, as an Add would.
  const heldValue = heldValueLine(player, side, position ? position.lockedGameCost : currentGameCost);
  // What this row says now, over invisible copies of what it would say after
  // an Add (or a Drop), so its height never changes with the tap.
  const valueLine = position && held ? (
    // Below 360px the why is said short, and a line too narrow for the
    // average too keeps the total, so it stays one line (walk 10 T1-03, T1-05).
    <SameHeight ghosts={[unheldGhost]}>
      {heldLine(heldShown ? heldShown.text : held.total, held.tone, heldValue, heldShown ? heldShown.why : held.why, heldFirstRef, playedShown)}
    </SameHeight>
  ) : blocked ? (
    <SameHeight ghosts={[unheldLine]}>
      <View style={styles.detailLine}>
        <Tag>{tagText}</Tag>
      </View>
    </SameHeight>
  ) : (
    <SameHeight ghosts={[heldLine(heldDetail(undefined, currentGameCost).text, 'none', heldValue)]}>{unheldLine}</SameHeight>
  );

  // A held row leads with the price you locked (walk 4 T1-19); today's price
  // is on its value line ("now $418.5K"). It keeps the "/game" of every other
  // price (walk 10 T1-02), and says "yours" where that fits beside the name
  // without a second line (heldPriceSaysYours), so it is never wider than an
  // unheld box on a phone and every row keeps one height.
  const heldPriceBox = (amount: string) => (
    <View style={styles.priceBox}>
      {heldPriceSaysYours(width, large) ? <Text maxFontSizeMultiplier={1.6} style={styles.priceUnit}>{'yours '}</Text> : null}
      <Text maxFontSizeMultiplier={1.6} style={styles.price}>{amount}</Text>
      <Text maxFontSizeMultiplier={1.6} style={styles.priceUnit}>{`/${priceUnit}`}</Text>
    </View>
  );
  const plainPriceBox = (amount: string) => (
    <View style={styles.priceBox}>
      <Text maxFontSizeMultiplier={1.6} style={styles.price}>{amount}</Text>
      <Text maxFontSizeMultiplier={1.6} style={styles.priceUnit}>{`/${priceUnit}`}</Text>
    </View>
  );
  const marketPriceBox = plainPriceBox(priceAmount);
  // The widest price box either state can show, as an invisible width: the
  // given name beside it keeps the same room held or not, whatever the price
  // does after an Add (walk 11 lead note: 92 -> 102px at 390px).
  const priceWidth = priceReserve ? (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.priceReserve, NO_POINTER]}
      {...({ 'aria-hidden': true } as object)}
    >
      {heldPriceSaysYours(width, large) ? heldPriceBox(priceReserve) : plainPriceBox(priceReserve)}
    </View>
  ) : null;
  const priceBox = position ? heldPriceBox(perGameShort(position.lockedGameCost).split('/')[0]) : marketPriceBox;
  // The phone row's top line in both states: held (given name and tier,
  // "yours $X") and not held (given name and tier, today's price). Each is
  // drawn over an invisible copy of the other, so adding or dropping him
  // never changes the row's height, whichever one wraps.
  // The given name gives way (cut short) before the tier or the price move.
  const kickerWords = (
    <View style={styles.kickerParts}>
      <Text maxFontSizeMultiplier={1.6} numberOfLines={1} style={[styles.kicker, styles.kickerGiven]} {...givenMarker}>{whole(given)}</Text>
      {phoneTier.place === 'kicker' && phoneTier.tier ? (
        <Text maxFontSizeMultiplier={1.6} numberOfLines={1} style={[styles.kicker, styles.kickerTier]}>{`\u00A0· ${phoneTier.tier}`}</Text>
      ) : null}
    </View>
  );
  const kickerLine = (box: ReactNode) => (
    <View style={styles.kickerPriceLine}>
      {kickerWords}
      <View style={styles.priceEnd}>
        {box}
        {priceWidth}
      </View>
    </View>
  );
  // Held (given name and tier, "yours $X") or not (today's price): with the
  // price box's width reserved both lay out alike, so an Add or a Drop never
  // changes the row's height and no copy of the other line is needed.
  const topLine = position
    ? kickerLine(heldPriceBox(perGameShort(position.lockedGameCost).split('/')[0]))
    : kickerLine(marketPriceBox);

  const label = rowProfileLabel({
    name: player.name,
    tier: player.tier,
    price: currentGameCost,
    // A blocked row says why in the reason sentence instead.
    detail: blocked
      ? ''
      : position && held
        ? `${tagText}, ${held.text}${held.why ? ` (${held.why})` : ''}, ${heldValuePhrase(player, side, position.lockedGameCost, played)}`
        : [signal.lead?.replace(/ ·$/, ''), signal.text].filter(Boolean).join(', '),
    reason: blocked ? (busy && busyElsewhere ? busyElsewhere.reason : blockedReason) : null,
    // A held row's name leads with your price, as the row shows it.
    locked: position && !blocked ? position.lockedGameCost : null,
  });

  const openProfile = () => {
    // The second tap of a double tap on a confirm that just folded away.
    if (tapsSettling()) return;
    onOpenProfile(player.playerId);
  };
  // At season end the row is quiet: no button at all, and the header's one
  // line says the season is over.
  const cellRole = table && tableRoles ? ({ role: 'cell' } as object) : {};
  const action = !rowActions(seasonOver) ? null : (
    <View
      {...cellRole}
      accessibilityState={{ disabled }}
      style={[
        styles.actionCell,
        table
          ? { width: actionWidth }
          : large
            // At 400% zoom (about 100px wide) the name's indent would push the
            // button past the edge: it starts at the row's own inset instead.
            ? [styles.actionCellLarge, width < 160 && styles.actionCellTiny]
            : [styles.actionFloat, { width: actionWidth }],
      ]}
    >
      {blocked ? (table ? <Tag style={styles.cellTag}>{tagText}</Tag> : null) : (
        <Button
          ref={actionRef}
          accessibilityHint={rosterLocked ? rosterLockHint : row.unavailableReason ?? undefined}
          // A waiting move names its games; the lock it may meet is the notice's to say.
          {...((waiting ? { accessibilityHint: undefined } : {}) as object)}
          // FULL says why, with its own word in the name for voice control.
          accessibilityLabel={waiting && waitingFor
            ? waitingActionName(side, player.name, waitingFor, optimistic === 'close' ? 'close' : 'open')
            : refusal
            ? refusal
            : justOpened
            ? justOpenedName(side, player.name)
            : justClosed
              ? justClosedName(side, player.name)
              : word === 'Full'
                // Spoken for: whose saving Add took the last slot (walk 7 T4-01).
                ? spokenFor && lastSlotTo
                  ? `${fullActionName(side, player.name)}. ${spokenForNote(side, lastSlotTo, player.name, slotLimit).hint}`
                  : fullActionName(side, player.name)
                : actionName(position ? 'close' : 'open', side, player.name, currentGameCost)}
          // While the confirm strip is open the row's own button looks
          // pressed and a later tap folds it (a bounce does nothing). LOCKED
          // rests (dashed, full-contrast words): not now, press to learn why
          // (walk 4 T4-14, T1-24). FULL is live: it opens its note.
          disabled={resting}
          // "Added ✓" / "Dropped ✓": a move that just worked, in the success
          // colour, never the dashed "unavailable" look (walk 4 T2-03).
          done={(justOpened || justClosed) && !waiting}
          focusableWhenDisabled
          // LOCKED answers a tap with why and when, as on the Roster; a tap on
          // "Waiting", "Added ✓" or "Dropped ✓" says what the move did and what
          // the button will do once it is back (walk 12 T4-02: it was silent).
          // A press that raced the lock the games just brought is a refused
          // move, named with the games' notice (walk 12 T4-07).
          onDisabledPress={rosterLocked
            ? () => lockedPress({
              name: player.name,
              verb: position ? (side === 'long' ? 'dropped' : 'closed') : side === 'long' ? 'added' : 'shorted',
            })
            : waiting && waitingFor
              ? () => notify(`${waitingActionName(side, player.name, waitingFor, optimistic === 'close' ? 'close' : 'open')}.`)
              : justOpened || justClosed
                ? () => notify(tickPressNotice(side, player.name, justClosed, fee, optimistic !== null || opening))
                : undefined}
          label={fullButton ? FULL_BUTTON_WORDS : word}
          onPress={() => {
            // FULL opens a note under the row: why, and "Choose who to drop".
            // One message at a time: it replaces the last notice (walk 3 T3-15).
            if (fullButton) {
              toggleNote();
              return;
            }
            if (disabled) return;
            if (justOpened || justClosed) return;
            if (confirming) {
              // A double tap's second press must not fold the question the
              // first one opened; a later tap folds it, as Keep does.
              if (Date.now() - askedAt.current < QUESTION_DOUBLE_TAP_MS) return;
              closeStrip();
              onAnnounce(position ? keptAnnouncement(side, player.name) : reopenQuestion(side, player.name, currentGameCost, fee).kept);
              return;
            }
            if (position || reopenAsks(closedAt.current, Date.now())) {
              // Drop or Close asks; so does Add or Short a moment after he
              // was dropped or closed, where the tick just was (walk 13 T4-11).
              askedAt.current = Date.now();
              setConfirming(true);
            } else {
              openNow();
            }
          }}
          // "Dropped ✓" and "Shorted ✓" fit the phone button on one line (walk 5 T4-03).
          style={[!table && styles.phoneButton, !table && (justOpened || justClosed || fullButton) && styles.phoneButtonDone, confirming && styles.buttonArmed, fullButton && noting && styles.buttonArmed, waiting && styles.buttonWaiting]}
          textStyle={[styles.buttonText, (justOpened || justClosed) && !waiting && styles.buttonTextDone, fullButton && styles.buttonTextFull, (confirming || (fullButton && noting)) && styles.buttonTextArmed, waiting && styles.buttonTextWaiting]}
          width={large ? undefined : actionWidth}
        />
      )}
    </View>
  );

  // Keep sits at the right, where the row's button was; the costly button sits
  // to its left. Focus starts on Keep; Escape or Keep closes the strip.
  const strip = confirming && position ? (
    <ConfirmStrip
      confirmAccessibilityLabel={confirmCloseName(side, player.name, fee)}
      confirmLabel={confirmCloseButton(side, fee)}
      // One wording on every screen: the fee, what stays, and what coming
      // back would cost today.
      message={confirmCloseMessage({
        side,
        playerName: player.name,
        feeDollars: fee,
        total: position.cumulativePnl,
        // Left alone a short ends by itself on its last day, at no cost (walk 3 T1-N3).
        endsFreeAfter: position.expiresOn,
        priceNow: player.currentGameCost,
        // The comeback price as the Closed row shows it right after, as the
        // Roster and the profile ask (walk 11 T1-05).
        dropImpactBps,
      })}
      onCancel={() => {
        closeStrip();
        onAnnounce(keptAnnouncement(side, player.name));
      }}
      onConfirm={() => {
        closeStrip();
        lastAction.current = 'close';
        setOptimistic('close');
        setWaitingFor(practicePlaying());
        startCooling();
        afterPaint(() => {
          void closePosition(position).then((closed) => {
            setOptimistic(null);
            setWaitingFor(null);
            if (closed) {
              startCooling();
              closedAt.current = Date.now();
            }
          }, () => {
            setOptimistic(null);
            setWaitingFor(null);
          });
        });
      }}
      style={table ? styles.stripTable : undefined}
    />
  ) : reopening && !disabled ? (() => {
    // A moment after a Drop or Close, Add or Short asks first; its "Not now"
    // sits where the row's button is, so a late repeat never buys him back
    // (walk 13 T4-11).
    const question = reopenQuestion(side, player.name, currentGameCost, fee);
    return (
      <ConfirmStrip
        cancelLabel={question.cancel}
        confirmAccessibilityLabel={question.confirmName}
        confirmLabel={question.confirm}
        confirmVariant="primary"
        message={question.message}
        onCancel={() => {
          closeStrip();
          onAnnounce(question.kept);
        }}
        onConfirm={() => {
          closeStrip();
          openNow();
        }}
        style={table ? styles.stripTable : undefined}
      />
    );
  })() : null;
  const note = noting && fullOffer ? (() => {
    const { message, action: actionLabel } = spokenFor && lastSlotTo
      ? spokenForNote(side, lastSlotTo, player.name, slotLimit)
      : fullNote(side, player.name, slotLimit);
    return (
      <FullNote
        actionLabel={actionLabel}
        message={message}
        // The Roster brings the right list forward ("Your roster" or "Your
        // shorts") and says why the player is there.
        onAction={() => requestRosterPick(rosterPickReason(player.name, side), side, { playerId: player.playerId, playerName: player.name })}
        onClose={closeNote}
        style={table ? styles.stripTable : undefined}
      />
    );
  })() : null;

  // Unwatched under the Watching filter: the row stays, dimmed, and says why
  // at full contrast, with the way back (walk 3 T1-14). Watching him again
  // returns focus to the row, so it is never lost with the line.
  const starRef = useRef<View>(null);
  const profileRef = useRef<View>(null);
  const rewatched = useRef(false);
  useEffect(() => {
    if (dimmed || !rewatched.current) return;
    rewatched.current = false;
    const target = (table ? starRef.current : profileRef.current) as unknown as { focus?: () => void } | null;
    target?.focus?.();
  }, [dimmed, table]);
  const keptLine = dimmed ? (
    <View style={[styles.keptLine, table && styles.stripTable]}>
      {/* Names him, so the line reads whole beside a dimmed row (walk 4 T2-14). */}
      {/* His full name, then the way back; no dangling "·" (walk 6 T2-12). */}
      <Text maxFontSizeMultiplier={1.4} style={styles.keptText}>{`No longer watching ${whole(player.name)}`}</Text>
      <Button
        accessibilityLabel={`Watch ${player.name} again`}
        label="Watch again"
        onPress={repeatSafe(() => {
          rewatched.current = true;
          onToggleWatch(player.playerId);
        })}
        variant="quiet"
      />
    </View>
  ) : null;

  if (table) {
    const tableEdge = rowValueEdge(player, side, position);
    // Where his past figure shows (the Your profit column), an ended short says whose it was.
    const pastTag = columns.yours > 0 ? endedShortTag(side, seasonOver, position !== null, pastValue?.avgNet != null ? pastValue.games : 0) : null;
    // The table's cells as a screen reader moves through them (walk 8
    // T3-09): the star, the player (his profile button), each figure in its
    // column, the button. The figures drawn inside the profile button are
    // its presentational children, so each column also gets a said-only cell.
    const yoursWords = position && currentValue && currentValue.avgNet !== null && currentValue.games > 0
      ? `${perGameFigure(currentValue)}, ${currentValue.games === 1 ? '1 game' : `${currentValue.games} games`}${held?.why ? `, ${held.why}` : ''}`
      : position
        ? 'No games yet'
        : pastValue && pastValue.avgNet !== null && pastValue.games > 0
          ? `${perGameFigure(pastValue)}, ${pastValue.games === 1 ? '1 past game' : `${pastValue.games} past games`}`
          : unheldProfitWords(side, row.blockedByOpposingPosition);
    const saidCells = tableRoles ? [
      position ? `${money(position.lockedGameCost)}, ${heldPriceCaption(position.lockedGameCost, currentGameCost)}` : money(currentGameCost),
      priorSeasonValuePerGame === null ? 'no last season' : moneyCompact(priorSeasonValuePerGame),
      tableEdge === null
        ? 'no last season'
        : position
          ? `Last season ${netTone(tableEdge) === 'even' ? 'even' : signedMoneyCompact(tableEdge)}, at your price`
          : netTone(tableEdge) === 'even' ? 'Even' : signedMoneyCompact(tableEdge),
      ...(columns.yours > 0 ? [yoursWords] : []),
    ] : [];
    // A strip or note under the row spans the table's width as a row of its own.
    const spanCount = 5 + (columns.yours > 0 ? 1 : 0) + (action ? 1 : 0);
    const fullRow = (node: ReactNode) => (node && tableRoles ? (
      <View role="row">
        <View role="cell" {...({ 'aria-colspan': spanCount } as object)}>{node}</View>
      </View>
    ) : node);
    return (
      <>
      <View style={[styles.row, styles.rowTable]} {...playerMarker(player.playerId)} {...(tableRoles ? ({ role: 'row' } as object) : {})}>
        {dimmed ? <View style={[styles.dimMarker, NO_POINTER]} /> : null}
        <View style={styles.starWrap} {...cellRole}>
        <Pressable
          ref={starRef}
          accessibilityLabel={`Watch ${player.name}`}
          accessibilityRole="switch"
          accessibilityState={{ checked: watched }}
          aria-checked={watched}
          // A double tap stars him once (walk 6 T4-11).
          onPress={repeatSafe(() => onToggleWatch(player.playerId))}
          {...spaceToggles(repeatSafe(() => onToggleWatch(player.playerId)))}
          style={({ pressed }) => [styles.starCell, pressed && styles.pressed]}
        >
          <StarIcon filled={watched} size={18} />
        </Pressable>
        </View>
        {/* The player is the row's header (walk 9 T3-02): moving down a
            column, a screen reader names him before each figure, so his
            button's name leaves the figures to their cells. */}
        {/* Its own short name (walk 13 T3-03): said as the context of every
            cell, without the button's "view profile". */}
        <View
          style={styles.profileWrap}
          {...(tableRoles ? ({
            role: 'rowheader',
            'aria-label': rowHeaderName({ name: player.name, tier: player.tier, tag: position && !blocked ? tagText : null }),
          } as object) : {})}
        >
        <Pressable
          accessibilityLabel={tableRoles
            ? rowHeaderLabel({
              name: player.name,
              tier: player.tier,
              tag: position && !blocked ? tagText : null,
              reason: blocked ? (busy && busyElsewhere ? busyElsewhere.reason : blockedReason) : null,
            })
            : label}
          accessibilityRole="button"
          onPress={openProfile}
          style={({ pressed }) => [styles.profileArea, styles.profileAreaTable, { gap: columns.gap, paddingRight: columns.gap }, pressed && styles.pressed]}
        >
          <PlayerAvatar player={{ id: player.playerId, name: player.name }} size={columns.avatar} />
          <View style={styles.identity}>
            {/* "On your roster" is its own chip, never a "·" that could start a line
                (walk 3 T2-12); on a narrow table a held row leaves out the tier
                word to keep the chip on the kicker's line (it is still spoken). */}
            <View style={styles.kickerLine}>
              <Text maxFontSizeMultiplier={1.4} style={styles.kicker}>
                {kicker}
              </Text>
              {/* A narrow table's chip is one short word, so it stays on the
                  kicker's line beside "Scottie · Starter" and a held row keeps
                  the list's one height (walk 6 T2-14: 76px beside 60px). */}
              {position ? <Tag style={styles.kickerTag}>{columns.yours === 0 && side === 'long' ? 'Yours' : tagText}</Tag> : pastTag ? <Tag style={styles.kickerTag}>{pastTag}</Tag> : null}
            </View>
            <Text maxFontSizeMultiplier={1.4} style={styles.surname}>{nameLine}</Text>
            {/* The result once he has played; the locked price is "Yours" under
                the price, said once per row (walk 4 T2-11). */}
            {/* Measured as the phone row's line is: where the average would
                wrap ("+$113.5K a" / "game" at 768px, walk 11 T2-08) the line
                keeps the total alone, so every row keeps one height. */}
            {columns.yours === 0 && position && held && currentValue && currentValue.games > 0 ? (
              <Text ref={heldFirstRef} maxFontSizeMultiplier={1.4} style={[styles.detailText, { color: TONE_COLOR[held.tone] }]}>
                {heldShown ? heldShown.text : held.total}
                {heldShown?.why ? <Text style={styles.leadText}>{` (${heldShown.why})`}</Text> : null}
              </Text>
            ) : null}
          </View>
          <View style={[styles.cell, { width: columns.price }]}>
            {/* A held row leads with your price, as on phones (walk 5 T2-16);
                today's sits under it when your add has nudged it. */}
            <Text maxFontSizeMultiplier={1.4} style={styles.cellValue}>{money(position ? position.lockedGameCost : currentGameCost)}</Text>
            {position ? (
              <Text maxFontSizeMultiplier={1.4} style={styles.cellCaption}>{heldPriceCaption(position.lockedGameCost, currentGameCost)}</Text>
            ) : null}
          </View>
          {/* No last season: one calm dash in both columns (the row's name says it in words). */}
          <View style={[styles.cell, { width: columns.lastSeason }]}>
            {priorSeasonValuePerGame === null ? (
              <Text accessibilityLabel="no last season" maxFontSizeMultiplier={1.4} style={[styles.cellValue, styles.cellQuiet]}>—</Text>
            ) : (
              <Text maxFontSizeMultiplier={1.4} style={styles.cellValue}>{moneyCompact(priorSeasonValuePerGame)}</Text>
            )}
          </View>
          <View style={[styles.cell, { width: columns.edge }]}>
            {tableEdge === null ? (
              <Text accessibilityLabel="no last season" maxFontSizeMultiplier={1.4} style={[styles.cellValue, styles.cellQuiet]}>—</Text>
            ) : (
              <>
                {/* A held row's Value is last season's pace at the price you
                    locked, in neutral ink, as the phone rows say it: green and
                    red are only for what he made you (walk 10 T2-12: a green
                    +$35K beside his -$153K a game). */}
                <Text maxFontSizeMultiplier={1.4} style={[styles.cellValue, { color: seasonOver ? colors.muted : position ? colors.text : TONE_COLOR[netTone(tableEdge)] }]}>
                  {/* One style down the column: "+$8K" beside "+$25.5K" (walk 3 T2-03). */}
                  {netTone(tableEdge) === 'even' ? 'Even' : signedMoneyCompact(tableEdge)}
                </Text>
                {/* At the price you locked, the Roster's figure (walk 5 T4-02). */}
                {position ? <Text maxFontSizeMultiplier={1.4} style={styles.cellCaption}>{HELD_VALUE_CAPTION}</Text> : null}
              </>
            )}
          </View>
          {columns.yours > 0 ? (
            <View style={[styles.cell, { width: columns.yours }]}>
              {position && currentValue && currentValue.avgNet !== null && currentValue.games > 0 ? (
                <>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.cellValue, { color: TONE_COLOR[netTone(currentValue.avgNet)] }]}>
                    {/* The Roster's per-game precision (walk 4 T4-13). */}
                    {perGameFigure(currentValue)}
                  </Text>
                  <Text maxFontSizeMultiplier={1.4} style={styles.cellCaption}>
                    {currentValue.games === 1 ? '1 game' : `${currentValue.games} games`}
                    {held?.why ? ' · below zero' : ''}
                  </Text>
                </>
              ) : position ? (
                <Text maxFontSizeMultiplier={1.4} style={[styles.cellValue, styles.cellQuiet]}>No games yet</Text>
              ) : pastValue && pastValue.avgNet !== null && pastValue.games > 0 ? (
                <>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.cellValue, { color: TONE_COLOR[netTone(pastValue.avgNet)] }]}>
                    {perGameFigure(pastValue)}
                  </Text>
                  <Text maxFontSizeMultiplier={1.4} style={styles.cellCaption}>
                    {pastValue.games === 1 ? '1 past game' : `${pastValue.games} past games`}
                  </Text>
                </>
              ) : (
                // Not yours: one quiet dash, as the other columns mark an empty
                // cell, and said in words (walk 6 T2-03: a blank column read
                // like one that failed to load).
                <Text accessibilityLabel={unheldProfitWords(side, row.blockedByOpposingPosition)} maxFontSizeMultiplier={1.4} style={[styles.cellValue, styles.cellQuiet]}>—</Text>
              )}
            </View>
          ) : null}
        </Pressable>
        </View>
        {saidCells.map((words, index) => (
          <View key={index} role="cell" style={visuallyHidden}>
            <Text>{words}</Text>
          </View>
        ))}
        {action}
      </View>
      {fullRow(keptLine)}
      {fullRow(strip)}
      {fullRow(note)}
      </>
    );
  }

  return (
    <>
    <View style={[styles.row, large && styles.rowLarge]} {...playerMarker(player.playerId)}>
      {dimmed ? <View style={[styles.dimMarker, NO_POINTER]} /> : null}
      <Pressable
        ref={profileRef}
        accessibilityLabel={label}
        accessibilityRole="button"
        onPress={openProfile}
        style={({ pressed }) => [styles.profileArea, large && styles.profileAreaLarge, pressed && styles.pressed]}
      >
        {/* Below 360px the photo gives its room to the name and price, so
            every row keeps one height (walk 9 T4-07). */}
        {large || phoneRowPhoto(width) ? (
          <View style={[styles.avatarBox, large && styles.avatarBoxLarge]}>
            <PlayerAvatar player={{ id: player.playerId, name: player.name }} size={PHONE_AVATAR} />
          </View>
        ) : null}
        <View style={styles.rowContent}>
          {large ? (
            <>
              <Text maxFontSizeMultiplier={1.6} style={styles.kicker}>{kicker}</Text>
              <Text maxFontSizeMultiplier={1.6} style={[styles.surname, largeNameSize < type.value && { fontSize: largeNameSize, lineHeight: Math.ceil(largeNameSize * 1.35) }]}>{nameLine}</Text>
              {priceBox}
            </>
          ) : (
            // The action floats over the top band's right edge, so the band
            // leaves it room (none at season end); the value line below runs
            // the full width. The price shares the top line with the kicker,
            // so a long surname ("Gilgeous-Alexander") keeps the whole second
            // line; if a very long given name leaves no room on a very narrow
            // phone, the price wraps under it rather than overlapping it.
            <View style={[styles.topBand, { paddingRight: action ? actionWidth + space.sm : 0 }]}>
              {/* A held row leads with "yours $176K/game" and keeps only the
                  first name (the tier is in the unheld row, the profile and
                  the spoken name). */}
              {topLine}
              <Text maxFontSizeMultiplier={1.6} style={styles.surname}>{nameLine}</Text>
            </View>
          )}
          {valueLine}
        </View>
      </Pressable>
      {action}
    </View>
    {keptLine}
    {strip}
    {note}
    </>
  );
}

/**
 * A row draws again only when what it shows changes (its player, position,
 * flags or the layout): an Add redraws its own row, not all thirty (walk 4
 * T4-11). Its callbacks are stable, so they never force a redraw.
 */
const MemoMarketRow = memo(MarketRow, (prev, next) => sameMarketRowProps(prev, next));

export function PerGameMarketScreen({
  initialSide = 'long',
}: {
  initialSide?: PerGamePositionSide;
}) {
  const perGame = usePerGame();
  const { bootstrap, pendingActions } = perGame;
  // The rows get the context's moves through one object that never changes,
  // so a snapshot (every Add) does not hand thirty rows new props.
  const latestPerGame = useRef(perGame);
  latestPerGame.current = perGame;
  const moves = useMemo<MarketMoves>(() => ({
    closePosition: (position) => latestPerGame.current.closePosition(position),
    dismissNotice: () => latestPerGame.current.dismissNotice(),
    lockedPress: (move) => latestPerGame.current.lockedPress(move),
    notify: (text) => latestPerGame.current.notify(text),
    openPosition: (intent) => latestPerGame.current.openPosition(intent),
  }), []);
  const { fontScale, height, width } = useWindowDimensions();
  const watchlist = useWatchlist();
  // The practice games playing now ("Oct 21–27"), or null: moves pressed
  // meanwhile wait for them, and the slot count says so (walk 9 T4-04).
  const playingNow = usePracticePlaying();
  // Side, sort, search, Watching and your place in the list come back after a
  // tab switch or a rotation (marketViewMemory). A fresh request for a side
  // (the Roster's "Find a short") wins and starts that side at the top.
  const [remembered] = useState(() => {
    const saved = marketMemory();
    const openSide = openingSide({ initialSide, remembered: saved, requestedFromScreen: pressedInScreen() });
    rememberMarket({ lastInitialSide: initialSide });
    return openSide === saved.side ? saved : { ...saved, side: openSide, anchorId: null, offset: 0 };
  });
  // What Value is, said under a phone's sort on the first visit of a session
  // (walk 13 T1-01), for the whole visit, so it never leaves from under a
  // thumb; remembered as seen once a phone has shown it.
  const valueTip = !remembered.valueTipSeen;
  const valueTipShown = useRef(false);
  useEffect(() => () => {
    if (valueTipShown.current) rememberMarket({ valueTipSeen: true });
  }, []);
  // A side's explainer under the sort is for a first move (walk 16 T1-01).
  // It is drawn from what was known when the side was shown, so a move never
  // takes it from under a thumb: after a move on that side it goes the next
  // time the Market or that side is drawn, or once the list has scrolled it
  // out of view (rows kept in place); its × lets it go at once.
  const heldOn = (which: PerGamePositionSide): number => (which === 'long' ? bootstrap?.account.longSlots.used : bootstrap?.account.shortSlots.used) ?? 0;
  const [explainerGone, setExplainerGone] = useState(() => ({
    long: explainerDone(marketMemory().explained.long, heldOn('long')),
    short: explainerDone(marketMemory().explained.short, heldOn('short')),
  }));
  const explainerGoneRef = useRef(explainerGone);
  explainerGoneRef.current = explainerGone;
  const longUsed = bootstrap?.account.longSlots.used ?? 0;
  const shortUsed = bootstrap?.account.shortSlots.used ?? 0;
  const usedBefore = useRef({ long: longUsed, short: shortUsed });
  useEffect(() => {
    if (longUsed > usedBefore.current.long) markExplained('long');
    if (shortUsed > usedBefore.current.short) markExplained('short');
    usedBefore.current = { long: longUsed, short: shortUsed };
  }, [longUsed, shortUsed]);
  const explainerRef = useRef<View>(null);
  const explainerAnchor = useRef<{ id: string; dy: number } | null>(null);
  const [query, setQuery] = useState(remembered.query);
  const [side, setSide] = useState<PerGamePositionSide>(remembered.side);
  const [sort, setSort] = useState<MarketSort>(remembered.sort);
  const [watchedOnly, setWatchedOnly] = useState(remembered.watchedOnly);
  // Unwatched while Watching is on: his row stays, dimmed, until the filter
  // changes, so one slip never loses him from view (walk 2: T2-06).
  const [kept, setKept] = useState<readonly string[]>([]);
  useEffect(() => {
    setKept((list) => (list.length > 0 ? [] : list));
  }, [watchedOnly]);
  const { isWatched, toggle: toggleWatchlist } = watchlist;
  // What a star press under the Watching filter changed, said before the new
  // count ("No longer watching Dyson Daniels…"), so a listener hears the
  // change itself, not only a number (walk 4 T3-07).
  const watchNote = useRef<string | null>(null);
  const toggleWatch = useCallback((playerId: string) => {
    if (watchedOnly && isWatched(playerId)) {
      setKept((list) => (list.includes(playerId) ? list : [...list, playerId]));
      const name = bootstrap?.market.find((player) => player.playerId === playerId)?.name;
      if (name) watchNote.current = `No longer watching ${name}; Watch again is under his row.`;
    }
    toggleWatchlist(playerId);
  }, [bootstrap, isWatched, toggleWatchlist, watchedOnly]);
  const latestToggleWatch = useRef(toggleWatch);
  latestToggleWatch.current = toggleWatch;
  const toggleWatchStable = useCallback((playerId: string) => latestToggleWatch.current(playerId), []);
  const [reversed, setReversed] = useState(remembered.reversed);
  useEffect(() => {
    rememberMarket({ query, side, sort, reversed, watchedOnly });
  }, [query, side, sort, reversed, watchedOnly]);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [controlsOpen, setControlsOpen] = useState(false);
  // The phone search box has focus (below 360px it widens meanwhile, walk 13 T4-06).
  const [searchFocused, setSearchFocused] = useState(false);
  // Escape in the folded panel's empty search closes the panel and returns
  // focus to "Search & sort" (walk 5 T3-03).
  const controlsToggleRef = useRef<View>(null);
  const closeControls = useCallback(() => {
    setControlsOpen(false);
    setTimeout(() => (controlsToggleRef.current as unknown as { focus?: () => void } | null)?.focus?.(), 0);
  }, []);
  // Opened from the keyboard or with a mouse, the panel puts focus in its
  // search box, so typing searches at once (walk 6 T3-02, walk 13 T2-10); a
  // finger's tap leaves focus where it was (no on-screen keyboard).
  const openedByKey = useRef(false);
  // A double tap opens it once and leaves it open (walk 8 T4-05: in
  // landscape the second tap shut it again at 150 and 250 ms), as the other
  // toggles do; a key press always acts.
  const toggleControls = useMemo(() => repeatSafe(() => {
    const opening = !controlsOpenRef.current;
    openedByKey.current = opening && searchFocusOnOpen(pressedByPointer(), lastPointerType());
    setControlsOpen(opening);
  }), []);
  const controlsOpenRef = useRef(controlsOpen);
  controlsOpenRef.current = controlsOpen;
  // Escape anywhere in the open panel, the toggle included, folds it and
  // returns focus to the toggle; the search box's own Escape clears a search
  // first (MarketSearch).
  const foldedKeys = useMemo(() => ({
    onKeyDown: (event: { key: string; target?: unknown }) => {
      if (event.key !== 'Escape' || !controlsOpenRef.current) return;
      if ((event.target as { tagName?: string } | undefined)?.tagName === 'INPUT') return;
      closeControls();
    },
  }), [closeControls]);
  // A short window (a phone turned sideways) gets the phone rows, which label
  // their own figures, so the table only shows where its labels fit.
  const layout = marketLayout(width, fontScale, height);
  const wide = layout === 'table';
  // On a tablet or desktop the toolbar and column labels stay put while the
  // rows scroll under them, so a row far down is never a column of unlabelled
  // numbers, a short laptop window too (walk 15 T2-06: at 853x533 they
  // scrolled away). Below 560px of height every row counts: the explainer
  // sentence goes (it is in Rules), the toolbar folds to one row, and the
  // order line scrolls away with the rows.
  const roomy = height >= ROOMY_MIN_HEIGHT;
  const pinned = wide && tablePinsChrome(height);
  // A pinned toolbar that leaves the rows too little of the window folds
  // (walk 10 T2-16), measured before paint and kept for this window size; a
  // short table folds at once, with nothing to measure.
  const [crampedAt, setCrampedAt] = useState<string | null>(null);
  const sizeKey = `${width}x${height}`;
  const cramped = wide && (crampedAt === sizeKey || shortTableFolds(height));
  // A phone whose slot line was crowded beside the toggle at this width (a
  // reader's text spacing, measured below) folds too in a short window, so a
  // whole player shows under the notice strip (walk 15 T3-01).
  const [, setSlotUnderTick] = useState(0);
  const slotUnder = slotUnderWidths.has(width);
  const crowdedFold = slotUnder && !wide && crowdedToolbarFolds(height);
  const folded = collapseControls(width, height, wide) || cramped || crowdedFold;
  // A short but wide window folds into one row: side, slot line, toggle.
  const foldWide = folded && width >= 480;
  const columns = useMemo(() => marketColumns(width), [width]);
  // Every held row of the list shows its second line at one step, the most
  // compact any of them needs (walk 15 T1-02: at 360px one row of three lost
  // "last season"); remembered for the visit, so coming back draws them at once.
  const heldFloorKey = `${width}|${layout}|${side}`;
  const heldFloorKeyRef = useRef(heldFloorKey);
  heldFloorKeyRef.current = heldFloorKey;
  const [, setHeldFloorTick] = useState(0);
  const heldFloorNow = heldFloorMemory.get(heldFloorKey) ?? 0;
  const raiseHeldFloor = useCallback((step: number) => {
    const key = heldFloorKeyRef.current;
    const was = heldFloorMemory.get(key) ?? 0;
    const floor = heldStepFloor([was, step]);
    if (floor === was) return;
    heldFloorMemory.set(key, floor);
    setHeldFloorTick((tick) => tick + 1);
  }, []);
  const averageDropped = averageDroppedAt.has(heldFloorKey);
  const dropHeldAverage = useCallback(() => {
    const key = heldFloorKeyRef.current;
    if (averageDroppedAt.has(key)) return;
    averageDroppedAt.add(key);
    setHeldFloorTick((tick) => tick + 1);
  }, []);
  // A phone turned sideways has the width for the table's toolbar rows but
  // not the height for the stacked phone toolbar: two rows, so a third
  // player shows on arrival.
  const rowToolbar = !folded && (wide || (layout === 'phone' && height < SHORT_WINDOW_BELOW && width >= 600));

  const allRows = useMemo(
    () => (bootstrap ? buildPerGameMarketRows(bootstrap, side) : []),
    [bootstrap, side],
  );
  // Adds still saving count toward the side's free slots (walk 7 T4-01: three
  // quick Adds into the last slot all painted "Added ✓"): once they fill it,
  // every other row shows FULL at once. A press is claimed here as it lands,
  // before its move is queued, so even a press in the same frame sees it.
  const claimsRef = useRef<readonly string[]>([]);
  const [claims, setClaims] = useState<readonly string[]>([]);
  const slotView = useMemo(() => {
    const held = new Set(allRows.filter((row) => row.position).map((row) => row.player.playerId));
    const names = new Map(allRows.map((row) => [row.player.playerId, row.player.name] as const));
    const slotsNow = bootstrap ? (side === 'long' ? bootstrap.account.longSlots : bootstrap.account.shortSlots) : null;
    const remaining = slotsNow ? slotsNow.remaining : 0;
    return { side, held, names, remaining, pendingActions, saving: savingMoves({ side, keys: [...claims, ...pendingActions], held, names }) };
  }, [allRows, bootstrap, side, claims, pendingActions]);
  const slotRef = useRef(slotView);
  slotRef.current = slotView;
  // One object per side, so a busy row's props compare equal between snapshots.
  const busyTag = useMemo(() => otherSideSaving(side), [side]);
  const claimSlot = useCallback((rowSide: PerGamePositionSide, playerId: string): string | null => {
    const view = slotRef.current;
    if (view.side !== rowSide) return null;
    const saving = savingMoves({ side: rowSide, keys: [...claimsRef.current, ...view.pendingActions], held: view.held, names: view.names });
    const takenBy = lastSlotTakenBy(view.remaining, saving, playerId);
    if (takenBy) return takenBy;
    const key = `position:${rowSide}:${playerId}`;
    if (!claimsRef.current.includes(key)) {
      claimsRef.current = [...claimsRef.current, key];
      setClaims(claimsRef.current);
    }
    return null;
  }, []);
  const releaseSlot = useCallback((rowSide: PerGamePositionSide, playerId: string) => {
    const key = `position:${rowSide}:${playerId}`;
    if (!claimsRef.current.includes(key)) return;
    claimsRef.current = claimsRef.current.filter((claim) => claim !== key);
    setClaims(claimsRef.current);
  }, []);
  // The longest given name on either side decides the tier word for a width.
  const longestGiven = useMemo(
    () => (bootstrap?.market ?? []).reduce((most, entry) => Math.max(most, splitPlayerName(entry.name).given.length), 0),
    [bootstrap?.market],
  );
  const fullTier = fullTierFits(width, longestGiven);
  // Every phone price box keeps the widest price's width (walk 11 lead note).
  const priceReserve = useMemo(() => priceWidthReserve([
    ...(bootstrap?.market ?? []).map((entry) => perGameShort(entry.currentGameCost).split('/')[0]),
    ...(bootstrap?.positions ?? []).map((entry) => perGameShort(entry.lockedGameCost).split('/')[0]),
  ]), [bootstrap?.market, bootstrap?.positions]);
  // Under a text-spacing style long given names were cut ("KARL-AN… · STAR",
  // walk 7 T3-07): once any row's given name is cut beside its tier, every
  // row puts its tier after the surname, the narrow phones' place, so names
  // stay whole. Checked after each layout and when a style sheet is added.
  const tierKey = tierAfterSurnameKey(width, fontScale);
  const [tierAfterSurname, setTierAfterSurname] = useState(() => tierAfterSurnameKnown(tierKey));
  useEffect(() => {
    setTierAfterSurname(tierAfterSurnameKnown(tierKey));
  }, [tierKey]);
  // The list keeps its order while the player works through it: an Add
  // nudges that player's price (and so his value), and a re-sort swapped
  // rows under the finger (Barnes and Booker traded places after an Add).
  // A new sort, side, search or filter sorts afresh; so does coming back to
  // the Market. A night never re-sorts it by itself (below).
  const night = bootstrap?.game.lastSettledDate ?? '';
  // The night the list's order was sorted for. After +1 night the list keeps
  // its order, with no timer and no scroll moving a row: a re-sort a second
  // after the night pushed every row 25px under a tap and added Booker
  // instead of Barnes (walk 7 T4-11). A new sort, side, search or filter,
  // the sort in use chosen again, "Re-sort" on a tall table, or coming back
  // to the Market sorts for the latest night.
  const [sortedNight, setSortedNight] = useState(night);
  // The first games are in: the laptop table's explainer sentence gives way
  // (walk 9 T2-12). Read when the Market opens and when the view changes,
  // never as a night lands, so nothing moves by itself.
  const gamesIn = !isMockActive() || practiceProgress(mockSeasonStart(), bootstrap?.game.lastSettledDate).day > 0;
  const gamesInRef = useRef(gamesIn);
  gamesInRef.current = gamesIn;
  const [sentenceGone, setSentenceGone] = useState(gamesIn);
  const orderKey = `${sort}|${reversed}|${side}|${query}|${watchedOnly}|${sortedNight}`;
  const orderRef = useRef<{ key: string; ids: readonly string[] } | null>(null);
  const { rows, orderMoved } = useMemo(() => {
    const fresh = actionableFirst(sortMarketRows(
      filterMarketRows(allRows, { query, watchedOnly, watched: kept.length > 0 ? [...watchlist.watched, ...kept] : watchlist.watched }),
      sort,
      side,
      reversed,
    ));
    const ordered = keepListOrder(fresh, orderRef.current?.key === orderKey ? orderRef.current.ids : null);
    const ids = ordered.map((row) => row.player.playerId);
    orderRef.current = { key: orderKey, ids };
    // Whether a fresh sort would put anyone somewhere else now.
    return { rows: ordered, orderMoved: !sameOrder(fresh.map((row) => row.player.playerId), ids) };
  }, [allRows, query, side, sort, reversed, watchedOnly, watchlist.watched, kept, orderKey]);
  // The line over players held on the other side goes over their group at
  // the end only; one moved there from his profile keeps his place and tag
  // until the list sorts again (walk 12 T2-04).
  const blockedGroup = useMemo(() => otherSideGroup(rows), [rows]);
  const firstBlockedId = blockedGroup?.firstId ?? null;
  const blockedCount = blockedGroup?.count ?? 0;
  // Measured before the first paint, so a list that needs it never shows the
  // other place first; a style sheet added later is checked a frame after.
  useLayoutEffect(() => {
    if (layout !== 'phone' || tierAfterSurname || typeof document === 'undefined' || typeof requestAnimationFrame !== 'function') return undefined;
    let frame = 0;
    const check = () => {
      frame = 0;
      const givens = Array.from(document.querySelectorAll('[data-kicker-given]'));
      const cut = givens.some((node) => node.scrollWidth > node.clientWidth + 1);
      // A given name and its tier too long for the price's line wrap under
      // it, so that row stood 10px taller and its name started lower than
      // its neighbours' (walk 14 T1-02: "KARL-ANTHONY · STAR" under
      // "$384.8K/game" at 390px): every row then names the tier after the
      // surname, as narrow phones do, and the given name keeps the price's line.
      const wrapped = givens.some((node) => {
        const parts = node.parentElement;
        const price = parts?.parentElement?.lastElementChild;
        if (!parts || !price || price === parts) return false;
        return parts.getBoundingClientRect().top >= price.getBoundingClientRect().bottom - 4;
      });
      if (cut || wrapped) {
        // Remembered for the session at this size: the next visit starts there.
        if (wrapped) rememberTierAfterSurname(tierKey);
        setTierAfterSurname(true);
      }
    };
    const later = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    const observer = typeof MutationObserver === 'function' ? new MutationObserver(later) : null;
    observer?.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [layout, tierAfterSurname, width, rows, tierKey]);
  const positionValues = useMemo(
    () => valueByPosition(bootstrap?.settledResults ?? []),
    [bootstrap?.settledResults],
  );
  const pastValues = useMemo(
    () => accountValueByPlayer(bootstrap?.settledResults ?? [], side),
    [bootstrap?.settledResults, side],
  );
  const openProfile = useCallback((playerId: string) => setProfileId(playerId), []);
  const profileIdRef = useRef(profileId);
  profileIdRef.current = profileId;
  // Back from his games in Results reopens his profile over the Market (walk
  // 16 T2-05) through the Market's own state, so a Watch press there moves his
  // row's star at once (E16's note: the sheet's own copy of the watchlist
  // moved it only on the next redraw). Claimed before the sheet looks (a
  // layout effect runs before its effect), and opened once the Market's
  // history step has landed, as the sheet would, so the next Back closes him.
  const [returnView, setReturnView] = useState<ProfileView | null>(null);
  const returnedRef = useRef<string | null>(null);
  const pendingReturn = useRef<ProfileReturn | null>(null);
  useLayoutEffect(() => {
    const fresh = peekProfileReturn();
    if (fresh && fresh.tab === 'market' && takeProfileReturn(fresh)) pendingReturn.current = fresh;
    const request = pendingReturn.current;
    if (!request || typeof window === 'undefined') return undefined;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const open = () => {
      if (done) return;
      done = true;
      window.removeEventListener('popstate', open);
      if (timer !== null) clearTimeout(timer);
      pendingReturn.current = null;
      returnedRef.current = request.playerId;
      setReturnView(request.view);
      setProfileId(request.playerId);
    };
    const landed = (window.history.state as { tab?: string } | null)?.tab === request.tab;
    if (landed) open();
    else {
      window.addEventListener('popstate', open);
      timer = setTimeout(open, 400);
    }
    return () => {
      done = true;
      window.removeEventListener('popstate', open);
      if (timer !== null) clearTimeout(timer);
    };
  }, []);
  // A tap on the dimmed row of the player already open is that row's own
  // press again (a slightly slow double tap on a tablet, walk 10 T4-10: the
  // panel flashed open and shut): what it opens is open, so it stays. The
  // profile's own close, Escape, Back and the rest of the dimmed screen close.
  const closeProfile = useCallback((event?: unknown) => {
    if (scrimTapOnPlayer(event, profileIdRef.current)) return;
    const returned = returnedRef.current;
    returnedRef.current = null;
    setProfileId(null);
    setReturnView(null);
    // A profile Back reopened hands focus to his row once closed, as one
    // opened from the row does (the sheet's own return runs first).
    const name = returned ? latestPerGame.current.bootstrap?.market.find((row) => row.playerId === returned)?.name : null;
    if (!name || typeof document === 'undefined') return;
    setTimeout(() => {
      const active = document.activeElement;
      if (active && active !== document.body && document.getElementById('app-screen')?.contains(active) === false) return;
      const row = Array.from(document.querySelectorAll<HTMLElement>('#app-screen [role="button"]'))
        .find((node) => (node.getAttribute('aria-label') ?? '').startsWith(`${name},`));
      row?.focus({ preventScroll: true });
    }, 120);
  }, []);
  const clearFilters = useCallback(() => {
    setQuery('');
    setWatchedOnly(false);
  }, []);
  // One always-mounted live region; clearing it first makes a repeat announce again.
  const announceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announce = useCallback((message: string) => {
    setAnnouncement('');
    if (announceTimer.current) clearTimeout(announceTimer.current);
    announceTimer.current = setTimeout(() => setAnnouncement(message), 60);
  }, []);
  useEffect(() => () => {
    if (announceTimer.current) clearTimeout(announceTimer.current);
  }, []);

  // The latest night, for a re-sort the player asks for.
  const nightRef = useRef(night);
  nightRef.current = night;
  const sortedNightRef = useRef(sortedNight);
  sortedNightRef.current = sortedNight;
  // Kept from before the latest night, and a fresh sort would move someone:
  // said only in the tall table's reserved sentence slot, with "Re-sort"
  // (nothing else on screen may move for it).
  const heldNote = night !== sortedNight && orderMoved ? heldOrderLine(sortedNight, night, orderLineForm(width, layout === 'table'), sort) : null;
  const resortNow = useCallback(() => {
    const previous = sortedNightRef.current;
    if (previous === nightRef.current) return;
    setSortedNight(nightRef.current);
    announce(resortedLine(previous, nightRef.current));
  }, [announce]);
  // A run that ends the season sorts afresh once it settles (walk 10 T2-03),
  // as a new season does; a night, a week or a run of weeks keeps the order,
  // with the kept line and Re-sort (walk 14 T2-05, resortsAfterRun).
  const seasonDone = bootstrap !== null && isSeasonOver({
    practiceComplete: isMockActive() && practiceProgress(mockSeasonStart(), bootstrap.game.lastSettledDate).complete,
    lastSettledDate: bootstrap.game.lastSettledDate,
    nextGameDate: bootstrap.game.nextGameDate,
  });
  const seasonDoneRef = useRef(seasonDone);
  seasonDoneRef.current = seasonDone;
  useEffect(() => {
    if (playingNow !== null) return;
    if (!resortsAfterRun(sortedNightRef.current, night, seasonDone)) return;
    setSortedNight(night);
    // A re-sort you did not ask for opens the list at its top (walk 16 T1-07).
    if (seasonDone) {
      place.current = { anchorId: null, offset: 0 };
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    }
  }, [night, playingNow, seasonDone]);
  // Changing the view sorts afresh for the latest night, with nothing to say.
  const viewKey = `${sort}|${reversed}|${side}|${query}|${watchedOnly}`;
  const lastViewKey = useRef(viewKey);
  useEffect(() => {
    if (lastViewKey.current === viewKey) return;
    lastViewKey.current = viewKey;
    setSortedNight(nightRef.current);
    setSentenceGone(gamesInRef.current);
  }, [viewKey]);

  // Your place in the list: the first player you can see, and the offset.
  const listRef = useRef<FlatList<PerGameMarketRow>>(null);
  const listHeaderRef = useRef<View>(null);
  useLayoutEffect(() => {
    if (layout !== 'table' || cramped || crampedAt === sizeKey) return;
    const node = listRef.current?.getScrollableNode?.() as { getBoundingClientRect?: () => { height: number } } | undefined;
    const listHeight = node?.getBoundingClientRect?.().height ?? 0;
    if (pinned) {
      if (pinnedChromeTooTall(listHeight, height)) setCrampedAt(sizeKey);
      return;
    }
    // A short table (500-559px tall) scrolls its toolbar away with the rows,
    // but on arrival the toolbar and labels are what shows: at 853x533 (a
    // laptop at 150%) the rows got 126px, two players (walk 11 T3-13). The
    // room left under them is measured the same way, and folds the same way.
    const header = (listHeaderRef.current as unknown as { getBoundingClientRect?: () => { height: number } } | null)?.getBoundingClientRect?.();
    if (header && header.height > 0 && rowsUnderToolbarTooFew(listHeight - header.height, height)) setCrampedAt(sizeKey);
  });
  // The slot line goes under the side toggle where a part of it wrapped past
  // two lines beside it (walk 15 T3-01: with a reader's text spacing at 320px
  // it took six lines and no whole player showed), measured once per width.
  const slotStatusRef = useRef<View>(null);
  const slotMeasurable = useRef(false);
  const slotMeasuredAs = useRef('');
  useLayoutEffect(() => {
    if (!slotMeasurable.current || slotUnderWidths.has(width) || typeof window === 'undefined') return;
    const node = slotStatusRef.current as unknown as HTMLElement | null;
    if (!node?.querySelectorAll) return;
    // Once per width and wording: most renders change neither.
    const key = `${width}|${node.textContent ?? ''}`;
    if (slotMeasuredAs.current === key) return;
    slotMeasuredAs.current = key;
    const parts = Array.from(node.querySelectorAll('*'))
      .filter((element) => Array.from(element.childNodes).some((child) => child.nodeType === 3 && (child.textContent ?? '').trim() !== ''))
      .map((element) => ({
        height: element.getBoundingClientRect().height,
        lineHeight: parseFloat(window.getComputedStyle(element).lineHeight),
      }));
    if (!slotLinesCrowded(parts)) return;
    slotUnderWidths.add(width);
    setSlotUnderTick((tick) => tick + 1);
  });
  // "Skip to the end of the list" lands here (walk 8 T3-I1).
  const listEndRef = useRef<View>(null);
  const skipToEnd = useCallback(() => {
    (listEndRef.current as unknown as { focus?: () => void } | null)?.focus?.();
  }, []);
  // After the list, a way back up to the practice controls (walk 9 T3-N2:
  // about forty Shift+Tabs from the 20th player at 200% zoom): +1 night,
  // wherever the frame shows it, or its More button when folded.
  const backToControls = useCallback(() => {
    if (typeof document === 'undefined') return;
    const buttons = Array.from(document.querySelectorAll('[role="button"], button')) as HTMLElement[];
    const shown = (node: HTMLElement) => node.getClientRects().length > 0;
    const named = (pattern: RegExp) => buttons.find((node) => pattern.test(node.getAttribute('aria-label') ?? node.textContent ?? '') && shown(node));
    const target = named(/^\+1\s*night/i) ?? named(/^More\b/);
    target?.focus();
    target?.scrollIntoView?.({ block: 'nearest' });
  }, []);
  const place = useRef({ anchorId: remembered.anchorId, offset: remembered.offset });
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const widthRef = useRef(width);
  const retries = useRef(0);
  // Your place for a rotation or a resized window: the first player you can
  // see and where his row sits, read on the web from the rows themselves
  // (walk 6 T4-07: an offset or a viewability callback read after the
  // reflow came back at the top of the list). Recorded only while the
  // window keeps its size, so the resize's own scroll never overwrites it.
  const scrollNode = () => listRef.current?.getScrollableNode?.() as AnchorNode | undefined;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const anchor = useRef<{ id: string; dy: number; width: number; height: number; layout: MarketLayout } | null>(null);
  const recordAnchor = useCallback((force = false) => {
    if (typeof window === 'undefined' || !window.innerWidth) return;
    const shown = { width: window.innerWidth, height: window.innerHeight };
    const saved = anchor.current;
    // The window changed size and the rows have not been put back yet.
    if (!force && saved && (saved.width !== shown.width || saved.height !== shown.height)) return;
    const found = readAnchor(listRef.current?.getScrollableNode?.() as AnchorNode | undefined);
    if (!found) return;
    anchor.current = { ...found, ...shown, layout: layoutRef.current };
    place.current.anchorId = found.id;
  }, []);
  const aligning = useRef(false);
  // After a move on this side, the explainer goes once the list has scrolled
  // it out of view: the first row in view is kept where it is (below).
  const dropScrolledExplainer = useCallback(() => {
    const which = sideRef.current;
    if (explainerGoneRef.current[which] || !marketMemory().explained[which]) return;
    const node = scrollNode();
    const tip = explainerRef.current as unknown as HTMLElement | null;
    if (!node || !tip?.getBoundingClientRect) return;
    if (tip.getBoundingClientRect().bottom > node.getBoundingClientRect().top) return;
    explainerAnchor.current = readAnchor(node as unknown as AnchorNode);
    setExplainerGone((gone) => ({ ...gone, [which]: true }));
  }, []);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    place.current.offset = event.nativeEvent.contentOffset.y;
    if (!aligning.current) recordAnchor();
    dropScrolledExplainer();
  }, [recordAnchor, dropScrolledExplainer]);
  useLayoutEffect(() => {
    const kept = explainerAnchor.current;
    explainerAnchor.current = null;
    if (!kept) return;
    const node = scrollNode();
    const rows = node?.querySelectorAll?.('[data-player]');
    for (let index = 0; rows && index < rows.length; index += 1) {
      if (rows[index].getAttribute('data-player') !== kept.id) continue;
      const delta = rows[index].getBoundingClientRect().top - node!.getBoundingClientRect().top - kept.dy;
      if (Math.abs(delta) > 0.5) node!.scrollTop += delta;
      break;
    }
  }, [explainerGone]);
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.find((token) => token.isViewable);
    if (first) place.current.anchorId = (first.item as PerGameMarketRow).player.playerId;
  }).current;
  const scrollToPlayer = useCallback((playerId: string | null) => {
    const index = playerId ? rowsRef.current.findIndex((row) => row.player.playerId === playerId) : -1;
    if (index < 0) return;
    retries.current = 0;
    listRef.current?.scrollToIndex({ index, animated: false });
  }, []);
  // Coming back at the same width: the same offset. At a new width: the same
  // first player. Leaving: save both.
  // The rows further down are still being laid out on the first frames, so
  // an early jump stops short (walk 3 T2-17: 700 came back as 612): keep
  // setting the offset until the list holds it, for up to a second.
  useEffect(() => {
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const restore = () => {
      // A side switched meanwhile starts at its top (below).
      if (shownSide.current !== remembered.side) return;
      // The season ended since you left: the list was re-sorted, so it opens
      // at its top, and that is the place kept from now (walk 16 T1-07).
      if (!restoresPlace(remembered.offset, seasonDoneRef.current, remembered.seasonOver)) {
        if (remembered.offset > 0) place.current = { anchorId: null, offset: 0 };
        return;
      }
      if (remembered.width !== widthRef.current) {
        scrollToPlayer(remembered.anchorId);
        return;
      }
      listRef.current?.scrollToOffset({ offset: remembered.offset, animated: false });
      const node = listRef.current?.getScrollableNode?.() as { scrollTop?: number } | undefined;
      const at = node?.scrollTop;
      if (typeof at === 'number' && Math.abs(at - remembered.offset) > 1 && tries < 20) {
        tries += 1;
        timer = setTimeout(restore, 50);
      }
    };
    timer = setTimeout(restore, 0);
    return () => {
      if (timer) clearTimeout(timer);
      rememberMarket({ anchorId: place.current.anchorId, offset: place.current.offset, width: widthRef.current, seasonOver: seasonDoneRef.current });
    };
  }, [remembered, scrollToPlayer]);
  // A rotation or a resized window reflows every row: bring the same player
  // back to the same spot, re-aligning for a moment while rows settle, unless
  // the player scrolls meanwhile.
  // An open Drop or Close question wins over the first player: its row and
  // question come back into the list's view, with focus still on Keep (walk
  // 12 T4-06: turned to landscape, Keep sat at y=429 in a 390px window).
  const sizeRef = useRef({ width, height });
  const sideRef = useRef(side);
  sideRef.current = side;
  useEffect(() => {
    const before = sizeRef.current;
    if (before.width === width && before.height === height) return undefined;
    sizeRef.current = { width, height };
    widthRef.current = width;
    const saved = anchor.current;
    if (!askingOn(sideRef.current) && (!saved || place.current.offset <= 0)) {
      recordAnchor(true);
      return undefined;
    }
    aligning.current = true;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let userMoved = false;
    const stop = () => {
      userMoved = true;
    };
    const events = ['wheel', 'touchmove', 'keydown'] as const;
    if (typeof window !== 'undefined') events.forEach((name) => window.addEventListener(name, stop, { capture: true, passive: true }));
    let questionCell: HTMLElement | null = null;
    let finished = false;
    // `settled`: the rows are back in place at this size, so your place is
    // read afresh. Cut short by the next resize (the cleanup), nothing is
    // read: the rows have already reflowed to the new size, and reading them
    // there kept the browser's own guess (walk 15 T2-07, fix 14's note: back
    // from 844x390 to portrait, 24px of the row above showed, not 7).
    const finish = (settled = true) => {
      if (finished) return;
      finished = true;
      aligning.current = false;
      if (typeof window !== 'undefined') events.forEach((name) => window.removeEventListener(name, stop, { capture: true }));
      // Focus on the question's Keep stays clear of anything drawn over it.
      const focused = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
      if (settled && !userMoved && questionCell && focused && questionCell.contains(focused)) revealFocused(focused);
      questionCell = null;
      if (settled) recordAnchor(true);
    };
    const align = () => {
      if (userMoved) {
        finish();
        return;
      }
      const node = scrollNode();
      const asking = askingOn(sideRef.current);
      const targetId = asking ?? saved?.id ?? null;
      if (!targetId) {
        finish();
        return;
      }
      const rows = node?.querySelectorAll?.('[data-player]');
      let row: AnchorNode | null = null;
      for (let index = 0; rows && index < rows.length; index += 1) {
        if (rows[index].getAttribute('data-player') === targetId) row = rows[index];
      }
      if (node && row && asking) {
        // The row, then its question under it in the same list item.
        const cell = (row as unknown as HTMLElement).parentElement ?? (row as unknown as HTMLElement);
        questionCell = cell;
        const box = node.getBoundingClientRect();
        const view = { top: Math.max(0, box.top), bottom: Math.min(window.innerHeight, box.bottom) };
        const delta = questionScrollDelta(view, { top: row.getBoundingClientRect().top, bottom: cell.getBoundingClientRect().bottom });
        if (Math.abs(delta) > 1) node.scrollTop += delta;
      } else if (node && row && saved) {
        // His row starts whole at the list's top edge, just under the frame
        // or the table's pinned labels, never half under them (walk 14
        // T4-04): from the phone list to the table (the rows change height)
        // at that edge, otherwise where it was.
        const dy = saved.layout !== layoutRef.current ? 0 : Math.max(0, saved.dy);
        const delta = row.getBoundingClientRect().top - node.getBoundingClientRect().top - dy;
        if (Math.abs(delta) > 1) node.scrollTop += delta;
      } else {
        // Laid out further down than the list has drawn: jump near, then refine.
        scrollToPlayer(targetId);
      }
      tries += 1;
      if (tries < 10) timer = setTimeout(align, tries < 4 ? 40 : 100);
      else finish();
    };
    timer = setTimeout(align, 0);
    return () => {
      if (timer) clearTimeout(timer);
      finish(false);
    };
  }, [width, height, recordAnchor, scrollToPlayer]);
  // A side switch sorts that side afresh, so its list starts at its top, as
  // a fresh list does, before it paints (walk 14 T2-09: back on the Roster
  // side the list opened at its end, the worst values, your own players out
  // of view). Leaving the Market and coming back still keeps your place.
  const shownSide = useRef(side);
  useLayoutEffect(() => {
    if (shownSide.current === side) return;
    shownSide.current = side;
    // The side drawn afresh draws its explainer from what is known now.
    const done = explainerDone(marketMemory().explained[side], heldOn(side));
    if (explainerGoneRef.current[side] !== done) setExplainerGone((gone) => ({ ...gone, [side]: done }));
    place.current = { anchorId: null, offset: 0 };
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    recordAnchor(true);
  }, [side, recordAnchor]);

  // Screen readers hear what a search, a cleared search or the Watching
  // filter did, once typing pauses; the new line replaces the old one.
  const searchText = query.trim();
  const resultCount = rows.length;
  // A kept, unwatched row is on screen but no longer watched: the spoken count
  // leaves him out, as the Watching chip does (walk 3 T1-14).
  const keptShown = watchedOnly ? rows.filter((row) => kept.includes(row.player.playerId) && !watchlist.isWatched(row.player.playerId)).length : 0;
  const spokenCount = resultCount - keptShown;
  const totalCount = allRows.length;
  // A search that finds nobody offers the nearest listed name, among the
  // players this list could show (walk 14 T4-N1: "jokci", "lukka", "shai ga").
  // A search that really names a player practice leaves out, or a retired
  // star, offers no near names (walk 16 T4-01, T4-03: "Kobe" said Rudy
  // Gobert, "Bron" offered Jalen Brunson or Jaylen Brown).
  const unlisted = useMemo(() => (searchText && resultCount === 0 && !watchedOnly && isMockActive()
    ? unlistedSearch(searchText, allRows.map((row) => row.player.name))
    : NO_UNLISTED), [allRows, resultCount, searchText, watchedOnly]);
  const unlistedRef = useRef(unlisted);
  unlistedRef.current = unlisted;
  const suggestions = useMemo<NameSuggestion[]>(() => {
    if (!searchText || resultCount > 0 || !searchHasLetters(searchText)) return [];
    if (unlisted.star || unlisted.retired) return [];
    const shown = watchedOnly ? allRows.filter((row) => watchlist.isWatched(row.player.playerId)) : allRows;
    return nearestNames(searchText, shown.map((row) => row.player.name));
  }, [allRows, resultCount, searchText, watchedOnly, watchlist, unlisted]);
  const suggestionsRef = useRef(suggestions);
  suggestionsRef.current = suggestions;
  // A well-known player practice leaves out is named (walk 15 T1-N4).
  const listedNamesRef = useRef<string[]>([]);
  listedNamesRef.current = allRows.map((row) => row.player.name);
  const spokenOnce = useRef(false);
  const lastSearch = useRef(searchText);
  const lastWatchedOnly = useRef(watchedOnly);
  useEffect(() => {
    const cleared = lastSearch.current !== '' && searchText === '';
    const searchChanged = lastSearch.current !== searchText;
    lastSearch.current = searchText;
    // The Watching filter is one press, not typing: said at once, before
    // the next Tab moves on (walk 10 T3-08: heard as nothing).
    const filterFlipped = lastWatchedOnly.current !== watchedOnly && !searchChanged;
    lastWatchedOnly.current = watchedOnly;
    if (!spokenOnce.current) {
      spokenOnce.current = true;
      return undefined;
    }
    const note = watchNote.current;
    watchNote.current = null;
    // Names the button that is really there: "Show all 30" under a list,
    // "Show everyone" in an empty one (walk 8 T2-07).
    const line = listCountLine({ query: searchText, count: spokenCount, total: totalCount, watchedOnly, cleared, listed: resultCount });
    const timer = setTimeout(() => {
      // The nearest name is heard with the empty result ("… Did you mean Nikola Jokic?").
      const offer = resultCount === 0 ? didYouMeanLine(suggestionsRef.current) : '';
      const { star, guess } = resultCount === 0 ? unlistedRef.current : NO_UNLISTED;
      const first = star ? `${unlistedStarLine(star, listedNamesRef.current.length)}.` : line;
      const question = offer || (guess ? unlistedGuessLine(guess, listedNamesRef.current.length) : '');
      const said = question ? `${first} ${question}` : first;
      announce(note ? `${note} ${said}` : said);
    }, note || filterFlipped ? 150 : 700);
    return () => clearTimeout(timer);
  }, [searchText, spokenCount, totalCount, watchedOnly, announce, resultCount]);
  // Opened with a search or the Watching filter still on (coming back to the
  // Market): said once, so a listener knows why the list is short (walk 7
  // T3-19); the line under the list shows it too.
  const filterNow = useRef({ query: searchText, count: spokenCount, total: totalCount, watchedOnly });
  filterNow.current = { query: searchText, count: spokenCount, total: totalCount, watchedOnly };
  const hasBootstrap = bootstrap !== null;
  const saidFilters = useRef(false);
  useEffect(() => {
    if (saidFilters.current || !hasBootstrap) return undefined;
    saidFilters.current = true;
    if (!stillFilteredLine(filterNow.current)) return undefined;
    const timer = setTimeout(() => {
      const line = stillFilteredLine(filterNow.current);
      if (line) announce(line);
    }, 900);
    return () => clearTimeout(timer);
  }, [hasBootstrap, announce]);
  // If the list empties under the keyboard (the focused row left and focus
  // fell to the page), focus the empty state's way out ("Show everyone",
  // "Clear search") instead of leaving the user at the top (walk 2: T3-27).
  const emptyAction = useRef<View>(null);
  const hadRows = useRef(resultCount > 0);
  useEffect(() => {
    const had = hadRows.current;
    hadRows.current = resultCount > 0;
    if (!had || resultCount > 0 || typeof document === 'undefined') return undefined;
    const timer = setTimeout(() => {
      const active = document.activeElement;
      if (active && active !== document.body) return;
      (emptyAction.current as unknown as { focus?: () => void } | null)?.focus?.();
    }, 0);
    return () => clearTimeout(timer);
  }, [resultCount]);
  // Choosing a sort shows it in its natural order and never flips it; the
  // order button (and the table's gold arrow) flips it (walk 3 T1-08, T2-05).
  // Choosing the sort in use again only says what the list is showing.
  const applySort = useCallback((action: { choose: MarketSort } | 'flip') => {
    const next = nextSortState({ sort, reversed }, action);
    setSort(next.sort);
    setReversed(next.reversed);
    // The sort in use chosen again sorts the list for the latest night.
    if (next.sort === sort && next.reversed === reversed) setSortedNight(nightRef.current);
    announce(sortedLine(next.sort, next.reversed));
  }, [announce, reversed, sort]);
  const chooseSort = useCallback((next: MarketSort) => applySort({ choose: next }), [applySort]);
  const flipOrder = useCallback(() => applySort('flip'), [applySort]);

  if (!bootstrap) return null;
  const slots = side === 'long' ? bootstrap.account.longSlots : bootstrap.account.shortSlots;
  // Locked until the ruleset says otherwise.
  const rosterLocked = bootstrap?.ruleset.rosterMutationsLocked ?? true;
  const lockDate = bootstrap.ruleset.rosterLockGameDate;
  const fee = bootstrap.ruleset.transactionFeeDollars;
  // The Roster's rule: practice ends on its last day, a live season when no
  // games are left. Then nothing can be added, dropped or shorted.
  const seasonOver = isSeasonOver({
    practiceComplete: isMockActive() && practiceProgress(mockSeasonStart(), bootstrap.game.lastSettledDate).complete,
    lastSettledDate: bootstrap.game.lastSettledDate,
    nextGameDate: bootstrap.game.nextGameDate,
  });
  // Under the toggle where a part wrapped past two lines beside it (T3-01).
  const slotUnderToggle = slotUnder && !rowToolbar && !folded;
  const status = headerStatus({
    side,
    seasonOver,
    rosterLocked,
    lockGameDate: lockDate,
    full: slots.remaining === 0,
    // The narrow slot column beside the toggle (320-339px) says the lock in
    // two lines, as the fee does, so a lock eve never moves the list (walk 11 T4-08).
    short: lockLineShort(width) && !rowToolbar && !folded && !slotUnderToggle,
  });
  const filtersOn = query.trim() !== '' || sort !== MARKET_DEFAULT_SORT || reversed || watchedOnly;
  const profilePlayer = profileId
    ? bootstrap.market.find((row) => row.playerId === profileId) ?? null
    : null;
  const profilePosition = profileId
    ? bootstrap.positions.find(
      (row) => row.playerId === profileId && row.status === 'active',
    ) ?? null
    : null;
  const profileResults = profileId
    ? bootstrap.settledResults.filter((result) => result.playerId === profileId)
    : [];

  const sideToggle = (
    <Segmented
      accessibilityLabel="Market side"
      onChange={setSide}
      options={[
        // "side" keeps these apart from the app's Roster tab, for ears and eyes.
        { key: 'long', label: 'Roster side', hint: positionSlotHint('long', bootstrap.account.longSlots.limit) },
        { key: 'short', label: 'Short side', hint: positionSlotHint('short', bootstrap.account.shortSlots.limit) },
      ]}
      // In the folded column a flex basis would become a height, so it only sizes rows.
      stacked={width < 140}
      style={rowToolbar || foldWide ? styles.sideToggleWide : folded || !slotLineBeside(width) || slotUnderToggle ? undefined : [styles.sideToggle, slotRoomFirst(width) && styles.sideToggleSnug]}
      value={side}
    />
  );
  // The slot count, then at most one line: the season is over, or when the
  // roster reopens, or that this side is full. A locked roster never shows
  // "drop one to add", because drops are locked too.
  // Beside the side toggle on a phone (wrapping to three short lines at
  // 360px); under it, left-aligned, only where even that leaves no room.
  const slotBeside = slotLineBeside(width) && !slotUnderToggle;
  // Beside the toggle its wrapped lines share one right edge.
  const slotRight = slotBeside && !rowToolbar && !folded;
  // Folded and too narrow to share the search button's row: a line of its own.
  const slotOwnLine = folded && !foldWide && !foldedSlotBeside(width);
  // Adds still saving on this side count, so the number matches the ticks
  // (walk 8 T2-08); the saving line sits over an invisible copy of the plain
  // one, so the toolbar keeps its height while you tap.
  const savingCount = slotView.side === side ? slotView.saving.length : 0;
  const waitingNow = playingNow !== null && savingCount > 0;
  const slotTextStyle = [styles.slotText, slotRight && styles.textRight];
  const plainSlotLine = slotLine(side, { used: Math.min(slots.used + savingCount, slots.limit), limit: slots.limit });
  const slotCount = savingCount > 0 ? (
    rowToolbar ? (
      // The table's toolbar sizes this block to its words, and overlaid
      // copies add up there: the block grew ~75px while adds saved and the
      // search box beside it jumped under the pointer (walk 10 T2-10). The
      // plain line, invisible, keeps the block's size; the saving line sits
      // over it (it is never longer, slotLine).
      <View style={styles.slotSavingWide}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.sameHeightGhost, styles.slotSavingGhost, NO_POINTER]}
          {...({ 'aria-hidden': true } as object)}
        >
          <Text maxFontSizeMultiplier={1.4} style={slotTextStyle}>{plainSlotLine}</Text>
        </View>
        <Text maxFontSizeMultiplier={1.4} style={[slotTextStyle, styles.slotSavingOver]}>{slotLine(side, slots, savingCount, waitingNow)}</Text>
      </View>
    ) : (
      <View style={styles.slotSaving}>
        <SameHeight ghosts={[<Text key="plain" maxFontSizeMultiplier={1.4} style={slotTextStyle}>{plainSlotLine}</Text>]}>
          <Text maxFontSizeMultiplier={1.4} style={slotTextStyle}>{slotLine(side, slots, savingCount, waitingNow)}</Text>
        </SameHeight>
      </View>
    )
  ) : (
    <Text maxFontSizeMultiplier={1.4} style={slotTextStyle}>{seasonOver ? seasonEndSlotLine(side, slots.used, slotRight) : lockLineShort(width) && !rowToolbar && !folded && !slotUnderToggle ? slotLineNarrow(side, slots) : slotLine(side, slots)}</Text>
  );
  // Measured beside the toggle in its plain wording only (not while moves
  // save or wait, not at season end).
  slotMeasurable.current = slotBeside && !rowToolbar && !folded && savingCount === 0 && !waitingNow && !seasonOver;
  const slotStatus = (
    <View ref={slotStatusRef} style={[styles.slotStatus, !slotBeside && styles.slotStatusUnder, rowToolbar && styles.slotStatusWide, rowToolbar && width >= LOCK_LINE_ROOMY_WIDTH && styles.slotStatusRoomy, folded && !slotOwnLine && styles.slotStatusFolded]}>
      {slotCount}
      {status.kind === 'lock' ? (
        <View style={styles.lockLine}>
          <LockIcon />
          <Text maxFontSizeMultiplier={1.4} style={styles.lockText}>{lockLineUnbroken(status.text ?? '')}</Text>
        </View>
      ) : status.text && (status.kind !== 'season' || seasonEndStatusShown(side)) ? (
        <Text maxFontSizeMultiplier={1.4} style={[styles.fullText, slotRight && styles.textRight]}>{unbrokenTail(status.text)}</Text>
      ) : null}
      {/* What a move costs, where the side is chosen (none while moves are locked or over). */}
      {/* While moves wait for the games playing now, the line names them. */}
      {status.kind === null || status.kind === 'full' ? (
        waitingNow && playingNow
          ? <Text maxFontSizeMultiplier={1.4} style={[styles.feeText, slotRight && styles.textRight]}>{waitingForLine(playingNow)}</Text>
          : feeHint(side, fee) ? <Text maxFontSizeMultiplier={1.4} style={[styles.feeText, slotRight && styles.textRight]}>{feeLine(side, fee)}</Text> : null
      ) : null}
    </View>
  );
  // "Search players" is cut in the narrow field below 360px (walk 5 T4-13).
  const searchPlaceholder = width < 360 ? 'Search' : 'Search players';
  const searchMatch = folded && controlsOpen && !foldWide
    ? searchMatchLine(query, rows.map((row) => row.player.name))
    : null;
  const sortToggle = (
    <SortControl
      onChoose={chooseSort}
      onFlip={flipOrder}
      // The table shows a Dividend last season column, so it sorts by it too.
      options={marketSortOptions(sort, wide)}
      reversed={reversed}
      sort={sort}
      style={rowToolbar ? styles.sortToggleWide : undefined}
    />
  );
  const watchingToggle = (
    <WatchingToggle count={watchlist.watched.length} on={watchedOnly} onChange={setWatchedOnly} />
  );
  // The Short side says how long a short runs before anyone pays for one.
  const shortWords = `${SHORT_EXPLAINER} ${shortTermLine(bootstrap.ruleset.shortTermDays)}`;
  // The × on a portrait phone's explainer: its room goes back to the list at
  // once, and a keyboard's focus goes on to the next stop (walk 16 T1-01).
  // Wrapped in unlessSettling: the × goes on the lift, and that tap's click
  // must not press the row it uncovers.
  const closeExplainer = unlessSettling(() => {
    const which = side;
    let next: HTMLElement | null = null;
    if (typeof document !== 'undefined') {
      const focused = document.activeElement as HTMLElement | null;
      const tips = Array.from(document.querySelectorAll('[data-explainer]'));
      // A key press moves focus on; a finger's tap leaves it (the skip link
      // after the tip would show, and push the rows down).
      if (!pressedByPointer() && focused && tips.some((tip) => tip.contains(focused))) {
        const stops = Array.from(document.querySelectorAll<HTMLElement>('a[href], button, input, [role="button"], [role="link"], [tabindex="0"]'))
          .filter((node) => !tips.some((tip) => tip.contains(node)));
        next = stops.find((node) => focused.compareDocumentPosition(node) & 4) ?? null;
      }
    }
    markExplained(which);
    setExplainerGone((gone) => ({ ...gone, [which]: true }));
    if (next) setTimeout(() => next?.focus(), 0);
  });
  const stackedPhone = !rowToolbar && !folded;
  const phoneTipShown = stackedPhone && !explainerGone[side];
  const shortExplainer = side === 'short' && roomy && (!stackedPhone || phoneTipShown) ? (
    stackedPhone ? (
      <ExplainerTip
        closeLabel="Hide how shorts work"
        inline
        onClose={closeExplainer}
        ref={valueTip ? undefined : explainerRef}
        text={seasonOver ? seasonEndExplainer('short') : shortWords}
        textStyle={styles.explainer}
      />
    ) : (
      <Text maxFontSizeMultiplier={1.4} style={styles.explainer}>{seasonOver ? seasonEndExplainer('short') : shortWords}</Text>
    )
  ) : null;
  // On a tablet or desktop each side explains itself in the same reserved
  // line, so switching sides never moves the table.
  const sideExplainer = (
    <Text maxFontSizeMultiplier={1.4} style={styles.explainer}>{seasonOver ? seasonEndExplainer(side, slots.used) : side === 'short' ? shortWords : ROSTER_EXPLAINER}</Text>
  );
  // The order in one quiet line (walk 9 T4-10, T1-16, T2-12): on phones
  // under the sort, on a laptop-height table in the sentence's place once the
  // first games are in; a tall table keeps its sentence slot.
  const compactSlot = wide && roomy && height < LAPTOP_HEIGHT_BELOW && sentenceGone;
  const order = orderLine({ sort, reversed, heldNote, gamesIn, form: orderLineForm(width, wide) });
  // A short pinned table's order line is the table's first row (walk 15 T2-06).
  const orderRow = pinned && folded && !roomy;
  const orderStrip = (
    <OrderLine
      centred={!wide && !rowToolbar}
      reserve={order.reserve}
      reserveOwn={order.reserveOwn}
      reserveResort={order.reserveResort}
      resort={order.resort ? { name: resortName(night, sortedNight), onPress: resortNow } : null}
      style={orderRow ? styles.orderRowLine : undefined}
      text={order.text}
      tone={order.tone}
    />
  );

  // Anything else inside the table (a divider, the footer, an empty list)
  // is a row of its own, one cell across (walk 8 T3-09).
  const tableSpan = 5 + (columns.yours > 0 ? 1 : 0) + (rowActions(seasonOver) ? 1 : 0);
  const spanRow = (node: ReactElement | null): ReactElement | null => (pinned && node ? (
    <View role="row">
      <View role="cell" {...({ 'aria-colspan': tableSpan } as object)}>{node}</View>
    </View>
  ) : node);
  const columnHeader = wide ? (
    <MarketColumnHeader
      // The button column's header, said only.
      actionHeader={side === 'long' ? 'Add or drop' : 'Short or close'}
      // No button column at season end, so the labels line up with quiet rows.
      columns={rowActions(seasonOver) ? columns : { ...columns, action: 0 }}
      // One name for this figure everywhere: the toolbar's sort, this
      // header and its accessible name all say "Value".
      valueLabel="Value"
      // True to the side on show (walk 10 T2-07).
      valueExplain={valueColumnExplanation(side)}
      lead={STAR_LEAD}
      onChoose={chooseSort}
      // While the order is from before the latest games, the sorted column's
      // first press re-sorts it as it reads (as Re-sort does); a fresh list
      // reverses (walk 10 T2-11).
      onFlip={heldNote ? resortNow : flipOrder}
      resortFirst={heldNote !== null}
      reversed={reversed}
      sort={sort}
      tableRoles={pinned}
    />
  ) : null;
  // A short table's order line: under its folded bar, or (pinned) the
  // table's first row, scrolling away with the rows (walk 15 T2-06).
  const tableSlot = compactSlot || (rowToolbar && !roomy) || (wide && folded && (!pinned || !roomy)) ? (
    <View style={[styles.explainerWide, styles.orderSlot, wide && folded && !pinned && styles.orderSlotFolded, orderRow && styles.orderSlotRow]}>{orderStrip}</View>
  ) : wide && roomy ? (
    <View style={[styles.explainerWide, styles.explainerSlot]}>
      {heldNote ? (
        <View style={styles.flipNote}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.explainer, styles.resortText]}>{heldNote}</Text>
          <Button accessibilityLabel={resortName(night, sortedNight)} label="Re-sort" onPress={resortNow} variant="secondary" />
        </View>
      ) : reversed ? (
        <View style={styles.flipNote}>
          <Text maxFontSizeMultiplier={1.4} style={styles.flipText}>{flippedSortNote(sort).text}</Text>
          <Button label={flippedSortNote(sort).restore} onPress={flipOrder} variant="secondary" />
        </View>
      ) : sideExplainer}
    </View>
  ) : null;
  // The phone toolbar (not a row toolbar, not folded) says what Value is on
  // a session's first visit (walk 13 T1-01).
  const phoneValueTip = valueTip && phoneTipShown;
  if (phoneValueTip) valueTipShown.current = true;
  // Folded for want of room, a pinned table lets this slot (the sentence,
  // or the "Same order as before…" line with Re-sort) scroll away with the
  // rows as their first row (walk 11 T2-09: at 960x600 after games the
  // pinned chrome kept 53% of the window).
  const slotScrolls = pinned && folded && tableSlot !== null;
  const marketHeading = (
    <View style={visuallyHidden}>
      <Text accessibilityRole="header" {...headingLevel(1)}>Market</Text>
    </View>
  );
  // A portrait phone keeps the side toggle and the slot line in view while
  // search, sort, the order line and the explainer scroll away with the rows
  // (walk 16 T1-01); at the list's top everything sits where it did.
  const phoneBarPinned = !rowToolbar && !folded;
  const sideRow = (
    <View style={[styles.controlRow, !slotBeside && styles.controlStack, slotRoomFirst(width) && styles.controlRowSnug, slotBeside && width < 340 && styles.controlRowTight]}>
      {sideToggle}
      {slotStatus}
    </View>
  );
  const phoneBar = phoneBarPinned ? (
    <View style={[styles.header, styles.phoneBar]}>
      {marketHeading}
      {sideRow}
    </View>
  ) : null;
  const listHeader = (
    <View ref={pinned ? undefined : listHeaderRef} style={styles.header}>
      {phoneBarPinned ? null : marketHeading}
      {rowToolbar ? (
        <View style={[styles.controlsWide, (!roomy || compactSlot) && styles.controlsShort]}>
          {sideToggle}
          {slotStatus}
          <MarketSearch onChange={setQuery} placeholder={searchPlaceholder} style={[styles.searchWide, wide && !roomy && styles.searchShort]} value={query} />
          {sortToggle}
          {watchingToggle}
        </View>
      ) : folded ? (
        // A phone at 200% zoom: the side toggle and the slot count stay; search,
        // sort and Watching fold behind one toggle so a player shows at once.
        <View style={[styles.controls, styles.controlsFolded]} {...(foldedKeys as object)}>
          {foldWide ? null : sideToggle}
          {slotOwnLine ? slotStatus : null}
          <View style={styles.foldedRow}>
            {foldWide ? sideToggle : null}
            {slotOwnLine ? null : slotStatus}
            {/* Landscape has room to say it in words (walk 4 T1-10). */}
            <ControlsToggle active={filtersOn} buttonRef={controlsToggleRef} labelled={foldWide} onToggle={toggleControls} open={controlsOpen} />
          </View>
          {shortExplainer}
          {controlsOpen ? (
            foldWide ? (
              <View style={styles.foldedOpenRow}>
                <MarketSearch focusOnMount={openedByKey.current} onChange={setQuery} onEscapeEmpty={closeControls} placeholder={searchPlaceholder} style={styles.searchFlex} value={query} />
                {sortToggle}
                {watchingToggle}
              </View>
            ) : (
              <>
                <MarketSearch focusOnMount={openedByKey.current} onChange={setQuery} onEscapeEmpty={closeControls} placeholder={searchPlaceholder} value={query} />
                {/* What the search found, in view while you type: the open
                    panel fills a 200% zoom screen (walk 8 T3-11). */}
                {searchMatch ? <Text maxFontSizeMultiplier={1.4} style={styles.watchingFooterText}>{searchMatch}</Text> : null}
                {sortToggle}
                {watchingToggle}
              </>
            )
          ) : null}
        </View>
      ) : (
        <View style={[styles.controls, styles.controlsUnderBar]}>
          {shortExplainer}
          {/* The two filters share a row; the sort and its order button get the next one whole. */}
          <View style={styles.filterRow}>
            <MarketSearch onChange={setQuery} onFocusChange={setSearchFocused} placeholder={searchPlaceholder} style={styles.searchFlex} value={query} />
            {/* Below 360px a search in progress takes Watching's words (walk 13 T4-06). */}
            <WatchingToggle compact={searchWidens(width, searchFocused, query)} count={watchlist.watched.length} on={watchedOnly} onChange={setWatchedOnly} />
          </View>
          {sortToggle}
          {orderStrip}
          {phoneValueTip ? (
            side === 'long' ? (
              <ExplainerTip
                closeLabel="Hide what Value means"
                onClose={closeExplainer}
                ref={explainerRef}
                style={styles.valueTip}
                // The rows' own words, so it keeps one line beside its ×.
                text={valueDefinition(side, true)}
                textStyle={styles.explainer}
                      />
            ) : (
              // The Short side's × is on its explainer above; this line goes with it.
              <View ref={explainerRef} style={styles.valueTip}>
                <Text maxFontSizeMultiplier={1.4} style={styles.explainer}>{valueDefinition(side, width < SEARCH_WIDENS_BELOW)}</Text>
              </View>
            )
          ) : null}
        </View>
      )}
      {/* On a tall desktop the unusual-order note takes the explainer's own
          slot, which always keeps a button's height, so pressing a column
          header again never pushes the table down under the pointer (walk 5
          T2-02: the header moved 44px and a third click missed). */}
      {slotScrolls ? null : tableSlot ?? (reversed && folded && controlsOpen ? (
        // On the list's gutter, with a reset that looks like the other small
        // outlined buttons (walk 5 T1-15: the note touched the screen edge).
        <View style={[styles.flipNote, styles.flipNoteGutter, folded && styles.flipNoteFolded]}>
          <Text maxFontSizeMultiplier={1.4} style={styles.flipText}>{flippedSortNote(sort).text}</Text>
          <Button label={flippedSortNote(sort).restore} onPress={flipOrder} variant="secondary" />
        </View>
      ) : null)}
      {/* After the toolbar, before the column labels: past the thirty rows in
          one press (two or three Tab stops each, walk 8 T3-I1). */}
      {resultCount > 0 ? <SkipLink label="Skip to the end of the list" onPress={skipToEnd} /> : null}
      {wide && !pinned ? columnHeader : null}
      {/* A heading to jump to the players, with their count (walk 7 T3-13). */}
      {resultCount > 0 ? (
        <View style={visuallyHidden}>
          <Text accessibilityRole="header" {...headingLevel(2)}>{listHeading(side, spokenCount, totalCount)}</Text>
        </View>
      ) : null}
      {/* The phone rows' list: its items are the rows below, owned in order
          (the toolbar shares their scroll area, so the rows cannot sit in a
          list element of their own). */}
      {!wide && resultCount > 0 ? (
        <View
          role="list"
          style={visuallyHidden}
          {...({ 'aria-owns': rows.map((row) => listItemId(row.side, row.player.playerId)).join(' ') } as object)}
        />
      ) : null}
    </View>
  );

  const trimmed = query.trim();
  // A suggestion searches for him; focus goes to the player found, whose Add
  // is the next stop (the pressed button leaves with the empty list).
  const takeSuggestion = (entry: NameSuggestion) => {
    setQuery(entry.query);
    if (typeof document === 'undefined') return;
    setTimeout(() => {
      const row = document.querySelector('[data-player]');
      const buttons = row ? (Array.from(row.querySelectorAll('[role="button"], button')) as HTMLElement[]) : [];
      const target = buttons.find((node) => /view profile/i.test(node.getAttribute('aria-label') ?? '')) ?? buttons[0];
      target?.focus();
    }, 60);
  };
  const unlistedStar = trimmed ? unlisted.star : null;
  const unlistedGuess = trimmed ? unlisted.guess : null;
  const emptyState = watchedOnly && watchlist.watched.length === 0 ? (
    <EmptyState
      action={<Button ref={emptyAction} label="Show everyone" onPress={() => setWatchedOnly(false)} />}
      // Said for any input (click, tap, keyboard), and where the star is: on
      // each table row, or (phone rows have none) in the player's profile.
      copy={wide
        ? "Star a player with the ☆ on his row, or Watch in his profile, to keep him here."
        : "Open a player and use Watch to keep him here."}
      level={2}
      title="You're not watching anyone yet"
    />
  ) : trimmed && !searchHasLetters(trimmed) ? (
    // "🏀", "'" or "-" alone: say what search needs instead of listing
    // everyone as if nothing were typed (walk 3 T4-05).
    <EmptyState
      action={<Button ref={emptyAction} label="Clear search" onPress={() => setQuery('')} variant="secondary" />}
      level={2}
      title={SEARCH_NEEDS_LETTERS}
    />
  ) : trimmed ? (
    // A star practice leaves out is named, with the nearest listed names if any (walk 15 T1-N4).
    <EmptyState
      action={(
        <View style={styles.emptyActions}>
          {/* The nearest name, one press away (walk 14 T4-N1). */}
          {suggestions.map((entry, index) => (
            <Button key={entry.query} ref={index === 0 ? emptyAction : undefined} label={`Search ${entry.label}`} onPress={() => takeSuggestion(entry)} />
          ))}
          <Button ref={suggestions.length === 0 ? emptyAction : undefined} label="Clear search" onPress={() => setQuery('')} variant="secondary" />
          {watchedOnly ? <Button label="Show everyone" onPress={clearFilters} variant="quiet" /> : null}
        </View>
      )}
      copy={suggestions.length > 0
        ? didYouMeanLine(suggestions)
        : unlistedStar
          ? `Clear the search to see all ${allRows.length}.`
          : unlistedGuess
          ? `${unlistedGuessLine(unlistedGuess, allRows.length)} Clear the search to see all ${allRows.length}.`
          : watchedOnly
          ? 'None of the players you watch match that name.'
          : isMockActive()
            ? `Practice lists ${allRows.length} players, so some real players are not here. Clear the search to see them all.`
            : 'Check the spelling, or clear the search to see the whole market.'}
      level={2}
      title={unlistedStar
        ? unlistedStarLine(unlistedStar, allRows.length)
        : isMockActive() && !watchedOnly ? `No listed player matches "${echoQuery(trimmed)}"` : `No players match "${echoQuery(trimmed)}"`}
    />
  ) : watchedOnly ? (
    <EmptyState
      action={<Button ref={emptyAction} label="Show everyone" onPress={() => setWatchedOnly(false)} />}
      copy="The players you watch are not listed right now."
      level={2}
      title="No watched players listed"
    />
  ) : (
    <EmptyState copy="Players appear here once prices are posted." level={2} title="The market is empty" />
  );

  // Under a Watching list, the count and the way back to everyone, on screen
  // as well as aloud (walk 6 T1-12: 450px of empty space under two rows), in
  // the toolbar's gutter (walk 16 T1-09: 4px left of it on phones).
  // Kept (unwatched, dimmed) rows count here: with every listed row
  // unwatched, "Show all 30" is still the way back (walk 8 T2-07).
  const watchingFooter = watchedOnly && !trimmed && resultCount > 0 ? (
    <View style={[styles.watchingFooter, { paddingHorizontal: space.lg }]}>
      <Text maxFontSizeMultiplier={1.4} style={styles.watchingFooterText}>{watchingLine(spokenCount)}</Text>
      <Button
        accessibilityLabel={`Show all ${totalCount} players`}
        label={`Show all ${totalCount}`}
        onPress={() => setWatchedOnly(false)}
        variant="secondary"
      />
    </View>
  ) : null;
  // Under a searched list, the count and the way back to everyone, on screen
  // as well as aloud, so coming back to a search says it is still on (walk 7
  // T3-19), as the Watching list's line does.
  const searchFooter = trimmed && searchHasLetters(trimmed) && spokenCount > 0 ? (
    <View style={[styles.watchingFooter, { paddingHorizontal: space.lg }]}>
      <Text maxFontSizeMultiplier={1.4} style={styles.watchingFooterText}>{searchFooterLine(echoQuery(trimmed), spokenCount)}</Text>
      <Button
        accessibilityLabel={`Show all ${totalCount} players`}
        label={`Show all ${totalCount}`}
        onPress={clearFilters}
        variant="secondary"
      />
    </View>
  ) : null;

  return (
    <>
      {pinned ? listHeader : phoneBar}
      {/* On a tall desktop the column labels and the rows are one table for
          screen readers (walk 8 T3-09); the labels stay put over the rows. */}
      {/* Above the toolbar in paint order, so a column's explanation, which
          opens upward over the toolbar, is seen (walk 9 T2-01, T3-01); the
          rows scroll inside the list, so they never reach the toolbar. */}
      <View style={[styles.list, pinned && styles.listOverToolbar]} {...(pinned ? ({ role: 'table', 'aria-label': listHeading(side, spokenCount, totalCount) } as object) : {})}>
      {pinned && columnHeader ? <View style={styles.tableHeader}>{columnHeader}</View> : null}
      <FlatList
        contentContainerStyle={styles.content}
        data={rows}
        extraData={[layout, columns, positionValues, pastValues, fee, width, priceReserve, seasonOver, watchlist.watched, kept, watchedOnly, firstBlockedId, blockedCount, heldFloorNow, averageDropped]}
        initialNumToRender={Math.min(Math.max(rows.length, 18), WHOLE_LIST_MAX)}
        keyboardShouldPersistTaps="handled"
        // One row per side: a press's "Added ✓" never follows him to the
        // other side's row (walk 8 T4-07).
        keyExtractor={(row) => `${row.side}:${row.player.playerId}`}
        ListEmptyComponent={spanRow(emptyState)}
        // After the players, not rows of the table: the table ends with its
        // last player (walk 13 T3-02: a reader counted 33 rows, the last two
        // "End of the list" and "Back to the practice controls").
        ListFooterComponent={(
          <>
            {resultCount > 0 ? <ListEnd label="End of the list" ref={listEndRef} /> : null}
            {resultCount > 0 && isMockActive() ? <SkipLink label="Back to the practice controls" onPress={backToControls} role="link" /> : null}
            {watchingFooter ?? searchFooter}
          </>
        )}
        // A folded pinned table lets the order line scroll away with the
        // rows (walk 11 T2-09: at 960x600 after games the pinned chrome kept
        // 53% of the window); it is the table's first row, across it.
        ListHeaderComponent={pinned ? (slotScrolls ? spanRow(<View style={styles.slotScrolling}>{tableSlot}</View>) : null) : listHeader}
        onScroll={onScroll}
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          // Rows further down are not laid out yet: jump near, then settle.
          listRef.current?.scrollToOffset({ offset: averageItemLength * index, animated: false });
          if (retries.current < 2) {
            retries.current += 1;
            setTimeout(() => listRef.current?.scrollToIndex({ index, animated: false }), 80);
          }
        }}
        onViewableItemsChanged={onViewableItemsChanged}
        ref={listRef}
        renderItem={({ item }) => {
          const actionKey = `position:${item.side}:${item.player.playerId}`;
          const otherKey = `position:${item.side === 'long' ? 'short' : 'long'}:${item.player.playerId}`;
          const savingElsewhere = !item.position && !item.blockedByOpposingPosition
            && (claims.includes(otherKey) || pendingActions.has(otherKey) || pendingActions.has(`queued:${otherKey}`));
          // Players held on the other side sit at the end whatever the sort;
          // a line says why, so the order does not look broken (walk 5 T2-19).
          const divider = item.player.playerId === firstBlockedId ? (
            <View style={[styles.blockedDivider, { paddingLeft: layout === 'table' ? space.lg : space.md }]}>
              <Text maxFontSizeMultiplier={1.4} style={styles.blockedDividerText}>
                {otherSideGroupLine(side, seasonOver, blockedCount)}
              </Text>
            </View>
          ) : null;
          const cell = (
          <>
          {spanRow(divider)}
          <MemoMarketRow
            columns={columns}
            currentValue={item.position ? positionValues.get(item.position.positionId) : undefined}
            fee={fee}
            dropImpactBps={bootstrap.ruleset.quoteDropImpactBps}
            layout={layout}
            seasonOver={seasonOver}
            wholeNames={keepNamesWhole(width)}
            width={width}
            priceReserve={priceReserve}
            fullTier={fullTier}
            tierAfterSurname={tierAfterSurname}
            onAnnounce={announce}
            onToggleWatch={toggleWatchStable}
            watched={watchlist.isWatched(item.player.playerId)}
            dimmed={watchedOnly && kept.includes(item.player.playerId) && !watchlist.isWatched(item.player.playerId)}
            heldFloor={item.position ? heldFloorNow : 0}
            onHeldStep={raiseHeldFloor}
            dropAverage={item.position ? averageDropped : false}
            onAverageDropped={dropHeldAverage}
            onOpenProfile={openProfile}
            pastValue={item.position ? undefined : pastValues.get(item.player.playerId)}
            row={item}
            pending={pendingActions.has(actionKey) || pendingActions.has(`queued:${actionKey}`)}
            ownSaving={claims.includes(actionKey)}
            busyElsewhere={savingElsewhere ? busyTag : null}
            lastSlotTo={item.position ? null : lastSlotTakenBy(slotView.remaining, slotView.saving, item.player.playerId)}
            onClaimSlot={claimSlot}
            onReleaseSlot={releaseSlot}
            rosterLocked={rosterLocked}
            rosterLockGameDate={lockDate}
            slotLimit={slots.limit}
            moves={moves}
            tableRoles={pinned}
          />
          </>
          );
          // Phone rows are a list's items (walk 10 T3-N2): each holds the
          // row, its button and whatever opens under it; the list before
          // them owns them, so a reader hears "list, 30 items" and each
          // item's place.
          return wide ? cell : (
            <View nativeID={listItemId(item.side, item.player.playerId)} role="listitem">{cell}</View>
          );
        }}
        // Every scroll is recorded, so a quick switch away keeps the exact spot.
        scrollEventThrottle={16}
        style={styles.list}
        windowSize={9}
      />
      </View>
      <View style={visuallyHidden}>
        <Text accessibilityLiveRegion="polite">{announcement}</Text>
      </View>
      <PlayerProfileSheet
        dividendRate={bootstrap.ruleset.dividendDollarsPerNetPoint}
        latestSettledDate={bootstrap.game.lastSettledDate}
        onClose={closeProfile}
        onToggleWatch={profileId ? () => toggleWatch(profileId) : undefined}
        player={profilePlayer}
        position={profilePosition}
        results={profileResults}
        initialView={profileId !== null && returnView ? returnView : undefined}
        side={profileId !== null && returnView?.side ? returnView.side : side}
        trends={profileId !== null && isMockActive() ? mockPlayerTrends(profileId) : undefined}
        visible={profileId !== null && profilePlayer !== null}
        watching={profileId ? watchlist.isWatched(profileId) : undefined}
      />
    </>
  );
}

/** A search that names no player practice leaves out. */
const NO_UNLISTED = { star: null, guess: null, retired: false } as const;

/** Seen, never pressed (react-native-web wants pointerEvents as a style). */
const NO_POINTER = { pointerEvents: 'none' } as const;

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  listOverToolbar: {
    // Above the pinned toolbar's zIndex 1 (styles.header).
    zIndex: 2,
  },
  content: {
    paddingBottom: 110,
  },
  header: {
    backgroundColor: colors.surface,
    // Pinned above the list, it stays over the rows on the web.
    zIndex: 1,
  },
  tableHeader: {
    backgroundColor: colors.surface,
    // Its column notes open upward, over the toolbar's sentence.
    zIndex: 2,
  },
  controls: {
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: 10,
    paddingBottom: 10,
  },
  phoneBar: {
    // The phone toolbar's first row, pinned over the list: its inset and the
    // toolbar's gap, so at the list's top every line sits where it did.
    paddingHorizontal: space.lg,
    paddingTop: 10,
    paddingBottom: space.sm,
  },
  controlsUnderBar: {
    paddingTop: 0,
  },
  controlRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
  },
  controlRowSnug: {
    // The slot lines are right-aligned, so a 4px gap still reads as space.
    columnGap: space.xs,
  },
  controlRowTight: {
    // 320-339px: the slot column wraps inside itself beside the toggle
    // rather than dropping under it, so a second player shows on arrival
    // (walk 10 T4-04).
    flexWrap: 'nowrap',
  },
  controlStack: {
    flexDirection: 'column',
    flexWrap: 'nowrap',
    alignItems: 'stretch',
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  searchFlex: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
  },
  controlsFolded: {
    paddingHorizontal: space.sm,
    paddingTop: space.sm,
    paddingBottom: space.sm,
  },
  foldedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  foldedOpenRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
  },
  controlsWide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
  },
  controlsShort: {
    // The phone toolbar's own inset, in a window with little height to spare.
    paddingVertical: 10,
  },
  sideToggle: {
    // Wide enough for "ROSTER SIDE" (80px) on one line; the slot count takes
    // the rest, beside it from 340px (walk 3 T1-09).
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 200,
    minWidth: 196,
    maxWidth: 240,
  },
  sideToggleWide: {
    width: 212,
  },
  sideToggleSnug: {
    // 340-389px: the slot column takes the room first, so the fee phrase
    // keeps one line (walk 8 T1-10); "ROSTER SIDE" still fits at 196px.
    flexGrow: 0,
    flexBasis: 196,
  },
  slotStatus: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 110,
    minWidth: 0,
    alignItems: 'flex-end',
  },
  textRight: {
    textAlign: 'right',
  },
  slotSaving: {
    alignSelf: 'stretch',
  },
  slotSavingWide: {
    position: 'relative',
    alignSelf: 'stretch',
  },
  slotSavingGhost: {
    marginLeft: 0,
  },
  slotSavingOver: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  slotStatusUnder: {
    alignItems: 'flex-start',
    // In the stacked column a 110px basis became 110px of height: an empty
    // band above the search at 320px (walk 5 T4-13).
    flexGrow: 0,
    flexBasis: 'auto',
  },
  slotStatusFolded: {
    // Takes the room the search button leaves (below 340px the stacked
    // style's flexGrow 0 left it 0px wide, so its words ran under the
    // button: walk 6 T3-01, T4-10).
    flexGrow: 1,
    flexBasis: 0,
    alignItems: 'flex-start',
    minWidth: 0,
  },
  slotStatusWide: {
    flexGrow: 0,
    flexBasis: 'auto',
    alignItems: 'flex-start',
    minWidth: 140,
    // A locked night's line ("Moves reopen after Oct 28 · your players still
    // play") wraps under the count instead of squeezing the search box below
    // its placeholder (walk 6 T2-19: 138px at 1024x768).
    maxWidth: 150,
  },
  slotStatusRoomy: {
    // A wide screen has room for "🔒 Moves reopen after Oct 28" on one line
    // (walk 7 T2-03: a two-line stub with the date alone at 1440).
    maxWidth: 240,
  },
  slotText: {
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.caption,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
    lineHeight: 16,
  },
  fullText: {
    color: colors.text,
    fontSize: type.label,
    fontWeight: weight.bold,
    lineHeight: 15,
  },
  feeText: {
    color: colors.muted,
    fontSize: type.label,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
    lineHeight: 15,
  },
  lockLine: {
    // No top margin: the line is as tall as the fee line it replaces, so a
    // lock eve never nudges the list (walk 11 T4-08).
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  lockText: {
    // Wraps within the slot block beside its icon, never past it.
    flexShrink: 1,
    minWidth: 0,
    color: colors.goldInk,
    fontSize: type.label,
    fontWeight: weight.bold,
    lineHeight: 15,
  },
  flipNote: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: space.sm,
  },
  flipNoteGutter: {
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
    rowGap: space.xs,
  },
  flipNoteFolded: {
    paddingHorizontal: space.sm,
  },
  resortText: {
    color: colors.text,
  },
  flipText: {
    color: colors.goldInk,
    fontFamily: fonts.display,
    fontSize: type.caption,
    fontWeight: weight.bold,
  },
  explainer: {
    color: colors.muted,
    fontSize: type.caption,
    lineHeight: 17,
  },
  valueTip: {
    // Under the order line it explains, at the toolbar's own gap: the line is
    // one text line now, with no empty Re-sort room to tuck into (walk 16 T1-02).
    marginTop: -2,
  },
  explainerWide: {
    // Two lines' room: the longer (short) sentence wraps once on a tablet.
    minHeight: 34,
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
    marginTop: -space.xs,
  },
  blockedDivider: {
    paddingVertical: space.sm,
    paddingRight: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  blockedDividerText: {
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.caption,
    fontWeight: weight.bold,
  },
  orderSlot: {
    // One line (the order strip keeps its own height) under a toolbar with
    // the short window's inset: a laptop's table shows a row more (T2-12).
    minHeight: 0,
    paddingBottom: 6,
    marginTop: -space.sm,
  },
  orderSlotFolded: {
    // Under the folded bar (a short laptop table, walk 11 T3-13) the line
    // keeps clear of the side toggle; Re-sort's reserve is its space below.
    marginTop: 0,
    paddingBottom: 0,
  },
  slotScrolling: {
    // The table's first row under the pinned labels, not under the toolbar.
    paddingTop: space.sm,
  },
  orderSlotRow: {
    // A short table's order line as its first row: centred in its reserve,
    // clear of the pinned labels' edge (walk 15 T2-06).
    marginTop: -space.sm,
    paddingTop: space.xs,
    paddingBottom: space.xs,
  },
  orderRowLine: {
    alignItems: 'center',
  },
  explainerSlot: {
    // A quiet button's height, whichever it holds (sentence or order note).
    minHeight: control.height + space.md,
    justifyContent: 'center',
  },
  searchWide: {
    flexGrow: 1,
    // Leaves Watching room on the first row at 1024px, so the toolbar and
    // its sentence take two rows before the table (walk 5 T2-14).
    flexBasis: 120,
  },
  searchShort: {
    // Gives way first, so the toolbar keeps to one row on a laptop.
    flexBasis: 140,
  },
  sortToggleWide: {
    flexShrink: 0,
  },
  row: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'stretch',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  rowTable: {
    paddingRight: space.lg,
  },
  rowLarge: {
    flexDirection: 'column',
  },
  // Unwatched under the Watching filter, still live: full-strength words (a
  // faded row read at 2.5:1, walk 4 T3-08), marked by an edge and the
  // "No longer watching · Watch again" line under it.
  // The kept row's marker sits over its left edge, so his star, photo and
  // name keep their column (walk 7 T2-01: a border moved them 3px right).
  dimMarker: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    zIndex: 1,
    backgroundColor: colors.borderStrong,
  },
  keptLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: space.xs,
    paddingLeft: space.md,
    backgroundColor: colors.background,
  },
  keptText: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.caption,
    fontWeight: weight.bold,
  },
  profileArea: {
    minWidth: 0,
    minHeight: control.height,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingLeft: space.md,
    paddingRight: space.md,
    paddingTop: ROW_PAD,
    paddingBottom: ROW_PAD + 1,
  },
  profileAreaTable: {
    minHeight: 60,
    alignItems: 'center',
    // A held row's three lines (chip, name, your net) fit the same 60px as
    // a two-line row, so adding a player never moves the rows below (L-01).
    paddingTop: 3,
    paddingBottom: 3,
    // The watch star sits before the avatar (see STAR_LEAD).
    paddingLeft: space.sm,
  },
  starWrap: {
    // The star's cell: it keeps the star centred on the row, as before.
    justifyContent: 'center',
  },
  profileWrap: {
    // The player's cell takes the row's room; the profile button fills it.
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
  },
  starCell: {
    width: control.height,
    minHeight: control.height,
    marginLeft: space.sm,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAreaLarge: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
  },
  avatarBox: {
    // Centres the avatar on the 44px top band that holds the name and price.
    paddingTop: (control.height - PHONE_AVATAR) / 2,
  },
  avatarBoxLarge: {
    paddingTop: 2,
  },
  rowContent: {
    minWidth: 0,
    flex: 1,
  },
  topBand: {
    minHeight: control.height,
    justifyContent: 'center',
  },
  kickerPriceLine: {
    // One line while the given name fits beside the price; a longer one is
    // never cut (walk 8 T3-07: "KARL…" at 320px): the price keeps the top
    // right and the whole given name takes the line under it, just above
    // the surname. (wrap-reverse puts the wrapped price line on top.)
    flexDirection: 'row',
    flexWrap: 'wrap-reverse',
    alignItems: 'baseline',
    columnGap: space.sm,
  },
  kickerParts: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexShrink: 1,
    minWidth: 0,
  },
  kickerGiven: {
    flexShrink: 1,
    minWidth: 0,
  },
  kickerTier: {
    flexShrink: 0,
  },
  priceEnd: {
    // Right-aligned on the kicker's line, or on its own line when it wraps.
    marginLeft: 'auto',
    alignItems: 'flex-end',
  },
  priceReserve: {
    // Only a width: the widest price box, flat and unseen (priceWidthReserve).
    height: 0,
    overflow: 'hidden',
    opacity: 0,
  },
  kickerShrink: {
    flexShrink: 1,
    minWidth: 0,
  },
  identity: {
    minWidth: 0,
    flex: 1,
  },
  kickerLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 6,
    rowGap: 2,
  },
  kicker: {
    ...labelStyle,
    letterSpacing: 0.6,
  },
  kickerTag: {
    alignSelf: 'center',
    paddingVertical: 1,
  },
  sameHeight: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  sameHeightLayer: {
    width: '100%',
    flexShrink: 0,
  },
  sameHeightGhost: {
    marginLeft: '-100%',
    opacity: 0,
  },
  surname: {
    flexShrink: 1,
    minWidth: 0,
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
    lineHeight: 20,
  },
  tierInline: {
    ...labelStyle,
    letterSpacing: 0.6,
  },
  chevron: {
    color: colors.faint,
    fontWeight: weight.bold,
  },
  priceBox: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexShrink: 0,
  },
  price: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
    fontVariant: ['tabular-nums'],
  },
  priceUnit: {
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.bold,
  },
  detailLines: {
    // Two lines on every row: the break always falls after the first (walk 5 T1-04).
    flexDirection: 'column',
    rowGap: 0,
  },
  detailLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: 4,
    rowGap: 2,
  },
  detailText: {
    fontFamily: fonts.display,
    fontSize: type.caption,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
    lineHeight: 17,
  },
  leadText: {
    color: colors.muted,
  },
  heldText: {
    color: colors.text,
  },
  cell: {
    alignItems: 'flex-end',
  },
  cellValue: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  cellQuiet: {
    color: colors.faint,
    fontSize: type.caption,
    fontWeight: weight.bold,
  },
  cellCaption: {
    marginTop: 1,
    color: colors.faint,
    fontSize: type.label,
    fontVariant: ['tabular-nums'],
  },
  cellTag: {
    alignSelf: 'center',
  },
  actionCell: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionFloat: {
    position: 'absolute',
    top: ROW_PAD,
    right: space.md,
    height: control.height,
  },
  actionCellLarge: {
    alignItems: 'flex-start',
    // Lines the button up with the name above it: row inset + avatar + gap.
    paddingLeft: space.md + PHONE_AVATAR + 10,
    paddingBottom: space.md,
  },
  actionCellTiny: {
    paddingLeft: space.md,
  },
  phoneButton: {
    // "ADDED ✓" and "SEASON OVER" fit a 76px button on one and two lines.
    paddingHorizontal: 6,
  },
  phoneButtonDone: {
    // "DROPPED ✓" and "SHORTED ✓" keep one line in the same 76px (walk 5 T4-03).
    paddingHorizontal: 2,
  },
  buttonText: {
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  buttonTextDone: {
    letterSpacing: 0,
  },
  buttonTextFull: {
    // "FULL" over "MAKE ROOM", both whole in the 76px phone button.
    letterSpacing: 0,
    lineHeight: 14,
  },
  // The Roster's "question open" look: this is what you are deciding.
  buttonArmed: {
    borderColor: colors.gold,
    backgroundColor: colors.goldSoft,
  },
  buttonTextArmed: {
    color: colors.goldInk,
  },
  // "Waiting": a move held for the games playing now. Solid and neutral:
  // not the green of a move that worked, not the dashed "not now".
  buttonWaiting: {
    borderStyle: 'solid',
    borderColor: colors.controlBorder,
  },
  buttonTextWaiting: {
    color: colors.text,
    letterSpacing: 0,
  },
  stripTable: {
    // Under a wide row the strip keeps the row's inset and lines its buttons
    // up with the action column.
    paddingLeft: space.lg,
    paddingRight: space.lg,
  },
  watchingFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: space.md,
    rowGap: space.xs,
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  watchingFooterText: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.caption,
    fontWeight: weight.bold,
  },
  emptyActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  pressed: {
    opacity: 0.72,
  },
});
