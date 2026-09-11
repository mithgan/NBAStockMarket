import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  advanceMockNights,
  isMockActive,
  mockSeasonStart,
  resetMock,
} from '../api/mockPerGameClient';
import { usePerGame } from '../state/PerGameContext';
import { colors, fonts, labelStyle, space, type, weight } from '../theme';

const SEASON_TOTAL_DAYS = 174;
const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (new Date(`${toIso}T00:00:00Z`).getTime() - new Date(`${fromIso}T00:00:00Z`).getTime()) / DAY_MS,
  );
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}

/**
 * The season progression bar. While the sandbox drives, its controls settle
 * nights; in the signed-in app the same bar is the sandbox's front door —
 * one tap enters a practice season, and the real account stays signed in
 * (the live game's clock belongs to the server).
 */
export function SimBar() {
  const {
    bootstrap,
    isGameplayReady,
    isRefreshing,
    pendingActions,
    refreshData,
  } = usePerGame();
  const [confirmingReset, setConfirmingReset] = useState(false);
  useEffect(() => {
    if (!confirmingReset) return;
    const timer = setTimeout(() => setConfirmingReset(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmingReset]);
  const mockDriving = isMockActive();
  const canEnterSandbox = typeof window !== 'undefined';
  if (!bootstrap || (!mockDriving && !canEnterSandbox)) return null;

  const enterSandbox = () => {
    window.location.search = '?mock';
  };
  const disabled = mockDriving
    && (!isGameplayReady || isRefreshing || pendingActions.size > 0);
  const start = mockDriving ? mockSeasonStart() : null;
  const settled = mockDriving ? bootstrap.game.lastSettledDate : null;
  const day = start && settled
    ? Math.min(Math.max(daysBetween(start, settled), 0), SEASON_TOTAL_DAYS)
    : 0;
  const progress = day / SEASON_TOTAL_DAYS;
  const seasonComplete = mockDriving && day >= SEASON_TOTAL_DAYS;
  const advanceDisabled = disabled || seasonComplete;

  return (
    <View style={styles.bar}>
      <View style={styles.readout}>
        <View style={styles.readoutCopy}>
          <Text style={styles.eyebrow}>SANDBOX SEASON REPLAY</Text>
          <Text numberOfLines={1} style={styles.date}>
            {mockDriving
              ? (settled ? dateLabel(settled) : 'Opening night eve')
              : 'Practice season — your account is untouched'}
            {mockDriving ? (
              <Text style={styles.dayCount}>  ·  Day {day} / {SEASON_TOTAL_DAYS}</Text>
            ) : null}
          </Text>
        </View>
        {mockDriving && canEnterSandbox ? (
          <Pressable
            accessibilityLabel="Leave the sandbox and return to the live market"
            accessibilityRole="button"
            onPress={() => {
              window.location.search = '';
            }}
            style={({ pressed }) => [styles.resetButton, pressed && styles.pressed]}
          >
            <Text style={styles.resetText}>EXIT</Text>
          </Pressable>
        ) : null}
        {mockDriving ? (
          <Pressable
            accessibilityLabel={confirmingReset
              ? 'Confirm restarting the sandbox season'
              : 'Restart the sandbox season'}
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => {
              if (confirmingReset) {
                setConfirmingReset(false);
                resetMock();
                refreshData();
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
        ) : null}
      </View>

      <View
        accessibilityLabel={`Season progress: day ${day} of ${SEASON_TOTAL_DAYS}`}
        style={styles.track}
      >
        <View style={[styles.fill, { width: `${Math.max(progress * 100, 0.5)}%` }]} />
      </View>

      <View style={styles.controls}>
        {([
          ['+1 NIGHT', 1],
          ['+1 WEEK', 7],
        ] as const).map(([label, nights]) => (
          <Pressable
            accessibilityLabel={`Advance ${nights === 1 ? 'one night' : 'one week'} in the sandbox`}
            accessibilityRole="button"
            accessibilityState={{ disabled: advanceDisabled }}
            disabled={advanceDisabled}
            key={label}
            onPress={() => {
              if (!mockDriving) {
                enterSandbox();
                return;
              }
              advanceMockNights(nights);
              refreshData();
            }}
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
        ))}
        {seasonComplete ? <Text style={styles.done}>Season complete</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.chromeSoft,
    borderBottomColor: colors.borderStrong,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    gap: space.sm,
  },
  readout: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  readoutCopy: {
    minWidth: 0,
    flex: 1,
  },
  eyebrow: {
    ...labelStyle,
    color: colors.goldInk,
    fontSize: 10,
  },
  date: {
    marginTop: 2,
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: type.value,
    fontWeight: weight.heavy,
    fontVariant: ['tabular-nums'],
  },
  dayCount: {
    color: colors.muted,
    fontSize: type.label,
    fontWeight: weight.bold,
  },
  resetButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
  },
  resetText: {
    ...labelStyle,
  },
  resetArmed: {
    color: colors.red,
  },
  track: {
    height: 5,
    borderRadius: 999,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.gold,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  advanceButton: {
    minHeight: 44,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.goldLine,
    backgroundColor: colors.goldSoft,
    paddingHorizontal: space.lg,
  },
  advanceText: {
    color: colors.goldInk,
    fontFamily: fonts.display,
    fontSize: type.label,
    fontWeight: weight.black,
    letterSpacing: 0.8,
  },
  disabledButton: {
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    opacity: 0.55,
  },
  disabledText: {
    color: colors.muted,
  },
  done: {
    color: colors.muted,
    fontSize: type.label,
    fontWeight: weight.bold,
  },
  pressed: {
    opacity: 0.65,
  },
});
