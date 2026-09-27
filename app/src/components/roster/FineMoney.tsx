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
  colored = signed,
  precision = 'fine',
  size = 'value',
  style,
  accessibilityLabel,
}: {
  value: number;
  /** false for a price or a dividend, which is neither a gain nor a loss. */
  signed?: boolean;
  /** Green or red by sign; false keeps a signed figure neutral (fees before the first game). */
  colored?: boolean;
  /** `fine` (the default), `compact` for per-game figures, `exact` for dollars (see `formatAt`). */
  precision?: PartPrecision;
  /**
   * The headline sizes (the score, the final result) draw like the kit's
   * `Money`, in the Roster's one millions precision (walk 7 T4-14).
   */
  size?: 'label' | 'body' | 'value' | 'title' | 'display' | 'hero';
  style?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
}) {
  const fontSize = type[size];
  const headline = fontSize >= type.display;
  return (
    <Text
      // Screen readers hear the figure the screen shows, as its text; a name
      // is set only when a caller asks for other words (a copy of the text as
      // a name on role-less text added nothing, and was left on unseen copies).
      accessibilityLabel={accessibilityLabel}
      maxFontSizeMultiplier={headline ? 1.2 : 1.4}
      style={[
        styles.money,
        { fontSize, color: colored ? moneyColor(value) : colors.text },
        headline && { letterSpacing: -1.2 },
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
