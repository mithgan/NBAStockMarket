import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';

import { useReducedMotion } from '../hooks/useReducedMotion';
import { useDesignVariant } from '../theme/ThemeProvider';
import { APPEARANCE_CHOICES, VARIANTS } from '../theme/variants';
import { rowMarker } from '../ui/domMarkers';
import { colors, fonts, numeric, radius, space, type, weight } from '../theme';

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

export function SettingsButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel="Settings"
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
    >
      <SettingsIcon color={colors.muted} />
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

/**
 * Settings sheet. A modal panel rather than a screen so it can open from any
 * tab without disturbing the navigation state underneath it.
 */
export function SettingsSheet({
  onClose,
  onSignOut,
  seasonLabel,
  listedPlayers,
  profile,
  visible,
}: {
  onClose: () => void;
  onSignOut?: () => void;
  seasonLabel: string;
  listedPlayers: number;
  profile?: SettingsProfile;
  visible: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const { setVariant, variantId } = useDesignVariant();
  return (
    <Modal
      animationType={reducedMotion ? 'none' : 'fade'}
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <Pressable
        accessibilityLabel="Close settings"
        accessibilityRole="button"
        onPress={onClose}
        style={styles.scrim}
      />
      <View style={styles.sheet}>
        <View style={styles.sheetHead}>
          <Text accessibilityRole="header" style={styles.sheetTitle}>Settings</Text>
          <Pressable
            accessibilityLabel="Close settings"
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}
          >
            <Text style={styles.closeText}>Done</Text>
          </Pressable>
        </View>
        <ScrollView style={styles.sheetBody}>
          <Section title="Appearance">
            {APPEARANCE_CHOICES.map((choice) => {
              const variant = VARIANTS[choice];
              const selected = choice === variantId;
              return (
                <Pressable
                  key={choice}
                  accessibilityLabel={`${variant.name}. ${variant.blurb}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => setVariant(choice)}
                  style={({ pressed }) => [styles.choice, selected && styles.choiceSelected, pressed && styles.pressed]}
                  {...rowMarker}
                >
                  <View style={[styles.swatch, { backgroundColor: variant.palette.background }]}>
                    <View style={[styles.swatchDot, { backgroundColor: variant.palette.gold }]} />
                  </View>
                  <View style={styles.choiceCopy}>
                    <Text style={[styles.choiceName, selected && styles.choiceNameSelected]}>{variant.name}</Text>
                    <Text numberOfLines={2} style={styles.choiceBlurb}>{variant.blurb}</Text>
                  </View>
                  {selected ? <Text style={styles.check}>IN USE</Text> : null}
                </Pressable>
              );
            })}
            <Text style={styles.note}>
              Every treatment here is checked against the same contrast floor the rest of the app holds. More of them live at /treatments.
            </Text>
          </Section>

          <Section title="This season">
            <View style={styles.factRow}>
              <Text style={styles.factLabel}>Season</Text>
              <Text style={styles.factValue}>{seasonLabel}</Text>
            </View>
            <View style={styles.factRow}>
              <Text style={styles.factLabel}>Listed players</Text>
              <Text style={styles.factValue}>{listedPlayers}</Text>
            </View>
            <View style={styles.factRow}>
              <Text style={styles.factLabel}>Starting bankroll</Text>
              <Text style={styles.factValue}>$140M</Text>
            </View>
            <View style={styles.factRow}>
              <Text style={styles.factLabel}>Dividend rate</Text>
              <Text style={styles.factValue}>$40K per net point</Text>
            </View>
            <View style={styles.factRow}>
              <Text style={styles.factLabel}>Listing tiers</Text>
              <Text style={styles.factValue}>STAR · MID</Text>
            </View>
            <Text style={styles.note}>
              Dividends pay the difference between what a player actually did and what he was projected to do. Matching the projection pays nothing; missing it costs you. Prices move on trading, never on performance. Tiers band players by opening price — stars list dearest.
            </Text>
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
            <Section title="Profile">
              <Text style={styles.note}>
                This is the shared demo, which has no account. Your season lives in this browser only, and nothing here is signed in.
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
  iconButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    borderRadius: radius.md,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surfaceRaised,
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
  sheetHead: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  sheetTitle: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.title,
    fontWeight: weight.heavy,
  },
  close: {
    minHeight: 44,
    justifyContent: 'center',
    paddingLeft: space.md,
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
  swatch: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    borderRadius: radius.sm,
    borderColor: colors.borderStrong,
    borderWidth: 1,
  },
  swatchDot: { width: 10, height: 10, borderRadius: radius.sm },
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
  check: {
    ...numeric,
    color: colors.goldInk,
    fontSize: type.label,
    fontWeight: weight.heavy,
    letterSpacing: 1,
    flexShrink: 0,
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
  factValue: {
    ...numeric,
    color: colors.text,
    fontSize: type.body,
    fontWeight: weight.heavy,
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
