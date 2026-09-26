import { Platform } from 'react-native';

import { floatTopFor, sheetTopFor } from '../../data/chromeView';

/**
 * The top of the status row on the page, as the Rules and Settings sheets'
 * top edge (chromeView.sheetTopFor, walk 4 T1-01). Read as a sheet renders:
 * it opens over a frame already drawn, and a resize re-renders it. null off
 * the web or before the frame exists, so the sheets keep their own margins.
 */
export function measuredSheetTop(): number | null {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return null;
  const strip = document.getElementById('status-strip');
  return strip ? sheetTopFor(strip.getBoundingClientRect().top) : null;
}

/**
 * A wide window's floating Rules or Settings panel starts under the frame
 * (the status row, and the practice bar's edge under it) with a gap, so no
 * edge of it cuts through the frame (chromeView.floatTopFor, walk 5 T2-05).
 */
export function measuredFloatTop(): number | null {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return null;
  const bottoms = ['status-strip', 'practice-bar']
    .map((id) => document.getElementById(id)?.getBoundingClientRect().bottom)
    .filter((bottom): bottom is number => typeof bottom === 'number' && Number.isFinite(bottom));
  return bottoms.length > 0 ? floatTopFor(Math.max(...bottoms)) : null;
}
