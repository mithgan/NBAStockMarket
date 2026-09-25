import { useEffect, useRef } from 'react';

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
      window.removeEventListener('popstate', onPop);
      openSheets = Math.max(0, openSheets - 1);
      if (openSheets === 0) setBackgroundInert(false);
      // Closed by Done / Escape / scrim: remove the entry we pushed.
      if (!poppedByBack && (window.history.state as { sheet?: number } | null)?.sheet === id) {
        window.history.back();
      }
    };
  }, [visible]);
}

/** Whether a sheet is open right now (the tab history ignores Back while one is). */
export function sheetIsOpen(): boolean {
  return openSheets > 0;
}
