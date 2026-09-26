import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

import { formatAt, type PartPrecision } from '../../data/rosterView';
import { colors, fonts, type, weight } from '../../theme';
import { moneyColor } from '../../ui/kit';

/**
 * Money with one more digit ("$137.5K", "$4.85M", "$3,500") for figures the
 * screen shows side by side: a row's price against its dividend, a section's
 * total above its rows, the score's parts. At that precision the figures
 * visibly add up; the kit's compact `Money` stays for lone headline numbers.
 * Signed results are green or red, exactly $0 is muted, prices are plain.
 */
export function FineMoney({
  value,
  signed = true,
  precision = 'fine',
  size = 'value',
  style,
  accessibilityLabel,
}: {
  value: number;
  /** false for a price or a dividend, which is neither a gain nor a loss. */
  signed?: boolean;
  /** More digits where figures must visibly add up (see `breakdownPrecision`). */
  precision?: PartPrecision;
  size?: 'label' | 'body' | 'value' | 'title';
  style?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
}) {
  return (
    <Text
      // Screen readers hear the figure the screen shows.
      accessibilityLabel={accessibilityLabel ?? formatAt(value, precision, signed)}
      maxFontSizeMultiplier={1.4}
      style={[
        styles.money,
        { fontSize: type[size], color: signed ? moneyColor(value) : colors.text },
        style,
      ]}
    >
      {formatAt(value, precision, signed)}
    </Text>
  );
}

const styles = StyleSheet.create({
  money: {
    fontFamily: fonts.display,
    fontVariant: ['tabular-nums'],
    fontWeight: weight.heavy,
  },
});
