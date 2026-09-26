import { Platform } from 'react-native';

import { sheetTopFor } from '../../data/chromeView';

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
