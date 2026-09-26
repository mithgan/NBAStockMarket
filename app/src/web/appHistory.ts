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
/** The last control on the page (not in a sheet) that opened a sheet. */
let lastPageOpener: HTMLElement | null = null;
const sheetListeners = new Set<() => void>();

function sheetsChanged() {
  for (const listener of sheetListeners) listener();
}

/** Subscribe to sheets opening and closing (for useSyncExternalStore). */
export function subscribeSheets(listener: () => void): () => void {
  sheetListeners.add(listener);
  return () => sheetListeners.delete(listener);
}

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
    const active = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null;
    // A sheet opened from the page remembers its opener. One that opens with
    // focus nowhere, or inside another sheet (Settings coming back after the
    // Rules it opened; react-native-web's modal may already have taken focus
    // inside itself), falls back to the last opener on the page, so closing
    // it returns focus there instead of to the top (walk 4 T2-15, T4-06).
    const onPage = active !== null && appRoot()?.contains(active) === true;
    if (onPage) lastPageOpener = active;
    const opener = onPage ? active : (lastPageOpener?.isConnected ? lastPageOpener : null);
    openSheets += 1;
    setBackgroundInert(true);
    sheetsChanged();
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
      sheetsChanged();
      // Closed by Done / Escape / scrim: remove the entry we pushed.
      if (!poppedByBack && (window.history.state as { sheet?: number } | null)?.sheet === id) {
        window.history.back();
      }
      // After the sheet has left the page, and only if nothing else has
      // taken focus (a dialog may move it on purpose).
      // A sheet that animates out keeps focus for a moment, then drops it to
      // the page when it goes: look again until it has gone (about half a
      // second), and stop if focus has moved on to something else.
      const restore = (attempt: number) => {
        const current = document.activeElement;
        const lost = !current || current === document.body || !current.isConnected;
        if (lost) {
          if (opener?.isConnected) opener.focus({ preventScroll: true });
          return;
        }
        if (!appRoot()?.contains(current) && attempt < 6) setTimeout(() => restore(attempt + 1), 80);
      };
      setTimeout(() => restore(0), 60);
    };
  }, [visible]);
}

// A question that closed on the page leaves its entry for a moment: when the
// same commit opens another question (Drop on the next row while one is
// open), the new question takes the entry over instead of pushing a second
// one that the old question's Back would then pop, folding the new question
// the moment it opened.
let pendingQuestionBack: ReturnType<typeof setTimeout> | null = null;

/**
 * An inline question (a Drop or Close confirm strip) in browser history: the
 * first Back folds the question, as it closes a sheet, instead of leaving the
 * tab under it (walk 3 T4-03). Unlike a sheet it leaves the page usable, and
 * `onFold` is the question's own cancel (it puts focus back on the row).
 */
export function useBackFolds(visible: boolean, onFold: () => void): void {
  const onFoldRef = useRef(onFold);
  onFoldRef.current = onFold;
  useEffect(() => {
    if (!isWeb || !visible) return undefined;
    const id = nextSheetId++;
    let poppedByBack = false;
    const current = window.history.state as { question?: number } | null;
    if (pendingQuestionBack !== null && current?.question !== undefined) {
      clearTimeout(pendingQuestionBack);
      pendingQuestionBack = null;
      window.history.replaceState({ ...current, question: id }, '');
    } else {
      window.history.pushState({ ...(current ?? {}), question: id }, '');
    }
    const onPop = () => {
      if ((window.history.state as { question?: number } | null)?.question !== id) {
        poppedByBack = true;
        onFoldRef.current();
      }
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // Answered or cancelled on the page: remove the entry we pushed, unless
      // another question takes it over first.
      if (!poppedByBack && (window.history.state as { question?: number } | null)?.question === id) {
        if (pendingQuestionBack !== null) clearTimeout(pendingQuestionBack);
        pendingQuestionBack = setTimeout(() => {
          pendingQuestionBack = null;
          if ((window.history.state as { question?: number } | null)?.question === id) window.history.back();
        }, 0);
      }
    };
  }, [visible]);
}

/** Whether a sheet is open right now (the tab history ignores Back while one is). */
export function sheetIsOpen(): boolean {
  return openSheets > 0;
}
