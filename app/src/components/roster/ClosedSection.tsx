import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { gamesCount, unbrokenName } from '../../copy/terms';
import { keepTogether } from '../../data/chromeView';
import { feesDetail, formatAt, holdDots, type ClosedRow, type PartPrecision } from '../../data/rosterView';
import { colors, fonts, space, type, weight } from '../../theme';
import { Button } from '../../ui/kit';
import { FineMoney } from './FineMoney';
import { SectionHead } from './SectionHead';

/** Closed positions listed before "Show all" takes over. */
const COLLAPSED_COUNT = 5;

/** "Short ended Oct 28": a narrow row may wrap the words, never the date. */
function bindDates(text: string): string {
  return text.replace(/\b([A-Z][a-z]{2}) (\d{1,2})\b/g, (_, month: string, day: string) => keepTogether(`${month} ${day}`));
}

/**
 * Dropped players and ended shorts. What they made or lost while you held
 * them stays in your score, so they stay on the screen: the section's total
 * is the "Closed" part of the score breakdown and the sum of these rows.
 */
export function ClosedSection({ rows: allRows, total, totalInset = 0, precision = 'fine', actionFor }: {
  rows: readonly ClosedRow[];
  total: number;
  totalInset?: number;
  precision?: PartPrecision;
  /** A follow-up move for a row, such as "Short again" on a short that ran its term. */
  actionFor?: (row: ClosedRow) => ReactNode;
}) {
  const [showAll, setShowAll] = useState(false);
  // The roster table (a wide list) keeps a Total column and an action column
  // at the right; `totalInset` is the action column plus its gap.
  const table = totalInset > 0;
  // A player dropped before his first game moved nothing but fees; the Fees
  // line counts him instead of a row of zeros.
  const rows = allRows.filter((row) => !row.unplayed);
  if (rows.length === 0) return null;
  const shown = showAll ? rows : rows.slice(0, COLLAPSED_COUNT);
  return (
    <View style={styles.section}>
      <SectionHead
        caption="Dropped players and ended shorts. What they made stays in your score."
        precision={precision}
        title="Closed"
        total={total}
        totalInset={totalInset}
        totalLabel="Closed total"
      />
      {shown.map((row) => {
        const action = actionFor ? actionFor(row) : null;
        const label = `${row.name}, ${row.how.replace(/ · /g, ', ')}, ${gamesCount(row.games)}, ${formatAt(row.total, precision, true)} stays in your score`;
        return (
          <View key={row.positionId} style={[styles.row, table && styles.rowTable]}>
            {/* The facts read as one stop; a follow-up button stays its own stop. */}
            <View accessible accessibilityLabel={label} style={styles.facts}>
              <View style={styles.copy}>
                <Text style={styles.name}>{unbrokenName(row.name)}</Text>
                {/* A wrap never leaves a "·" at a line's end (walk 7 T1-12). */}
                <Text style={styles.detail}>{holdDots(`${bindDates(row.how)} · ${keepTogether(gamesCount(row.games))}`)}</Text>
              </View>
              <View style={[styles.money, { marginRight: table ? 0 : totalInset }]}>
                <FineMoney precision={precision} value={row.total} />
              </View>
            </View>
            {/* In the table the figure stays under Total, like the section
                total and Fees, and Short again sits in the action column,
                where Drop and Close sit above it (walk 4 T2-20). */}
            {table ? (
              <View style={[styles.actionColumn, { width: totalInset - space.sm }]}>{action}</View>
            ) : action ? <View style={styles.rowAction}>{action}</View> : null}
          </View>
        );
      })}
      {rows.length > COLLAPSED_COUNT ? (
        <View style={styles.more}>
          <Button
            accessibilityLabel={showAll ? 'Show fewer closed players' : `Show all ${rows.length} closed players`}
            label={showAll ? 'Show fewer' : `Show all ${rows.length}`}
            onPress={() => setShowAll((current) => !current)}
            variant="quiet"
          />
        </View>
      ) : null}
    </View>
  );
}

/**
 * The last line of the statement: add and drop fees, the score's final part,
 * including the players dropped before they played (whose only effect on the
 * score was their fees).
 */
export function FeesLine({ fees, moves, feeEach = 0, unplayed = [], unplayedShorts = [], totalInset = 0, precision = 'fine' }: {
  fees: number;
  moves: number;
  /** Shorts closed before he played, by name. */
  unplayedShorts?: readonly string[];
  /** The fee for one move, said once: "$250 each". */
  feeEach?: number;
  /** Players dropped before they played a game for you, by name (walk 7 T2-18). */
  unplayed?: readonly string[];
  totalInset?: number;
  precision?: PartPrecision;
}) {
  if (moves === 0) return null;
  // Moves, not "roster moves": shorts opened and closed cost the same fee.
  const detail = feesDetail({ moves, feeEach, dropped: unplayed, closedShorts: unplayedShorts });
  return (
    <View
      accessible
      accessibilityLabel={`Fees, ${detail.replace(/ \u00b7 /g, ', ')}, ${formatAt(fees, precision, true)}`}
      style={[styles.row, styles.fees]}
    >
      <View style={styles.copy}>
        <Text style={styles.name}>Fees</Text>
        <Text style={styles.detail}>{holdDots(detail)}</Text>
      </View>
      <View style={{ marginRight: totalInset }}>
        <FineMoney precision={precision} value={fees} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
  },
  // Too narrow for the words, the figure and Short again on one line (200%
  // zoom): the button takes the next line, then the figure goes under the
  // words, instead of squeezing the words to one letter a line.
  row: {
    minHeight: 48,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  // The table: one line, figure then action column, spaced like a roster row.
  rowTable: {
    flexWrap: 'nowrap',
    gap: space.sm,
  },
  actionColumn: {
    flexShrink: 0,
    alignItems: 'flex-end',
  },
  fees: {
    borderTopWidth: 0,
  },
  facts: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 160,
    minWidth: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.md,
  },
  rowAction: {
    flexShrink: 0,
    marginLeft: 'auto',
  },
  copy: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 110,
    minWidth: 0,
  },
  money: {
    marginLeft: 'auto',
  },
  name: {
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.heavy,
  },
  detail: {
    marginTop: 1,
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.caption,
    fontWeight: weight.bold,
  },
  more: {
    alignItems: 'flex-start',
    paddingHorizontal: space.sm,
  },
});
