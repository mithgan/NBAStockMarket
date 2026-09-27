/**
 * A portrait phone's explainer under the Market's sort ("Value: …", or how a
 * short works), with its × (walk 16 T1-01): it is for a first move, so the
 * player can give its room back to the list at once. The × is a full 44px
 * target that reaches into the screen's gutter and the space above and below
 * the words, so the line keeps its own height and nearly all its width. It
 * sits in its own column beside a paragraph (the Short side), level with the
 * first line.
 */
import { forwardRef } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { colors, fonts, type, weight } from '../../theme';

/** `data-explainer`, so the screen can tell a focused × from the rest. */
const EXPLAINER_MARKER = { dataSet: { explainer: '1' } } as object;

export const ExplainerTip = forwardRef<View, {
  text: string;
  closeLabel: string;
  onClose: () => void;
  textStyle?: StyleProp<TextStyle>;
  style?: StyleProp<ViewStyle>;
}>(function ExplainerTip({ text, closeLabel, onClose, textStyle, style }, ref) {
  // The × has its own right-hand column, level with the first line, on both
  // sides (walk 17 T1-04: on the Short side it trailed the paragraph's last
  // word and read as a stray character).
  return (
    <View ref={ref} style={[styles.row, style]} {...EXPLAINER_MARKER}>
      <Text maxFontSizeMultiplier={1.4} style={[styles.text, textStyle]}>{text}</Text>
      <Pressable
        accessibilityLabel={closeLabel}
        accessibilityRole="button"
        onPress={onClose}
        style={(state) => [styles.close, (state as { hovered?: boolean }).hovered === true && styles.closeHover, state.pressed && styles.pressed]}
      >
        <Text maxFontSizeMultiplier={1.4} style={styles.closeText}>×</Text>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    // Level with the first line however many lines the words take.
    alignItems: 'flex-start',
  },
  text: {
    flexShrink: 1,
    flexGrow: 1,
  },
  close: {
    width: 44,
    minHeight: 44,
    // 44px each way to a finger (the app's floor), 17px tall and 28 wide to
    // the line: it reaches into the gutter.
    marginVertical: -13.5,
    marginRight: -16,
    // Its left edge overlaps the words' box a little, so the paragraph keeps
    // nearly its width (the Short side's three lines stay three at 375px);
    // the glyph keeps about 9px clear of the longest line.
    marginLeft: -8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeHover: {
    backgroundColor: colors.surfaceHigh,
  },
  closeText: {
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.heavy,
    lineHeight: 17,
  },
  pressed: {
    opacity: 0.72,
  },
});
