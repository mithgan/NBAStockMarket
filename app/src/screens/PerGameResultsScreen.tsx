import { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ListRenderItem,
} from 'react-native';

import type {
  PerGameLedgerEntry,
  PerGamePositionSide,
  PerGameSettledResult,
} from '../api/contracts';
import {
  exactMoney,
  exactSignedMoney,
  humanDay,
  moneyFine,
  signedMoney,
  unbrokenName,
} from '../copy/terms';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { Disclosure, DisclosureSpace, DISCLOSURE_WIDTH } from '../components/results/Disclosure';
import { NetMoney } from '../components/results/NetMoney';
import { SettlementBreakdown } from '../components/results/SettlementBreakdown';
import {
  buildResultsFeed,
  feedNights,
  nightSummaryLine,
  nightTotalPending,
  resultRowModel,
  type NightSummary,
  type ResultRowModel,
  type ResultsFeedItem,
} from '../data/resultsView';
import { usePerGame } from '../state/PerGameContext';
import {
  perGamePlayerName,
  settlementEquation,
  type SettlementEquation,
} from '../state/perGameState';
import { colors, fonts, headingStyle, labelStyle, space, type, weight } from '../theme';
import { EmptyState, headingLevel, Tag } from '../ui/kit';

/** At this width the feed becomes a centred column with aligned number columns. */
const DESKTOP_MIN_WIDTH = 1024;
/**
 * Below this width (a phone at 200% zoom is 195 CSS px) a name and a net no
 * longer fit side by side: rows stack, and the headshot steps aside.
 */
const STACK_MAX_WIDTH = 330;
const FEED_MAX_WIDTH = 840;
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
  // The pair in the order it subtracts to the net, with one more digit than
  // a headline so the three numbers visibly add up ($584K - $137.5K = $446.5K).
  // A no-break space keeps each word with its amount when the line wraps.
  const { first, second } = model.math.pair;
  return `${first.label}\u00a0${moneyFine(first.amount)} · ${second.label}\u00a0${moneyFine(second.amount)}`;
}

/** "CORRECTION" for the first correction, "CORRECTION 2" for the next. */
function correctionTag(correctionNumber: number): string {
  return correctionNumber > 1 ? `CORRECTION ${correctionNumber}` : 'CORRECTION';
}

/** Exact signed dollars for screen readers; exactly nothing is "$0", as on screen. */
function netWords(value: number): string {
  return Math.round(value) === 0 ? exactMoney(0) : exactSignedMoney(value);
}

function adjustmentText(adjustment: number | null): string {
  return adjustment === null
    ? 'Adjustment amount unavailable.'
    : `P&L adjustment ${signedMoney(adjustment)}.`;
}

const MISMATCH = 'This result does not reconcile. Refresh before relying on it.';

/**
 * The row's accessible name carries everything the row shows, including a
 * correction's adjustment and the does-not-reconcile warning: inside a
 * button, a screen reader hears only the button's name.
 */
function resultLabel(name: string, result: PerGameSettledResult, model: ResultRowModel): string {
  const parts = [name];
  if (result.side === 'short') parts.push('short');
  if (model.correctionNumber > 0) parts.push(correctionTag(model.correctionNumber).toLowerCase());
  parts.push(model.net === null ? 'Net profit and loss unavailable' : netWords(model.net));
  let label = `${parts.join(', ')}. `;
  if (model.math) {
    const { first, second } = model.math.pair;
    label += `${first.label} ${exactMoney(first.amount)}, ${second.label} ${exactMoney(second.amount)}.`;
  } else {
    label += `${resultPhrase(result, model).replace(' · ', ', ').replace(' — ', ', ')}.`;
  }
  if (model.adjustment !== undefined) {
    label += ` ${model.adjustment === null ? 'Adjustment amount unavailable.' : `P&L adjustment ${netWords(model.adjustment)}.`}`;
  }
  if (model.mismatch) label += ` ${MISMATCH}`;
  return label;
}

// ---------------------------------------------------------------------------
// Rows

function ResultRow({
  equation,
  expanded,
  layout,
  onToggle,
  playerName,
  result,
}: {
  equation: SettlementEquation;
  expanded: boolean;
  layout: Layout;
  onToggle: () => void;
  playerName: string;
  result: PerGameSettledResult;
}) {
  const { columns, compact, tight } = layout;
  const edge = edges(layout);
  const model = resultRowModel(result, equation);
  const { math } = model;
  // Desktop puts the two amounts in aligned columns; a row with no settled
  // arithmetic keeps its status sentence instead.
  const priceColumns = columns && math !== null;
  const label = resultLabel(playerName, result, model);
  const net = model.net === null ? (
    <Text accessibilityLabel="Net profit and loss unavailable" style={styles.netUnavailable}>—</Text>
  ) : (
    <NetMoney fine value={model.net} />
  );

  const body = (
    <>
      {tight ? null : <PlayerAvatar player={{ id: result.playerId, name: playerName }} size={AVATAR} />}
      <View style={styles.rowBody}>
        <View style={[styles.rowHeader, columns && styles.rowHeaderColumns, compact && styles.rowHeaderCompact]}>
          <View style={[styles.identity, compact && styles.identityCompact]}>
            <Text style={styles.playerName}>{unbrokenName(playerName)}</Text>
            {result.side === 'short' ? <Tag>Short</Tag> : null}
            {model.correctionNumber > 0 ? <Tag tone="cyan">{correctionTag(model.correctionNumber)}</Tag> : null}
          </View>
          {priceColumns && math ? (
            <>
              <Text style={styles.cell}>
                <Text style={styles.cellLabel}>{math.pair.first.label.toLowerCase()} </Text>
                {moneyFine(math.pair.first.amount)}
              </Text>
              <Text style={styles.cell}>
                <Text style={styles.cellLabel}>{math.pair.second.label.toLowerCase()} </Text>
                {moneyFine(math.pair.second.amount)}
              </Text>
            </>
          ) : null}
          <View style={[styles.netCell, columns && styles.netCellColumns, compact && styles.netCellCompact]}>
            {net}
            {compact && math ? <Disclosure height={20} open={expanded} /> : null}
          </View>
        </View>
        {priceColumns ? null : <Text style={styles.detail}>{resultPhrase(result, model)}</Text>}
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
        style={({ pressed }) => [styles.row, rowEdges, columns && styles.rowColumns, pressed && styles.rowOpen]}
      >
        {body}
      </Pressable>
      {expanded ? (
        <View style={[styles.breakdown, { paddingLeft: edge.text, paddingRight: edge.right }]}>
          <SettlementBreakdown lines={math.lines} net={math.net} side={result.side} wide={columns} />
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
  return (
    <View
      accessibilityLabel={`${feeTitle(entry)} for ${playerName}. ${feeExplanation(entry, side)}. Score change ${netWords(entry.amountDollars)}.`}
      accessible
      style={[styles.row, { paddingLeft: edges(layout).left, paddingRight: ROW_END }, styles.rowLine, columns && styles.rowColumns]}
    >
      {tight ? null : <PlayerAvatar player={{ id: entry.playerId, name: playerName }} size={AVATAR} />}
      <View style={styles.rowBody}>
        <View style={[styles.rowHeader, columns && styles.rowHeaderColumns, compact && styles.rowHeaderCompact]}>
          <View style={[styles.identity, compact && styles.identityCompact]}>
            <Text style={styles.playerName}>{unbrokenName(playerName)}</Text>
            <Tag>{feeTitle(entry)}</Tag>
          </View>
          <View style={[styles.netCell, columns && styles.netCellColumns, compact && styles.netCellCompact]}>
            <NetMoney fine value={entry.amountDollars} />
          </View>
        </View>
        <Text style={styles.detail}>{feeExplanation(entry, side)}</Text>
      </View>
      {compact ? null : <DisclosureSpace />}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Group headers

function NightHeader({ night, layout }: { night: NightSummary; layout: Layout }) {
  const summary = nightSummaryLine(night);
  const pending = nightTotalPending(night);
  const title = night.date ? humanDay(night.date) : 'Undated fees';
  const totalWords = pending ? 'total not settled yet' : `total ${netWords(night.total)}`;
  const edge = edges(layout);
  return (
    <View
      accessibilityLabel={`${title}: ${totalWords}.${summary ? ` ${summary}.` : ''}`}
      accessibilityRole="header"
      accessible
      {...headingLevel(2)}
      style={[
        styles.groupHeader,
        { paddingLeft: edge.left, paddingRight: edge.right },
        layout.columns && styles.groupHeaderColumns,
      ]}
    >
      <View style={[styles.groupCopy, layout.compact && styles.groupCopyCompact]}>
        <Text style={styles.groupTitle}>{title}</Text>
        {summary ? <Text style={styles.groupSummary}>{summary}</Text> : null}
      </View>
      <View style={[styles.groupTotal, layout.compact && styles.netCellCompact]}>
        {pending ? (
          <Text style={styles.netUnavailable}>—</Text>
        ) : (
          <NetMoney size="title" value={night.total} />
        )}
      </View>
    </View>
  );
}

/** Introduces the fees under a day that also had games. */
function FeesHeader({
  count,
  layout,
  moves,
  total,
}: {
  count: number;
  layout: Layout;
  moves: boolean;
  total: number;
}) {
  const edge = edges(layout);
  const name = moves ? 'Roster moves' : 'Fees';
  return (
    <View
      accessibilityLabel={`${name}: ${count}, ${netWords(total)}.`}
      accessibilityRole="header"
      accessible
      {...headingLevel(3)}
      style={[styles.feesHeader, { paddingLeft: edge.text, paddingRight: edge.right }]}
    >
      <Text style={styles.feesTitle}>{name} · {count}</Text>
      <NetMoney fine size="body" value={total} />
    </View>
  );
}

// ---------------------------------------------------------------------------

export function PerGameResultsScreen() {
  const { bootstrap } = usePerGame();
  const { fontScale, width } = useWindowDimensions();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const feed = useMemo(
    () => (bootstrap ? buildResultsFeed(bootstrap, { lastSettledDate: bootstrap.game.lastSettledDate }) : []),
    [bootstrap],
  );
  const toggle = useCallback((key: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  if (!bootstrap) return null;

  const tight = width < STACK_MAX_WIDTH;
  const compact = fontScale > 1.2 || tight;
  const wide = width >= DESKTOP_MIN_WIDTH;
  const layout: Layout = { columns: wide && !compact, compact, tight };
  const nights = feedNights(feed);
  const played = nights.filter((night) => night.results > 0);
  const lastSettled = bootstrap.game.lastSettledDate;
  const ledgerComplete = bootstrap.ledger.nextCursor === null;
  // Say so when the last settled night had nothing for you at all.
  const quietLastNight = Boolean(lastSettled && played[0] && lastSettled > played[0].date
    && !nights.some((night) => night.date === lastSettled));

  const renderItem: ListRenderItem<ResultsFeedItem> = ({ item }) => {
    if (item.type === 'night') return <NightHeader layout={layout} night={item.night} />;
    if (item.type === 'fees') {
      return <FeesHeader count={item.count} layout={layout} moves={item.moves} total={item.total} />;
    }
    if (item.type === 'fee') {
      return (
        <FeeActivityRow
          entry={item.entry}
          layout={layout}
          playerName={perGamePlayerName(bootstrap, item.entry.playerId, item.entry.positionId)}
          side={item.side}
        />
      );
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
        onToggle={() => toggle(item.key)}
        playerName={perGamePlayerName(bootstrap, item.result.playerId, item.result.positionId)}
        result={item.result}
      />
    );
  };

  const header = (
    <View style={[styles.header, { paddingHorizontal: edges(layout).left }]}>
      <Text accessibilityRole="header" {...headingLevel(1)} style={styles.title}>Results</Text>
      {played.length > 0 ? (
        <Text style={styles.caption}>
          Newest night first. {layout.columns ? 'Click' : 'Tap'} a player to see the math.
        </Text>
      ) : null}
      {quietLastNight && lastSettled ? (
        <Text style={styles.note}>None of your players had a game on {humanDay(lastSettled)}.</Text>
      ) : null}
    </View>
  );
  const empty = (
    <EmptyState
      copy="Each night your players have games, the results land here, newest night first."
      level={2}
      style={styles.empty}
      title="No results yet"
    />
  );

  return (
    <FlatList
      contentContainerStyle={[styles.content, wide && styles.contentWide]}
      data={feed}
      extraData={expanded}
      initialNumToRender={16}
      keyExtractor={(item) => item.key}
      ListEmptyComponent={empty}
      ListHeaderComponent={(
        <>
          {header}
          {played.length === 0 && feed.length > 0 ? empty : null}
        </>
      )}
      maxToRenderPerBatch={16}
      renderItem={renderItem}
      style={styles.list}
      windowSize={9}
    />
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
  contentWide: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: FEED_MAX_WIDTH,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  header: {
    paddingTop: space.lg,
    paddingBottom: space.md,
    backgroundColor: colors.background,
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
  feesHeader: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    columnGap: space.md,
    paddingVertical: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  feesTitle: {
    ...labelStyle,
    color: colors.muted,
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
