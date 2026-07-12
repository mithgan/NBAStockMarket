import { useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';

import { players } from '../data/snapshot';
import { sparklineHeights, trendDirection } from '../data/trendPresentation';
import { playerTrends, type TrendPoint } from '../data/trends';
import type { Player } from '../data/types';
import { formatMoney } from '../format';
import { usePortfolio } from '../state/PortfolioContext';
import { colors } from '../theme';

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('');
}

function PlayerAvatar({ player }: { player: Player }) {
  const [failed, setFailed] = useState(false);

  return (
    <View style={styles.avatar}>
      {failed ? (
        <Text style={styles.avatarInitials}>{initials(player.name)}</Text>
      ) : (
        <Image
          accessibilityIgnoresInvertColors
          accessibilityLabel={`${player.name} headshot`}
          onError={() => setFailed(true)}
          source={{ uri: `https://a.espncdn.com/i/headshots/nba/players/full/${player.id}.png` }}
          style={styles.headshot}
        />
      )}
    </View>
  );
}

function Sparkline({ points }: { points: TrendPoint[] }) {
  const dividends = points.map((point) => point.dividend_per_holder);
  const direction = trendDirection(dividends);
  const color = direction === 'up' ? colors.green : colors.red;
  const heights = sparklineHeights(dividends);

  return (
    <View
      accessible
      accessibilityLabel={`Last ${points.length} game dividend trend, trending ${direction}`}
      style={styles.sparkline}
    >
      {heights.map((height, index) => (
        <View
          // Dates are unique within each player's series.
          key={points[index].date}
          style={[styles.sparkBar, { backgroundColor: color, height }]}
        />
      ))}
    </View>
  );
}

interface MarketRowProps {
  player: Player;
  held: boolean;
  isLast: boolean;
  onOpen: (player: Player) => void;
  onTrade: (player: Player, side: 'buy' | 'sell') => void;
}

function MarketRow({ player, held, isLast, onOpen, onTrade }: MarketRowProps) {
  const handleTrade = (event: GestureResponderEvent) => {
    event.stopPropagation();
    onTrade(player, held ? 'sell' : 'buy');
  };

  return (
    <Pressable
      accessibilityHint="Opens the upcoming player detail screen"
      accessibilityLabel={`View ${player.name} details`}
      accessibilityRole="button"
      onPress={() => onOpen(player)}
      style={({ pressed }) => [
        styles.playerRow,
        !isLast && styles.playerRowBorder,
        pressed && styles.rowPressed,
      ]}
    >
      <PlayerAvatar player={player} />
      <View style={styles.playerCopy}>
        <Text style={styles.playerName} numberOfLines={1}>{player.name}</Text>
        <View style={styles.quoteRow}>
          <Text style={[styles.tier, player.tier === 'star' ? styles.star : styles.mid]}>
            {player.tier.toUpperCase()}
          </Text>
          <Text style={styles.price}>{formatMoney(player.listing_price)}</Text>
        </View>
      </View>
      <Sparkline points={playerTrends[player.id] ?? []} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${held ? 'Sell' : 'Buy'} one share of ${player.name}`}
        hitSlop={6}
        onPress={handleTrade}
        style={({ pressed }) => [
          styles.tradeButton,
          held ? styles.sellButton : styles.buyButton,
          pressed && styles.pressed,
        ]}
      >
        <Text style={[styles.tradeText, held ? styles.sellText : styles.buyText]}>
          {held ? 'SELL' : 'BUY'}
        </Text>
      </Pressable>
    </Pressable>
  );
}

export function MarketScreen() {
  const { message, owns, summary, trade } = usePortfolio();
  const [detailMessage, setDetailMessage] = useState<string | null>(null);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
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
      <Text style={styles.subtle}>Tap a player for details, or use Buy/Sell. One share maximum per player.</Text>

      {message || detailMessage ? <Text style={styles.message}>{message ?? detailMessage}</Text> : null}

      <View style={styles.marketList}>
        {players.map((player, index) => (
          <MarketRow
            held={owns(player.id)}
            isLast={index === players.length - 1}
            key={player.id}
            onOpen={(selected) => setDetailMessage(`${selected.name} detail screen is coming next.`)}
            onTrade={trade}
            player={player}
          />
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { flexGrow: 1, padding: 20, paddingBottom: 36, gap: 10 },
  headingRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  eyebrow: { color: colors.gold, fontSize: 12, fontWeight: '800', letterSpacing: 1.8 },
  title: { color: colors.text, fontSize: 28, fontWeight: '800', marginTop: 4, letterSpacing: -0.6 },
  subtle: { color: colors.muted, fontSize: 12, lineHeight: 18, marginBottom: 4 },
  cashPill: { alignItems: 'flex-end', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 13, paddingHorizontal: 12, paddingVertical: 9 },
  cashLabel: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 1.2 },
  cashValue: { color: colors.text, fontSize: 12, fontWeight: '800', marginTop: 2 },
  message: { color: colors.gold, backgroundColor: colors.goldSoft, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 12, fontWeight: '700' },
  marketList: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 72, paddingHorizontal: 11, paddingVertical: 10 },
  playerRowBorder: { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  rowPressed: { backgroundColor: colors.surfaceRaised },
  avatar: { width: 46, height: 46, borderRadius: 23, overflow: 'hidden', backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  headshot: { width: 46, height: 46 },
  avatarInitials: { color: colors.text, fontSize: 13, fontWeight: '900', letterSpacing: 0.4 },
  playerCopy: { flex: 1, minWidth: 0 },
  playerName: { color: colors.text, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  quoteRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },
  tier: { borderRadius: 999, overflow: 'hidden', paddingHorizontal: 6, paddingVertical: 3, fontSize: 8, fontWeight: '900', letterSpacing: 0.7 },
  star: { color: colors.gold, backgroundColor: colors.goldSoft },
  mid: { color: '#9fbccc', backgroundColor: colors.surfaceRaised },
  price: { color: colors.muted, fontSize: 11, fontVariant: ['tabular-nums'] },
  sparkline: { width: 52, height: 32, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  sparkBar: { width: 2, borderRadius: 2, opacity: 0.9 },
  tradeButton: { minWidth: 56, alignItems: 'center', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 9, borderWidth: 1 },
  buyButton: { borderColor: colors.green, backgroundColor: '#123b2b' },
  sellButton: { borderColor: colors.red, backgroundColor: '#402027' },
  tradeText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  buyText: { color: colors.green },
  sellText: { color: colors.red },
  pressed: { opacity: 0.65 },
});
