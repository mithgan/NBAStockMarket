import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { dividendEvents, players } from '../data/snapshot';
import { formatMoney, formatSignedMoney } from '../format';
import { usePortfolio } from '../state/PortfolioContext';
import { colors } from '../theme';

const playerById = new Map(players.map((player) => [player.id, player]));

function feedName(playerId: string) {
  const name = playerById.get(playerId)?.name ?? playerId;
  if (name === 'Shai Gilgeous-Alexander') return 'SGA';
  if (name === 'Nikola Jokic') return 'Jokic';
  if (name === 'Luka Doncic') return 'Luka';
  return name;
}

export function PortfolioScreen() {
  const { state, summary } = usePortfolio();

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>PORTFOLIO VALUE</Text>
      <Text style={styles.total}>{formatMoney(summary.total_value)}</Text>
      <Text style={styles.subtle}>Live mock prices · one share max per player</Text>

      <View style={styles.statRow}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>CASH</Text>
          <Text style={styles.statValue}>{formatMoney(summary.cash)}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>HOLDINGS</Text>
          <Text style={styles.statValue}>{formatMoney(summary.market_value)}</Text>
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
            <View key={holding.player_id} style={styles.row}>
              <View>
                <Text style={styles.rowName}>{player.name}</Text>
                <Text style={styles.subtle}>1 share · {player.tier.toUpperCase()}</Text>
              </View>
              <Text style={styles.rowValue}>{formatMoney(player.listing_price)}</Text>
            </View>
          );
        })
      )}

      <View style={styles.sectionHeading}>
        <Text style={styles.sectionTitle}>Last night</Text>
        <Text style={styles.realBadge}>REAL BACKTEST</Text>
      </View>
      <View style={styles.feedCard}>
        {dividendEvents.map((event, index) => (
          <View
            key={`${event.player_id}-${event.game_date}-${index}`}
            style={[styles.feedRow, index < dividendEvents.length - 1 && styles.feedBorder]}
          >
            <View>
              <Text style={styles.rowName}>{feedName(event.player_id)}</Text>
              <Text style={styles.subtle}>
                {event.game_date} · {event.actual_net_points.toFixed(1)} vs {event.expected_net_points.toFixed(1)} NP
              </Text>
            </View>
            <Text
              style={[
                styles.pnl,
                { color: event.dividend_per_holder >= 0 ? colors.green : colors.red },
              ]}
            >
              {formatSignedMoney(event.dividend_per_holder)}
            </Text>
          </View>
        ))}
      </View>
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
  rowName: { color: colors.text, fontSize: 14, fontWeight: '700' },
  rowValue: { color: colors.text, fontSize: 14, fontWeight: '700' },
  feedCard: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 16, paddingHorizontal: 15 },
  feedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 14 },
  feedBorder: { borderBottomColor: colors.border, borderBottomWidth: 1 },
  pnl: { fontSize: 14, fontWeight: '800' },
});
