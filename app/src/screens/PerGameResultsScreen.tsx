import { Children, createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type CellRendererProps,
  type LayoutChangeEvent,
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
import { isMockActive, mockPlayerTrends, mockSeasonStart } from '../api/mockPerGameClient';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { PlayerProfileSheet } from '../components/PlayerProfileSheet';
import { Disclosure, DisclosureSpace, DISCLOSURE_WIDTH } from '../components/results/Disclosure';
import { NetMoney } from '../components/results/NetMoney';
import { onPlayerGames, setProfileReopen, takePlayerGames, type PlayerGames } from '../components/results/playerGames';
import { SettlementBreakdown } from '../components/results/SettlementBreakdown';
import { practiceProgress } from '../data/chromeView';
import { isSeasonOver } from '../data/marketView';
import {
  buildResultsFeed,
  dividendBasisLine,
  feedNights,
  feesLineName,
  focusAnchor,
  foldedFeed,
  hisFeed,
  seasonSoFar,
  type SeasonSoFar,
  hisMoveLine,
  mathGroupName,
  monthAnchors,
  movesByDay,
  moveWords,
  nightSummaryLine,
  nightSummaryWrapped,
  nightTotalPending,
  monthChipRows,
  readingMonth,
  resultRowModel,
  resumeNight,
  revealScroll,
  rowNightPrefix,
  closeScroll,
  clearOfBottom,
  mathTitle,
  newestPlace,
  NEWEST_CORNER_RESERVE,
  stickyNightIndices,
  pinnedNightClips,
  playerFeedSource,
  type MonthAnchor,
  type NightSummary,
  type ReadingPlace,
  type ResultRowModel,
  type ResultsFeedItem,
} from '../data/resultsView';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { usePerGame } from '../state/PerGameContext';
import { openTab } from '../state/uiActions';
import {
  perGamePlayerName,
  settlementEquation,
  type SettlementEquation,
} from '../state/perGameState';
import { colors, fonts, headingStyle, labelStyle, space, type, weight } from '../theme';
import { Button, EmptyState, headingLevel, repeatSafe, Tag, visuallyHidden } from '../ui/kit';

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
/** While a month jump lands: rows rendered in one pass, and screens kept around it. */
const JUMP_BATCH = 1000;
const AVATAR = 32;
/** Collapsed height of a row's two lines, so the chevron sits level with them. */
const STACKED_LINES = 40;
/** A one-line row's height (one player's games), for its chevron. */
const ONE_LINE = 20;
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
  night,
  nightPrefix = '',
  onOpened,
  onToggle,
  playerName,
  result,
  rule,
  titled = false,
  his = false,
}: {
  equation: SettlementEquation;
  expanded: boolean;
  /**
   * One player's games (from his profile): the night's line above says the
   * date and how he did, so the row carries only the figures, once each
   * (walk 13 T1-08, T2-06): no headshot or name, the price and dividend on
   * the line beside his result.
   */
  his?: boolean;
  /**
   * One player's games on desktop: his night shares this row's line, the
   * date and how he did on the left, the figures in the feed's columns
   * (walk 15 T2-04: two lines a game, the figures 500px from their date).
   * The night's heading lies over the line, for jumps and screen readers;
   * a press anywhere on it opens the math.
   */
  night?: NightSummary;
  /**
   * The night's header is not pinned (a window under 500px tall, 400% zoom):
   * the row's first line starts with its night, "Oct 21 · Luka Doncic", so a
   * row alone in the view still says which night it is (walk 15 T3-07).
   */
  nightPrefix?: string;
  layout: Layout;
  /** Called with the row's node once it has opened or closed, so the feed can bring its math (or its headline) into view. */
  onOpened?: (node: unknown, open: boolean) => void;
  onToggle: () => void;
  playerName: string;
  result: PerGameSettledResult;
  rule: DividendRule;
  /** Its headline gave way above the math (high zoom): the math carries a one-line title. */
  titled?: boolean;
}) {
  const wrapRef = useRef<View>(null);
  const buttonRef = useRef<View>(null);
  useEffect(() => {
    onOpened?.(wrapRef.current, expanded);
    // Only a press counts (the feed checks); the callback changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);
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
      {tight || his ? null : <PlayerAvatar player={{ id: result.playerId, name: playerName }} size={AVATAR} />}
      <View style={styles.rowBody}>
        <View style={[styles.rowHeader, columns && styles.rowHeaderColumns, compact && styles.rowHeaderCompact]}>
          <View style={[styles.identity, compact && styles.identityCompact]}>
            {his ? null : (
              <Text style={styles.playerName}>
                {nightPrefix ? <Text style={styles.rowNight}>{nightPrefix}</Text> : null}
                {unbrokenName(playerName)}
              </Text>
            )}
            {night ? <HisNightTitle night={night} /> : null}
            {/* Desktop keeps the tag beside the name; narrower rows lead their
                second line with it, so a long name never pushes it onto a line
                of its own. */}
            {columns ? tags : null}
            {his && !priceColumns ? (
              <>
                {columns ? null : tags}
                <Text style={[styles.detail, styles.detailInline]}>{resultPhrase(result, model)}</Text>
              </>
            ) : null}
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
        {priceColumns || his ? null : (
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
        <Disclosure height={columns ? AVATAR : his ? ONE_LINE : STACKED_LINES} open={expanded} />
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
        style={[styles.row, rowEdges, styles.rowLine, columns && styles.rowColumns, his && styles.rowHis]}
      >
        {body}
      </View>
    );
  }
  // The row is the button; the math it opens sits below it as its own
  // readable block, so a screen reader reaches it after the row.
  const button = (
    <Pressable
      ref={buttonRef}
      accessibilityHint={expanded ? 'Hides the math.' : 'Shows how this result was worked out.'}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      aria-expanded={expanded}
      onPress={onToggle}
      // A full-width row: its focus ring is drawn inside (the next row
      // painted over an outside ring, leaving a line on top; walk 4 T3-04).
      {...({ dataSet: { row: 'full' } } as object)}
      style={({ pressed }) => [styles.row, rowEdges, columns && styles.rowColumns, his && !night && styles.rowHis, pressed && styles.rowOpen]}
    >
      {body}
    </Pressable>
  );
  return (
    <View ref={wrapRef} style={[styles.rowLine, expanded && styles.rowOpen]}>
      {night ? (
        <View>
          {/* His night's heading, first for a screen reader, over the whole
              line: a jump lands focus here (its ring drawn inside); a press
              goes through to the row under it. */}
          <View
            accessibilityLabel={hisNightWords(night).spoken}
            accessibilityRole="header"
            accessible
            nativeID={nightAnchorId(night.date)}
            {...headingLevel(2)}
            {...({ tabIndex: -1, dataSet: { ring: 'inset' } } as object)}
            style={styles.lineHeading}
          />
          {button}
        </View>
      ) : button}
      {expanded ? (
        <View
          style={[styles.breakdown, { paddingLeft: his ? edge.left : edge.text, paddingRight: edge.right }]}
          // At 400% the math comes to the top and its row scrolls away: focus
          // moves here (its ring drawn inside) and Escape takes it back to
          // the row (walk 9 T3-10; see revealOpened).
          {...(Platform.OS === 'web' ? {
            tabIndex: -1,
            role: 'group',
            'aria-label': mathGroupName({ name: playerName, side: result.side, date: result.gameDate, net: model.net }),
            dataSet: { ring: 'inset' },
            onKeyDown: (event: { key: string; preventDefault: () => void; stopPropagation: () => void }) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              event.stopPropagation();
              (buttonRef.current as unknown as HTMLElement | null)?.focus?.();
            },
          } : {}) as object}
        >
          {titled ? (
            // Seen only: the group's name already says it to screen readers.
            <Text aria-hidden style={styles.mathTitle}>
              {mathTitle({ name: playerName, side: result.side, date: result.gameDate, net: model.net })}
            </Text>
          ) : null}
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

/**
 * One of his moves in his own Results (walk 14 T1-07): in line with his games,
 * at their gutter (this view draws no headshots), named for what it was,
 * "Added Luka Doncic · $250 fee", with its amount where his results sit.
 * Heard with its day first, as his game rows are: "Oct 20, Luka Doncic, added
 * to your roster, fee $250".
 */
function HisMoveRow({
  date,
  entry,
  layout,
  playerName,
  side,
}: {
  date: string;
  entry: PerGameLedgerEntry;
  layout: Layout;
  playerName: string;
  side: PerGamePositionSide | null;
}) {
  const { columns, compact } = layout;
  const spoken = `${date ? `${humanDate(date)}, ` : ''}${moveWords(playerName, feeExplanation(entry, side), entry.amountDollars, entry.kind === 'penalty' ? 'penalty' : 'fee')}`;
  return (
    <View
      accessibilityLabel={spoken}
      accessible
      style={[styles.row, { paddingLeft: edges(layout).left, paddingRight: ROW_END }, styles.rowLine, columns && styles.rowColumns, styles.rowHis]}
    >
      <View style={styles.rowBody}>
        <View style={[styles.rowHeader, columns && styles.rowHeaderColumns, compact && styles.rowHeaderCompact]}>
          <View style={[styles.identity, compact && styles.identityCompact]}>
            <Text style={[styles.detail, styles.detailInline]}>{hisMoveLine(entry, side, playerName)}</Text>
          </View>
          <View style={[styles.netCell, columns && styles.netCellColumns, compact && styles.netCellCompact]}>
            <NetMoney value={entry.amountDollars} />
            {compact ? <DisclosureSpace /> : null}
          </View>
        </View>
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
 * Where a day's header sits in the feed (web). Pinned under the frame (a tall
 * window, walk 10 T4-N3) it reads as at the top wherever the feed is: its
 * place is right under the cell before it.
 */
function naturalTop(node: HTMLElement, scroller: HTMLElement): number {
  let cell: HTMLElement | null = node;
  while (cell && cell !== scroller && getComputedStyle(cell).position !== 'sticky') cell = cell.parentElement;
  if (!cell || cell === scroller) return node.getBoundingClientRect().top;
  const before = cell.previousElementSibling;
  return before ? before.getBoundingClientRect().bottom : cell.getBoundingClientRect().top;
}

/**
 * The top of the feed a row can be read from (web): under the day header
 * pinned there, if any (walk 10 T4-N3), else the feed's own top edge.
 */
function readableTop(scroller: HTMLElement): number {
  const top = Math.max(scroller.getBoundingClientRect().top, 0);
  let below = top;
  // The last one stuck there is drawn on top; those under it are clipped to
  // its height (clipPinnedNights).
  scroller.querySelectorAll<HTMLElement>('[id^="results-day-"]').forEach((header) => {
    const box = header.getBoundingClientRect();
    if (box.top <= top + 1) below = Math.max(top, box.bottom);
  });
  return below;
}

/** A night header's sticky cell (web): react-native-web wraps each pinned one. */
const stickyCells = new WeakMap<HTMLElement, HTMLElement | null>();
function stickyCellOf(header: HTMLElement, scroller: HTMLElement): HTMLElement | null {
  if (stickyCells.has(header)) return stickyCells.get(header) ?? null;
  let cell: HTMLElement | null = header;
  while (cell && cell !== scroller && getComputedStyle(cell).position !== 'sticky') cell = cell.parentElement;
  const found = cell && cell !== scroller ? cell : null;
  stickyCells.set(header, found);
  return found;
}

/**
 * Every header already passed stays stuck at the top under the one you are
 * reading (the sticky cells share one list): each is clipped to the top one's
 * height, so a taller one never shows its last line over the first row. They
 * stay in the page for screen readers.
 */
function clipPinnedNights(scroller: HTMLElement, clipped: Set<HTMLElement>): void {
  const top = scroller.getBoundingClientRect().top;
  const cells: HTMLElement[] = [];
  scroller.querySelectorAll<HTMLElement>('[id^="results-day-"]').forEach((header) => {
    const cell = stickyCellOf(header, scroller);
    if (cell) cells.push(cell);
  });
  const boxes = cells.map((cell) => cell.getBoundingClientRect());
  const stuck = cells.filter((_, index) => Math.abs(boxes[index].top - top) < 1.5);
  const clips = pinnedNightClips(stuck.map((cell) => boxes[cells.indexOf(cell)].height));
  const want = new Map(stuck.map((cell, index) => [cell, clips[index]]));
  for (const cell of new Set([...cells, ...clipped])) {
    const by = want.get(cell) ?? 0;
    const clip = by > 0 ? `inset(0 0 ${by}px 0)` : '';
    if (cell.style.clipPath !== clip) cell.style.clipPath = clip;
    if (by > 0) clipped.add(cell);
    else clipped.delete(cell);
  }
}

/** One player's night as its heading says it: "Mon, Nov 3", "Beat his price", and the spoken line. */
function hisNightWords(night: NightSummary): { title: string; summary: string; spoken: string } {
  const summary = nightSummaryWrapped(night);
  const spokenSummary = nightSummaryLine(night).replace(/ · /g, ', ');
  const title = night.date ? humanDay(night.date) : 'Undated fees';
  return { title, summary, spoken: spokenSummary ? `${title}: ${spokenSummary}.` : title };
}

/** The date and how he did, as one player's night reads on screen. */
function HisNightTitle({ night }: { night: NightSummary }) {
  const { title, summary } = hisNightWords(night);
  return (
    <Text style={styles.groupTitle}>
      {title}
      {summary ? <Text style={styles.groupSummaryHis}>{`  ·  ${summary}`}</Text> : null}
    </Text>
  );
}

/**
 * A day's header: its date and what your players made that night (games
 * only, the same figure as "Last night", labelled "Games" so nobody reads it
 * as the fees below too). A day with no games shows no figure; its moves fold
 * under their own line below. A day with nothing to say under its date (the
 * moves before your first games) is just the date, so its moves line sits
 * right under it instead of below an empty band.
 */
function NightHeader({ night, layout, his = false }: { night: NightSummary; layout: Layout; his?: boolean }) {
  const summary = nightSummaryWrapped(night);
  const spokenSummary = nightSummaryLine(night).replace(/ · /g, ', ');
  const pending = nightTotalPending(night);
  const played = night.results > 0;
  const title = night.date ? humanDay(night.date) : 'Undated fees';
  const edge = edges(layout);
  const bare = !played && !summary;
  if (his) {
    // One player's games (from his profile): the date and how he did, on one
    // line over his row, which carries the figures. The night's figure is his
    // row's, so it is said once, there (walk 13 T1-08, T2-06). On desktop the
    // line is his row's own (walk 15 T2-04; ResultRow `night`).
    return (
      <View
        accessibilityLabel={hisNightWords(night).spoken}
        accessibilityRole="header"
        accessible
        nativeID={nightAnchorId(night.date)}
        {...headingLevel(2)}
        {...({ tabIndex: -1, dataSet: { ring: 'inset' } } as object)}
        style={[styles.groupHeader, styles.groupHeaderHis, { paddingLeft: edge.left, paddingRight: edge.right }]}
      >
        <HisNightTitle night={night} />
      </View>
    );
  }
  const totalWords = !played ? '' : pending ? ' games not settled yet.' : ` your players made ${netWords(night.total)}.`;
  return (
    <View
      accessibilityLabel={bare ? title : `${title}:${totalWords}${spokenSummary ? ` ${spokenSummary}.` : ''}`}
      accessibilityRole="header"
      accessible
      nativeID={nightAnchorId(night.date)}
      {...headingLevel(2)}
      // A month jump lands focus here, flush with the feed's top and left
      // edges: its ring is drawn inside, or it cannot be seen (walk 9 T3-09).
      {...({ tabIndex: -1, dataSet: { ring: 'inset' } } as object)}
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
  nightPrefix = '',
  moves,
  onOpened,
  onToggle,
  open,
  shorts,
  total,
  children,
}: {
  count: number;
  layout: Layout;
  /** The night's header is not pinned (a short window): the line starts with its day (walk 15 T3-07). */
  nightPrefix?: string;
  moves: boolean;
  /** Called with the fold's node once it has opened or closed, so the feed can bring its list (or its line) into view. */
  onOpened?: (node: unknown, open: boolean) => void;
  onToggle: () => void;
  open: boolean;
  shorts: boolean;
  total: number;
  /** The day's moves, shown while open: read as one list under the fold. */
  children?: ReactNode;
}) {
  const wrapRef = useRef<View>(null);
  useEffect(() => {
    onOpened?.(wrapRef.current, open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const name = feesLineName(moves, shorts);
  const noun = moves ? (count === 1 ? 'move' : 'moves') : (count === 1 ? 'fee' : 'fees');
  const list = open && Children.count(children) > 0 ? (
    <View aria-label={name} role="list">
      {children}
    </View>
  ) : null;
  return (
    <View ref={wrapRef}>
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
      <Text style={styles.feesTitle}>
        {nightPrefix ? <Text style={styles.rowNight}>{nightPrefix}</Text> : null}
        {name} · {count}
      </Text>
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
/** The desktop side column's "Back to newest" (its wrapper). */
const BACK_ID = 'results-back-to-newest';

/** The first Tab stop after an element in the page (web). */
function firstStopAfter(node: HTMLElement): Element | null {
  const stops = document.querySelectorAll('[tabindex="0"], button:not([disabled]), a[href], input, [role="button"]:not([tabindex="-1"])');
  for (const stop of Array.from(stops)) {
    // eslint-disable-next-line no-bitwise
    if (node.compareDocumentPosition(stop) & Node.DOCUMENT_POSITION_FOLLOWING) return stop;
  }
  return null;
}

/** Set while Results is on screen: scroll back to the newest night. */
let showNewest: (() => void) | null = null;

/**
 * The night you were reading when Results last left the screen (walk 9
 * T2-N6): tabs unmount their screen, so it is kept here, and Results opens
 * there again by its tab unless new games have settled (`resumeNight`).
 */
let readingPlace: ReadingPlace | null = null;

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
/**
 * Web: after a month jump, line that month's first day up with the top of the
 * feed exactly (walk 4 T2-08). react-native-web measures a row only when its
 * size changes, so once newer nights are added above a day, or a row above it
 * is opened, the list's own offset for that day is short, and scrollToIndex
 * stopped with the month's first day a row or two down, under November's.
 * Once the day is on the page its real distance from the feed's top is known:
 * scroll by that, and look again until it holds (the list may still be
 * walking down to a far month). It stops at the end of the feed, and when
 * `current()` says a newer jump or "Back to newest" has taken over.
 *
 * While the day is not on the page yet, `missing()` asks the list to try
 * again (it lands near the day by estimate, not by walking through every
 * month: walk 5 T4-14). `done()` runs once the day holds, or when it gives
 * up, so the feed is never left hidden.
 */
function settleOnDay(
  list: { getScrollableNode?: () => unknown } | null,
  id: string,
  current: () => boolean,
  { missing, done }: { missing?: () => void; done?: () => void } = {},
  tries = 30,
  steady = 0,
): void {
  if (typeof document === 'undefined' || !current()) return;
  if (tries <= 0) {
    done?.();
    return;
  }
  const scroller = list?.getScrollableNode?.() as HTMLElement | null | undefined;
  const node = document.getElementById(id);
  let held = steady;
  if (scroller && node) {
    const off = naturalTop(node, scroller) - scroller.getBoundingClientRect().top;
    const below = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
    if (Math.abs(off) <= 1 || (off > 0 && below <= 1)) {
      held += 1;
    } else {
      scroller.scrollTop += off;
      held = 0;
    }
    if (held >= 2) {
      done?.();
      return;
    }
  } else if (!node) {
    missing?.();
  }
  // Quick while it is still moving, so the landing takes a few frames.
  setTimeout(() => settleOnDay(list, id, current, { missing, done }, tries - 1, held), held > 0 ? 50 : 40);
}

/** How long a landed jump keeps its night at the top while the feed still changes height. */
const JUMP_STEADY_MS = 300;
const JUMP_HOLD_MAX_MS = 2500;

/**
 * Web: the second half of a month jump (walk 11 T2-07). Once the day holds
 * and the feed shows, rows still being drawn above it can change the feed's
 * height (by hundreds of pixels at the feed's end), which left the view below
 * the night, blank, then a week late. So every change in the feed's height
 * puts the day back at the top before the frame is painted (a
 * ResizeObserver), until the height has not changed for JUMP_STEADY_MS. Any
 * scroll, tap or key of your own ends it at once, as does a newer navigation
 * (`current()`). Returns the way to end it early.
 */
function holdOnDay(
  list: { getScrollableNode?: () => unknown } | null,
  id: string,
  current: () => boolean,
): () => void {
  const scroller = list?.getScrollableNode?.() as HTMLElement | null | undefined;
  const content = scroller?.firstElementChild ?? null;
  if (typeof document === 'undefined' || typeof ResizeObserver === 'undefined' || !scroller || !content) {
    return () => undefined;
  }
  const yours = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
  let quiet: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
    clearTimeout(quiet);
    clearTimeout(cap);
    yours.forEach((type) => scroller.removeEventListener(type, stop));
  };
  const pin = () => {
    if (stopped) return;
    if (!current()) {
      stop();
      return;
    }
    const node = document.getElementById(id);
    if (node) {
      const off = naturalTop(node, scroller) - scroller.getBoundingClientRect().top;
      const below = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
      if (!(Math.abs(off) <= 1 || (off > 0 && below <= 1))) scroller.scrollTop += off;
    }
    clearTimeout(quiet);
    quiet = setTimeout(stop, JUMP_STEADY_MS);
  };
  const observer = new ResizeObserver(pin);
  const cap = setTimeout(stop, JUMP_HOLD_MAX_MS);
  yours.forEach((type) => scroller.addEventListener(type, stop, { passive: true }));
  observer.observe(content);
  quiet = setTimeout(stop, JUMP_STEADY_MS);
  return stop;
}

/**
 * Move focus to an element by id once it has rendered (web only), unless
 * `current()` says another navigation has taken over since (a Back to newest
 * pressed mid-jump must not have focus pulled down to the old month).
 */
function focusWhenReady(id: string, current: () => boolean = () => true, tries = 40): void {
  if (typeof document === 'undefined' || !current()) return;
  const node = document.getElementById(id) as (HTMLElement | null);
  if (node) {
    node.focus({ preventScroll: true });
    return;
  }
  if (tries > 0) setTimeout(() => focusWhenReady(id, current, tries - 1), 80);
}

function toggled(previous: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(previous);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/**
 * The wide side column from the first night (walk 14 T2-06: it held only the
 * title until "Jump to" appeared): how many nights your players have played,
 * and the best and worst so far, each a button that brings its night to the
 * top of the feed as a month in "Jump to" does. In one player's Results it
 * counts his games.
 */
function SeasonSoFarBlock({
  his,
  onJump,
  over,
  summary,
}: {
  his: boolean;
  onJump: (date: string) => void;
  /** The season is over: the whole season, not "so far". */
  over: boolean;
  summary: SeasonSoFar;
}) {
  const noun = his ? 'game' : 'night';
  const title = his ? (over ? 'His games' : 'His games so far') : over ? 'Your season' : 'Season so far';
  const extreme = (kind: 'Best' | 'Worst', entry: { date: string; total: number }) => (
    <Pressable
      accessibilityHint={`Shows that ${noun} in the feed.`}
      accessibilityLabel={`${kind} ${noun}, ${humanDay(entry.date)}, ${netWords(entry.total)}`}
      accessibilityRole="button"
      key={kind}
      onPress={() => onJump(entry.date)}
      style={({ pressed }) => [styles.soFarRow, pressed && styles.rowOpen]}
    >
      <Text style={styles.soFarLabel}>{kind} {noun}</Text>
      <Text style={styles.soFarDate}>{humanDay(entry.date)}</Text>
      <NetMoney size="body" value={entry.total} />
    </Pressable>
  );
  return (
    <View accessibilityLabel={title} role="group" style={styles.jump}>
      <Text style={styles.jumpLabel}>{title}</Text>
      <Text style={styles.soFarCount}>
        {summary.count} {noun}{summary.count === 1 ? '' : 's'} played, {summary.span}
      </Text>
      {summary.best ? extreme('Best', summary.best) : null}
      {summary.worst ? extreme('Worst', summary.worst) : null}
    </View>
  );
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
  // The months split into even rows, so none sits alone on a second row at
  // 320px (walk 11 T4-10): measured once drawn (the row's width and the
  // widest button), one wrapping row until then.
  const [box, setBox] = useState({ width: 0, chip: 0 });
  const fit = box.width > 0 && box.chip > 0 ? Math.floor((box.width + space.xs) / (box.chip + space.xs)) : 0;
  let start = 0;
  const rows = monthChipRows(anchors.length, fit).map((size) => {
    const part = anchors.slice(start, start + size);
    start += size;
    return part;
  });
  return (
    <View accessibilityLabel="Jump to a month" role="group" style={styles.jump}>
      <Text style={styles.jumpLabel}>Jump to</Text>
      <View
        onLayout={(event) => {
          const width = Math.floor(event.nativeEvent.layout.width);
          setBox((was) => (was.width === width ? was : { ...was, width }));
        }}
        style={styles.jumpRows}
      >
        {rows.map((part) => (
          <View key={part[0]?.key ?? 'none'} style={styles.jumpChips}>
            {part.map((anchor) => {
              const here = anchor.key === current;
              return (
                <Pressable
                  key={anchor.key}
                  accessibilityLabel={anchor.name}
                  accessibilityRole="button"
                  aria-current={here ? 'true' : undefined}
                  onLayout={(event) => {
                    const chip = Math.ceil(event.nativeEvent.layout.width);
                    setBox((was) => (chip > was.chip ? { ...was, chip } : was));
                  }}
                  onPress={() => onJump(anchor)}
                  style={({ pressed }) => [styles.chip, here && styles.chipHere, pressed && styles.rowOpen]}
                >
                  <Text style={[styles.chipText, here && styles.chipTextHere]}>{anchor.label}</Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------

/**
 * Web: Results' own focus targets draw their ring inside (walk 9 T3-09,
 * T3-10), like the frame's full-width rows: a jumped-to night heading sits
 * flush with the feed's edges and an opened row's math at its top, where
 * the frame's outside ring was clipped. `[data-ring="inset"]` marks them.
 */
const INSET_RING_ID = 'results-inset-ring';
function useInsetRing() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || document.getElementById(INSET_RING_ID)) return;
    const style = document.createElement('style');
    style.id = INSET_RING_ID;
    style.textContent = '[data-ring="inset"][tabindex]:focus-visible { outline-offset: -3px !important; }';
    document.head.appendChild(style);
  }, []);
}

type CellFocus = (event: unknown) => void;
/**
 * The feed's cells, by index, and how each tells the list it has focus; the
 * items say which cells are night headings (focusAnchor); `short` is a short
 * window (400% zoom), where a screen of rows is one or two.
 */
type FeedFocus = {
  cells: Map<number, { current: CellFocus | undefined }>;
  items: { current: readonly ResultsFeedItem[] };
  short: { current: boolean };
  /** Each drawn cell's re-measure (web), and the one pass waiting to run them. */
  layouts: Set<() => void>;
  relayout: { current: number | null };
};
const FeedFocusContext = createContext<FeedFocus | null>(null);

/**
 * Each cell of the feed tells the list when the keyboard lands in it, so the
 * list keeps that row and a screen of rows on either side of it drawn (walk
 * 12 T3-06). react-native-web's View drops the list's own `onFocusCapture`,
 * so on the web the list drew rows around the scroll only: Tab held at 400%
 * zoom outran it, jumped out of the feed past the older nights, and once
 * lost focus with the row it was on. React's `onFocus` bubbles up from the
 * row's buttons on the web, as the capture does elsewhere.
 */
function FeedCell({ children, index, onFocusCapture, onLayout, style }: CellRendererProps<ResultsFeedItem>) {
  const feed = useContext(FeedFocusContext);
  const cellRef = useRef<View>(null);
  // Web: react-native-web measures a cell against its parent, and a pinned
  // night's cell sits alone in the sticky wrapper the ScrollView adds, so the
  // list recorded every pinned night at offset 0. It finds the rows to draw by
  // a binary search over those offsets: the zeros sent it off the end, and on
  // a phone's full season it fell back to its first 16 rows while Tab was in
  // February, taking the focused row with it (fix 12 note). A pinned night is
  // measured where it sits in the feed instead.
  // It also measures a cell only when its size changes, so once a row opens,
  // every row below keeps its old offset; the list sized the space it leaves
  // for rows it stops drawing from those, and the feed jumped by the opened
  // math's height while you scrolled on. So when any cell changes size, each
  // drawn cell that has moved reports where it is now (relayoutFeed).
  const reported = useRef<number | null>(null);
  const layoutNow = useRef(onLayout);
  layoutNow.current = onLayout;
  useLayoutEffect(() => {
    if (!feed || Platform.OS !== 'web') return undefined;
    const report = () => {
      const node = cellRef.current as unknown as HTMLElement | null;
      if (!node || !node.isConnected || reported.current === null) return;
      const top = pinnedCellTop(node) ?? node.offsetTop;
      if (Math.abs(top - reported.current) < 0.5) return;
      reported.current = top;
      layoutNow.current?.({
        nativeEvent: { layout: { x: node.offsetLeft, y: top, width: node.offsetWidth, height: node.offsetHeight } },
      } as LayoutChangeEvent);
    };
    feed.layouts.add(report);
    return () => {
      feed.layouts.delete(report);
    };
  }, [feed]);
  const measured = onLayout && Platform.OS === 'web'
    ? (event: LayoutChangeEvent) => {
      const node = cellRef.current as unknown as HTMLElement | null;
      const pinned = node ? pinnedCellTop(node) : null;
      const layout = pinned === null ? event.nativeEvent.layout : { ...event.nativeEvent.layout, y: pinned };
      reported.current = layout.y;
      onLayout(pinned === null ? event : { ...event, nativeEvent: { ...event.nativeEvent, layout } });
      if (feed) relayoutFeed(feed);
    }
    : onLayout;
  const own = useRef<CellFocus | undefined>(undefined);
  own.current = onFocusCapture as CellFocus | undefined;
  useLayoutEffect(() => {
    if (!feed) return undefined;
    feed.cells.set(index, own);
    return () => {
      if (feed.cells.get(index) === own) feed.cells.delete(index);
    };
  }, [feed, index]);
  const onFocus = (event: unknown) => {
    const into = (event as { currentTarget?: unknown }).currentTarget as Node | null | undefined;
    const from = (event as { relatedTarget?: unknown }).relatedTarget as Node | null | undefined;
    // Shift+Tab (or any move up the page): focus came from below this cell.
    const up = Boolean(into && from && typeof into.compareDocumentPosition === 'function'
      && into.compareDocumentPosition(from) & 4 /* Node.DOCUMENT_POSITION_FOLLOWING */ && !into.contains(from));
    // Telling the list redraws every row it holds (a third of a second on a
    // laptop with a long season), so a taller window tells it only when the
    // next rows the keyboard needs are not drawn yet; a short one, where the
    // list holds a few rows and its window lags a held Tab, on every stop.
    if (feed && !feed.short.current) {
      const count = feed.items.current.length;
      const drawn = [1, 2, 3].every((step) => {
        const at = index + (up ? -step : step);
        return at < 0 || at >= count || feed.cells.has(at);
      });
      if (drawn) return;
    }
    const anchor = feed ? focusAnchor(feed.items.current, index, up) : index;
    const told = feed?.cells.get(anchor)?.current;
    if (told && anchor !== index) {
      told(event);
      return;
    }
    own.current?.(event);
    // The heading past this row may be drawn only by this very report: once
    // the list has drawn it (its render runs first, in a microtask), tell the
    // list of the heading too, so the row after it is drawn before the next Tab.
    if (feed && anchor !== index) {
      queueMicrotask(() => feed.cells.get(anchor)?.current?.(event));
    }
  };
  const focus = Platform.OS === 'web' ? { onFocus } : { onFocusCapture: onFocus };
  return (
    <View ref={cellRef} onLayout={measured} style={style} {...(focus as object)}>
      {children}
    </View>
  );
}

/** After a cell changes size (web): once, before the next frame, every drawn cell that moved says so. */
function relayoutFeed(feed: FeedFocus): void {
  if (feed.relayout.current !== null || typeof requestAnimationFrame === 'undefined') return;
  feed.relayout.current = requestAnimationFrame(() => {
    feed.relayout.current = null;
    feed.layouts.forEach((report) => report());
  });
}

/**
 * Where a pinned night's cell sits in the feed (web), however far it is stuck:
 * the bottom of the last cell before it that is not pinned, plus any pinned
 * ones between. Null for a cell that is not pinned.
 */
function pinnedCellTop(node: HTMLElement): number | null {
  const wrapper = node.parentElement;
  if (!wrapper || getComputedStyle(wrapper).position !== 'sticky') return null;
  let above = node.offsetTop;
  for (let before = wrapper.previousElementSibling as HTMLElement | null; before; before = before.previousElementSibling as HTMLElement | null) {
    above += before.offsetHeight;
    if (getComputedStyle(before).position !== 'sticky') return before.offsetTop + above;
  }
  return above;
}

export function PerGameResultsScreen() {
  useInsetRing();
  const { bootstrap } = usePerGame();
  const { fontScale, width, height } = useWindowDimensions();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  // Days whose fee rows are listed; every "Roster moves" line starts folded.
  const [openFees, setOpenFees] = useState<ReadonlySet<string>>(() => new Set());
  const [far, setFar] = useState(false);
  const [currentMonth, setCurrentMonth] = useState<string | null>(null);
  const listRef = useRef<FlatList<ResultsFeedItem>>(null);
  const listHeight = useRef(0);
  const jumpRetries = useRef(0);
  // "See his games" from a profile (walk 8 T2-I4): one player's games until
  // "Show all players"; the default feed is every player's, as before.
  const [only, setOnly] = useState<PlayerGames | null>(() => takePlayerGames());
  // Where you were reading when you left by another tab (walk 9 T2-N6).
  const [resumeAt] = useState<ReadingPlace | null>(() => readingPlace);
  useEffect(() => onPlayerGames(() => {
    const request = takePlayerGames();
    if (request) setOnly(request);
  }), []);
  const onlyId = only?.playerId ?? null;
  const feed = useMemo(
    () => (bootstrap
      ? buildResultsFeed(onlyId ? playerFeedSource(bootstrap, onlyId) : bootstrap, { lastSettledDate: bootstrap.game.lastSettledDate })
      : []),
    [bootstrap, onlyId],
  );
  // A new filter (or none) starts at the newest night.
  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    setJumpWindow(false);
  }, [onlyId]);
  // Back to every player's games; focus goes to the title, as the button leaves.
  const showAll = useMemo(() => repeatSafe(() => {
    setOnly(null);
    focusWhenReady(TITLE_ID);
  }), []);
  // Asked for from his profile (walk 9 T1-17): "Back to <player>" reopens it
  // here, in the view it was in, and the frame's Back can do the same
  // (`reopenGamesProfile`). Closing it leaves his games as they were.
  const [profileOpen, setProfileOpen] = useState(false);
  const from = only?.from ?? null;
  useEffect(() => {
    if (!from) return undefined;
    const reopenHere = () => {
      setProfileOpen(true);
      return true;
    };
    setProfileReopen(reopenHere);
    return () => setProfileReopen(null);
  }, [from]);
  const backToProfile = useMemo(() => repeatSafe(() => setProfileOpen(true)), []);
  // A day's moves render inside their fold, as one list (walk 3 T3-32).
  const visible = useMemo(() => (onlyId ? hisFeed(feed) : foldedFeed(feed)), [feed, onlyId]);
  // Which row the keyboard is on, for the list's drawing (FeedCell).
  const feedFocus = useRef<FeedFocus>({
    cells: new Map(),
    items: { current: visible },
    short: { current: false },
    layouts: new Set(),
    relayout: { current: null },
  }).current;
  feedFocus.items.current = visible;
  // What the reading place is recorded against, for the viewability callback.
  const placeNow = useRef({ visible, filtered: false, lastSettled: null as string | null });
  placeNow.current = { visible, filtered: onlyId !== null, lastSettled: bootstrap?.game.lastSettledDate ?? null };
  // A tall window pins the night you are reading under the frame (walk 10
  // T4-N3); phones count the title block above the feed.
  // One player's games are a log of short, dated lines (walk 13 T1-08): a
  // pinned date would stand over a game whose figures had scrolled away.
  const stickyIndices = useMemo(
    () => (onlyId ? undefined : stickyNightIndices(visible, height, width >= DESKTOP_MIN_WIDTH ? 0 : 1)),
    [visible, height, width, onlyId],
  );
  const stickyNow = useRef(false);
  stickyNow.current = stickyIndices !== undefined;
  const moves = useMemo(() => movesByDay(feed), [feed]);
  const anchors = useMemo(() => monthAnchors(visible), [visible]);
  // The opened row whose headline gave way (high zoom): its math carries a one-line title.
  const [titled, setTitled] = useState<string | null>(null);
  const extraData = useMemo(() => ({ expanded, openFees, titled }), [expanded, openFees, titled]);
  // A row opens and closes on the same spot: a double tap's second tap used
  // to close the math it had just opened (walk 6 T4-11), so it acts once.
  // Opening one also asks it to bring its math into view once it is drawn.
  const expandedNow = useRef(expanded);
  expandedNow.current = expanded;
  const revealKey = useRef<string | null>(null);
  const toggle = useMemo(() => repeatSafe((key: string) => {
    revealKey.current = expandedNow.current.has(key) ? `close:${key}` : key;
    setExpanded((previous) => toggled(previous, key));
  }), []);
  // Opened near the bottom, the feed scrolls just enough to show the whole
  // math, and not at all when it fits (walk 6 T2-07); no glide under Reduce
  // motion. A row drawn again later (scrolled back into view) never scrolls.
  const reducedMotion = useReducedMotion();
  const stillMotion = useRef(reducedMotion);
  stillMotion.current = reducedMotion;
  // At 400% zoom the headline gives way so the math's first line is at the
  // top, and closing it brings the headline back (walk 8 T3-14).
  const revealOpened = useCallback((key: string, node: unknown, open = true) => {
    if (revealKey.current !== (open ? key : `close:${key}`)) return;
    revealKey.current = null;
    const scroller = (listRef.current as unknown as { getScrollableNode?: () => unknown } | null)
      ?.getScrollableNode?.() as HTMLElement | null | undefined;
    const row = node as HTMLElement | null;
    if (!scroller || typeof scroller.scrollBy !== 'function' || !row || typeof row.getBoundingClientRect !== 'function') return;
    const view = scroller.getBoundingClientRect();
    const box = row.getBoundingClientRect();
    // Under the night header pinned at the top, when there is one.
    const viewTop = stickyNow.current ? readableTop(scroller) : Math.max(view.top, 0);
    const behavior = stillMotion.current ? 'auto' : 'smooth';
    if (!open) {
      const back = closeScroll({ rowTop: box.top, viewTop });
      if (back < 0) scroller.scrollBy({ top: back, behavior });
      return;
    }
    // The headline (the row's button) comes first; the math starts under it.
    const headline = row.firstElementChild as HTMLElement | null;
    const by = revealScroll({
      rowTop: box.top,
      rowBottom: box.bottom,
      mathTop: headline && headline !== row.lastElementChild ? headline.getBoundingClientRect().bottom : box.top,
      viewTop,
      viewBottom: Math.min(view.bottom, window.innerHeight),
    });
    if (by > 0) scroller.scrollBy({ top: by, behavior });
    const math = row.lastElementChild as HTMLElement | null;
    // The headline scrolls away above the math (high zoom): the math shows
    // whose it is on a line of its own (walk 10 T3-10).
    const gaveWay = by > 0 && headline !== null && math !== null && math !== headline
      && headline.getBoundingClientRect().bottom - by <= viewTop + 1;
    setTitled(gaveWay ? key : null);
    // The row that holds focus scrolls out of view (400% zoom): focus goes
    // to its math, which Escape returns from (walk 9 T3-10).
    const active = typeof document === 'undefined' ? null : document.activeElement;
    if (by > 0 && headline && math && math !== headline && active && headline.contains(active)
      && headline.getBoundingClientRect().bottom - by <= viewTop + 1) {
      math.focus({ preventScroll: true });
    }
  }, []);
  // A day's moves opened near the bottom come into view the same way.
  const openFeesNow = useRef(openFees);
  openFeesNow.current = openFees;
  const toggleFees = useMemo(() => repeatSafe((date: string) => {
    revealKey.current = openFeesNow.current.has(date) ? `close:fold:${date}` : `fold:${date}`;
    setOpenFees((previous) => toggled(previous, date));
  }), []);

  // Each month jump's number; a later jump (or Back to newest) ends an earlier one's settling.
  const jumpSeq = useRef(0);
  // The jump in progress (its number, row and night heading), or the last
  // one's night once it has landed; null after Back to newest.
  const jumpTarget = useRef<{ seq: number; index: number; id: string } | null>(null);
  // While a month jump settles the feed is hidden (the note says where it is
  // going), then shown at the month: the months in between never stream past
  // (walk 5 T4-14).
  // Holds the month being landed on ("2025-10"), null once the feed shows.
  const [landing, setLanding] = useState<string | null>(null);
  // Every row up to the month is drawn while the jump walks there, and stays
  // drawn until the feed goes back to its newest night (walk 11 T2-07).
  const [jumpWindow, setJumpWindow] = useState(false);
  // The month a jump is landing on: "Jump to" marks it until the feed shows,
  // never a month the hidden view passes on its way (walk 11 T2-07).
  const landingMonth = useRef<string | null>(null);
  // A far month takes a moment to land (up to 2 s in a full season): from the
  // first frame the feed hides, it says where it is going instead of standing
  // blank (walk 11 lead note, fix 12; walk 13 T1-15: a phone's jump to October
  // lands in about 0.3 s, before a delayed note ever showed).
  const goingTo = landing ? anchors.find((anchor) => anchor.key === landing)?.name ?? null : null;
  // Ends the last jump's hold on its night (holdOnDay).
  const releaseHold = useRef<(() => void) | null>(null);
  useEffect(() => () => releaseHold.current?.(), []);
  // Back up near the newest night, the list may window its rows again: all
  // the rows above you are drawn there, so nothing on screen moves, and
  // opening a row's math stays quick.
  useEffect(() => {
    if (!far) setJumpWindow(false);
  }, [far]);
  const backToNewest = useCallback(() => {
    // Any new navigation wins over a jump still settling (walk 5 T4-14).
    jumpSeq.current += 1;
    jumpTarget.current = null;
    landingMonth.current = null;
    releaseHold.current?.();
    setLanding(null);
    setJumpWindow(false);
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

  const jumpTo = useCallback((anchor: Pick<MonthAnchor, 'index' | 'date'>, options: { focus?: boolean } = {}) => {
    jumpRetries.current = 0;
    const seq = ++jumpSeq.current;
    const id = nightAnchorId(anchor.date);
    const current = () => jumpSeq.current === seq;
    jumpTarget.current = { seq, index: anchor.index, id };
    landingMonth.current = anchor.date.slice(0, 7);
    setCurrentMonth(landingMonth.current);
    setLanding(landingMonth.current);
    setJumpWindow(true);
    listRef.current?.scrollToIndex({ index: anchor.index, animated: false, viewPosition: 0 });
    const missing = () => {
      if (!current() || jumpRetries.current >= 40) return;
      jumpRetries.current += 1;
      listRef.current?.scrollToIndex({ index: anchor.index, animated: false, viewPosition: 0 });
    };
    // The month's first day at the top of the feed, not a row or two below
    // it; once it holds the feed shows, and the day stays at the top while
    // the feed still changes height (walk 11 T2-07). The rows drawn for the
    // jump stay drawn until Back to newest: narrowing the window swapped them
    // for the list's own estimate of their height, short by hundreds of
    // pixels, and left the view blank, then a week late.
    settleOnDay(listRef.current, id, current, {
      missing,
      done: () => {
        if (!current()) return;
        landingMonth.current = null;
        setLanding(null);
        releaseHold.current?.();
        releaseHold.current = holdOnDay(listRef.current, id, current);
      },
    });
    // Coming back to your place by tab (T2-N6) leaves focus with the screen.
    if (options.focus !== false) focusWhenReady(id, current);
  }, []);
  // The side column's best and worst night (walk 14 T2-06): its night at the
  // top; a double-click lands once.
  const jumpToNight = useMemo(() => repeatSafe((date: string) => {
    const index = placeNow.current.visible.findIndex((item) => item.type === 'night' && item.night.date === date);
    if (index >= 0) jumpTo({ index, date });
  }), [jumpTo]);
  // Back by tab: the night you were reading, once (walk 9 T2-N6).
  useEffect(() => {
    const date = resumeNight(resumeAt, {
      lastSettled: placeNow.current.lastSettled,
      filtered: placeNow.current.filtered,
      nightDates: placeNow.current.visible.flatMap((item) => (item.type === 'night' ? [item.night.date] : [])),
    });
    const index = date ? placeNow.current.visible.findIndex((item) => item.type === 'night' && item.night.date === date) : -1;
    if (date && index > 0) jumpTo({ index, date }, { focus: false });
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A far month is not measured yet: land near it at once by estimate (rows
  // measured so far give the average height), so the rows around it render
  // and the settling above lines its first day up. Walking down a measured
  // stretch at a time streamed every month past for about 2 s (walk 5 T4-14).
  // Only the jump in progress may move the list: a Back to newest or another
  // month pressed meanwhile is never undone by a late retry.
  const onScrollToIndexFailed = useCallback((info: { index: number; highestMeasuredFrameIndex: number; averageItemLength: number }) => {
    const list = listRef.current;
    const target = jumpTarget.current;
    if (!list || !target || target.seq !== jumpSeq.current || target.index !== info.index) return;
    const each = info.averageItemLength > 0 ? info.averageItemLength : 60;
    list.scrollToOffset({ offset: Math.max(0, each * info.index), animated: false });
  }, []);
  // Desktop keyboard (walk 5 T3-09): "Back to newest" is drawn under the
  // month buttons and follows them in Tab order, but a jump puts focus on the
  // month's first night, far down the feed, with every newer row between it
  // and the button. So after a jump the two are linked: Shift+Tab from that
  // night (or its first row) reaches Back to newest, and Tab from Back to
  // newest returns to the night, skipping the newer rows jumped past.
  const wideScreen = width >= DESKTOP_MIN_WIDTH;
  useEffect(() => {
    if (!wideScreen || !far || typeof document === 'undefined') return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = jumpTarget.current;
      const landed = target ? document.getElementById(target.id) : null;
      const back = document.getElementById(BACK_ID)?.querySelector<HTMLElement>('[tabindex="0"], button, [role="button"]');
      if (!landed || !back) return;
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active !== landed && active !== firstStopAfter(landed)) return;
        event.preventDefault();
        back.focus();
      } else if (active === back) {
        event.preventDefault();
        landed.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [far, wideScreen]);
  // Far down, the way back docks under the list, or (a short window, e.g.
  // 400% zoom) waits in its corner (walk 10 T3-06). As it arrives, and on each
  // Tab while it is there, the row the keyboard is on ends in the clear above
  // it instead of cut off under it.
  const place = newestPlace({ wide: wideScreen, height });
  feedFocus.short.current = place === 'corner';
  useEffect(() => {
    if (!far || place === 'side' || typeof document === 'undefined') return undefined;
    // Clear of the corner button with room for the focus ring drawn around a row.
    const reserve = place === 'corner' ? NEWEST_CORNER_RESERVE + 4 : 0;
    const scroller = () => (listRef.current as unknown as { getScrollableNode?: () => unknown } | null)
      ?.getScrollableNode?.() as HTMLElement | null | undefined;
    const clear = () => {
      const node = scroller();
      const active = document.activeElement as HTMLElement | null;
      if (!node || !active || active === node || !node.contains(active)) return;
      if (typeof active.matches === 'function' && !active.matches(':focus-visible')) return;
      const view = node.getBoundingClientRect();
      const box = active.getBoundingClientRect();
      const by = clearOfBottom({
        top: box.top,
        bottom: box.bottom,
        // Under the night header pinned at the top, when there is one.
        viewTop: stickyNow.current ? readableTop(node) : view.top,
        viewBottom: Math.min(view.bottom, window.innerHeight),
        reserve,
      });
      if (by !== 0) node.scrollBy({ top: by });
    };
    let frame = requestAnimationFrame(clear);
    const onFocus = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(clear);
    };
    const node = scroller();
    node?.addEventListener('focusin', onFocus);
    return () => {
      cancelAnimationFrame(frame);
      node?.removeEventListener('focusin', onFocus);
    };
  }, [far, place]);
  // 400% zoom (walk 11 T3-11): the "↑ Newest" corner button steps out of the
  // way while it would sit over an opened row's math or the row the keyboard
  // is on (its ring included); the math's title says where you are, and the
  // button comes back as soon as the rows under it are plain ones again.
  const cornerRef = useRef<View>(null);
  const [cornerCovers, setCornerCovers] = useState(false);
  useEffect(() => {
    if (!far || place !== 'corner' || typeof document === 'undefined') {
      setCornerCovers(false);
      return undefined;
    }
    const node = (listRef.current as unknown as { getScrollableNode?: () => unknown } | null)
      ?.getScrollableNode?.() as HTMLElement | null | undefined;
    const corner = cornerRef.current as unknown as HTMLElement | null;
    if (!node || !corner || typeof corner.getBoundingClientRect !== 'function') return undefined;
    let frame = 0;
    const look = () => {
      const button = corner.getBoundingClientRect();
      const under = (box: DOMRect, ring = 0) => box.left - ring < button.right && box.right + ring > button.left
        && box.top - ring < button.bottom && box.bottom + ring > button.top;
      let covers = false;
      node.querySelectorAll<HTMLElement>('[aria-expanded="true"]').forEach((opened) => {
        const row = opened.parentElement;
        if (row && under(row.getBoundingClientRect())) covers = true;
      });
      const active = document.activeElement as HTMLElement | null;
      if (!covers && active && active !== node && node.contains(active)
        && (typeof active.matches !== 'function' || active.matches(':focus-visible'))
        && under(active.getBoundingClientRect(), 4)) covers = true;
      setCornerCovers(covers);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(look);
    };
    schedule();
    node.addEventListener('scroll', schedule, { passive: true });
    node.addEventListener('focusin', schedule);
    node.addEventListener('focusout', schedule);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    const content = node.firstElementChild;
    if (observer && content) observer.observe(content);
    return () => {
      cancelAnimationFrame(frame);
      node.removeEventListener('scroll', schedule);
      node.removeEventListener('focusin', schedule);
      node.removeEventListener('focusout', schedule);
      observer?.disconnect();
    };
  }, [far, place, expanded, openFees]);
  // A row the keyboard lands on is never left under the pinned night header:
  // Shift+Tab up the feed scrolls it into the clear below the header.
  const sticky = stickyIndices !== undefined;
  useEffect(() => {
    if (!sticky || typeof document === 'undefined') return undefined;
    const node = (listRef.current as unknown as { getScrollableNode?: () => unknown } | null)
      ?.getScrollableNode?.() as HTMLElement | null | undefined;
    if (!node) return undefined;
    let frame = 0;
    const clear = () => {
      const active = document.activeElement as HTMLElement | null;
      if (!active || active === node || !node.contains(active) || active.id.startsWith('results-day-')) return;
      if (typeof active.matches === 'function' && !active.matches(':focus-visible')) return;
      const under = readableTop(node) - active.getBoundingClientRect().top;
      if (under > 0.5) node.scrollBy({ top: -Math.round(under) });
    };
    const onFocus = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(clear);
    };
    node.addEventListener('focusin', onFocus);
    return () => {
      cancelAnimationFrame(frame);
      node.removeEventListener('focusin', onFocus);
    };
    // A layout switch (desktop, phone, short window) draws the list anew.
  }, [sticky, place]);
  // Pinned headers already passed never show under the one on top.
  useEffect(() => {
    if (!sticky || typeof document === 'undefined') return undefined;
    const node = (listRef.current as unknown as { getScrollableNode?: () => unknown } | null)
      ?.getScrollableNode?.() as HTMLElement | null | undefined;
    if (!node || typeof node.querySelectorAll !== 'function') return undefined;
    const clipped = new Set<HTMLElement>();
    const apply = () => clipPinnedNights(node, clipped);
    apply();
    // In the scroll event itself, so the clip lands in the same frame.
    node.addEventListener('scroll', apply, { passive: true });
    window.addEventListener('resize', apply);
    // Rows opening, a week landing, headers mounting as the list windows.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(apply);
    const content = node.firstElementChild;
    if (observer && content) observer.observe(content);
    return () => {
      node.removeEventListener('scroll', apply);
      window.removeEventListener('resize', apply);
      observer?.disconnect();
      clipped.forEach((cell) => {
        cell.style.clipPath = '';
      });
    };
  }, [sticky, place]);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = event.nativeEvent.contentOffset.y > Math.max(600, listHeight.current * FAR_SCREENS);
    setFar((was) => (was === next ? was : next));
  }, []);
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const token = viewableItems.find((each) => each.isViewable);
    const top = token?.item as ResultsFeedItem | undefined;
    const date = !top ? null : top.type === 'night' ? top.night.date : top.date;
    setCurrentMonth(landingMonth.current ?? (date ? date.slice(0, 7) : null));
    // Keep the night you are reading (its heading, at or above the top row)
    // for a return by tab; none at the newest night or on one player's games.
    const { visible: items, filtered, lastSettled } = placeNow.current;
    if (filtered) return;
    let at = token?.index ?? 0;
    while (at > 0 && items[at]?.type !== 'night') at -= 1;
    const heading = items[at];
    const newest = items.findIndex((item) => item.type === 'night');
    readingPlace = at > newest && heading?.type === 'night' ? { date: heading.night.date, lastSettled } : null;
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 10 }).current;
  if (!bootstrap) return null;

  const tight = width < STACK_MAX_WIDTH;
  const compact = fontScale > 1.2 || tight;
  const wide = width >= DESKTOP_MIN_WIDTH;
  const layout: Layout = { columns: wide && !compact, compact, tight };
  const nights = feedNights(feed);
  const played = nights.filter((night) => night.results > 0);
  const soFar = wide ? seasonSoFar(nights) : null;
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
  const movesOnly = played.length === 0 && feed.length > 0 && !only;
  // Games have been played, just none by your players: practice is past its opening
  // eve (Day 0 settles no games); a live season has settled a night.
  const nightsWithoutYou = movesOnly && (isMockActive()
    ? practiceProgress(mockSeasonStart(), lastSettled).day > 0
    : Boolean(lastSettled));

  // One player's games on desktop take one line each (walk 15 T2-04): a
  // settled game's row carries its night (date and how he did), and the
  // night's own cell stays empty. Phones keep the night's line over the row.
  const lineNight = (index: number): NightSummary | undefined => {
    const head = visible[index - 1];
    const item = visible[index];
    if (!only || !layout.columns || head?.type !== 'night' || item?.type !== 'result' || head.night.date !== item.date) return undefined;
    const equation = settlementEquation(item.result, bootstrap.ledger.items, bootstrap.settledResults, { ledgerComplete });
    return resultRowModel(item.result, equation).math ? head.night : undefined;
  };
  const renderItem: ListRenderItem<ResultsFeedItem> = ({ item, index }) => {
    if (item.type === 'night') {
      return lineNight(index + 1) ? null : <NightHeader his={only !== null} layout={layout} night={item.night} />;
    }
    if (item.type === 'fees') {
      const open = openFees.has(item.date);
      return (
        <FeesFold
          count={item.count}
          layout={layout}
          nightPrefix={rowNightPrefix(item.date, height)}
          moves={item.moves}
          onOpened={(node, open) => revealOpened(`fold:${item.date}`, node, open)}
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
    // One player's Results lists his moves in line with his games (walk 14 T1-07).
    if (item.type === 'fee') {
      return only ? (
        <HisMoveRow
          date={item.date}
          entry={item.entry}
          layout={layout}
          playerName={perGamePlayerName(bootstrap, item.entry.playerId, item.entry.positionId)}
          side={item.side}
        />
      ) : null;
    }
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
        onOpened={(node, open) => revealOpened(item.key, node, open)}
        onToggle={() => toggle(item.key)}
        his={only !== null}
        night={lineNight(index)}
        nightPrefix={only === null ? rowNightPrefix(item.result.gameDate, height) : ''}
        playerName={perGamePlayerName(bootstrap, item.result.playerId, item.result.positionId)}
        result={item.result}
        rule={rule}
        titled={titled === item.key}
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
  // One rule with the Roster and Market: practice ends on its last day, a live
  // season when games have settled and none are left.
  const seasonOver = isSeasonOver({
    practiceComplete: isMockActive() && practiceProgress(mockSeasonStart(), lastSettled).complete,
    lastSettledDate: lastSettled,
    nextGameDate: bootstrap.game.nextGameDate,
  });
  const header = (
    <View
      // Above the rows on a phone: a change in its height moves every row.
      onLayout={wide ? undefined : () => relayoutFeed(feedFocus)}
      style={[styles.header, wide ? styles.headerSide : { paddingHorizontal: edges(layout).left }]}
    >
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
        <Text style={styles.caption}>
          {only ? 'Newest night first. Select a game to see the math.' : 'Newest night first. Select a player to see the math.'}
        </Text>
      ) : null}
      {movesOnly ? (
        <Text style={styles.note}>
          {nightsWithoutYou
            ? 'None of your players has had a game yet. Results land here after each night they play. Your moves so far are below.'
            : 'No games yet. Results land here after each night of games. Your moves so far are below.'}
        </Text>
      ) : null}
      {only ? (
        // The way back to his profile first, then the way out to every
        // player's games: two outlined buttons flush with the line above
        // (walk 11 T1-07, T2-04: a borderless Back read like a caption).
        <View style={styles.onlyBlock}>
          <Text style={styles.onlyText}>{unbrokenName(only.playerName)}'s games only.</Text>
          <View style={styles.only}>
            {only.from ? (
              <Button
                accessibilityLabel={`Back to ${only.playerName}'s profile`}
                label={`Back to ${only.playerName}`}
                onPress={backToProfile}
              />
            ) : null}
            <Button
              accessibilityLabel={`Show all players' games, not only ${only.playerName}'s`}
              label="Show all players"
              onPress={showAll}
            />
          </View>
        </View>
      ) : null}
      {quietLastNight && lastSettled && !only ? (
        <Text style={styles.note}>None of your players had a game on {humanDay(lastSettled)}.</Text>
      ) : null}
      {wide && soFar ? <SeasonSoFarBlock his={only !== null} onJump={jumpToNight} over={seasonOver} summary={soFar} /> : null}
      {anchors.length > 1 ? (
        // Marked on phones too, where the row sits at the top of the feed
        // (walk 7 T1-07): the newest month there, the jumped-to one after a jump.
        <MonthJump anchors={anchors} current={readingMonth(anchors, currentMonth)} onJump={jumpTo} />
      ) : null}
      {wide && far ? <View nativeID={BACK_ID} style={styles.sideBack}>{back}</View> : null}
    </View>
  );
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
    <FeedFocusContext.Provider value={feedFocus}>
      <View style={styles.list}>
        <FlatList
          ref={listRef}
          CellRendererComponent={FeedCell}
          contentContainerStyle={styles.content}
          data={visible}
          extraData={extraData}
          initialNumToRender={16}
          keyExtractor={(item) => item.key}
          ListEmptyComponent={empty}
          ListHeaderComponent={wide ? null : header}
          // A month jump renders every row up to the month in one pass while the
          // feed is hidden: rows are measured only once rendered, so the list
          // could otherwise reach a far month only a batch at a time.
          maxToRenderPerBatch={jumpWindow ? JUMP_BATCH : 16}
          onLayout={(event) => {
            listHeight.current = event.nativeEvent.layout.height;
          }}
          onScroll={onScroll}
          onScrollToIndexFailed={onScrollToIndexFailed}
          onViewableItemsChanged={onViewableItemsChanged}
          renderItem={renderItem}
          scrollEventThrottle={100}
          stickyHeaderIndices={stickyIndices}
          style={[styles.list, landing ? styles.listLanding : styles.listLanded]}
          viewabilityConfig={viewabilityConfig}
          windowSize={jumpWindow ? JUMP_BATCH : 9}
        />
        {goingTo ? (
          // Where the feed will show, while it is hidden: nothing under it.
          <View accessibilityLiveRegion="polite" style={[styles.goingTo, { paddingHorizontal: edges(layout).left }]}>
            <Text style={styles.note}>Going to {goingTo}…</Text>
          </View>
        ) : null}
      </View>
    </FeedFocusContext.Provider>
  );

  // His profile, reopened from "Back to <player>" in the view it was in.
  const profileId = profileOpen && only ? only.playerId : null;
  const profilePosition = profileId
    ? bootstrap.positions.find((row) => row.playerId === profileId && row.status === 'active') ?? null
    : null;
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
  const profile = only?.from ? (
    <PlayerProfileSheet
      dividendRate={bootstrap.ruleset.dividendDollarsPerNetPoint}
      initialView={only.from}
      latestSettledDate={bootstrap.game.lastSettledDate}
      onClose={() => setProfileOpen(false)}
      player={profilePlayer}
      position={profilePosition}
      results={profileId ? bootstrap.settledResults.filter((result) => result.playerId === profileId) : []}
      side={only.from.side ?? undefined}
      trends={profileId !== null && isMockActive() ? mockPlayerTrends(profileId) : undefined}
      visible={profileId !== null && profilePlayer !== null}
    />
  ) : null;

  if (wide) {
    return (
      <View style={styles.split}>
        <View style={styles.side}>{header}</View>
        {list}
        {profile}
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
  // A short window (400% zoom): no bar across the list, a small button in its
  // corner; the feed keeps the rows the keyboard lands on clear of it.
  if (place === 'corner') {
    return (
      <View style={styles.screen}>
        {list}
        {far ? (
          <View
            ref={cornerRef}
            style={[styles.corner, { right: edges(layout).right }, cornerCovers && styles.cornerAside]}
          >
            <Button
              accessibilityLabel="Back to the newest night"
              label="↑ Newest"
              onPress={backToNewest}
            />
          </View>
        ) : null}
        {profile}
      </View>
    );
  }
  return (
    <View style={styles.screen}>
      {list}
      {far ? (
        <View style={[styles.dock, { paddingHorizontal: edges(layout).left }]}>
          {here ? <Text style={styles.dockWhere}>{here}</Text> : null}
          <View style={styles.dockBack}>{back}</View>
        </View>
      ) : null}
      {profile}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  // "Going to October 2025…" where the hidden feed will show.
  goingTo: {
    position: 'absolute',
    top: space.lg,
    left: 0,
    right: 0,
    pointerEvents: 'none',
  },
  // A month jump settling: hidden, so the months in between never stream past.
  listLanding: {
    opacity: 0,
  },
  // Shown at the month at once, in the same frame the "Going to …" note
  // leaves: a fade in from nothing painted a blank frame or two between them
  // (walk 13 T1-15).
  listLanded: {
    opacity: 1,
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
  jumpRows: {
    rowGap: space.xs,
  },
  jumpChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xs,
  },
  // A month is a button: its edge is the controls' 3:1 ink in every
  // Appearance (walk 15 T3-02: the other month's hairline was 1.2-1.3:1 and
  // read as plain text beside the current one).
  chip: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: colors.controlBorder,
    borderRadius: 4,
    backgroundColor: colors.background,
  },
  // The month you are reading looks like a chosen segment: a gold tint, gold
  // edges and a 3px gold rule under it, so it stands out by more than a shade
  // in every theme (High contrast's grey tint read like its neighbour; walk 6
  // T2-17, T3-08). The chip keeps its size: the rule sits inside its height.
  chipHere: {
    borderColor: colors.goldInk,
    borderBottomWidth: 3,
    borderBottomColor: colors.goldInk,
    backgroundColor: colors.goldSoft,
  },
  chipText: {
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.bold,
  },
  chipTextHere: {
    color: colors.goldInk,
    fontWeight: weight.black,
  },
  soFarCount: {
    color: colors.muted,
    fontSize: type.body,
    lineHeight: 19,
    marginBottom: space.xs,
  },
  // A best or worst night: a quiet row that brings its night up.
  soFarRow: {
    // A 44px target like every other control (the audit found 255x36).
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: -space.xs,
    paddingHorizontal: space.xs,
    borderRadius: 4,
  },
  soFarLabel: {
    color: colors.muted,
    fontSize: type.body,
  },
  soFarDate: {
    flex: 1,
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.bold,
  },
  sideBack: {
    marginTop: space.lg,
    alignItems: 'flex-start',
  },
  // 400% zoom: the way back in the list's corner, over its bottom padding.
  corner: {
    position: 'absolute',
    bottom: NEWEST_CORNER_RESERVE - 44,
  },
  // Out of sight and out of the pointer's way; still in the Tab order, and
  // shown again the moment it takes focus (no row is focused then).
  cornerAside: {
    opacity: 0,
    pointerEvents: 'none',
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
  onlyBlock: {
    marginTop: space.sm,
    rowGap: space.sm,
  },
  only: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: space.md,
    rowGap: space.xs,
  },
  onlyText: {
    flexShrink: 1,
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.bold,
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
  // One player's games: the date line and the row under it read as one game.
  groupHeaderHis: {
    minHeight: 0,
    paddingTop: space.md,
    paddingBottom: 0,
    backgroundColor: colors.background,
    borderBottomWidth: 0,
  },
  groupSummaryHis: {
    color: colors.muted,
    fontFamily: fonts.body,
    fontSize: type.caption,
    fontWeight: weight.regular,
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
  // One player's games: one line under its date (groupHeaderHis).
  rowHis: {
    minHeight: 44,
    paddingTop: space.xs,
  },
  // One player's night heading over his row's line (desktop): no box of its
  // own, above the row so its focus ring shows, taps pass to the row.
  lineHeading: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1,
    pointerEvents: 'none',
  },
  rowOpen: {
    backgroundColor: colors.surface,
  },
  breakdown: {
    paddingBottom: space.md,
  },
  mathTitle: {
    paddingTop: space.sm,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: type.body,
    fontWeight: weight.bold,
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
  // The row's night before the name, in a short window (walk 15 T3-07).
  rowNight: {
    color: colors.muted,
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
