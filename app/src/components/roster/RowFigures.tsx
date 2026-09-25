import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import type { PerGamePositionSide } from '../../api/contracts';
import { figureCaptions } from '../../data/rosterView';
import { colors, fonts, space, type, weight } from '../../theme';
import { Money } from '../../ui/kit';

/** A small padlock: the price was locked when you added him. Decorative; rows say "locked" in words for screen readers. */
export function LockGlyph({ color = colors.faint }: { color?: string }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.lock}>
      <Svg height={11} viewBox="0 0 10 12" width={9}>
        <Path d="M2.6 5.2V3.6a2.4 2.4 0 0 1 4.8 0v1.6" fill="none" stroke={color} strokeWidth={1.5} />
        <Rect fill={color} height={6.6} rx={1.3} width={8.4} x={0.8} y={5} />
      </Svg>
    </View>
  );
}

/** A number that does not exist yet (no settled games), kept in its column. */
function Missing() {
  return <Text accessibilityLabel="none yet" style={styles.missing}>—</Text>;
}

/** A result: signed and coloured, except exactly $0, which is neither a gain nor a loss. */
function Result({ value }: { value: number }) {
  if (value === 0) return <Money colored={false} signed={false} style={styles.zero} value={0} />;
  return <Money value={value} />;
}

export interface Figures {
  side: PerGamePositionSide;
  /** Locked price a game (credited a game for a short). */
  price: number;
  /** Average dividend a game, or null before his first settled game. */
  dividend: number | null;
  /** Average net a game, or null before his first settled game. */
  net: number | null;
  /** Lifetime result of this position. */
  total: number;
}

function PriceValue({ price }: { price: number }) {
  return (
    <View style={styles.price}>
      <LockGlyph />
      <Money signed={false} value={price} />
    </View>
  );
}

function Cell({ caption, children, width, grow, half }: {
  caption?: string;
  children: ReactNode;
  /** Fixed width (table columns) … */
  width?: number;
  /** … or a share of the strip (phone rows) … */
  grow?: number;
  /** … or half a line (very large text), which wins over `grow`. */
  half?: boolean;
}) {
  const size = width !== undefined ? { width } : half ? styles.cellHalf : { flexGrow: grow ?? 1, flexBasis: 0 };
  return (
    <View style={[styles.cell, size]}>
      {children}
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    </View>
  );
}

/**
 * Phone rows: the per-game truth and the total in four right-aligned columns
 * across the full row, each with its caption, so the numbers line up from row
 * to row and every row explains itself without a header that has scrolled
 * away. The dividend column gets the widest share because its caption is the
 * longest.
 */
export function StackedFigures({ side, price, dividend, net, total, twoByTwo = false }: Figures & {
  /** Very large text: two columns a line so nothing collides. */
  twoByTwo?: boolean;
}) {
  const captions = figureCaptions(side);
  return (
    <View style={[styles.stacked, twoByTwo && styles.stackedWrap]}>
      <Cell caption={captions.price} grow={1} half={twoByTwo}><PriceValue price={price} /></Cell>
      <Cell caption={captions.dividend} grow={1.2} half={twoByTwo}>
        {dividend === null ? <Missing /> : <Money signed={false} value={dividend} />}
      </Cell>
      <Cell caption={captions.net} grow={1} half={twoByTwo}>
        {net === null ? <Missing /> : <Result value={net} />}
      </Cell>
      <Cell caption={captions.total} grow={0.85} half={twoByTwo}><Result value={total} /></Cell>
    </View>
  );
}

/** Column widths for the wide table; captions fit on one line at 11px. */
export const TABLE_COLUMNS = { price: 76, dividend: 96, net: 72, total: 72 } as const;

/** Wide lists: the header row over the figure columns. */
export function TableHeader({ side, actionWidth }: { side: PerGamePositionSide; actionWidth: number }) {
  const captions = figureCaptions(side);
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.tableHeader}>
      <Text style={[styles.headerText, styles.headerPlayer]}>Player</Text>
      <Text style={[styles.headerText, { width: TABLE_COLUMNS.price }]}>{captions.price}</Text>
      <Text style={[styles.headerText, { width: TABLE_COLUMNS.dividend }]}>{captions.dividend}</Text>
      <Text style={[styles.headerText, { width: TABLE_COLUMNS.net }]}>{captions.net}</Text>
      <Text style={[styles.headerText, { width: TABLE_COLUMNS.total }]}>{captions.total}</Text>
      <View style={{ width: actionWidth }} />
    </View>
  );
}

/** Wide lists: the four figures as table cells under `TableHeader`. */
export function TableFigures({ price, dividend, net, total }: Figures) {
  return (
    <>
      <Cell width={TABLE_COLUMNS.price}><PriceValue price={price} /></Cell>
      <Cell width={TABLE_COLUMNS.dividend}>
        {dividend === null ? <Missing /> : <Money signed={false} value={dividend} />}
      </Cell>
      <Cell width={TABLE_COLUMNS.net}>{net === null ? <Missing /> : <Result value={net} />}</Cell>
      <Cell width={TABLE_COLUMNS.total}><Result value={total} /></Cell>
    </>
  );
}

const styles = StyleSheet.create({
  lock: {
    marginRight: 4,
    marginBottom: 1,
  },
  price: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stacked: {
    flexDirection: 'row',
    gap: space.sm,
  },
  stackedWrap: {
    flexWrap: 'wrap',
    rowGap: space.sm,
  },
  cellHalf: {
    width: '47%',
  },
  zero: {
    color: colors.muted,
  },
  cell: {
    alignItems: 'flex-end',
    minWidth: 0,
  },
  caption: {
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.bold,
    lineHeight: 14,
    textAlign: 'right',
  },
  missing: {
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
  },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.xs,
    paddingBottom: space.xs + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  headerText: {
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.bold,
    textAlign: 'right',
  },
  headerPlayer: {
    flex: 1,
    textAlign: 'left',
  },
});
