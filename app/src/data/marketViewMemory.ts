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
  /** The season was over when the Market was left (walk 16 T1-07). */
  seasonOver: boolean;
  /**
   * A side whose explainer has done its job this visit: the player made a
   * move on that side or closed it with its × (walk 16 T1-01).
   */
  explained: Readonly<Record<PerGamePositionSide, boolean>>;
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
  seasonOver: false,
  explained: { long: false, short: false },
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

export function tierAfterSurnameKey(width: number, fontScale: number, spacing = ''): string {
  // A reader's text spacing (letter, word and line spacing forced by a style
  // sheet) lays the rows out anew: its decisions are its own (walk 18 T3-10).
  return spacing ? `${Math.round(width)}|${fontScale}|${spacing}` : `${Math.round(width)}|${fontScale}`;
}

/**
 * Sizes where a surname pushed the tier after it onto a line of its own
 * ("Gilgeous-Alexander" / "STAR ›" with a reader's text spacing at 375, walk
 * 18 T3-10): every row then names its tier beside the given name, as 390px
 * does, and a given name too long for its line wraps rather than being cut.
 */
const tierOnGivenAt = new Set<string>();

export function tierOnGivenKnown(key: string): boolean {
  return tierOnGivenAt.has(key);
}

export function rememberTierOnGiven(key: string): void {
  tierOnGivenAt.add(key);
}

export function tierAfterSurnameKnown(key: string): boolean {
  return tierAfterSurnameAt.has(key);
}

export function rememberTierAfterSurname(key: string): void {
  tierAfterSurnameAt.add(key);
}

/**
 * Sizes where a given name, its tier already after the surname, still did
 * not fit beside a price box that says "yours" (walk 17 T1-03: "KARL-ANTHONY"
 * at 360 and 375; T3-03: "SCOTTIE" at 320 with a reader's text spacing): the
 * whole list then leaves "yours" out, so every row keeps one height and no
 * given name is cut. Remembered for the visit, as the tier's place is.
 */
const heldYoursDroppedAt = new Set<string>();

export function heldYoursDroppedKnown(key: string): boolean {
  return heldYoursDroppedAt.has(key);
}

export function rememberHeldYoursDropped(key: string): void {
  heldYoursDroppedAt.add(key);
}

/**
 * Coming back to the Market restores your place in the list, unless the list
 * was re-sorted for you meanwhile: the season ended since you left (walk 16
 * T1-07: you came back mid-list on re-sorted rows, the side toggle and the
 * season's line out of view). Then it opens at its top.
 */
export function restoresPlace(offset: number, seasonOverNow: boolean, seasonOverWhenLeft: boolean): boolean {
  return offset > 0 && !(seasonOverNow && !seasonOverWhenLeft);
}

/**
 * A portrait phone's explainer under the sort ("Value: …" on the Roster side,
 * how a short works on the Short side) is for a first move: it gives its room
 * back once the player has made a move on that side, holds someone there, or
 * closed it with its × (walk 16 T1-01: the first row started at y=380).
 */
export function explainerDone(explained: boolean, heldOnSide: number): boolean {
  return explained || heldOnSide > 0;
}

export function markExplained(side: PerGamePositionSide): void {
  if (memory.explained[side]) return;
  memory = { ...memory, explained: { ...memory.explained, [side]: true } };
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
