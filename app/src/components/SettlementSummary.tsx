import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { TrendPoint } from '../data/trendPresentation';
import type { Player } from '../data/types';
import { formatCompactSignedMoney, formatSignedMoney } from '../format';
import type { GameHolding } from '../state/game';
import { colors, fonts, numeric, space, type, weight } from '../theme';
import { rowMarker } from '../ui/domMarkers';
import { PlayerAvatar } from './PlayerAvatar';

export interface NightContribution {
  player: Player;
  netPoints: number;
  expectedNetPoints: number;
  dividend: number;
}

/**
 * What each held player paid on one settled night, biggest absolute payout
 * first so the mover that explains the total leads the list.
 */
export function nightContributions(
  holdings: readonly GameHolding[],
  playerById: Map<string, Player>,
  playerTrends: Record<string, TrendPoint[]>,
  settledDate: string | null,
): NightContribution[] {
  if (settledDate === null) return [];
  const contributions: NightContribution[] = [];
  for (const holding of holdings) {
    const player = playerById.get(holding.player_id);
    if (!player) continue;
    const point = (playerTrends[holding.player_id] ?? []).find(
      (trendPoint) => trendPoint.date === settledDate,
    );
    if (point) {
      contributions.push({
        player,
        netPoints: point.np,
        expectedNetPoints: point.expected_np,
        dividend: point.dividend_per_holder,
      });
    }
  }
  return contributions.sort((a, b) => Math.abs(b.dividend) - Math.abs(a.dividend));
}

/**
 * A one-row recap of the last settled night — headline giver plus the net —
 * that expands into the per-player breakdown on press.
 */
export function SettlementSummary({ contributions, settledDate }: {
  contributions: NightContribution[];
  settledDate: string;
}) {
  const [expanded, setExpanded] = useState(false);
  if (contributions.length === 0) return null;
  const net = contributions.reduce((total, contribution) => total + contribution.dividend, 0);
  const positive = net >= 0;
  // The list arrives sorted by absolute payout, so the first positive
  // dividend is the night's best giver.
  const highlight = contributions.find((contribution) => contribution.dividend > 0);
  return (
    <View style={styles.block}>
      <Pressable
        accessibilityHint="Shows what each of your players paid on this date"
        accessibilityLabel={`Settled ${settledDate}. Your players paid ${formatSignedMoney(net)} across ${contributions.length} games.`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        {...rowMarker}
        onPress={() => setExpanded((current) => !current)}
        style={({ pressed }) => [styles.head, pressed && styles.pressed]}
      >
        <View style={styles.headCopy}>
          <Text style={styles.label}>Last settled night</Text>
          <Text numberOfLines={1} style={styles.headline}>
            {highlight
              ? `${highlight.player.name} gave you ${formatCompactSignedMoney(highlight.dividend)}`
              : `${contributions.length} of your players played`}
          </Text>
        </View>
        <View style={styles.headNumbers}>
          <Text numberOfLines={1} style={[styles.net, positive ? styles.positive : styles.negative]}>
            {formatCompactSignedMoney(net)}
          </Text>
          <Text style={styles.toggle}>{expanded ? 'Hide' : 'Breakdown'}</Text>
        </View>
      </Pressable>
      {expanded ? (
        <View>
          {contributions.map((contribution) => {
            const beat = contribution.netPoints >= contribution.expectedNetPoints;
            return (
              <View key={contribution.player.id} style={styles.row}>
                <PlayerAvatar player={contribution.player} size={30} />
                <View style={styles.rowCopy}>
                  <Text numberOfLines={1} style={styles.rowName}>
                    {contribution.player.name}
                  </Text>
                  <Text numberOfLines={1} style={styles.rowMeta}>
                    {`${contribution.netPoints.toFixed(1)} NP vs ${contribution.expectedNetPoints.toFixed(1)} projected`}
                  </Text>
                </View>
                <Text
                  accessibilityLabel={`${contribution.player.name} ${beat ? 'beat' : 'missed'} projection, paying ${formatSignedMoney(contribution.dividend)}`}
                  numberOfLines={1}
                  style={[styles.rowValue, contribution.dividend >= 0 ? styles.positive : styles.negative]}
                >
                  {formatCompactSignedMoney(contribution.dividend)}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  head: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  pressed: { backgroundColor: colors.surface },
  headCopy: { flex: 1, minWidth: 0 },
  label: {
    color: colors.faint,
    fontFamily: fonts.body,
    fontSize: type.body,
    fontWeight: weight.medium,
  },
  headline: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
    marginTop: 2,
  },
  headNumbers: { alignItems: 'flex-end', flexShrink: 0 },
  net: { ...numeric, fontSize: type.value, fontWeight: weight.heavy },
  toggle: {
    color: colors.goldInk,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.bold,
    marginTop: 2,
  },
  row: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
  },
  rowCopy: { flex: 1, minWidth: 0 },
  rowName: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.bold,
  },
  rowMeta: {
    ...numeric,
    color: colors.faint,
    fontSize: type.body,
    fontWeight: weight.medium,
    marginTop: 1,
  },
  rowValue: { ...numeric, fontSize: type.value, fontWeight: weight.heavy, flexShrink: 0 },
  positive: { color: colors.green },
  negative: { color: colors.red },
});
