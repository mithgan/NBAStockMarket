import { Pressable, StyleSheet, Text, View } from 'react-native';

import { replayDays } from '../data/replay';
import { usePortfolio } from '../state/PortfolioContext';
import { colors } from '../theme';

function displayDate(value: string | null): string {
  if (!value) return 'Season complete';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}

export function SeasonControl() {
  const { advanceDay, isAdvancing, isGameplayReady, isHydrated, nextReplayDay, state } = usePortfolio();
  const disabled = !isGameplayReady || isAdvancing || !nextReplayDay;
  const progress = Math.min(state.settledDates.length, replayDays.length);

  return (
    <View style={styles.container}>
      <View style={styles.copy}>
        <Text style={styles.label}>2025-26 REPLAY</Text>
        <Text numberOfLines={1} style={styles.date}>
          {isHydrated ? displayDate(nextReplayDay?.date ?? null) : 'Loading saved season...'}
        </Text>
        <Text style={styles.progress}>{progress} of {replayDays.length} game dates settled</Text>
      </View>
      <Pressable
        accessibilityLabel={nextReplayDay ? `Settle ${displayDate(nextReplayDay.date)}` : 'Replay season complete'}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={advanceDay}
        style={({ pressed }) => [
          styles.button,
          disabled && styles.buttonDisabled,
          pressed && !disabled && styles.buttonPressed,
        ]}
      >
        <Text style={[styles.buttonText, disabled && styles.buttonTextDisabled]}>
          {isAdvancing ? 'SETTLING' : nextReplayDay ? 'NEXT DAY' : 'COMPLETE'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  copy: { flex: 1, minWidth: 0 },
  label: { color: colors.gold, fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  date: { color: colors.text, fontSize: 15, fontWeight: '800', marginTop: 3 },
  progress: { color: colors.muted, fontSize: 10, marginTop: 2 },
  button: {
    minHeight: 44,
    minWidth: 106,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    paddingHorizontal: 14,
    backgroundColor: colors.gold,
  },
  buttonDisabled: { backgroundColor: colors.surfaceRaised },
  buttonPressed: { opacity: 0.72 },
  buttonText: { color: colors.background, fontSize: 11, fontWeight: '900' },
  buttonTextDisabled: { color: colors.muted },
});
