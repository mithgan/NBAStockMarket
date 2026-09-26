import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
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
import { OrderLine } from '../components/market/OrderLine';
import { listenForActivations, pressedInScreen } from '../components/market/lastActivation';
import { spaceToggles } from '../components/market/switchKeys';
import { useAriaDisabled } from '../components/market/useAriaDisabled';
import { pressedByPointer } from '../web/tapSettle';
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
  lockNotice,
  rosterReopensLine,
  signedMoney,
  unbrokenName,
  moneyCompact,
  signedMoneyCompact,
} from '../copy/terms';
import { practiceProgress } from '../data/chromeView';
import {
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
  heldValueLine,
  heldValuePhrase,
  HELD_NOW_MIN_WIDTH,
  isSeasonOver,
  JUST_OPENED_MS,
  keptAnnouncement,
  justClosedName,
  justOpenedName,
  keepNamesWhole,
  KICKER_TIER_MIN_WIDTH,
  listCountLine,
  marketColumns,
  marketLayout,
  marketSortOptions,
  netTone,
  nextSortState,
  orderLine,
  otherSideSaving,
  phoneRowPhoto,
  slotLineBeside,
  slotRoomFirst,
  foldedSlotBeside,
  fullTierFits,
  rowActions,
  rowKicker,
  rowHeaderLabel,
  rowProfileLabel,
  rowTier,
  rowValueEdge,
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
  sameOrder,
  shortTermLine,
  unheldValueLines,
  listHeading,
  surnameFontSize,
  searchFooterLine,
  searchMatchLine,
  stillFilteredLine,
  valueLineParts,
  watchingLine,
  VALUE_ONE_LINE_MIN_WIDTH,
  valueByPosition,
  waitingActionName,
  waitingForLine,
  valueSignal,
  type MarketColumnSet,
  type MarketLayout,
  type MarketSort,
  type SignalTone,
} from '../data/marketView';
import { MARKET_DEFAULT_SORT, marketMemory, openingSide, rememberMarket } from '../data/marketViewMemory';
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

/** The tag a player carries when he is held on a side. */
function sideTag(side: PerGamePositionSide): 'On your roster' | 'Shorted' {
  return side === 'long' ? 'On your roster' : 'Shorted';
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
    if (id && rect.bottom > top + 1) return { id, dy: rect.top - top };
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
type MarketMoves = Pick<ReturnType<typeof usePerGame>, 'closePosition' | 'dismissNotice' | 'notify' | 'openPosition'>;

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
  wholeNames,
  seasonOver,
  width,
  fullTier,
  tierAfterSurname,
  onOpenProfile,
  onAnnounce,
  watched,
  onToggleWatch,
  dimmed = false,
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
  /** Keep hyphenated names whole (there is room for them on this width). */
  wholeNames: boolean;
  /** No games are left: the row carries no button, so nothing can charge a fee. */
  seasonOver: boolean;
  /** The screen width: below 380px the kicker leaves out the tier. */
  width: number;
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
  const { closePosition, dismissNotice, notify, openPosition } = moves;
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
  // Rows are keyed by side, so the tick stays on the side it was pressed on
  // (walk 8 T4-07); coming back to that side while it saves shows it again.
  const opening = optimistic === 'open' || (optimistic === null && ownSaving && !position);
  const shownHeld = opening ? true : optimistic === 'close' ? false : position !== null;
  // Held for as long as the move is on its way (a queued move can outlast the
  // cooldown), then for the cooldown once it lands.
  const justOpened = opening || (cooling && lastAction.current === 'open' && position !== null);
  const justClosed = optimistic === 'close' || (cooling && lastAction.current === 'close' && position === null);

  // Drop and Close ask in a strip under the row (fee, what stays, what coming
  // back costs). It waits for Keep, Escape or the costly button: no timeout.
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
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
  const waiting = waitingFor !== null && opening;
  const word = waiting ? 'Waiting' : actionWord({
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
  useEffect(() => {
    const node = actionRef.current as unknown as { setAttribute?: (name: string, value: string) => void; removeAttribute?: (name: string) => void } | null;
    if (!node?.setAttribute || !node.removeAttribute) return;
    // Only Drop/Close (its question) and FULL (its note) open something; the
    // "Added ✓" beat is neither, so it is never "collapsed" (walk 8 T3-04).
    if (position && !resting) node.setAttribute('aria-expanded', confirming ? 'true' : 'false');
    else if (fullButton) node.setAttribute('aria-expanded', noting ? 'true' : 'false');
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
  // His move on the other side still saving: shown as he will be once it
  // saves (no button here), in place, saying it is on its way.
  const busy = busyElsewhere !== null && !position && !row.blockedByOpposingPosition;
  const blocked = (row.blockedByOpposingPosition || busy) && !position;
  const tagText = position
    ? sideTag(side)
    : busy && busyElsewhere
      ? busyElsewhere.tag
      : blocked ? sideTag(side === 'long' ? 'short' : 'long') : null;
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
  const heldLine = (text: string, tone: SignalTone, value: ReturnType<typeof heldValueLine>) => valueLines(
    <Text maxFontSizeMultiplier={1.6} style={[styles.detailText, styles.heldText]}>
      {`${sideTag(side)} · `}
      <Text style={{ color: TONE_COLOR[tone] }}>{text}</Text>
    </Text>,
    // Last season against your price, in neutral ink: the row's only
    // coloured figure is what he made you (walk 9 T1-06).
    <Text maxFontSizeMultiplier={1.6} style={[styles.detailText, styles.leadText]}>
      {joiner ? <Text style={styles.leadText}>{joiner}</Text> : null}
      {value.value}
      {width >= HELD_NOW_MIN_WIDTH ? <Text style={styles.leadText}>{` ·\u00A0${value.now}`}</Text> : null}
    </Text>,
  );
  const unheldLineFor = (shown: typeof signal) => {
    const lines = unheldValueLines(shown);
    const parts = valueLineParts(lines.first, lines.second, oneLine);
    return valueLines(
      <Text maxFontSizeMultiplier={1.6} style={[styles.detailText, styles.leadText]}>{parts.first}</Text>,
      <Text maxFontSizeMultiplier={1.6} style={[styles.detailText, { color: TONE_COLOR[shown.tone] }]}>
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
    <SameHeight ghosts={[unheldGhost]}>{heldLine(held.text, held.tone, heldValue)}</SameHeight>
  ) : blocked ? (
    <SameHeight ghosts={[unheldLine]}>
      <View style={styles.detailLine}>
        <Tag>{tagText}</Tag>
      </View>
    </SameHeight>
  ) : (
    <SameHeight ghosts={[heldLine(heldDetail(undefined, currentGameCost).text, 'none', heldValue)]}>{unheldLine}</SameHeight>
  );

  // A held row leads with the price you locked, "yours $417.5K" (walk 4
  // T1-19); today's price is on its value line ("now $418.5K"). The held box
  // leaves "/game" out, so it is no wider than an unheld one and the tier
  // keeps its place beside the given name when he is added.
  const heldPriceBox = (amount: string) => (
    <View style={styles.priceBox}>
      <Text maxFontSizeMultiplier={1.6} style={styles.priceUnit}>{'yours '}</Text>
      <Text maxFontSizeMultiplier={1.6} style={styles.price}>{amount}</Text>
    </View>
  );
  const marketPriceBox = (
    <View style={styles.priceBox}>
      <Text maxFontSizeMultiplier={1.6} style={styles.price}>{priceAmount}</Text>
      <Text maxFontSizeMultiplier={1.6} style={styles.priceUnit}>{`/${priceUnit}`}</Text>
    </View>
  );
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
      <View style={styles.priceEnd}>{box}</View>
    </View>
  );
  const heldTop = kickerLine(heldPriceBox(position ? perGameShort(position.lockedGameCost).split('/')[0] : priceAmount));
  const unheldTop = kickerLine(marketPriceBox);
  const topLine = position
    ? <SameHeight ghosts={[unheldTop]}>{heldTop}</SameHeight>
    : <SameHeight ghosts={[heldTop]}>{unheldTop}</SameHeight>;

  const label = rowProfileLabel({
    name: player.name,
    tier: player.tier,
    price: currentGameCost,
    // A blocked row says why in the reason sentence instead.
    detail: blocked
      ? ''
      : position && held
        ? `${tagText}, ${held.text}, ${heldValuePhrase(player, side, position.lockedGameCost)}`
        : [signal.lead?.replace(/ ·$/, ''), signal.text].filter(Boolean).join(', '),
    reason: blocked ? (busy && busyElsewhere ? busyElsewhere.reason : row.unavailableReason) : null,
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
            ? waitingActionName(side, player.name, waitingFor)
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
          // LOCKED answers a tap with why and when, as on the Roster.
          onDisabledPress={rosterLocked ? () => notify(lockNotice(rosterLockGameDate)) : undefined}
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
              onAnnounce(keptAnnouncement(side, player.name));
              return;
            }
            if (position) {
              askedAt.current = Date.now();
              setConfirming(true);
            } else {
              // A press in the same moment as another Add into the last slot:
              // FULL's note says whose Add took it, and nothing is painted added.
              const takenBy = onClaimSlot(side, player.playerId);
              if (takenBy) {
                dismissNotice();
                setNoting(true);
                return;
              }
              lastAction.current = 'open';
              setOptimistic('open');
              setWaitingFor(practicePlaying());
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
                }, () => {
                  setOptimistic(null);
                  setWaitingFor(null);
                  onReleaseSlot(side, player.playerId);
                });
              });
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
      })}
      onCancel={() => {
        closeStrip();
        onAnnounce(keptAnnouncement(side, player.name));
      }}
      onConfirm={() => {
        closeStrip();
        lastAction.current = 'close';
        setOptimistic('close');
        startCooling();
        afterPaint(() => {
          void closePosition(position).then((closed) => {
            setOptimistic(null);
            if (closed) startCooling();
          }, () => setOptimistic(null));
        });
      }}
      style={table ? styles.stripTable : undefined}
    />
  ) : null;
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
    // The table's cells as a screen reader moves through them (walk 8
    // T3-09): the star, the player (his profile button), each figure in its
    // column, the button. The figures drawn inside the profile button are
    // its presentational children, so each column also gets a said-only cell.
    const yoursWords = position && currentValue && currentValue.avgNet !== null && currentValue.games > 0
      ? `${signedMoneyCompact(currentValue.avgNet)}, ${currentValue.games === 1 ? '1 game' : `${currentValue.games} games`}`
      : position
        ? 'No games yet'
        : pastValue && pastValue.avgNet !== null && pastValue.games > 0
          ? `${signedMoneyCompact(pastValue.avgNet)}, ${pastValue.games === 1 ? '1 past game' : `${pastValue.games} past games`}`
          : 'not held';
    const saidCells = tableRoles ? [
      position ? `${money(position.lockedGameCost)}, ${heldPriceCaption(position.lockedGameCost, currentGameCost)}` : money(currentGameCost),
      priorSeasonValuePerGame === null ? 'no last season' : moneyCompact(priorSeasonValuePerGame),
      tableEdge === null
        ? 'no last season'
        : `${netTone(tableEdge) === 'even' ? 'Even' : signedMoneyCompact(tableEdge)}${position ? ', at your price' : ''}`,
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
        <View style={styles.profileWrap} {...(tableRoles ? ({ role: 'rowheader' } as object) : {})}>
        <Pressable
          accessibilityLabel={tableRoles
            ? rowHeaderLabel({
              name: player.name,
              tier: player.tier,
              tag: position && !blocked ? tagText : null,
              reason: blocked ? (busy && busyElsewhere ? busyElsewhere.reason : row.unavailableReason) : null,
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
              {position ? <Tag style={styles.kickerTag}>{columns.yours === 0 && side === 'long' ? 'Yours' : tagText}</Tag> : null}
            </View>
            <Text maxFontSizeMultiplier={1.4} style={styles.surname}>{nameLine}</Text>
            {/* The result once he has played; the locked price is "Yours" under
                the price, said once per row (walk 4 T2-11). */}
            {columns.yours === 0 && position && held && currentValue && currentValue.games > 0 ? (
              <Text maxFontSizeMultiplier={1.4} style={[styles.detailText, { color: TONE_COLOR[held.tone] }]}>{held.text}</Text>
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
                <Text maxFontSizeMultiplier={1.4} style={[styles.cellValue, { color: TONE_COLOR[netTone(tableEdge)] }]}>
                  {/* One style down the column: "+$8K" beside "+$25.5K" (walk 3 T2-03). */}
                  {netTone(tableEdge) === 'even' ? 'Even' : signedMoneyCompact(tableEdge)}
                </Text>
                {/* A held row's Value is at the price you locked, the Roster's figure (walk 5 T4-02). */}
                {position ? <Text maxFontSizeMultiplier={1.4} style={styles.cellCaption}>at your price</Text> : null}
              </>
            )}
          </View>
          {columns.yours > 0 ? (
            <View style={[styles.cell, { width: columns.yours }]}>
              {position && currentValue && currentValue.avgNet !== null && currentValue.games > 0 ? (
                <>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.cellValue, { color: TONE_COLOR[netTone(currentValue.avgNet)] }]}>
                    {/* The Roster's per-game precision (walk 4 T4-13). */}
                    {signedMoneyCompact(currentValue.avgNet)}
                  </Text>
                  <Text maxFontSizeMultiplier={1.4} style={styles.cellCaption}>
                    {currentValue.games === 1 ? '1 game' : `${currentValue.games} games`}
                  </Text>
                </>
              ) : position ? (
                <Text maxFontSizeMultiplier={1.4} style={[styles.cellValue, styles.cellQuiet]}>No games yet</Text>
              ) : pastValue && pastValue.avgNet !== null && pastValue.games > 0 ? (
                <>
                  <Text maxFontSizeMultiplier={1.4} style={[styles.cellValue, { color: TONE_COLOR[netTone(pastValue.avgNet)] }]}>
                    {signedMoneyCompact(pastValue.avgNet)}
                  </Text>
                  <Text maxFontSizeMultiplier={1.4} style={styles.cellCaption}>
                    {pastValue.games === 1 ? '1 past game' : `${pastValue.games} past games`}
                  </Text>
                </>
              ) : (
                // Not yours: one quiet dash, as the other columns mark an empty
                // cell, and said in words (walk 6 T2-03: a blank column read
                // like one that failed to load).
                <Text accessibilityLabel="not held" maxFontSizeMultiplier={1.4} style={[styles.cellValue, styles.cellQuiet]}>—</Text>
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
  // Escape in the folded panel's empty search closes the panel and returns
  // focus to "Search & sort" (walk 5 T3-03).
  const controlsToggleRef = useRef<View>(null);
  const closeControls = useCallback(() => {
    setControlsOpen(false);
    setTimeout(() => (controlsToggleRef.current as unknown as { focus?: () => void } | null)?.focus?.(), 0);
  }, []);
  // Opened from the keyboard, the panel puts focus in its search box, so
  // typing searches at once (walk 6 T3-02); a tap leaves focus where it was.
  const openedByKey = useRef(false);
  // A double tap opens it once and leaves it open (walk 8 T4-05: in
  // landscape the second tap shut it again at 150 and 250 ms), as the other
  // toggles do; a key press always acts.
  const toggleControls = useMemo(() => repeatSafe(() => {
    const opening = !controlsOpenRef.current;
    openedByKey.current = opening && !pressedByPointer();
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
  const folded = collapseControls(width, height, layout === 'table');
  // A short but wide window folds into one row: side, slot line, toggle.
  const foldWide = folded && width >= 480;
  const columns = useMemo(() => marketColumns(width), [width]);
  const wide = layout === 'table';
  // On a tablet or desktop the toolbar and column labels stay put while the
  // rows scroll under them, so a row far down is never a column of unlabelled
  // numbers. Below 560px of height (a short laptop window) every row counts:
  // the explainer sentence goes (it is in Rules), the toolbar keeps to one
  // row, and it scrolls away with the list, column labels too (T2-21).
  const roomy = height >= ROOMY_MIN_HEIGHT;
  const pinned = wide && roomy;
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
  // Under a text-spacing style long given names were cut ("KARL-AN… · STAR",
  // walk 7 T3-07): once any row's given name is cut beside its tier, every
  // row puts its tier after the surname, the narrow phones' place, so names
  // stay whole. Checked after each layout and when a style sheet is added.
  const [tierAfterSurname, setTierAfterSurname] = useState(false);
  useEffect(() => {
    setTierAfterSurname(false);
  }, [width]);
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
  const firstBlockedId = rows.find((row) => row.blockedByOpposingPosition)?.player.playerId ?? null;
  // Measured before the first paint, so a list that needs it never shows the
  // other place first; a style sheet added later is checked a frame after.
  useLayoutEffect(() => {
    if (layout !== 'phone' || tierAfterSurname || typeof document === 'undefined' || typeof requestAnimationFrame !== 'function') return undefined;
    let frame = 0;
    const check = () => {
      frame = 0;
      const cut = Array.from(document.querySelectorAll('[data-kicker-given]')).some((node) => node.scrollWidth > node.clientWidth + 1);
      if (cut) setTierAfterSurname(true);
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
  }, [layout, tierAfterSurname, width, rows]);
  const positionValues = useMemo(
    () => valueByPosition(bootstrap?.settledResults ?? []),
    [bootstrap?.settledResults],
  );
  const pastValues = useMemo(
    () => accountValueByPlayer(bootstrap?.settledResults ?? [], side),
    [bootstrap?.settledResults, side],
  );
  const openProfile = useCallback((playerId: string) => setProfileId(playerId), []);
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
  const heldNote = night !== sortedNight && orderMoved ? heldOrderLine(sortedNight, night) : null;
  const resortNow = useCallback(() => {
    const previous = sortedNightRef.current;
    if (previous === nightRef.current) return;
    setSortedNight(nightRef.current);
    announce(resortedLine(previous, nightRef.current));
  }, [announce]);
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
  const anchor = useRef<{ id: string; dy: number; width: number; height: number } | null>(null);
  const recordAnchor = useCallback((force = false) => {
    if (typeof window === 'undefined' || !window.innerWidth) return;
    const shown = { width: window.innerWidth, height: window.innerHeight };
    const saved = anchor.current;
    // The window changed size and the rows have not been put back yet.
    if (!force && saved && (saved.width !== shown.width || saved.height !== shown.height)) return;
    const found = readAnchor(listRef.current?.getScrollableNode?.() as AnchorNode | undefined);
    if (!found) return;
    anchor.current = { ...found, ...shown };
    place.current.anchorId = found.id;
  }, []);
  const aligning = useRef(false);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    place.current.offset = event.nativeEvent.contentOffset.y;
    if (!aligning.current) recordAnchor();
  }, [recordAnchor]);
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
      if (remembered.offset <= 0) return;
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
      rememberMarket({ anchorId: place.current.anchorId, offset: place.current.offset, width: widthRef.current });
    };
  }, [remembered, scrollToPlayer]);
  // A rotation or a resized window reflows every row: bring the same player
  // back to the same spot, re-aligning for a moment while rows settle, unless
  // the player scrolls meanwhile.
  const sizeRef = useRef({ width, height });
  useEffect(() => {
    const before = sizeRef.current;
    if (before.width === width && before.height === height) return undefined;
    sizeRef.current = { width, height };
    widthRef.current = width;
    const saved = anchor.current;
    if (!saved || place.current.offset <= 0) {
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
    const finish = () => {
      aligning.current = false;
      if (typeof window !== 'undefined') events.forEach((name) => window.removeEventListener(name, stop, { capture: true }));
      recordAnchor(true);
    };
    const align = () => {
      if (userMoved) {
        finish();
        return;
      }
      const node = scrollNode();
      const rows = node?.querySelectorAll?.('[data-player]');
      let row: AnchorNode | null = null;
      for (let index = 0; rows && index < rows.length; index += 1) {
        if (rows[index].getAttribute('data-player') === saved.id) row = rows[index];
      }
      if (node && row) {
        const delta = row.getBoundingClientRect().top - node.getBoundingClientRect().top - saved.dy;
        if (Math.abs(delta) > 1) node.scrollTop += delta;
      } else {
        // Laid out further down than the list has drawn: jump near, then refine.
        scrollToPlayer(saved.id);
      }
      tries += 1;
      if (tries < 10) timer = setTimeout(align, tries < 4 ? 40 : 100);
      else finish();
    };
    timer = setTimeout(align, 0);
    return () => {
      if (timer) clearTimeout(timer);
      finish();
    };
  }, [width, height, recordAnchor, scrollToPlayer]);

  // Screen readers hear what a search, a cleared search or the Watching
  // filter did, once typing pauses; the new line replaces the old one.
  const searchText = query.trim();
  const resultCount = rows.length;
  // A kept, unwatched row is on screen but no longer watched: the spoken count
  // leaves him out, as the Watching chip does (walk 3 T1-14).
  const keptShown = watchedOnly ? rows.filter((row) => kept.includes(row.player.playerId) && !watchlist.isWatched(row.player.playerId)).length : 0;
  const spokenCount = resultCount - keptShown;
  const totalCount = allRows.length;
  const spokenOnce = useRef(false);
  const lastSearch = useRef(searchText);
  useEffect(() => {
    const cleared = lastSearch.current !== '' && searchText === '';
    lastSearch.current = searchText;
    if (!spokenOnce.current) {
      spokenOnce.current = true;
      return undefined;
    }
    const note = watchNote.current;
    watchNote.current = null;
    // Names the button that is really there: "Show all 30" under a list,
    // "Show everyone" in an empty one (walk 8 T2-07).
    const line = listCountLine({ query: searchText, count: spokenCount, total: totalCount, watchedOnly, cleared, listed: resultCount });
    const timer = setTimeout(() => announce(note ? `${note} ${line}` : line), note ? 150 : 700);
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
  const status = headerStatus({
    side,
    seasonOver,
    rosterLocked,
    lockGameDate: lockDate,
    full: slots.remaining === 0,
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
      style={rowToolbar || foldWide ? styles.sideToggleWide : folded || !slotLineBeside(width) ? undefined : [styles.sideToggle, slotRoomFirst(width) && styles.sideToggleSnug]}
      value={side}
    />
  );
  // The slot count, then at most one line: the season is over, or when the
  // roster reopens, or that this side is full. A locked roster never shows
  // "drop one to add", because drops are locked too.
  // Beside the side toggle on a phone (wrapping to three short lines at
  // 360px); under it, left-aligned, only where even that leaves no room.
  const slotBeside = slotLineBeside(width);
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
  const slotCount = savingCount > 0 ? (
    <View style={styles.slotSaving}>
      <SameHeight ghosts={[<Text key="plain" maxFontSizeMultiplier={1.4} style={slotTextStyle}>{slotLine(side, { used: Math.min(slots.used + savingCount, slots.limit), limit: slots.limit })}</Text>]}>
        <Text maxFontSizeMultiplier={1.4} style={slotTextStyle}>{slotLine(side, slots, savingCount, waitingNow)}</Text>
      </SameHeight>
    </View>
  ) : (
    <Text maxFontSizeMultiplier={1.4} style={slotTextStyle}>{slotLine(side, slots)}</Text>
  );
  const slotStatus = (
    <View style={[styles.slotStatus, !slotBeside && styles.slotStatusUnder, rowToolbar && styles.slotStatusWide, rowToolbar && width >= LOCK_LINE_ROOMY_WIDTH && styles.slotStatusRoomy, folded && !slotOwnLine && styles.slotStatusFolded]}>
      {slotCount}
      {status.kind === 'lock' ? (
        <View style={styles.lockLine}>
          <LockIcon />
          <Text maxFontSizeMultiplier={1.4} style={styles.lockText}>{unbrokenTail(status.text ?? '')}</Text>
        </View>
      ) : status.text ? (
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
  const shortExplainer = side === 'short' && roomy ? (
    <Text maxFontSizeMultiplier={1.4} style={styles.explainer}>{shortWords}</Text>
  ) : null;
  // On a tablet or desktop each side explains itself in the same reserved
  // line, so switching sides never moves the table.
  const sideExplainer = (
    <Text maxFontSizeMultiplier={1.4} style={styles.explainer}>{side === 'short' ? shortWords : ROSTER_EXPLAINER}</Text>
  );
  // The order in one quiet line (walk 9 T4-10, T1-16, T2-12): on phones
  // under the sort, on a laptop-height table in the sentence's place once the
  // first games are in; a tall table keeps its sentence slot.
  const compactSlot = wide && roomy && height < LAPTOP_HEIGHT_BELOW && sentenceGone;
  const order = orderLine({ sort, reversed, heldNote });
  const orderStrip = (
    <OrderLine
      reserve={order.reserve}
      resort={order.resort ? { name: resortName(night, sortedNight), onPress: resortNow } : null}
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
      lead={STAR_LEAD}
      onChoose={chooseSort}
      onFlip={flipOrder}
      reversed={reversed}
      sort={sort}
      tableRoles={pinned}
    />
  ) : null;
  const listHeader = (
    <View style={styles.header}>
      <View style={visuallyHidden}>
        <Text accessibilityRole="header" {...headingLevel(1)}>Market</Text>
      </View>
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
        <View style={styles.controls}>
          <View style={[styles.controlRow, !slotBeside && styles.controlStack, slotRoomFirst(width) && styles.controlRowSnug]}>
            {sideToggle}
            {slotStatus}
          </View>
          {shortExplainer}
          {/* The two filters share a row; the sort and its order button get the next one whole. */}
          <View style={styles.filterRow}>
            <MarketSearch onChange={setQuery} placeholder={searchPlaceholder} style={styles.searchFlex} value={query} />
            {watchingToggle}
          </View>
          {sortToggle}
          {orderStrip}
        </View>
      )}
      {/* On a tall desktop the unusual-order note takes the explainer's own
          slot, which always keeps a button's height, so pressing a column
          header again never pushes the table down under the pointer (walk 5
          T2-02: the header moved 44px and a third click missed). */}
      {compactSlot || (rowToolbar && !roomy) ? (
        <View style={[styles.explainerWide, styles.orderSlot]}>{orderStrip}</View>
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
      ) : reversed && folded && controlsOpen ? (
        // On the list's gutter, with a reset that looks like the other small
        // outlined buttons (walk 5 T1-15: the note touched the screen edge).
        <View style={[styles.flipNote, styles.flipNoteGutter, folded && styles.flipNoteFolded]}>
          <Text maxFontSizeMultiplier={1.4} style={styles.flipText}>{flippedSortNote(sort).text}</Text>
          <Button label={flippedSortNote(sort).restore} onPress={flipOrder} variant="secondary" />
        </View>
      ) : null}
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
    </View>
  );

  const trimmed = query.trim();
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
    <EmptyState
      action={(
        <View style={styles.emptyActions}>
          <Button ref={emptyAction} label="Clear search" onPress={() => setQuery('')} variant="secondary" />
          {watchedOnly ? <Button label="Show everyone" onPress={clearFilters} variant="quiet" /> : null}
        </View>
      )}
      copy={watchedOnly
        ? 'None of the players you watch match that name.'
        : isMockActive()
          ? `Practice lists ${allRows.length} players, so some real players are not here. Clear the search to see them all.`
          : 'Check the spelling, or clear the search to see the whole market.'}
      level={2}
      title={isMockActive() && !watchedOnly ? `No listed player matches "${echoQuery(trimmed)}"` : `No players match "${echoQuery(trimmed)}"`}
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
  // as well as aloud (walk 6 T1-12: 450px of empty space under two rows).
  // Kept (unwatched, dimmed) rows count here: with every listed row
  // unwatched, "Show all 30" is still the way back (walk 8 T2-07).
  const watchingFooter = watchedOnly && !trimmed && resultCount > 0 ? (
    <View style={[styles.watchingFooter, { paddingHorizontal: wide ? space.lg : space.md }]}>
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
    <View style={[styles.watchingFooter, { paddingHorizontal: wide ? space.lg : space.md }]}>
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
      {pinned ? listHeader : null}
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
        extraData={[layout, columns, positionValues, pastValues, fee, width, seasonOver, watchlist.watched, kept, watchedOnly]}
        initialNumToRender={Math.min(Math.max(rows.length, 18), WHOLE_LIST_MAX)}
        keyboardShouldPersistTaps="handled"
        // One row per side: a press's "Added ✓" never follows him to the
        // other side's row (walk 8 T4-07).
        keyExtractor={(row) => `${row.side}:${row.player.playerId}`}
        ListEmptyComponent={spanRow(emptyState)}
        ListFooterComponent={(
          <>
            {spanRow(resultCount > 0 ? <ListEnd label="End of the list" ref={listEndRef} /> : null)}
            {spanRow(resultCount > 0 && isMockActive() ? <SkipLink label="Back to the practice controls" onPress={backToControls} /> : null)}
            {spanRow(watchingFooter ?? searchFooter)}
          </>
        )}
        ListHeaderComponent={pinned ? null : listHeader}
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
                {side === 'short'
                  ? 'On your roster: to short one of them, drop him there first'
                  : 'Shorted: to add one of them, close his short first'}
              </Text>
            </View>
          ) : null;
          return (
          <>
          {spanRow(divider)}
          <MemoMarketRow
            columns={columns}
            currentValue={item.position ? positionValues.get(item.position.positionId) : undefined}
            fee={fee}
            layout={layout}
            seasonOver={seasonOver}
            wholeNames={keepNamesWhole(width)}
            width={width}
            fullTier={fullTier}
            tierAfterSurname={tierAfterSurname}
            onAnnounce={announce}
            onToggleWatch={toggleWatchStable}
            watched={watchlist.isWatched(item.player.playerId)}
            dimmed={watchedOnly && kept.includes(item.player.playerId) && !watchlist.isWatched(item.player.playerId)}
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
        onClose={() => setProfileId(null)}
        onToggleWatch={profileId ? () => toggleWatch(profileId) : undefined}
        player={profilePlayer}
        position={profilePosition}
        results={profileResults}
        side={side}
        trends={profileId !== null && isMockActive() ? mockPlayerTrends(profileId) : undefined}
        visible={profileId !== null && profilePlayer !== null}
        watching={profileId ? watchlist.isWatched(profileId) : undefined}
      />
    </>
  );
}

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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 1,
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
