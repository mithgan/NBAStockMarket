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
  const [isConfirmingAdvance, setIsConfirmingAdvance] = useState(false);
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
  if (!state) return null;
  const disabled = !isGameplayReady || isRefreshing || pendingActions.size > 0;
  const canSettleNextDay = canAdvanceDay && nextGameDate !== null;
  const isSettling = pendingActions.has('advance');

  const confirmAdvance = async () => {
    setIsConfirmingAdvance(false);
    await advanceDay();
  };

  return (
    <>
      <View style={styles.container}>
        <View style={styles.copy}>
          <Text style={styles.label}>2025-26 SERVER REPLAY</Text>
          <Text numberOfLines={1} style={styles.date}>{displayDate(nextGameDate)}</Text>
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
            <Pressable
              accessibilityLabel="Settle the next historical game date"
              accessibilityRole="button"
              accessibilityState={{ disabled }}
              disabled={disabled}
              onPress={() => setIsConfirmingAdvance(true)}
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
          ) : null}
        </View>
      </View>

      <Modal
        animationType="fade"
        onRequestClose={() => setIsConfirmingAdvance(false)}
        transparent
        visible={isConfirmingAdvance && canSettleNextDay}
      >
        <View accessibilityViewIsModal style={styles.modalBackdrop}>
          <View style={styles.modal}>
            <Text accessibilityRole="header" style={styles.modalTitle}>
              Advance the shared replay?
            </Text>
            <Text style={styles.modalBody}>
              This settles {displayDate(nextGameDate)} for every play-tester. It cannot be undone.
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                accessibilityLabel="Cancel replay advancement"
                accessibilityRole="button"
                onPress={() => setIsConfirmingAdvance(false)}
                style={({ pressed }) => [styles.modalButton, pressed && styles.buttonPressed]}
              >
                <Text style={styles.modalCancelText}>CANCEL</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Confirm replay advancement"
                accessibilityRole="button"
                onPress={() => void confirmAdvance()}
                style={({ pressed }) => [
                  styles.modalButton,
                  styles.modalConfirmButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.modalConfirmText}>SETTLE NEXT DAY</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
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
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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
