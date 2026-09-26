/**
 * The profile's game log as a real table (walk-1 T3-10): a screen reader hears
 * "Oct 25, Dividend $516K, Your price $100K, Profit +$416K" row by row, with
 * the column names, instead of a flat run of numbers. Newest game first; your
 * nights with no money (did not play, waiting to settle) keep their row.
 *
 * Too narrow for four columns (a phone at 200% or 400% zoom), each game is a
 * stacked row (walk 5 T3-04): the date and his profit on the first line, the
 * dividend and price under them, each figure whole ("$327.6K" never breaks
 * into "$327." and "6K"). It stays the same table for a screen reader: the
 * column names move to a header row read but not drawn, in the order the
 * figures are drawn, and the words drawn beside each figure are not read twice.
 */
import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { gamesCount, humanDate, moneyFine, signedMoneyFine } from '../../copy/terms';
import type { LogRow } from '../../data/profileView';
import { colors, fonts, labelStyle, space, type, weight } from '../../theme';
import { Button, moneyColor, visuallyHidden } from '../../ui/kit';

export function ProfileGameLog({
  rows,
  priceHeader,
  mixed,
  stacked = false,
  capped,
  showingAll,
  total,
  preview,
  onToggle,
  style,
}: {
  rows: LogRow[];
  /** "Your price", "Market price" or "Price". */
  priceHeader: string;
  /** Rows mix your price and his market price, so market rows say so. */
  mixed: boolean;
  /** One game a stacked row, for widths where four columns would break figures. */
  stacked?: boolean;
  capped: boolean;
  showingAll: boolean;
  total: number;
  preview: number;
  onToggle: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  // Both sides read "market price": a short is credited his price (walk 5 T1-11).
  const marketTag = mixed ? <Text maxFontSizeMultiplier={1.4} style={styles.source}>market price</Text> : null;
  return (
    <View style={[styles.log, style]}>
      <View aria-label="Game log" role="table">
        {stacked ? (
          <View role="row" style={visuallyHidden}>
            <Text role="columnheader">Game</Text>
            <Text role="columnheader">Profit</Text>
            <Text role="columnheader">Dividend</Text>
            <Text role="columnheader">{priceHeader}</Text>
          </View>
        ) : (
          <View role="row" style={styles.row}>
            <Text maxFontSizeMultiplier={1.4} role="columnheader" style={[labelStyle, styles.date]}>Game</Text>
            <Text maxFontSizeMultiplier={1.4} role="columnheader" style={[labelStyle, styles.number]}>Dividend</Text>
            <Text maxFontSizeMultiplier={1.4} role="columnheader" style={[labelStyle, styles.number]}>{priceHeader}</Text>
            <Text maxFontSizeMultiplier={1.4} role="columnheader" style={[labelStyle, styles.number]}>Profit</Text>
          </View>
        )}
        {rows.map((row) => {
          if (row.kind !== 'game') {
            // A night with no money: he did not play, or the game has not settled.
            const words = row.kind === 'dnp' ? 'Did not play · nothing charged' : 'Waiting to settle';
            return (
              <View key={`${row.kind}-${row.date}`} role="row" style={[stacked ? styles.stackRow : styles.row, styles.rule]}>
                <View role="rowheader" style={stacked ? styles.stackDate : styles.date}>
                  <Text maxFontSizeMultiplier={1.4} style={styles.cell}>{humanDate(row.date)}</Text>
                </View>
                <Text
                  aria-colspan={3}
                  maxFontSizeMultiplier={1.4}
                  role="cell"
                  style={[styles.cell, styles.quiet, stacked ? styles.stackStatus : styles.status]}
                >
                  {words}
                </Text>
              </View>
            );
          }
          const night = row.night;
          const tag = night.source === 'market' ? marketTag : null;
          if (stacked) {
            return (
              <View key={night.date} role="row" style={[styles.stackRow, styles.rule]}>
                <View style={styles.stackLine}>
                  <View role="rowheader" style={styles.stackDate}>
                    <Text maxFontSizeMultiplier={1.4} style={styles.cell}>{humanDate(night.date)}</Text>
                    {tag}
                  </View>
                  <Figure label="Profit" style={styles.stackProfit}>
                    <Text maxFontSizeMultiplier={1.4} style={[styles.cell, styles.whole, { color: moneyColor(night.net) }]}>
                      {signedMoneyFine(night.net)}
                    </Text>
                  </Figure>
                </View>
                <View style={styles.stackLine}>
                  <Figure label="Dividend">
                    <Text maxFontSizeMultiplier={1.4} style={[styles.cell, styles.whole]}>{moneyFine(night.dividend)}</Text>
                  </Figure>
                  <Figure label={priceHeader}>
                    <Text maxFontSizeMultiplier={1.4} style={[styles.cell, styles.whole, styles.quiet]}>{moneyFine(night.price)}</Text>
                  </Figure>
                </View>
              </View>
            );
          }
          return (
            <View key={night.date} role="row" style={[styles.row, styles.rule]}>
              <View role="rowheader" style={styles.date}>
                <Text maxFontSizeMultiplier={1.4} style={styles.cell}>{humanDate(night.date)}</Text>
                {tag}
              </View>
              <Text maxFontSizeMultiplier={1.4} role="cell" style={[styles.cell, styles.number]}>{moneyFine(night.dividend)}</Text>
              <Text maxFontSizeMultiplier={1.4} role="cell" style={[styles.cell, styles.number, styles.quiet]}>{moneyFine(night.price)}</Text>
              <Text maxFontSizeMultiplier={1.4} role="cell" style={[styles.cell, styles.number, { color: moneyColor(night.net) }]}>
                {signedMoneyFine(night.net)}
              </Text>
            </View>
          );
        })}
      </View>
      {capped ? (
        <Button
          label={showingAll ? `Show latest ${preview}` : `Show all ${gamesCount(total)}`}
          onPress={onToggle}
          style={styles.more}
          variant="quiet"
        />
      ) : null}
    </View>
  );
}

/**
 * A stacked row's figure: its column name drawn beside it (the header row
 * already says it to a screen reader) and the figure whole. The name and the
 * figure wrap apart, never inside the figure.
 */
function Figure({ label, style, children }: { label: string; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  return (
    <View role="cell" style={[styles.figure, style]}>
      <Text aria-hidden maxFontSizeMultiplier={1.4} style={[labelStyle, styles.figureLabel]}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  log: {
    paddingHorizontal: space.lg,
  },
  stackRow: {
    paddingVertical: space.sm,
    gap: 2,
  },
  stackLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: space.md,
    rowGap: 2,
  },
  stackDate: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  // His profit sits at the right of the date line, or at the right of a line
  // of its own when the two do not fit side by side.
  stackProfit: {
    marginLeft: 'auto',
  },
  stackStatus: {
    flexGrow: 1,
    fontWeight: weight.medium,
  },
  figure: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: space.xs,
    maxWidth: '100%',
  },
  figureLabel: {
    flexShrink: 1,
  },
  /** A figure keeps its own width: it moves to the next line whole, never split. */
  whole: {
    flexShrink: 0,
  },
  row: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  rule: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  cell: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.body,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
  },
  source: {
    color: colors.faint,
    fontSize: type.label,
  },
  date: {
    flex: 1.1,
    minWidth: 0,
    paddingVertical: space.xs,
  },
  number: {
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
  },
  quiet: {
    color: colors.muted,
  },
  status: {
    flex: 3,
    textAlign: 'right',
    fontWeight: weight.medium,
  },
  more: {
    alignSelf: 'flex-start',
    marginTop: space.xs,
    paddingHorizontal: 0,
  },
});
