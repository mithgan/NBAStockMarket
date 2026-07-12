import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { players } from '../data/snapshot';
import { formatMoney } from '../format';
import { usePortfolio } from '../state/PortfolioContext';
import { colors } from '../theme';

export function MarketScreen() {
  const { message, owns, summary, trade } = usePortfolio();

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.headingRow}>
        <View>
          <Text style={styles.eyebrow}>PLAYER MARKET</Text>
          <Text style={styles.title}>Build your roster</Text>
        </View>
        <View style={styles.cashPill}>
          <Text style={styles.cashLabel}>CASH</Text>
          <Text style={styles.cashValue}>{formatMoney(summary.cash)}</Text>
        </View>
      </View>
      <Text style={styles.subtle}>Tap once to buy or sell. Every account is capped at one share per player.</Text>

      {message ? <Text style={styles.message}>{message}</Text> : null}

      {players.map((player, index) => {
        const held = owns(player.id);
        return (
          <View key={player.id} style={styles.playerRow}>
            <View style={styles.rankBubble}>
              <Text style={styles.rank}>{index + 1}</Text>
            </View>
            <View style={styles.playerCopy}>
              <View style={styles.nameRow}>
                <Text style={styles.playerName} numberOfLines={1}>{player.name}</Text>
                <Text style={[styles.tier, player.tier === 'star' ? styles.star : styles.mid]}>
                  {player.tier.toUpperCase()}
                </Text>
              </View>
              <Text style={styles.price}>{formatMoney(player.listing_price)}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${held ? 'Sell' : 'Buy'} one share of ${player.name}`}
              onPress={() => trade(player, held ? 'sell' : 'buy')}
              style={({ pressed }) => [
                styles.tradeButton,
                held ? styles.sellButton : styles.buyButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.tradeText, held ? styles.sellText : styles.buyText]}>
                {held ? 'SELL 1' : 'BUY 1'}
              </Text>
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 36, gap: 10 },
  headingRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  eyebrow: { color: colors.gold, fontSize: 12, fontWeight: '800', letterSpacing: 1.8 },
  title: { color: colors.text, fontSize: 28, fontWeight: '800', marginTop: 4, letterSpacing: -0.6 },
  subtle: { color: colors.muted, fontSize: 12, lineHeight: 18, marginBottom: 4 },
  cashPill: { alignItems: 'flex-end', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 13, paddingHorizontal: 12, paddingVertical: 9 },
  cashLabel: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 1.2 },
  cashValue: { color: colors.text, fontSize: 12, fontWeight: '800', marginTop: 2 },
  message: { color: colors.gold, backgroundColor: colors.goldSoft, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 12, fontWeight: '700' },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 15, padding: 12 },
  rankBubble: { width: 27, height: 27, borderRadius: 14, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  rank: { color: colors.muted, fontSize: 11, fontWeight: '800' },
  playerCopy: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  playerName: { color: colors.text, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  tier: { borderRadius: 999, overflow: 'hidden', paddingHorizontal: 6, paddingVertical: 3, fontSize: 8, fontWeight: '900', letterSpacing: 0.7 },
  star: { color: colors.gold, backgroundColor: colors.goldSoft },
  mid: { color: '#9fbccc', backgroundColor: colors.surfaceRaised },
  price: { color: colors.muted, fontSize: 12, marginTop: 4 },
  tradeButton: { minWidth: 64, alignItems: 'center', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, borderWidth: 1 },
  buyButton: { borderColor: colors.green, backgroundColor: '#123b2b' },
  sellButton: { borderColor: colors.red, backgroundColor: '#402027' },
  tradeText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  buyText: { color: colors.green },
  sellText: { color: colors.red },
  pressed: { opacity: 0.65 },
});
