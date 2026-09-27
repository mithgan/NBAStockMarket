/**
 * What the Market remembers while you visit other tabs: the side, the sort
 * (and its direction), the search, the Watching filter and where you were in
 * the list. The screen unmounts on every tab switch, so this lives at module
 * level for the session (a reload or Restart starts fresh).
 */
import type { PerGamePositionSide } from '../api/contracts';
import type { MarketSort } from './marketView';

export interface MarketMemory {
  side: PerGamePositionSide;
  sort: MarketSort;
  /** The sort runs the other way (most expensive first, worst value first, Z to A). */
  reversed: boolean;
  query: string;
  watchedOnly: boolean;
  /** The first row you could see, so the list comes back to the same player. */
  anchorId: string | null;
  /** How far the list was scrolled, and at what window width. */
  offset: number;
  width: number;
  /** The side the app last asked the Market to open on. */
  lastInitialSide: PerGamePositionSide | null;
  /**
   * A phone has shown the line that says what Value is (walk 13 T1-01): it
   * shows on the first phone visit of a session and stays for that visit, so
   * it never goes from under a thumb; later visits leave the rows its room.
   */
  valueTipSeen: boolean;
}

/**
 * A new fan's Market opens on Value, highest first: the game's main signal
 * (last season's dividend against today's price) instead of the cheapest
 * rookie with no last season (walk 4 NYI-6). A choice made since wins.
 */
export const MARKET_DEFAULT_SORT: MarketSort = 'value';

const FRESH: MarketMemory = {
  side: 'long',
  sort: MARKET_DEFAULT_SORT,
  reversed: false,
  query: '',
  watchedOnly: false,
  anchorId: null,
  offset: 0,
  width: 0,
  lastInitialSide: null,
  valueTipSeen: false,
};

let memory: MarketMemory = { ...FRESH };

/**
 * Window sizes at which the phone rows were measured to need the tier after
 * the surname (a long given name beside its tier wrapped or was cut): later
 * visits start there, so the list is drawn once, not drawn and then redrawn
 * in the other arrangement on every tab switch (fix 14 perf: +70ms a switch
 * at 390px on a 4x-slowed CPU). A reader's text spacing is measured again.
 */
const tierAfterSurnameAt = new Set<string>();

export function tierAfterSurnameKey(width: number, fontScale: number): string {
  return `${Math.round(width)}|${fontScale}`;
}

export function tierAfterSurnameKnown(key: string): boolean {
  return tierAfterSurnameAt.has(key);
}

export function rememberTierAfterSurname(key: string): void {
  tierAfterSurnameAt.add(key);
}

export function marketMemory(): MarketMemory {
  return memory;
}

export function rememberMarket(patch: Partial<MarketMemory>): void {
  memory = { ...memory, ...patch };
}

export function forgetMarket(): void {
  memory = { ...FRESH };
}

/**
 * The side the Market opens on. A new request wins (the Roster's "Find a
 * short" asks for the Short side; so does any press inside a screen that
 * opens the Market); coming back through the tab bar or Back restores the
 * side you left it on.
 */
export function openingSide({
  initialSide,
  remembered,
  requestedFromScreen,
}: {
  initialSide: PerGamePositionSide;
  remembered: Pick<MarketMemory, 'side' | 'lastInitialSide'>;
  requestedFromScreen: boolean;
}): PerGamePositionSide {
  if (requestedFromScreen) return initialSide;
  if (remembered.lastInitialSide === null || remembered.lastInitialSide !== initialSide) return initialSide;
  return remembered.side;
}
