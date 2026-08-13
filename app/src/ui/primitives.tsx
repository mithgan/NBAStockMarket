/**
 * The shared Databallr vocabulary. Every screen composes these rather than
 * inventing its own card, so the product reads as one design instead of five.
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import {
  colors,
  fonts,
  labelStyle,
  numeric,
  radius,
  space,
  type,
  weight,
} from '../theme';

/**
 * The databallr.com section header: a tight uppercase label, a rule that runs
 * to the far edge, and optional metadata parked on the right. This is what
 * replaces floating cards — structure comes from the rule, not a container.
 */
export function SectionHeader({
  label,
  meta,
  accent = false,
}: {
  label: string;
  meta?: string;
  accent?: boolean;
}) {
  return (
    <View style={styles.sectionHeader}>
      {/* The role sits on the Text: a plain View carries traits but is not an
          accessibility element, so VoiceOver would skip the heading entirely. */}
      <Text
        accessibilityRole="header"
        style={[styles.sectionLabel, accent && styles.sectionLabelAccent]}
      >
        {label}
      </Text>
      <View style={styles.sectionRule} />
      {meta ? <Text style={styles.sectionMeta}>{meta}</Text> : null}
    </View>
  );
}

/** Micro-label. Names a value without competing with it. */
export function Label({ children, tone }: { children: ReactNode; tone?: 'gold' | 'cyan' }) {
  return (
    <Text
      style={[
        styles.label,
        // goldInk, not gold: the text-safe gold that light variants darken so
        // small print holds 4.5:1. Raw gold stays reserved for fills and rules.
        tone === 'gold' && { color: colors.goldInk },
        tone === 'cyan' && { color: colors.cyan },
      ]}
    >
      {children}
    </Text>
  );
}

/**
 * The one number a screen is about: oversized, tabular, with its label riding
 * alongside rather than above so the digits own the line.
 */
export function DisplayValue({
  value,
  label,
  tone = 'neutral',
  accessibilityLabel,
  size = type.display,
}: {
  value: string;
  label?: string;
  tone?: 'neutral' | 'gold' | 'up' | 'down';
  accessibilityLabel?: string;
  size?: number;
}) {
  const color = tone === 'gold'
    ? colors.gold
    : tone === 'up'
      ? colors.green
      : tone === 'down'
        ? colors.red
        : colors.text;
  return (
    <View accessible accessibilityLabel={accessibilityLabel} style={styles.displayRow}>
      <Text
        allowFontScaling
        maxFontSizeMultiplier={1.6}
        numberOfLines={1}
        style={[styles.display, { color, fontSize: size, lineHeight: Math.round(size * 1.08) }]}
      >
        {value}
      </Text>
      {label ? <Text style={styles.displayLabel}>{label}</Text> : null}
    </View>
  );
}

/** Thin progress rule used beneath headline stats on databallr. */
export function MeterRule({ fill, tone = 'gold' }: { fill: number; tone?: 'gold' | 'up' | 'down' }) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(fill) ? fill : 0));
  const color = tone === 'up' ? colors.green : tone === 'down' ? colors.red : colors.gold;
  return (
    <View style={styles.meterTrack}>
      <View style={[styles.meterFill, { width: `${clamped * 100}%`, backgroundColor: color }]} />
    </View>
  );
}

export type ButtonTone = 'primary' | 'secondary' | 'ghost' | 'danger' | 'positive';

/** Uppercase, letter-spaced, flat-cornered — the databallr control shape. */
export function Button({
  label,
  onPress,
  tone = 'secondary',
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  fixedWidth,
  compact = false,
}: {
  label: string;
  onPress: () => void;
  tone?: ButtonTone;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  fixedWidth?: number;
  compact?: boolean;
}) {
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        toneStyles[tone].box,
        fixedWidth !== undefined ? { width: fixedWidth } : null,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text
        maxFontSizeMultiplier={1.6}
        numberOfLines={2}
        style={[styles.buttonText, toneStyles[tone].text, disabled && styles.buttonTextDisabled]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Segmented control: one bordered track, active segment filled. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  groupLabel,
}: {
  options: readonly { key: T; label: string; hint: string }[];
  value: T;
  onChange: (next: T) => void;
  groupLabel: string;
}) {
  return (
    <View accessibilityRole="tablist" aria-label={groupLabel} style={styles.segmented}>
      {options.map((option) => {
        const selected = option.key === value;
        return (
          <Pressable
            accessibilityLabel={option.hint}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            aria-selected={selected}
            key={option.key}
            onPress={() => onChange(option.key)}
            style={({ pressed }) => [
              styles.segment,
              selected && styles.segmentSelected,
              pressed && styles.pressed,
            ]}
          >
            <Text
              maxFontSizeMultiplier={1.5}
              numberOfLines={1}
              style={[styles.segmentText, selected && styles.segmentTextSelected]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Small status chip — OWNED, SHORTED, SOLD OUT, week keys. */
export function Tag({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'gold' | 'cyan' | 'up' | 'down';
}) {
  return (
    <Text
      maxFontSizeMultiplier={1.4}
      numberOfLines={1}
      style={[styles.tag, tagTones[tone]]}
    >
      {label}
    </Text>
  );
}

/** Full-bleed block separated by rules instead of wrapped in a card. */
export function Section({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.section, style]}>{children}</View>;
}

const toneStyles: Record<ButtonTone, { box: ViewStyle; text: { color: string } }> = {
  primary: {
    box: { backgroundColor: colors.gold, borderColor: colors.gold },
    text: { color: colors.background },
  },
  secondary: {
    box: { backgroundColor: 'transparent', borderColor: colors.goldLine },
    text: { color: colors.goldInk },
  },
  ghost: {
    box: { backgroundColor: colors.surface, borderColor: colors.border },
    text: { color: colors.muted },
  },
  danger: {
    box: { backgroundColor: colors.redSoft, borderColor: colors.red },
    text: { color: colors.red },
  },
  positive: {
    box: { backgroundColor: colors.greenSoft, borderColor: colors.green },
    text: { color: colors.green },
  },
};

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingTop: space.lg,
    paddingBottom: space.sm,
  },
  sectionLabel: {
    ...labelStyle,
    color: colors.muted,
    flexShrink: 0,
  },
  sectionLabelAccent: { color: colors.goldInk },
  sectionRule: { flex: 1, height: 1, backgroundColor: colors.border, minWidth: space.lg },
  sectionMeta: { ...labelStyle, flexShrink: 0 },

  label: labelStyle,

  displayRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap' },
  display: {
    ...numeric,
    fontWeight: weight.black,
    },
  displayLabel: { ...labelStyle, marginBottom: 2 },

  meterTrack: {
    height: 2,
    backgroundColor: colors.border,
    overflow: 'hidden',
    marginTop: space.sm,
  },
  meterFill: { height: 2 },

  button: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  // 'compact' trims horizontal padding only — 44px stays the floor.
  buttonCompact: { paddingHorizontal: space.sm },
  buttonDisabled: { opacity: 0.42 },
  buttonText: {
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.black,
    letterSpacing: 0.9,
    textAlign: 'center',
  },
  buttonTextDisabled: { color: colors.faint },

  segmented: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  segment: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: space.md,
  },
  segmentSelected: { backgroundColor: colors.surfaceRaised },
  segmentText: {
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.heavy,
    letterSpacing: 0.9,
    color: colors.faint,
    textTransform: 'uppercase',
  },
  segmentTextSelected: { color: colors.goldInk },

  tag: {
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.black,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: radius.xs,
    overflow: 'hidden',
  },
  section: { paddingHorizontal: space.md },

  pressed: { opacity: 0.62 },
});

const tagTones = StyleSheet.create({
  neutral: { color: colors.faint, backgroundColor: colors.surfaceRaised },
  gold: { color: colors.goldInk, backgroundColor: colors.goldSoft },
  cyan: { color: colors.cyan, backgroundColor: colors.cyanSoft },
  up: { color: colors.green, backgroundColor: colors.greenSoft },
  down: { color: colors.red, backgroundColor: colors.redSoft },
});
