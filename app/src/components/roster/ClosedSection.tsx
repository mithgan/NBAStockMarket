import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { exactMoney, gamesCount, unbrokenName } from '../../copy/terms';
import { keepTogether } from '../../data/chromeView';
import { formatAt, type ClosedRow, type PartPrecision } from '../../data/rosterView';
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
          <View key={row.positionId} style={styles.row}>
            {/* The facts read as one stop; a follow-up button stays its own stop. */}
            <View accessible accessibilityLabel={label} style={styles.facts}>
              <View style={styles.copy}>
                <Text style={styles.name}>{unbrokenName(row.name)}</Text>
                <Text style={styles.detail}>{bindDates(row.how)} · {keepTogether(gamesCount(row.games))}</Text>
              </View>
              <View style={{ marginRight: totalInset }}>
                <FineMoney precision={precision} value={row.total} />
              </View>
            </View>
            {action ? <View style={styles.rowAction}>{action}</View> : null}
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
export function FeesLine({ fees, moves, feeEach = 0, unplayed = 0, totalInset = 0, precision = 'fine' }: {
  fees: number;
  moves: number;
  /** The fee for one move, said once: "$250 each". */
  feeEach?: number;
  /** Closed positions that never played a game for you. */
  unplayed?: number;
  totalInset?: number;
  precision?: PartPrecision;
}) {
  if (moves === 0) return null;
  // Moves, not "roster moves": shorts opened and closed cost the same fee.
  const detail = `${moves} ${moves === 1 ? 'move' : 'moves'}`
    + (feeEach > 0 ? ` · ${exactMoney(feeEach)} each` : '')
    + (unplayed > 0 ? ` · ${unplayed} closed before playing` : '');
  return (
    <View
      accessible
      accessibilityLabel={`Fees, ${detail}, ${formatAt(fees, precision, true)}`}
      style={[styles.row, styles.fees]}
    >
      <View style={styles.copy}>
        <Text style={styles.name}>Fees</Text>
        <Text style={styles.detail}>{detail}</Text>
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
  row: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  fees: {
    borderTopWidth: 0,
  },
  facts: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  rowAction: {
    flexShrink: 0,
  },
  copy: {
    flex: 1,
    minWidth: 0,
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
