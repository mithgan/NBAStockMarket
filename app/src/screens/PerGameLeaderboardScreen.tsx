import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { formatCompactSignedMoney, formatSignedMoney } from '../format';
import { usePerGame } from '../state/PerGameContext';
import { colors, fonts, headingStyle, labelStyle, space, type, weight } from '../theme';

export function PerGameLeaderboardScreen() {
  const { bootstrap } = usePerGame();
  const { fontScale, width } = useWindowDimensions();
  if (!bootstrap) return null;
  // Rows wrap only for large text; a narrow phone still reads one row per line.
  const compact = fontScale > 1.2;
  const narrow = width < 520 || compact;
  const rows = [...bootstrap.leaderboard].sort((left, right) => left.rank - right.rank);
  const current = rows.find((row) => row.isCurrentUser) ?? null;

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.scroll}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>Leaders</Text>
        <Text style={styles.subtitle}>Ranked by cumulative game P&amp;L from a $0 starting score.</Text>
        {current ? (
          <View style={[styles.currentSummary, narrow && styles.currentSummaryCompact]}>
            <Text style={styles.currentLabel}>YOUR RANK</Text>
            <Text style={styles.currentRank}>#{current.rank}</Text>
            <Text
              accessibilityLabel={`Your cumulative profit and loss ${formatSignedMoney(current.cumulativePnl)}`}
              style={[
                styles.currentPnl,
                narrow && styles.currentPnlCompact,
                current.cumulativePnl >= 0 ? styles.positive : styles.negative,
              ]}
            >
              {formatCompactSignedMoney(current.cumulativePnl)}
            </Text>
          </View>
        ) : null}
      </View>
      {!narrow ? (
        <View style={styles.tableHead}>
          <Text style={styles.rankLabel}>RANK</Text>
          <Text style={styles.nameLabel}>PLAYER</Text>
          <Text style={styles.pnlLabel}>CUMULATIVE P&amp;L</Text>
        </View>
      ) : null}
      {rows.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>The leaderboard will appear after accounts settle games.</Text>
        </View>
      ) : rows.map((row) => (
        <View
          key={row.entryId}
          style={[styles.row, compact && styles.rowCompact, row.isCurrentUser && styles.currentRow]}
        >
          <Text style={[styles.rank, compact && styles.rankCompact]}>#{row.rank}</Text>
          <Text style={[styles.name, compact && styles.nameCompact]}>
            {row.displayName}
            {row.isCurrentUser ? <Text style={styles.youTag}>{'  YOU'}</Text> : null}
          </Text>
          <Text
            accessibilityLabel={`${row.displayName}, ${formatSignedMoney(row.cumulativePnl)} cumulative profit and loss`}
            style={[
              styles.pnl,
              compact && styles.pnlCompact,
              row.cumulativePnl >= 0 ? styles.positive : styles.negative,
            ]}
          >
            {formatCompactSignedMoney(row.cumulativePnl)}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    paddingBottom: 110,
  },
  header: {
    paddingHorizontal: space.lg,
    paddingVertical: space.xl,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
  },
  title: {
    ...headingStyle,
  },
  subtitle: {
    marginTop: space.sm,
    color: colors.muted,
    fontSize: type.body,
  },
  currentSummary: {
    marginTop: space.xl,
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: space.md,
  },
  currentSummaryCompact: {
    alignItems: 'flex-start',
  },
  currentLabel: {
    ...labelStyle,
  },
  currentRank: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 28,
    fontWeight: weight.black,
    fontVariant: ['tabular-nums'],
  },
  currentPnl: {
    marginLeft: 'auto',
    fontFamily: fonts.display,
    fontSize: type.title,
    fontWeight: weight.heavy,
    fontVariant: ['tabular-nums'],
  },
  currentPnlCompact: {
    flexBasis: '100%',
    marginLeft: 0,
  },
  tableHead: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    backgroundColor: colors.surface,
  },
  rankLabel: {
    ...labelStyle,
    width: 58,
  },
  nameLabel: {
    ...labelStyle,
    flex: 1,
  },
  pnlLabel: {
    ...labelStyle,
    width: 150,
    textAlign: 'right',
  },
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  rowCompact: {
    minHeight: 88,
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: space.sm,
    paddingVertical: space.md,
  },
  // You are marked in gold ink and a gold rule, not by tinting your whole row.
  currentRow: {
    borderLeftWidth: 3,
    borderLeftColor: colors.gold,
    backgroundColor: colors.surface,
  },
  youTag: {
    color: colors.goldInk,
    fontSize: type.label,
    fontWeight: weight.heavy,
    letterSpacing: 1.1,
  },
  rank: {
    width: 58,
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
  },
  rankCompact: {
    width: 'auto',
    flexShrink: 0,
  },
  name: {
    minWidth: 0,
    flex: 1,
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.bold,
  },
  nameCompact: {
    flexBasis: '70%',
    flexGrow: 1,
  },
  pnl: {
    width: 150,
    textAlign: 'right',
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
    fontVariant: ['tabular-nums'],
  },
  pnlCompact: {
    width: '100%',
    flexBasis: '100%',
    textAlign: 'left',
  },
  empty: {
    minHeight: 240,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
  emptyText: {
    maxWidth: 360,
    color: colors.muted,
    fontSize: type.body,
    textAlign: 'center',
  },
  positive: {
    color: colors.green,
  },
  negative: {
    color: colors.red,
  },
});
