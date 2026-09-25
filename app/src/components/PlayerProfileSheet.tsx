import { Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type {
  PerGameMarketPlayer,
  PerGamePosition,
  PerGameSettledResult,
} from '../api/contracts';
import { currentResults } from '../data/perGameMetrics';
import type { TrendPoint } from '../data/trendPresentation';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useWatchlist } from '../state/watchlist';
import { colors, radius } from '../theme';
import { PerGamePlayerProfile } from './PerGamePlayerProfile';

/** Desktop opens the profile as a panel on the right; below this it is a sheet. */
const PANEL_MIN_WIDTH = 1024;
const PANEL_WIDTH = 600;
const SHEET_MAX_WIDTH = 640;

/**
 * Per-game trend points derived from the nights the account actually settled:
 * np is what he produced, expected is the locked cost in net points, and the
 * payout is his dividend minus that locked cost (long perspective either way).
 * A corrected game counts once, at its latest revision.
 */
export function trendPointsFromResults(
  results: PerGameSettledResult[],
  dividendRate: number,
): TrendPoint[] {
  return currentResults(results)
    .filter((result) => result.status === 'settled' && result.dividendDollars !== null)
    .sort((left, right) => left.gameDate.localeCompare(right.gameDate))
    .map((result) => ({
      date: result.gameDate,
      np: Math.round(((result.dividendDollars ?? 0) / dividendRate) * 10) / 10,
      expected_np: Math.round((result.lockedGameCost / dividendRate) * 10) / 10,
      dividend_per_holder: (result.dividendDollars ?? 0) - result.lockedGameCost,
    }));
}

/**
 * The per-game player profile, over whichever screen opened it. A full-height
 * sheet on a phone; a panel down the right-hand side on desktop, so the list
 * behind it keeps its place. Closes from its own control, the scrim, Escape
 * or the back gesture.
 *
 * `watching` / `onToggleWatch` let a screen that already holds the watchlist
 * (the market, whose Watching filter must update the moment you star someone)
 * share its state; without them the sheet keeps its own.
 */
export function PlayerProfileSheet({
  visible,
  onClose,
  player,
  position,
  results,
  dividendRate,
  latestSettledDate,
  trends,
  watching,
  onToggleWatch,
}: {
  visible: boolean;
  onClose: () => void;
  player: PerGameMarketPlayer | null;
  position: PerGamePosition | null;
  results: PerGameSettledResult[];
  dividendRate: number;
  latestSettledDate: string | null;
  trends?: TrendPoint[];
  watching?: boolean;
  onToggleWatch?: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const ownWatchlist = useWatchlist();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  if (!player) return null;
  const panel = width >= PANEL_MIN_WIDTH;
  const sheetWidth = Math.min(width, SHEET_MAX_WIDTH);
  const playerId = player.playerId;

  return (
    <Modal
      animationType={reducedMotion ? 'none' : 'fade'}
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      {/* The scrim closes on a tap but stays out of the Tab order, so keyboard
          focus lands on the profile's own close control first. */}
      <Pressable
        accessibilityLabel="Close player profile"
        accessibilityRole="button"
        tabIndex={-1}
        onPress={onClose}
        style={styles.scrim}
      />
      <View
        style={[
          styles.sheet,
          panel
            ? styles.panel
            : [styles.phoneSheet, { top: insets.top + 8, width: sheetWidth, left: (width - sheetWidth) / 2 }],
        ]}
      >
        <PerGamePlayerProfile
          dividendRate={dividendRate}
          latestSettledDate={latestSettledDate}
          onClose={onClose}
          onToggleWatch={onToggleWatch ?? (() => ownWatchlist.toggle(playerId))}
          player={player}
          position={position}
          results={results}
          trends={trends}
          watching={watching ?? ownWatchlist.isWatched(playerId)}
          wide={panel}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    backgroundColor: colors.background,
    borderColor: colors.border,
  },
  phoneSheet: {
    borderWidth: 1,
    borderBottomWidth: 0,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    overflow: 'hidden',
  },
  panel: {
    top: 0,
    right: 0,
    width: PANEL_WIDTH,
    borderLeftWidth: 1,
  },
});
