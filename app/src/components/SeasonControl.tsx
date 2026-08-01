import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useReducedMotion } from '../hooks/useReducedMotion';
import { usePortfolio } from '../state/PortfolioContext';
import { colors, radius, space, type } from '../theme';

function displayDate(value: string | null): string {
  if (!value) return 'Season complete';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}

export function SeasonControl() {
  const [confirmation, setConfirmation] = useState<'day' | 'season' | null>(null);
  const reducedMotion = useReducedMotion();
  const {
    advanceDay,
    advanceSeason,
    canAdvanceDay,
    isGameplayReady,
    isRefreshing,
    latestSettledDate,
    nextGameDate,
    pendingActions,
    refreshData,
    settledGameDateCount,
    seasonReplayProgress,
    state,
  } = usePortfolio();
  if (!state) return null;
  const disabled = !isGameplayReady || isRefreshing || pendingActions.size > 0;
  const canSettleNextDay = canAdvanceDay && nextGameDate !== null;
  const isSettling = pendingActions.has('advance');
  const isSettlingSeason = pendingActions.has('advance-season');

  const confirmAdvance = async () => {
    setConfirmation(null);
    await advanceDay();
  };

  const confirmSeason = async () => {
    setConfirmation(null);
    await advanceSeason();
  };

  return (
    <>
      <View style={styles.container}>
        <View style={styles.copy}>
          <Text numberOfLines={1} style={styles.label}>LAST SETTLED</Text>
          <Text numberOfLines={1} style={styles.date}>
            {latestSettledDate ? displayDate(latestSettledDate) : 'Not started'}
          </Text>
          <Text numberOfLines={1} style={styles.progress}>
            NEXT · {displayDate(nextGameDate)}
          </Text>
          {seasonReplayProgress ? (
            <Text accessibilityLiveRegion="polite" numberOfLines={2} style={styles.seasonProgress}>
              Simulating · {seasonReplayProgress.completedDates} dates settled · last {displayDate(seasonReplayProgress.lastSettledDate)}
            </Text>
          ) : (
            <Text numberOfLines={1} style={styles.progress}>{settledGameDateCount} game dates settled</Text>
          )}
        </View>
        <View style={styles.actions}>
          <Pressable
            accessibilityLabel="Refresh market data"
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => void refreshData()}
            style={({ pressed }) => [
              styles.refreshButton,
              disabled && styles.refreshButtonDisabled,
              pressed && !disabled && styles.buttonPressed,
            ]}
          >
            <Text style={[styles.refreshButtonText, disabled && styles.buttonTextDisabled]}>
              {isRefreshing ? '…' : '↻'}
            </Text>
          </Pressable>
          {canSettleNextDay ? (
            <View style={styles.advanceActions}>
              <Pressable
                accessibilityLabel="Settle the next historical game date"
                accessibilityRole="button"
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={() => setConfirmation('day')}
                style={({ pressed }) => [
                  styles.button,
                  disabled && styles.buttonDisabled,
                  pressed && !disabled && styles.buttonPressed,
                ]}
              >
                <Text numberOfLines={1} style={[styles.buttonText, disabled && styles.buttonTextDisabled]}>
                  {isSettling ? 'SETTLING' : 'NEXT DAY'}
                </Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Settle every remaining historical game date"
                accessibilityRole="button"
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={() => setConfirmation('season')}
                style={({ pressed }) => [
                  styles.seasonButton,
                  disabled && styles.seasonButtonDisabled,
                  pressed && !disabled && styles.buttonPressed,
                ]}
              >
                <Text numberOfLines={1} style={[styles.seasonButtonText, disabled && styles.buttonTextDisabled]}>
                  {isSettlingSeason ? 'SIMULATING' : 'SIMULATE SEASON'}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>

      {confirmation && canSettleNextDay ? (
        <Modal
          animationType={reducedMotion ? 'none' : 'fade'}
          onRequestClose={() => setConfirmation(null)}
          transparent
          visible
        >
          <View accessibilityViewIsModal style={styles.modalBackdrop}>
            <View style={styles.modal}>
              <Text accessibilityRole="header" style={styles.modalTitle}>
                {confirmation === 'day' ? 'Advance the shared replay?' : 'Simulate the rest of the season?'}
              </Text>
              <Text style={styles.modalBody}>
                {confirmation === 'day'
                  ? `This settles ${displayDate(nextGameDate)} for every play-tester. It cannot be undone.`
                  : 'This settles every remaining 2025-26 game date for every play-tester. Completed dates are saved, so an interrupted run can be resumed. It cannot be undone.'}
              </Text>
              <View style={styles.modalActions}>
                <Pressable
                  accessibilityLabel="Cancel replay simulation"
                  accessibilityRole="button"
                  onPress={() => setConfirmation(null)}
                  style={({ pressed }) => [styles.modalButton, pressed && styles.buttonPressed]}
                >
                  <Text style={styles.modalCancelText}>CANCEL</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel={confirmation === 'day' ? 'Confirm replay advancement' : 'Confirm full season simulation'}
                  accessibilityRole="button"
                  onPress={() => void (confirmation === 'day' ? confirmAdvance() : confirmSeason())}
                  style={({ pressed }) => [
                    styles.modalButton,
                    styles.modalConfirmButton,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Text style={styles.modalConfirmText}>
                    {confirmation === 'day' ? 'SETTLE NEXT DAY' : 'SIMULATE SEASON'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    // Wraps so enlarged "SIMULATE SEASON" buttons push the status text onto its
    // own line instead of crushing it or overflowing a narrow screen.
    flexWrap: 'wrap',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  copy: { flex: 1, minWidth: 150, gap: 2 },
  label: { color: colors.gold, fontSize: type.micro, fontWeight: '900', letterSpacing: 0.6 },
  date: { color: colors.text, fontSize: type.label, fontWeight: '800' },
  progress: { color: colors.muted, fontSize: type.micro },
  seasonProgress: { color: colors.gold, fontSize: type.micro, fontWeight: '800' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 0 },
  advanceActions: { gap: space.xs },
  refreshButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
  refreshButtonDisabled: { opacity: 0.55 },
  refreshButtonText: { color: colors.text, fontSize: 18, fontWeight: '800' },
  button: {
    minHeight: 44,
    minWidth: 118,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    backgroundColor: colors.gold,
  },
  buttonDisabled: { backgroundColor: colors.surfaceRaised },
  seasonButton: {
    minHeight: 44,
    minWidth: 118,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: radius.md,
    paddingHorizontal: space.sm,
    backgroundColor: colors.surfaceRaised,
  },
  seasonButtonDisabled: { borderColor: colors.border, opacity: 0.55 },
  seasonButtonText: { color: colors.gold, fontSize: type.micro, fontWeight: '900' },
  buttonPressed: { opacity: 0.72 },
  buttonText: { color: colors.background, fontSize: type.label, fontWeight: '900' },
  buttonTextDisabled: { color: colors.muted },
  modalBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
    backgroundColor: 'rgba(5, 10, 18, 0.76)',
  },
  modal: {
    width: '100%',
    maxWidth: 420,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.lg,
    backgroundColor: colors.surface,
  },
  modalTitle: { color: colors.text, fontSize: type.heading, fontWeight: '900' },
  modalBody: { color: colors.muted, fontSize: type.body, lineHeight: 20, marginTop: space.sm },
  modalActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: space.sm,
    marginTop: space.lg,
  },
  modalButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
  },
  modalConfirmButton: {
    borderColor: colors.gold,
    backgroundColor: colors.gold,
  },
  modalCancelText: { color: colors.text, fontSize: type.label, fontWeight: '900' },
  modalConfirmText: { color: colors.background, fontSize: type.label, fontWeight: '900' },
});
