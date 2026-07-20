import { useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PortfolioHistoryChart } from '../components/PortfolioHistoryChart';
import { players } from '../data/snapshot';
import type { Player } from '../data/types';
import { formatMoney, formatSignedMoney } from '../format';
import { usePortfolio } from '../state/PortfolioContext';
import { colors } from '../theme';
import { PlayerDetail } from './MarketScreen';

const playerById = new Map(players.map((player) => [player.id, player]));

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
    isPersistenceBlocked,
    isResetting,
    latestSettledDate,
    persistenceError,
    resetProgress,
    state,
    summary,
  } = usePortfolio();
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const latestPoint = state.portfolioHistory.at(-1) ?? null;
  const recentActivity = [...state.activity].reverse().slice(0, 10);

  const requestReset = () => {
    const reset = () => void resetProgress();
    if (Platform.OS === 'web') {
      if (globalThis.confirm('Reset all portfolio, replay, and weekly-play progress?')) reset();
      return;
    }
    Alert.alert(
      'Reset progress?',
      'This clears your portfolio, replay history, shorts, and boosts on this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: reset },
      ],
    );
  };

  if (selectedPlayer) {
    return (
      <PlayerDetail
        backLabel="Portfolio"
        currentPrice={state.prices[selectedPlayer.id] ?? selectedPlayer.listing_price}
        latestSettledDate={latestSettledDate}
        onClose={() => setSelectedPlayer(null)}
        player={selectedPlayer}
      />
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={styles.eyebrow}>PORTFOLIO VALUE</Text>
      {isPersistenceBlocked ? (
        <View accessibilityRole="alert" style={styles.recoveryCard}>
          <Text style={styles.recoveryTitle}>Saving is paused</Text>
          <Text style={styles.subtle}>
            {persistenceError ?? 'Progress cannot be saved right now. Reset progress to resume.'}
          </Text>
          <Pressable
            accessibilityLabel="Reset progress and resume saving"
            accessibilityRole="button"
            accessibilityState={{ disabled: isResetting }}
            disabled={isResetting}
            onPress={requestReset}
            style={({ pressed }) => [
              styles.recoveryButton,
              isResetting && styles.resetButtonDisabled,
              pressed && !isResetting && styles.rowPressed,
            ]}
          >
            <Text style={styles.recoveryButtonText}>{isResetting ? 'RESETTING...' : 'RESET AND CONTINUE'}</Text>
          </Pressable>
        </View>
      ) : null}
      <Text adjustsFontSizeToFit minimumFontScale={0.7} numberOfLines={1} style={styles.total}>{formatMoney(summary.totalValue)}</Text>
      <Text style={[styles.dailyChange, { color: summary.latestDailyChange >= 0 ? colors.green : colors.red }]}>
        {formatSignedMoney(summary.latestDailyChange)} on the latest replay date
      </Text>

      <View style={styles.statGrid}>
        <StatCard label="FREE CASH" value={formatMoney(summary.freeCash)} detail="Available to spend" />
        <StatCard label="RESERVED" value={formatMoney(summary.reservedCollateral)} detail="Short collateral" />
        <StatCard label="HOLDINGS" value={formatMoney(summary.marketValue)} detail={`${summary.holdings.length} of 30 players`} />
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
          <Text style={styles.subtle}>Settle the first replay date to calculate your result.</Text>
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

      <Pressable
        accessibilityLabel="Reset progress"
        accessibilityRole="button"
        accessibilityState={{ disabled: isResetting }}
        disabled={isResetting}
        onPress={requestReset}
        style={({ pressed }) => [
          styles.resetButton,
          isResetting && styles.resetButtonDisabled,
          pressed && !isResetting && styles.rowPressed,
        ]}
      >
        <Text style={styles.resetText}>{isResetting ? 'Resetting...' : 'Reset progress'}</Text>
      </Pressable>
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
  recoveryCard: { backgroundColor: colors.goldSoft, borderColor: colors.gold, borderWidth: 1, borderRadius: 8, padding: 14, gap: 8 },
  recoveryTitle: { color: colors.text, fontSize: 15, fontWeight: '900' },
  recoveryButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', backgroundColor: colors.gold, borderRadius: 6, paddingHorizontal: 14, paddingVertical: 10 },
  recoveryButtonText: { color: colors.background, fontSize: 10, fontWeight: '900' },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  statCard: { width: '48%', flexGrow: 1, minWidth: 140, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 13 },
  statLabel: { color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  statValue: { color: colors.text, fontSize: 16, fontWeight: '800', marginTop: 7, fontVariant: ['tabular-nums'] },
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
  resetButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderColor: colors.red, borderWidth: 1, marginTop: 14 },
  resetButtonDisabled: { opacity: 0.45 },
  resetText: { color: colors.red, fontSize: 12, fontWeight: '900' },
});
