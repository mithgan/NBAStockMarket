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
import { exactMoney, exactSignedMoney, humanDay, money, signedMoney } from '../copy/terms';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { Disclosure, DisclosureSpace, DISCLOSURE_WIDTH } from '../components/results/Disclosure';
import { NetMoney } from '../components/results/NetMoney';
import { SettlementBreakdown } from '../components/results/SettlementBreakdown';
import {
  buildResultsFeed,
  feedNights,
  movesSummaryLine,
  nightSummaryLine,
  nightTotalPending,
  resultRowModel,
  type MovesSummary,
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
import { colors, fonts, headingStyle, space, type, weight } from '../theme';
import { EmptyState, Tag } from '../ui/kit';

/** At this width the feed becomes a centred column with aligned number columns. */
const DESKTOP_MIN_WIDTH = 1024;
const FEED_MAX_WIDTH = 840;
const AVATAR = 32;
/** Collapsed height of a row's two lines, so the chevron sits level with them. */
const STACKED_LINES = 40;
/** Space between a row's headshot, its text and its chevron. */
const ROW_GAP = space.md;
/** Row padding on the right edge, before the chevron. */
const ROW_END = space.md;

type Layout = {
  /** Paid and price in their own aligned columns (desktop). */
  columns: boolean;
  /** Large text: the name takes its own line and the net drops below it. */
  compact: boolean;
};

// ---------------------------------------------------------------------------
// Copy for one result. Every status keeps a visible, honest line.

function resultPhrase(result: PerGameSettledResult): string {
  if (result.status === 'verified_dnp') return "Didn't play — no charge";
  if (result.status === 'unsettled_missing_projection') return 'Unsettled · his pregame projection is missing';
  if (result.status !== 'settled') return 'Unsettled · waiting on stats';
  if (result.dividendDollars === null || result.netPnl === null) return 'Result incomplete · waiting on stats';
  return `Paid ${money(result.dividendDollars)} · price ${money(result.lockedGameCost)}`;
}

/** "CORRECTION" for the first correction, "CORRECTION 2" for the next. */
function correctionTag(correctionNumber: number): string {
  return correctionNumber > 1 ? `CORRECTION ${correctionNumber}` : 'CORRECTION';
}

/** Exact signed dollars for screen readers; exactly nothing is "$0", as on screen. */
function netWords(value: number): string {
  return Math.round(value) === 0 ? exactMoney(0) : exactSignedMoney(value);
}

function resultLabel(name: string, result: PerGameSettledResult, model: ResultRowModel): string {
  const parts = [name];
  if (result.side === 'short') parts.push('short');
  if (model.correctionNumber > 0) parts.push(correctionTag(model.correctionNumber).toLowerCase());
  parts.push(model.net === null ? 'Net profit and loss unavailable' : netWords(model.net));
  if (model.math && result.dividendDollars !== null) {
    parts.push(`paid ${exactMoney(result.dividendDollars)} against a ${exactMoney(result.lockedGameCost)} price`);
  } else {
    parts.push(resultPhrase(result).replace(' · ', ', ').replace(' — ', ', '));
  }
  return `${parts.join(', ')}.`;
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
  const { columns, compact } = layout;
  const model = resultRowModel(result, equation);
  const { math } = model;
  // Desktop puts what he paid and his price in aligned columns; a row with no
  // settled arithmetic keeps its status sentence instead.
  const priceColumns = columns && math !== null && result.dividendDollars !== null;
  const label = resultLabel(playerName, result, model);

  const body = (
    <>
      <PlayerAvatar player={{ id: result.playerId, name: playerName }} size={AVATAR} />
      <View style={styles.rowBody}>
        <View style={[styles.rowHeader, columns && styles.rowHeaderColumns, compact && styles.rowHeaderCompact]}>
          <View style={[styles.identity, compact && styles.identityCompact]}>
            <Text style={styles.playerName}>{playerName}</Text>
            {result.side === 'short' ? <Tag>Short</Tag> : null}
            {model.correctionNumber > 0 ? <Tag tone="cyan">{correctionTag(model.correctionNumber)}</Tag> : null}
          </View>
          {priceColumns && result.dividendDollars !== null ? (
            <>
              <Text style={styles.cell}>
                <Text style={styles.cellLabel}>paid </Text>
                {money(result.dividendDollars)}
              </Text>
              <Text style={styles.cell}>
                <Text style={styles.cellLabel}>price </Text>
                {money(result.lockedGameCost)}
              </Text>
            </>
          ) : null}
          <View style={[styles.netCell, compact && styles.netCellCompact]}>
            {model.net === null ? (
              <Text accessibilityLabel="Net profit and loss unavailable" style={styles.netUnavailable}>—</Text>
            ) : (
              <NetMoney value={model.net} />
            )}
          </View>
        </View>
        {priceColumns ? null : <Text style={styles.detail}>{resultPhrase(result)}</Text>}
        {model.adjustment !== undefined ? (
          <Text style={styles.adjustment}>
            {model.adjustment === null
              ? 'Adjustment amount unavailable.'
              : `P&L adjustment ${signedMoney(model.adjustment)}.`}
          </Text>
        ) : null}
        {model.mismatch ? (
          <Text accessibilityRole="alert" style={styles.reconcileError}>
            This result does not reconcile. Refresh before relying on it.
          </Text>
        ) : null}
      </View>
      {math ? (
        <Disclosure height={columns ? AVATAR : STACKED_LINES} open={expanded} />
      ) : <DisclosureSpace />}
    </>
  );

  // Only a settled game has arithmetic to open; the rest are plain rows.
  if (!math) {
    return (
      <View
        accessibilityLabel={label}
        accessible
        style={[styles.row, styles.rowLine, columns && styles.rowColumns]}
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
        style={({ pressed }) => [styles.row, columns && styles.rowColumns, pressed && styles.rowOpen]}
      >
        {body}
      </Pressable>
      {expanded ? (
        <View style={styles.breakdown}>
          <SettlementBreakdown
            firstAmount={math.firstAmount}
            firstLabel={math.firstLabel}
            netPnl={math.net}
            secondAmount={math.secondAmount}
            secondLabel={math.secondLabel}
            side={result.side}
            wide={columns}
          />
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
  const { columns, compact } = layout;
  return (
    <View
      accessibilityLabel={`${feeTitle(entry)} for ${playerName}. ${feeExplanation(entry, side)}. Score change ${exactSignedMoney(entry.amountDollars)}.`}
      accessible
      style={[styles.row, styles.rowLine, columns && styles.rowColumns]}
    >
      <PlayerAvatar player={{ id: entry.playerId, name: playerName }} size={AVATAR} />
      <View style={styles.rowBody}>
        <View style={[styles.rowHeader, columns && styles.rowHeaderColumns, compact && styles.rowHeaderCompact]}>
          <View style={[styles.identity, compact && styles.identityCompact]}>
            <Text style={styles.playerName}>{playerName}</Text>
            <Tag>{feeTitle(entry)}</Tag>
          </View>
          <View style={[styles.netCell, compact && styles.netCellCompact]}>
            <NetMoney value={entry.amountDollars} />
          </View>
        </View>
        <Text style={styles.detail}>{feeExplanation(entry, side)}</Text>
      </View>
      <DisclosureSpace />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Group headers

function NightHeader({ night, layout }: { night: NightSummary; layout: Layout }) {
  const summary = nightSummaryLine(night);
  const pending = nightTotalPending(night);
  const totalWords = pending ? 'Night total not settled yet' : `Night total ${netWords(night.total)}`;
  return (
    <View
      accessibilityLabel={`${humanDay(night.date)}. ${totalWords}.${summary ? ` ${summary}.` : ''}`}
      accessibilityRole="header"
      accessible
      style={[styles.groupHeader, layout.columns && styles.groupHeaderColumns]}
    >
      <View style={[styles.groupCopy, layout.compact && styles.groupCopyCompact]}>
        <Text style={styles.groupTitle}>{humanDay(night.date)}</Text>
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

function MovesHeader({ moves, layout }: { moves: MovesSummary; layout: Layout }) {
  const summary = movesSummaryLine(moves);
  return (
    <View
      accessibilityLabel={`Roster moves. ${summary}. ${exactSignedMoney(moves.total)} in fees.`}
      accessibilityRole="header"
      accessible
      style={[styles.groupHeader, layout.columns && styles.groupHeaderColumns]}
    >
      <View style={[styles.groupCopy, layout.compact && styles.groupCopyCompact]}>
        <Text style={styles.groupTitle}>Roster moves</Text>
        <Text style={styles.groupSummary}>{summary}</Text>
      </View>
      <View style={[styles.groupTotal, layout.compact && styles.netCellCompact]}>
        <NetMoney size="title" value={moves.total} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------

export function PerGameResultsScreen() {
  const { bootstrap } = usePerGame();
  const { fontScale, width } = useWindowDimensions();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const feed = useMemo(
    () => (bootstrap ? buildResultsFeed(bootstrap, { nextGameDate: bootstrap.game.nextGameDate }) : []),
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

  const compact = fontScale > 1.2;
  const wide = width >= DESKTOP_MIN_WIDTH;
  const layout: Layout = { columns: wide && !compact, compact };
  const nights = feedNights(feed);
  const newest = nights[0]?.date ?? null;
  const lastSettled = bootstrap.game.lastSettledDate;
  const ledgerComplete = bootstrap.ledger.nextCursor === null;

  const renderItem: ListRenderItem<ResultsFeedItem> = ({ item }) => {
    if (item.type === 'night') return <NightHeader layout={layout} night={item.night} />;
    if (item.type === 'moves') return <MovesHeader layout={layout} moves={item.moves} />;
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
    <View style={styles.header}>
      <Text accessibilityRole="header" style={styles.title}>Results</Text>
      {nights.length > 0 ? (
        <Text style={styles.caption}>
          Newest night first. {layout.columns ? 'Click' : 'Tap'} a player to see the math.
        </Text>
      ) : null}
      {newest && lastSettled && lastSettled > newest ? (
        <Text style={styles.note}>None of your players had a game on {humanDay(lastSettled)}.</Text>
      ) : null}
    </View>
  );
  const empty = (
    <EmptyState
      copy="Each night your players have games, the results land here, newest night first."
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
          {nights.length === 0 && feed.length > 0 ? empty : null}
        </>
      )}
      maxToRenderPerBatch={16}
      renderItem={renderItem}
      style={styles.list}
      windowSize={9}
    />
  );
}

/**
 * Right inset of every number: the row's end padding, the chevron's column and
 * the gap before it. Group headers use it so a night's total sits exactly in
 * the column of its players' nets.
 */
const NUMBER_INSET = ROW_END + DISCLOSURE_WIDTH + ROW_GAP;

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  content: {
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
    paddingHorizontal: space.lg,
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
    paddingLeft: space.lg,
    paddingRight: NUMBER_INSET,
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
  },
  groupTotal: {
    marginLeft: 'auto',
    alignItems: 'flex-end',
  },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: ROW_GAP,
    paddingLeft: space.lg,
    paddingRight: ROW_END,
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
  // Under the row's text column, its numbers flush with the row's net.
  breakdown: {
    paddingLeft: space.lg + AVATAR + ROW_GAP,
    paddingRight: NUMBER_INSET,
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
    width: 104,
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
  netCellCompact: {
    minWidth: 0,
    flexBasis: '100%',
    alignItems: 'flex-start',
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
