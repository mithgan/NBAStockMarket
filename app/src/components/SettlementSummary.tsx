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
 * The last settled night as one loud line — the money is the sentence — and
 * the doorway to the game log. Tapping goes straight there: the log's top
 * night IS this night's breakdown, so the strip never expands in place.
 */
export function SettlementSummary({ contributions, settledDate, onOpenLog, upcoming }: {
  contributions: NightContribution[];
  settledDate: string;
  onOpenLog: () => void;
  /** Preformatted "who plays next" line — anticipation from the public schedule. */
  upcoming?: string | null;
}) {
  // A night none of your players played still renders the strip: it is the
  // doorway to the game log, and a doorway that disappears cannot be found.
  const quiet = contributions.length === 0;
  const net = contributions.reduce((total, contribution) => total + contribution.dividend, 0);
  const positive = net >= 0;
  // The list arrives sorted by absolute payout, so the first positive
  // dividend is the night's best giver.
  const highlight = contributions.find((contribution) => contribution.dividend > 0);
  return (
    <View style={styles.block}>
      <Pressable
        accessibilityHint="Opens the game log, every settled night in order"
        accessibilityLabel={quiet
          ? `Settled ${settledDate}. None of your players played. Opens the game log.`
          : `Settled ${settledDate}. Your players paid ${formatSignedMoney(net)} across ${contributions.length} games. Opens the game log.`}
        accessibilityRole="button"
        {...rowMarker}
        onPress={onOpenLog}
        style={({ pressed }) => [styles.head, pressed && styles.pressed]}
      >
        {/* The night's headline as the app's own row grammar — the payer's
            face anchors the sentence and the money is the loud word in it —
            rather than a bare line of text. */}
        {highlight ? (
          <View style={styles.headlineRow}>
            <PlayerAvatar player={highlight.player} size={28} />
            <Text numberOfLines={1} style={styles.headline}>
              {`${highlight.player.name} gave you `}
              <Text style={[styles.headlineMoney, highlight.dividend >= 0 ? styles.positive : styles.negative]}>
                {formatCompactSignedMoney(highlight.dividend)}
              </Text>
            </Text>
          </View>
        ) : (
          <Text numberOfLines={1} style={[styles.headline, styles.headlineQuiet]}>
            {quiet
              ? 'None of your players played last night'
              : `${contributions.length} of your players played last night`}
          </Text>
        )}
        <Text style={styles.toggle}>Game log  ›</Text>
      </Pressable>
      {upcoming ? (
        <Text numberOfLines={1} style={styles.upcoming}>{upcoming}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // One hairline below; the hero above flows straight into it.
  block: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  head: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  headlineRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  headline: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.heavy,
  },
  headlineMoney: { ...numeric, fontSize: type.value, fontWeight: weight.black },
  headlineQuiet: { color: colors.muted, fontWeight: weight.medium },
  headNumbers: { alignItems: 'flex-end', flexShrink: 0 },
  // The night's money is the strip's headline — the one figure the user
  // opened the app to learn.
  net: { ...numeric, fontSize: 20, fontWeight: weight.black },
  toggle: {
    flexShrink: 0,
    color: colors.goldInk,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.bold,
  },
  upcoming: {
    color: colors.faint,
    fontFamily: fonts.body,
    fontSize: type.label,
    fontWeight: weight.medium,
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
    marginTop: -2,
  },
  positive: { color: colors.green },
  negative: { color: colors.red },
});
