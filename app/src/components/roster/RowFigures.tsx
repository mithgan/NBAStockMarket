import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { PerGamePositionSide } from '../../api/contracts';
import { moneyCompact } from '../../copy/terms';
import { figureCaptions, perGamePrecision } from '../../data/rosterView';
import { colors, fonts, space, type, weight } from '../../theme';
import { visuallyHidden } from '../../ui/kit';
import { FineMoney } from './FineMoney';

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
  /** His price a game in the market today, shown under your locked price on wide lists. */
  now?: number | null;
}

/**
 * A number that does not exist yet (no settled games), kept in its column:
 * a drawn dash, heard as "none yet" in text a reader gets (a name on the
 * role-less dash was not read by every screen reader; walk 15 T3-09).
 */
function Missing() {
  return (
    <View>
      <Text aria-hidden style={styles.missing}>—</Text>
      <Text style={visuallyHidden}>none yet</Text>
    </View>
  );
}

/** Shares of a phone row's width: the dividend column is widest because its caption is longest. */
const PHONE_SHARES = { price: 1, dividend: 1.2, net: 1, total: 0.85 } as const;

function Share({ grow, children }: { grow: number; children: ReactNode }) {
  return <View style={[styles.cell, { flexGrow: grow, flexBasis: 0 }]}>{children}</View>;
}

/**
 * Phone rows: the figures on one line, right-aligned in the same columns as
 * the section's `FigureLegend`, so each label is read once per list rather
 * than on every row. `narrow` phones (under 380 CSS px) leave out Profit a
 * game, which is the dividend minus the price, so the rest never run
 * together. A value never shrinks below its own width: with enlarged letter
 * or word spacing a figure wraps to a second line instead of touching the
 * next one. A per-game figure that is the same money as the Total (one
 * game) reads as the Total does (`perGamePrecision`, walk 15 T1-04).
 */
export function StackedFigures({ price, dividend, net, total, narrow = false }: Figures & { narrow?: boolean }) {
  // Drawn for the eye: the row's own name already says each figure with its
  // caption, so screen readers no longer hear four bare amounts after it
  // (fix 10 roster owner's note).
  return (
    <View aria-hidden style={styles.line}>
      <Share grow={PHONE_SHARES.price}><FineMoney precision={perGamePrecision(price, total)} signed={false} value={price} /></Share>
      <Share grow={PHONE_SHARES.dividend}>
        {dividend === null ? <Missing /> : <FineMoney precision={perGamePrecision(dividend, total)} signed={false} value={dividend} />}
      </Share>
      {narrow ? null : <Share grow={PHONE_SHARES.net}>{net === null ? <Missing /> : <FineMoney precision={perGamePrecision(net, total)} value={net} />}</Share>}
      <Share grow={PHONE_SHARES.total}><FineMoney value={total} /></Share>
    </View>
  );
}

/** The phone list's one legend: the captions over the `StackedFigures` columns. */
export function FigureLegend({ side, narrow = false }: { side: PerGamePositionSide; narrow?: boolean }) {
  const captions = figureCaptions(side);
  return (
    // Drawn for the eye only: each row says its captions (on the web too,
    // where the native-only props did nothing).
    <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.line}>
      <Share grow={PHONE_SHARES.price}><Text style={styles.caption}>{captions.price}</Text></Share>
      <Share grow={PHONE_SHARES.dividend}><Text style={styles.caption}>{captions.dividend}</Text></Share>
      {narrow ? null : <Share grow={PHONE_SHARES.net}><Text style={styles.caption}>{captions.net}</Text></Share>}
      <Share grow={PHONE_SHARES.total}><Text style={styles.caption}>{captions.total}</Text></Share>
    </View>
  );
}

/**
 * Narrow windows and very large text: one figure a line, its label on the
 * left and the value on the right, so nothing has to share a line it cannot
 * fit on. Values still line up at the right edge from row to row. With one
 * game (`oneGame`, `oneGameFigure`) Profit a game is his Total, the same
 * money: it is written once, on the Total line (walk 16 T4-05).
 */
export function ListFigures({ side, price, dividend, net, total, oneGame = false }: Figures & { oneGame?: boolean }) {
  const captions = figureCaptions(side);
  const line = (caption: string, value: ReactNode) => (
    <View style={styles.listLine}>
      <Text style={styles.listCaption}>{caption}</Text>
      {/* If the pair ever wraps, the value still ends at the right edge. */}
      <View style={styles.listValue}>{value}</View>
    </View>
  );
  return (
    <View style={styles.list}>
      {line(captions.price, <FineMoney precision={perGamePrecision(price, total)} signed={false} value={price} />)}
      {line(captions.dividend, dividend === null ? <Missing /> : <FineMoney precision={perGamePrecision(dividend, total)} signed={false} value={dividend} />)}
      {oneGame ? null : line(captions.net, net === null ? <Missing /> : <FineMoney precision={perGamePrecision(net, total)} value={net} />)}
      {line(captions.total, <FineMoney value={total} />)}
    </View>
  );
}

/** Column widths for the wide table; captions fit on one line at 11px. */
export const TABLE_COLUMNS = { price: 76, dividend: 96, net: 76, total: 80 } as const;

/**
 * Wide lists: the header row over the figure columns (the section's legend).
 * Drawn only: the table under it names its own columns to screen readers, so
 * the words are not heard twice (walk 10 T3-03). The native props do nothing
 * on the web; `aria-hidden` does.
 */
export function TableHeader({ side, actionWidth }: { side: PerGamePositionSide; actionWidth: number }) {
  const captions = figureCaptions(side);
  return (
    <View accessibilityElementsHidden aria-hidden importantForAccessibility="no-hide-descendants" style={styles.tableHeader}>
      <Text style={[styles.caption, styles.headerPlayer]}>Player</Text>
      <Text style={[styles.caption, { width: TABLE_COLUMNS.price }]}>{captions.price}</Text>
      <Text style={[styles.caption, { width: TABLE_COLUMNS.dividend }]}>{captions.dividend}</Text>
      <Text style={[styles.caption, { width: TABLE_COLUMNS.net }]}>{captions.net}</Text>
      <Text style={[styles.caption, { width: TABLE_COLUMNS.total }]}>{captions.total}</Text>
      {/* No action column at season end (walk 13 T4-03): Total ends the table. */}
      {actionWidth > 0 ? <View style={{ width: actionWidth }} /> : null}
    </View>
  );
}

/**
 * Wide lists: the four figures as table cells under `TableHeader`. When his
 * market price has moved since you locked yours, a quiet "now $113.5K" under
 * your price says what re-adding him would cost today.
 */
export function TableFigures({ price, dividend, net, total, now = null }: Figures) {
  // Each figure a cell of the Roster table, under its column header (walk 8 T3-09).
  const cell = (width: number, value: ReactNode) => <View role="cell" style={[styles.cell, { width }]}>{value}</View>;
  const moved = now !== null && moneyCompact(now) !== moneyCompact(price);
  return (
    <>
      {cell(TABLE_COLUMNS.price, (
        <>
          <FineMoney precision={perGamePrecision(price, total)} signed={false} value={price} />
          {moved ? <Text aria-hidden style={styles.now}>now {moneyCompact(now)}</Text> : null}
          {moved ? <Text style={visuallyHidden}>{`market price now ${moneyCompact(now)} a game`}</Text> : null}
        </>
      ))}
      {cell(TABLE_COLUMNS.dividend, dividend === null ? <Missing /> : <FineMoney precision={perGamePrecision(dividend, total)} signed={false} value={dividend} />)}
      {cell(TABLE_COLUMNS.net, net === null ? <Missing /> : <FineMoney precision={perGamePrecision(net, total)} value={net} />)}
      {cell(TABLE_COLUMNS.total, <FineMoney value={total} />)}
    </>
  );
}

/**
 * The first visit's empty roster on a wide screen (walk 13 T2-02): under the
 * table's drawn columns, one ghost row says what will fill the room ("No
 * players yet. Your first player appears here after you add him."), each
 * column holding a dash. Its words are read as text; the dashes and the
 * empty photo are drawn only.
 */
export function TableGhostRow({ actionWidth }: { actionWidth: number }) {
  const dash = (width: number) => (
    <View style={[styles.cell, { width }]}>
      <Text style={styles.missing}>—</Text>
    </View>
  );
  return (
    <View style={styles.ghostRow}>
      <View aria-hidden style={styles.ghostPhoto} />
      <View style={styles.ghostWords}>
        <Text style={styles.ghostName}>No players yet</Text>
        <Text style={styles.ghostMeta}>Your first player appears here after you add him.</Text>
      </View>
      <View aria-hidden style={styles.ghostFigures}>
        {dash(TABLE_COLUMNS.price)}
        {dash(TABLE_COLUMNS.dividend)}
        {dash(TABLE_COLUMNS.net)}
        {dash(TABLE_COLUMNS.total)}
        {actionWidth > 0 ? <View style={{ width: actionWidth }} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  line: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: space.sm,
    rowGap: 2,
  },
  cell: {
    alignItems: 'flex-end',
    // Never narrower than the figure it holds (react-native-web defaults to 0).
    minWidth: 'auto',
  },
  now: {
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
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
  list: {
    gap: 2,
  },
  // The ghost row sits on the table rows' grid: same insets, gaps and height.
  ghostRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  ghostPhoto: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.controlBorder,
  },
  ghostWords: {
    flex: 1,
    minWidth: 0,
    marginLeft: 4,
  },
  ghostName: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
  },
  ghostMeta: {
    marginTop: 3,
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.caption,
    fontWeight: weight.bold,
  },
  ghostFigures: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  listLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    columnGap: space.sm,
  },
  listCaption: {
    flexShrink: 1,
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.bold,
  },
  listValue: {
    marginLeft: 'auto',
  },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
  },
  headerPlayer: {
    flex: 1,
    textAlign: 'left',
  },
});
