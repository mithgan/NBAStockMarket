import { Text, type StyleProp, type TextStyle } from 'react-native';

import { exactSignedMoney, signedMoney } from '../../copy/terms';
import { colors, fonts, type, weight } from '../../theme';
import { Money, moneyColor, type MoneySize } from '../../ui/kit';

/** The kit's money sizes, for a figure that sets its own text (`format`). */
const SIZE: Record<MoneySize, number> = {
  label: type.label,
  body: type.body,
  value: type.value,
  title: type.title,
  display: type.display,
  hero: type.hero,
};

/**
 * A result or a score: signed and green/red, except exactly nothing, which
 * reads "$0" in muted ink rather than "+$0". Written the app's one way
 * ("+$446.5K", "-$1.06M", "+$3,500"); screen readers hear the same figure.
 * `compact={false}` gives exact dollars, kept for a row's opened math.
 * `format` sets the text where a list holds its figures to one precision
 * (the Leaders board: "+$8.3K" beside "+$423.9K", walk 15 T2-01), drawn in
 * the kit's money type.
 */
export function NetMoney({
  value,
  size = 'value',
  compact = true,
  format,
  style,
  accessibilityLabel,
}: {
  value: number;
  size?: MoneySize;
  /** false for the exact amount ("+$136,000") inside a row's opened math. */
  compact?: boolean;
  /** The figure's text (signed), for a list that sets one precision for all its rows. */
  format?: (value: number) => string;
  style?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
}) {
  const zero = Math.round(value) === 0;
  if (format) {
    const text = zero ? '$0' : format(value);
    const fontSize = SIZE[size];
    return (
      <Text
        accessibilityLabel={accessibilityLabel ?? text}
        maxFontSizeMultiplier={size === 'hero' || size === 'display' ? 1.2 : 1.4}
        style={[
          {
            fontFamily: fonts.display,
            fontVariant: ['tabular-nums'],
            fontWeight: weight.heavy,
            fontSize,
            letterSpacing: fontSize >= type.display ? -1.2 : 0,
            color: zero ? colors.muted : moneyColor(value),
          },
          style,
        ]}
      >
        {text}
      </Text>
    );
  }
  const spoken = accessibilityLabel ?? (zero ? '$0' : compact ? signedMoney(value) : exactSignedMoney(value));
  return (
    <Money
      accessibilityLabel={spoken}
      colored={!zero}
      compact={compact}
      signed={!zero}
      size={size}
      style={zero ? [{ color: colors.muted }, style] : style}
      value={zero ? 0 : value}
    />
  );
}
