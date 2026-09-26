/**
 * A way past the Market list by keyboard (walk 8 T3-I1): each row is two or
 * three Tab stops, so thirty players took about ninety presses. The link sits
 * after the toolbar, hidden until it has focus; it moves focus to the end
 * marker under the list (also shown only while focused), so the next Tab
 * reaches what follows the list.
 */
import { forwardRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, space, type, weight } from '../../theme';
import { visuallyHidden } from '../../ui/kit';

export function SkipLink({ label, onPress }: { label: string; onPress: () => void }) {
  const [shown, setShown] = useState(false);
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onBlur={() => setShown(false)}
      onFocus={() => setShown(true)}
      onPress={onPress}
      style={shown ? styles.shown : visuallyHidden}
    >
      <Text maxFontSizeMultiplier={1.4} style={styles.text}>{label}</Text>
    </Pressable>
  );
}

/** Where the skip link lands: focusable by script only (not a Tab stop). */
export const ListEnd = forwardRef<View, { label: string }>(function ListEnd({ label }, ref) {
  const [shown, setShown] = useState(false);
  return (
    <View
      ref={ref}
      onBlur={() => setShown(false)}
      onFocus={() => setShown(true)}
      style={shown ? styles.shown : visuallyHidden}
      {...({ tabIndex: -1 } as object)}
    >
      <Text maxFontSizeMultiplier={1.4} style={styles.text}>{label}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  shown: {
    alignSelf: 'flex-start',
    marginHorizontal: space.md,
    marginVertical: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderWidth: 2,
    borderColor: colors.focus,
    backgroundColor: colors.surfaceRaised,
  },
  text: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.caption,
    fontWeight: weight.bold,
  },
});
