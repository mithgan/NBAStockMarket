import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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
  const [confirmingAdvance, setConfirmingAdvance] = useState(false);
  const {
    advanceDay,
    canAdvanceDay,
    isGameplayReady,
    isRefreshing,
    nextGameDate,
    pendingActions,
    refreshData,
    settledGameDateCount,
    state,
  } = usePortfolio();
  useEffect(() => {
    setConfirmingAdvance(false);
  }, [nextGameDate]);
  if (!state) return null;
  const disabled = !isGameplayReady || isRefreshing || pendingActions.size > 0;

  return (
    <View style={styles.container}>
      <View style={styles.copy}>
        <Text style={styles.label}>2025-26 SERVER REPLAY</Text>
        <Text numberOfLines={1} style={styles.date}>{displayDate(nextGameDate)}</Text>
        <Text style={styles.progress}>{settledGameDateCount} game dates settled</Text>
      </View>
      <View style={styles.actions}>
        {canAdvanceDay && nextGameDate ? (
          confirmingAdvance ? (
            <>
              <Pressable
                accessibilityLabel="Cancel replay advancement"
                accessibilityRole="button"
                disabled={disabled}
                onPress={() => setConfirmingAdvance(false)}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && !disabled && styles.buttonPressed,
                ]}
              >
                <Text style={styles.secondaryButtonText}>CANCEL</Text>
              </Pressable>
              <Pressable
                accessibilityLabel={`Confirm replay settlement for ${displayDate(nextGameDate)}`}
                accessibilityRole="button"
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={() => void advanceDay()}
                style={({ pressed }) => [
                  styles.button,
                  disabled && styles.buttonDisabled,
                  pressed && !disabled && styles.buttonPressed,
                ]}
              >
                <Text style={[styles.buttonText, disabled && styles.buttonTextDisabled]}>
                  CONFIRM
                </Text>
              </Pressable>
            </>
          ) : (
            <Pressable
              accessibilityLabel={`Advance replay through ${displayDate(nextGameDate)}`}
              accessibilityRole="button"
              accessibilityState={{ disabled }}
              disabled={disabled}
              onPress={() => setConfirmingAdvance(true)}
              style={({ pressed }) => [
                styles.button,
                disabled && styles.buttonDisabled,
                pressed && !disabled && styles.buttonPressed,
              ]}
            >
              <Text style={[styles.buttonText, disabled && styles.buttonTextDisabled]}>
                ADVANCE DAY
              </Text>
            </Pressable>
          )
        ) : null}
        {!confirmingAdvance ? (
          <Pressable
            accessibilityLabel="Check server for updates"
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => void refreshData()}
            style={({ pressed }) => [
              styles.button,
              styles.refreshButton,
              disabled && styles.buttonDisabled,
              pressed && !disabled && styles.buttonPressed,
            ]}
          >
            <Text style={[styles.buttonText, disabled && styles.buttonTextDisabled]}>
              {isRefreshing ? 'CHECKING' : 'CHECK NOW'}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {confirmingAdvance && nextGameDate ? (
        <Text accessibilityLiveRegion="polite" style={styles.confirmation}>
          Settle {displayDate(nextGameDate)} for every tester? This cannot be undone.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 78,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  copy: { flex: 1, minWidth: 120 },
  actions: {
    flexDirection: 'row',
    flexShrink: 1,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    minWidth: 96,
    gap: 8,
  },
  label: { color: colors.gold, fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  date: { color: colors.text, fontSize: 15, fontWeight: '800', marginTop: 3 },
  progress: { color: colors.muted, fontSize: 10, marginTop: 2 },
  button: {
    minHeight: 44,
    minWidth: 96,
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
  refreshButton: { minWidth: 84 },
  secondaryButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  secondaryButtonText: { color: colors.text, fontSize: 11, fontWeight: '900' },
  confirmation: {
    width: '100%',
    color: colors.muted,
    fontSize: 11,
    lineHeight: 16,
  },
});
