/**
 * A portrait phone's explainer under the Market's sort ("Value: …", or how a
 * short works), with its × (walk 16 T1-01): it is for a first move, so the
 * player can give its room back to the list at once. The × is a full 44px
 * target that reaches into the screen's gutter and the space above and below
 * the words, so the line keeps its own height and nearly all its width.
 */
import { forwardRef } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { colors, fonts, space, type, weight } from '../../theme';

/** `data-explainer`, so the screen can tell a focused × from the rest. */
const EXPLAINER_MARKER = { dataSet: { explainer: '1' } } as object;

export const ExplainerTip = forwardRef<View, {
  text: string;
  closeLabel: string;
  onClose: () => void;
  textStyle?: StyleProp<TextStyle>;
  style?: StyleProp<ViewStyle>;
  /**
   * The × ends the last line of a paragraph (the Short side's three lines):
   * it takes the room of its own glyph there, not a column beside every line.
   */
  inline?: boolean;
}>(function ExplainerTip({ text, closeLabel, onClose, textStyle, style, inline = false }, ref) {
  if (inline) {
    // The last word and the × never part: a line cannot break between them.
    const cut = text.lastIndexOf(' ');
    const head = cut < 0 ? '' : text.slice(0, cut + 1);
    const tail = cut < 0 ? text : text.slice(cut + 1);
    return (
      <View ref={ref} style={style} {...EXPLAINER_MARKER}>
        <Text maxFontSizeMultiplier={1.4} style={textStyle}>
          {head}
          <Text style={styles.glued}>
          {`${tail}\u00A0`}
          <Text
            accessibilityLabel={closeLabel}
            accessibilityRole="button"
            onPress={onClose}
            style={styles.inlineClose}
            {...({
              tabIndex: 0,
              onKeyDown: (event: { key: string; preventDefault: () => void }) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                onClose();
              },
            } as object)}
          >
            ×
          </Text>
          </Text>
        </Text>
      </View>
    );
  }
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
    alignItems: 'center',
    columnGap: space.xs,
  },
  text: {
    flexShrink: 1,
    flexGrow: 1,
  },
  close: {
    width: 40,
    minHeight: 44,
    // 44px tall and 40 wide to a finger, 17px tall and 28 wide to the line.
    marginVertical: -13.5,
    marginRight: -12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glued: {
    whiteSpace: 'nowrap',
  } as TextStyle,
  inlineClose: {
    // Inline padding: a 44px-tall target that leaves the line's height alone.
    paddingHorizontal: 10,
    paddingVertical: 13,
    // Drawn as an inline block: the margins give the padding's height back to
    // the line, and most of its width (it overhangs the space before it and
    // the gutter after it), so the × never takes a line of its own.
    marginVertical: -13,
    marginLeft: -4,
    marginRight: -12,
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.heavy,
    cursor: 'pointer',
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
