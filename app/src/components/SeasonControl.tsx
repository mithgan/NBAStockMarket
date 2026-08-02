import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { usePortfolio } from '../state/PortfolioContext';
import { SEASON_TOTAL_DAYS, seasonDayNumber, seasonProgress } from '../state/simDates';
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
  const {
    advanceSeason,
    canAdvanceSeason,
    isGameplayReady,
    isRefreshing,
    nextGameDate,
    pendingActions,
    refreshData,
    resetSeasonAccount,
    settledGameDateCount,
    state,
  } = usePortfolio();
  const [confirmingReset, setConfirmingReset] = useState(false);
  useEffect(() => {
    if (!confirmingReset) return;
    const timer = setTimeout(() => setConfirmingReset(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmingReset]);
  if (!state) return null;

  const disabled = !isGameplayReady || isRefreshing || pendingActions.size > 0;
  const seasonComplete = nextGameDate === null;
  const advanceDisabled = disabled || seasonComplete;
  const day = seasonDayNumber(nextGameDate);
  const progress = seasonProgress(nextGameDate);

  return (
    <View style={styles.bar}>
      <View style={styles.readout}>
        <View style={styles.readoutCopy}>
          <Text style={styles.eyebrow}>2025-26 SEASON REPLAY</Text>
          <Text numberOfLines={1} style={styles.date}>
            {displayDate(nextGameDate)}
            <Text style={styles.dayCount}>
              {'  ·  '}Day {day} / {SEASON_TOTAL_DAYS}{'  ·  '}{settledGameDateCount} settled
            </Text>
          </Text>
        </View>
        <Pressable
          accessibilityLabel={confirmingReset
            ? 'Confirm resetting your account to the opening bankroll'
            : 'Reset your account to the opening bankroll'}
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => {
            if (confirmingReset) {
              setConfirmingReset(false);
              void resetSeasonAccount();
            } else {
              setConfirmingReset(true);
            }
          }}
          style={({ pressed }) => [styles.resetButton, pressed && !disabled && styles.pressed]}
        >
          <Text style={[styles.resetText, confirmingReset && styles.resetArmed]}>
            {confirmingReset ? 'SURE?' : 'RESET'}
          </Text>
        </Pressable>
      </View>

      <View
        accessibilityLabel={`Season progress: day ${day} of ${SEASON_TOTAL_DAYS}`}
        style={styles.track}
      >
        <View style={[styles.fill, { width: `${Math.max(progress * 100, 0.5)}%` }]} />
      </View>

      <View style={styles.controls}>
        {canAdvanceSeason ? (
          ([
            ['+1 DAY', 1],
            ['+1 WEEK', 7],
          ] as const).map(([label, days]) => (
            <Pressable
              accessibilityLabel={`Advance ${days === 1 ? 'one day' : 'one week'}`}
              accessibilityRole="button"
              accessibilityState={{ disabled: advanceDisabled }}
              disabled={advanceDisabled}
              key={label}
              onPress={() => void advanceSeason(days)}
              style={({ pressed }) => [
                styles.advanceButton,
                advanceDisabled && styles.disabledButton,
                pressed && !advanceDisabled && styles.pressed,
              ]}
            >
              <Text style={[styles.advanceText, advanceDisabled && styles.disabledText]}>
                {label}
              </Text>
            </Pressable>
          ))
        ) : (
          <Pressable
            accessibilityLabel="Check server for updates"
            accessibilityRole="button"
            accessibilityState={{ disabled: advanceDisabled }}
            disabled={advanceDisabled}
            onPress={() => void refreshData()}
            style={({ pressed }) => [
              styles.advanceButton,
              advanceDisabled && styles.disabledButton,
              pressed && !advanceDisabled && styles.pressed,
            ]}
          >
            <Text style={[styles.advanceText, advanceDisabled && styles.disabledText]}>
              {isRefreshing ? 'CHECKING' : 'CHECK NOW'}
            </Text>
          </Pressable>
        )}
        {seasonComplete ? <Text style={styles.done}>Season complete</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 8,
  },
  readout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  readoutCopy: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.gold, fontSize: 8, fontWeight: '900', letterSpacing: 1.4 },
  date: { color: colors.text, fontSize: 14, fontWeight: '800', marginTop: 2 },
  dayCount: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  resetButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 10 },
  resetText: { color: colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  resetArmed: { color: colors.red },
  track: { height: 5, borderRadius: 999, backgroundColor: colors.surfaceRaised, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 999, backgroundColor: colors.gold },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  advanceButton: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.gold,
    backgroundColor: colors.goldSoft,
    paddingHorizontal: 16,
  },
  advanceText: { color: colors.gold, fontSize: 11, fontWeight: '900', letterSpacing: 0.8 },
  disabledButton: { borderColor: colors.border, backgroundColor: colors.surfaceRaised, opacity: 0.55 },
  disabledText: { color: colors.muted },
  done: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  pressed: { opacity: 0.65 },
});
