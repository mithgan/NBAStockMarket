/**
 * The market's list controls: the name search, the Watching filter, and the
 * desktop column header. The screen composes them; the rows live with the
 * screen because their actions and locks are part of its contract.
 */
import { useEffect, useRef, useState, type Ref } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';

import {
  COLUMN_EXPLANATIONS,
  orderButtonName,
  orderButtonTitle,
  sortAscending,
  sortDirection,
  type MarketColumnSet,
  type MarketSort,
  type MarketSortOption,
} from '../../data/marketView';
import { colors, control, fonts, radius, space, type, weight } from '../../theme';
import { CloseIcon, SearchIcon, SortOrderIcon, StarIcon } from './icons';
import { spaceToggles } from './switchKeys';

/** A hover title (the browser's tooltip) on a control; react-native-web does not pass `title` through. */
function useTitle(ref: { current: unknown }, title: string): void {
  useEffect(() => {
    const node = ref.current as { setAttribute?: (name: string, value: string) => void } | null;
    node?.setAttribute?.('title', title);
  }, [ref, title]);
}

type KeyEvent = { key: string; preventDefault: () => void };

/**
 * The one button that flips the order: an arrow icon, 44x44, named for the
 * order it shows ("Order: highest first"), with a hover title that says what
 * a press does.
 */
export function OrderButton({
  sort,
  reversed,
  onFlip,
  size = control.height,
}: {
  sort: MarketSort;
  reversed: boolean;
  onFlip: () => void;
  size?: number;
}) {
  const ref = useRef<View>(null);
  useTitle(ref, orderButtonTitle(sort, reversed));
  return (
    <Pressable
      ref={ref}
      accessibilityLabel={orderButtonName(sort, reversed)}
      accessibilityRole="button"
      onPress={onFlip}
      {...spaceToggles(onFlip)}
      style={(state) => [
        styles.order,
        { width: size, height: size },
        reversed && styles.orderFlipped,
        (state as { hovered?: boolean }).hovered === true && styles.hover,
        state.pressed && styles.pressed,
      ]}
    >
      <SortOrderIcon descending={!sortAscending(sort, reversed)} />
    </Pressable>
  );
}

/**
 * Sort by Price, Value or Name (Dividend where the table shows it): a radio
 * group, so choosing one only ever chooses it. Arrow keys move and choose,
 * Space and Enter choose, and nothing here flips the order: the order button
 * beside it does (walk 3 T1-08, T2-05, T3-02). Labels carry no arrow, so
 * they never run out of room.
 */
export function SortControl({
  options,
  sort,
  reversed,
  onChoose,
  onFlip,
  style,
}: {
  options: MarketSortOption[];
  sort: MarketSort;
  reversed: boolean;
  onChoose: (sort: MarketSort) => void;
  onFlip: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const refs = useRef<Array<View | null>>([]);
  const selectedIndex = options.findIndex((option) => option.key === sort);
  const move = (to: number) => {
    const index = (to + options.length) % options.length;
    onChoose(options[index].key);
    (refs.current[index] as unknown as { focus?: () => void } | null)?.focus?.();
  };
  const onKeyDown = (event: KeyEvent) => {
    const from = Math.max(0, selectedIndex);
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); move(from + 1); }
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); move(from - 1); }
    else if (event.key === 'Home') { event.preventDefault(); move(0); }
    else if (event.key === 'End') { event.preventDefault(); move(options.length - 1); }
  };
  return (
    <View style={[styles.sortRow, style]}>
      <View
        accessibilityLabel="Sort players"
        role="radiogroup"
        style={styles.radioGroup}
        {...({ onKeyDown } as object)}
      >
        {options.map((option, index) => {
          const checked = option.key === sort;
          return (
            <Pressable
              key={option.key}
              ref={(node) => {
                refs.current[index] = node;
              }}
              accessibilityLabel={option.name}
              aria-checked={checked}
              onPress={() => onChoose(option.key)}
              role="radio"
              {...({
                tabIndex: checked || (selectedIndex < 0 && index === 0) ? 0 : -1,
                onKeyDown: (event: KeyEvent) => {
                  if (event.key === ' ' || event.key === 'Spacebar') { event.preventDefault(); onChoose(option.key); }
                },
              } as object)}
              style={(state) => [
                styles.radio,
                index > 0 && styles.radioDivider,
                checked && styles.radioChecked,
                (state as { hovered?: boolean }).hovered === true && !checked && styles.hover,
                state.pressed && !checked && styles.pressed,
              ]}
            >
              <Text maxFontSizeMultiplier={1.3} style={[styles.radioText, checked && styles.radioTextChecked]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <OrderButton onFlip={onFlip} reversed={reversed} sort={sort} />
    </View>
  );
}

export function MarketSearch({
  value,
  onChange,
  style,
  placeholder = 'Search players',
  onEscapeEmpty,
}: {
  value: string;
  onChange: (next: string) => void;
  style?: StyleProp<ViewStyle>;
  /** "Search" where "Search players" would be cut (under 360px, walk 5 T4-13); the name stays "Search players". */
  placeholder?: string;
  /** Escape in the empty field: the folded panel closes and focus returns to its toggle. */
  onEscapeEmpty?: () => void;
}) {
  // The input itself carries the border so its own box is the full 44px; the
  // magnifier and the clear control sit over its padding. Clearing keeps the
  // keyboard up (focus goes back into the field); Escape clears a search, and
  // Escape in the empty field keeps focus there (it used to fall to the page,
  // walk 5 T3-03), or closes the folded panel it sits in.
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
          else onEscapeEmpty?.();
        }}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        returnKeyType="search"
        style={[styles.searchInput, value.length > 0 && styles.searchInputClearable]}
        value={value}
      />
      {/* Decorative: the field is named "Search players" (walk 4 T3-13). */}
      <View aria-hidden style={styles.searchIcon}>
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
  labelled = false,
  buttonRef,
}: {
  open: boolean;
  /** A search, a non-default sort or the Watching filter is on. */
  active: boolean;
  onToggle: () => void;
  /** Say "Search & sort" beside the icon (a wide, short window has the room). */
  labelled?: boolean;
  /** Where Escape in the folded search returns focus. */
  buttonRef?: Ref<View>;
}) {
  return (
    <Pressable
      ref={buttonRef}
      accessibilityLabel={active ? 'Search and sort, filters on' : 'Search and sort'}
      accessibilityRole="button"
      aria-expanded={open}
      onPress={onToggle}
      style={({ pressed }) => [styles.toggle, labelled && styles.toggleLabelled, (open || active) && styles.toggleOn, pressed && styles.pressed]}
    >
      <SearchIcon />
      {labelled ? <Text maxFontSizeMultiplier={1.3} style={styles.toggleText}>{'Search & sort'}</Text> : null}
      {active ? <View style={styles.toggleDot} /> : null}
    </Pressable>
  );
}

/**
 * Column labels above the list; the widths are the rows' own (marketColumns).
 * One style for every label (capitals, the same weight and colour, up to two
 * lines, set on the bottom edge). Player, Price a game, Dividend last season
 * and Value are sort buttons with a mark (↕, or the gold arrow of the sort in
 * use); Your profit a game is a plain label. Pressing another column chooses it
 * in its natural order; pressing the column in use reverses it, as a table
 * header does, and its button's name says the order ("sorted lowest first").
 * Value and Dividend last season explain themselves on hover and focus.
 */
export function MarketColumnHeader({
  columns,
  valueLabel,
  sort,
  reversed,
  onChoose,
  onFlip,
  lead = 0,
}: {
  columns: MarketColumnSet;
  /** Extra room before the avatar column (the rows' watch star). */
  lead?: number;
  valueLabel: string;
  sort: MarketSort;
  reversed: boolean;
  onChoose: (sort: MarketSort) => void;
  onFlip: () => void;
}) {
  // One explanation at a time, the most recent of hover or keyboard focus;
  // Escape hides it while focus stays (walk 5 T3-12, WCAG 1.4.13).
  const [tip, setTip] = useState<{ key: MarketSort; by: TipSource } | null>(null);
  const onTip = (key: MarketSort, by: TipSource, on: boolean) => {
    if (by === 'escape') setTip(null);
    else if (on) setTip({ key, by });
    else setTip((current) => (current && current.key === key && current.by === by ? null : current));
  };
  return (
    // A row of sort buttons over the list, not a table: the player rows are
    // buttons, not table rows, so a table role promised navigation it could
    // not deliver (walk 4 T3-01). Each button's name says its sort state.
    <View accessibilityLabel="Sort by column" role="group">
      <View style={[styles.columns, { gap: columns.gap }]}>
        {lead > 0 ? <View style={{ width: lead }} /> : null}
        <View style={{ width: columns.avatar }} />
        <SortHeader columnKey="name" label="Player" onChoose={onChoose} onFlip={onFlip} reversed={reversed} sort={sort} />
        <SortHeader columnKey="price" label={'Price a\u00A0game'} onChoose={onChoose} onFlip={onFlip} reversed={reversed} sort={sort} width={columns.price} />
        <SortHeader
          columnKey="dividend"
          explain={COLUMN_EXPLANATIONS.dividend}
          onTip={onTip}
          tipShown={tip?.key === 'dividend'}
          label={'Dividend last\u00A0season'}
          onChoose={onChoose}
          onFlip={onFlip}
          reversed={reversed}
          sort={sort}
          width={columns.lastSeason}
        />
        <SortHeader
          columnKey="value"
          explain={COLUMN_EXPLANATIONS.value}
          onTip={onTip}
          tipShown={tip?.key === 'value'}
          label={valueLabel}
          onChoose={onChoose}
          onFlip={onFlip}
          reversed={reversed}
          sort={sort}
          width={columns.edge}
        />
        {columns.yours > 0 ? (
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.headerCell, styles.headerPlain, { width: columns.yours }]}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.headerText, styles.headerTextNumber]}>{'Your profit a\u00A0game'}</Text>
          </View>
        ) : null}
        <View style={{ width: columns.action }} />
      </View>
    </View>
  );
}

let explainIds = 0;

type TipSource = 'hover' | 'focus' | 'escape';

function SortHeader({
  columnKey,
  label,
  width,
  explain,
  tipShown = false,
  onTip,
  sort,
  reversed,
  onChoose,
  onFlip,
}: {
  columnKey: MarketSort;
  label: string;
  /** A number column's width; none for the Player column, which takes the rest. */
  width?: number;
  explain?: string;
  /** This column's explanation is the one showing. */
  tipShown?: boolean;
  onTip?: (key: MarketSort, by: TipSource, on: boolean) => void;
  sort: MarketSort;
  reversed: boolean;
  onChoose: (sort: MarketSort) => void;
  onFlip: () => void;
}) {
  const on = sort === columnKey;
  const number = width !== undefined;
  const words = label.replace(/\u00A0/g, ' ');
  const [explainId] = useState(() => `market-column-explain-${(explainIds += 1)}`);
  const ascending = sortAscending(columnKey, reversed);
  // The arrow is part of the header's one target: the column in use flips its
  // order when pressed, as a table header does; another column is chosen at
  // its natural order. One target per column is also a full-size one (the
  // arrow alone was 24px wide, the label 40px).
  // The sort mark rides on the label's last line, right after its words, in
  // every column (it floated above the words, before some labels and after
  // others; walk 5 T2-01, T2-13). The button's name says the order.
  const mark = (
    <Text aria-hidden style={[styles.mark, styles.markInline, on && styles.markOn]}>
      {`\u00A0${on ? (ascending ? '↑' : '↓') : '↕'}`}
    </Text>
  );
  const press = on ? onFlip : () => onChoose(columnKey);
  return (
    <View style={[styles.headerCell, number ? { width } : styles.columnPlayer]}>
      <Pressable
        accessibilityLabel={on ? `${words}, sorted ${sortDirection(columnKey, reversed)}` : `${words}, sort by ${words.toLowerCase()}`}
        accessibilityRole="button"
        onBlur={() => onTip?.(columnKey, 'focus', false)}
        // Keyboard focus shows the explanation; a click's focus does not.
        onFocus={(event) => {
          const target = event.target as unknown as { matches?: (selector: string) => boolean };
          if (target.matches?.(':focus-visible') ?? true) onTip?.(columnKey, 'focus', true);
        }}
        onHoverIn={() => onTip?.(columnKey, 'hover', true)}
        onHoverOut={() => onTip?.(columnKey, 'hover', false)}
        onPress={press}
        style={(state) => [
          styles.headerInner,
          styles.sorter,
          // Player's label starts over the names; number labels end over
          // their figures (walk 4 T2-02: Player sat ~360px right of the names).
          number ? styles.headerInnerNumber : styles.headerInnerStart,
          (state as { hovered?: boolean }).hovered === true && styles.hover,
          state.pressed && styles.pressed,
        ]}
        {...(explain ? ({
          'aria-describedby': explainId,
          onKeyDown: (event: KeyEvent) => {
            if (event.key === 'Escape' && tipShown) onTip?.(columnKey, 'escape', false);
          },
        } as object) : {})}
      >
        <Text maxFontSizeMultiplier={1.4} style={[styles.headerText, number && styles.headerTextNumber, on && styles.headerTextOn, number && styles.headerTextShrink]}>
          {label}
          {mark}
        </Text>
      </Pressable>
      {explain ? (
        <View pointerEvents="none" style={[styles.explain, !tipShown && styles.explainHidden]}>
          <Text nativeID={explainId} style={styles.explainText}>{explain}</Text>
        </View>
      ) : null}
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
  toggleLabelled: {
    width: 'auto',
    flexDirection: 'row',
    gap: space.xs,
    paddingHorizontal: space.md,
  },
  toggleText: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.heavy,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
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
  order: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.controlBorder,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
  },
  orderFlipped: {
    // The unusual order is marked on the button too, not only in the note.
    borderColor: colors.goldLine,
    backgroundColor: colors.goldSoft,
  },
  hover: {
    backgroundColor: colors.surfaceHigh,
  },
  sortRow: {
    // A phone at 200% zoom puts the order button under the choices rather
    // than cutting a label; any wider window keeps one line.
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
  },
  radioGroup: {
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderWidth: 1,
    borderColor: colors.controlBorder,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  radio: {
    // Never narrower than its word: labels are never cut.
    flexGrow: 1,
    flexShrink: 0,
    flexBasis: 'auto',
    minHeight: control.height - 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.sm,
  },
  radioDivider: {
    borderLeftWidth: 1,
    borderLeftColor: colors.borderStrong,
  },
  radioChecked: {
    backgroundColor: colors.goldSoft,
    // The kit's segment mark: a 3px bar in any colour vision and theme.
    borderBottomWidth: 3,
    borderBottomColor: colors.goldInk,
  },
  radioText: {
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.heavy,
    letterSpacing: 1,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  radioTextChecked: {
    color: colors.goldInk,
  },
  columns: {
    minHeight: control.height,
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderStrong,
  },
  columnPlayer: {
    flex: 1,
    minWidth: 0,
  },
  headerCell: {
    position: 'relative',
    justifyContent: 'flex-end',
  },
  headerPlain: {
    paddingBottom: 8,
  },
  headerInner: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  headerInnerNumber: {
    justifyContent: 'flex-end',
  },
  headerInnerStart: {
    justifyContent: 'flex-start',
  },
  headerText: {
    // One style for every column label, sortable or not (walk 3 T2-04).
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.heavy,
    letterSpacing: 1,
    lineHeight: 14,
    textTransform: 'uppercase',
  },
  headerTextNumber: {
    textAlign: 'right',
  },
  headerTextOn: {
    color: colors.goldInk,
  },
  sorter: {
    minHeight: control.height,
    justifyContent: 'flex-end',
    paddingBottom: 8,
  },
  headerTextShrink: {
    flexShrink: 1,
  },
  mark: {
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.heavy,
    lineHeight: 14,
  },
  markInline: {
    lineHeight: undefined,
  },
  markOn: {
    color: colors.goldInk,
    fontSize: type.caption,
  },
  explain: {
    // Above the label, over the toolbar's sentence, so it never covers the
    // first row's figures (walk 5 T3-12).
    position: 'absolute',
    bottom: '100%',
    marginBottom: 2,
    right: 0,
    zIndex: 5,
    width: 220,
    paddingHorizontal: space.sm,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
  },
  explainHidden: {
    display: 'none',
  },
  explainText: {
    color: colors.text,
    fontSize: type.caption,
    lineHeight: 17,
  },
  pressed: {
    opacity: 0.72,
  },
});
