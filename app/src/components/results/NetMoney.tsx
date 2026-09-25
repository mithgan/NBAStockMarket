import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

import { exactMoney, exactSignedMoney } from '../../copy/terms';
import { amountFine, signedAmountFine } from '../../data/resultsView';
import { colors, fonts, type, weight } from '../../theme';
import { Money, moneyColor, type MoneySize } from '../../ui/kit';

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
 * reads "$0" in muted ink rather than "+$0".
 *
 * `fine` shows one more digit ("+$446.5K", "-$1,215.5K", "$3,500") where the
 * figure sits beside others it must visibly add up with: a row's dividend and
 * price, or a night's rows and its total (`amountFine`).
 */
export function NetMoney({
  value,
  size = 'value',
  compact = true,
  fine = false,
  signed = true,
  style,
  accessibilityLabel,
}: {
  value: number;
  size?: MoneySize;
  /** false for the exact amount ("+$136,000") instead of "+$136K". */
  compact?: boolean;
  fine?: boolean;
  /** false for an amount that is neither gain nor loss (a price). */
  signed?: boolean;
  style?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
}) {
  const zero = Math.round(value) === 0;
  if (fine) {
    return (
      <Text
        accessibilityLabel={accessibilityLabel ?? (signed && !zero ? exactSignedMoney(value) : exactMoney(value))}
        maxFontSizeMultiplier={1.4}
        style={[
          styles.fine,
          { fontSize: SIZE[size], color: !signed || zero ? colors.muted : moneyColor(value) },
          !signed && styles.plain,
          style,
        ]}
      >
        {signed ? signedAmountFine(value) : amountFine(value)}
      </Text>
    );
  }
  if (zero) {
    return (
      <Money
        accessibilityLabel={accessibilityLabel}
        colored={false}
        compact={compact}
        signed={false}
        size={size}
        style={[{ color: colors.muted }, style]}
        value={0}
      />
    );
  }
  return (
    <Money
      accessibilityLabel={accessibilityLabel}
      compact={compact}
      size={size}
      style={style}
      value={value}
    />
  );
}

const styles = StyleSheet.create({
  fine: {
    fontFamily: fonts.display,
    fontVariant: ['tabular-nums'],
    fontWeight: weight.heavy,
  },
  plain: {
    color: colors.text,
  },
});
