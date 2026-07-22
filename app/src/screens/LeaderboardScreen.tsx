import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatMoney, formatSignedMoney } from '../format';
import { usePortfolio } from '../state/PortfolioContext';
import { colors } from '../theme';

export function LeaderboardScreen() {
  const { leaderboard, summary } = usePortfolio();
  if (!summary) return null;
  const winner = leaderboard[0];

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>LIVE LEAGUE</Text>
      <Text accessibilityRole="header" style={styles.title}>Portfolio leaderboard</Text>
      <Text style={styles.subtle}>Server-ranked portfolios update as player prices and account balances change.</Text>

      {winner ? <View style={styles.podium}>
        <Text style={styles.rankLabel}>RANK 01</Text>
        <Text style={styles.winner}>{winner.name}</Text>
        <Text adjustsFontSizeToFit minimumFontScale={0.75} numberOfLines={1} style={styles.winnerValue}>{formatMoney(winner.value)}</Text>
        <Text style={[styles.winnerReturn, { color: winner.returnPct >= 0 ? colors.green : colors.red }]}>
          {winner.returnPct >= 0 ? '+' : ''}{winner.returnPct.toFixed(2)}% from $140M
        </Text>
      </View> : (
        <View style={styles.emptyCard}>
          <Text style={styles.subtle}>No ranked portfolios are available yet.</Text>
        </View>
      )}

      <View style={styles.table}>
        {leaderboard.slice(1).map((entry) => (
          <View key={entry.id} style={[styles.row, entry.isUser && styles.youRow]}>
            <Text style={styles.rank}>{String(entry.rank).padStart(2, '0')}</Text>
            <View style={styles.nameCell}>
              <Text style={[styles.name, entry.isUser && styles.you]}>{entry.name}</Text>
              <Text style={styles.value}>{formatMoney(entry.value)}</Text>
            </View>
            <View style={styles.returnCell}>
              <Text style={[styles.returnValue, { color: entry.returnPct >= 0 ? colors.green : colors.red }]}>
                {entry.returnPct >= 0 ? '+' : ''}{entry.returnPct.toFixed(2)}%
              </Text>
              {entry.isUser ? (
                <Text style={[styles.dayMove, { color: summary.latestDailyChange >= 0 ? colors.green : colors.red }]}>
                  {formatSignedMoney(summary.latestDailyChange)} last day
                </Text>
              ) : null}
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { flexGrow: 1, padding: 16, paddingBottom: 36, gap: 10 },
  eyebrow: { color: colors.gold, fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  title: { color: colors.text, fontSize: 29, fontWeight: '900' },
  subtle: { color: colors.muted, fontSize: 11, lineHeight: 17 },
  podium: { alignItems: 'center', backgroundColor: colors.goldSoft, borderColor: colors.gold, borderWidth: 1, borderRadius: 8, padding: 20, marginVertical: 8 },
  rankLabel: { color: colors.gold, fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  winner: { color: colors.text, fontSize: 19, fontWeight: '900', marginTop: 7 },
  winnerValue: { color: colors.text, fontSize: 25, fontWeight: '900', marginTop: 4 },
  winnerReturn: { fontSize: 11, fontWeight: '800', marginTop: 5 },
  table: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  emptyCard: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 18 },
  row: { minHeight: 68, flexDirection: 'row', alignItems: 'center', padding: 13, gap: 12, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  youRow: { backgroundColor: colors.goldSoft },
  rank: { color: colors.gold, fontSize: 12, fontWeight: '900' },
  nameCell: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontSize: 13, fontWeight: '800' },
  you: { color: colors.gold },
  value: { color: colors.muted, fontSize: 10, marginTop: 3 },
  returnCell: { alignItems: 'flex-end' },
  returnValue: { fontSize: 12, fontWeight: '900' },
  dayMove: { fontSize: 8, fontWeight: '700', marginTop: 3 },
});
