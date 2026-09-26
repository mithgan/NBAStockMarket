import { Modal, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type {
  PerGameMarketPlayer,
  PerGamePosition,
  PerGamePositionSide,
  PerGameSettledResult,
} from '../api/contracts';
import type { TrendPoint } from '../data/trendPresentation';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useWatchlist } from '../state/watchlist';
import { colors, radius } from '../theme';
import { useSheetHistory } from '../web/appHistory';
import { PerGamePlayerProfile } from './PerGamePlayerProfile';

/** Desktop opens the profile as a panel on the right; below this it is a sheet. */
const PANEL_MIN_WIDTH = 1024;
const PANEL_WIDTH = 600;
const SHEET_MAX_WIDTH = 640;
/** Dimmed screen left above the phone sheet: a real target for closing by tap. */
const SHEET_TOP_GAP = 44;

/**
 * The per-game player profile, over whichever screen opened it. A full-height
 * sheet on a phone (with a band of dimmed screen above it that closes it); a
 * panel down the right-hand side on desktop, so the list behind it keeps its
 * place. Closes from its own control, the scrim, Escape or the back gesture.
 *
 * Optional props (the Roster screen passes none of them):
 * - `side`: the side to read him from when you do not hold him, i.e. the
 *   market tab he was opened from. A held player reads from his position.
 * - `watching` / `onToggleWatch`: a screen that already holds the watchlist
 *   (the market, whose Watching filter must update the moment you star
 *   someone) shares its state; without them the sheet keeps its own.
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
  side,
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
  side?: PerGamePositionSide;
  watching?: boolean;
  onToggleWatch?: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const ownWatchlist = useWatchlist();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Back (the browser button or a phone's back gesture) closes the profile,
  // not the app; the screen behind it is inert while it is open.
  useSheetHistory(visible && player !== null, onClose);
  if (!player) return null;
  const panel = width >= PANEL_MIN_WIDTH;
  const sheetWidth = Math.min(width, SHEET_MAX_WIDTH);
  const playerId = player.playerId;

  return (
    <Modal
      // The dialog is named for the player: "Nikola Jokic, dialog".
      accessibilityLabel={player.name}
      animationType={reducedMotion ? 'none' : 'fade'}
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      {/* The scrim closes on a tap, but it is a plain view on the responder
          system, not a control: react-native-web's modal focus trap would
          otherwise focus it first. Keyboard and screen-reader users close with
          the profile's own "Close player profile" button or Escape. */}
      <View onResponderRelease={onClose} onStartShouldSetResponder={() => true} style={styles.scrim} />
      <View
        style={[
          styles.sheet,
          panel
            ? styles.panel
            : [styles.phoneSheet, { top: insets.top + SHEET_TOP_GAP, width: sheetWidth, left: (width - sheetWidth) / 2 }],
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
          side={side}
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
