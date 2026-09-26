import { Platform } from 'react-native';

/**
 * Spreadable prop bags that tag interactive surfaces for the global web
 * stylesheet. react-native-web's class names are atomic and unstable, so CSS
 * has nothing reliable to select — the dataSet prop is the one typed way to
 * put a real data-* attribute on the rendered element (see
 * src/web/globalStyles.ts, which keys its hover treatments off these).
 *
 * Native has no stylesheet to answer the markers, so it gets an empty bag.
 */
type DomMarker = { dataSet?: { [attribute: string]: string } };

/** Rows that should answer the pointer: `[data-row]` hover background. */
export const rowMarker: DomMarker =
  Platform.OS === 'web' ? { dataSet: { row: 'list' } } : {};

/** Player cards that lift toward the cursor: `[data-card="player"]`. */
export const cardMarker: DomMarker =
  Platform.OS === 'web' ? { dataSet: { card: 'player' } } : {};

/**
 * The Roster's season result heading ("Your final result"): the practice
 * controls bring it into view and focus it when a season ends by the
 * player's own press (walk 10 T2-02), by this id, not by its words.
 */
export const SEASON_RESULT_HEADING_ID = 'season-result-heading';
