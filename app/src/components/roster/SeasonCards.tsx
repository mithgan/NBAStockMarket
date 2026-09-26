import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { exactMoney, humanDate, signedMoneyFine } from '../../copy/terms';
import { keepTogether } from '../../data/chromeView';
import type { SeasonSummary } from '../../data/perGameMetrics';
import { finalSummary, type BreakdownPart, type PartPrecision } from '../../data/rosterView';
import { colors, control, fonts, headingStyle, radius, space, type, weight } from '../../theme';
import { Button, headingLevel, Label, Money, tapsSettling } from '../../ui/kit';
import { ScoreParts } from './ScoreHeader';

/** The welcome's heading: a new practice season moves keyboard focus here. */
export const PRACTICE_WELCOME_TITLE_ID = 'practice-welcome-title';

/**
 * The first thing a new player reads in a practice season: what to do, what
 * +1 night does, that nothing is saved, and where the rules are. Once a
 * player is on the roster it turns into the next step (play the first
 * games). Hidden for the session with ×, and gone once one of your players
 * has played a game.
 */
export function WelcomeCard({
  hasPlayers,
  nextGameDate,
  feeDollars,
  earn,
  onOpenMarket,
  onOpenRules,
  onHide,
}: {
  hasPlayers: boolean;
  /** What a player earns, in one plain line (`earnLine`, walk 6 T1-02). */
  earn: string;
  nextGameDate: string | null;
  feeDollars: number;
  onOpenMarket: () => void;
  /** Opens the rules; omitted when no rules sheet is available. */
  onOpenRules?: () => void;
  onHide: () => void;
}) {
  const fee = feeDollars > 0 ? ` Each add or drop costs a ${exactMoney(feeDollars)} fee.` : '';
  const games = nextGameDate ? `the ${humanDate(nextGameDate)} games` : 'the first games';
  const title = hasPlayers ? 'Ready for the first games' : 'Your practice season';
  // At 400% zoom (about 100px wide) the × takes its own line and the buttons
  // run full width, so the words keep the whole card (walk 3 T3-05).
  const tiny = useWindowDimensions().width < 200;
  const copy = hasPlayers
    ? `Press +1 night to play ${games}. You can keep adding players until then.`
    : `${earn} Pick players whose dividend should beat their price, then press +1 night to play ${games}.${fee} Practice isn't saved: reloading starts a new season.`;
  return (
    <View style={[styles.band, tiny && styles.bandTiny]}>
      <View style={[styles.headRow, tiny && styles.headRowTiny]}>
        <View style={styles.headText}>
          <Label tone="gold">Practice</Label>
          <Text
            accessibilityRole="header"
            nativeID={PRACTICE_WELCOME_TITLE_ID}
            {...headingLevel(2)}
            {...({ tabIndex: -1 } as object)}
            style={styles.title}
          >
            {title}
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Hide this welcome"
          accessibilityRole="button"
          hitSlop={4}
          onPress={onHide}
          style={({ pressed }) => [styles.hide, tiny && styles.hideTiny, pressed && styles.pressed]}
        >
          <Text style={styles.hideGlyph}>×</Text>
        </Pressable>
      </View>
      <Text style={styles.copy}>{copy}</Text>
      <View style={[styles.actions, tiny && styles.actionsTiny]}>
        {hasPlayers ? null : (
          <Button accessibilityLabel="Open market: browse players to add" label="Open market" onPress={onOpenMarket} variant="primary" />
        )}
        {onOpenRules ? <Button label="How scoring works" onPress={onOpenRules} /> : null}
      </View>
    </View>
  );
}

/**
 * How to read your first night (walk 5 T1-N4), in the welcome's place once
 * your first games have settled: the one tag a new fan meets everywhere, and
 * where each game's math is. One line and a way to Results; × hides it, and
 * it goes by itself after the next night.
 */
export function FirstNightTip({ onOpenResults, onHide, inline = false }: {
  onOpenResults: () => void;
  onHide: () => void;
  /** A short window (a phone on its side): Results at the end of the words' line, not on a line of its own. */
  inline?: boolean;
}) {
  const tiny = useWindowDimensions().width < 200;
  const results = <Button accessibilityLabel="Results: each game's math" label="Results" onPress={onOpenResults} />;
  const beside = inline && !tiny;
  return (
    <View style={[styles.band, styles.tipBand, tiny && styles.bandTiny]}>
      <View style={[styles.headRow, beside && styles.tipRowInline, tiny && styles.headRowTiny]}>
        <Text style={[styles.headText, styles.tipText]}>
          <Text style={styles.tipTag}>PAYING OFF</Text>
          {" means his dividends beat your price so far. Results shows each game's math."}
        </Text>
        {beside ? results : null}
        <Pressable
          accessibilityLabel="Hide this tip"
          accessibilityRole="button"
          hitSlop={4}
          onPress={onHide}
          style={({ pressed }) => [styles.hide, tiny && styles.hideTiny, pressed && styles.pressed]}
        >
          <Text style={styles.hideGlyph}>×</Text>
        </Pressable>
      </View>
      {beside ? null : <View style={[styles.tipActions, tiny && styles.actionsTiny]}>{results}</View>}
    </View>
  );
}

/**
 * The season's closing moment on the Roster: the final score and place, where
 * it came from (Roster, Shorts, Closed, Fees: the score block's split, which
 * the card carries once the season is over, so the score and rank are not
 * shown twice; walk 4 T2-07, T1-17), the best and worst player, how many
 * moves it took, and (in practice) one way to go again.
 */
export function SeasonCompleteCard({
  summary,
  fees,
  parts = null,
  precision = 'fine',
  variant = 'compact',
  valueLine = null,
  exactLine = null,
  movesText,
  onPlayAgain,
  onOpenPlayer,
}: {
  summary: SeasonSummary;
  /**
   * The final score exactly, when rounding hides a part ("Exactly
   * +$4,129,750, fees -$750 included."; `exactFinalLine`); null otherwise.
   */
  exactLine?: string | null;
  /** What the moves were, from `movesLine`: "4 (3 adds, 1 short) · $1K in fees". */
  movesText?: string;
  /** What the moves cost in all (the Fees part of the score). */
  fees: number;
  /** The final score by source, from `breakdownParts`; null with nothing on record. */
  parts?: readonly BreakdownPart[] | null;
  /** The precision at which the parts visibly add up to the final score. */
  precision?: PartPrecision;
  /** The split's layout, as in the score block: two a line on a phone, a statement on desktop. */
  variant?: 'compact' | 'narrow' | 'panel';
  /** The score block's value line (`pickValue`): last season's value of your picks beside what they made. */
  valueLine?: string | null;
  /** Practice only: start a fresh season. */
  onPlayAgain?: () => void;
  /**
   * Opens a player's profile by name, so Best and Worst answer "why?" in one
   * tap (walk 3 T1-N2). Without it they are plain text.
   */
  onOpenPlayer?: (name: string) => void;
}) {
  const place = summary.rank !== null && summary.of !== null ? `#${summary.rank} of ${summary.of}` : null;
  const split = parts && parts.length > 0 ? parts : null;
  const players = [
    summary.best ? { label: 'Best', name: summary.best.name, total: signedMoneyFine(summary.best.total) } : null,
    summary.worst ? { label: 'Worst', name: summary.worst.name, total: signedMoneyFine(summary.worst.total) } : null,
  ].filter((line): line is { label: string; name: string; total: string } => line !== null);
  // Read the way Season so far read it all season: moves, then fees (unless
  // the split above already names the fees).
  // What the moves were and what they cost (walk 5 T1-13), not a bare count.
  const moves = movesText ?? (`${summary.moves}${split ? '' : ` · fees ${signedMoneyFine(fees)}`}`
    + (summary.shortsMade > 0 ? ` · ${summary.shortsMade} ${summary.shortsMade === 1 ? 'short' : 'shorts'}` : ''));
  const spokenMoves = `Moves ${moves.replace(/ · /g, ', ')}`;
  // One spoken summary, like the score block's in season, with places in
  // words as Leaders speaks them (walk 6 T3-07): "Final score +$4.95M, first
  // of 5. Roster +$4.95M, shorts $0, closed $0, fees -$500." The drawn split
  // repeats it, so it is hidden from screen readers.
  const spoken = finalSummary(summary.finalScore, place, split);
  const movesLine = (
    <View
      accessibilityLabel={onOpenPlayer ? spokenMoves : undefined}
      accessible={onOpenPlayer ? true : undefined}
      style={styles.finalLine}
    >
      <Text style={styles.finalLabel}>Moves</Text>
      <Text style={styles.finalText}>{moves}</Text>
    </View>
  );
  return (
    <View style={[styles.band, styles.finalBand]}>
      <Label tone="gold">Season complete</Label>
      <Text accessibilityRole="header" {...headingLevel(2)} style={styles.title}>Your final result</Text>
      <View accessible accessibilityLabel={spoken} style={styles.finalFacts}>
        <View style={styles.finalScoreRow}>
          <Money size="display" value={summary.finalScore} />
          {/* "#2 of 5" never breaks across lines (walk 6 T1-10a). */}
          {place ? <Text style={styles.place}>{keepTogether(place)}</Text> : null}
        </View>
      </View>
      {split || valueLine ? (
        <View style={styles.split}>
          {split ? <ScoreParts hidden parts={split} precision={precision} title="Final score" variant={variant} /> : null}
          {split && exactLine ? <Text style={styles.valueLine}>{exactLine}</Text> : null}
          {valueLine ? <Text style={styles.valueLine}>{valueLine}</Text> : null}
        </View>
      ) : null}
      {onOpenPlayer ? null : (
        // Without profiles to open, Best, Worst and Moves are read as one group.
        <View
          accessible
          accessibilityLabel={[...players.map((line) => `${line.label} ${line.name} ${line.total}`), spokenMoves].join(', ')}
          style={styles.finalFacts}
        >
          {players.map((line) => (
            <View key={line.label} style={styles.finalLine}>
              <Text style={styles.finalLabel}>{line.label}</Text>
              <Text style={styles.finalText}>{line.name} {line.total}</Text>
            </View>
          ))}
          {movesLine}
        </View>
      )}
      {onOpenPlayer ? (
        <>
          {players.map((line) => (
            <Pressable
              key={line.label}
              accessibilityLabel={`${line.label}: ${line.name} ${line.total}. View profile`}
              accessibilityRole="button"
              onPress={() => {
                if (tapsSettling()) return;
                onOpenPlayer(line.name);
              }}
              style={({ pressed }) => [styles.finalLine, styles.playerLine, pressed && styles.pressed]}
            >
              <Text style={styles.finalLabel}>{line.label}</Text>
              {/* Name and total share the middle and wrap there, so the
                  chevron keeps the row's end on a 195px screen too. */}
              <View style={styles.playerFacts}>
                <Text style={[styles.finalText, styles.playerName]}>{line.name}</Text>
                <Text style={styles.finalText}>{line.total}</Text>
              </View>
              <Text style={styles.playerOpen}>›</Text>
            </Pressable>
          ))}
          <View style={styles.finalFacts}>{movesLine}</View>
        </>
      ) : null}
      {onPlayAgain ? (
        <View style={styles.actions}>
          <Button label="Play another season" onPress={onPlayAgain} variant="primary" />
        </View>
      ) : null}
    </View>
  );
}

/**
 * The desktop score column's closing block while a season runs: best and
 * worst player so far and what the moves have cost.
 */
export function SeasonSoFar({ summary, fees, movesText }: {
  summary: SeasonSummary;
  fees: number;
  /** What the moves were, from `movesLine`, read the same as on the season's card. */
  movesText?: string;
}) {
  const lines = [
    summary.best ? { label: 'Best so far', text: `${summary.best.name} ${signedMoneyFine(summary.best.total)}` } : null,
    summary.worst ? { label: 'Worst so far', text: `${summary.worst.name} ${signedMoneyFine(summary.worst.total)}` } : null,
    summary.moves > 0
      ? { label: 'Moves', text: movesText ?? `${summary.moves} · fees ${signedMoneyFine(fees)}` }
      : null,
  ].filter((line): line is { label: string; text: string } => line !== null);
  if (lines.length === 0) return null;
  return (
    <View style={styles.soFar}>
      {/* Drawn in capitals, named in sentence case (walk 6 T3-09). */}
      <Text accessibilityLabel="Season so far" accessibilityRole="header" {...headingLevel(2)} style={styles.soFarTitle}>Season so far</Text>
      {lines.map((line) => (
        <View
          key={line.label}
          accessible
          accessibilityLabel={`${line.label}: ${line.text.replace(/ · /g, ', ')}`}
          style={styles.finalLine}
        >
          <Text style={styles.finalLabel}>{line.label}</Text>
          <Text style={styles.finalText}>{line.text}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.md,
    backgroundColor: colors.surfaceRaised,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
    borderLeftWidth: 3,
    borderLeftColor: colors.gold,
  },
  finalBand: {
    rowGap: 2,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  headText: {
    flex: 1,
    minWidth: 0,
  },
  bandTiny: {
    paddingHorizontal: space.sm,
  },
  hideTiny: {
    alignSelf: 'flex-end',
    marginTop: 0,
  },
  headRowTiny: {
    flexDirection: 'column-reverse',
    alignItems: 'stretch',
  },
  actionsTiny: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  title: {
    ...headingStyle,
    marginTop: 2,
    letterSpacing: 0,
  },
  hide: {
    width: control.height,
    height: control.height,
    marginTop: -space.sm,
    marginRight: -space.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  hideGlyph: {
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: 24,
    fontWeight: weight.bold,
    lineHeight: 26,
  },
  copy: {
    marginTop: space.xs,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: type.body,
    lineHeight: 21,
  },
  // The first-night tip: a slimmer band than the welcome.
  tipBand: {
    paddingTop: space.sm,
    paddingBottom: space.sm,
  },
  tipText: {
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: type.caption,
    lineHeight: 18,
  },
  tipTag: {
    fontFamily: fonts.display,
    fontWeight: weight.heavy,
  },
  // Inline: the words, Results and × on one line, centred on each other.
  tipRowInline: {
    alignItems: 'center',
  },
  tipActions: {
    marginTop: space.xs,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  actions: {
    marginTop: space.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  finalFacts: {
    marginTop: space.xs,
    rowGap: 3,
  },
  finalScoreRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: space.md,
  },
  // The score's split sits between the score and the players, ruled off above.
  split: {
    marginBottom: space.xs,
  },
  valueLine: {
    marginTop: space.xs,
    color: colors.muted,
    fontFamily: fonts.body,
    fontSize: type.caption,
    lineHeight: 17,
  },
  place: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
    fontVariant: ['tabular-nums'],
  },
  finalLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: space.sm,
  },
  finalLabel: {
    minWidth: 52,
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.caption,
    fontWeight: weight.bold,
  },
  finalText: {
    flexShrink: 1,
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.caption,
    fontWeight: weight.heavy,
    fontVariant: ['tabular-nums'],
  },
  // Best / Worst as a row button: full touch height, the chevron at its end.
  playerLine: {
    minHeight: control.height,
    flexWrap: 'nowrap',
    alignItems: 'center',
    // Padded inside and pulled out by as much: the words stay in line with
    // Moves while the focus ring clears them.
    marginHorizontal: -space.sm,
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
  },
  playerFacts: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: space.sm,
  },
  playerName: {
    textDecorationLine: 'underline',
  },
  playerOpen: {
    marginLeft: 'auto',
    paddingLeft: space.sm,
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
  },
  soFar: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    rowGap: 4,
  },
  soFarTitle: {
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.black,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  pressed: {
    opacity: 0.72,
  },
});
