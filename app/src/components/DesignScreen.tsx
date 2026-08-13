import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useDesignVariant } from '../theme/ThemeProvider';
import { rowMarker } from '../ui/domMarkers';
import { VARIANT_ORDER, VARIANTS, type VariantPalette } from '../theme/variants';
import { colors, fonts, numeric, radius, space, type, weight } from '../theme';

/** The five swatches that say the most about a palette, in reading order. */
const SWATCH_KEYS: readonly (keyof VariantPalette)[] = ['background', 'surface', 'gold', 'green', 'red'];

/**
 * The treatment picker itself: every variant as a radio card with its name,
 * blurb, and key swatches. Rendered at the bottom of the /treatments gallery
 * so a pick can be judged against the sample screens directly above it.
 */
export function DesignScreen() {
  const { setVariant, variantId } = useDesignVariant();
  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.scroll}>
      <Text accessibilityRole="header" style={styles.heading}>Design</Text>
      <Text style={styles.intro}>
        Pick a treatment. Every screen repaints immediately and the choice is remembered on this device. Nothing about the game changes.
      </Text>
      <View accessibilityRole="radiogroup" style={styles.list}>
        {VARIANT_ORDER.map((id) => {
          const variant = VARIANTS[id];
          const selected = id === variantId;
          return (
            <Pressable
              accessibilityLabel={`${variant.name}. ${variant.blurb}`}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              {...rowMarker}
              key={id}
              onPress={() => setVariant(id)}
              style={({ pressed }) => [
                styles.option,
                variant.isNew && styles.optionNew,
                selected && styles.optionSelected,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.optionHead}>
                <Text style={[styles.optionName, selected && styles.optionNameSelected]}>{variant.name}</Text>
                {selected ? (
                  <Text style={styles.badge}>IN USE</Text>
                ) : variant.isNew ? (
                  <Text style={styles.badge}>NEW</Text>
                ) : null}
              </View>
              <Text style={styles.optionBlurb}>{variant.blurb}</Text>
              <View style={styles.swatches}>
                {SWATCH_KEYS.map((key) => (
                  <View key={key} style={[styles.swatch, { backgroundColor: variant.palette[key] }]} />
                ))}
              </View>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.footnote}>
        Every palette here is verified against the same contrast floor the rest of the app holds, so no treatment trades legibility for looks.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingBottom: space.xxl },
  heading: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.title,
    fontWeight: weight.heavy,
    paddingHorizontal: space.lg,
    paddingTop: space.xl,
  },
  intro: {
    color: colors.faint,
    fontFamily: fonts.body,
    fontSize: type.body,
    lineHeight: 19,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
  },
  list: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    gap: space.sm,
  },
  option: {
    minHeight: 44,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.md,
    backgroundColor: colors.surface,
  },
  optionNew: {
    borderColor: colors.gold,
    borderWidth: 2,
  },
  optionSelected: {
    borderColor: colors.gold,
    backgroundColor: colors.goldSoft,
  },
  pressed: { opacity: 0.7 },
  optionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  optionName: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
  },
  optionNameSelected: { color: colors.goldInk },
  badge: {
    ...numeric,
    color: colors.goldInk,
    fontSize: type.label,
    fontWeight: weight.heavy,
    letterSpacing: 1,
  },
  optionBlurb: {
    color: colors.muted,
    fontFamily: fonts.body,
    fontSize: type.body,
    lineHeight: 18,
    marginTop: 5,
  },
  swatches: {
    flexDirection: 'row',
    gap: 5,
    marginTop: space.md,
  },
  swatch: {
    width: 26,
    height: 18,
    borderRadius: radius.sm,
    borderColor: colors.borderStrong,
    borderWidth: 1,
  },
  footnote: {
    color: colors.faint,
    fontFamily: fonts.body,
    fontSize: type.body,
    lineHeight: 18,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
  },
});
