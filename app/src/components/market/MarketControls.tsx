/**
 * The market's list controls: the name search, the Watching filter, and the
 * desktop column header. The screen composes them; the rows live with the
 * screen because their actions and locks are part of its contract.
 */
import { useRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';

import { sortAscending, sortDirection, type MarketColumnSet, type MarketSort } from '../../data/marketView';
import { colors, control, fonts, radius, space, type, weight } from '../../theme';
import { Label } from '../../ui/kit';
import { CloseIcon, SearchIcon, StarIcon } from './icons';
import { spaceToggles } from './switchKeys';

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
  // magnifier and the clear control sit over its padding. Clearing keeps the
  // keyboard up (focus goes back into the field); Escape clears a search, and
  // a second Escape leaves the field.
  const input = useRef<TextInput>(null);
  return (
    <View style={[styles.search, style]}>
      <TextInput
        ref={input}
        accessibilityLabel="Search players"
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="never"
        maxFontSizeMultiplier={1.4}
        onChangeText={onChange}
        onKeyPress={(event) => {
          if (event.nativeEvent.key !== 'Escape') return;
          if (value.length > 0) onChange('');
          else input.current?.blur();
        }}
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
          onPress={() => {
            onChange('');
            input.current?.focus();
          }}
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
      {...spaceToggles(() => onChange(!on))}
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

/**
 * Column labels above the table; the widths are the rows' own (marketColumns).
 * Player, Price and Value sort the list (again to flip): they read as
 * controls, in capitals with a sort mark (↕, or the gold arrow of the sort in
 * use), and carry aria-sort. Their names start with the words you see (voice
 * control: "Value, sort by value"). The other labels are plain captions, read
 * with each row, so they stay silent.
 */
export function MarketColumnHeader({
  columns,
  valueLabel,
  sort,
  reversed,
  onSort,
  lead = 0,
}: {
  columns: MarketColumnSet;
  /** Extra room before the avatar column (the rows' watch star). */
  lead?: number;
  valueLabel: string;
  sort: MarketSort;
  reversed: boolean;
  onSort: (sort: MarketSort) => void;
}) {
  const sorter = (key: MarketSort, label: string, width?: number) => {
    const on = sort === key;
    const mark = on ? (sortAscending(key, reversed) ? '↑' : '↓') : '↕';
    return (
      <View
        role="columnheader"
        {...({ 'aria-sort': on ? (sortAscending(key, reversed) ? 'ascending' : 'descending') : 'none' } as object)}
        style={width === undefined ? styles.columnPlayer : { width }}
      >
        <Pressable
          accessibilityLabel={on ? `${label}, sorted ${sortDirection(key, reversed)}` : `${label}, sort by ${key}`}
          accessibilityRole="button"
          onPress={() => onSort(key)}
          style={({ pressed }) => [styles.sorter, pressed && styles.pressed]}
        >
          <View style={styles.sorterLabel}>
            <Label style={[width !== undefined && styles.column, styles.sortable, on && styles.columnOn]}>
              {width === undefined ? `${label}\u00A0${mark}` : label}
            </Label>
            {/* A number column's mark sits in the gap to its right, so the label keeps one line. */}
            {width !== undefined ? (
              <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.arrow, on && styles.arrowOn]}>{mark}</Text>
            ) : null}
          </View>
        </Pressable>
      </View>
    );
  };
  return (
    <View accessibilityLabel="Market columns" role="table">
      <View role="row" style={[styles.columns, { gap: columns.gap }]}>
        {lead > 0 ? <View style={{ width: lead }} /> : null}
        <View style={{ width: columns.avatar }} />
        {sorter('name', 'Player')}
        {sorter('price', 'Price a game', columns.price)}
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.quietColumn, { width: columns.lastSeason }]}>
          <Text maxFontSizeMultiplier={1.4} style={styles.plainColumn}>Dividend last season</Text>
        </View>
        {sorter('value', valueLabel, columns.edge)}
        {columns.yours > 0 ? (
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.quietColumn, { width: columns.yours }]}>
            <Text maxFontSizeMultiplier={1.4} style={styles.plainColumn}>Your net a game</Text>
          </View>
        ) : null}
        <View style={{ width: columns.action }} />
      </View>
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
    borderColor: colors.controlBorder,
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
    borderColor: colors.controlBorder,
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
    borderColor: colors.controlBorder,
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
    // A fixed slot for up to two digits, so the row never shifts as it counts.
    minWidth: 16,
    textAlign: 'center',
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.heavy,
    fontVariant: ['tabular-nums'],
  },
  columns: {
    minHeight: control.height,
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
  sortable: {
    // A control: the brighter label colour, in capitals, with its sort mark.
    color: colors.muted,
  },
  columnOn: {
    color: colors.goldInk,
  },
  plainColumn: {
    // A caption, not a control: sentence case, lighter, no sort mark.
    color: colors.faint,
    fontFamily: fonts.body,
    fontSize: type.label,
    fontWeight: weight.bold,
    lineHeight: 14,
    textAlign: 'right',
  },
  sorter: {
    minHeight: control.height,
    justifyContent: 'center',
  },
  sorterLabel: {
    position: 'relative',
  },
  arrow: {
    position: 'absolute',
    right: -11,
    top: 0,
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.heavy,
  },
  arrowOn: {
    color: colors.goldInk,
  },
  quietColumn: {
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.72,
  },
});
