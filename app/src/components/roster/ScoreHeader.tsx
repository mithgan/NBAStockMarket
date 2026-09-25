import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { exactSignedMoney, humanDate } from '../../copy/terms';
import { useCountUp } from '../../hooks/useCountUp';
import { colors, fonts, space, type, weight } from '../../theme';
import { Label, Money } from '../../ui/kit';

export interface ScoreBreakdown {
  dividends: number;
  gameCosts: number;
  fees: number;
}

/** One line of the stack beside the score: a label and a right-aligned value. */
function StackRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.stackRow}>
      <Label>{label}</Label>
      {children}
    </View>
  );
}

const PARTS: Array<[keyof ScoreBreakdown, string]> = [
  ['dividends', 'Dividends earned'],
  ['gameCosts', 'Prices paid'],
  ['fees', 'Fees'],
];

/**
 * "How am I doing?" in one block: your score as the hero number, what last
 * night and the last seven nights did to it, your rank, and how the score adds
 * up (dividends earned, prices paid, fees). The score counts to its new value
 * when a night settles on screen; `useCountUp` holds it still for reduced
 * motion.
 *
 * `compact` (phone) keeps the breakdown to one line so roster rows start high
 * on the screen; `panel` (desktop column) lays it out as a small statement and
 * repeats slot use.
 */
export function ScoreHeader({
  title,
  score,
  recent,
  started,
  nextGameDate,
  rank,
  breakdown,
  slots,
  variant,
}: {
  title: string;
  score: number;
  /** Last night and the last seven nights, from `recentEarnings`. */
  recent: { night: number; week: number } | null;
  /** True once a game night has touched your score. */
  started: boolean;
  nextGameDate: string | null;
  rank: string | null;
  breakdown: ScoreBreakdown | null;
  slots: string | null;
  variant: 'compact' | 'panel';
}) {
  const shown = useCountUp(score);
  return (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <Label>{title}</Label>
        {rank ? (
          <View accessible accessibilityLabel={`Rank ${rank.replace('#', 'number ')}`} style={styles.rank}>
            <Label>Rank</Label>
            <Text style={styles.rankValue}>{rank}</Text>
          </View>
        ) : null}
      </View>
      <View style={[styles.heroRow, variant === 'panel' && styles.heroColumn]}>
        <Money
          accessibilityLabel={`${title} ${exactSignedMoney(score)}`}
          colored={score !== 0}
          signed={score !== 0}
          size="hero"
          style={styles.hero}
          value={shown}
        />
        {started && recent ? (
          <View style={[styles.stack, variant === 'panel' && styles.stackFull]}>
            <StackRow label="Last night">
              <Money value={recent.night} />
            </StackRow>
            <StackRow label="7 nights">
              <Money value={recent.week} />
            </StackRow>
          </View>
        ) : nextGameDate ? (
          <View style={[styles.stack, variant === 'panel' && styles.stackFull]}>
            <StackRow label="Next games">
              <Text style={styles.stackText}>{humanDate(nextGameDate)}</Text>
            </StackRow>
          </View>
        ) : null}
      </View>
      {breakdown && variant === 'compact' ? (
        <View style={styles.inline}>
          {PARTS.map(([key, label]) => (
            <View key={key} style={styles.inlinePart}>
              <Text style={styles.partLabel}>{label}</Text>
              <Money size="body" value={breakdown[key]} />
            </View>
          ))}
        </View>
      ) : null}
      {breakdown && variant === 'panel' ? (
        <View style={styles.statement}>
          {PARTS.map(([key, label]) => (
            <View key={key} style={styles.statementRow}>
              <Text style={styles.statementLabel}>{label}</Text>
              <Money size="body" value={breakdown[key]} />
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
    paddingTop: space.md,
    paddingBottom: space.md,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
  },
  titleRow: {
    minHeight: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  rank: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.sm,
  },
  rankValue: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
    fontVariant: ['tabular-nums'],
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
    // its own width, so the stack could never reach the right edge.
    flexWrap: 'nowrap',
    alignItems: 'stretch',
    rowGap: space.xs,
  },
  hero: {
    lineHeight: 54,
  },
  stack: {
    minWidth: 140,
    flexGrow: 1,
    maxWidth: 200,
    gap: 2,
  },
  stackFull: {
    maxWidth: '100%',
  },
  stackRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.md,
  },
  stackText: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
    fontVariant: ['tabular-nums'],
  },
  inline: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: space.md,
    rowGap: 2,
    marginTop: space.xs,
    paddingTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  inlinePart: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  partLabel: {
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.bold,
  },
  statement: {
    marginTop: space.sm,
    paddingTop: space.sm,
    gap: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  statementRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.md,
  },
  statementLabel: {
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
