import { type StyleProp, type TextStyle } from 'react-native';

import { exactSignedMoney, signedMoney } from '../../copy/terms';
import { colors } from '../../theme';
import { Money, type MoneySize } from '../../ui/kit';

/**
 * A result or a score: signed and green/red, except exactly nothing, which
 * reads "$0" in muted ink rather than "+$0". Written the app's one way
 * ("+$446.5K", "-$1.06M", "+$3,500"); screen readers hear the same figure.
 * `compact={false}` gives exact dollars, kept for a row's opened math.
 */
export function NetMoney({
  value,
  size = 'value',
  compact = true,
  style,
  accessibilityLabel,
}: {
  value: number;
  size?: MoneySize;
  /** false for the exact amount ("+$136,000") inside a row's opened math. */
  compact?: boolean;
  style?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
}) {
  const zero = Math.round(value) === 0;
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
