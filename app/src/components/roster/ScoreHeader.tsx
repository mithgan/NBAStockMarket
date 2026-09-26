import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { exactSignedMoney, humanDate } from '../../copy/terms';
import { WEEK_LABEL, type BreakdownPart, type PartPrecision } from '../../data/rosterView';
import { colors, fonts, space, type, weight } from '../../theme';
import { headingLevel, Label, Money } from '../../ui/kit';
import { FineMoney } from './FineMoney';

/** One line of the stack beside the score: a label, then its value. */
function StackRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.stackRow}>
      <Label>{label}</Label>
      {children}
    </View>
  );
}

/**
 * "How am I doing?" in one block: your score as the hero number, the last
 * seven days and your rank beside it, then the score split by where it came
 * from (roster, shorts, closed positions, fees), each part the total of a list
 * further down. Last night lives in the status bar above every screen, so it
 * is not repeated here.
 *
 * The score shows its new value at once (no count-up), so a glance or a
 * screenshot never catches it disagreeing with the parts under it. Before
 * the first game only fees can have moved it: it then reads neutral, as
 * "fees so far", not as an alarming loss. The hero row carries one spoken
 * summary: score, week and rank in a sentence.
 *
 * Layouts: `compact` (phone) sets the parts two to a line so roster rows start
 * high; `narrow` (under 330 CSS px) lists one part a line; `panel` (the desktop
 * column) lists them as a statement and adds slot use.
 */
export function ScoreHeader({
  title,
  score,
  week,
  started,
  nextGameDate,
  rank,
  parts,
  precision,
  slots,
  variant,
}: {
  title: string;
  score: number;
  /** The last seven days, from `recentEarnings`: games only (fees have their own part). */
  week: number | null;
  /** True once a game night has touched your score. */
  started: boolean;
  nextGameDate: string | null;
  rank: string | null;
  parts: readonly BreakdownPart[] | null;
  /** The precision at which the parts visibly add up to the hero. */
  precision: PartPrecision;
  slots: string | null;
  variant: 'compact' | 'narrow' | 'panel';
}) {
  // Before the first game only fees can have moved the score.
  const feesOnly = !started && score !== 0;
  // Before any game settles there is no week to report and no standing to
  // claim; the next game date is the one useful fact.
  const facts = started ? (
    <View style={[styles.stack, variant === 'panel' && styles.stackFull]}>
      {week === null ? null : (
        <StackRow label={WEEK_LABEL}>
          {/* Fine, like Last night in the bars and the results night headers,
              so the notice after +1 week reads the same figure. */}
          <FineMoney value={week} />
        </StackRow>
      )}
      {rank ? (
        <StackRow label="Rank">
          <Text accessibilityLabel={`Rank ${rank.replace('#', 'number ')}`} style={styles.stackText}>{rank}</Text>
        </StackRow>
      ) : null}
    </View>
  ) : nextGameDate ? (
    <View style={[styles.stack, variant === 'panel' && styles.stackFull]}>
      <StackRow label="Next games">
        <Text style={styles.stackText}>{humanDate(nextGameDate)}</Text>
      </StackRow>
    </View>
  ) : null;

  const summary = [
    `${title} ${exactSignedMoney(score)}${feesOnly ? ', fees so far' : ''}`,
    started && week !== null ? `${WEEK_LABEL.toLowerCase()} ${exactSignedMoney(week)}` : null,
    started && rank ? `rank ${rank.replace('#', 'number ')}` : null,
    !started && nextGameDate ? `next games ${humanDate(nextGameDate)}` : null,
  ].filter(Boolean).join(', ');

  return (
    <View style={styles.header}>
      <Text accessibilityRole="header" {...headingLevel(2)}>
        <Label>{title}</Label>
      </Text>
      <View
        accessible
        accessibilityLabel={summary}
        style={[styles.heroRow, variant === 'panel' && styles.heroColumn]}
      >
        <View>
          <Money
            colored={started && score !== 0}
            size="hero"
            style={styles.hero}
            value={score}
          />
          {feesOnly ? <Text style={styles.feesOnly}>Fees so far</Text> : null}
        </View>
        {facts}
      </View>
      {parts ? (
        <View
          accessibilityLabel={`${title} by source: ${parts.map((part) => `${part.label} ${exactSignedMoney(part.value)}`).join(', ')}`}
          accessible
          style={[styles.parts, variant === 'compact' && styles.partsGrid]}
        >
          {parts.map((part) => (
            <View
              key={part.key}
              style={[styles.part, variant === 'compact' && styles.partHalf]}
            >
              <Text style={variant === 'panel' ? styles.statementLabel : styles.partLabel}>{part.label}</Text>
              <FineMoney precision={precision} size="body" value={part.value} />
            </View>
          ))}
        </View>
      ) : null}
      {slots ? <Text style={styles.slots}>{slots}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: space.lg,
    paddingTop: 10,
    paddingBottom: space.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
  },
  heroRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: space.lg,
  },
  heroColumn: {
    flexDirection: 'column',
    // A wrapping container stretches items only to its widest item, not to
    // its own width, so the facts could never reach the right edge.
    flexWrap: 'nowrap',
    alignItems: 'stretch',
    rowGap: space.xs,
  },
  hero: {
    lineHeight: 54,
  },
  stack: {
    gap: 2,
  },
  stackFull: {
    alignSelf: 'stretch',
  },
  stackRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    columnGap: space.lg,
  },
  stackText: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
    fontVariant: ['tabular-nums'],
  },
  parts: {
    marginTop: space.xs,
    paddingTop: 6,
    rowGap: 3,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  partsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: space.xl,
  },
  part: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    columnGap: space.sm,
  },
  /** Two parts a line; the gap between the pair is the grid's column gap. */
  partHalf: {
    flexBasis: 0,
    flexGrow: 1,
    minWidth: 130,
  },
  partLabel: {
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.bold,
  },
  statementLabel: {
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.caption,
    fontWeight: weight.bold,
  },
  feesOnly: {
    marginTop: -4,
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.caption,
    fontWeight: weight.bold,
  },
  slots: {
    marginTop: space.sm,
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.caption,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
  },
});
