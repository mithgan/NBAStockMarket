import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { TrendPoint } from '../data/trendPresentation';
import type { Player } from '../data/types';
import { formatCompactMoney, formatCompactSignedMoney, formatMoney } from '../format';
import { colors, fonts, numeric, radius, space, type, weight } from '../theme';
import { cardMarker } from '../ui/domMarkers';
import { PlayerAvatar } from './PlayerAvatar';
import { SignedValue } from './SignedValue';
import { Sparkline } from './Sparkline';

/**
 * One owned player in the roster grid: tier tab, portrait, name, live price,
 * unrealized P&L against cost, and — when the screen passes one — a dividend
 * sparkline as the card's footer.
 */
export function HoldingCard({ holding, onPress, trend, width }: {
  holding: {
    player: Player;
    currentPrice: number;
    costBasis: number;
    unrealizedPnl: number;
  };
  onPress: () => void;
  /** Recent settled games; the footer only draws with two or more points. */
  trend?: TrendPoint[];
  width: number;
}) {
  const { player, currentPrice, costBasis, unrealizedPnl } = holding;
  const gain = unrealizedPnl >= 0;
  const pnlColor = gain ? colors.green : colors.red;
  return (
    <Pressable
      accessibilityLabel={`View ${player.name} details. Now ${formatMoney(currentPrice)}, cost ${formatMoney(costBasis)} including fee, ${gain ? 'up' : 'down'} ${formatMoney(Math.abs(unrealizedPnl))}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, { width }, pressed && styles.pressed]}
      {...cardMarker}
    >
      <View style={styles.tierTab}>
        <Text style={styles.tierText}>{player.tier.toUpperCase()}</Text>
      </View>
      <View style={styles.portrait}>
        <PlayerAvatar player={player} size={76} />
      </View>
      <Text maxFontSizeMultiplier={1.3} numberOfLines={2} style={styles.name}>
        {player.name}
      </Text>
      <View style={styles.priceRow}>
        <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={styles.price}>
          {formatCompactMoney(currentPrice)}
        </Text>
      </View>
      <SignedValue color={pnlColor} label={formatCompactSignedMoney(unrealizedPnl)} style={styles.pnl} />
      <Text numberOfLines={1} style={styles.cost}>{`cost ${formatCompactMoney(costBasis)}`}</Text>
      {trend && trend.length > 1 ? (
        <View style={styles.trend}>
          <Sparkline points={trend} />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    paddingTop: space.lg,
    paddingBottom: space.md,
    paddingHorizontal: space.sm,
    borderRadius: radius.lg,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  pressed: { opacity: 0.75 },
  tierTab: {
    position: 'absolute',
    top: 0,
    alignSelf: 'center',
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    backgroundColor: colors.goldSoft,
    borderBottomLeftRadius: radius.sm,
    borderBottomRightRadius: radius.sm,
  },
  tierText: {
    color: colors.goldInk,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.black,
    letterSpacing: 0.8,
  },
  portrait: {
    marginTop: space.sm,
    padding: 3,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
  // Two lines are reserved so one-line names don't make cards ragged.
  name: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.heavy,
    textAlign: 'center',
    marginTop: space.sm,
    minHeight: 34,
  },
  priceRow: { marginTop: 2 },
  price: {
    ...numeric,
    color: colors.text,
    fontSize: type.value,
    fontWeight: weight.heavy,
    textAlign: 'center',
  },
  pnl: { marginTop: 3 },
  // The negative bottom margin bleeds the strip into the card's bottom
  // padding, so its top rule reads as a footer rather than a floating box.
  trend: {
    alignSelf: 'stretch',
    alignItems: 'center',
    marginTop: space.sm,
    marginBottom: -space.sm,
    paddingTop: space.xs,
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  cost: {
    ...numeric,
    color: colors.faint,
    fontSize: type.label,
    fontWeight: weight.medium,
    marginTop: 4,
    textAlign: 'center',
  },
});
