/**
 * An active search or Watching filter, in a folded toolbar's free space (walk
 * 18 T4-10: in landscape the filter showed only as a dot on "Search & sort"):
 * its words and count, and a × that clears it. The chip is drawn on the
 * toolbar's line, never over the rows.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, control, fonts, radius, space, type, weight } from '../../theme';

export function FilterChip({
  text,
  spoken,
  clearName,
  onClear,
}: {
  text: string;
  spoken: string;
  clearName: string;
  onClear: () => void;
}) {
  return (
    <View style={styles.chip}>
      <Text accessibilityLabel={spoken} maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.text}>
        {text}
      </Text>
      <Pressable
        accessibilityLabel={clearName}
        accessibilityRole="button"
        onPress={onClear}
        style={({ pressed }) => [styles.clear, pressed && styles.pressed]}
      >
        <Text maxFontSizeMultiplier={1.3} style={styles.clearGlyph}>{'×'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    minWidth: 0,
    minHeight: control.height,
    paddingLeft: space.sm,
    borderWidth: 1,
    borderColor: colors.controlBorder,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  text: {
    flexShrink: 1,
    minWidth: 0,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: type.label,
    fontWeight: weight.bold,
  },
  clear: {
    // A whole 44px target, as every control has (theme control.height).
    minWidth: control.height,
    minHeight: control.height,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearGlyph: {
    color: colors.text,
    fontSize: type.body,
    fontWeight: weight.bold,
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.6,
  },
});
