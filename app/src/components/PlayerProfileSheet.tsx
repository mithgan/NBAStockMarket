import { useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type {
  PerGameMarketPlayer,
  PerGamePosition,
  PerGamePositionSide,
  PerGameSettledResult,
} from '../api/contracts';
import { chromeFolded } from '../data/chromeView';
import { panelDockRight, type ProfileMetric, type ProfileRange } from '../data/profileView';
import type { TrendPoint } from '../data/trendPresentation';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useWatchlist } from '../state/watchlist';
import { colors, radius } from '../theme';
import { useSheetHistory } from '../web/appHistory';
import { measuredSheetTop } from './chrome/sheetTop';
import { PerGamePlayerProfile } from './PerGamePlayerProfile';
import { unlessSettling } from '../web/tapSettle';

/** Desktop opens the profile as a panel on the right; below this it is a sheet. */
const PANEL_MIN_WIDTH = 1024;
const PANEL_WIDTH = 600;
const SHEET_MAX_WIDTH = 640;
/**
 * Dimmed screen left above the phone sheet, at least: a real target for
 * closing by tap. Where the frame is drawn the sheet starts at its status row.
 */
const SHEET_TOP_GAP = 44;

/**
 * Keyboard focus goes back to whatever opened the profile once it closes
 * (walk-2 T2-08, T3-06). Closing steps Back out of the sheet's history entry,
 * and the frame answers that Back by focusing the current tab; this runs
 * after it and returns focus to the row you opened him from. It steps in only
 * when focus sits on a tab or nowhere, and only while the opener is still on
 * the page (not after "Choose who to drop" has left for the Roster).
 */
function useReturnFocus(open: boolean) {
  useEffect(() => {
    if (!open || typeof document === 'undefined' || typeof window === 'undefined') return undefined;
    const active = document.activeElement;
    const opener = active instanceof HTMLElement && active !== document.body ? active : null;
    if (!opener) return undefined;
    return () => {
      let settled = false;
      const restore = () => {
        if (settled) return;
        settled = true;
        window.removeEventListener('popstate', afterBack);
        const now = document.activeElement;
        const stray = !now || now === document.body || !now.isConnected || now.getAttribute('role') === 'tab';
        if (stray && opener.isConnected) opener.focus({ preventScroll: true });
      };
      // The frame focuses its tab in a zero-delay timer after the popstate.
      const afterBack = () => setTimeout(restore, 30);
      window.addEventListener('popstate', afterBack);
      setTimeout(restore, 400);
    };
  }, [open]);
}

/**
 * The per-game player profile, over whichever screen opened it. A sheet on a
 * phone, as tall as its content up to a band of dimmed screen above it that
 * closes it; a panel down the right-hand side on desktop, so the list behind
 * it keeps its place. Closes from its own control, the scrim, Escape or the back gesture.
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
  initialView,
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
  /** Opens in this chart view and range: Results' "Back to <player>" (walk 9 T1-17). */
  initialView?: { metric: ProfileMetric; range: ProfileRange | null };
}) {
  const reducedMotion = useReducedMotion();
  const ownWatchlist = useWatchlist();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Back (the browser button or a phone's back gesture) closes the profile,
  // not the app; the screen behind it is inert while it is open.
  useSheetHistory(visible && player !== null, onClose);
  useReturnFocus(visible && player !== null);
  // A phone sheet is as tall as what it holds (walk 14 T1-03: before his
  // first game the full-height sheet was 40% blank cream, which read as
  // something failed to load): it opens sized to its content, up to the
  // band of dimmed screen, and its top then stays put while it is open, so a
  // move that changes a line never shifts the buttons under your finger;
  // more content scrolls inside it. A new player or window size fits again.
  const [fitted, setFitted] = useState<{ key: string; top: number } | null>(null);
  useEffect(() => {
    if (!visible) setFitted(null);
  }, [visible]);
  // A tall sheet starts where Rules and Settings do, at the status row under
  // the brand bar (walk 15 T1-09: at 44px its rounded edge sliced the bottom
  // of the dimmed Settings button). Read as it opens (the frame is drawn
  // behind it) and kept while it is open, so a notice that grows the bar
  // never moves the sheet under your finger; a new player or size reads again.
  const openKey = `${player?.playerId ?? ''}|${width}|${height}`;
  const frameTop = useRef<{ key: string; top: number | null } | null>(null);
  if (!visible || !player) frameTop.current = null;
  else if (frameTop.current?.key !== openKey) frameTop.current = { key: openKey, top: measuredSheetTop() };
  if (!player) return null;
  const panel = width >= PANEL_MIN_WIDTH;
  // Docked to the app column's right edge, not the window's (walk 8 T2-03).
  const dockRight = panel ? panelDockRight(width) : 0;
  const sheetWidth = Math.min(width, SHEET_MAX_WIDTH);
  // A short, wide window (a phone on its side, a laptop at 150%) folds the
  // frame into one row of live-looking controls (+1 night, +1 week), and the
  // gap above the sheet showed them, dimmed but still read as pressable,
  // where a tap only closed the profile (walk 12 T1-08). There the sheet
  // covers that row, from the top: the dimmed sides still close it on a tap.
  const coverFrame = !panel && width > sheetWidth && chromeFolded(height, width);
  const playerId = player.playerId;
  const fits = !panel && !coverFrame;
  const topGap = Math.max(insets.top + SHEET_TOP_GAP, frameTop.current?.top ?? 0);
  const fitKey = `${playerId}|${width}|${height}|${topGap}`;
  const fittedTop = fitted && fitted.key === fitKey ? fitted.top : null;
  const onSheetLayout = (event: LayoutChangeEvent) => {
    if (!fits || fittedTop !== null) return;
    const sheetHeight = event.nativeEvent.layout.height;
    if (sheetHeight > 0) setFitted({ key: fitKey, top: Math.max(topGap, Math.floor(height - sheetHeight)) });
  };

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
      <View onResponderRelease={unlessSettling(onClose)} onStartShouldSetResponder={() => true} style={styles.scrim} />
      <View
        onLayout={fits ? onSheetLayout : undefined}
        style={[
          styles.sheet,
          panel
            ? [styles.panel, dockRight > 0 && { right: dockRight, borderRightWidth: 1 }]
            : [styles.phoneSheet, {
                width: sheetWidth,
                left: (width - sheetWidth) / 2,
              }, coverFrame
                ? [{ top: insets.top }, styles.fullHeight]
                : fittedTop === null ? { maxHeight: height - topGap } : { top: fittedTop }],
        ]}
      >
        <PerGamePlayerProfile
          dividendRate={dividendRate}
          initialView={initialView}
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
  // From the window's top: square corners, like the panel's.
  fullHeight: {
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderTopWidth: 0,
  },
  panel: {
    top: 0,
    right: 0,
    width: PANEL_WIDTH,
    borderLeftWidth: 1,
  },
});
