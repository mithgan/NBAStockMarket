import type { StyleProp, TextStyle } from 'react-native';

import { colors } from '../../theme';
import { Money, type MoneySize } from '../../ui/kit';

/**
 * A result or a score: signed and green/red, except exactly nothing, which
 * reads "$0" in muted ink rather than "+$0".
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
  /** false for the exact amount ("+$136,000") instead of "+$136K". */
  compact?: boolean;
  style?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
}) {
  if (Math.round(value) === 0) {
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
