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
import { STARTING_CASH } from '../state/game';
import { DisplayValue, MeterRule, SectionHeader, Tag } from '../ui/primitives';
import { colors, fonts, labelStyle, numeric, space, type, weight } from '../theme';
import { PlayerDetail } from './MarketScreen';

/**
 * A label/value pair separated by rules rather than boxed in a card — the
 * databallr.com stat-strip treatment.
 */
function Metric({ label, value, detail, accessibilityLabel, wide, last = false }: {
  label: string;
  value: string;
  detail: string;
  accessibilityLabel: string;
  wide: boolean;
  last?: boolean;
}) {
  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel}
      style={[styles.metric, wide && styles.metricWide, last && styles.metricLast]}
    >
      <Text style={styles.metricLabel}>{label}</Text>
      <Text maxFontSizeMultiplier={1.6} numberOfLines={1} style={styles.metricValue}>{value}</Text>
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
  const totalReturn = ((summary.totalValue - STARTING_CASH) / STARTING_CASH) * 100;
  const investedShare = summary.totalValue > 0 ? summary.marketValue / summary.totalValue : 0;

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
      {/* The single strongest signal on the screen. */}
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>PORTFOLIO VALUE</Text>
        <DisplayValue
          accessibilityLabel={`Portfolio value ${formatMoney(summary.totalValue)}, ${totalReturn >= 0 ? 'up' : 'down'} ${Math.abs(totalReturn).toFixed(2)} percent from 140 million`}
          label={`${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}% ALL TIME`}
          value={formatCompactMoney(summary.totalValue)}
        />
        <View style={styles.heroChangeRow}>
          <Text
            accessibilityLabel={`${formatSignedMoney(summary.latestDailyChange)} on the latest replay date${latestPoint ? `, ${latestPoint.date}` : ''}`}
            maxFontSizeMultiplier={1.6}
            numberOfLines={1}
            style={[styles.heroChange, dailyPositive ? styles.positive : styles.negative]}
          >
            {formatCompactSignedMoney(summary.latestDailyChange)}
          </Text>
          <Tag label={latestPoint ? `LAST SETTLED ${latestPoint.date}` : 'NOT SETTLED'} tone={dailyPositive ? 'up' : 'down'} />
        </View>
        <Text style={styles.heroCopy}>
          {latestPoint
            ? 'Total portfolio-value change for that date, including cash payouts and player-price movement.'
            : 'No server settlement has reached this account yet.'}
        </Text>
        <MeterRule fill={investedShare} tone={dailyPositive ? 'up' : 'down'} />
        <Text style={styles.heroFootnote}>
          {`${Math.round(investedShare * 100)}% invested · ${Math.round((1 - investedShare) * 100)}% cash`}
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
          last
          wide={largeText}
          value={formatCompactMoney(summary.reservedCollateral)}
        />
      </View>

      <SectionHeader label="HISTORY" meta="LAST 30 DATES" />
      <PortfolioHistoryChart points={state.portfolioHistory} />
      <Text style={styles.footnote}>
        Total value across the settled dates shown, not a single day.
      </Text>

      <SectionHeader
        label="ROSTER"
        meta={state.holdings.length > 0 ? `${state.holdings.length} PLAYERS` : undefined}
      />
      {state.holdings.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Your cap sheet is clean.</Text>
          <Text style={styles.subtle}>Open Market to buy one whole-player share. Fees are included at checkout.</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {summary.holdings.map((holding) => {
            const player = playerById.get(holding.player_id);
            if (!player) return null;
            const gain = holding.unrealizedPnl >= 0;
            return (
              <Pressable
                accessibilityLabel={`View ${player.name} details. Now ${formatMoney(holding.currentPrice)}, cost ${formatMoney(holding.costBasis)} including fee, ${gain ? 'up' : 'down'} ${formatMoney(Math.abs(holding.unrealizedPnl))}`}
                accessibilityRole="button"
                key={holding.player_id}
                onPress={() => setSelectedPlayerId(player.id)}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <View style={[styles.rowAccent, gain ? styles.accentUp : styles.accentDown]} />
                <View style={styles.rowCopy}>
                  <Text numberOfLines={1} style={styles.rowName}>{player.name}</Text>
                  <Text numberOfLines={1} style={styles.rowMeta}>
                    {player.tier.toUpperCase()} · COST {formatCompactMoney(holding.costBasis)} incl. fee
                  </Text>
                </View>
                <View style={styles.rowNumbers}>
                  <Text maxFontSizeMultiplier={1.6} numberOfLines={1} style={styles.rowValue}>
                    {formatCompactMoney(holding.currentPrice)}
                  </Text>
                  <Text
                    maxFontSizeMultiplier={1.6}
                    numberOfLines={1}
                    style={[styles.rowPnl, gain ? styles.positive : styles.negative]}
                  >
                    {formatCompactSignedMoney(holding.unrealizedPnl)}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      <SectionHeader label="ACTIVITY" meta={recentActivity.length > 0 ? 'LATEST 10' : undefined} />
      {recentActivity.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.subtle}>Trades and settlements will appear here.</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {recentActivity.map((item) => (
            <View key={item.id} style={styles.activityRow}>
              <View style={styles.rowCopy}>
                <Text numberOfLines={1} style={styles.rowName}>{item.message}</Text>
                <Text numberOfLines={1} style={styles.rowMeta}>{item.date ?? 'PORTFOLIO ACTION'}</Text>
              </View>
              <Text
                accessibilityLabel={formatSignedMoney(item.cashDelta)}
                maxFontSizeMultiplier={1.6}
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
  content: { flexGrow: 1, paddingBottom: space.xxl },

  hero: {
    paddingHorizontal: space.md,
    paddingTop: space.lg,
    paddingBottom: space.md,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  heroLabel: { ...labelStyle, color: colors.gold, marginBottom: space.xs },
  heroChangeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs, flexWrap: 'wrap' },
  heroChange: { ...numeric, fontSize: type.title, fontWeight: weight.black },
  heroFootnote: { ...labelStyle, marginTop: space.sm },
  heroCopy: {
    color: colors.faint,
    fontFamily: fonts.body,
    fontSize: type.label,
    lineHeight: 16,
    marginTop: space.sm,
  },

  metricRow: {
    flexDirection: 'row',
    // Metrics go full-width at large text, so the row has to wrap or the last
    // two would sit off-screen.
    flexWrap: 'wrap',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  metric: {
    flexGrow: 1,
    flexBasis: 100,
    minWidth: 100,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderRightColor: colors.border,
    borderRightWidth: 1,
  },
  metricWide: { flexBasis: '100%' },
  metricLast: { borderRightWidth: 0 },
  metricLabel: { ...labelStyle },
  metricValue: {
    ...numeric,
    color: colors.text,
    fontSize: type.title,
    fontWeight: weight.black,
    marginTop: 5,
  },
  metricDetail: { ...labelStyle, color: colors.faint, marginTop: 3, letterSpacing: 0.4 },

  footnote: {
    color: colors.faint,
    fontFamily: fonts.body,
    fontSize: type.label,
    lineHeight: 16,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
  },
  subtle: { color: colors.muted, fontFamily: fonts.body, fontSize: type.label, lineHeight: 17 },

  empty: {
    paddingHorizontal: space.md,
    paddingVertical: space.lg,
    gap: space.xs,
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderBottomColor: colors.border,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  emptyTitle: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.heavy,
  },

  list: { borderTopColor: colors.border, borderTopWidth: 1 },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingRight: space.md,
    paddingLeft: space.md,
    paddingVertical: space.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  rowAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 2 },
  accentUp: { backgroundColor: colors.green },
  accentDown: { backgroundColor: colors.red },
  rowPressed: { backgroundColor: colors.surface },
  rowCopy: { flex: 1, minWidth: 0 },
  rowName: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.heavy,
  },
  rowMeta: { ...labelStyle, color: colors.faint, marginTop: 2, letterSpacing: 0.5 },
  rowNumbers: { alignItems: 'flex-end', flexShrink: 0 },
  rowValue: { ...numeric, color: colors.text, fontSize: type.body, fontWeight: weight.heavy },
  rowPnl: { ...numeric, fontSize: type.label, fontWeight: weight.heavy, marginTop: 2 },

  activityRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  activityValue: { ...numeric, fontSize: type.body, fontWeight: weight.black, flexShrink: 0 },

  positive: { color: colors.green },
  negative: { color: colors.red },
});
