import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import {
  formatCompactMoney,
  formatCompactSignedMoney,
  formatMoney,
  formatSignedMoney,
} from '../format';
import { usePortfolio } from '../state/PortfolioContext';
import { colors, radius, space, type } from '../theme';

function formatReturn(returnPct: number): string {
  return `${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(2)}%`;
}

export function LeaderboardScreen() {
  const { leaderboard, summary } = usePortfolio();
  const { fontScale } = useWindowDimensions();
  // Fixed numeric columns align beautifully at normal text size but truncate
  // once type is enlarged, so above this point the cells size to content and
  // the name yields the space instead.
  const largeText = fontScale > 1.3;
  if (!summary) return null;
  const you = leaderboard.find((entry) => entry.isUser) ?? null;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <View style={styles.headingRow}>
        <Text accessibilityRole="header" style={styles.title}>Leaderboard</Text>
        {/* The server returns only the top slice, so this is a page size, not a
            league size — label it as such rather than implying full standings. */}
        <Text style={styles.subtle}>Top {leaderboard.length}</Text>
      </View>

      {you ? (
        <View
          accessible
          accessibilityLabel={`Your rank, ${you.rank}. Portfolio ${formatMoney(you.value)}, ${formatReturn(you.returnPct)} from 140 million. ${formatSignedMoney(summary.latestDailyChange)} on the latest replay date.`}
          style={styles.yourRow}
        >
          <View style={styles.yourRank}>
            <Text style={styles.yourRankLabel}>YOUR RANK</Text>
            <Text style={styles.yourRankValue}>#{you.rank}</Text>
          </View>
          <View style={styles.yourNumbers}>
            <Text numberOfLines={1} style={styles.yourValue}>{formatCompactMoney(you.value)}</Text>
            <Text numberOfLines={1} style={[styles.yourReturn, you.returnPct >= 0 ? styles.positive : styles.negative]}>
              {formatReturn(you.returnPct)} from $140M
            </Text>
          </View>
          <View style={styles.yourNumbers}>
            <Text style={styles.yourDayLabel}>LAST DAY</Text>
            <Text
              numberOfLines={1}
              style={[styles.yourDay, summary.latestDailyChange >= 0 ? styles.positive : styles.negative]}
            >
              {formatCompactSignedMoney(summary.latestDailyChange)}
            </Text>
          </View>
        </View>
      ) : leaderboard.length > 0 ? (
        // Ranked below the returned page: say so instead of silently showing nothing.
        <View
          accessible
          accessibilityLabel={`You are outside the top ${leaderboard.length}. Your portfolio is ${formatMoney(summary.totalValue)}, ${formatSignedMoney(summary.latestDailyChange)} on the latest replay date.`}
          style={styles.yourRow}
        >
          <View style={styles.yourRank}>
            <Text style={styles.yourRankLabel}>YOUR RANK</Text>
            <Text numberOfLines={1} style={styles.yourRankOutside}>Outside top {leaderboard.length}</Text>
          </View>
          <View style={styles.yourNumbers}>
            <Text numberOfLines={1} style={styles.yourValue}>{formatCompactMoney(summary.totalValue)}</Text>
            <Text
              numberOfLines={1}
              style={[styles.yourReturn, summary.latestDailyChange >= 0 ? styles.positive : styles.negative]}
            >
              {formatCompactSignedMoney(summary.latestDailyChange)} last day
            </Text>
          </View>
        </View>
      ) : null}

      {leaderboard.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.subtle}>No ranked portfolios are available yet.</Text>
        </View>
      ) : (
        <View style={styles.table}>
          <View style={styles.columnHeader}>
            <Text style={[styles.columnHeaderText, largeText ? styles.flexColumn : styles.rankColumn]}>#</Text>
            <Text style={[styles.columnHeaderText, styles.nameColumn]}>PORTFOLIO</Text>
            <Text style={[styles.columnHeaderText, largeText ? styles.flexColumn : styles.valueColumn]}>VALUE</Text>
            <Text style={[styles.columnHeaderText, largeText ? styles.flexColumn : styles.returnColumn]}>RETURN</Text>
          </View>
          {leaderboard.map((entry, index) => (
            <View
              accessible
              accessibilityLabel={`Rank ${entry.rank}, ${entry.isUser ? 'you' : entry.name}, ${formatMoney(entry.value)}, ${formatReturn(entry.returnPct)}`}
              key={entry.id}
              style={[
                styles.row,
                largeText && styles.rowWrapped,
                index === leaderboard.length - 1 && styles.lastRow,
                entry.isUser && styles.youRow,
              ]}
            >
              <Text style={[styles.rank, largeText ? styles.flexColumn : styles.rankColumn, entry.isUser && styles.you]}>
                {String(entry.rank).padStart(2, '0')}
              </Text>
              <Text numberOfLines={1} style={[styles.name, styles.nameColumn, entry.isUser && styles.you]}>
                {entry.name}
              </Text>
              <Text numberOfLines={1} style={[styles.value, largeText ? styles.flexColumn : styles.valueColumn]}>
                {formatCompactMoney(entry.value)}
              </Text>
              <Text
                numberOfLines={1}
                style={[
                  styles.returnValue,
                  largeText ? styles.flexColumn : styles.returnColumn,
                  entry.returnPct >= 0 ? styles.positive : styles.negative,
                ]}
              >
                {formatReturn(entry.returnPct)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { flexGrow: 1, padding: space.md, paddingBottom: space.xl, gap: space.sm },
  headingRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.sm },
  title: { color: colors.text, fontSize: type.heading, fontWeight: '900' },
  subtle: { color: colors.muted, fontSize: type.micro, lineHeight: 17 },
  yourRow: {
    flexDirection: 'row',
    alignItems: 'center',
    // Wraps so the value and last-day groups drop onto their own line at
    // accessibility text sizes instead of squeezing the rank off the card.
    flexWrap: 'wrap',
    gap: space.md,
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.gold,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  yourRank: { flex: 1, minWidth: 110 },
  yourRankLabel: { color: colors.gold, fontSize: type.micro, fontWeight: '900', letterSpacing: 0.8 },
  yourRankValue: { color: colors.text, fontSize: 24, fontWeight: '900', fontVariant: ['tabular-nums'] },
  yourRankOutside: { color: colors.text, fontSize: type.value, fontWeight: '900' },
  yourNumbers: { alignItems: 'flex-end', flexShrink: 0 },
  yourValue: { color: colors.text, fontSize: type.value, fontWeight: '900', fontVariant: ['tabular-nums'] },
  yourReturn: { fontSize: type.micro, fontWeight: '800', marginTop: 2, fontVariant: ['tabular-nums'] },
  yourDayLabel: { color: colors.muted, fontSize: type.micro, fontWeight: '800', letterSpacing: 0.6 },
  yourDay: { fontSize: type.label, fontWeight: '900', marginTop: 2, fontVariant: ['tabular-nums'] },
  table: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  columnHeaderText: { color: colors.muted, fontSize: type.micro, fontWeight: '800', letterSpacing: 0.6 },
  emptyCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.lg,
  },
  row: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // At accessibility text sizes the numeric cells cannot all fit beside the
  // name, so the row wraps onto a second line instead of overflowing.
  rowWrapped: { flexWrap: 'wrap' },
  lastRow: { borderBottomWidth: 0 },
  youRow: { backgroundColor: colors.goldSoft },
  rankColumn: { width: 26, flexShrink: 0 },
  nameColumn: { flex: 1, minWidth: 0 },
  flexColumn: { flexShrink: 0, textAlign: 'right' },
  valueColumn: { width: 72, textAlign: 'right', flexShrink: 0 },
  // Wide enough for a three-digit swing like +227.05% without truncating.
  returnColumn: { width: 76, textAlign: 'right', flexShrink: 0 },
  rank: { color: colors.muted, fontSize: type.label, fontWeight: '900', fontVariant: ['tabular-nums'] },
  name: { color: colors.text, fontSize: type.body, fontWeight: '800' },
  you: { color: colors.gold },
  value: { color: colors.text, fontSize: type.label, fontWeight: '700', fontVariant: ['tabular-nums'] },
  returnValue: { fontSize: type.label, fontWeight: '900', fontVariant: ['tabular-nums'] },
  positive: { color: colors.green },
  negative: { color: colors.red },
});
