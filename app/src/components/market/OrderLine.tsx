/**
 * One quiet line under the sort (walk 9 T4-10, T1-16, T2-12): the list's
 * order in words, an unusual order said plainly (the order button beside the
 * sort flips it back, so there is no second button), or that the order is
 * from before the latest games, with Re-sort. It always keeps the height of
 * its longest wording (invisible copies under it: the held wording with
 * Re-sort, and its own longest), from the first view on, so the list below
 * never moves when a night lands or the order flips (walk 11 T4-08).
 */
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, fonts, space, type, weight } from '../../theme';

export function OrderLine({
  text,
  tone,
  reserve,
  resort,
  reserveResort = true,
  reserveOwn,
  centred = false,
  style,
}: {
  text: string;
  tone: 'quiet' | 'flipped' | 'stale';
  /** The line's longest wording, kept as an invisible copy for its height. */
  reserve: string;
  /** Re-sort for the latest games: its button's name and press. */
  resort: { name: string; onPress: () => void } | null;
  /** The reserve keeps Re-sort's height too (from the first games on, orderLine). */
  reserveResort?: boolean;
  /** The line's own longest wording without Re-sort (a flipped order), kept too. */
  reserveOwn?: string;
  /**
   * The shown words sit mid-reserve (a phone, walk 16 T1-02): the plain line
   * reads as spacing, not a gap, and the held wording swaps in without a jump.
   */
  centred?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const words = (shown: string, action: boolean, ghost: boolean) => (
    <View style={styles.line}>
      <Text maxFontSizeMultiplier={1.4} style={[styles.text, !ghost && tone === 'flipped' && styles.flipped, !ghost && tone === 'stale' && styles.stale]}>
        {shown}
      </Text>
      {action ? (
        ghost ? (
          <View style={styles.action}>
            <Text maxFontSizeMultiplier={1.4} style={styles.actionText}>Re-sort</Text>
          </View>
        ) : (
          <Pressable
            accessibilityLabel={resort?.name}
            accessibilityRole="button"
            onPress={resort?.onPress}
            style={(state) => [styles.action, (state as { hovered?: boolean }).hovered === true && styles.actionHover, state.pressed && styles.pressed]}
          >
            <Text maxFontSizeMultiplier={1.4} style={styles.actionText}>Re-sort</Text>
          </Pressable>
        )
      ) : null}
    </View>
  );
  return (
    <View style={[styles.wrap, style]}>
      <View style={[styles.layer, centred && styles.centred]}>{words(text, resort !== null, false)}</View>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.layer, styles.ghost]}
        {...({ 'aria-hidden': true } as object)}
      >
        {words(reserve, reserveResort || resort !== null, true)}
      </View>
      {reserveOwn ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.layer, styles.ghost]}
          {...({ 'aria-hidden': true } as object)}
        >
          {words(reserveOwn, false, true)}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  layer: {
    width: '100%',
    flexShrink: 0,
  },
  centred: {
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  ghost: {
    marginLeft: '-100%',
    opacity: 0,
    pointerEvents: 'none',
  },
  line: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: space.sm,
  },
  text: {
    flexShrink: 1,
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.caption,
    fontWeight: weight.bold,
    lineHeight: 17,
  },
  flipped: {
    color: colors.goldInk,
  },
  stale: {
    color: colors.text,
  },
  action: {
    // A text button in the line, underlined, as an inline link: a full 44px
    // target that reaches into the space above and below, so the line keeps
    // its 28px (the audit found a 53x28 target).
    minHeight: 44,
    marginVertical: -8,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
  },
  actionHover: {
    backgroundColor: colors.surfaceHigh,
  },
  actionText: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.caption,
    fontWeight: weight.heavy,
    textDecorationLine: 'underline',
  },
  pressed: {
    opacity: 0.72,
  },
});
