import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { leaderboard } from '../data/snapshot';
import { formatMoney } from '../format';
import { colors } from '../theme';

export function LeaderboardScreen() {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>LEAGUE TABLE</Text>
      <Text style={styles.title}>Top portfolios</Text>
      <Text style={styles.subtle}>Mock rankings for the prototype season.</Text>

      <View style={styles.podium}>
        <Text style={styles.crown}>01</Text>
        <Text style={styles.winner}>{leaderboard[0].name}</Text>
        <Text style={styles.winnerValue}>{formatMoney(leaderboard[0].value)}</Text>
        <Text style={styles.winnerReturn}>+{leaderboard[0].returnPct.toFixed(2)}%</Text>
      </View>

      <View style={styles.table}>
        {leaderboard.slice(1).map((entry, index) => (
          <View key={entry.rank} style={[styles.row, index < leaderboard.length - 2 && styles.border]}>
            <Text style={styles.rank}>{String(entry.rank).padStart(2, '0')}</Text>
            <View style={styles.nameCell}>
              <Text style={[styles.name, entry.name === 'You' && styles.you]}>{entry.name}</Text>
              <Text style={styles.value}>{formatMoney(entry.value)}</Text>
            </View>
            <Text style={[styles.returnValue, { color: entry.returnPct >= 0 ? colors.green : colors.red }]}>{entry.returnPct >= 0 ? '+' : ''}{entry.returnPct.toFixed(2)}%</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 36, gap: 10 },
  eyebrow: { color: colors.gold, fontSize: 12, fontWeight: '800', letterSpacing: 1.8 },
  title: { color: colors.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.8 },
  subtle: { color: colors.muted, fontSize: 12 },
  podium: { alignItems: 'center', backgroundColor: colors.goldSoft, borderColor: colors.gold, borderWidth: 1, borderRadius: 20, padding: 22, marginVertical: 10 },
  crown: { color: colors.gold, fontSize: 12, fontWeight: '900', letterSpacing: 3 },
  winner: { color: colors.text, fontSize: 20, fontWeight: '800', marginTop: 8 },
  winnerValue: { color: colors.text, fontSize: 25, fontWeight: '800', marginTop: 4 },
  winnerReturn: { color: colors.green, fontSize: 13, fontWeight: '800', marginTop: 6 },
  table: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 16, paddingHorizontal: 15 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, gap: 12 },
  border: { borderBottomColor: colors.border, borderBottomWidth: 1 },
  rank: { color: colors.gold, fontSize: 13, fontWeight: '900' },
  nameCell: { flex: 1 },
  name: { color: colors.text, fontSize: 14, fontWeight: '700' },
  you: { color: colors.gold },
  value: { color: colors.muted, fontSize: 11, marginTop: 3 },
  returnValue: { fontSize: 13, fontWeight: '800' },
});
