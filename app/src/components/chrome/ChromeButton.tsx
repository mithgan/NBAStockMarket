/**
 * The status row's compact controls: Rules, Refresh (or Reconcile), Practice.
 *
 * Icon first, name second. On a phone the name sits under the icon so three
 * controls fit beside the facts; on a wide screen it sits beside the icon; on a
 * very narrow phone only the icon shows and the name lives in the accessibility
 * label. Every placement keeps the full 44x44 hit area — no hitSlop.
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, control, fonts, radius, space, type, weight } from '../../theme';

export type ChromeButtonPlacement = 'stacked' | 'inline' | 'icon';

export function ChromeButton({
  icon,
  label,
  accessibilityLabel,
  onPress,
  disabled = false,
  busy = false,
  placement,
  tone = 'plain',
}: {
  /** Rendered with the colour the button hands it. */
  icon: (color: string) => ReactNode;
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  placement: ChromeButtonPlacement;
  /** Gold only for the one control that needs the player now (Reconcile). */
  tone?: 'plain' | 'gold';
}) {
  const gold = tone === 'gold';
  const color = disabled ? colors.faint : gold ? colors.goldInk : colors.muted;
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={() => {
        if (!disabled) onPress();
      }}
      style={({ pressed }) => [
        styles.base,
        placement === 'inline' ? styles.inline : styles.stacked,
        gold && styles.gold,
        gold && placement === 'inline' && styles.goldInline,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {icon(color)}
      {placement === 'icon' ? null : (
        <Text
          maxFontSizeMultiplier={1.3}
          style={[styles.label, placement === 'inline' && styles.labelInline, { color }]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minWidth: control.icon,
    minHeight: control.height,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  stacked: {
    flexDirection: 'column',
    gap: 1,
    paddingHorizontal: space.xs,
  },
  inline: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: space.sm + 2,
  },
  gold: {
    backgroundColor: colors.goldSoft,
    borderColor: colors.goldLine,
  },
  goldInline: {
    paddingHorizontal: space.md,
  },
  label: {
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.bold,
    lineHeight: 13,
  },
  labelInline: {
    fontSize: type.body,
    lineHeight: 17,
  },
  disabled: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.65,
  },
});
