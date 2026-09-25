import { useEffect, useRef, useState } from 'react';
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
import { ChromeButton } from './chrome/ChromeButton';
import { MoreIcon } from './chrome/ChromeIcons';

/** How long the restart button waits for its confirming second tap. */
const RESET_CONFIRM_MS = 4000;
/**
 * After a night is played the screen must refresh from the client. If a
 * refresh is already running (it may have read the client before this night
 * settled), try again shortly, so the screen never stays a night behind.
 */
const ADVANCE_REFRESH_ATTEMPTS = 8;
const ADVANCE_RETRY_MS = 150;
/**
 * Below this width +1 night / +1 week put the "+1" over the word: two buttons
 * and More need about 218px of row for one-line labels.
 */
const STACKED_LABEL_MAX_WIDTH = 240;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The practice clock controls: +1 night and +1 week (the point of practice,
 * so they carry the gold), then restart and exit, quiet. On a phone they are
 * the practice bar's one row; on a desktop the status row mounts them beside
 * its facts so the whole frame is a single line (see chromeLayout). On a phone
 * at high zoom, Restart and Exit move behind a More control so the row still
 * fits and the screen keeps its room.
 */
export function PracticeControls({ inline = false }: { inline?: boolean }) {
  const { fontScale, width } = useWindowDimensions();
  const {
    bootstrap,
    isGameplayReady,
    isRefreshing,
    pendingActions,
    refreshData,
  } = usePerGame();
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  // State updates land a render later; a second tap in the same frame still
  // sees the old props. The ref closes the door synchronously.
  const advancingRef = useRef(false);
  useEffect(() => {
    if (!confirmingReset) return;
    const timer = setTimeout(() => setConfirmingReset(false), RESET_CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirmingReset]);
  if (!bootstrap || !isMockActive() || typeof window === 'undefined') return null;

  const layout = chromeLayout(width, fontScale);
  const compact = layout.compact && !inline;
  const narrow = layout.narrow && !inline;
  const disabled = !isGameplayReady || isRefreshing || pendingActions.size > 0;
  const progress = practiceProgress(mockSeasonStart(), bootstrap.game.lastSettledDate);
  const advanceDisabled = disabled || advancing || progress.complete;

  // One night (or week) per tap, and never a second one before the screen has
  // caught up with the first: the client and the screen stay on the same day.
  const advance = async (nights: number) => {
    if (advancingRef.current) return;
    advancingRef.current = true;
    setAdvancing(true);
    try {
      advanceMockNights(nights);
      for (let attempt = 0; attempt < ADVANCE_REFRESH_ATTEMPTS; attempt += 1) {
        if (await refreshData()) break;
        await wait(ADVANCE_RETRY_MS);
      }
    } finally {
      advancingRef.current = false;
      setAdvancing(false);
    }
  };

  const stackLabels = compact && width < STACKED_LABEL_MAX_WIDTH;
  const advanceButtons = (
    <>
      <Button
        accessibilityLabel="Advance one night in practice"
        disabled={advanceDisabled}
        label={stackLabels ? '+1\nnight' : '+1 night'}
        onPress={() => {
          void advance(1);
        }}
        style={[styles.advance, narrow && styles.advanceNarrow, compact && styles.advanceCompact]}
        textStyle={styles.advanceText}
        variant="secondary"
      />
      <Button
        accessibilityLabel="Advance one week in practice"
        disabled={advanceDisabled}
        label={stackLabels ? '+1\nweek' : '+1 week'}
        onPress={() => {
          void advance(7);
        }}
        style={[styles.advance, narrow && styles.advanceNarrow, compact && styles.advanceCompact]}
        textStyle={styles.advanceText}
        variant="secondary"
      />
    </>
  );
  const secondaryButtons = (
    <>
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
        style={[styles.quiet, narrow && styles.quietNarrow, confirmingReset && styles.armed]}
        textStyle={confirmingReset ? styles.armedText : undefined}
        variant="quiet"
      />
      <Button
        accessibilityLabel="Leave practice and return to the live market"
        label="Exit"
        onPress={() => {
          window.location.search = '';
        }}
        style={[styles.quiet, narrow && styles.quietNarrow]}
        variant="quiet"
      />
    </>
  );

  // At the end of the season there is nothing left to advance (the status
  // row says "Season complete"), so Restart and Exit take the row themselves.
  if (compact && progress.complete) {
    return (
      <View style={[styles.controls, styles.controlsNarrow]}>
        <View style={[styles.group, styles.moreRow]}>
          {secondaryButtons}
        </View>
      </View>
    );
  }

  if (compact) {
    return (
      <View style={[styles.controls, styles.controlsNarrow]}>
        <View style={[styles.group, styles.groupFill]}>
          {advanceButtons}
          <ChromeButton
            // The name stays clear of "restart" so nothing that looks for the
            // Restart button by name can land on More instead.
            accessibilityLabel="More practice controls"
            expanded={moreOpen}
            icon={(color) => <MoreIcon color={color} />}
            label="More"
            onPress={() => setMoreOpen((open) => !open)}
            placement="stacked"
          />
        </View>
        {moreOpen ? (
          <View style={[styles.group, styles.moreRow]}>
            {secondaryButtons}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={[styles.controls, narrow && styles.controlsNarrow, inline && styles.controlsInline]}>
      <View style={[styles.group, narrow && styles.groupNarrow]}>
        {advanceButtons}
      </View>
      <View style={[styles.group, styles.secondary, inline && styles.secondaryInline]}>
        {secondaryButtons}
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
    // Enlarged text wraps onto a second row instead of truncating.
    flexWrap: 'wrap',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: 2,
    paddingBottom: space.xs,
  },
  controlsNarrow: {
    gap: 6,
    paddingHorizontal: space.md,
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
  groupNarrow: {
    gap: 6,
  },
  // Compact: +1 night and +1 week share the row with More, edge to edge.
  groupFill: {
    flexGrow: 1,
    flexBasis: '100%',
    gap: 6,
  },
  moreRow: {
    marginLeft: 'auto',
    gap: 0,
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
  advanceNarrow: {
    minWidth: 0,
    paddingHorizontal: space.sm,
  },
  advanceCompact: {
    flexGrow: 1,
    flexBasis: 0,
    paddingHorizontal: 6,
  },
  advanceText: {
    color: colors.goldInk,
    textAlign: 'center',
  },
  quiet: {
    paddingHorizontal: space.sm + 2,
  },
  quietNarrow: {
    paddingHorizontal: space.sm,
  },
  // Restart's confirm step asks for attention without the loss red: red is
  // reserved for money going down.
  armed: {
    borderColor: colors.goldLine,
  },
  armedText: {
    color: colors.goldInk,
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
