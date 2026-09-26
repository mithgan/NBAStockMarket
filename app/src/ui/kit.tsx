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
import { forwardRef, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { settleTaps, tapsSettling } from '../web/tapSettle';
import {
  Modal,
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
      // Screen readers hear the figure the screen shows, not a finer one.
      accessibilityLabel={accessibilityLabel ?? text}
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

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

export type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  /**
   * Keep a disabled button in the Tab order (aria-disabled) so a keyboard or
   * screen-reader user can reach it and hear why it is disabled.
   */
  focusableWhenDisabled?: boolean;
  /**
   * A press while disabled (focusable disabled buttons only), to say why it
   * did nothing: "Roster reopens after Oct 22."
   */
  onDisabledPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  width?: number;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

/**
 * Keep `aria-disabled` on a control that stays enabled for the browser while
 * it cannot act. react-native-web writes aria-disabled only from a
 * Pressable's own `disabled` prop, and a disabled Pressable both leaves the
 * Tab order and lets taps fall through to whatever is underneath (its
 * pointer-events become box-none). A reachable disabled control therefore
 * stays enabled, ignores presses itself, and has its state written here.
 * No-op off the web.
 */
export function useAriaDisabled(ref: { current: unknown }, disabled: boolean): void {
  useEffect(() => {
    const node = ref.current as { setAttribute?: (name: string, value: string) => void; removeAttribute?: (name: string) => void } | null;
    if (!node?.setAttribute || !node.removeAttribute) return;
    if (disabled) node.setAttribute('aria-disabled', 'true');
    else node.removeAttribute('aria-disabled');
  });
}

/**
 * A 44px-tall action. `primary` is gold and reserved for the one thing a row or
 * screen most wants you to do; `secondary` is an outlined neutral; `quiet` is
 * text-only for low-stakes actions such as Exit; `danger` is for the second,
 * deliberate step of something that costs money or loses progress.
 * Forwards its ref so callers can move keyboard focus onto it.
 */
export const Button = forwardRef<View, ButtonProps>(function Button({
  label,
  onPress,
  variant = 'secondary',
  disabled = false,
  focusableWhenDisabled = false,
  onDisabledPress,
  accessibilityLabel,
  accessibilityHint,
  width,
  style,
  textStyle,
}, ref) {
  const name = accessibilityLabel ?? label;
  // A focusable disabled button stays enabled for the browser (it keeps its
  // Tab stop and catches taps, so they never land on the row underneath),
  // ignores presses, and still says it is disabled.
  const hardDisabled = disabled && !focusableWhenDisabled;
  const own = useRef<View | null>(null);
  const setRef = useCallback((node: View | null) => {
    own.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) (ref as { current: View | null }).current = node;
  }, [ref]);
  useAriaDisabled(own, disabled);
  return (
    <Pressable
      ref={setRef}
      accessibilityHint={accessibilityHint}
      // react-native-web drops accessibilityHint, so a disabled button would
      // never say why. Carry the reason in the name while it applies.
      accessibilityLabel={disabled && accessibilityHint ? `${name}. ${accessibilityHint}` : name}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={hardDisabled}
      onPress={() => {
        // The second tap of a double tap on a confirm that just folded away.
        if (tapsSettling()) return;
        if (!disabled) onPress();
        else onDisabledPress?.();
      }}
      style={(state) => {
        const { pressed } = state;
        const hovered = (state as { hovered?: boolean }).hovered === true;
        return [
          styles.button,
          variant === 'primary' && styles.buttonPrimary,
          variant === 'secondary' && styles.buttonSecondary,
          variant === 'quiet' && styles.buttonQuiet,
          variant === 'danger' && styles.buttonDanger,
          width !== undefined && { width },
          hovered && !disabled && (variant === 'primary' ? styles.hoverPrimary : styles.hover),
          disabled && styles.disabled,
          pressed && !disabled && styles.pressed,
          style,
        ];
      }}
    >
      <Text
        maxFontSizeMultiplier={1.3}
        style={[
          styles.buttonText,
          variant === 'primary' && styles.buttonTextPrimary,
          variant === 'quiet' && styles.buttonTextQuiet,
          variant === 'danger' && styles.buttonTextDanger,
          textStyle,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
});

/**
 * A short "it worked" state for a row's button after an action: while it is
 * on, show a non-interactive confirmation (e.g. "Added ✓") in the button's
 * place so a second, accidental tap lands on nothing.
 */
export function useCooldown(ms = 1200): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useCallback(() => {
    setOn(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOn(false), ms);
  }, [ms]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return [on, start];
}

/** Presses that land sooner than this after a confirm appears are ignored. */
const CONFIRM_TAP_GUARD_MS = 400;

// After a confirm is answered it folds away and the rows under it move up;
// for a moment the next taps are ignored (see web/tapSettle).
export { settleTaps, tapsSettling } from '../web/tapSettle';

function useTapGuard() {
  const openedAt = useRef(Date.now());
  return useCallback((fn: () => void) => () => {
    if (Date.now() - openedAt.current < CONFIRM_TAP_GUARD_MS) return;
    fn();
  }, []);
}

function focusNode(ref: { current: unknown }) {
  const node = ref.current as { focus?: () => void } | null;
  node?.focus?.();
}

/**
 * The second, deliberate step before something that costs money: an inline
 * strip under the row that says what happens and offers two real buttons.
 * "Keep" sits on the right, where the row's Drop/Close button was, so a
 * double tap lands on the safe choice; the costly button sits to its left.
 * Taps in the first 400 ms are ignored, keyboard focus starts on Keep, Escape
 * cancels, and nothing times out while the player reads it.
 */
export function ConfirmStrip({
  message,
  confirmLabel,
  cancelLabel = 'Keep',
  confirmAccessibilityLabel,
  onConfirm,
  onCancel,
  style,
}: {
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  confirmAccessibilityLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const guard = useTapGuard();
  const keepRef = useRef<View>(null);
  useEffect(() => {
    focusNode(keepRef);
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    // Escape answers this question only. A sheet around the strip (the player
    // profile) closes on Escape's keyup, so the matching keyup is swallowed
    // too, by a one-shot listener that outlives the strip it just closed.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      const swallow = (up: KeyboardEvent) => {
        if (up.key !== 'Escape') return;
        up.stopPropagation();
        window.removeEventListener('keyup', swallow, true);
      };
      window.addEventListener('keyup', swallow, true);
      onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);
  return (
    <View accessibilityRole="alert" style={[styles.confirmStrip, style]}>
      <Text style={styles.confirmText}>{message}</Text>
      <View style={styles.confirmButtons}>
        <Button
          accessibilityLabel={confirmAccessibilityLabel}
          label={confirmLabel}
          onPress={guard(() => {
            settleTaps();
            onConfirm();
          })}
          variant="danger"
        />
        <Button
          ref={keepRef}
          label={cancelLabel}
          onPress={guard(() => {
            settleTaps();
            onCancel();
          })}
          variant="secondary"
        />
      </View>
    </View>
  );
}

/**
 * A modal question for the few actions that lose a whole practice season
 * (Restart, Exit). The safe choice is focused and sits where the original
 * button was; the costly choice needs a deliberate second tap; Escape, Back
 * and tapping outside all mean "no".
 */
export function ConfirmDialog({
  visible,
  title,
  lines,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  onDismiss,
  confirmTone = 'danger',
}: {
  visible: boolean;
  title: string;
  lines: string[];
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  /** The focused, safe button. */
  onCancel: () => void;
  /** Escape, Back or a tap outside; defaults to `onCancel`. */
  onDismiss?: () => void;
  /** 'neutral' when the other choice loses nothing (e.g. "Play anyway"). */
  confirmTone?: 'danger' | 'neutral';
}) {
  if (!visible) return null;
  const dismiss = onDismiss ?? onCancel;
  return (
    // Named with its consequence, so a screen reader hears what would be lost
    // before the choice ("Start over? You'd lose this season: Day 16 …").
    <Modal accessibilityLabel={[title, ...lines].join(' ')} animationType="none" onRequestClose={dismiss} transparent visible>
      <ConfirmDialogBody
        cancelLabel={cancelLabel}
        confirmLabel={confirmLabel}
        confirmTone={confirmTone}
        lines={lines}
        onCancel={onCancel}
        onConfirm={onConfirm}
        onDismiss={dismiss}
        title={title}
      />
    </Modal>
  );
}

function ConfirmDialogBody({
  title,
  lines,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  onDismiss,
  confirmTone,
}: {
  title: string;
  lines: string[];
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  onDismiss: () => void;
  confirmTone: 'danger' | 'neutral';
}) {
  const guard = useTapGuard();
  const cancelRef = useRef<View>(null);
  useEffect(() => {
    focusNode(cancelRef);
  }, []);
  return (
    <View style={styles.dialogLayer}>
      {/* A plain view, not a button: tapping outside cancels, but the scrim
          never takes keyboard focus. */}
      <View
        // The second click of a double click on the button that opened the
        // dialog lands here: the same guard as the buttons keeps it open.
        onResponderRelease={guard(onDismiss)}
        onStartShouldSetResponder={() => true}
        style={styles.dialogScrim}
      />
      <View style={styles.dialogPanel}>
        <Text accessibilityRole="header" {...headingLevel(2)} style={styles.dialogTitle}>{title}</Text>
        {lines.map((line) => (
          <Text key={line} style={styles.dialogLine}>{line}</Text>
        ))}
        <View style={styles.dialogButtons}>
          <Button label={confirmLabel} onPress={guard(onConfirm)} variant={confirmTone === 'danger' ? 'danger' : 'secondary'} />
          <Button ref={cancelRef} label={cancelLabel} onPress={guard(onCancel)} variant="primary" />
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Segmented control

export type SegmentOption<K extends string> = { key: K; label: string; hint?: string };

/**
 * Two to four mutually exclusive choices, e.g. Roster / Short. Works like a
 * tab list for keyboards: one Tab stop (the selected choice), arrow keys and
 * Home/End move and select, Space and Enter select.
 */
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
  const refs = useRef<Array<View | null>>([]);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.key === value));
  const move = (to: number) => {
    const index = (to + options.length) % options.length;
    onChange(options[index].key);
    focusNode({ current: refs.current[index] });
  };
  const onKeyDown = (event: { key: string; preventDefault: () => void }) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); move(selectedIndex + 1); }
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); move(selectedIndex - 1); }
    else if (event.key === 'Home') { event.preventDefault(); move(0); }
    else if (event.key === 'End') { event.preventDefault(); move(options.length - 1); }
  };
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="tablist"
      style={[styles.segmented, style]}
      {...({ onKeyDown } as object)}
    >
      {options.map((option, index) => {
        const selected = option.key === value;
        return (
          <Pressable
            key={option.key}
            ref={(node) => {
              refs.current[index] = node;
            }}
            accessibilityHint={option.hint}
            accessibilityLabel={option.label}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            aria-selected={selected}
            onPress={() => onChange(option.key)}
            {...({
              tabIndex: selected ? 0 : -1,
              onKeyDown: (event: { key: string; preventDefault: () => void }) => {
                if (event.key === ' ' || event.key === 'Spacebar') { event.preventDefault(); onChange(option.key); }
              },
            } as object)}
            style={(state) => {
              const hovered = (state as { hovered?: boolean }).hovered === true;
              return [
                styles.segment,
                index > 0 && styles.segmentDivider,
                selected && styles.segmentSelected,
                hovered && !selected && styles.hover,
                state.pressed && !selected && styles.pressed,
              ];
            }}
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
    borderColor: colors.controlBorder,
  },
  buttonQuiet: {
    backgroundColor: 'transparent',
  },
  buttonDanger: {
    backgroundColor: colors.redSoft,
    borderColor: colors.red,
  },
  buttonTextDanger: {
    color: colors.red,
  },
  hover: {
    backgroundColor: colors.surfaceHigh,
  },
  hoverPrimary: {
    opacity: 0.9,
  },
  confirmStrip: {
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: colors.surfaceRaised,
    borderTopWidth: 1,
    borderTopColor: colors.borderStrong,
  },
  confirmText: {
    color: colors.text,
    fontSize: type.body,
    lineHeight: 19,
  },
  confirmButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  dialogLayer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  dialogScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  dialogPanel: {
    width: '100%',
    maxWidth: 420,
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  dialogTitle: {
    ...headingStyle,
    letterSpacing: 0,
  },
  dialogLine: {
    color: colors.text,
    fontSize: type.body,
    lineHeight: 19,
  },
  dialogButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: space.sm,
    marginTop: space.sm,
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
    borderColor: colors.controlBorder,
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
    // A 3px bar marks the chosen segment in any colour vision and in every
    // theme (High contrast's gold-on-olive tint alone read backwards).
    borderBottomWidth: 3,
    // goldInk: bright gold on dark themes, deep ochre on Light (3:1+ in all).
    borderBottomColor: colors.goldInk,
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
