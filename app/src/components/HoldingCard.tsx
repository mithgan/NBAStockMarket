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
 * - PAID — what this player has actually paid YOU, summed from your own
 *   ledger, so a mid-season buy never claims payouts you were not holding
 *   for. His per-night rate rides as the caption.
 * - VALUE — share price against cost including fee; this only moves when
 *   trading does, so in the demo it mostly reads as the quiet fee line.
 *
 * The old portrait card showed one unlabeled red number (the fee) while the
 * player printed money into cash — the single most confusing pixel in the
 * play-test feedback.
 */
export function HoldingRow({ holding, dividends, received, onPress, trend }: {
  holding: {
    player: Player;
    currentPrice: number;
    costBasis: number;
    unrealizedPnl: number;
  };
  /** Season dividend summary for this player — rate, games, total. */
  dividends: DividendSummary;
  /** What he has paid THIS account, from the activity ledger. */
  received: number;
  onPress: () => void;
  /** Recent settled games; the sparkline only draws with two or more. */
  trend?: TrendPoint[];
}) {
  const { player, currentPrice, costBasis } = holding;
  const paidColor = received >= 0 ? colors.green : colors.red;
  const rateCaption = dividends.perGame === null
    ? 'No settled games yet'
    : `${formatCompactSignedMoney(dividends.perGame)} a night`;
  return (
    <Pressable
      accessibilityLabel={`View ${player.name} details. Has paid you ${formatSignedMoney(received)}. Pays ${dividends.perGame === null ? 'nothing yet' : `${formatSignedMoney(dividends.perGame)} per night across ${dividends.gamesPlayed} settled games`}. Value ${formatMoney(currentPrice)} against ${formatMoney(costBasis)} paid including fee.`}
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
      {/* One figure per row: what he has paid you. Share value and cost live
          in the roster header's total and in the profile — putting a second
          money story on every row is what made dividends and price blur. */}
      <View style={styles.numbers}>
        <Text style={styles.figureLabel}>PAID YOU</Text>
        <Text
          maxFontSizeMultiplier={1.4}
          numberOfLines={1}
          style={[styles.paid, { color: paidColor }]}
        >
          {formatCompactSignedMoney(received)}
        </Text>
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
  figureLabel: {
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: 10,
    fontWeight: weight.black,
    letterSpacing: 0.8,
  },
  // The stream is the row's loudest figure — louder than the name, because
  // the row exists to answer "what has he paid me".
  paid: {
    ...numeric,
    fontSize: 18,
    fontWeight: weight.black,
  },
});
