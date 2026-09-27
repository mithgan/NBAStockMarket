import { StyleSheet, View } from 'react-native';

import { colors } from '../../theme';

/** Width every row reserves at its right edge, so numbers line up with or without a chevron. */
export const DISCLOSURE_WIDTH = 16;

/**
 * The small chevron that says a row opens: two borders of a square turned 45°,
 * so it takes the theme's colour like any other line. Decorative — the row
 * itself carries the button role and its expanded state. It flips instantly,
 * never animates, and stays level with the row's first lines when it opens.
 */
export function Disclosure({ open, height }: { open: boolean; height: number }) {
  return (
    <View
      accessibilityElementsHidden
      aria-hidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.box, { height }]}
    >
      <View style={[styles.chevron, open ? styles.up : styles.down]} />
    </View>
  );
}

/** The same width as a chevron, for rows that do not open. */
export function DisclosureSpace() {
  return <View style={styles.space} />;
}

const styles = StyleSheet.create({
  box: {
    width: DISCLOSURE_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  space: {
    width: DISCLOSURE_WIDTH,
  },
  chevron: {
    width: 7,
    height: 7,
    borderColor: colors.faint,
    borderRightWidth: 2,
    borderBottomWidth: 2,
  },
  down: {
    marginTop: -4,
    transform: [{ rotate: '45deg' }],
  },
  up: {
    marginTop: 4,
    transform: [{ rotate: '-135deg' }],
  },
});
