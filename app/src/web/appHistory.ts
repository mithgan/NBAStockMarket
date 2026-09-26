import { useEffect, useRef } from 'react';

import { settleTaps } from './tapSettle';

/**
 * Browser history for the app's own places, so the Back button (and the
 * phone's back gesture) does what a player expects: close the sheet that is
 * open, then step back through the tabs, and only then leave the app.
 *
 * Sheets push one history entry while they are open. Pressing Back pops it and
 * closes the sheet; closing the sheet any other way (Done, Escape, tapping
 * outside) pops the entry for it so history stays in step. While any sheet is
 * open, the app behind it is made inert so screen readers and the keyboard
 * cannot wander into it.
 */

const isWeb = typeof window !== 'undefined' && typeof document !== 'undefined';

let openSheets = 0;
let nextSheetId = 1;

/** The element the app renders into; sheets portal outside it. */
function appRoot(): HTMLElement | null {
  return isWeb ? document.getElementById('app-root') : null;
}

function setBackgroundInert(inert: boolean) {
  const root = appRoot();
  if (!root) return;
  if (inert) {
    root.setAttribute('inert', '');
    root.setAttribute('aria-hidden', 'true');
  } else {
    root.removeAttribute('inert');
    root.removeAttribute('aria-hidden');
  }
}

/**
 * Wire a sheet (Modal) into history and background inertness.
 * `onClose` is the sheet's normal close handler.
 */
export function useSheetHistory(visible: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!isWeb || !visible) return undefined;
    const id = nextSheetId++;
    let poppedByBack = false;
    // Whatever opened the sheet (a row, a button) gets keyboard focus back
    // when it closes, however it closes; otherwise focus falls to the top of
    // the page and a keyboard user starts the whole Tab trip again.
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null;
    openSheets += 1;
    setBackgroundInert(true);
    window.history.pushState({ ...(window.history.state ?? {}), sheet: id }, '');
    const onPop = () => {
      // Back left this sheet's entry: close the sheet.
      if ((window.history.state as { sheet?: number } | null)?.sheet !== id) {
        poppedByBack = true;
        onCloseRef.current();
      }
    };
    window.addEventListener('popstate', onPop);
    return () => {
      // The tap that closed the sheet (on the scrim) must not also press what
      // was under the scrim, such as +1 night in a landscape phone's frame.
      settleTaps(450);
      window.removeEventListener('popstate', onPop);
      openSheets = Math.max(0, openSheets - 1);
      if (openSheets === 0) setBackgroundInert(false);
      // Closed by Done / Escape / scrim: remove the entry we pushed.
      if (!poppedByBack && (window.history.state as { sheet?: number } | null)?.sheet === id) {
        window.history.back();
      }
      // After the sheet has left the page, and only if nothing else has
      // taken focus (a dialog may move it on purpose).
      setTimeout(() => {
        const current = document.activeElement;
        const lost = !current || current === document.body || !current.isConnected;
        if (lost && opener?.isConnected) opener.focus({ preventScroll: true });
      }, 60);
    };
  }, [visible]);
}

/** Whether a sheet is open right now (the tab history ignores Back while one is). */
export function sheetIsOpen(): boolean {
  return openSheets > 0;
}
