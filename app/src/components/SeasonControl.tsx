import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useReducedMotion } from '../hooks/useReducedMotion';
import { usePortfolio } from '../state/PortfolioContext';
import { Button } from '../ui/primitives';
import { colors, fonts, labelStyle, numeric, radius, space, type, weight } from '../theme';

function displayDate(value: string | null): string {
  if (!value) return 'Season complete';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}

/**
 * Admin strip. It sits above every screen, so it reads as a status bar — small
 * labelled values on a rule — rather than a panel competing with the content.
 */
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
        <View
          accessible
          accessibilityLabel={`Replay status. Last settled ${latestSettledDate ? displayDate(latestSettledDate) : 'not started'}. Next ${displayDate(nextGameDate)}. ${settledGameDateCount} game dates settled.`}
          style={styles.copy}
        >
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>LAST SETTLED</Text>
            <Text numberOfLines={1} style={styles.fieldValue}>
              {latestSettledDate ? displayDate(latestSettledDate) : 'Not started'}
            </Text>
          </View>
          <View style={styles.fieldDivider} />
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>NEXT ·</Text>
            <Text numberOfLines={1} style={styles.fieldValueMuted}>{displayDate(nextGameDate)}</Text>
          </View>
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
              <Button
                accessibilityLabel="Settle the next historical game date"
                compact
                disabled={disabled}
                label={isSettling ? 'SETTLING' : 'NEXT DAY'}
                onPress={() => setConfirmation('day')}
                tone="primary"
              />
              <Button
                accessibilityLabel="Settle every remaining historical game date"
                compact
                disabled={disabled}
                label={isSettlingSeason ? 'SIMULATING' : 'SIMULATE SEASON'}
                onPress={() => setConfirmation('season')}
                tone="secondary"
              />
            </View>
          ) : null}
        </View>

        {seasonReplayProgress ? (
          <Text accessibilityLiveRegion="polite" numberOfLines={2} style={styles.seasonProgress}>
            Simulating · {seasonReplayProgress.completedDates} dates settled · last {displayDate(seasonReplayProgress.lastSettledDate)}
          </Text>
        ) : null}
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
              <Text style={styles.modalEyebrow}>SHARED REPLAY</Text>
              <Text accessibilityRole="header" style={styles.modalTitle}>
                {confirmation === 'day' ? 'Advance the shared replay?' : 'Simulate the rest of the season?'}
              </Text>
              <Text style={styles.modalBody}>
                {confirmation === 'day'
                  ? `This settles ${displayDate(nextGameDate)} for every play-tester. It cannot be undone.`
                  : 'This settles every remaining 2025-26 game date for every play-tester. Completed dates are saved, so an interrupted run can be resumed. It cannot be undone.'}
              </Text>
              <View style={styles.modalActions}>
                <Button
                  accessibilityLabel="Cancel replay simulation"
                  label="CANCEL"
                  onPress={() => setConfirmation(null)}
                  tone="ghost"
                />
                <Button
                  accessibilityLabel={confirmation === 'day' ? 'Confirm replay advancement' : 'Confirm full season simulation'}
                  label={confirmation === 'day' ? 'SETTLE NEXT DAY' : 'SIMULATE SEASON'}
                  onPress={() => void (confirmation === 'day' ? confirmAdvance() : confirmSeason())}
                  tone="primary"
                />
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
    flexWrap: 'wrap',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    backgroundColor: colors.background,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  copy: { flex: 1, minWidth: 150, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  field: { minWidth: 0, flexShrink: 1 },
  fieldDivider: { width: 1, height: 22, backgroundColor: colors.border },
  fieldLabel: { ...labelStyle, letterSpacing: 0.8 },
  fieldValue: {
    ...numeric,
    color: colors.text,
    fontSize: type.body,
    fontWeight: weight.heavy,
    marginTop: 1,
  },
  fieldValueMuted: {
    ...numeric,
    color: colors.muted,
    fontSize: type.body,
    fontWeight: weight.bold,
    marginTop: 1,
  },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm, flexShrink: 1 },
  // Wraps so enlarged button text stacks instead of clipping.
  advanceActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, flexShrink: 1 },
  refreshButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  refreshButtonDisabled: { opacity: 0.5 },
  refreshButtonText: { color: colors.muted, fontSize: 16, fontWeight: '800' },
  buttonPressed: { opacity: 0.7 },
  buttonTextDisabled: { color: colors.faint },
  seasonProgress: { ...labelStyle, color: colors.gold, width: '100%' },

  modalBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
    backgroundColor: 'rgba(9, 12, 18, 0.82)',
  },
  modal: {
    width: '100%',
    maxWidth: 420,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    padding: space.lg,
    backgroundColor: colors.surfaceHigh,
  },
  modalEyebrow: { ...labelStyle, color: colors.cyan, marginBottom: space.xs },
  modalTitle: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 19,
    fontWeight: weight.black,
    },
  modalBody: {
    color: colors.muted,
    fontFamily: fonts.body,
    fontSize: type.body,
    lineHeight: 20,
    marginTop: space.sm,
  },
  modalActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: space.sm,
    marginTop: space.lg,
  },
});
