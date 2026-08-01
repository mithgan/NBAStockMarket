import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { PortfolioHistoryChart } from '../components/PortfolioHistoryChart';
import {
  formatCompactMoney,
  formatCompactSignedMoney,
  formatMoney,
  formatSignedMoney,
} from '../format';
import { usePortfolio } from '../state/PortfolioContext';
import { colors, radius, space, type } from '../theme';
import { PlayerDetail } from './MarketScreen';

function Metric({ label, value, detail, accessibilityLabel, wide }: {
  label: string;
  value: string;
  detail: string;
  accessibilityLabel: string;
  wide: boolean;
}) {
  return (
    // At enlarged text the three cards stop sharing one row: a compacted
    // $137.4M does not fit in a third of a phone and would be ellipsized.
    <View accessible accessibilityLabel={accessibilityLabel} style={[styles.metric, wide && styles.metricWide]}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.metricValue}>{value}</Text>
      <Text numberOfLines={2} style={styles.metricDetail}>{detail}</Text>
    </View>
  );
}

export function PortfolioScreen() {
  const {
    latestSettledDate,
    players,
    playerTrends,
    state,
    summary,
  } = usePortfolio();
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.3;
  if (!state || !summary) return null;
  const playerById = new Map(players.map((player) => [player.id, player]));
  const selectedPlayer = selectedPlayerId ? playerById.get(selectedPlayerId) ?? null : null;
  const latestPoint = state.portfolioHistory.at(-1) ?? null;
  const recentActivity = [...state.activity].reverse().slice(0, 10);
  const dailyPositive = summary.latestDailyChange >= 0;

  if (selectedPlayer) {
    return (
      <PlayerDetail
        backLabel="Portfolio"
        currentPrice={state.prices[selectedPlayer.id] ?? selectedPlayer.listing_price}
        latestSettledDate={latestSettledDate}
        onClose={() => setSelectedPlayerId(null)}
        player={selectedPlayer}
        trendPoints={playerTrends[selectedPlayer.id] ?? []}
      />
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <View style={styles.summaryBlock}>
        <Text accessibilityRole="header" style={styles.eyebrow}>PORTFOLIO VALUE</Text>
        <Text
          accessibilityLabel={`Portfolio value ${formatMoney(summary.totalValue)}`}
          numberOfLines={1}
          style={styles.total}
        >
          {formatCompactMoney(summary.totalValue)}
        </Text>
        <Text
          accessibilityLabel={`${formatSignedMoney(summary.latestDailyChange)} on the latest replay date${latestPoint ? `, ${latestPoint.date}` : ''}`}
          style={[styles.dailyChange, dailyPositive ? styles.positive : styles.negative]}
        >
          {formatCompactSignedMoney(summary.latestDailyChange)}
          <Text style={styles.dailyChangeContext}>
            {latestPoint ? `  latest replay date · ${latestPoint.date}` : '  latest replay date'}
          </Text>
        </Text>
        {/* Explains the figure directly above it — the one-day number — rather
            than the multi-date chart further down. */}
        <Text style={styles.subtle}>
          {latestPoint
            ? 'Total portfolio-value change for that date, including cash payouts and player-price movement.'
            : 'No server settlement has reached this account yet.'}
        </Text>
      </View>

      <View style={styles.metricRow}>
        <Metric
          accessibilityLabel={`Free cash ${formatMoney(summary.freeCash)}, available to spend`}
          detail="To spend"
          label="FREE CASH"
          wide={largeText}
          value={formatCompactMoney(summary.freeCash)}
        />
        <Metric
          accessibilityLabel={`Holdings ${formatMoney(summary.marketValue)}, ${summary.holdings.length} of ${players.length} listed players`}
          detail={`${summary.holdings.length} of ${players.length}`}
          label="HOLDINGS"
          wide={largeText}
          value={formatCompactMoney(summary.marketValue)}
        />
        <Metric
          accessibilityLabel={`Reserved ${formatMoney(summary.reservedCollateral)}, short collateral held from your ${formatMoney(summary.cash)} cash balance`}
          detail="Collateral"
          label="RESERVED"
          wide={largeText}
          value={formatCompactMoney(summary.reservedCollateral)}
        />
      </View>

      <View style={styles.sectionHeading}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>Portfolio history</Text>
        <Text style={styles.badge}>LAST 30 DATES</Text>
      </View>
      <PortfolioHistoryChart points={state.portfolioHistory} />
      <Text style={styles.subtle}>
        Total value across the settled dates shown, not a single day.
      </Text>

      <Text accessibilityRole="header" style={styles.sectionTitle}>Your roster</Text>
      {state.holdings.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Your cap sheet is clean.</Text>
          <Text style={styles.subtle}>Open Market to buy one whole-player share. Fees are included at checkout.</Text>
        </View>
      ) : (
        <View style={styles.listCard}>
          {summary.holdings.map((holding, index) => {
            const player = playerById.get(holding.player_id);
            if (!player) return null;
            const gain = holding.unrealizedPnl >= 0;
            return (
              <Pressable
                accessibilityLabel={`View ${player.name} details. Now ${formatMoney(holding.currentPrice)}, cost ${formatMoney(holding.costBasis)} including fee, ${gain ? 'up' : 'down'} ${formatMoney(Math.abs(holding.unrealizedPnl))}`}
                accessibilityRole="button"
                key={holding.player_id}
                onPress={() => setSelectedPlayerId(player.id)}
                style={({ pressed }) => [
                  styles.row,
                  index === summary.holdings.length - 1 && styles.lastRow,
                  pressed && styles.rowPressed,
                ]}
              >
                <View style={styles.rowCopy}>
                  <Text numberOfLines={1} style={styles.rowName}>{player.name}</Text>
                  <Text numberOfLines={1} style={styles.rowMeta}>
                    Cost {formatCompactMoney(holding.costBasis)} incl. fee
                  </Text>
                </View>
                <View style={styles.rowNumbers}>
                  <Text numberOfLines={1} style={styles.rowValue}>{formatCompactMoney(holding.currentPrice)}</Text>
                  <Text numberOfLines={1} style={[styles.rowPnl, gain ? styles.positive : styles.negative]}>
                    {formatCompactSignedMoney(holding.unrealizedPnl)}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      <Text accessibilityRole="header" style={styles.sectionTitle}>Activity</Text>
      {recentActivity.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.subtle}>Trades and settlements will appear here.</Text>
        </View>
      ) : (
        <View style={styles.listCard}>
          {recentActivity.map((item, index) => (
            <View
              key={item.id}
              style={[styles.activityRow, index === recentActivity.length - 1 && styles.lastRow]}
            >
              <View style={styles.rowCopy}>
                <Text numberOfLines={1} style={styles.rowName}>{item.message}</Text>
                <Text numberOfLines={1} style={styles.rowMeta}>{item.date ?? 'Portfolio action'}</Text>
              </View>
              <Text
                accessibilityLabel={formatSignedMoney(item.cashDelta)}
                numberOfLines={1}
                style={[styles.activityValue, item.cashDelta >= 0 ? styles.positive : styles.negative]}
              >
                {formatCompactSignedMoney(item.cashDelta)}
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
  summaryBlock: { gap: 2 },
  eyebrow: { color: colors.gold, fontSize: type.micro, fontWeight: '900', letterSpacing: 1.2 },
  total: { color: colors.text, fontSize: 32, fontWeight: '900', fontVariant: ['tabular-nums'] },
  dailyChange: { fontSize: type.value, fontWeight: '800', fontVariant: ['tabular-nums'] },
  dailyChangeContext: { color: colors.muted, fontSize: type.micro, fontWeight: '700' },
  metricRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  metric: {
    flexGrow: 1,
    flexBasis: 100,
    minWidth: 100,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.md,
  },
  metricWide: { flexBasis: '100%' },
  metricLabel: { color: colors.muted, fontSize: type.micro, fontWeight: '900', letterSpacing: 0.8 },
  metricValue: { color: colors.text, fontSize: type.heading, fontWeight: '900', marginTop: 5, fontVariant: ['tabular-nums'] },
  metricDetail: { color: colors.muted, fontSize: type.micro, marginTop: 3 },
  sectionHeading: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.sm },
  sectionTitle: { color: colors.text, fontSize: type.heading, fontWeight: '900', marginTop: space.md },
  badge: { color: colors.gold, fontSize: type.micro, fontWeight: '900', letterSpacing: 0.6 },
  subtle: { color: colors.muted, fontSize: type.micro, lineHeight: 17 },
  emptyCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.xs,
  },
  emptyTitle: { color: colors.text, fontSize: type.body, fontWeight: '800' },
  listCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lastRow: { borderBottomWidth: 0 },
  rowPressed: { opacity: 0.65 },
  rowCopy: { flex: 1, minWidth: 0 },
  rowName: { color: colors.text, fontSize: type.body, fontWeight: '800' },
  rowMeta: { color: colors.muted, fontSize: type.micro, marginTop: 2 },
  rowNumbers: { alignItems: 'flex-end', flexShrink: 0 },
  rowValue: { color: colors.text, fontSize: type.body, fontWeight: '800', fontVariant: ['tabular-nums'] },
  rowPnl: { fontSize: type.micro, fontWeight: '800', marginTop: 2, fontVariant: ['tabular-nums'] },
  activityRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  activityValue: { fontSize: type.label, fontWeight: '900', flexShrink: 0, fontVariant: ['tabular-nums'] },
  positive: { color: colors.green },
  negative: { color: colors.red },
});
