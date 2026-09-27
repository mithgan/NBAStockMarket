import { useEffect, useRef, type ReactNode } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';

import type { PerGameRuleset } from '../api/contracts';
import { appearanceTagUnder, chromeFolded, deviceChoiceName, NO_RECENT_NOTICES, noticeAgeText, sheetFloats, sheetNarrow } from '../data/chromeView';
import { perGameRulesPresentation, rulesSummary } from '../data/perGameRules';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { tapsSettling, unlessSettling } from '../web/tapSettle';
import { useDesignVariant } from '../theme/ThemeProvider';
import { APPEARANCE_CHOICES, DEFAULT_VARIANT, VARIANTS, type DesignVariant } from '../theme/variants';
import type { AppearanceChoice } from '../theme/variantPersistence';

/** "Match device" first, then the themes. */
const CHOICES: AppearanceChoice[] = ['device', ...APPEARANCE_CHOICES];
const DEVICE_NAME = 'Match device';
const DEVICE_BLURB = 'Light while your device is set to light, Navy while it is dark, High contrast when it asks for more contrast.';
import { rowMarker } from '../ui/domMarkers';
import { headingLevel } from '../ui/kit';
import { reduceMotionChosen, setReduceMotion, useReduceMotionChoice } from '../state/motionPreference';
import { usePerGame } from '../state/PerGameContext';
import { keepNoticesUntilClosed, setKeepNoticesUntilClosed, useKeepNotices } from '../state/noticePreference';
import { cancelSettingsReturn, openRules, returnToSettingsAfterRules } from '../state/uiActions';
import { useSheetHistory, useSheetShown } from '../web/appHistory';
import { colors, fonts, numeric, radius, space, type, weight } from '../theme';
import { measuredFloatTop, measuredSheetTop } from './chrome/sheetTop';
import { liveMarketToExitTo, usePracticeRulesContext } from './SimBar';

/** Account facts the sheet can show; absent entirely in the local demo. */
type SettingsProfile = {
  displayName: string;
  email: string | null;
  provider: string | null;
  memberSince: string | null;
};

/** Two sliders on rails — settings without borrowing a gear glyph. */
function SettingsIcon({ color }: { color: string }) {
  return (
    <Svg height={18} width={18} viewBox="0 0 18 18">
      <Line stroke={color} strokeLinecap="round" strokeWidth={1.6} x1={2.5} x2={15.5} y1={5.5} y2={5.5} />
      <Line stroke={color} strokeLinecap="round" strokeWidth={1.6} x1={2.5} x2={15.5} y1={12.5} y2={12.5} />
      <Circle cx={11.5} cy={5.5} fill={colors.surface} r={2.6} stroke={color} strokeWidth={1.6} />
      <Circle cx={6.5} cy={12.5} fill={colors.surface} r={2.6} stroke={color} strokeWidth={1.6} />
    </Svg>
  );
}

/** Narrower than this (a phone at 200% zoom) the Settings word gives the wordmark its room. */
const SETTINGS_CAPTION_MIN_WIDTH = 320;

export function SettingsButton({ onPress }: { onPress: () => void }) {
  // Named in words under the icon, as Rules is (walk 9 T1-05): the sliders
  // alone did not say Settings. The word is the button's name (voice
  // control users say what they see), so no aria-label repeats it. Where the
  // bar has no room for it (195px at 200% zoom cut "databallr") the icon
  // carries the name.
  const { width } = useWindowDimensions();
  const captioned = width >= SETTINGS_CAPTION_MIN_WIDTH;
  return (
    <Pressable
      accessibilityLabel={Platform.OS === 'web' && captioned ? undefined : 'Settings'}
      accessibilityRole="button"
      onPress={() => {
        // A double tap on a sheet's Done must not reopen Settings (walk 6 T4-12).
        if (tapsSettling(true)) return;
        onPress();
      }}
      // Answers the pointer like the other buttons (walk 9 T2-09).
      style={(state) => [
        styles.iconButton,
        (state as { hovered?: boolean }).hovered === true && styles.iconButtonHover,
        state.pressed && styles.pressed,
      ]}
    >
      <SettingsIcon color={colors.muted} />
      {captioned ? (
        <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.iconButtonLabel}>Settings</Text>
      ) : null}
    </Pressable>
  );
}

function Section({ title, narrow = false, children }: { title: string; narrow?: boolean; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" {...headingLevel(3)} style={[styles.sectionTitle, narrow && styles.gutterNarrow]}>{title}</Text>
      {children}
    </View>
  );
}

/**
 * Settings sheet. A modal panel rather than a screen so it can open from any
 * tab without disturbing the navigation state underneath it.
 */
/** The switch's one-line explanation (its aria-describedby). */
const KEEP_NOTICES_NOTE_ID = 'keep-notices-note';
/** The Reduce motion switch's explanation (its aria-describedby). */
const REDUCE_MOTION_NOTE_ID = 'reduce-motion-note';

export function SettingsSheet({
  onClose,
  onSignOut,
  onOpenTreatments,
  ruleset,
  seasonLabel,
  listedPlayers,
  profile,
  visible,
}: {
  onClose: () => void;
  onSignOut?: () => void;
  onOpenTreatments?: () => void;
  ruleset?: PerGameRuleset;
  seasonLabel: string;
  listedPlayers: number;
  profile?: SettingsProfile;
  visible: boolean;
}) {
  const { height, width } = useWindowDimensions();
  // A wide window floats Settings under the frame, edged all round, as Rules
  // (chromeView.sheetFloats; walk 5 T2-05).
  const floating = sheetFloats(width, height);
  // A phone at 400% zoom (98px wide): Done gets a full-width row under the
  // title, gutters narrow so headings wrap between words, and each theme's
  // swatch sits under its name (walk 3 T3-31).
  const narrow = sheetNarrow(width);
  // Short of 300px (200% zoom), "IN USE" goes under the theme's name, so the
  // name and its description keep the width (walk 6 T3-15).
  const tagUnder = appearanceTagUnder(width);
  const reducedMotion = useReducedMotion();
  const practiceRules = usePracticeRulesContext();
  const rules = ruleset ? perGameRulesPresentation(ruleset, practiceRules) : null;
  const { choice: chosen, setVariant, variant: onScreen } = useDesignVariant();
  // The last ten notices, newest first, as screen readers heard them, for a
  // player who missed one or saw it cut short (walk 8 T3-I2, T4-N2).
  const { recentNotices } = usePerGame();
  // Back closes the sheet; the app behind it is inert while it is open.
  useSheetHistory(visible, onClose);
  const sheetTop = visible ? (floating ? measuredFloatTop() : measuredSheetTop()) : null;
  const choiceRefs = useRef<Array<View | null>>([]);
  // Rules opened from here hand back to Settings when they close (the frame
  // reopens it); focus goes back to "Read the full rules", where the player
  // was, not to Done at the top (walk 3 T3-25).
  const rulesLinkRef = useRef<View | null>(null);
  const doneRef = useRef<View | null>(null);
  const backFromRules = useRef(false);
  useEffect(() => {
    if (!visible || !backFromRules.current || typeof document === 'undefined') return undefined;
    backFromRules.current = false;
    // The sheet's focus trap puts focus on Done as it opens; move it on as
    // soon as the link is there, and never away from a control the player
    // has since moved to.
    const focusLink = () => {
      const link = rulesLinkRef.current as unknown as HTMLElement | null;
      const done = doneRef.current as unknown as HTMLElement | null;
      const current = document.activeElement;
      const sheet = link?.closest('[aria-modal="true"]');
      const unset = !current || current === done || !current.isConnected || !sheet?.contains(current);
      if (link?.isConnected && current !== link && unset) link.focus();
    };
    const timers = [0, 120, 320].map((delay) => setTimeout(focusLink, delay));
    return () => timers.forEach(clearTimeout);
  }, [visible]);
  // Appearance is a radio group: arrow keys move and choose, like any other
  // radio group, and only the chosen theme is a Tab stop.
  const onChoiceKey = (event: { key: string; preventDefault: () => void }) => {
    // Space chooses the focused look, as a radio does; on the one already
    // chosen it does nothing, and never scrolls the sheet (react-native-web
    // presses on Space only for buttons; walk 12 T3-01: a 515px jump).
    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      const focused = typeof document === 'undefined' ? -1
        : choiceRefs.current.findIndex((node) => (node as unknown as Element | null) === document.activeElement);
      if (focused >= 0 && CHOICES[focused] !== chosen) setVariant(CHOICES[focused]);
      return;
    }
    const index = CHOICES.indexOf(chosen);
    let next = -1;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (Math.max(index, 0) + 1) % CHOICES.length;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (Math.max(index, 0) - 1 + CHOICES.length) % CHOICES.length;
    if (next < 0) return;
    event.preventDefault();
    setVariant(CHOICES[next]);
    (choiceRefs.current[next] as unknown as { focus?: () => void } | null)?.focus?.();
  };
  // "Keep notices until I close them": Enter reaches it as a press, but
  // react-native-web presses on Space only for buttons, so Space is here.
  const keepNotices = useKeepNotices();
  const onSwitchKey = (event: { key: string; repeat?: boolean; preventDefault: () => void }) => {
    if (event.key !== ' ' && event.key !== 'Spacebar') return;
    event.preventDefault();
    if (!event.repeat) setKeepNoticesUntilClosed(!keepNoticesUntilClosed());
  };
  // "Reduce motion", on top of the device's own setting (walk 5 T3 NYI-4).
  const motionReduced = useReduceMotionChoice();
  const onMotionKey = (event: { key: string; repeat?: boolean; preventDefault: () => void }) => {
    if (event.key !== ' ' && event.key !== 'Spacebar') return;
    event.preventDefault();
    if (!event.repeat) setReduceMotion(!reduceMotionChosen());
  };
  const shown = useSheetShown(visible);
  if (!shown) return null;
  // The goal and the loop in one breath; the rest is one tap away in the rules.
  const firstParagraph = rules ? rulesSummary(rules.explanation) : null;
  return (
    <Modal
      accessibilityLabel="Settings"
      animationType={reducedMotion ? 'none' : 'fade'}
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      {/* The scrim closes on a tap but is never a keyboard stop. Even with
          tabIndex -1 a Pressable stays focusable by script, and
          react-native-web's modal focus trap focuses the first focusable
          child, so the scrim is a plain view on the responder system. Done
          and Escape close the sheet for keyboard and screen-reader users. */}
      <View
        onResponderRelease={unlessSettling(onClose)}
        onStartShouldSetResponder={() => true}
        style={styles.scrim}
      />
      {/* A short window keeps the settings, not the gap above them (as Rules).
          The sheet starts where the status row starts, so no line of the
          frame is cut in half behind the scrim (walk 4 T1-01). */}
      <View style={[styles.sheet, floating && styles.sheetFloating, chromeFolded(height, width) && styles.sheetShort, sheetTop !== null && { marginTop: sheetTop }]}>
        <View style={[styles.sheetHead, narrow && styles.sheetHeadNarrow]}>
          <Text accessibilityRole="header" {...headingLevel(2)} style={styles.sheetTitle}>Settings</Text>
          <Pressable
            ref={doneRef}
            accessibilityLabel="Done, close settings"
            accessibilityRole="button"
            onPress={unlessSettling(onClose)}
            style={({ pressed }) => [styles.close, styles.textButtonEdge, narrow && styles.closeNarrow, pressed && styles.pressed]}
          >
            <Text style={styles.closeText}>Done</Text>
          </Pressable>
        </View>
        {/* A named, focusable scroll region, as Rules and the profile have, so
            arrow keys reach This season and Practice mode below the themes
            (on a theme, arrows change the theme; walk 4 T3-06). */}
        <ScrollView aria-label="Settings content" role="region" style={styles.sheetBody} tabIndex={0}>
          <Section narrow={narrow} title="Appearance">
            <View accessibilityLabel="Theme" accessibilityRole="radiogroup" {...({ onKeyDown: onChoiceKey } as object)}>
              {CHOICES.map((choice, index) => {
                const device = choice === 'device';
                const variant = VARIANTS[device ? DEFAULT_VARIANT : choice];
                const selected = choice === chosen;
                // Match device in use says which look it gives now (walk 8 T2-I7).
                const name = device ? (selected ? deviceChoiceName(onScreen.name) : DEVICE_NAME) : variant.name;
                const blurb = device ? DEVICE_BLURB : variant.blurb;
                // A small preview of the theme itself: its page, a card with
                // a line of text, and its gain, loss and accent colours, so
                // themes can be told apart before trying them. "Match device"
                // shows Default and Light side by side, each half a smaller
                // card with its gain and loss marks, inside the same 44px box
                // (three full-size marks ran 7px out of it).
                const preview = (theme: DesignVariant, half?: 'left' | 'right') => (
                  <View style={[styles.swatch, half && styles.swatchHalf, half === 'left' && styles.swatchLeft, half === 'right' && styles.swatchRight, { backgroundColor: theme.palette.background }]}>
                    <View style={[styles.swatchCard, half && styles.swatchCardHalf, { backgroundColor: theme.palette.surface }]}>
                      <View style={[styles.swatchLine, half && styles.swatchLineHalf, { backgroundColor: theme.palette.text }]} />
                      <View style={[styles.swatchMarks, half && styles.swatchMarksHalf]}>
                        <View style={[styles.swatchMark, half && styles.swatchMarkHalf, { backgroundColor: theme.palette.green }]} />
                        <View style={[styles.swatchMark, half && styles.swatchMarkHalf, { backgroundColor: theme.palette.red }]} />
                        {half ? null : <View style={[styles.swatchMark, { backgroundColor: theme.palette.gold }]} />}
                      </View>
                    </View>
                  </View>
                );
                const swatch = device ? (
                  <View style={styles.swatchPair}>
                    {preview(VARIANTS[DEFAULT_VARIANT], 'left')}
                    {preview(VARIANTS.light, 'right')}
                  </View>
                ) : preview(variant);
                const inUse = selected ? <Text style={[styles.check, tagUnder && !narrow && styles.checkUnder]}>IN USE</Text> : null;
                return (
                  <Pressable
                    key={choice}
                    ref={(node) => {
                      choiceRefs.current[index] = node;
                    }}
                    // Named by its title alone, its line as the description, so
                    // arrowing through six looks hears six short names (walk 14
                    // T3-04: each read its whole sentence as its name).
                    accessibilityLabel={name.replace(' · ', ', ')}
                    {...({ 'aria-describedby': `theme-blurb-${choice}` } as object)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, checked: selected }}
                    // react-native-web drops accessibilityState.checked, so the
                    // radio says which theme is in use through aria-checked.
                    aria-checked={selected}
                    onPress={() => setVariant(choice)}
                    style={({ pressed }) => [styles.choice, narrow && styles.choiceNarrow, selected && styles.choiceSelected, pressed && styles.pressed]}
                    {...rowMarker}
                    {...({ tabIndex: selected ? 0 : -1 } as object)}
                  >
                    {narrow ? null : swatch}
                    <View style={[styles.choiceCopy, narrow && styles.choiceCopyNarrow]}>
                      <Text style={[styles.choiceName, selected && styles.choiceNameSelected]}>{name}</Text>
                      {tagUnder && !narrow ? inUse : null}
                      {/* The whole description at every width: cut at two
                          lines, High contrast lost "Gains in blue, losses in
                          orange" at 200% zoom (walk 6 T3-15). */}
                      <Text nativeID={`theme-blurb-${choice}`} style={styles.choiceBlurb}>{blurb}</Text>
                    </View>
                    {narrow ? (
                      // The swatch under the name, so the name keeps the width.
                      <View style={styles.choiceMarks}>
                        {swatch}
                        {inUse}
                      </View>
                    ) : tagUnder ? null : inUse}
                  </Pressable>
                );
              })}
            </View>
            <Text style={[styles.note, narrow && styles.gutterNarrow]}>Every theme is checked to be easy to read.</Text>
            {onOpenTreatments ? (
              <Pressable accessibilityRole="button" onPress={onOpenTreatments} style={styles.choice}>
                <Text style={[styles.choiceName, styles.choiceNameSelected]}>View all treatments</Text>
              </Pressable>
            ) : null}
          </Section>

          {/* Notices clear by themselves after a few seconds, too soon at
              high zoom or with a magnifier, and a keyboard cannot hover one
              to hold it (walk 4 T3-N1, WCAG 2.2.1). A switch: Enter (the
              press) and Space both flip it. */}
          <Section narrow={narrow} title="Notices">
            <View {...({ onKeyDown: onSwitchKey } as object)}>
              <Pressable
                accessibilityLabel="Keep notices until I close them"
                accessibilityRole="switch"
                accessibilityState={{ checked: keepNotices }}
                // react-native-web drops accessibilityState.checked.
                aria-checked={keepNotices}
                aria-describedby={KEEP_NOTICES_NOTE_ID}
                onPress={() => setKeepNoticesUntilClosed(!keepNoticesUntilClosed())}
                style={({ pressed }) => [styles.choice, narrow && styles.choiceNarrow, pressed && styles.pressed]}
                {...rowMarker}
              >
                <View style={[styles.choiceCopy, narrow && styles.choiceCopyNarrow]}>
                  <Text style={styles.choiceName}>Keep notices until I close them</Text>
                  <Text nativeID={KEEP_NOTICES_NOTE_ID} style={styles.choiceBlurb}>
                    Notices stay on screen until you close them, instead of clearing after a few seconds.
                  </Text>
                </View>
                {/* The state in a word too: forced colours drop the track's
                    fill, and a pill alone can be read either way (walk 9
                    T3-07, T3-N4). The switch itself says checked. */}
                <Text aria-hidden style={[styles.switchWord, keepNotices && styles.switchWordOn]}>{keepNotices ? 'On' : 'Off'}</Text>
                <View style={[styles.switchTrack, keepNotices && styles.switchTrackOn]}>
                  <View style={[styles.switchKnob, keepNotices && styles.switchKnobOn]} />
                </View>
              </Pressable>
            </View>
            {/* The last ten notices, newest first, whole and as they were
                heard: a notice missed, or cut to one line at 400% zoom, can
                be read again here (walk 8 T3-I2, T4-N2). The sheet's body is
                a focusable scroll region, so arrow keys read down the list. */}
            <Text accessibilityRole="header" {...headingLevel(4)} style={[styles.subTitle, narrow && styles.gutterNarrow]}>Recent notices</Text>
            {recentNotices.length === 0 ? (
              <Text style={[styles.note, styles.recentEmpty, narrow && styles.gutterNarrow]}>{NO_RECENT_NOTICES}</Text>
            ) : (
              <View aria-label="Recent notices, newest first" role="list" style={[styles.recentList, narrow && styles.gutterNarrow]}>
                {recentNotices.map((notice) => (
                  <View key={notice.id} role="listitem" style={styles.recentItem}>
                    <Text style={styles.recentText}>{notice.text}</Text>
                    <Text style={styles.recentAge}>{noticeAgeText(notice.at, Date.now())}</Text>
                  </View>
                ))}
              </View>
            )}
          </Section>

          {/* The app follows the device's reduced-motion setting; a shared or
              locked device may not let a player change it, so the app has its
              own switch on top (walk 5 T3 NYI-4). */}
          <Section narrow={narrow} title="Motion">
            <View {...({ onKeyDown: onMotionKey } as object)}>
              <Pressable
                accessibilityLabel="Reduce motion"
                accessibilityRole="switch"
                accessibilityState={{ checked: motionReduced }}
                // react-native-web drops accessibilityState.checked.
                aria-checked={motionReduced}
                aria-describedby={REDUCE_MOTION_NOTE_ID}
                onPress={() => setReduceMotion(!reduceMotionChosen())}
                style={({ pressed }) => [styles.choice, narrow && styles.choiceNarrow, pressed && styles.pressed]}
                {...rowMarker}
              >
                <View style={[styles.choiceCopy, narrow && styles.choiceCopyNarrow]}>
                  <Text style={styles.choiceName}>Reduce motion</Text>
                  <Text nativeID={REDUCE_MOTION_NOTE_ID} style={styles.choiceBlurb}>
                    {/* A device that already asks for less motion is said
                        here, so "Off" never reads as motion being on (walk 11
                        T3-10). */}
                    {reducedMotion && !motionReduced
                      ? 'Reduced now by your device\'s own setting: sheets and figures appear at once. Turn this on to keep it so on any device.'
                      : 'Sheets and figures appear at once, without fades or counting up. Your device\'s own setting still applies.'}
                  </Text>
                </View>
                {/* The state in a word too: forced colours drop the track's
                    fill, and a pill alone can be read either way (walk 9
                    T3-07, T3-N4). The switch itself says checked. */}
                <Text aria-hidden style={[styles.switchWord, motionReduced && styles.switchWordOn]}>{motionReduced ? 'On' : 'Off'}</Text>
                <View style={[styles.switchTrack, motionReduced && styles.switchTrackOn]}>
                  <View style={[styles.switchKnob, motionReduced && styles.switchKnobOn]} />
                </View>
              </Pressable>
            </View>
          </Section>

          <Section narrow={narrow} title="How the game works">
            {firstParagraph ? <Text style={[styles.lede, narrow && styles.gutterNarrow]}>{firstParagraph}</Text> : (
              <Text style={[styles.note, narrow && styles.gutterNarrow]}>The rules will appear when your account loads.</Text>
            )}
            <Pressable
              ref={rulesLinkRef}
              accessibilityLabel="Read the full rules"
              accessibilityRole="button"
              onPress={() => {
                onClose();
                // Let this sheet close first; two sheets never stack.
                returnToSettingsAfterRules();
                backFromRules.current = true;
                setTimeout(() => {
                  if (openRules()) return;
                  cancelSettingsReturn();
                  backFromRules.current = false;
                }, 50);
              }}
              style={({ pressed }) => [styles.choice, styles.textButtonEdge, narrow && styles.gutterNarrow, pressed && styles.pressed]}
            >
              <Text style={[styles.choiceName, styles.choiceNameSelected]}>Read the full rules ›</Text>
            </Pressable>
          </Section>

          <Section narrow={narrow} title="This season">
            <View style={[styles.factRow, narrow && styles.factRowNarrow]}>
              <Text style={styles.factLabel}>Season</Text>
              <Text style={styles.factValue}>{seasonLabel}</Text>
            </View>
            <View style={[styles.factRow, narrow && styles.factRowNarrow]}>
              <Text style={styles.factLabel}>Listed players</Text>
              <Text style={styles.factValue}>{listedPlayers}</Text>
            </View>
            {rules ? rules.facts.filter((fact) => ['Roster slots', 'Short slots', 'Shorts last'].includes(fact.label)).map((fact) => (
              <View key={fact.label} style={[styles.factRow, narrow && styles.factRowNarrow]}>
                <Text style={styles.factLabel}>{fact.label}</Text>
                <Text style={styles.factValue}>{fact.value}</Text>
              </View>
            )) : null}
          </Section>

          {profile ? (
            <Section title="Profile">
              <View style={styles.factRow}>
                <Text style={styles.factLabel}>Display name</Text>
                <Text numberOfLines={1} style={styles.factValue}>{profile.displayName}</Text>
              </View>
              {profile.email ? (
                <View style={styles.factRow}>
                  <Text style={styles.factLabel}>Email</Text>
                  <Text numberOfLines={1} style={styles.factValue}>{profile.email}</Text>
                </View>
              ) : null}
              {profile.provider ? (
                <View style={styles.factRow}>
                  <Text style={styles.factLabel}>Signed in with</Text>
                  <Text style={styles.factValue}>{profile.provider}</Text>
                </View>
              ) : null}
              {profile.memberSince ? (
                <View style={styles.factRow}>
                  <Text style={styles.factLabel}>Member since</Text>
                  <Text style={styles.factValue}>{profile.memberSince}</Text>
                </View>
              ) : null}
            </Section>
          ) : (
            <Section narrow={narrow} title="Practice mode">
              <Text style={[styles.note, narrow && styles.gutterNarrow]}>
                {/* A site without the live market has no saved account to mention. */}
                {liveMarketToExitTo()
                  ? "This is practice. It plays generated games in this browser's memory and starts over when you reload. Your saved account is separate and untouched."
                  : "This is practice. It plays generated games in this browser's memory and starts over when you reload."}
              </Text>
            </Section>
          )}

          {onSignOut ? (
            <Section title="Account">
              <Pressable
                accessibilityLabel="Sign out"
                accessibilityRole="button"
                onPress={onSignOut}
                style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}
                {...rowMarker}
              >
                <Text style={styles.signOutText}>Sign out</Text>
              </Pressable>
            </Section>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // A full 44px target: the gear is the only way into settings on a phone.
  iconButton: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 4,
    gap: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    borderRadius: radius.md,
    borderColor: colors.controlBorder,
    borderWidth: 1,
    backgroundColor: colors.surfaceRaised,
  },
  iconButtonHover: {
    backgroundColor: colors.surfaceHigh,
  },
  // The caption under the sliders, in the Rules control's type.
  iconButtonLabel: {
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.bold,
    lineHeight: 13,
  },
  pressed: { opacity: 0.65 },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  sheet: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 520,
    marginTop: 64,
    marginBottom: 0,
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    overflow: 'hidden',
  },
  // A desktop panel shows its bottom edge, so it reads as a scrolling panel
  // rather than one cut off by the window.
  sheetFloating: {
    marginBottom: 24,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  // A short window keeps the settings, not the gap above them.
  sheetShort: {
    marginTop: space.sm,
  },
  sheetHead: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  // Narrow (400% zoom): the title, then Done on its own full-width row.
  sheetHeadNarrow: {
    flexDirection: 'column',
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    rowGap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  sheetTitle: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.title,
    fontWeight: weight.heavy,
  },
  // Sized to its word with room each side, so the focus ring frames it
  // (the word ran past a 50px box; walk 9 T3-03), as Rules' Done is.
  close: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    marginRight: -space.sm,
  },
  // Done with a row to itself reads as a button: a 3:1 edge, words centred.
  closeNarrow: {
    alignItems: 'center',
    paddingLeft: 0,
    borderWidth: 1,
    borderColor: colors.controlBorder,
    borderRadius: radius.sm,
  },
  // A button drawn as words keeps an edge where colours are forced
  // (Windows contrast themes paint a transparent border as the button's
  // edge; walk 11 T3-07: "Done" read as a title and the rules link as a heading).
  textButtonEdge: {
    borderWidth: 1,
    borderColor: 'transparent',
  },
  closeText: {
    color: colors.goldInk,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.bold,
  },
  sheetBody: { flex: 1 },
  section: {
    paddingTop: space.lg,
    paddingBottom: space.sm,
  },
  sectionTitle: {
    color: colors.faint,
    fontFamily: fonts.body,
    fontSize: type.body,
    fontWeight: weight.medium,
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
  },
  choice: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  choiceSelected: { backgroundColor: colors.surface },
  // Narrow: the name and blurb take the width; the swatch goes under them.
  choiceNarrow: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: space.xs,
    paddingHorizontal: space.sm,
  },
  choiceCopyNarrow: { flex: 0, flexBasis: 'auto' },
  choiceMarks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
  },
  // Narrow gutters leave the words room to wrap between words, never inside one.
  gutterNarrow: { paddingHorizontal: space.sm },
  swatch: {
    width: 44,
    height: 36,
    padding: 5,
    justifyContent: 'center',
    flexShrink: 0,
    borderRadius: radius.sm,
    borderColor: colors.borderStrong,
    borderWidth: 1,
  },
  // "Match device": Default and Light halves in the same 44px box.
  swatchPair: {
    width: 44,
    height: 36,
    flexDirection: 'row',
    flexShrink: 0,
  },
  swatchHalf: {
    width: 22,
    padding: 2,
    overflow: 'hidden',
  },
  swatchCardHalf: { paddingHorizontal: 2 },
  swatchLineHalf: { width: 10 },
  swatchMarksHalf: { gap: 2 },
  swatchMarkHalf: { width: 4, height: 4 },
  swatchLeft: {
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
    borderRightWidth: 0,
  },
  swatchRight: {
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
  },
  swatchCard: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingVertical: 4,
    borderRadius: 2,
  },
  swatchLine: { width: 16, height: 2, borderRadius: 1 },
  swatchMarks: { flexDirection: 'row', gap: 3 },
  swatchMark: { width: 5, height: 5, borderRadius: 1 },
  choiceCopy: { flex: 1, minWidth: 0 },
  choiceName: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
  },
  choiceNameSelected: { color: colors.goldInk },
  choiceBlurb: {
    color: colors.faint,
    fontFamily: fonts.body,
    fontSize: type.body,
    lineHeight: 17,
    marginTop: 2,
  },
  // A switch: the knob's side says off (left) or on (right, on gold), so the
  // state never rests on colour alone; both edges are 3:1 controls.
  switchTrack: {
    width: 44,
    height: 26,
    flexShrink: 0,
    justifyContent: 'center',
    paddingHorizontal: 2,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.controlBorder,
    backgroundColor: colors.surfaceRaised,
  },
  switchTrackOn: {
    alignItems: 'flex-end',
    borderColor: colors.goldInk,
    backgroundColor: colors.gold,
  },
  // The knob is a border, not a fill, so forced colours still draw it and
  // its side shows off (left) or on (right) there too (walk 9 T3-07).
  switchKnob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 10,
    borderColor: colors.muted,
  },
  switchKnobOn: {
    borderColor: colors.onGold,
  },
  switchWord: {
    minWidth: 26,
    textAlign: 'right',
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.bold,
  },
  switchWordOn: {
    color: colors.goldInk,
  },
  check: {
    ...numeric,
    color: colors.goldInk,
    fontSize: type.label,
    fontWeight: weight.heavy,
    letterSpacing: 1,
    flexShrink: 0,
  },
  // Under the theme's name in a tight row, before its description.
  checkUnder: {
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  factRow: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.xs,
  },
  factLabel: {
    color: colors.muted,
    fontFamily: fonts.body,
    fontSize: type.body,
  },
  factRowNarrow: {
    flexWrap: 'wrap',
    paddingHorizontal: space.sm,
  },
  factValue: {
    ...numeric,
    color: colors.text,
    fontSize: type.body,
    fontWeight: weight.heavy,
    flexShrink: 1,
    textAlign: 'right',
  },
  // The one paragraph that explains the game reads at body size in full
  // contrast; it is the answer to "how does this work?", not a footnote.
  lede: {
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: type.body,
    lineHeight: 19,
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
  },
  // "Recent notices" under the Notices switch: a heading of its own, quieter
  // than the section's, over a flat list divided by hairlines.
  subTitle: {
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: type.body,
    fontWeight: weight.heavy,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.xs,
  },
  recentEmpty: {
    paddingTop: 0,
  },
  recentList: {
    paddingHorizontal: space.lg,
  },
  recentItem: {
    paddingVertical: space.sm,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  recentText: {
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: type.body,
    lineHeight: 19,
  },
  recentAge: {
    color: colors.faint,
    fontFamily: fonts.body,
    fontSize: type.caption,
    lineHeight: 16,
    marginTop: 2,
  },
  note: {
    color: colors.faint,
    fontFamily: fonts.body,
    fontSize: type.body,
    lineHeight: 18,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
  },
  signOut: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  signOutText: {
    color: colors.red,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.bold,
  },
});
