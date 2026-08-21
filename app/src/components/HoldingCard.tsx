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
 * - DIVIDENDS — what this player's nights have done to YOUR cash, supplied
 *   by the server's complete account aggregate so a mid-season buy never
 *   claims payouts you were not holding for. Signed both ways: the word,
 *   unlike "paid", survives a negative night. His per-night rate rides below.
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
  /** What he has paid THIS account, from the complete server aggregate. */
  received: number | null;
  onPress: () => void;
  /** Recent settled games; the sparkline only draws with two or more. */
  trend?: TrendPoint[];
}) {
  const { player, currentPrice, costBasis } = holding;
  const paidColor = received === null
    ? colors.muted
    : received >= 0
      ? colors.green
      : colors.red;
  const receivedLabel = received === null
    ? 'Season dividend history unavailable'
    : `Dividends ${formatSignedMoney(received)} to you`;
  // Rate, then reliability: how much when he plays, and how often he pays.
  const rateCaption = dividends.perGame === null
    ? 'No settled games yet'
    : `${formatCompactSignedMoney(dividends.perGame)} a night · paid ${dividends.paidNights} of ${dividends.gamesPlayed}`;
  return (
    <Pressable
      accessibilityLabel={`View ${player.name} details. ${receivedLabel}. Pays ${dividends.perGame === null ? 'nothing yet' : `${formatSignedMoney(dividends.perGame)} per night, and paid on ${dividends.paidNights} of ${dividends.gamesPlayed} settled nights`}. Value ${formatMoney(currentPrice)} against ${formatMoney(costBasis)} paid including fee.`}
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
        {/* Rate alone: the shopping band (tier) matters in the market, not
            on a roster you already own. */}
        <Text numberOfLines={1} style={styles.meta}>{rateCaption}</Text>
      </View>
      {trend && trend.length > 1 ? <Sparkline points={trend} /> : null}
      {/* One figure per row, unlabeled: the section header says SEASON
          DIVIDENDS once, and a money figure on a player's row reads as his
          by proximity. It is the row's only loud element. */}
      <Text
        maxFontSizeMultiplier={1.4}
        numberOfLines={1}
        style={[styles.paid, { color: paidColor }]}
      >
        {received === null ? '—' : formatCompactSignedMoney(received)}
      </Text>
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
  // The money tier (three-size discipline): loud through weight and colour
  // against a quiet row, not through a fourth type size.
  paid: {
    ...numeric,
    flexShrink: 0,
    fontSize: 17,
    fontWeight: weight.black,
  },
});
