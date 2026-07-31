import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

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
  const [confirmation, setConfirmation] = useState<'day' | 'season' | null>(null);
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
          <Text style={styles.label}>2025-26 SERVER REPLAY</Text>
          <Text numberOfLines={1} style={styles.date}>
            LAST SETTLED · {latestSettledDate ? displayDate(latestSettledDate) : 'Not started'}
          </Text>
          <Text numberOfLines={1} style={styles.nextDate}>
            NEXT · {displayDate(nextGameDate)}
          </Text>
          <Text style={styles.progress}>{settledGameDateCount} game dates settled</Text>
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
                <Text style={[styles.buttonText, disabled && styles.buttonTextDisabled]}>
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
                <Text style={[styles.seasonButtonText, disabled && styles.buttonTextDisabled]}>
                  {isSettlingSeason ? 'SIMULATING' : 'SIMULATE SEASON'}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
        {seasonReplayProgress ? (
          <Text accessibilityLiveRegion="polite" style={styles.seasonProgress}>
            Simulating · {seasonReplayProgress.completedDates} dates settled · last {displayDate(seasonReplayProgress.lastSettledDate)}
          </Text>
        ) : null}
      </View>

      {confirmation && canSettleNextDay ? (
        <Modal
          animationType="fade"
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
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  copy: { flex: 1, minWidth: 0 },
  label: { color: colors.gold, fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  date: { color: colors.text, fontSize: 12, fontWeight: '800', marginTop: 4 },
  nextDate: { color: colors.muted, fontSize: 11, fontWeight: '700', marginTop: 2 },
  progress: { color: colors.muted, fontSize: 10, marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  advanceActions: { gap: 6 },
  refreshButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.surfaceRaised,
  },
  refreshButtonDisabled: { opacity: 0.55 },
  refreshButtonText: { color: colors.text, fontSize: 20, fontWeight: '800' },
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
  seasonButton: {
    minHeight: 44,
    minWidth: 106,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: 8,
    paddingHorizontal: 10,
    backgroundColor: colors.surfaceRaised,
  },
  seasonButtonDisabled: { borderColor: colors.border, opacity: 0.55 },
  seasonButtonText: { color: colors.gold, fontSize: 9, fontWeight: '900' },
  seasonProgress: {
    width: '100%',
    color: colors.gold,
    fontSize: 10,
    fontWeight: '800',
    textAlign: 'right',
  },
  buttonPressed: { opacity: 0.72 },
  buttonText: { color: colors.background, fontSize: 11, fontWeight: '900' },
  buttonTextDisabled: { color: colors.muted },
  modalBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'rgba(5, 10, 18, 0.76)',
  },
  modal: {
    width: '100%',
    maxWidth: 420,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 20,
    backgroundColor: colors.surface,
  },
  modalTitle: { color: colors.text, fontSize: 20, fontWeight: '900' },
  modalBody: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 10 },
  modalActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 20,
  },
  modalButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 14,
  },
  modalConfirmButton: {
    borderColor: colors.gold,
    backgroundColor: colors.gold,
  },
  modalCancelText: { color: colors.text, fontSize: 11, fontWeight: '900' },
  modalConfirmText: { color: colors.background, fontSize: 11, fontWeight: '900' },
});
