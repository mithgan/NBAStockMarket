import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { humanDate } from '../../copy/terms';
import { formatAt, heroFontSize, spokenRanks, WEEK_LABEL, type BreakdownPart, type PartPrecision } from '../../data/rosterView';
import { colors, control, fonts, radius, space, type, weight } from '../../theme';
import { headingLevel, Label, repeatSafe, visuallyHidden } from '../../ui/kit';
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
 * Stacked (phones): from this block width "Why?" sits beside the score, in
 * the room the score leaves; narrower (200% zoom) it takes a line under it,
 * so the score keeps its size.
 */
const WHY_BESIDE_MIN_ROOM = 280;

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
 * "How am I doing?" in one block: your score as the hero number, the games
 * your last press played and your rank beside it, then the score split by
 * where it came from (roster, shorts, closed positions, fees), each part the
 * total of a list further down. The games line names the same days, at the
 * same figure, as the status row and the notice after the press (walk 8
 * T2-01): a rolling seven days there read as a second, contradicting answer.
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
  weekWords = null,
}: {
  title: string;
  score: number;
  /**
   * What the games your last press played made (rosterView.pressLine): games
   * only (fees have their own part), as the status row and the notice say it.
   */
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
  /**
   * That figure's label in the days it covers, from `pressLine` ("Oct 30
   * games", "Oct 28–Nov 10 games"; walk 8 T2-01); WEEK_LABEL without it.
   */
  weekWords?: { label: string; spoken: string } | null;
}) {
  const { width } = useWindowDimensions();
  const weekName = weekWords ?? { label: WEEK_LABEL, spoken: WEEK_LABEL.toLowerCase() };
  // Phones fold the last-season paragraph behind "Why?", so your players
  // start higher after a night (walk 7 T1-10); desktop and tablets have room.
  const [whyOpen, setWhyOpen] = useState(false);
  // Before the first game only fees can have moved the score.
  const feesOnly = !started && score !== 0;
  // The hero fits its line: at 200% zoom a phone is about 195px wide, and an
  // eight-character score at full size ran off the edge (walk 3 T3-28).
  // The Roster's one millions precision: "+$1.60M" beside "+$1.61M" (walk 7 T4-14).
  const scoreText = formatAt(score, 'fine', true);
  const estimate = variant === 'panel' ? type.hero : heroFontSize(scoreText, width - 2 * space.lg, type.hero);
  const beside = variant === 'compact' && width >= SCORE_BESIDE_MIN_WIDTH;
  const fold = started && Boolean(valueLine) && variant !== 'panel' && !beside;
  const whyBeside = width - 2 * space.lg >= WHY_BESIDE_MIN_ROOM;
  const { box: heroBox, size: heroSize } = useHeroFit(estimate, scoreText);
  // Before any game settles there is no week to report and no standing to
  // claim; the next game date is the one useful fact.
  const facts = started ? (
    <View style={[styles.stack, beside ? styles.stackBeside : styles.stackFull]}>
      {week === null ? null : (
        <StackRow label={weekName.label}>
          {/* Fine, like Last night in the bars and the results night headers,
              so the notice after +1 week reads the same figure. */}
          <FineMoney value={week} />
        </StackRow>
      )}
      {rank ? (
        <StackRow label="Rank">
          <Text accessibilityLabel={`Rank ${spokenRanks(rank)}`} style={styles.stackText}>{rank}</Text>
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

  // "Your score +$187.5K, second of 5. Oct 30 games: -$40.5K." The score and
  // place first, then the last press's games in words that say which days
  // (walk 7 T3-14, walk 8 T2-01), as its own sentence.
  const head = [
    `${title} ${scoreText}${feesOnly ? ', fees so far' : ''}`,
    // Places in words, as Leaders and the season card speak them: "second of 5" (walk 6 T3-07).
    started && rank ? spokenRanks(rank) : null,
    !started && nextGameDate ? `next games ${humanDate(nextGameDate)}` : null,
  ].filter(Boolean).join(', ');
  const weekSpoken = started && week !== null ? ` ${weekName.spoken.charAt(0).toUpperCase()}${weekName.spoken.slice(1)}: ${formatAt(week, 'fine', true)}.` : '';
  const summary = `${head}.${weekSpoken}`;
  const why = fold ? (
    <Pressable
      accessibilityLabel="Why? Your games against last season's numbers"
      accessibilityRole="button"
      aria-expanded={whyOpen}
      // A double tap opens it once, not open and shut (walk 6 T4-11).
      onPress={repeatSafe(() => setWhyOpen((open) => !open))}
      style={({ pressed }) => [styles.why, !whyBeside && styles.whyLine, pressed && styles.whyPressed]}
    >
      <Text maxFontSizeMultiplier={1.3} style={styles.whyText}>{whyOpen ? 'Why? \u25B4' : 'Why? \u203A'}</Text>
    </Pressable>
  ) : null;
  const hero = (
    <>
      <FineMoney
        colored={started && score !== 0}
        size="hero"
        style={[styles.hero, heroSize < type.hero && { fontSize: heroSize, lineHeight: Math.round(heroSize * 1.17) }]}
        value={score}
      />
      {feesOnly ? <Text style={styles.feesOnly}>Fees so far</Text> : null}
    </>
  );

  return (
    <View style={styles.header}>
      {/* Drawn in capitals, named in sentence case (walk 6 T3-09). */}
      <Text accessibilityLabel={title} accessibilityRole="header" {...headingLevel(2)}>
        <Label>{title}</Label>
      </Text>
      {/* One sentence for screen readers (walk 4 T3-12); the drawn figures
          below say the same and are hidden from them. */}
      <Text style={visuallyHidden}>{summary}</Text>
      {beside ? (
        <View aria-hidden style={styles.heroRow}>
          <View ref={heroBox} style={styles.heroBeside}>{hero}</View>
          {facts}
        </View>
      ) : (
        // Stacked: the score, "Why?" in the room beside it on a phone, then
        // the week and rank under it. Only the drawn figures are hidden from
        // screen readers (the sentence above says them); "Why?" is a control.
        <View style={styles.heroColumn}>
          <View style={styles.heroTop}>
            <View aria-hidden ref={heroBox} style={styles.heroFill}>{hero}</View>
            {whyBeside ? why : null}
          </View>
          {facts ? <View aria-hidden>{facts}</View> : null}
          {whyBeside ? null : why}
        </View>
      )}
      {/* Why a cold start is not a broken signal, in words (signs, not colour). */}
      {started && valueLine && (!fold || whyOpen) ? <Text style={styles.valueLine}>{valueLine}</Text> : null}
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
export function ScoreParts({ title, parts, precision, variant, hidden = false }: {
  /** Names the split for screen readers: "Your score by source: …". */
  title: string;
  /** The season card speaks the split in its one summary, so the drawn split is hidden from screen readers. */
  hidden?: boolean;
  parts: readonly BreakdownPart[];
  precision: PartPrecision;
  variant: 'compact' | 'narrow' | 'panel';
}) {
  return (
    <View
      accessibilityLabel={hidden ? undefined : `${title} by source: ${parts.map((part) => `${part.label} ${formatAt(part.value, precision, true)}`).join(', ')}`}
      accessible={!hidden}
      aria-hidden={hidden || undefined}
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
  // The score and "Why?" on one line: the score takes the room "Why?" leaves.
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: space.md,
  },
  heroFill: {
    flex: 1,
    minWidth: 0,
  },
  // A quiet disclosure, its words on the block's right edge like the values.
  why: {
    minHeight: control.height,
    minWidth: control.height,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingHorizontal: space.sm,
    marginRight: -space.sm,
    borderRadius: radius.sm,
  },
  // Under the score (200% zoom): a line of its own, words at the left edge.
  whyLine: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
    marginRight: 0,
    marginLeft: -space.sm,
  },
  whyPressed: {
    opacity: 0.72,
  },
  whyText: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.black,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
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
