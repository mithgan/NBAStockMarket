/**
 * The practice season lives in browser memory and starts over on reload, by
 * design. These helpers keep that from happening by accident: while a season
 * has progress, the browser asks before the page is left or reloaded, and the
 * app's own Restart and Exit (which confirm first) skip that second question.
 */

import { pressedByPointer } from './tapSettle';

const isWeb = typeof window !== 'undefined';
const RESTARTED_KEY = 'nba-stock-market:practice-restarted';
// Restart and Exit load a new page. Whether the press came from the keyboard
// travels with it, so the new page moves focus for keyboard users without
// drawing a focus ring for a finger (walk 3 T1-15, T3-22).
const BY_KEYBOARD_KEY = 'nba-stock-market:arrived-by-keyboard';
// Exit was pressed in this tab: the setup screen offers the way back, where a
// first-time visitor is invited instead (walk 9 T4-06).
const LEFT_PRACTICE_KEY = 'nba-stock-market:left-practice';

function rememberHowPressed(): void {
  try {
    if (pressedByPointer()) window.sessionStorage.removeItem(BY_KEYBOARD_KEY);
    else window.sessionStorage.setItem(BY_KEYBOARD_KEY, '1');
  } catch {}
}

let hasProgress = false;
let leaving = false;
let installed = false;

function beforeUnload(event: BeforeUnloadEvent) {
  if (!hasProgress || leaving) return undefined;
  event.preventDefault();
  // Older browsers need a return value to show the prompt.
  event.returnValue = '';
  return '';
}

/** Tell the guard whether the current practice season has anything to lose. */
export function setPracticeProgress(progress: boolean): void {
  hasProgress = progress;
  if (isWeb && !installed) {
    window.addEventListener('beforeunload', beforeUnload);
    installed = true;
  }
}

const LAST_RESULT_KEY = 'nba-stock-market:last-season-result';

/** A finished practice season, for "Your seasons this visit" on Leaders. */
export interface PastSeason {
  score: number;
  /** "#1 of 5", or null when the standings did not include you. */
  rank: string | null;
  /** The season's last night (ISO day). */
  finishedOn: string;
}

// Finished seasons ride along with "Play another season" and Restart (both
// load a new page) so a player can compare this visit's seasons; a reload of
// their own starts over, like the season itself (walk 5, T2 idea NYI-1).
const PAST_KEY = 'nba-stock-market:past-seasons';
const PAST_CARRY_KEY = 'nba-stock-market:past-seasons-carry';
const PAST_KEPT = 20;

function isPastSeason(value: unknown): value is PastSeason {
  const season = value as PastSeason | null;
  return Boolean(season)
    && typeof season?.score === 'number'
    && Number.isFinite(season.score)
    && (season.rank === null || typeof season.rank === 'string')
    && typeof season.finishedOn === 'string';
}

type SessionStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * The seasons a new page was handed by "Play another season" or Restart; any
 * other load (a reload of the player's own) clears them.
 */
export function takeCarriedSeasons(store: SessionStore): PastSeason[] {
  try {
    const carried = store.getItem(PAST_CARRY_KEY) === '1';
    store.removeItem(PAST_CARRY_KEY);
    const raw = carried ? store.getItem(PAST_KEY) : null;
    if (!carried) store.removeItem(PAST_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isPastSeason) : [];
  } catch {
    return [];
  }
}

/** Hand this visit's seasons (oldest first) to the next page. */
export function carrySeasons(store: SessionStore, seasons: PastSeason[]): void {
  try {
    store.setItem(PAST_KEY, JSON.stringify(seasons.slice(-PAST_KEPT)));
    store.setItem(PAST_CARRY_KEY, '1');
  } catch {}
}

function sessionStore(): SessionStore | null {
  try {
    return isWeb ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

const pastSeasons: PastSeason[] = (() => {
  const store = sessionStore();
  return store ? takeCarriedSeasons(store) : [];
})();
let finishedSeason: PastSeason | null = null;

/** The season on screen has finished (or not): it joins the list if a new one starts. */
export function noteFinishedSeason(season: PastSeason | null): void {
  finishedSeason = season;
}

/** This visit's finished seasons in the order they were played (practice only). */
export function pastSeasonResults(): PastSeason[] {
  return [...pastSeasons];
}

/** How many seasons this visit finished before the one on screen. */
export function pastSeasonCount(): number {
  return pastSeasons.length;
}

function carryPastSeasons(): void {
  const store = sessionStore();
  if (store) carrySeasons(store, finishedSeason ? [...pastSeasons, finishedSeason] : pastSeasons);
}

/**
 * Start a fresh practice season (after the player confirmed). A finished
 * season passes its result ("+$3.97M, #1 of 5") so the new season's notice
 * can say how the last one ended (walk 4 T1-13 idea).
 */
export function restartPractice(lastResult?: string): void {
  if (!isWeb) return;
  leaving = true;
  rememberHowPressed();
  try {
    if (typeof lastResult === 'string' && lastResult) window.sessionStorage.setItem(LAST_RESULT_KEY, lastResult);
    else window.sessionStorage.removeItem(LAST_RESULT_KEY);
  } catch {}
  carryPastSeasons();
  try {
    window.sessionStorage.setItem(RESTARTED_KEY, '1');
  } catch {}
  window.location.reload();
}

/** Leave practice for the live market (after the player confirmed). */
export function leavePractice(): void {
  if (!isWeb) return;
  leaving = true;
  rememberHowPressed();
  try {
    window.sessionStorage.setItem(LEFT_PRACTICE_KEY, '1');
  } catch {}
  window.location.search = '';
}

/** True when this tab left practice with Exit (not a first visit). */
export function leftPractice(): boolean {
  if (!isWeb) return false;
  try {
    return window.sessionStorage.getItem(LEFT_PRACTICE_KEY) === '1';
  } catch {
    return false;
  }
}

let goingToPractice = false;

/** Open practice once: a double tap loaded it twice (walk 9 T4-06). */
export function goToPractice(): void {
  if (!isWeb || goingToPractice) return;
  goingToPractice = true;
  window.location.search = '?mock';
}

/** True once, right after a Restart, so the new season can be announced. */
export function consumePracticeRestarted(): boolean {
  if (!isWeb) return false;
  try {
    const flag = window.sessionStorage.getItem(RESTARTED_KEY) === '1';
    window.sessionStorage.removeItem(RESTARTED_KEY);
    return flag;
  } catch {
    return false;
  }
}

/** True once, on the page a keyboard press on Restart or Exit loaded. */
export function consumeArrivedByKeyboard(): boolean {
  if (!isWeb) return false;
  try {
    const flag = window.sessionStorage.getItem(BY_KEYBOARD_KEY) === '1';
    window.sessionStorage.removeItem(BY_KEYBOARD_KEY);
    return flag;
  } catch {
    return false;
  }
}

/** The finished season's result, once, on the page its "Play another season" loaded. */
export function consumeLastSeasonResult(): string | null {
  if (!isWeb) return null;
  try {
    const result = window.sessionStorage.getItem(LAST_RESULT_KEY);
    window.sessionStorage.removeItem(LAST_RESULT_KEY);
    return result;
  } catch {
    return null;
  }
}
