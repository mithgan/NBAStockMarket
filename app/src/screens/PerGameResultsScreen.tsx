import { FlatList, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import type { PerGameLedgerEntry, PerGameSettledResult } from '../api/contracts';
import { formatCompactMoney, formatCompactSignedMoney, formatMoney, formatSignedMoney } from '../format';
import { usePerGame } from '../state/PerGameContext';
import { PlayerAvatar } from '../components/PlayerAvatar';
import {
  buildPerGameActivity,
  perGamePlayerName,
  settlementEquation,
} from '../state/perGameState';
import { colors, fonts, headingStyle, labelStyle, space, type, weight } from '../theme';

function dateLabel(value: string): string {
  const date = value.includes('T') ? value.slice(0, 10) : value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

function ResultRow({ compact, result, playerName }: {
  compact: boolean;
  result: PerGameSettledResult;
  playerName: string;
}) {
  const { bootstrap } = usePerGame();
  const equation = settlementEquation(
    result,
    bootstrap?.ledger.items,
    bootstrap?.settledResults,
  );
  const gameCost = result.lockedGameCost;
  const positive = equation.netPnl !== null && equation.netPnl >= 0;
  const arithmetic = (
    result.status === 'settled'
    && equation.firstAmount !== null
    && equation.secondAmount !== null
    && equation.netPnl !== null
  ) ? {
      firstAmount: equation.firstAmount,
      secondAmount: equation.secondAmount,
      netPnl: equation.netPnl,
    } : null;

  return (
    <View style={styles.row}>
      <PlayerAvatar player={{ id: result.playerId, name: playerName }} size={28} />
      <View style={styles.rowBody}>
      <View style={[styles.rowHeader, compact && styles.rowHeaderCompact]}>
        <View style={[styles.identity, compact && styles.identityCompact]}>
          <Text style={styles.playerName}>{playerName}</Text>
          <Text style={styles.meta}>
            {dateLabel(result.gameDate)} · {result.side === 'long' ? 'ROSTER' : 'INVERSE'} · REV {result.resultRevision}
          </Text>
        </View>
        <View style={[styles.statusLine, compact && styles.statusLineCompact]}>
          {result.kind === 'correction' ? (
            <Text style={styles.correction}>CORRECTION</Text>
          ) : null}
          {equation.netPnl === null ? (
            <Text accessibilityLabel="Net profit and loss unavailable" style={styles.netUnavailable}>—</Text>
          ) : (
            <Text
              accessibilityLabel={`Net profit and loss ${formatSignedMoney(equation.netPnl)}`}
              style={[styles.net, positive ? styles.positive : styles.negative]}
            >
              {formatCompactSignedMoney(equation.netPnl)}
            </Text>
          )}
        </View>
      </View>
      {result.status === 'unsettled_missing_projection' ? (
        <Text style={styles.unsettled}>UNSETTLED · missing saved pregame projection</Text>
      ) : result.status !== 'settled' ? (
        <Text style={styles.unsettled}>UNSETTLED · waiting for a valid result input</Text>
      ) : null}
      {equation.correction && arithmetic ? (
        <Text style={styles.adjustment}>
          {equation.correctionAdjustment === null
            ? 'P&L adjustment recorded.'
            : `P&L adjustment ${formatCompactSignedMoney(equation.correctionAdjustment)}.`}{' '}
          The locked game cost was not charged again ({formatCompactMoney(gameCost)}).
        </Text>
      ) : null}
      {arithmetic ? (
        <Text
          accessibilityLabel={`${equation.firstLabel} ${formatMoney(arithmetic.firstAmount)} minus ${equation.secondLabel} ${formatMoney(arithmetic.secondAmount)} equals ${formatSignedMoney(arithmetic.netPnl)}`}
          style={styles.equation}
        >
          {equation.firstLabel} {formatMoney(arithmetic.firstAmount)} - {' '}
          {equation.secondLabel} {formatMoney(arithmetic.secondAmount)} = {' '}
          <Text style={positive ? styles.positive : styles.negative}>
            {formatSignedMoney(arithmetic.netPnl)}
          </Text>
        </Text>
      ) : null}
      {equation.reconciles === false ? (
        <Text accessibilityRole="alert" style={styles.reconcileError}>
          This result does not reconcile. Refresh before relying on it.
        </Text>
      ) : null}
      </View>
    </View>
  );
}

function feeTitle(entry: PerGameLedgerEntry): string {
  if (entry.kind === 'open_fee') return 'OPEN FEE';
  if (entry.kind === 'drop_fee') return 'DROP FEE';
  if (entry.kind === 'penalty') return 'PENALTY';
  return 'ACCOUNT FEE';
}

function feeExplanation(entry: PerGameLedgerEntry, playerName: string): string {
  const amount = formatCompactSignedMoney(entry.amountDollars);
  if (entry.kind === 'open_fee') {
    return `${playerName}'s position was opened. Score change ${amount}.`;
  }
  if (entry.kind === 'drop_fee') {
    return `${playerName}'s position was closed. Score change ${amount}.`;
  }
  if (entry.kind === 'penalty') {
    return `${playerName} generated a rules penalty. Score change ${amount}.`;
  }
  return `${playerName} generated an account fee. Score change ${amount}.`;
}

function FeeActivityRow({ compact, entry, playerName }: {
  compact: boolean;
  entry: PerGameLedgerEntry;
  playerName: string;
}) {
  const positive = entry.amountDollars >= 0;
  return (
    <View
      accessibilityLabel={`${feeTitle(entry)} for ${playerName}. Score change ${formatSignedMoney(entry.amountDollars)}.`}
      accessible
      style={styles.row}
    >
      <PlayerAvatar player={{ id: entry.playerId, name: playerName }} size={28} />
      <View style={styles.rowBody}>
      <View style={[styles.rowHeader, compact && styles.rowHeaderCompact]}>
        <View style={[styles.identity, compact && styles.identityCompact]}>
          <Text style={styles.playerName}>{playerName}</Text>
          <Text style={styles.meta}>{dateLabel(entry.gameDate ?? entry.createdAt)} · ACCOUNT ACTIVITY</Text>
        </View>
        <View style={[styles.statusLine, compact && styles.statusLineCompact]}>
          <Text style={styles.feeTag}>{feeTitle(entry)}</Text>
          <Text style={[styles.net, positive ? styles.positive : styles.negative]}>
            {formatCompactSignedMoney(entry.amountDollars)}
          </Text>
        </View>
      </View>
      <Text style={styles.feeExplanation}>{feeExplanation(entry, playerName)}</Text>
      </View>
    </View>
  );
}

export function PerGameResultsScreen() {
  const { bootstrap } = usePerGame();
  const { fontScale, width } = useWindowDimensions();
  if (!bootstrap) return null;
  const compact = width < 560 || fontScale > 1.2;
  const activity = buildPerGameActivity(bootstrap);

  return (
    <FlatList
      contentContainerStyle={styles.content}
      data={activity}
      initialNumToRender={12}
      keyExtractor={(item) => item.key}
      ListEmptyComponent={(
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No games settled yet</Text>
          <Text style={styles.emptyCopy}>Your roster results will appear after completed games are processed.</Text>
        </View>
      )}
      ListHeaderComponent={(
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>Results</Text>
        </View>
      )}
      maxToRenderPerBatch={12}
      renderItem={({ item }) => item.type === 'result' ? (
        <ResultRow
          compact={compact}
          playerName={perGamePlayerName(
            bootstrap,
            item.result.playerId,
            item.result.positionId,
          )}
          result={item.result}
        />
      ) : (
        <FeeActivityRow
          compact={compact}
          entry={item.entry}
          playerName={perGamePlayerName(
            bootstrap,
            item.entry.playerId,
            item.entry.positionId,
          )}
        />
      )}
      style={styles.list}
      windowSize={7}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  content: {
    paddingBottom: 110,
  },
  header: {
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
  },
  title: {
    ...headingStyle,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  rowBody: {
    minWidth: 0,
    flex: 1,
  },
  rowHeader: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space.md,
  },
  rowHeaderCompact: {
    flexWrap: 'wrap',
  },
  identity: {
    minWidth: 0,
    flex: 1,
  },
  identityCompact: {
    flexBasis: '100%',
  },
  playerName: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
  },
  meta: {
    marginTop: 4,
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: 11,
    fontWeight: weight.bold,
    lineHeight: 17,
  },
  statusLine: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: space.sm,
  },
  statusLineCompact: {
    flexBasis: '100%',
    justifyContent: 'flex-start',
  },
  correction: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    color: colors.cyan,
    backgroundColor: colors.cyanSoft,
    fontFamily: fonts.display,
    fontSize: 11,
    fontWeight: weight.heavy,
  },
  feeTag: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    color: colors.goldInk,
    backgroundColor: colors.goldSoft,
    fontFamily: fonts.display,
    fontSize: 11,
    fontWeight: weight.heavy,
  },
  net: {
    flexShrink: 1,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
    fontVariant: ['tabular-nums'],
  },
  netUnavailable: {
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
  },
  adjustment: {
    marginTop: space.md,
    color: colors.cyan,
    fontSize: type.body,
    lineHeight: 20,
  },
  equation: {
    marginTop: space.md,
    color: colors.muted,
    fontSize: type.body,
    lineHeight: 20,
    fontVariant: ['tabular-nums'],
  },
  feeExplanation: {
    marginTop: space.md,
    color: colors.muted,
    fontSize: type.body,
    lineHeight: 20,
  },
  unsettled: {
    ...labelStyle,
    marginTop: space.md,
    color: colors.goldInk,
  },
  reconcileError: {
    marginTop: space.sm,
    color: colors.red,
    fontSize: 11,
  },
  empty: {
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
  emptyTitle: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.title,
    fontWeight: weight.heavy,
  },
  emptyCopy: {
    maxWidth: 420,
    marginTop: space.sm,
    color: colors.muted,
    fontSize: type.body,
    lineHeight: 20,
    textAlign: 'center',
  },
  positive: {
    color: colors.green,
  },
  negative: {
    color: colors.red,
  },
});
