import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PortfolioHistoryChart } from '../components/PortfolioHistoryChart';
import type { Player } from '../data/types';
import { formatMoney, formatSignedMoney } from '../format';
import { usePortfolio } from '../state/PortfolioContext';
import { colors } from '../theme';
import { PlayerDetail } from './MarketScreen';

function StatCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text adjustsFontSizeToFit minimumFontScale={0.7} numberOfLines={1} style={styles.statValue}>{value}</Text>
      {detail ? <Text style={styles.statDetail}>{detail}</Text> : null}
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
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  if (!state || !summary) return null;
  const playerById = new Map(players.map((player) => [player.id, player]));
  const latestPoint = state.portfolioHistory.at(-1) ?? null;
  const recentActivity = [...state.activity].reverse().slice(0, 10);

  if (selectedPlayer) {
    return (
      <PlayerDetail
        backLabel="Portfolio"
        currentPrice={state.prices[selectedPlayer.id] ?? selectedPlayer.listing_price}
        latestSettledDate={latestSettledDate}
        onClose={() => setSelectedPlayer(null)}
        player={selectedPlayer}
        trendPoints={playerTrends[selectedPlayer.id] ?? []}
      />
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={styles.eyebrow}>PORTFOLIO VALUE</Text>
      <Text adjustsFontSizeToFit minimumFontScale={0.7} numberOfLines={1} style={styles.total}>{formatMoney(summary.totalValue)}</Text>
      <Text style={[styles.dailyChange, { color: summary.latestDailyChange >= 0 ? colors.green : colors.red }]}>
        {formatSignedMoney(summary.latestDailyChange)} on the latest replay date
      </Text>

      <View style={styles.statGrid}>
        <StatCard label="FREE CASH" value={formatMoney(summary.freeCash)} detail="Available to spend" />
        <StatCard label="RESERVED" value={formatMoney(summary.reservedCollateral)} detail="Short collateral" />
        <StatCard label="HOLDINGS" value={formatMoney(summary.marketValue)} detail={`${summary.holdings.length} of ${players.length} listed players`} />
        <StatCard label="CASH BALANCE" value={formatMoney(summary.cash)} detail="Includes reserved cash" />
      </View>

      <View style={styles.sectionHeading}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>Portfolio history</Text>
        <Text style={styles.badge}>LAST 30 DATES</Text>
      </View>
      <View style={styles.chartCard}>
        <PortfolioHistoryChart points={state.portfolioHistory} />
      </View>

      <Text accessibilityRole="header" style={styles.sectionTitle}>Your roster</Text>
      {state.holdings.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Your cap sheet is clean.</Text>
          <Text style={styles.subtle}>Open Market to buy one whole-player share. Fees are included at checkout.</Text>
        </View>
      ) : (
        <View style={styles.listCard}>
          {summary.holdings.map((holding) => {
            const player = playerById.get(holding.player_id);
            if (!player) return null;
            return (
              <Pressable
                accessibilityLabel={`View ${player.name} details`}
                accessibilityRole="button"
                key={holding.player_id}
                onPress={() => setSelectedPlayer(player)}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <View style={styles.rowCopy}>
                  <Text numberOfLines={1} style={styles.rowName}>{player.name}</Text>
                  <Text style={styles.subtle}>Cost {formatMoney(holding.costBasis)} incl. fee · one share</Text>
                </View>
                <View style={styles.rowNumbers}>
                  <Text style={styles.rowValue}>{formatMoney(holding.currentPrice)}</Text>
                  <Text style={[styles.rowPnl, { color: holding.unrealizedPnl >= 0 ? colors.green : colors.red }]}>{formatSignedMoney(holding.unrealizedPnl)}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={styles.sectionHeading}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>Latest daily result</Text>
        {latestPoint ? <Text style={styles.badge}>{latestPoint.date}</Text> : null}
      </View>
      <View style={styles.resultCard}>
        {latestPoint ? (
          <>
            <Text style={[styles.resultValue, { color: latestPoint.dailyChange >= 0 ? colors.green : colors.red }]}>
              {formatSignedMoney(latestPoint.dailyChange)}
            </Text>
            <Text style={styles.subtle}>Cash dividends, boosts, short settlements, and refunds for that date.</Text>
          </>
        ) : (
          <Text style={styles.subtle}>No server settlement has reached this account yet.</Text>
        )}
      </View>

      <Text accessibilityRole="header" style={styles.sectionTitle}>Activity</Text>
      {recentActivity.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.subtle}>Trades and settlements will appear here.</Text>
        </View>
      ) : (
        <View style={styles.listCard}>
          {recentActivity.map((item) => (
            <View key={item.id} style={styles.activityRow}>
              <View style={styles.rowCopy}>
                <Text style={styles.rowName}>{item.message}</Text>
                <Text style={styles.subtle}>{item.date ?? 'Portfolio action'}</Text>
              </View>
              <Text style={[styles.activityValue, { color: item.cashDelta >= 0 ? colors.green : colors.red }]}>
                {formatSignedMoney(item.cashDelta)}
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
  content: { flexGrow: 1, padding: 16, paddingBottom: 36, gap: 10 },
  eyebrow: { color: colors.gold, fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  total: { color: colors.text, fontSize: 37, fontWeight: '900', fontVariant: ['tabular-nums'] },
  dailyChange: { fontSize: 12, fontWeight: '800' },
  subtle: { color: colors.muted, fontSize: 11, lineHeight: 17 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  statCard: { width: '48%', flexGrow: 1, minWidth: 140, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 13 },
  statLabel: { color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  statValue: { color: colors.text, fontSize: 14, fontWeight: '800', marginTop: 7, fontVariant: ['tabular-nums'] },
  statDetail: { color: colors.muted, fontSize: 9, marginTop: 3 },
  sectionHeading: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '900', marginTop: 14 },
  badge: { color: colors.gold, fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  chartCard: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 12 },
  emptyCard: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 16, gap: 4 },
  emptyTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  listCard: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  row: { minHeight: 66, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 13, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  rowPressed: { opacity: 0.65 },
  rowCopy: { flex: 1, minWidth: 0 },
  rowName: { color: colors.text, fontSize: 13, fontWeight: '800' },
  rowNumbers: { alignItems: 'flex-end' },
  rowValue: { color: colors.text, fontSize: 12, fontWeight: '800' },
  rowPnl: { fontSize: 10, fontWeight: '800', marginTop: 3 },
  resultCard: { minHeight: 92, justifyContent: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 16 },
  resultValue: { fontSize: 24, fontWeight: '900', marginBottom: 4 },
  activityRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  activityValue: { fontSize: 11, fontWeight: '900' },
});
