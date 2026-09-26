import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { humanDate, signedMoney } from '../../copy/terms';
import { formatAt, heroFontSize, WEEK_LABEL, type BreakdownPart, type PartPrecision } from '../../data/rosterView';
import { colors, fonts, space, type, weight } from '../../theme';
import { headingLevel, Label, Money, visuallyHidden } from '../../ui/kit';
import { FineMoney } from './FineMoney';

/** One line of the stack beside the score: a label, then its value. */
function StackRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.stackRow}>
      <Label>{label}</Label>
      <View style={styles.stackValue}>{children}</View>
    </View>
  );
}

/**
 * Phones stack the week and rank under the score at every score length; from
 * this width they sit beside it. Chosen by width alone, so the block keeps one
 * arrangement from night to night whatever the score's digits (walk 5 T1-12).
 */
export const SCORE_BESIDE_MIN_WIDTH = 600;
/** The measured fit never takes the hero below this (a 200% zoom phone with text spacing). */
const HERO_FIT_MIN = 18;

/**
 * Web: keep the hero on one line at the largest size that fits its line,
 * measured, not estimated, so a user's text spacing (letter-spacing 0.12em,
 * WCAG 1.4.12) or a late font never breaks it inside the figure ("-$184.8" /
 * "K", walk 5 T3-07). A ResizeObserver re-fits it when its width changes.
 * Shrinks as soon as it overflows; grows back only with a clear margin, so it
 * never flickers between two sizes.
 */
function useHeroFit(start: number, text: string) {
  const box = useRef<View>(null);
  const [fit, setFit] = useState<number | null>(null);
  // Before paint, so the first frame already shows the fitted size.
  useLayoutEffect(() => {
    if (Platform.OS !== 'web' || typeof ResizeObserver === 'undefined') return undefined;
    const holder = box.current as unknown as HTMLElement | null;
    const node = holder?.firstElementChild as HTMLElement | null | undefined;
    if (!holder || !node) return undefined;
    const measure = () => {
      const room = holder.clientWidth;
      const need = node.scrollWidth;
      const current = parseFloat(getComputedStyle(node).fontSize);
      if (!(room > 0) || !(need > 0) || !(current > 0)) return;
      let next = current;
      if (need > room) next = Math.floor((current * room * 0.98) / need);
      else if (need < room * 0.9 && current < type.hero) next = Math.floor((current * room * 0.98) / need);
      next = Math.max(HERO_FIT_MIN, Math.min(type.hero, next));
      if (Math.abs(next - current) >= 1) setFit(next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(holder);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, [start, text]);
  return { box, size: fit ?? start };
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
 * Layouts: `compact` (phone, tablet) sets the parts two to a line so roster
 * rows start high, with the week and rank under the score on phones and
 * beside it from 600px; `narrow` (under 330 CSS px) lists one part a line,
 * with the week and rank under the score; `panel` (the desktop column) lists
 * them as a statement and adds slot use. Under the score, the week and rank
 * values share the block's right edge.
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
  valueLine = null,
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
  /**
   * Value against results from `pickValue`, in words: what the games your
   * picks played would have made on last season's numbers, beside what they
   * made (the score before fees). Null hides it.
   */
  valueLine?: string | null;
}) {
  const { width } = useWindowDimensions();
  // Before the first game only fees can have moved the score.
  const feesOnly = !started && score !== 0;
  // The hero fits its line: at 200% zoom a phone is about 195px wide, and an
  // eight-character score at full size ran off the edge (walk 3 T3-28).
  const estimate = variant === 'panel' ? type.hero : heroFontSize(signedMoney(score), width - 2 * space.lg, type.hero);
  const beside = variant === 'compact' && width >= SCORE_BESIDE_MIN_WIDTH;
  const { box: heroBox, size: heroSize } = useHeroFit(estimate, signedMoney(score));
  // Before any game settles there is no week to report and no standing to
  // claim; the next game date is the one useful fact.
  const facts = started ? (
    <View style={[styles.stack, beside ? styles.stackBeside : styles.stackFull]}>
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
    <View style={[styles.stack, beside ? styles.stackBeside : styles.stackFull]}>
      <StackRow label="Next games">
        <Text style={styles.stackText}>{humanDate(nextGameDate)}</Text>
      </StackRow>
    </View>
  ) : null;

  const summary = [
    `${title} ${signedMoney(score)}${feesOnly ? ', fees so far' : ''}`,
    started && week !== null ? `${WEEK_LABEL.toLowerCase()} ${signedMoney(week)}` : null,
    started && rank ? `rank ${rank.replace('#', 'number ')}` : null,
    !started && nextGameDate ? `next games ${humanDate(nextGameDate)}` : null,
  ].filter(Boolean).join(', ');

  return (
    <View style={styles.header}>
      <Text accessibilityRole="header" {...headingLevel(2)}>
        <Label>{title}</Label>
      </Text>
      {/* One sentence for screen readers (walk 4 T3-12); the drawn figures
          below say the same and are hidden from them. */}
      <Text style={visuallyHidden}>{summary}</Text>
      <View aria-hidden style={[styles.heroRow, !beside && styles.heroColumn]}>
        <View ref={heroBox} style={beside ? styles.heroBeside : null}>
          <Money
            colored={started && score !== 0}
            size="hero"
            style={[styles.hero, heroSize < type.hero && { fontSize: heroSize, lineHeight: Math.round(heroSize * 1.17) }]}
            value={score}
          />
          {feesOnly ? <Text style={styles.feesOnly}>Fees so far</Text> : null}
        </View>
        {facts}
      </View>
      {/* Why a cold start is not a broken signal, in words (signs, not colour). */}
      {started && valueLine ? <Text style={styles.valueLine}>{valueLine}</Text> : null}
      {parts ? <ScoreParts parts={parts} precision={precision} title={title} variant={variant} /> : null}
      {slots ? <Text style={styles.slots}>{slots}</Text> : null}
    </View>
  );
}

/**
 * The score split by where it came from (Roster, Shorts, Closed, Fees), each
 * part the total of a list further down, at the precision at which the parts
 * visibly add up to the score above them. The score block shows it while the
 * season runs; at the season's end the result card carries it (walk 4 T2-07).
 */
export function ScoreParts({ title, parts, precision, variant }: {
  /** Names the split for screen readers: "Your score by source: …". */
  title: string;
  parts: readonly BreakdownPart[];
  precision: PartPrecision;
  variant: 'compact' | 'narrow' | 'panel';
}) {
  return (
    <View
      accessibilityLabel={`${title} by source: ${parts.map((part) => `${part.label} ${formatAt(part.value, precision, true)}`).join(', ')}`}
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
  // Side by side (600px and wider): one line, never wrapping; the score
  // takes the room the week and rank leave and fits it.
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: space.lg,
  },
  heroBeside: {
    flex: 1,
    minWidth: 0,
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
    // Its own width, not the line's, so the fit can measure the figure.
    alignSelf: 'flex-start',
    // One line always: a figure never breaks inside ("-$184.8" / "K").
    ...({ whiteSpace: 'nowrap' } as object),
  },
  stack: {
    gap: 2,
  },
  // Under the score: the block's full width, so both values share its right edge.
  stackFull: {
    alignSelf: 'stretch',
  },
  stackBeside: {
    flexShrink: 0,
  },
  stackRow: {
    flexDirection: 'row',
    // Too narrow for both (200% zoom): the value takes the next line rather
    // than running off the edge.
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    columnGap: space.lg,
  },
  // On its own line (wrapped) the value still sits at the right edge.
  stackValue: {
    marginLeft: 'auto',
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
    // At most two a line: four in a row paired each value with the next
    // label on a tablet (walk 3 T2-11).
    flexBasis: '40%',
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
  valueLine: {
    marginTop: space.xs,
    color: colors.muted,
    fontFamily: fonts.body,
    fontSize: type.caption,
    lineHeight: 17,
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
