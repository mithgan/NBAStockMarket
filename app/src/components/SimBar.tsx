import { useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import {
  advanceMockNights,
  isMockActive,
  mockSeasonStart,
} from '../api/mockPerGameClient';
import { chromeLayout, practiceProgress } from '../data/chromeView';
import { usePerGame } from '../state/PerGameContext';
import { colors, space } from '../theme';
import { Button } from '../ui/kit';

/** How long the restart button waits for its confirming second tap. */
const RESET_CONFIRM_MS = 4000;

/**
 * The practice clock controls: +1 night and +1 week (the point of practice,
 * so they carry the gold), then restart and exit, quiet. On a phone they are
 * the practice bar's one row; on a desktop the status row mounts them beside
 * its facts so the whole frame is a single line (see chromeLayout).
 */
export function PracticeControls({ inline = false }: { inline?: boolean }) {
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
    const timer = setTimeout(() => setConfirmingReset(false), RESET_CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirmingReset]);
  if (!bootstrap || !isMockActive() || typeof window === 'undefined') return null;

  const disabled = !isGameplayReady || isRefreshing || pendingActions.size > 0;
  const progress = practiceProgress(mockSeasonStart(), bootstrap.game.lastSettledDate);
  const advanceDisabled = disabled || progress.complete;
  const advance = (nights: number) => {
    advanceMockNights(nights);
    refreshData();
  };

  return (
    <View style={[styles.controls, inline && styles.controlsInline]}>
      <View style={styles.group}>
        <Button
          accessibilityLabel="Advance one night in practice"
          disabled={advanceDisabled}
          label="+1 night"
          onPress={() => advance(1)}
          style={styles.advance}
          textStyle={styles.advanceText}
          variant="secondary"
        />
        <Button
          accessibilityLabel="Advance one week in practice"
          disabled={advanceDisabled}
          label="+1 week"
          onPress={() => advance(7)}
          style={styles.advance}
          textStyle={styles.advanceText}
          variant="secondary"
        />
      </View>
      <View style={[styles.group, styles.secondary, inline && styles.secondaryInline]}>
        <Button
          accessibilityLabel={confirmingReset ? 'Confirm restarting practice' : 'Restart practice'}
          disabled={disabled}
          label={confirmingReset ? 'Confirm' : 'Restart'}
          onPress={() => {
            if (confirmingReset) {
              setConfirmingReset(false);
              // Restart the in-memory client and its provider together. An
              // ordinary refresh must still reject older account snapshots.
              window.location.reload();
            } else {
              setConfirmingReset(true);
            }
          }}
          style={[styles.quiet, confirmingReset && styles.armed]}
          textStyle={confirmingReset ? styles.armedText : undefined}
          variant="quiet"
        />
        <Button
          accessibilityLabel="Leave practice and return to the live market"
          label="Exit"
          onPress={() => {
            window.location.search = '';
          }}
          style={styles.quiet}
          variant="quiet"
        />
      </View>
    </View>
  );
}

/**
 * The practice bar, directly under the status row. The date, the day count and
 * last night's result live in the status row, so nothing here repeats them.
 * The thin rule along the bottom is the season's progress and the frame's
 * bottom edge. Outside practice this bar renders nothing: the status row
 * carries the one "Practice" entry instead.
 */
export function SimBar() {
  const { fontScale, width } = useWindowDimensions();
  const { bootstrap } = usePerGame();
  if (!bootstrap || !isMockActive()) return null;

  const layout = chromeLayout(width, fontScale);
  const progress = practiceProgress(mockSeasonStart(), bootstrap.game.lastSettledDate);

  return (
    <View nativeID="practice-bar" style={styles.bar}>
      {layout.merged ? null : <PracticeControls />}
      <View
        accessibilityLabel={progress.accessibilityLabel}
        accessibilityRole="progressbar"
        aria-valuemax={progress.total}
        aria-valuemin={0}
        aria-valuenow={progress.day}
        style={styles.track}
      >
        <View style={[styles.fill, { width: `${Math.max(progress.fraction * 100, 0.5)}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.chromeSoft,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    // Enlarged text and very narrow phones wrap onto a second row.
    flexWrap: 'wrap',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: 2,
    paddingBottom: space.xs,
  },
  controlsInline: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    marginRight: space.sm,
  },
  group: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  secondary: {
    marginLeft: 'auto',
    gap: 0,
  },
  secondaryInline: {
    marginLeft: 0,
  },
  // A tonal gold: the practice clock is the bar's point, but it is not a trade,
  // so it does not take the solid gold the money actions use.
  advance: {
    minWidth: 76,
    paddingHorizontal: space.md,
    backgroundColor: colors.goldSoft,
    borderColor: colors.goldLine,
  },
  advanceText: {
    color: colors.goldInk,
  },
  quiet: {
    paddingHorizontal: space.sm + 2,
  },
  armed: {
    borderColor: colors.red,
  },
  armedText: {
    color: colors.red,
  },
  track: {
    height: 3,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: colors.gold,
  },
});
