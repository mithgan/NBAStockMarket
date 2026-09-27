import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';

import { gamesCount, unbrokenName } from '../../copy/terms';
import { keepTogether } from '../../data/chromeView';
import {
  closedGroupSpoken,
  feesDetail,
  formatAt,
  mergeClosedRows,
  spokenRepeats,
  stintParts,
  stintSpoken,
  type ClosedRow,
  type PartPrecision,
} from '../../data/rosterView';
import { colors, fonts, space, type, weight } from '../../theme';
import { Button, repeatSafe, visuallyHidden } from '../../ui/kit';
import { FineMoney } from './FineMoney';
import { TABLE_COLUMNS } from './RowFigures';
import { SectionHead } from './SectionHead';
import { useHoldInView } from './useHoldInView';

/** Closed positions listed before "Show all" takes over. */
const COLLAPSED_COUNT = 5;
/** The room a " · " takes between two parts of a line. */
const DOT_WIDTH = 12;

/** "Short ended Oct 28": a narrow row may wrap the words, never the date. */
function bindDates(text: string): string {
  return text.replace(/\b([A-Z][a-z]{2}) (\d{1,2})\b/g, (_, month: string, day: string) => keepTogether(`${month} ${day}`));
}

/**
 * Parts of a line joined by " · " ("Dropped Oct 21 · 1 game"). A part that
 * wraps starts its own line without the dot, and no line ends on one (walk 9
 * T1-04, T4-05; walk 7 T1-12): each part carries its dot in front, and the
 * dot of a part that opens a line sits in a clipped gutter off the left edge.
 */
export function DotLine({ parts, style }: { parts: readonly string[]; style?: StyleProp<TextStyle> }) {
  return (
    <View style={styles.dotClip}>
      <View style={styles.dotLine}>
        {parts.map((part, index) => (
          <View key={`${index}:${part}`} style={styles.dotPart}>
            <Text aria-hidden style={[style, styles.dot]}>{'\u00b7'}</Text>
            <Text style={[style, styles.dotText]}>{part}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * Dropped players and ended shorts. What they made or lost while you held
 * them stays in your score, so they stay on the screen: the section's total
 * is the "Closed" part of the score breakdown and the sum of these rows.
 *
 * Every row sits on the lists' grid (walk 9 T1-04): name and "Dropped Oct 21
 * · 1 game" at the left, the figure at the right under the lists' Total. Its
 * "Add again" never squeezes them: on a phone it takes its own line under the
 * words, and in the wide table it reads on one line just before the figure
 * (walk 9 T2-07), in the room the price columns leave free on a closed row.
 */
export function ClosedSection({ rows: allRows, total, totalInset = 0, table: tableLayout, precision = 'fine', actionFor, noteFor, backFor }: {
  /** Every closed stint, most recent first; the section shows one row per player and side. */
  rows: readonly ClosedRow[];
  total: number;
  totalInset?: number;
  /**
   * The wide table's grid; defaults to `totalInset > 0`. At season end the
   * table has no action column (inset 0) and is still a table (walk 13 T4-03).
   */
  table?: boolean;
  precision?: PartPrecision;
  /** A follow-up move for a row, such as "Short again" on a closed short. */
  actionFor?: (row: ClosedRow) => ReactNode;
  /** A note under a row, full width (a full side's "Choose who to drop"; walk 8 T4-12). */
  noteFor?: (row: ClosedRow) => ReactNode;
  /** Where he is now when he is on a list again: "Back on your roster since Oct 22" (walk 9 T4-N2). */
  backFor?: (row: ClosedRow) => string | null;
}) {
  const [showAll, setShowAll] = useState(false);
  // The rows opened to list their stints, by player and side.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  // A row that opens and closes: a double tap never undoes itself.
  const toggle = useMemo(() => repeatSafe((key: string) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  })), []);
  // A row just opened stays where it is on screen while a night or a move
  // that waited for it changes the lists above (fix 12 check), until the
  // next tap or focus elsewhere; folding it lets go.
  const { hold, release, rowRef, heldKey } = useHoldInView();
  const openBefore = useRef(open);
  useLayoutEffect(() => {
    const before = openBefore.current;
    openBefore.current = open;
    const opened = [...open].find((key) => !before.has(key));
    if (opened !== undefined) {
      hold(opened);
      return;
    }
    const key = heldKey();
    if (key !== null && !open.has(key)) release();
  }, [heldKey, hold, open, release]);
  // The roster table (a wide list) keeps a Total column and an action column
  // at the right; `totalInset` is the action column plus its gap.
  const table = tableLayout ?? totalInset > 0;
  // One row per player and side, his stints folded in (walk 11 T1-11). A
  // player dropped before his first game every time moved nothing but fees;
  // the Fees line counts him instead of a row of zeros.
  const rows = mergeClosedRows(allRows).filter((row) => !row.unplayed);
  if (rows.length === 0) return null;
  const shown = showAll ? rows : rows.slice(0, COLLAPSED_COUNT);
  const figureStyle = table ? { marginRight: totalInset, minWidth: TABLE_COLUMNS.total, alignItems: 'flex-end' as const } : null;
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
        const key = `${row.side}:${row.playerId}`;
        const action = actionFor ? actionFor(row) : null;
        const note = noteFor ? noteFor(row) : null;
        const back = backFor ? backFor(row) : null;
        // Several stints: the row is a button that opens the list of them.
        const grouped = row.stints.length > 1;
        const isOpen = grouped && open.has(key);
        const spoken = closedGroupSpoken(row, formatAt(row.total, precision, true), back);
        const figure = (hidden: boolean) => (
          <View aria-hidden={hidden || undefined} style={[styles.money, figureStyle]}>
            <FineMoney precision={precision} value={row.total} />
          </View>
        );
        const detail = grouped
          ? [`${row.how}\u00a0${isOpen ? '\u25b2' : '\u25bc'}`, keepTogether(gamesCount(row.games))]
          : [...row.how.split(' \u00b7 ').map(bindDates), keepTogether(gamesCount(row.games))];
        const facts = (
          <>
            <View style={styles.copy}>
              <Text style={styles.name}>{unbrokenName(row.name)}</Text>
              <DotLine parts={detail} style={styles.detail} />
              {back ? <Text style={styles.back}>{back}</Text> : null}
            </View>
            {table ? null : figure(false)}
          </>
        );
        return (
          <View key={key} ref={rowRef(key)} style={styles.item}>
            <View style={styles.row}>
              {grouped ? (
                // Heard as one sentence with his total, "Scottie Barnes, 3
                // stints, 2 games in all: -$368.4K", and whether it is open.
                <Pressable
                  accessibilityLabel={spoken}
                  accessibilityRole="button"
                  aria-expanded={isOpen}
                  onPress={() => toggle(key)}
                  style={({ pressed }) => [styles.facts, styles.factsButton, table && styles.factsTable, pressed && styles.pressed]}
                >
                  {facts}
                </Pressable>
              ) : (
                <>
                  {/* Heard as one sentence with its figure, "Scottie Barnes,
                      dropped Oct 28 after 4 games: -$612K" (walk 10 T3-04):
                      a name on a role-less box is not read in reading mode,
                      so the sentence is hidden text and the drawn row is
                      hidden from screen readers. A follow-up button stays
                      its own stop. */}
                  <Text style={visuallyHidden}>{spoken}</Text>
                  <View aria-hidden style={[styles.facts, table && styles.factsTable]}>{facts}</View>
                </>
              )}
              {table && action ? <View style={styles.inlineAction}>{action}</View> : null}
              {table ? figure(true) : null}
            </View>
            {isOpen ? (
              // Each stint: when, how many games, and what it made; they add
              // up to the row's figure (walk 11 T1-11).
              <View role="list" style={styles.stints}>
                {row.stints.map((stint) => (
                  <View key={stint.positionId} role="listitem" style={styles.stint}>
                    <Text style={visuallyHidden}>{stintSpoken(stint, formatAt(stint.total, precision, true))}</Text>
                    <View aria-hidden style={styles.stintDrawn}>
                      <View style={styles.copy}>
                        <DotLine parts={stintParts(stint).map(bindDates)} style={styles.detail} />
                      </View>
                      <View style={[styles.money, figureStyle]}>
                        <FineMoney precision={precision} size="body" value={stint.total} />
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
            {!table && action ? <View style={styles.actionLine}>{action}</View> : null}
            {note}
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
export function FeesLine({ fees, moves, feeEach = 0, unplayed = [], unplayedShorts = [], totalInset = 0, table = totalInset > 0, precision = 'fine' }: {
  fees: number;
  moves: number;
  /** Shorts closed before he played, by name. */
  unplayedShorts?: readonly string[];
  /** The fee for one move, said once: "$250 each". */
  feeEach?: number;
  /** Players dropped before they played a game for you, by name (walk 7 T2-18). */
  unplayed?: readonly string[];
  totalInset?: number;
  /** The wide table's alignment; defaults to `totalInset > 0` (see ClosedSection). */
  table?: boolean;
  precision?: PartPrecision;
}) {
  if (moves === 0) return null;
  // Moves, not "roster moves": shorts opened and closed cost the same fee.
  const detail = feesDetail({ moves, feeEach, dropped: unplayed, closedShorts: unplayedShorts });
  return (
    <View style={[styles.row, table ? null : styles.rowBaseline]}>
      {/* One sentence in text a reader gets; the drawn line is hidden from it
          (a name on the role-less row was not read everywhere; walk 15 T3-09). */}
      <Text style={visuallyHidden}>{`Fees, ${spokenRepeats(detail).replace(/ \u00b7 /g, ', ')}, ${formatAt(fees, precision, true)}`}</Text>
      <View aria-hidden style={styles.copy}>
        <Text style={styles.name}>Fees</Text>
        <DotLine parts={detail.split(' \u00b7 ')} style={styles.detail} />
      </View>
      <View aria-hidden style={{ marginRight: totalInset }}>
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
  item: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  // The words at the left, the figure at the right on the name's line (in
  // the table: words, Add again, then the figure under Total). Too narrow
  // for both (200% zoom), the figure goes under the words instead of
  // squeezing them to a letter a line.
  row: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  // A phone's Fees figure sits on the "Fees" line, as a Closed row's does.
  rowBaseline: {
    alignItems: 'baseline',
  },
  facts: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 160,
    minWidth: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: space.md,
  },
  factsTable: {
    flexBasis: 0,
  },
  // A row that opens: a full-size target, its lines centred in it.
  factsButton: {
    minHeight: 44,
    alignContent: 'center',
  },
  // Its own line under the words (a phone): the button never shares the
  // figure's line, so neither squeezes the other.
  actionLine: {
    alignItems: 'flex-start',
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
    marginTop: -2,
  },
  inlineAction: {
    flexShrink: 0,
  },
  pressed: {
    opacity: 0.72,
  },
  // An opened row's stints, indented under his name, figures under his.
  stints: {
    paddingLeft: space.lg + space.md,
    paddingRight: space.lg,
    paddingBottom: space.sm,
    marginTop: -2,
  },
  stint: {
    minHeight: 28,
    justifyContent: 'center',
  },
  stintDrawn: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: space.md,
  },
  copy: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 110,
    minWidth: 0,
  },
  money: {
    marginLeft: 'auto',
    flexShrink: 0,
  },
  name: {
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.heavy,
  },
  detail: {
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.caption,
    fontWeight: weight.bold,
  },
  back: {
    marginTop: 1,
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.caption,
    fontWeight: weight.bold,
  },
  dotClip: {
    marginTop: 1,
    overflow: 'hidden',
  },
  dotLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginLeft: -DOT_WIDTH,
  },
  dotPart: {
    flexShrink: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  dot: {
    width: DOT_WIDTH,
    textAlign: 'center',
  },
  dotText: {
    flexShrink: 1,
    minWidth: 0,
  },
  more: {
    alignItems: 'flex-start',
    paddingHorizontal: space.sm,
  },
});
