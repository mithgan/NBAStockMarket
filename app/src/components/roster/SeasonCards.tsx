import { Pressable, StyleSheet, Text, View } from 'react-native';

import { exactMoney, humanDate, signedMoney, signedMoneyFine } from '../../copy/terms';
import type { SeasonSummary } from '../../data/perGameMetrics';
import { colors, control, fonts, headingStyle, radius, space, type, weight } from '../../theme';
import { Button, headingLevel, Label, Money } from '../../ui/kit';

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
  onOpenMarket,
  onOpenRules,
  onHide,
}: {
  hasPlayers: boolean;
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
  const copy = hasPlayers
    ? `Press +1 night to play ${games}. You can keep adding players until then.`
    : `Pick players you think will earn more than their price a game, then press +1 night to play ${games}.${fee} Practice isn't saved: reloading starts a new season.`;
  return (
    <View style={styles.band}>
      <View style={styles.headRow}>
        <View style={styles.headText}>
          <Label tone="gold">Practice</Label>
          <Text accessibilityRole="header" {...headingLevel(2)} style={styles.title}>{title}</Text>
        </View>
        <Pressable
          accessibilityLabel="Hide this welcome"
          accessibilityRole="button"
          hitSlop={4}
          onPress={onHide}
          style={({ pressed }) => [styles.hide, pressed && styles.pressed]}
        >
          <Text style={styles.hideGlyph}>×</Text>
        </Pressable>
      </View>
      <Text style={styles.copy}>{copy}</Text>
      <View style={styles.actions}>
        {hasPlayers ? null : (
          <Button accessibilityLabel="Open the player market" label="Open market" onPress={onOpenMarket} variant="primary" />
        )}
        {onOpenRules ? <Button label="How scoring works" onPress={onOpenRules} /> : null}
      </View>
    </View>
  );
}

/**
 * The season's closing moment on the Roster: the final score and place, the
 * best and worst player, how many moves it took, and (in practice) one way to
 * go again.
 */
export function SeasonCompleteCard({
  summary,
  fees,
  onPlayAgain,
}: {
  summary: SeasonSummary;
  /** What the moves cost in all (the Fees part of the score). */
  fees: number;
  /** Practice only: start a fresh season. */
  onPlayAgain?: () => void;
}) {
  const place = summary.rank !== null && summary.of !== null ? `#${summary.rank} of ${summary.of}` : null;
  const lines = [
    summary.best ? { label: 'Best', text: `${summary.best.name} ${signedMoneyFine(summary.best.total)}` } : null,
    summary.worst ? { label: 'Worst', text: `${summary.worst.name} ${signedMoneyFine(summary.worst.total)}` } : null,
    {
      // Read the way Season so far read it all season: moves, then fees.
      label: 'Moves',
      text: `${summary.moves} · fees ${signedMoneyFine(fees)}`
        + (summary.shortsMade > 0 ? ` · ${summary.shortsMade} ${summary.shortsMade === 1 ? 'short' : 'shorts'}` : ''),
    },
  ].filter((line): line is { label: string; text: string } => line !== null);
  const spoken = [
    `Final score ${signedMoney(summary.finalScore)}`,
    place ? `finished ${place.replace('#', 'number ')}` : null,
    ...lines.map((line) => `${line.label} ${line.text.replace(/ · /g, ', ')}`),
  ].filter(Boolean).join(', ');
  return (
    <View style={[styles.band, styles.finalBand]}>
      <Label tone="gold">Season complete</Label>
      <Text accessibilityRole="header" {...headingLevel(2)} style={styles.title}>Your final result</Text>
      <View accessible accessibilityLabel={spoken} style={styles.finalFacts}>
        <View style={styles.finalScoreRow}>
          <Money size="display" value={summary.finalScore} />
          {place ? <Text style={styles.place}>{place}</Text> : null}
        </View>
        {lines.map((line) => (
          <View key={line.label} style={styles.finalLine}>
            <Text style={styles.finalLabel}>{line.label}</Text>
            <Text style={styles.finalText}>{line.text}</Text>
          </View>
        ))}
      </View>
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
export function SeasonSoFar({ summary, fees }: { summary: SeasonSummary; fees: number }) {
  const lines = [
    summary.best ? { label: 'Best so far', text: `${summary.best.name} ${signedMoneyFine(summary.best.total)}` } : null,
    summary.worst ? { label: 'Worst so far', text: `${summary.worst.name} ${signedMoneyFine(summary.worst.total)}` } : null,
    summary.moves > 0
      ? { label: 'Moves', text: `${summary.moves} · fees ${signedMoneyFine(fees)}` }
      : null,
  ].filter((line): line is { label: string; text: string } => line !== null);
  if (lines.length === 0) return null;
  return (
    <View style={styles.soFar}>
      <Text accessibilityRole="header" {...headingLevel(2)} style={styles.soFarTitle}>Season so far</Text>
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
