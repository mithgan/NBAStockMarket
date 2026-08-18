import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { DividendSummary } from '../data/dividendMetrics';
import type { TrendPoint } from '../data/trendPresentation';
import type { Player } from '../data/types';
import { formatCompactMoney, formatCompactSignedMoney, formatMoney, formatSignedMoney } from '../format';
import { colors, fonts, numeric, space, type, weight } from '../theme';
import { rowMarker } from '../ui/domMarkers';
import { PlayerAvatar } from './PlayerAvatar';
import { Sparkline } from './Sparkline';

/**
 * One owned player as a ledger row. The money story is split into its two
 * honest halves, each named, because they move for different reasons:
 *
 * - PAID — the dividend stream (with the per-night rate as its caption);
 *   this is what performance controls.
 * - VALUE — share price against cost including fee; this only moves when
 *   trading does, so in the demo it mostly reads as the quiet fee line.
 *
 * The old portrait card showed one unlabeled red number (the fee) while the
 * player printed money into cash — the single most confusing pixel in the
 * play-test feedback.
 */
export function HoldingRow({ holding, dividends, onPress, trend }: {
  holding: {
    player: Player;
    currentPrice: number;
    costBasis: number;
    unrealizedPnl: number;
  };
  /** Season dividend summary for this player — rate, games, total. */
  dividends: DividendSummary;
  onPress: () => void;
  /** Recent settled games; the sparkline only draws with two or more. */
  trend?: TrendPoint[];
}) {
  const { player, currentPrice, costBasis, unrealizedPnl } = holding;
  const paid = dividends.total;
  const paidColor = paid >= 0 ? colors.green : colors.red;
  const rateCaption = dividends.perGame === null
    ? 'No settled games yet'
    : `${formatCompactSignedMoney(dividends.perGame)}/night · ${dividends.gamesPlayed} ${dividends.gamesPlayed === 1 ? 'game' : 'games'}`;
  return (
    <Pressable
      accessibilityLabel={`View ${player.name} details. Paid you ${formatSignedMoney(paid)} across ${dividends.gamesPlayed} settled games. Value ${formatMoney(currentPrice)} against ${formatMoney(costBasis)} paid including fee.`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      {...rowMarker}
    >
      <PlayerAvatar player={player} size={40} />
      <View style={styles.copy}>
        <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.name}>
          {player.name}
        </Text>
        <Text numberOfLines={1} style={styles.meta}>
          {`${player.tier.toUpperCase()} · ${rateCaption}`}
        </Text>
      </View>
      {trend && trend.length > 1 ? <Sparkline points={trend} /> : null}
      <View style={styles.numbers}>
        <View style={styles.figureLine}>
          <Text style={styles.figureLabel}>PAID</Text>
          <Text
            maxFontSizeMultiplier={1.4}
            numberOfLines={1}
            style={[styles.paid, { color: paidColor }]}
          >
            {formatCompactSignedMoney(paid)}
          </Text>
        </View>
        <View style={styles.figureLine}>
          <Text style={styles.figureLabel}>VALUE</Text>
          <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={styles.value}>
            {`${formatCompactMoney(currentPrice)} · ${formatCompactSignedMoney(unrealizedPnl)}`}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  pressed: { backgroundColor: colors.surface },
  copy: { flex: 1, minWidth: 0 },
  name: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
  },
  meta: {
    ...numeric,
    color: colors.faint,
    fontSize: type.label,
    fontWeight: weight.medium,
    marginTop: 2,
  },
  numbers: { alignItems: 'flex-end', flexShrink: 0, gap: 2 },
  figureLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.xs,
  },
  figureLabel: {
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: 10,
    fontWeight: weight.black,
    letterSpacing: 0.8,
  },
  paid: {
    ...numeric,
    fontSize: type.value,
    fontWeight: weight.heavy,
  },
  value: {
    ...numeric,
    color: colors.muted,
    fontSize: type.label,
    fontWeight: weight.bold,
  },
});
