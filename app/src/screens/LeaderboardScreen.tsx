import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import {
  formatCompactMoney,
  formatCompactSignedMoney,
  formatMoney,
  formatSignedMoney,
} from '../format';
import { rankBand } from '../data/rankBand';
import { usePortfolio } from '../state/PortfolioContext';
import { DisplayValue, SectionHeader, Tag } from '../ui/primitives';
import { colors, fonts, labelStyle, numeric, radius, space, type, weight } from '../theme';

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
  // The gap bars place each portfolio on the field between the page's low and
  // high, so the distance between neighbours reads without parsing numbers.
  const values = leaderboard.map((entry) => entry.value);
  const high = values.length ? Math.max(...values) : 1;
  const low = values.length ? Math.min(...values) : 0;
  const spread = high - low;
  const dayPositive = summary.latestDailyChange >= 0;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      {/* Your standing is the reason to open this screen, so it leads. */}
      <View style={styles.hero}>
        <Text accessibilityRole="header" style={styles.heroLabel}>YOUR RANK</Text>
        {you ? (
          <>
            <DisplayValue
              accessibilityLabel={`Your rank, ${you.rank} of ${leaderboard.length}, ${rankBand(you.rank, leaderboard.length)}. Portfolio ${formatMoney(you.value)}, ${formatReturn(you.returnPct)} from 140 million. ${formatSignedMoney(summary.latestDailyChange)} on the latest replay date.`}
              label={`OF ${leaderboard.length}`}
              tone="gold"
              value={`#${you.rank}`}
            />
            <View style={styles.heroMeta}>
              <Tag label={rankBand(you.rank, leaderboard.length).toUpperCase()} tone="gold" />
              <Text style={styles.heroValue}>{formatCompactMoney(you.value)}</Text>
              <Tag label={`${formatReturn(you.returnPct)} FROM $140M`} tone={you.returnPct >= 0 ? 'up' : 'down'} />
              <Tag label={`${formatCompactSignedMoney(summary.latestDailyChange)} LAST DAY`} tone={dayPositive ? 'up' : 'down'} />
            </View>
          </>
        ) : leaderboard.length > 0 ? (
          // Ranked below the returned page: say so instead of showing nothing.
          <>
            <DisplayValue
              accessibilityLabel={`You are outside the top ${leaderboard.length}. Your portfolio is ${formatMoney(summary.totalValue)}, ${formatSignedMoney(summary.latestDailyChange)} on the latest replay date.`}
              label={`OUTSIDE TOP ${leaderboard.length}`}
              size={26}
              value="UNRANKED"
            />
            <View style={styles.heroMeta}>
              <Text style={styles.heroValue}>{formatCompactMoney(summary.totalValue)}</Text>
              <Tag label={`${formatCompactSignedMoney(summary.latestDailyChange)} LAST DAY`} tone={dayPositive ? 'up' : 'down'} />
            </View>
          </>
        ) : (
          <Text style={styles.subtle}>No ranked portfolios are available yet.</Text>
        )}
      </View>

      {leaderboard.length === 0 ? null : (
        <>
          <SectionHeader label="STANDINGS" meta={`TOP ${leaderboard.length}`} />
          <View style={styles.table}>
            <View style={styles.columnHeader}>
              <Text style={[styles.columnHeaderText, largeText ? styles.flexColumn : styles.rankColumn]}>#</Text>
              <Text style={[styles.columnHeaderText, styles.nameColumn]}>PORTFOLIO</Text>
              <Text style={[styles.columnHeaderText, largeText ? styles.flexColumn : styles.valueColumn]}>VALUE</Text>
              {/* The baseline is named: every return reads against the $140M
                  opening bankroll, not against an unstated zero. */}
              <Text style={[styles.columnHeaderText, largeText ? styles.flexColumn : styles.returnColumn]}>VS $140M</Text>
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
                {entry.isUser ? <View style={styles.youAccent} /> : null}
                <Text
                  maxFontSizeMultiplier={1.6}
                  style={[styles.rank, largeText ? styles.flexColumn : styles.rankColumn, entry.isUser && styles.you]}
                >
                  {String(entry.rank).padStart(2, '0')}
                </Text>
                <View style={styles.nameColumn}>
                  <Text numberOfLines={1} style={[styles.name, entry.isUser && styles.you]}>
                    {entry.name}
                  </Text>
                  <View style={styles.gapTrack}>
                    <View
                      style={[
                        styles.gapFill,
                        entry.isUser && styles.gapFillYou,
                        { width: `${Math.max(4, Math.round(100 * (spread <= 0 ? 1 : (entry.value - low) / spread)))}%` },
                      ]}
                    />
                  </View>
                </View>
                <Text
                  maxFontSizeMultiplier={1.6}
                  numberOfLines={1}
                  style={[styles.value, largeText ? styles.flexColumn : styles.valueColumn]}
                >
                  {formatCompactMoney(entry.value)}
                </Text>
                <Text
                  maxFontSizeMultiplier={1.6}
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
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { flexGrow: 1, paddingBottom: space.xxl },

  hero: {
    paddingHorizontal: space.md,
    paddingTop: space.lg,
    paddingBottom: space.md,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  heroLabel: { ...labelStyle, color: colors.goldInk, marginBottom: space.xs },
  heroMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  heroValue: { ...numeric, color: colors.text, fontSize: type.title, fontWeight: weight.black },
  subtle: { color: colors.muted, fontFamily: fonts.body, fontSize: type.label, lineHeight: 17 },

  table: { borderTopColor: colors.border, borderTopWidth: 1 },
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  columnHeaderText: { ...labelStyle, letterSpacing: 0.7 },

  row: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  rowWrapped: { flexWrap: 'wrap' },
  lastRow: { borderBottomWidth: 0 },
  youRow: { backgroundColor: colors.goldSoft },
  gapTrack: {
    height: 3,
    marginTop: 5,
    marginRight: space.md,
    borderRadius: radius.xs,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  gapFill: { height: 3, borderRadius: radius.xs, backgroundColor: colors.borderStrong },
  gapFillYou: { backgroundColor: colors.gold },
  youAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, backgroundColor: colors.gold },

  rankColumn: { width: 24, flexShrink: 0 },
  nameColumn: { flex: 1, minWidth: 0 },
  valueColumn: { width: 72, textAlign: 'right', flexShrink: 0 },
  // Wide enough for a three-digit swing like +227.05% without truncating.
  returnColumn: { width: 76, textAlign: 'right', flexShrink: 0 },
  flexColumn: { flexShrink: 0, textAlign: 'right' },

  rank: { ...numeric, color: colors.muted, fontSize: type.title, fontWeight: weight.black },
  name: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.heavy,
  },
  you: { color: colors.goldInk },
  value: { ...numeric, color: colors.muted, fontSize: type.body, fontWeight: weight.bold },
  returnValue: { ...numeric, fontSize: type.body, fontWeight: weight.black },
  positive: { color: colors.green },
  negative: { color: colors.red },
});
