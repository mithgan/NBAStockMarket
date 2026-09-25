/**
 * Shared building blocks for the per-game app.
 *
 * Screens compose these instead of re-deciding type, colour and hit area, so a
 * number looks like a number and a button feels like a button on every tab.
 *
 * House rules these enforce:
 *  - every colour comes from `colors.*` (CSS variables that drive the
 *    Appearance themes), never a hex literal;
 *  - every control is at least 44x44 (`control.height`), with no `hitSlop`;
 *  - every number is tabular so columns hold still as values change;
 *  - radius stays at or under `radius.lg` (8) and text at or over 11px;
 *  - green means a gain, red a loss, and nothing else is green or red.
 */
import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { exactSignedMoney, exactMoney, money, signedMoney } from '../copy/terms';
import { colors, control, fonts, headingStyle, labelStyle, radius, space, type, weight } from '../theme';

// ---------------------------------------------------------------------------
// Accessibility helpers

/**
 * Heading level for a header. react-native-web turns `aria-level` on a
 * header into the matching <h1>-<h6>, so a screen's outline reads
 * screen → section → item instead of a flat list of <h1>s. React Native's
 * types do not list the prop yet, hence the cast.
 */
export function headingLevel(level: 1 | 2 | 3 | 4): TextProps {
  return { 'aria-level': level } as unknown as TextProps;
}

/** Present to screen readers, invisible and zero-size on screen. */
export const visuallyHidden: ViewStyle = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  opacity: 0,
};

// ---------------------------------------------------------------------------
// Money

export type MoneySize = 'label' | 'body' | 'value' | 'title' | 'display' | 'hero';

const MONEY_SIZE: Record<MoneySize, number> = {
  label: type.label,
  body: type.body,
  value: type.value,
  title: type.title,
  display: type.display,
  hero: type.hero,
};

/** Green for a gain, red for a loss, muted for exactly zero. */
export function moneyColor(value: number): string {
  if (value > 0) return colors.green;
  if (value < 0) return colors.red;
  return colors.muted;
}

/**
 * A dollar amount. Signed and coloured by default because most money in this
 * app is a result; pass `signed={false}` for prices, which are neither good
 * nor bad. The screen-reader label is always the exact amount.
 */
export function Money({
  value,
  signed = true,
  colored = signed,
  compact = true,
  size = 'value',
  style,
  accessibilityLabel,
}: {
  value: number;
  signed?: boolean;
  colored?: boolean;
  compact?: boolean;
  size?: MoneySize;
  style?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
}) {
  const text = signed
    ? (compact ? signedMoney(value) : exactSignedMoney(value))
    : (compact ? money(value) : exactMoney(value));
  const fontSize = MONEY_SIZE[size];
  return (
    <Text
      accessibilityLabel={accessibilityLabel ?? (signed ? exactSignedMoney(value) : exactMoney(value))}
      maxFontSizeMultiplier={size === 'hero' || size === 'display' ? 1.2 : 1.4}
      style={[
        styles.money,
        {
          fontSize,
          letterSpacing: fontSize >= type.display ? -1.2 : 0,
          color: colored ? moneyColor(value) : colors.text,
        },
        style,
      ]}
    >
      {text}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Text

/** Small uppercase label that names a value. */
export function Label({
  children,
  tone = 'faint',
  style,
}: {
  children: ReactNode;
  tone?: 'faint' | 'muted' | 'gold';
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text
      style={[
        styles.label,
        tone === 'gold' && { color: colors.goldInk },
        tone === 'muted' && { color: colors.muted },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Tag

export type TagTone = 'neutral' | 'gold' | 'green' | 'red' | 'cyan';

const TAG_TONE: Record<TagTone, { fg: string; bg: string }> = {
  neutral: { fg: colors.muted, bg: colors.surfaceRaised },
  gold: { fg: colors.goldInk, bg: colors.goldSoft },
  green: { fg: colors.green, bg: colors.greenSoft },
  red: { fg: colors.red, bg: colors.redSoft },
  cyan: { fg: colors.cyan, bg: colors.cyanSoft },
};

/** A short status word: SHORT, DNP, CORRECTION, ON ROSTER. Not a button. */
export function Tag({ children, tone = 'neutral', style }: {
  children: ReactNode;
  tone?: TagTone;
  style?: StyleProp<ViewStyle>;
}) {
  const t = TAG_TONE[tone];
  return (
    <View style={[styles.tag, { backgroundColor: t.bg }, style]}>
      <Text maxFontSizeMultiplier={1.3} style={[styles.tagText, { color: t.fg }]}>{children}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Button

export type ButtonVariant = 'primary' | 'secondary' | 'quiet';

/**
 * A 44px-tall action. `primary` is gold and reserved for the one thing a row or
 * screen most wants you to do; `secondary` is an outlined neutral; `quiet` is
 * text-only for low-stakes actions such as Exit.
 */
export function Button({
  label,
  onPress,
  variant = 'secondary',
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  width,
  style,
  textStyle,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  width?: number;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  const name = accessibilityLabel ?? label;
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      // react-native-web drops accessibilityHint, so a disabled button would
      // never say why. Carry the reason in the name while it applies.
      accessibilityLabel={disabled && accessibilityHint ? `${name}. ${accessibilityHint}` : name}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        if (!disabled) onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'quiet' && styles.buttonQuiet,
        width !== undefined && { width },
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}
    >
      <Text
        maxFontSizeMultiplier={1.3}
        style={[
          styles.buttonText,
          variant === 'primary' && styles.buttonTextPrimary,
          variant === 'quiet' && styles.buttonTextQuiet,
          textStyle,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Segmented control

export type SegmentOption<K extends string> = { key: K; label: string; hint?: string };

/** Two to four mutually exclusive choices, e.g. Roster / Short. */
export function Segmented<K extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  style,
}: {
  options: SegmentOption<K>[];
  value: K;
  onChange: (key: K) => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View accessibilityLabel={accessibilityLabel} accessibilityRole="tablist" style={[styles.segmented, style]}>
      {options.map((option, index) => {
        const selected = option.key === value;
        return (
          <Pressable
            key={option.key}
            accessibilityHint={option.hint}
            accessibilityLabel={option.label}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            aria-selected={selected}
            onPress={() => onChange(option.key)}
            style={({ pressed }) => [
              styles.segment,
              index > 0 && styles.segmentDivider,
              selected && styles.segmentSelected,
              pressed && !selected && styles.pressed,
            ]}
          >
            <Text maxFontSizeMultiplier={1.3} style={[styles.segmentText, selected && styles.segmentTextSelected]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Layout pieces

/** A section title with an optional right-hand fact, e.g. "Your roster · 10 / 10". */
export function SectionHeader({
  title,
  meta,
  caption,
  right,
  level = 2,
  style,
}: {
  title: string;
  meta?: string;
  caption?: string;
  right?: ReactNode;
  /** Outline level: 1 for a screen title, 2 for a section (default), 3 below. */
  level?: 1 | 2 | 3 | 4;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.sectionHeader, style]}>
      <View style={styles.sectionCopy}>
        <Text accessibilityRole="header" {...headingLevel(level)} style={styles.sectionTitle}>{title}</Text>
        {caption ? <Text style={styles.sectionCaption}>{caption}</Text> : null}
      </View>
      {right ?? (meta ? <Text style={styles.sectionMeta}>{meta}</Text> : null)}
    </View>
  );
}

/** A named value: label above, value below. */
export function Stat({
  label,
  value,
  caption,
  align = 'left',
  style,
}: {
  label: string;
  value: ReactNode;
  caption?: string;
  align?: 'left' | 'right';
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.stat, align === 'right' && styles.statRight, style]}>
      <Label>{label}</Label>
      <View style={styles.statValue}>{value}</View>
      {caption ? <Text style={[styles.statCaption, align === 'right' && styles.textRight]}>{caption}</Text> : null}
    </View>
  );
}

/** What to show when a list is empty, and the one thing to do about it. */
export function EmptyState({
  title,
  copy,
  action,
  level = 3,
  style,
}: {
  title: string;
  copy?: string;
  action?: ReactNode;
  level?: 1 | 2 | 3 | 4;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.empty, style]}>
      <Text accessibilityRole="header" {...headingLevel(level)} style={styles.emptyTitle}>{title}</Text>
      {copy ? <Text style={styles.emptyCopy}>{copy}</Text> : null}
      {action ? <View style={styles.emptyAction}>{action}</View> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  money: {
    fontFamily: fonts.display,
    fontVariant: ['tabular-nums'],
    fontWeight: weight.heavy,
  },
  label: {
    ...labelStyle,
  },
  tag: {
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: radius.xs,
  },
  tagText: {
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.heavy,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  button: {
    minHeight: control.height,
    minWidth: control.height,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  buttonPrimary: {
    backgroundColor: colors.gold,
    borderColor: colors.gold,
  },
  buttonSecondary: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.borderStrong,
  },
  buttonQuiet: {
    backgroundColor: 'transparent',
  },
  buttonText: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.black,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  buttonTextPrimary: {
    color: colors.onGold,
  },
  buttonTextQuiet: {
    color: colors.muted,
  },
  segmented: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  segment: {
    flex: 1,
    minHeight: control.height,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.sm,
  },
  segmentDivider: {
    borderLeftWidth: 1,
    borderLeftColor: colors.borderStrong,
  },
  segmentSelected: {
    backgroundColor: colors.goldSoft,
  },
  segmentText: {
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.heavy,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  segmentTextSelected: {
    color: colors.goldInk,
  },
  sectionHeader: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  sectionCopy: {
    minWidth: 0,
    flexShrink: 1,
  },
  sectionTitle: {
    ...headingStyle,
    letterSpacing: 0,
  },
  sectionCaption: {
    marginTop: 3,
    color: colors.faint,
    fontSize: type.caption,
    lineHeight: 17,
  },
  sectionMeta: {
    ...labelStyle,
    color: colors.goldInk,
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
    textAlign: 'right',
  },
  stat: {
    minWidth: 0,
  },
  statRight: {
    alignItems: 'flex-end',
  },
  statValue: {
    marginTop: 3,
  },
  statCaption: {
    marginTop: 2,
    color: colors.faint,
    fontSize: type.label,
    fontVariant: ['tabular-nums'],
  },
  textRight: {
    textAlign: 'right',
  },
  empty: {
    alignItems: 'flex-start',
    padding: space.xl,
  },
  emptyTitle: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.title,
    fontWeight: weight.heavy,
  },
  emptyCopy: {
    maxWidth: 520,
    marginTop: space.sm,
    color: colors.muted,
    fontSize: type.body,
    lineHeight: 20,
  },
  emptyAction: {
    marginTop: space.lg,
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.72,
  },
});
