/**
 * The market's list controls: the name search, the Watching filter, and the
 * desktop column header. The screen composes them; the rows live with the
 * screen because their actions and locks are part of its contract.
 */
import { Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';

import type { MarketColumnSet } from '../../data/marketView';
import { colors, control, fonts, radius, space, type, weight } from '../../theme';
import { Label } from '../../ui/kit';
import { CloseIcon, SearchIcon, StarIcon } from './icons';

export function MarketSearch({
  value,
  onChange,
  style,
}: {
  value: string;
  onChange: (next: string) => void;
  style?: StyleProp<ViewStyle>;
}) {
  // The input itself carries the border so its own box is the full 44px; the
  // magnifier and the clear control sit over its padding.
  return (
    <View style={[styles.search, style]}>
      <TextInput
        accessibilityLabel="Search players"
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="never"
        maxFontSizeMultiplier={1.4}
        onChangeText={onChange}
        placeholder="Search players"
        placeholderTextColor={colors.faint}
        returnKeyType="search"
        style={[styles.searchInput, value.length > 0 && styles.searchInputClearable]}
        value={value}
      />
      <View style={styles.searchIcon}>
        <SearchIcon />
      </View>
      {value.length > 0 ? (
        <Pressable
          accessibilityLabel="Clear search"
          accessibilityRole="button"
          onPress={() => onChange('')}
          style={({ pressed }) => [styles.clear, pressed && styles.pressed]}
        >
          <CloseIcon color={colors.muted} size={14} />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Show only the players you watch. A switch, because it is on or off; the
 * count says how many players it will leave.
 */
export function WatchingToggle({
  on,
  count,
  onChange,
  style,
}: {
  on: boolean;
  count: number;
  onChange: (next: boolean) => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      // react-native-web drops hints, so the count rides in the name.
      accessibilityLabel={`Watching only, ${count} ${count === 1 ? 'player' : 'players'}`}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      aria-checked={on}
      onPress={() => onChange(!on)}
      style={({ pressed }) => [styles.watching, on && styles.watchingOn, pressed && styles.pressed, style]}
    >
      <StarIcon filled={on} size={16} />
      <Text maxFontSizeMultiplier={1.3} style={[styles.watchingText, on && styles.watchingTextOn]}>
        Watching
      </Text>
      <Text maxFontSizeMultiplier={1.3} style={[styles.watchingCount, on && styles.watchingTextOn]}>
        {count}
      </Text>
    </Pressable>
  );
}

/**
 * Opens and closes search, sort and Watching where there is no room to show
 * them all (a phone at 200% zoom). It turns gold while any of them is doing
 * something, so a folded filter is never forgotten.
 */
export function ControlsToggle({
  open,
  active,
  onToggle,
}: {
  open: boolean;
  /** A search, a non-default sort or the Watching filter is on. */
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={active ? 'Search and sort, filters on' : 'Search and sort'}
      accessibilityRole="button"
      aria-expanded={open}
      onPress={onToggle}
      style={({ pressed }) => [styles.toggle, (open || active) && styles.toggleOn, pressed && styles.pressed]}
    >
      <SearchIcon />
      {active ? <View style={styles.toggleDot} /> : null}
    </Pressable>
  );
}

/** Column labels above the table; the widths are the rows' own (marketColumns). */
export function MarketColumnHeader({ columns, edgeLabel }: { columns: MarketColumnSet; edgeLabel: string }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.columns, { gap: columns.gap }]}
    >
      <View style={{ width: columns.avatar }} />
      <Label style={styles.columnPlayer}>Player</Label>
      <Label style={[styles.column, { width: columns.price }]}>Price a game</Label>
      <Label style={[styles.column, { width: columns.lastSeason }]}>Last season</Label>
      <Label style={[styles.column, { width: columns.edge }]}>{edgeLabel}</Label>
      {columns.yours > 0 ? <Label style={[styles.column, { width: columns.yours }]}>Your net a game</Label> : null}
      <View style={{ width: columns.action }} />
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    position: 'relative',
    justifyContent: 'center',
  },
  searchInput: {
    width: '100%',
    minWidth: 0,
    height: control.height,
    paddingVertical: 0,
    paddingLeft: 38,
    paddingRight: space.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
    color: colors.text,
    fontFamily: fonts.body,
    // 16px keeps iOS Safari from zooming the page when the field takes focus.
    fontSize: 16,
  },
  searchInputClearable: {
    paddingRight: control.height,
  },
  searchIcon: {
    pointerEvents: 'none',
    position: 'absolute',
    left: space.md,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  clear: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: control.height,
    height: control.height,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggle: {
    width: control.height,
    height: control.height,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
  },
  toggleOn: {
    borderColor: colors.goldLine,
  },
  toggleDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.gold,
  },
  watching: {
    minHeight: control.height,
    minWidth: control.height,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
  },
  watchingOn: {
    borderColor: colors.goldLine,
    backgroundColor: colors.goldSoft,
  },
  watchingText: {
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.heavy,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  watchingTextOn: {
    color: colors.goldInk,
  },
  watchingCount: {
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.heavy,
    fontVariant: ['tabular-nums'],
  },
  columns: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderStrong,
  },
  columnPlayer: {
    flex: 1,
    minWidth: 0,
  },
  column: {
    textAlign: 'right',
  },
  pressed: {
    opacity: 0.72,
  },
});
