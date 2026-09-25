import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { exactSignedMoney } from '../../copy/terms';
import { colors, fonts, headingStyle, space, type, weight } from '../../theme';
import { headingLevel } from '../../ui/kit';
import { FineMoney } from './FineMoney';

/**
 * A list's header: its name and slot use, the section's total (the same
 * figure as its part of the score breakdown, and the sum of the rows below),
 * an optional line saying why its actions are unavailable, and the legend
 * that names the row columns once for the whole list.
 */
export function SectionHead({
  title,
  count,
  total,
  totalLabel,
  totalInset = 0,
  caption,
  note,
  legend,
}: {
  title: string;
  /** "10 of 10", "2 closed". */
  count?: string;
  /** The section's share of the score; omitted while the list is empty. */
  total?: number;
  /** Screen-reader words for the total, e.g. "Roster total". */
  totalLabel?: string;
  /** Right inset that lines the total up with the rows' Total column. */
  totalInset?: number;
  /** A plain sentence about the list, e.g. how shorts work. */
  caption?: string;
  /** A warning about the list's actions: "Locked until the Oct 31 games settle." */
  note?: string;
  legend?: ReactNode;
}) {
  return (
    <View style={styles.head}>
      <View style={styles.titleRow}>
        <View style={styles.titleGroup}>
          <Text accessibilityRole="header" {...headingLevel(2)} style={styles.title}>{title}</Text>
          {count ? <Text style={styles.count}>{count}</Text> : null}
        </View>
        {total === undefined ? null : (
          <View style={{ marginRight: totalInset }}>
            <FineMoney
              accessibilityLabel={totalLabel ? `${totalLabel} ${exactSignedMoney(total)}` : undefined}
              value={total}
            />
          </View>
        )}
      </View>
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
      {note ? <Text style={styles.note}>{note}</Text> : null}
      {legend ? <View style={styles.legend}>{legend}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    paddingHorizontal: space.lg,
    paddingTop: 5,
    paddingBottom: 4,
    backgroundColor: colors.surface,
  },
  titleRow: {
    minHeight: 26,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    columnGap: space.md,
  },
  titleGroup: {
    flexShrink: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: space.sm,
  },
  title: {
    ...headingStyle,
    letterSpacing: 0,
  },
  count: {
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.caption,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
  },
  caption: {
    marginTop: 2,
    color: colors.faint,
    fontFamily: fonts.body,
    fontSize: type.caption,
    lineHeight: 17,
  },
  note: {
    marginTop: 2,
    color: colors.goldInk,
    fontFamily: fonts.display,
    fontSize: type.caption,
    fontWeight: weight.bold,
    lineHeight: 17,
  },
  legend: {
    marginTop: 2,
  },
});
