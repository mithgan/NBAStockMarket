import { Children, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ListRenderItem,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
} from 'react-native';

import type {
  DividendBasis,
  PerGameLedgerEntry,
  PerGamePositionSide,
  PerGameSettledResult,
} from '../api/contracts';
import {
  humanDate,
  humanDay,
  money,
  signedMoney,
  unbrokenName,
} from '../copy/terms';
import { isMockActive, mockSeasonStart } from '../api/mockPerGameClient';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { Disclosure, DisclosureSpace, DISCLOSURE_WIDTH } from '../components/results/Disclosure';
import { NetMoney } from '../components/results/NetMoney';
import { SettlementBreakdown } from '../components/results/SettlementBreakdown';
import { practiceProgress } from '../data/chromeView';
import { isSeasonOver } from '../data/marketView';
import {
  buildResultsFeed,
  dividendBasisLine,
  feedNights,
  feesLineName,
  foldedFeed,
  monthAnchors,
  movesByDay,
  moveWords,
  nightSummaryLine,
  nightSummaryWrapped,
  nightTotalPending,
  resultRowModel,
  type MonthAnchor,
  type NightSummary,
  type ResultRowModel,
  type ResultsFeedItem,
} from '../data/resultsView';
import { usePerGame } from '../state/PerGameContext';
import { openTab } from '../state/uiActions';
import {
  perGamePlayerName,
  settlementEquation,
  type SettlementEquation,
} from '../state/perGameState';
import { colors, fonts, headingStyle, labelStyle, space, type, weight } from '../theme';
import { Button, EmptyState, headingLevel, Tag, visuallyHidden } from '../ui/kit';

/**
 * At this width the screen fills the frame like Roster and Market: a side
 * column (title, month jump) beside the feed, whose rows use aligned number
 * columns.
 */
const DESKTOP_MIN_WIDTH = 1024;
/** The desktop side column, the same width as the Leaders standing column. */
const SIDE_WIDTH = 280;
/**
 * Below this width (a phone at 200% zoom is 195 CSS px) a name and a net no
 * longer fit side by side: rows stack, and the headshot steps aside.
 */
const STACK_MAX_WIDTH = 330;
/** Narrower than this (a phone at 200% zoom), the dock leaves out the month. */
const DOCK_MONTH_MIN_WIDTH = 260;
/** Scrolled this many screens down, "Back to newest" appears. */
const FAR_SCREENS = 1.5;
const AVATAR = 32;
/** Collapsed height of a row's two lines, so the chevron sits level with them. */
const STACKED_LINES = 40;
/** Space between a row's headshot, its text and its chevron. */
const ROW_GAP = space.md;
/** Row padding on the right edge, before the chevron. */
const ROW_END = space.md;
/** Desktop: the width of each amount column, and of the net column. */
const CELL = 124;
const NET_CELL = 104;

type Layout = {
  /** Dividend and price in their own aligned columns (desktop). */
  columns: boolean;
  /** Large text or a narrow screen: the name takes its own line and the net drops below it. */
  compact: boolean;
  /** Very narrow: no headshot, tighter edges, so a name still fits on one line. */
  tight: boolean;
};

/**
 * Right inset of every number in the normal layout: the row's end padding,
 * the chevron's column and the gap before it. Group headers use it so a
 * day's total sits exactly in the column of its players' nets.
 */
const NUMBER_INSET = ROW_END + DISCLOSURE_WIDTH + ROW_GAP;

function edges(layout: Layout) {
  const left = layout.tight ? space.md : space.lg;
  return {
    left,
    /** Where a row's text starts, after the headshot. */
    text: layout.tight ? left : left + AVATAR + ROW_GAP,
    right: layout.compact ? ROW_END : NUMBER_INSET,
  };
}

// ---------------------------------------------------------------------------
// Copy for one result. Every status keeps a visible, honest line.

function resultPhrase(result: PerGameSettledResult, model: ResultRowModel): string {
  if (result.status === 'verified_dnp') return "Didn't play — no charge";
  if (result.status === 'unsettled_missing_projection') return 'Unsettled · his pregame projection is missing';
  if (result.status !== 'settled') return 'Unsettled · waiting on stats';
  if (!model.math) return 'Result incomplete · waiting on stats';
  // Price (or credit), then dividend: the column order of every row. A
  // no-break space keeps each word with its amount when the line wraps.
  const { first, second } = model.math.pair;
  return `${first.label}\u00a0${money(first.amount)} · ${second.label}\u00a0${money(second.amount)}`;
}

/** "CORRECTION" for the first correction, "CORRECTION 2" for the next. */
function correctionTag(correctionNumber: number): string {
  return correctionNumber > 1 ? `CORRECTION ${correctionNumber}` : 'CORRECTION';
}

/** Screen-reader money, read the way the screen writes it; nothing is "$0". */
function netWords(value: number): string {
  return Math.round(value) === 0 ? '$0' : signedMoney(value);
}

function adjustmentText(adjustment: number | null): string {
  return adjustment === null
    ? 'Adjustment amount unavailable.'
    : `P&L adjustment ${signedMoney(adjustment)}.`;
}

const MISMATCH = 'This result does not reconcile. Refresh before relying on it.';

/**
 * The row's accessible name carries everything the row shows, in the row's
 * order (price or credit, dividend, profit), including a correction's
 * adjustment and the does-not-reconcile warning: inside a button, a screen
 * reader hears only the button's name.
 */
function resultLabel(name: string, result: PerGameSettledResult, model: ResultRowModel): string {
  const parts = [name];
  if (result.side === 'short') parts.push('short');
  if (model.correctionNumber > 0) parts.push(correctionTag(model.correctionNumber).toLowerCase());
  let label = `${parts.join(', ')}. `;
  if (model.math) {
    const { first, second } = model.math.pair;
    label += `${first.label} ${money(first.amount)}, ${second.label} ${money(second.amount)}, `;
  } else {
    label += `${resultPhrase(result, model).replace(' · ', ', ').replace(' — ', ', ')}. `;
  }
  label += model.net === null ? 'Net profit and loss unavailable.' : `profit ${netWords(model.net)}.`;
  if (model.adjustment !== undefined) {
    label += ` ${model.adjustment === null ? 'Adjustment amount unavailable.' : `P&L adjustment ${netWords(model.adjustment)}.`}`;
  }
  if (model.mismatch) label += ` ${MISMATCH}`;
  return label;
}

// ---------------------------------------------------------------------------
// Rows

/** How the season's dividends are counted: the rate and what it multiplies. */
type DividendRule = { rate: number; basis: DividendBasis };

function ResultRow({
  equation,
  expanded,
  layout,
  onToggle,
  playerName,
  result,
  rule,
}: {
  equation: SettlementEquation;
  expanded: boolean;
  layout: Layout;
  onToggle: () => void;
  playerName: string;
  result: PerGameSettledResult;
  rule: DividendRule;
}) {
  const { columns, compact, tight } = layout;
  const edge = edges(layout);
  const model = resultRowModel(result, equation);
  const { math } = model;
  // Desktop puts the two amounts in aligned columns; a row with no settled
  // arithmetic keeps its status sentence instead.
  const priceColumns = columns && math !== null;
  // Each row's name starts with its night, so two rows for the same player on
  // different nights never share a name in a screen reader's list (walk 3 T3-13).
  const label = `${result.gameDate ? `${humanDate(result.gameDate)}, ` : ''}${resultLabel(playerName, result, model)}`;
  const net = model.net === null ? (
    <Text accessibilityLabel="Net profit and loss unavailable" style={styles.netUnavailable}>—</Text>
  ) : (
    <NetMoney value={model.net} />
  );
  const tagged = result.side === 'short' || model.correctionNumber > 0;
  const tags = tagged ? (
    <>
      {result.side === 'short' ? <Tag>Short</Tag> : null}
      {model.correctionNumber > 0 ? <Tag tone="cyan">{correctionTag(model.correctionNumber)}</Tag> : null}
    </>
  ) : null;
  const basis = math && result.dividendDollars !== null
    ? dividendBasisLine({ dividend: result.dividendDollars, rate: rule.rate, basis: rule.basis })
    : null;

  const body = (
    <>
      {tight ? null : <PlayerAvatar player={{ id: result.playerId, name: playerName }} size={AVATAR} />}
      <View style={styles.rowBody}>
        <View style={[styles.rowHeader, columns && styles.rowHeaderColumns, compact && styles.rowHeaderCompact]}>
          <View style={[styles.identity, compact && styles.identityCompact]}>
            <Text style={styles.playerName}>{unbrokenName(playerName)}</Text>
            {/* Desktop keeps the tag beside the name; narrower rows lead their
                second line with it, so a long name never pushes it onto a line
                of its own. */}
            {columns ? tags : null}
          </View>
          {priceColumns && math ? (
            <>
              <Text style={styles.cell}>
                <Text style={styles.cellLabel}>{math.pair.first.label.toLowerCase()}{'\u00a0'}</Text>
                {money(math.pair.first.amount)}
              </Text>
              <Text style={styles.cell}>
                <Text style={styles.cellLabel}>{math.pair.second.label.toLowerCase()}{'\u00a0'}</Text>
                {money(math.pair.second.amount)}
              </Text>
            </>
          ) : null}
          <View style={[styles.netCell, columns && styles.netCellColumns, compact && styles.netCellCompact]}>
            {net}
            {compact && math ? <Disclosure height={20} open={expanded} /> : null}
          </View>
        </View>
        {priceColumns ? null : (
          <View style={styles.detailLine}>
            {columns ? null : tags}
            <Text style={[styles.detail, styles.detailInline]}>{resultPhrase(result, model)}</Text>
          </View>
        )}
        {model.adjustment !== undefined ? (
          <Text style={styles.adjustment}>{adjustmentText(model.adjustment)}</Text>
        ) : null}
        {model.mismatch ? (
          <Text accessibilityRole="alert" style={styles.reconcileError}>
            This result does not reconcile. Refresh before relying on it.
          </Text>
        ) : null}
      </View>
      {compact ? null : math ? (
        <Disclosure height={columns ? AVATAR : STACKED_LINES} open={expanded} />
      ) : <DisclosureSpace />}
    </>
  );

  const rowEdges = { paddingLeft: edge.left, paddingRight: ROW_END };
  // Only a settled game has arithmetic to open; the rest are plain rows.
  if (!math) {
    return (
      <View
        accessibilityLabel={label}
        accessible
        style={[styles.row, rowEdges, styles.rowLine, columns && styles.rowColumns]}
      >
        {body}
      </View>
    );
  }
  // The row is the button; the math it opens sits below it as its own
  // readable block, so a screen reader reaches it after the row.
  return (
    <View style={[styles.rowLine, expanded && styles.rowOpen]}>
      <Pressable
        accessibilityHint={expanded ? 'Hides the math.' : 'Shows how this result was worked out.'}
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        aria-expanded={expanded}
        onPress={onToggle}
        // A full-width row: its focus ring is drawn inside (the next row
        // painted over an outside ring, leaving a line on top; walk 4 T3-04).
        {...({ dataSet: { row: 'full' } } as object)}
        style={({ pressed }) => [styles.row, rowEdges, columns && styles.rowColumns, pressed && styles.rowOpen]}
      >
        {body}
      </Pressable>
      {expanded ? (
        <View style={[styles.breakdown, { paddingLeft: edge.text, paddingRight: edge.right }]}>
          <SettlementBreakdown basis={basis} lines={math.lines} net={math.net} side={result.side} wide={columns} />
        </View>
      ) : null}
    </View>
  );
}

function feeTitle(entry: PerGameLedgerEntry): string {
  if (entry.kind === 'open_fee') return 'Open fee';
  if (entry.kind === 'drop_fee') return 'Drop fee';
  if (entry.kind === 'penalty') return 'Penalty';
  return 'Fee';
}

/** What the fee was for, in the words the rest of the app uses for the move. */
function feeExplanation(entry: PerGameLedgerEntry, side: PerGamePositionSide | null): string {
  if (entry.kind === 'open_fee') {
    if (side === 'long') return 'Added to your roster';
    if (side === 'short') return 'Short opened';
    return 'Position opened';
  }
  if (entry.kind === 'drop_fee') {
    if (side === 'long') return 'Dropped from your roster';
    if (side === 'short') return 'Short closed';
    return 'Position closed';
  }
  if (entry.kind === 'penalty') return 'Rules penalty';
  return 'Account fee';
}

function FeeActivityRow({
  entry,
  layout,
  playerName,
  side,
}: {
  entry: PerGameLedgerEntry;
  layout: Layout;
  playerName: string;
  side: PerGamePositionSide | null;
}) {
  const { columns, compact, tight } = layout;
  // Heard as one line that names him once, "Dyson Daniels, short opened, fee
  // $250"; the headshot and the words drawn beside it are not read again
  // (walk 3 T3-32).
  const spoken = moveWords(playerName, feeExplanation(entry, side), entry.amountDollars, entry.kind === 'penalty' ? 'penalty' : 'fee');
  return (
    <View
      role="listitem"
      style={[styles.row, { paddingLeft: edges(layout).left, paddingRight: ROW_END }, styles.rowLine, columns && styles.rowColumns]}
    >
      <Text style={visuallyHidden}>{spoken}</Text>
      {tight ? null : (
        <View aria-hidden>
          <PlayerAvatar player={{ id: entry.playerId, name: playerName }} size={AVATAR} />
        </View>
      )}
      <View aria-hidden style={styles.rowBody}>
        <View style={[styles.rowHeader, columns && styles.rowHeaderColumns, compact && styles.rowHeaderCompact]}>
          <View style={[styles.identity, compact && styles.identityCompact]}>
            <Text style={styles.playerName}>{unbrokenName(playerName)}</Text>
          </View>
          <View style={[styles.netCell, columns && styles.netCellColumns, compact && styles.netCellCompact]}>
            <NetMoney value={entry.amountDollars} />
          </View>
        </View>
        {/* The kind of fee leads the line under the name, so a long name
            never pushes a chip onto a line of its own: every fee row is the
            same height. */}
        <Text style={styles.detail}>{feeTitle(entry)} · {feeExplanation(entry, side)}</Text>
      </View>
      {compact ? null : <DisclosureSpace />}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Group headers

/** The element id of a day's header, so a month jump can move focus to it. */
function nightAnchorId(date: string): string {
  return `results-day-${date || 'undated'}`;
}

/**
 * A day's header: its date and what your players made that night (games
 * only, the same figure as "Last night", labelled "Games" so nobody reads it
 * as the fees below too). A day with no games shows no figure; its moves fold
 * under their own line below. A day with nothing to say under its date (the
 * moves before your first games) is just the date, so its moves line sits
 * right under it instead of below an empty band.
 */
function NightHeader({ night, layout }: { night: NightSummary; layout: Layout }) {
  const summary = nightSummaryWrapped(night);
  const spokenSummary = nightSummaryLine(night).replace(/ · /g, ', ');
  const pending = nightTotalPending(night);
  const played = night.results > 0;
  const title = night.date ? humanDay(night.date) : 'Undated fees';
  const totalWords = !played ? '' : pending
    ? ' games not settled yet.'
    : ` your players made ${netWords(night.total)}.`;
  const edge = edges(layout);
  const bare = !played && !summary;
  return (
    <View
      accessibilityLabel={bare ? title : `${title}:${totalWords}${spokenSummary ? ` ${spokenSummary}.` : ''}`}
      accessibilityRole="header"
      accessible
      nativeID={nightAnchorId(night.date)}
      {...headingLevel(2)}
      {...({ tabIndex: -1 } as object)}
      style={[
        styles.groupHeader,
        { paddingLeft: edge.left, paddingRight: edge.right },
        layout.columns && styles.groupHeaderColumns,
        bare && styles.groupHeaderBare,
      ]}
    >
      <View style={[styles.groupCopy, layout.compact && styles.groupCopyCompact]}>
        <Text style={styles.groupTitle}>{title}</Text>
        {summary ? <Text style={styles.groupSummary}>{summary}</Text> : null}
      </View>
      {played ? (
        <View style={[styles.groupTotal, layout.compact && styles.groupTotalCompact]}>
          <Text style={styles.groupTotalLabel}>Games</Text>
          {pending ? (
            <Text style={styles.netUnavailable}>—</Text>
          ) : (
            <NetMoney size="title" value={night.total} />
          )}
        </View>
      ) : null}
    </View>
  );
}

/**
 * A day's fees, folded to one line until opened: "Roster moves · 8  -$2,000".
 * Fifteen opening moves no longer bury the games under a thousand pixels of
 * fee rows; one tap lists them.
 */
function FeesFold({
  count,
  layout,
  moves,
  onToggle,
  open,
  shorts,
  total,
  children,
}: {
  count: number;
  layout: Layout;
  moves: boolean;
  onToggle: () => void;
  open: boolean;
  shorts: boolean;
  total: number;
  /** The day's moves, shown while open: read as one list under the fold. */
  children?: ReactNode;
}) {
  const name = feesLineName(moves, shorts);
  const noun = moves ? (count === 1 ? 'move' : 'moves') : (count === 1 ? 'fee' : 'fees');
  const list = open && Children.count(children) > 0 ? (
    <View aria-label={name} role="list">
      {children}
    </View>
  ) : null;
  return (
    <View>
    <Pressable
      accessibilityHint={open ? `Hides the ${noun}.` : `Lists each ${moves ? 'move' : 'fee'}.`}
      accessibilityLabel={`${name}, ${count} ${noun}, ${netWords(total)}`}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      aria-expanded={open}
      onPress={onToggle}
      style={({ pressed }) => [
        styles.feesFold,
        { paddingLeft: edges(layout).text, paddingRight: ROW_END },
        (pressed || open) && styles.rowOpen,
      ]}
    >
      <Text style={styles.feesTitle}>{name} · {count}</Text>
      <NetMoney size="body" value={total} />
      <Disclosure height={20} open={open} />
    </Pressable>
    {list}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Long seasons: a month jump and a way back to the newest night

const TITLE_ID = 'results-title';

/** Set while Results is on screen: scroll back to the newest night. */
let showNewest: (() => void) | null = null;

/**
 * Scroll Results back to its newest night (what re-pressing the active
 * Results tab should do). Returns false when Results is not on screen.
 */
export function scrollResultsToNewest(): boolean {
  if (!showNewest) return false;
  showNewest();
  return true;
}

/** Move keyboard focus to an element by id, once it has rendered (web only). */
function focusWhenReady(id: string, tries = 40): void {
  if (typeof document === 'undefined') return;
  const node = document.getElementById(id) as (HTMLElement | null);
  if (node) {
    node.focus({ preventScroll: true });
    return;
  }
  if (tries > 0) setTimeout(() => focusWhenReady(id, tries - 1), 80);
}

function toggled(previous: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(previous);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/** "Jump to" and one button per month, newest first like the feed. */
function MonthJump({
  anchors,
  current,
  onJump,
}: {
  anchors: readonly MonthAnchor[];
  current: string | null;
  onJump: (anchor: MonthAnchor) => void;
}) {
  return (
    <View accessibilityLabel="Jump to a month" role="group" style={styles.jump}>
      <Text style={styles.jumpLabel}>Jump to</Text>
      <View style={styles.jumpChips}>
        {anchors.map((anchor) => {
          const here = anchor.key === current;
          return (
            <Pressable
              key={anchor.key}
              accessibilityLabel={anchor.name}
              accessibilityRole="button"
              aria-current={here ? 'true' : undefined}
              onPress={() => onJump(anchor)}
              style={({ pressed }) => [styles.chip, here && styles.chipHere, pressed && styles.rowOpen]}
            >
              <Text style={[styles.chipText, here && styles.chipTextHere]}>{anchor.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------

export function PerGameResultsScreen() {
  const { bootstrap } = usePerGame();
  const { fontScale, width } = useWindowDimensions();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  // Days whose fee rows are listed; every "Roster moves" line starts folded.
  const [openFees, setOpenFees] = useState<ReadonlySet<string>>(() => new Set());
  const [far, setFar] = useState(false);
  const [currentMonth, setCurrentMonth] = useState<string | null>(null);
  const listRef = useRef<FlatList<ResultsFeedItem>>(null);
  const listHeight = useRef(0);
  const jumpRetries = useRef(0);
  const feed = useMemo(
    () => (bootstrap ? buildResultsFeed(bootstrap, { lastSettledDate: bootstrap.game.lastSettledDate }) : []),
    [bootstrap],
  );
  // A day's moves render inside their fold, as one list (walk 3 T3-32).
  const visible = useMemo(() => foldedFeed(feed), [feed]);
  const moves = useMemo(() => movesByDay(feed), [feed]);
  const anchors = useMemo(() => monthAnchors(visible), [visible]);
  const extraData = useMemo(() => ({ expanded, openFees }), [expanded, openFees]);
  const toggle = useCallback((key: string) => setExpanded((previous) => toggled(previous, key)), []);
  const toggleFees = useCallback((date: string) => setOpenFees((previous) => toggled(previous, date)), []);

  const backToNewest = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    setFar(false);
    focusWhenReady(TITLE_ID);
  }, []);
  useEffect(() => {
    showNewest = backToNewest;
    return () => {
      if (showNewest === backToNewest) showNewest = null;
    };
  }, [backToNewest]);

  const jumpTo = useCallback((anchor: MonthAnchor) => {
    jumpRetries.current = 0;
    listRef.current?.scrollToIndex({ index: anchor.index, animated: false, viewPosition: 0 });
    focusWhenReady(nightAnchorId(anchor.date));
  }, []);
  // A far month is not measured yet: walk down to the furthest row measured
  // so far (the rows past it then render), and try again until its day is.
  const onScrollToIndexFailed = useCallback((info: { index: number; highestMeasuredFrameIndex: number }) => {
    const list = listRef.current;
    if (!list || jumpRetries.current >= 40) return;
    jumpRetries.current += 1;
    list.scrollToIndex({ index: Math.max(0, info.highestMeasuredFrameIndex), animated: false, viewPosition: 0 });
    setTimeout(() => list.scrollToIndex({ index: info.index, animated: false, viewPosition: 0 }), 60);
  }, []);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = event.nativeEvent.contentOffset.y > Math.max(600, listHeight.current * FAR_SCREENS);
    setFar((was) => (was === next ? was : next));
  }, []);
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const top = viewableItems.find((token) => token.isViewable)?.item as ResultsFeedItem | undefined;
    const date = !top ? null : top.type === 'night' ? top.night.date : top.date;
    setCurrentMonth(date ? date.slice(0, 7) : null);
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 10 }).current;
  if (!bootstrap) return null;

  const tight = width < STACK_MAX_WIDTH;
  const compact = fontScale > 1.2 || tight;
  const wide = width >= DESKTOP_MIN_WIDTH;
  const layout: Layout = { columns: wide && !compact, compact, tight };
  const nights = feedNights(feed);
  const played = nights.filter((night) => night.results > 0);
  const lastSettled = bootstrap.game.lastSettledDate;
  const ledgerComplete = bootstrap.ledger.nextCursor === null;
  const rule: DividendRule = {
    rate: bootstrap.ruleset.dividendDollarsPerNetPoint,
    basis: bootstrap.ruleset.dividendBasis,
  };
  // Say so when the last settled night had nothing for you at all.
  const quietLastNight = Boolean(lastSettled && played[0] && lastSettled > played[0].date
    && !nights.some((night) => night.date === lastSettled));
  // Moves made, but no games yet: the moves are the story, not "No results".
  const movesOnly = played.length === 0 && feed.length > 0;
  // Games have been played, just none by your players: practice is past its opening
  // eve (Day 0 settles no games); a live season has settled a night.
  const nightsWithoutYou = movesOnly && (isMockActive()
    ? practiceProgress(mockSeasonStart(), lastSettled).day > 0
    : Boolean(lastSettled));

  const renderItem: ListRenderItem<ResultsFeedItem> = ({ item }) => {
    if (item.type === 'night') return <NightHeader layout={layout} night={item.night} />;
    if (item.type === 'fees') {
      const open = openFees.has(item.date);
      return (
        <FeesFold
          count={item.count}
          layout={layout}
          moves={item.moves}
          onToggle={() => toggleFees(item.date)}
          open={open}
          shorts={item.shorts}
          total={item.total}
        >
          {open ? (moves.get(item.date) ?? []).map((fee) => (
            <FeeActivityRow
              key={fee.key}
              entry={fee.entry}
              layout={layout}
              playerName={perGamePlayerName(bootstrap, fee.entry.playerId, fee.entry.positionId)}
              side={fee.side}
            />
          )) : null}
        </FeesFold>
      );
    }
    if (item.type === 'fee') return null;
    return (
      <ResultRow
        equation={settlementEquation(
          item.result,
          bootstrap.ledger.items,
          bootstrap.settledResults,
          { ledgerComplete },
        )}
        expanded={expanded.has(item.key)}
        layout={layout}
        onToggle={() => toggle(item.key)}
        playerName={perGamePlayerName(bootstrap, item.result.playerId, item.result.positionId)}
        result={item.result}
        rule={rule}
      />
    );
  };

  const back = (
    <Button
      accessibilityLabel="Back to the newest night"
      label="↑ Back to newest"
      onPress={backToNewest}
    />
  );
  const header = (
    <View style={[styles.header, wide ? styles.headerSide : { paddingHorizontal: edges(layout).left }]}>
      <Text
        accessibilityRole="header"
        nativeID={TITLE_ID}
        {...headingLevel(1)}
        {...({ tabIndex: -1 } as object)}
        style={styles.title}
      >
        Results
      </Text>
      {played.length > 0 ? (
        <Text style={styles.caption}>Newest night first. Select a player to see the math.</Text>
      ) : null}
      {movesOnly ? (
        <Text style={styles.note}>
          {nightsWithoutYou
            ? 'None of your players has had a game yet. Results land here after each night they play. Your moves so far are below.'
            : 'No games yet. Results land here after each night of games. Your moves so far are below.'}
        </Text>
      ) : null}
      {quietLastNight && lastSettled ? (
        <Text style={styles.note}>None of your players had a game on {humanDay(lastSettled)}.</Text>
      ) : null}
      {anchors.length > 1 ? (
        <MonthJump anchors={anchors} current={wide ? currentMonth : null} onJump={jumpTo} />
      ) : null}
      {wide && far ? <View style={styles.sideBack}>{back}</View> : null}
    </View>
  );
  // One rule with the Roster and Market: practice ends on its last day, a live
  // season when games have settled and none are left.
  const seasonOver = isSeasonOver({
    practiceComplete: isMockActive() && practiceProgress(mockSeasonStart(), lastSettled).complete,
    lastSettledDate: lastSettled,
    nextGameDate: bootstrap.game.nextGameDate,
  });
  const empty = (
    <EmptyState
      // Nothing to show until you pick players: the way there, in one tap
      // (walk 3 T1-N4). Gone once the season is over and the market is closed.
      action={seasonOver ? undefined : (
        <Button
          accessibilityLabel="Open market: browse players to add"
          label="Open market"
          onPress={() => openTab('market')}
          variant="primary"
        />
      )}
      copy="Each night your players have games, the results land here, newest night first."
      level={2}
      style={styles.empty}
      title="No results yet"
    />
  );

  const list = (
    <FlatList
      ref={listRef}
      contentContainerStyle={styles.content}
      data={visible}
      extraData={extraData}
      initialNumToRender={16}
      keyExtractor={(item) => item.key}
      ListEmptyComponent={empty}
      ListHeaderComponent={wide ? null : header}
      maxToRenderPerBatch={16}
      onLayout={(event) => {
        listHeight.current = event.nativeEvent.layout.height;
      }}
      onScroll={onScroll}
      onScrollToIndexFailed={onScrollToIndexFailed}
      onViewableItemsChanged={onViewableItemsChanged}
      renderItem={renderItem}
      scrollEventThrottle={100}
      style={styles.list}
      viewabilityConfig={viewabilityConfig}
      windowSize={9}
    />
  );

  if (wide) {
    return (
      <View style={styles.split}>
        <View style={styles.side}>{header}</View>
        {list}
      </View>
    );
  }
  // Phones: once far down, the way back docks under the list with the month
  // you are reading, instead of floating over the rows' figures (walk 3
  // T1-13). It takes the list's bottom edge, so nothing on screen moves.
  // At 200% zoom (a 195px phone) the month and the button cannot share a line
  // and the button ran off the edge: the month steps aside there, and at any
  // width the button takes its own line (never cut) when both do not fit.
  const here = width >= DOCK_MONTH_MIN_WIDTH
    ? anchors.find((anchor) => anchor.key === currentMonth)?.name ?? null
    : null;
  return (
    <View style={styles.screen}>
      {list}
      {far ? (
        <View style={[styles.dock, { paddingHorizontal: edges(layout).left }]}>
          {here ? <Text style={styles.dockWhere}>{here}</Text> : null}
          <View style={styles.dockBack}>{back}</View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingBottom: 110,
  },
  screen: {
    flex: 1,
    minHeight: 0,
  },
  // Desktop: the whole frame, a side column beside the feed.
  split: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'row',
  },
  side: {
    width: SIDE_WIDTH,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.border,
    backgroundColor: colors.background,
  },
  header: {
    paddingTop: space.lg,
    paddingBottom: space.md,
    backgroundColor: colors.background,
  },
  headerSide: {
    paddingHorizontal: space.lg,
  },
  jump: {
    marginTop: space.md,
  },
  jumpLabel: {
    ...labelStyle,
    marginBottom: space.xs,
  },
  jumpChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xs,
  },
  chip: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 4,
    backgroundColor: colors.background,
  },
  chipHere: {
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
  },
  chipText: {
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.bold,
  },
  chipTextHere: {
    color: colors.text,
  },
  sideBack: {
    marginTop: space.lg,
    alignItems: 'flex-start',
  },
  // Phone: over the list's bottom padding, clear of the last row.
  dock: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: space.md,
    rowGap: space.xs,
    paddingVertical: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  dockWhere: {
    flexShrink: 1,
    color: colors.muted,
    fontFamily: fonts.body,
    fontSize: type.caption,
  },
  // Right-aligned on the month's line or its own; narrower than its words
  // (very large text) the label wraps inside the button instead of being cut.
  dockBack: {
    flexShrink: 1,
    maxWidth: '100%',
    marginLeft: 'auto',
  },
  title: {
    ...headingStyle,
  },
  empty: {
    backgroundColor: colors.background,
  },
  caption: {
    marginTop: 2,
    color: colors.faint,
    fontSize: type.caption,
    lineHeight: 17,
  },
  note: {
    marginTop: space.sm,
    color: colors.muted,
    fontSize: type.body,
    lineHeight: 19,
  },
  groupHeader: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    // A wrapped header centres its lines too, instead of packing them at the top.
    alignContent: 'center',
    columnGap: space.md,
    paddingVertical: space.sm,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
  },
  groupHeaderColumns: {
    minHeight: 56,
  },
  // Only a date (moves before the first games): as tall as the date itself.
  groupHeaderBare: {
    minHeight: 0,
  },
  groupCopy: {
    minWidth: 0,
    flex: 1,
  },
  groupCopyCompact: {
    flexBasis: '100%',
  },
  groupTitle: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
    lineHeight: 20,
  },
  groupSummary: {
    marginTop: 1,
    color: colors.muted,
    fontSize: type.caption,
    lineHeight: 17,
    fontVariant: ['tabular-nums'],
  },
  groupTotal: {
    marginLeft: 'auto',
    alignItems: 'flex-end',
  },
  // Stacked: "GAMES +$253.5K" on a line of its own under the date.
  groupTotalCompact: {
    marginLeft: 0,
    flexBasis: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  groupTotalLabel: {
    ...labelStyle,
  },
  // A folded day's fees: a 44px line that opens the list of moves.
  feesFold: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: ROW_GAP,
    paddingVertical: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  feesTitle: {
    ...labelStyle,
    flex: 1,
    minWidth: 0,
    color: colors.muted,
  },
  detailLine: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: ROW_GAP,
    paddingVertical: 10,
  },
  rowLine: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  rowColumns: {
    minHeight: 52,
  },
  rowOpen: {
    backgroundColor: colors.surface,
  },
  breakdown: {
    paddingBottom: space.md,
  },
  rowBody: {
    minWidth: 0,
    flex: 1,
  },
  rowHeader: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  // Desktop: the one-line row is centred on the headshot.
  rowHeaderColumns: {
    minHeight: AVATAR,
  },
  rowHeaderCompact: {
    flexWrap: 'wrap',
    rowGap: 2,
  },
  identity: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  identityCompact: {
    flexBasis: '100%',
  },
  playerName: {
    flexShrink: 1,
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.bold,
    lineHeight: 20,
  },
  cell: {
    width: CELL,
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  cellLabel: {
    color: colors.faint,
    fontWeight: weight.medium,
  },
  netCell: {
    minWidth: 64,
    alignItems: 'flex-end',
  },
  // Desktop: a fixed net column, so the amount columns beside it never shift.
  netCellColumns: {
    width: NET_CELL,
  },
  // Stacked: the net starts its own line, with the chevron at its far end.
  netCellCompact: {
    minWidth: 0,
    flexBasis: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginLeft: 0,
  },
  netUnavailable: {
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
  },
  detail: {
    marginTop: 2,
    color: colors.muted,
    fontSize: type.caption,
    lineHeight: 17,
    fontVariant: ['tabular-nums'],
  },
  detailInline: {
    marginTop: 0,
    flexShrink: 1,
    minWidth: 0,
  },
  adjustment: {
    marginTop: space.xs,
    color: colors.cyan,
    fontSize: type.caption,
    lineHeight: 17,
    fontVariant: ['tabular-nums'],
  },
  // A warning, not a loss: red stays reserved for money going the wrong way.
  reconcileError: {
    marginTop: space.xs,
    color: colors.goldInk,
    fontSize: type.caption,
    fontWeight: weight.bold,
    lineHeight: 17,
  },
});
