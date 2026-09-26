/**
 * The profile's game log as a real table (walk-1 T3-10): a screen reader hears
 * "Oct 25, Dividend $516K, Your price $100K, Profit +$416K" row by row, with
 * the column names, instead of a flat run of numbers. Newest game first; your
 * nights with no money (did not play, waiting to settle) keep their row.
 */
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import type { PerGamePositionSide } from '../../api/contracts';
import { gamesCount, humanDate, moneyFine, signedMoneyFine } from '../../copy/terms';
import type { LogRow } from '../../data/profileView';
import { colors, fonts, labelStyle, space, type, weight } from '../../theme';
import { Button, moneyColor } from '../../ui/kit';

export function ProfileGameLog({
  rows,
  side,
  priceHeader,
  mixed,
  capped,
  showingAll,
  total,
  preview,
  onToggle,
  style,
}: {
  rows: LogRow[];
  side: PerGamePositionSide;
  /** "Your price", "Market price", "Price" (or the credit words for a short). */
  priceHeader: string;
  /** Rows mix your price and his market price, so market rows say so. */
  mixed: boolean;
  capped: boolean;
  showingAll: boolean;
  total: number;
  preview: number;
  onToggle: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.log, style]}>
      <View aria-label="Game log" role="table">
        <View role="row" style={styles.row}>
          <Text maxFontSizeMultiplier={1.4} role="columnheader" style={[labelStyle, styles.date]}>Game</Text>
          <Text maxFontSizeMultiplier={1.4} role="columnheader" style={[labelStyle, styles.number]}>Dividend</Text>
          <Text maxFontSizeMultiplier={1.4} role="columnheader" style={[labelStyle, styles.number]}>{priceHeader}</Text>
          <Text maxFontSizeMultiplier={1.4} role="columnheader" style={[labelStyle, styles.number]}>Profit</Text>
        </View>
        {rows.map((row) => {
          if (row.kind !== 'game') {
            // A night with no money: he did not play, or the game has not settled.
            const words = row.kind === 'dnp' ? 'Did not play · nothing charged' : 'Waiting to settle';
            return (
              <View key={`${row.kind}-${row.date}`} role="row" style={[styles.row, styles.rule]}>
                <View role="rowheader" style={styles.date}>
                  <Text maxFontSizeMultiplier={1.4} style={styles.cell}>{humanDate(row.date)}</Text>
                </View>
                <Text aria-colspan={3} maxFontSizeMultiplier={1.4} role="cell" style={[styles.cell, styles.quiet, styles.status]}>
                  {words}
                </Text>
              </View>
            );
          }
          const night = row.night;
          const market = night.source === 'market';
          return (
            <View key={night.date} role="row" style={[styles.row, styles.rule]}>
              <View role="rowheader" style={styles.date}>
                <Text maxFontSizeMultiplier={1.4} style={styles.cell}>{humanDate(night.date)}</Text>
                {mixed && market ? (
                  <Text maxFontSizeMultiplier={1.4} style={styles.source}>{side === 'long' ? 'market price' : 'market credit'}</Text>
                ) : null}
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

const styles = StyleSheet.create({
  log: {
    paddingHorizontal: space.lg,
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
