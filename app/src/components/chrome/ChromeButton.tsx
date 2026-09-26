/**
 * The chrome's compact controls: Rules, Refresh (or Reconcile), Practice, and
 * the practice bar's More at high zoom.
 *
 * Icon first, name second. On a phone the name sits under the icon so three
 * controls fit beside the facts; on a wide screen it sits beside the icon; on a
 * very narrow phone only the icon shows and the name lives in the accessibility
 * label. Every placement keeps the full 44x44 hit area — no hitSlop.
 */
import { forwardRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, type View } from 'react-native';

import { colors, control, fonts, radius, space, type, weight } from '../../theme';

export type ChromeButtonPlacement = 'stacked' | 'inline' | 'icon';

type ChromeButtonProps = {
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
  /** For a control that shows and hides more controls (More). */
  expanded?: boolean;
};

/** Forwards its ref so a menu can hand focus back to the control that opened it. */
export const ChromeButton = forwardRef<View, ChromeButtonProps>(function ChromeButton({
  icon,
  label,
  accessibilityLabel,
  onPress,
  disabled = false,
  busy = false,
  placement,
  tone = 'plain',
  expanded,
}, ref) {
  const gold = tone === 'gold';
  const color = disabled ? colors.faint : gold || expanded ? colors.goldInk : colors.muted;
  return (
    <Pressable
      ref={ref}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      // react-native-web turns only some accessibilityState keys into ARIA
      // (not expanded or busy), so those two are passed as ARIA props as well.
      accessibilityState={{ disabled, busy, expanded }}
      aria-busy={busy || undefined}
      aria-expanded={expanded}
      disabled={disabled}
      onPress={() => {
        if (!disabled) onPress();
      }}
      style={({ pressed }) => [
        styles.base,
        placement === 'inline' ? styles.inline : styles.stacked,
        gold && styles.gold,
        gold && placement === 'inline' && styles.goldInline,
        expanded && styles.expanded,
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
});

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
  // Open: the control reads as pressed in, so it is clear what it opened.
  expanded: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.borderStrong,
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
