import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { TrendPoint } from '../data/trendPresentation';
import type { Player } from '../data/types';
import { formatCompactSignedMoney, formatSignedMoney } from '../format';
import type { ActivityEvent } from '../state/game';
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
 * What each player held at settlement paid on one night, reconstructed from
 * account-specific dividend activity rather than today's roster.
 */
export function nightContributions(
  activity: readonly ActivityEvent[],
  playerById: Map<string, Player>,
  playerTrends: Record<string, TrendPoint[]>,
  settledDate: string | null,
): NightContribution[] {
  if (settledDate === null) return [];
  const contributions: NightContribution[] = [];
  for (const entry of activity) {
    if (entry.kind !== 'dividend' || entry.date !== settledDate) continue;
    const player = playerById.get(entry.playerId);
    if (!player) continue;
    const point = (playerTrends[entry.playerId] ?? []).find(
      (trendPoint) => trendPoint.date === settledDate,
    );
    if (point) {
      contributions.push({
        player,
        netPoints: point.np,
        expectedNetPoints: point.expected_np,
        dividend: entry.cashDelta,
      });
    }
  }
  return contributions.sort((a, b) => Math.abs(b.dividend) - Math.abs(a.dividend));
}

const LEDGER_ROWS_SHOWN = 3;

/**
 * The night ledger — the settlement as the page's centrepiece. Every held
 * player who played, each row carrying its cause: np vs projection, then the
 * money it became. Misses render in red with the exact same structure as
 * hits; the whole block is the doorway to the game log.
 */
export function SettlementSummary({ accountNet, contributions, settledDate, onOpenLog, upcoming }: {
  accountNet: number;
  contributions: NightContribution[];
  settledDate: string;
  onOpenLog: () => void;
  /** Preformatted "who plays next" line — anticipation from the public schedule. */
  upcoming?: string | null;
}) {
  const quiet = contributions.length === 0;
  const shown = contributions.slice(0, LEDGER_ROWS_SHOWN);
  const overflow = contributions.length - shown.length;
  return (
    <View style={styles.block}>
      <Pressable
        accessibilityHint="Opens the game log, every settled night in order"
        accessibilityLabel={quiet
          ? `Settled ${settledDate}. Account dividends ${formatSignedMoney(accountNet)}. Opens the game log.`
          : `Settled ${settledDate}. Your players paid ${formatSignedMoney(accountNet)} across ${contributions.length} games. Opens the game log.`}
        accessibilityRole="button"
        {...rowMarker}
        onPress={onOpenLog}
        style={({ pressed }) => [pressed && styles.pressed]}
      >
        {quiet ? (
          <View style={styles.head}>
            <Text numberOfLines={1} style={[styles.headline, styles.headlineQuiet]}>
              {accountNet === 0
                ? 'No player dividends hit your account last night'
                : `Your players settled ${formatCompactSignedMoney(accountNet)}`}
            </Text>
            <Text style={styles.toggle}>Game log  ›</Text>
          </View>
        ) : (
          <>
            {shown.map((contribution, index) => (
              <View key={contribution.player.id} style={styles.ledgerRow}>
                <PlayerAvatar player={contribution.player} size={24} />
                <Text numberOfLines={1} style={styles.ledgerName}>
                  {contribution.player.name}
                </Text>
                {/* The cause, then its money: beat the projection, get paid. */}
                <Text numberOfLines={1} style={styles.ledgerCause}>
                  {`${contribution.netPoints.toFixed(1)} vs ${contribution.expectedNetPoints.toFixed(1)} proj`}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[styles.ledgerMoney, contribution.dividend >= 0 ? styles.positive : styles.negative]}
                >
                  {formatCompactSignedMoney(contribution.dividend)}
                </Text>
                {index === 0 ? <Text style={styles.toggle}>›</Text> : <Text style={styles.togglePlaceholder}>›</Text>}
              </View>
            ))}
            {overflow > 0 ? (
              <Text numberOfLines={1} style={styles.overflowLine}>
                {`+${overflow} more in the game log  ›`}
              </Text>
            ) : null}
          </>
        )}
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
    paddingVertical: space.xs,
  },
  pressed: { backgroundColor: colors.surface },
  head: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingHorizontal: space.lg,
  },
  headline: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.heavy,
  },
  headlineQuiet: { color: colors.muted, fontWeight: weight.medium },
  ledgerRow: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
  },
  ledgerName: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.bold,
  },
  ledgerCause: {
    ...numeric,
    flexShrink: 0,
    color: colors.faint,
    fontSize: type.label,
    fontWeight: weight.medium,
  },
  ledgerMoney: {
    ...numeric,
    flexShrink: 0,
    minWidth: 64,
    textAlign: 'right',
    fontSize: type.value,
    fontWeight: weight.black,
  },
  overflowLine: {
    color: colors.goldInk,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.bold,
    paddingHorizontal: space.lg,
    paddingTop: 2,
    paddingBottom: space.xs,
    textAlign: 'right',
  },
  toggle: {
    flexShrink: 0,
    color: colors.goldInk,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.bold,
  },
  togglePlaceholder: {
    flexShrink: 0,
    color: 'transparent',
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
    paddingTop: 2,
    paddingBottom: space.xs,
  },
  positive: { color: colors.green },
  negative: { color: colors.red },
});
