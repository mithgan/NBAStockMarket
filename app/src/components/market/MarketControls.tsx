/**
 * The market's list controls: the name search, the Watching filter, and the
 * desktop column header. The screen composes them; the rows live with the
 * screen because their actions and locks are part of its contract.
 */
import { Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, control, fonts, radius, space, type, weight } from '../../theme';
import { Label } from '../../ui/kit';
import { CloseIcon, SearchIcon, StarIcon } from './icons';

/** Fixed widths so the desktop header and every row line up column for column. */
export const MARKET_COLUMNS = {
  avatar: 36,
  price: 104,
  lastSeason: 104,
  edge: 150,
  yours: 150,
  action: 112,
  gap: space.md,
} as const;

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
      accessibilityHint={count === 1 ? 'You watch 1 player' : `You watch ${count} players`}
      accessibilityLabel="Watching only"
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

/** Column labels above the desktop table. Widths come from MARKET_COLUMNS. */
export function MarketColumnHeader({ edgeLabel }: { edgeLabel: string }) {
  return (
    <View style={styles.columns}>
      <Label style={styles.columnPlayer}>Player</Label>
      <Label style={[styles.column, { width: MARKET_COLUMNS.price }]}>Price a game</Label>
      <Label style={[styles.column, { width: MARKET_COLUMNS.lastSeason }]}>Last season</Label>
      <Label style={[styles.column, { width: MARKET_COLUMNS.edge }]}>{edgeLabel}</Label>
      <Label style={[styles.column, { width: MARKET_COLUMNS.yours }]}>Your net a game</Label>
      <View style={{ width: MARKET_COLUMNS.action }} />
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
    gap: MARKET_COLUMNS.gap,
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
