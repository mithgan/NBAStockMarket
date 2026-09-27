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

/**
 * `role`: "Back to the practice controls" is a link, as the one Roster,
 * Results and Leaders end with (walk 16 T3-04: a reader heard "button" here).
 */
export function SkipLink({ label, onPress, role = 'button' }: { label: string; onPress: () => void; role?: 'button' | 'link' }) {
  const [shown, setShown] = useState(false);
  if (role === 'link') {
    // react-native-web leaves a link's Enter to the browser, which never
    // clicks a div: the link answers Enter and a click itself, as SimBar's does.
    return (
      <View
        accessibilityLabel={label}
        accessibilityRole="link"
        onBlur={() => setShown(false)}
        onFocus={() => setShown(true)}
        style={shown ? styles.shown : visuallyHidden}
        {...({
          tabIndex: 0,
          onClick: () => onPress(),
          onKeyDown: (event: { key: string; preventDefault: () => void }) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            onPress();
          },
        } as object)}
      >
        <Text maxFontSizeMultiplier={1.4} style={styles.text}>{label}</Text>
      </View>
    );
  }
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole={role}
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
  // 44px tall like the frame's other controls (it was 36px: walk 15 T3-10).
  shown: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
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
