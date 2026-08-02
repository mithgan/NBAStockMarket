import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { players } from '../data/snapshot';
import type { Player } from '../data/types';
import { formatMoney, formatSignedMoney } from '../format';
import { usePortfolio } from '../state/PortfolioContext';
import { SIM_START } from '../state/sim';
import { colors } from '../theme';
import { PlayerDetail } from './MarketScreen';

const playerById = new Map(players.map((player) => [player.id, player]));

function feedName(playerId: string) {
  const name = playerById.get(playerId)?.name ?? playerId;
  if (name === 'Shai Gilgeous-Alexander') return 'SGA';
  if (name === 'Nikola Jokic') return 'Jokic';
  if (name === 'Luka Doncic') return 'Luka';
  return name;
}

export function PortfolioScreen() {
  const { dividendsCollected, recentEvents, simDate, state, summary } = usePortfolio();
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);

  if (selectedPlayer) {
    return (
      <PlayerDetail
        backLabel="Portfolio"
        onClose={() => setSelectedPlayer(null)}
        player={selectedPlayer}
      />
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>PORTFOLIO VALUE</Text>
      <Text adjustsFontSizeToFit minimumFontScale={0.72} numberOfLines={1} style={styles.total}>{formatMoney(summary.total_value)}</Text>
      <Text style={styles.subtle}>2025-26 replay · real games pay real dividends · one share max per player</Text>

      <View style={styles.statRow}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>CASH</Text>
          <Text adjustsFontSizeToFit minimumFontScale={0.72} numberOfLines={1} style={styles.statValue}>{formatMoney(summary.cash)}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>HOLDINGS</Text>
          <Text adjustsFontSizeToFit minimumFontScale={0.72} numberOfLines={1} style={styles.statValue}>{formatMoney(summary.market_value)}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>DIVIDENDS</Text>
          <Text
            adjustsFontSizeToFit
            minimumFontScale={0.72}
            numberOfLines={1}
            style={[styles.statValue, { color: dividendsCollected >= 0 ? colors.green : colors.red }]}
          >
            {formatSignedMoney(dividendsCollected)}
          </Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Your roster</Text>
      {state.holdings.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Your cap sheet is clean.</Text>
          <Text style={styles.subtle}>Head to Market to buy your first player stock.</Text>
        </View>
      ) : (
        state.holdings.map((holding) => {
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
              <View>
                <Text style={styles.rowName}>{player.name}</Text>
                <Text style={styles.subtle}>1 share · {player.tier.toUpperCase()}</Text>
              </View>
              <Text adjustsFontSizeToFit minimumFontScale={0.75} numberOfLines={1} style={styles.rowValue}>{formatMoney(player.listing_price)}</Text>
            </Pressable>
          );
        })
      )}

      <View style={styles.sectionHeading}>
        <Text style={styles.sectionTitle}>Latest settlements</Text>
        <Text style={styles.realBadge}>REAL 2025-26 GAMES</Text>
      </View>
      {recentEvents.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>
            {simDate === SIM_START
              ? 'The season has not tipped off.'
              : state.holdings.length === 0
                ? 'You hold no players.'
                : 'No games for your roster in the last advance.'}
          </Text>
          <Text style={styles.subtle}>
            {simDate === SIM_START
              ? 'Draft your roster, then advance the season to collect dividends from real games.'
              : 'Buy players in the Market tab, then advance the season.'}
          </Text>
        </View>
      ) : (
        <View style={styles.feedCard}>
          {recentEvents.slice(0, 12).map((event, index) => (
            <View
              key={`${event.player_id}-${event.date}-${index}`}
              style={[styles.feedRow, index < Math.min(recentEvents.length, 12) - 1 && styles.feedBorder]}
            >
              <View>
                <Text style={styles.rowName}>{feedName(event.player_id)}</Text>
                <Text style={styles.subtle}>
                  {event.date} · {event.np.toFixed(1)} vs {event.expected_np.toFixed(1)} NP
                </Text>
              </View>
              <Text
                adjustsFontSizeToFit
                minimumFontScale={0.75}
                numberOfLines={1}
                style={[
                  styles.pnl,
                  { color: event.amount >= 0 ? colors.green : colors.red },
                ]}
              >
                {formatSignedMoney(event.amount)}
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
  content: { flexGrow: 1, padding: 20, paddingBottom: 36, gap: 12 },
  eyebrow: { color: colors.gold, fontSize: 12, fontWeight: '800', letterSpacing: 1.8 },
  total: { color: colors.text, fontSize: 38, fontWeight: '800', letterSpacing: -1.4 },
  subtle: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  statRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  statCard: { flex: 1, minWidth: 0, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 15 },
  statLabel: { color: colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1.3 },
  statValue: { color: colors.text, fontSize: 17, fontWeight: '700', marginTop: 7 },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: 14 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  realBadge: { color: colors.gold, backgroundColor: colors.goldSoft, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  emptyCard: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 18, gap: 4 },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 15, padding: 15 },
  rowPressed: { backgroundColor: colors.surfaceRaised },
  rowName: { color: colors.text, fontSize: 14, fontWeight: '700' },
  rowValue: { color: colors.text, flexShrink: 1, fontSize: 14, fontWeight: '700' },
  feedCard: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 16, paddingHorizontal: 15 },
  feedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 14 },
  feedBorder: { borderBottomColor: colors.border, borderBottomWidth: 1 },
  pnl: { fontSize: 14, fontWeight: '800' },
});
