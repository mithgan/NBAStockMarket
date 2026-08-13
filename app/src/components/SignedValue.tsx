import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

import { numeric, type, weight } from '../theme';

/**
 * A signed P&L figure in tabular numerals. The caller resolves the colour
 * (green/red per its own sign convention) so this stays one dumb Text that
 * cards and rows can drop anywhere.
 */
export function SignedValue({
  label,
  color,
  style,
  accessibilityLabel,
}: {
  label: string;
  color: string;
  style?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
}) {
  return (
    <Text
      accessibilityLabel={accessibilityLabel}
      maxFontSizeMultiplier={1.4}
      numberOfLines={1}
      style={[styles.value, { color }, style]}
    >
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  value: {
    ...numeric,
    fontSize: type.value,
    fontWeight: weight.heavy,
    textAlign: 'center',
    alignSelf: 'stretch',
  },
});
