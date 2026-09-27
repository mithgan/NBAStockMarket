import { useEffect, useState, type ReactNode, type Ref } from 'react';
import { Platform, StyleSheet, Text, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';

import { figuresKeptWithLabels, formatAt, type PartPrecision } from '../../data/rosterView';
import { colors, fonts, headingStyle, space, type, weight } from '../../theme';
import { headingLevel, visuallyHidden } from '../../ui/kit';
import { FineMoney } from './FineMoney';

/** The title row's height before it has been measured. */
const TITLE_ESTIMATE = 33;

/**
 * A list's header: its name and slot use, the section's total (the same
 * figure as its part of the score breakdown, and the sum of the rows below),
 * an optional line saying why its actions are unavailable, and the legend
 * that names the row columns once for the whole list.
 *
 * Rendered as siblings of the section's rows (not one block), so that when
 * pinned only two short lines stay on screen: the title row at the top and
 * the column legend right under it. The caption and note scroll away with
 * the list instead of covering its rows.
 */
export function SectionHead({
  title,
  count,
  total,
  totalLabel,
  totalInset = 0,
  precision = 'fine',
  sticky = false,
  caption,
  note,
  exact = null,
  legend,
  headingRef,
  onPinnedHeight,
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
  /** The breakdown's precision, so the total reads exactly as its part does. */
  precision?: PartPrecision;
  /**
   * Keep the title row and the column legend pinned under the top of the
   * list while this section's rows scroll, so mid-list rows never lose their
   * labels. Web only: CSS sticky, scoped to this section.
   */
  sticky?: boolean;
  /** A plain sentence about the list, e.g. how shorts work. */
  caption?: string;
  /** A warning about the list's actions: "Moves reopen after Oct 31." */
  note?: string;
  /**
   * How the rows add up to the total when, as shown, they do not
   * (`sectionExact`, walk 16 T1-05): "Exactly +$3,891,000: Luka Doncic
   * +$5,505,500, …". It scrolls away with the caption and note.
   */
  exact?: string | null;
  legend?: ReactNode;
  /** The title, so a screen can move keyboard focus to it. */
  headingRef?: Ref<Text>;
  /**
   * How tall the pinned pieces are (title row plus legend; 0 when nothing is
   * pinned), so the list can keep a focused row clear of them.
   */
  onPinnedHeight?: (height: number) => void;
}) {
  const [titleHeight, setTitleHeight] = useState(TITLE_ESTIMATE);
  const [legendHeight, setLegendHeight] = useState(0);
  const onTitleLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.height);
    setTitleHeight((current) => (current === next ? current : next));
  };
  const onLegendLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.height);
    setLegendHeight((current) => (current === next ? current : next));
  };
  const pinnedHeight = sticky ? titleHeight + (legend ? legendHeight : 0) : 0;
  useEffect(() => {
    onPinnedHeight?.(pinnedHeight);
  }, [onPinnedHeight, pinnedHeight]);
  // The title and the legend leave together when the section scrolls off
  // (walk 18 T4-02: the legend, lower, was pushed up first and slid under
  // the pinned title, sliced through its letters). A pinned piece stops
  // where its margin box meets its scope's end, so the title's bottom margin
  // of the legend's height lets go of it at the same moment as the legend;
  // the next piece takes the margin back, so nothing moves.
  const together = sticky && legend && Platform.OS === 'web' ? legendHeight : 0;
  const giveBack = together > 0 ? { marginTop: -together } : null;
  const hasBody = Boolean(caption || note || exact);
  return (
    <>
      <View
        onLayout={sticky ? onTitleLayout : undefined}
        style={[styles.head, sticky && pinned(0, 3), together > 0 && { marginBottom: together }]}
      >
        <View style={styles.titleRow}>
          <View style={styles.titleGroup}>
            <Text ref={headingRef} accessibilityRole="header" {...headingLevel(2)} style={styles.title}>{title}</Text>
            {count ? <Text style={styles.count}>{count}</Text> : null}
          </View>
          {total === undefined ? null : (
            <>
              {/* The total named for screen readers, "Roster total -$120.5K"
                  (walk 10 T3-03): a name on a role-less figure is not read
                  in reading mode, so the words are hidden text and the drawn
                  figure is hidden from them. */}
              {totalLabel ? <Text style={visuallyHidden}>{`${totalLabel} ${formatAt(total, precision, true)}`}</Text> : null}
              <View aria-hidden={totalLabel ? true : undefined} style={{ marginRight: totalInset }}>
                <FineMoney precision={precision} value={total} />
              </View>
            </>
          )}
        </View>
      </View>
      {hasBody ? (
        <View style={[styles.body, giveBack]}>
          {caption ? <Text style={styles.caption}>{caption}</Text> : null}
          {note ? <Text style={styles.note}>{note}</Text> : null}
          {exact ? <Text style={styles.exact}>{figuresKeptWithLabels(exact)}</Text> : null}
        </View>
      ) : null}
      {legend ? (
        <View
          onLayout={sticky ? onLegendLayout : undefined}
          style={[styles.legend, sticky && pinned(titleHeight, 2), sticky && styles.legendPinned, hasBody ? null : giveBack]}
        >
          {legend}
        </View>
      ) : null}
    </>
  );
}

/**
 * react-native-web passes `position: sticky` through to CSS. These pieces are
 * children of their section, so they stick only while its own rows scroll by
 * and leave with the section's last row.
 */
function pinned(top: number, zIndex: number): ViewStyle {
  return (Platform.OS === 'web' ? { position: 'sticky', top, zIndex } : {}) as unknown as ViewStyle;
}

const styles = StyleSheet.create({
  head: {
    paddingHorizontal: space.lg,
    paddingTop: 5,
    paddingBottom: 2,
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
  body: {
    paddingHorizontal: space.lg,
    paddingBottom: 2,
    backgroundColor: colors.surface,
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
  // The score block's exact line, as it draws it.
  exact: {
    marginTop: 2,
    color: colors.muted,
    fontFamily: fonts.body,
    fontSize: type.caption,
    lineHeight: 17,
    fontVariant: ['tabular-nums'],
  },
  legend: {
    paddingHorizontal: space.lg,
    paddingTop: 2,
    paddingBottom: 4,
    backgroundColor: colors.surface,
  },
  legendPinned: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
});
