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
  width,
}: {
  /** May be missing when a play outlives its market listing. */
  player: Player | undefined;
  kind: string;
  meta: string;
  markedValue: number;
  markedLabel: string;
  clampValue: number;
  width: number;
}) {
  const up = markedValue >= 0;
  const color = up ? colors.green : colors.red;
  const fill = clampValue <= 0 ? 0 : Math.min(50, (Math.abs(markedValue) / clampValue) * 50);

  return (
    <View style={[styles.card, { width }]}>
      <View style={styles.kindTab}>
        <Text style={styles.kindText}>{kind}</Text>
      </View>
      <View style={styles.portrait}>
        {player ? <PlayerAvatar player={player} size={64} /> : null}
      </View>
      <Text maxFontSizeMultiplier={1.3} numberOfLines={2} style={styles.name}>
        {player?.name ?? 'Unknown player'}
      </Text>
      <SignedValue
        accessibilityLabel={markedLabel}
        color={color}
        label={formatCompactSignedMoney(markedValue)}
        style={styles.marked}
      />
      <View style={styles.clampTrack}>
        <View style={styles.clampMidpoint} />
        <View style={[styles.clampFill, up ? styles.clampUp : styles.clampDown, { width: `${fill}%` }]} />
      </View>
      <Text numberOfLines={2} style={styles.meta}>
        {meta}
      </Text>
    </View>
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
  kindTab: {
    position: 'absolute',
    top: 0,
    alignSelf: 'center',
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    backgroundColor: colors.goldSoft,
    borderBottomLeftRadius: radius.sm,
    borderBottomRightRadius: radius.sm,
  },
  kindText: {
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
  name: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.heavy,
    textAlign: 'center',
    marginTop: space.sm,
    // Two-line reservation, so one long surname doesn't misalign a row of cards.
    minHeight: 34,
  },
  marked: { marginTop: 2 },
  clampTrack: {
    alignSelf: 'stretch',
    height: 4,
    marginTop: space.sm,
    marginHorizontal: space.xs,
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
  meta: {
    ...numeric,
    color: colors.faint,
    fontSize: type.label,
    fontWeight: weight.medium,
    textAlign: 'center',
    marginTop: space.sm,
  },
});
