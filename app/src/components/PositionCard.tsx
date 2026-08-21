import { StyleSheet, Text, View } from 'react-native';

import { PlayerAvatar } from './PlayerAvatar';
import { SignedValue } from './SignedValue';
import { formatCompactSignedMoney } from '../format';
import type { Player } from '../data/types';
import { colors, fonts, numeric, radius, space, type, weight } from '../theme';

/**
 * One play (SHORT / BOOST) as a portrait card: kind tab, headshot, the
 * marked-to-market value, and a clamp meter. The meter fills outward from the
 * midpoint — the full half-track is `clampValue` — so a maxed-out play reads
 * as a complete half-bar at a glance, up to the right in green, down to the
 * left in red.
 */
export function PositionCard({
  player,
  kind,
  meta,
  markedValue,
  markedLabel,
  clampValue,
  figureLabel,
}: {
  /** May be missing when a play outlives its market listing. */
  player: Player | undefined;
  kind: string;
  meta: string;
  markedValue: number;
  markedLabel: string;
  clampValue: number;
  /** Tiny caps over the money — ARMED / MARKED / SETTLED. */
  figureLabel?: string;
  /** Kept for call-site compatibility; rows size themselves. */
  width?: number;
  settled?: boolean;
}) {
  const up = markedValue >= 0;
  const color = up ? colors.green : colors.red;
  const fill = clampValue <= 0 ? 0 : Math.min(50, (Math.abs(markedValue) / clampValue) * 50);

  return (
    <View style={styles.row}>
      {player ? <PlayerAvatar player={player} size={36} /> : <View style={styles.avatarGap} />}
      <View style={styles.copy}>
        <Text numberOfLines={1} style={styles.kicker}>{kind}</Text>
        <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.name}>
          {player?.name ?? 'Unknown player'}
        </Text>
        <Text numberOfLines={1} style={styles.meta}>{meta}</Text>
      </View>
      <View style={styles.numbers}>
        {figureLabel ? <Text numberOfLines={1} style={styles.figureLabel}>{figureLabel}</Text> : null}
        <SignedValue
          accessibilityLabel={markedLabel}
          color={color}
          label={formatCompactSignedMoney(markedValue)}
          style={styles.marked}
        />
        {/* The clamp meter fills outward from its midpoint: a maxed play
            reads as a full half-bar, up right in green, down left in red. */}
        <View style={styles.clampTrack}>
          <View style={styles.clampMidpoint} />
          <View style={[styles.clampFill, up ? styles.clampUp : styles.clampDown, { width: `${fill}%` }]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  avatarGap: { width: 36, height: 36 },
  copy: { flex: 1, minWidth: 0 },
  kicker: {
    color: colors.goldInk,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.black,
    letterSpacing: 0.8,
  },
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
    marginTop: 1,
  },
  numbers: { alignItems: 'flex-end', flexShrink: 0, gap: 3, minWidth: 84 },
  figureLabel: {
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.black,
    letterSpacing: 0.8,
  },
  marked: { fontSize: 17, fontWeight: weight.black, textAlign: 'right', alignSelf: 'auto' },
  clampTrack: {
    alignSelf: 'stretch',
    height: 4,
    borderRadius: radius.xs,
    backgroundColor: colors.border,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  clampMidpoint: {
    position: 'absolute',
    left: '50%',
    width: 1,
    top: 0,
    bottom: 0,
    backgroundColor: colors.borderStrong,
  },
  clampFill: {
    position: 'absolute',
    left: '50%',
    height: 4,
    borderRadius: radius.xs,
  },
  clampUp: { backgroundColor: colors.green },
  // Negative marks grow leftward: anchor the fill's right edge to the midpoint.
  clampDown: { backgroundColor: colors.red, left: undefined, right: '50%' },
});
