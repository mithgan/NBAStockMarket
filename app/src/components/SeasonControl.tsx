import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useReducedMotion } from '../hooks/useReducedMotion';
import { usePortfolio } from '../state/PortfolioContext';
import { SEASON_TOTAL_DAYS, seasonDayNumber, seasonProgress } from '../state/simDates';
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
 * Advancing the replay clock is shared across every account on the server, so
 * every advance path routes through an explicit confirmation.
 */
export function SeasonControl() {
  const [confirmation, setConfirmation] = useState<'day' | null>(null);
  const reducedMotion = useReducedMotion();
  const {
    advanceDay,
    canAdvanceDay,
    isGameplayReady,
    isRefreshing,
    latestSettledDate,
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
  const day = seasonDayNumber(nextGameDate);
  const progress = seasonProgress(nextGameDate);

  const confirmAdvance = async () => {
    setConfirmation(null);
    await advanceDay();
  };

  return (
    <>
      <View style={styles.container}>
        <View
          accessible
          accessibilityLabel={`Replay status. Last settled ${latestSettledDate ? displayDate(latestSettledDate) : 'not started'}. Next ${displayDate(nextGameDate)}. Day ${day} of ${SEASON_TOTAL_DAYS}. ${settledGameDateCount} game dates settled.`}
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
          <View style={styles.fieldDivider} />
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>DAY</Text>
            <Text numberOfLines={1} style={styles.fieldValueMuted}>
              {day} / {SEASON_TOTAL_DAYS}
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          <Pressable
            accessibilityLabel="Refresh market data"
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => {
              refreshData();
            }}
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
            </View>
          ) : null}
        </View>

        <View
          accessibilityLabel={`Season progress: day ${day} of ${SEASON_TOTAL_DAYS}`}
          style={styles.track}
        >
          <View style={[styles.fill, { width: `${Math.max(100 * progress, 0.5)}%` }]} />
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
              <Text style={styles.modalEyebrow}>SHARED REPLAY</Text>
              <Text accessibilityRole="header" style={styles.modalTitle}>
                Advance the shared replay?
              </Text>
              <Text style={styles.modalBody}>
                {`This settles ${displayDate(nextGameDate)} for every play-tester. It cannot be undone.`}
              </Text>
              <View style={styles.modalActions}>
                <Button
                  accessibilityLabel="Cancel replay simulation"
                  label="CANCEL"
                  onPress={() => setConfirmation(null)}
                  tone="ghost"
                />
                <Button
                  accessibilityLabel="Confirm replay advancement"
                  label="SETTLE NEXT DAY"
                  onPress={confirmAdvance}
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
    // The season strip is the softest chrome step, one shade off the page.
    backgroundColor: colors.chromeSoft,
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
  track: {
    width: '100%',
    height: 5,
    borderRadius: 4,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 4, backgroundColor: colors.gold },

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
