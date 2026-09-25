/**
 * The market's answers, as pure functions: which players to show, in what
 * order, and the one line that says whether each is worth his price.
 *
 * The screen owns layout; everything a fan reads about value comes from here
 * (and from perGameMetrics underneath) so the list, the desktop columns and the
 * screen-reader labels always say the same thing.
 */
import type {
  PerGameMarketPlayer,
  PerGamePositionSide,
  PerGameSettledResult,
  PerGameSlotSummary,
} from '../api/contracts';
import {
  CONFIRM_LABEL,
  closeVerb,
  confirmCloseLine,
  money,
  moneyFine,
  openVerb,
  perGame,
  rosterReopensLine,
  signedMoney,
  signedMoneyFine,
} from '../copy/terms';
import {
  currentResults,
  lastYearEdge,
  summarizeValue,
  type ValueSummary,
} from './perGameMetrics';
import { splitPlayerName } from './playerName';

export type MarketSort = 'price' | 'value' | 'name';

/** Sort choices, in the order the control shows them. Hints are for screen readers. */
export const MARKET_SORT_OPTIONS: { key: MarketSort; label: string; hint: string }[] = [
  { key: 'price', label: 'Price', hint: 'Cheapest price a game first' },
  { key: 'value', label: 'Value', hint: 'Best value against last season first' },
  { key: 'name', label: 'Name', hint: 'By last name, A to Z' },
];

/** Under half a thousand either way reads as even, matching valueVerdict. */
const EVEN_BAND = 500;

function nameKey(name: string): string {
  const { given, surname } = splitPlayerName(name);
  return `${surname} ${given}`.trim();
}

function compareNames(left: string, right: string): number {
  return nameKey(left).localeCompare(nameKey(right), 'en', { sensitivity: 'base' });
}

/**
 * Order market rows. Price runs cheapest first, Value runs best last-season
 * edge first (players with no last season go last), Name runs by surname.
 * Ties fall back to price, then name, so the order never shuffles between
 * renders.
 */
export function sortMarketRows<T extends { player: PerGameMarketPlayer }>(
  rows: readonly T[],
  sort: MarketSort,
  side: PerGamePositionSide,
): T[] {
  const byPrice = (left: T, right: T) => left.player.currentGameCost - right.player.currentGameCost;
  const byName = (left: T, right: T) => compareNames(left.player.name, right.player.name);
  const sorted = [...rows];
  if (sort === 'name') return sorted.sort((left, right) => byName(left, right) || byPrice(left, right));
  if (sort === 'price') return sorted.sort((left, right) => byPrice(left, right) || byName(left, right));
  return sorted.sort((left, right) => {
    const leftEdge = lastYearEdge(left.player, side);
    const rightEdge = lastYearEdge(right.player, side);
    if (leftEdge === null || rightEdge === null) {
      if (leftEdge !== rightEdge) return leftEdge === null ? 1 : -1;
      return byPrice(left, right) || byName(left, right);
    }
    return rightEdge - leftEdge || byPrice(left, right) || byName(left, right);
  });
}

/**
 * Players you hold on the other side cannot be opened on this one, so they
 * follow everyone you can act on. Order inside each group is kept.
 */
export function actionableFirst<T extends { blockedByOpposingPosition: boolean }>(rows: readonly T[]): T[] {
  return [
    ...rows.filter((row) => !row.blockedByOpposingPosition),
    ...rows.filter((row) => row.blockedByOpposingPosition),
  ];
}

/** Lower-case, accent-free text so "doncic" finds "Dončić". */
export function searchKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .trim();
}

/**
 * Keep the rows whose name contains every word typed (in any order), and,
 * when `watchedOnly` is on, only the players on the watchlist.
 */
export function filterMarketRows<T extends { player: PerGameMarketPlayer }>(
  rows: readonly T[],
  {
    query,
    watchedOnly,
    watched,
  }: { query: string; watchedOnly: boolean; watched: readonly string[] },
): T[] {
  const words = searchKey(query).split(/\s+/).filter(Boolean);
  const watchedSet = new Set(watched);
  return rows.filter((row) => {
    if (watchedOnly && !watchedSet.has(row.player.playerId)) return false;
    if (words.length === 0) return true;
    const key = searchKey(row.player.name);
    return words.every((word) => key.includes(word));
  });
}

export type SignalTone = 'gain' | 'loss' | 'even' | 'none';

export interface ValueSignal {
  /** Per-game edge at today's price from last season, sign already set for the side. */
  edge: number | null;
  /** The fact: "Last year $120K a game ·", or null with no last season. */
  lead: string | null;
  /** The comparison: "+$20K vs his price", "-$20K for a short", "No last season". */
  text: string;
  tone: SignalTone;
}

/**
 * The value line a fan reads at a glance: what he was worth a game last
 * season, then how that compares with his price today. On the Short tab the
 * comparison is what a short would have made (lastYearEdge flips the sign).
 */
export function valueSignal(
  player: Pick<PerGameMarketPlayer, 'currentGameCost' | 'priorSeasonValuePerGame'>,
  side: PerGamePositionSide,
): ValueSignal {
  const edge = lastYearEdge(player, side);
  if (edge === null || player.priorSeasonValuePerGame === null) {
    return { edge: null, lead: null, text: 'No last season', tone: 'none' };
  }
  const lead = `Last year ${money(player.priorSeasonValuePerGame)} a game ·`;
  const tone = netTone(edge);
  if (tone === 'even') return { edge, lead, text: 'even with his price', tone };
  return { edge, lead, text: `${signedMoney(edge)} ${side === 'long' ? 'vs his price' : 'for a short'}`, tone };
}

/** "8 of 10 on your roster" / "1 of 5 shorts". */
export function slotSummary(side: PerGamePositionSide, slots: Pick<PerGameSlotSummary, 'used' | 'limit'>): string {
  return side === 'long'
    ? `${slots.used} of ${slots.limit} on your roster`
    : `${slots.used} of ${slots.limit} ${slots.limit === 1 ? 'short' : 'shorts'}`;
}

/** The action button's accessible name: "Add LeBron James at $105K a game". */
export function actionName(
  kind: 'open' | 'close',
  side: PerGamePositionSide,
  playerName: string,
  price: number,
): string {
  if (kind === 'open') return `${openVerb(side)} ${playerName} at ${perGame(price)}`;
  return side === 'long'
    ? `${closeVerb(side)} ${playerName} from your roster`
    : `${closeVerb(side)} your short on ${playerName}`;
}

/**
 * This account's own settled games with each player on one side, keyed by
 * player id. Corrections count once, at their latest revision.
 */
export function accountValueByPlayer(
  results: readonly PerGameSettledResult[],
  side: PerGamePositionSide,
): Map<string, ValueSummary> {
  const grouped = new Map<string, PerGameSettledResult[]>();
  for (const result of currentResults(results)) {
    if (result.side !== side) continue;
    const list = grouped.get(result.playerId) ?? [];
    list.push(result);
    grouped.set(result.playerId, list);
  }
  const summaries = new Map<string, ValueSummary>();
  for (const [playerId, list] of grouped) summaries.set(playerId, summarizeValue(list));
  return summaries;
}

/**
 * Each position's own settled games, keyed by position id: exactly
 * positionValue(results, id) for every position, in one pass. A held market
 * row reads its current position from here, the same source as its Roster row.
 */
export function valueByPosition(results: readonly PerGameSettledResult[]): Map<string, ValueSummary> {
  const grouped = new Map<string, PerGameSettledResult[]>();
  for (const result of currentResults(results)) {
    const list = grouped.get(result.positionId) ?? [];
    list.push(result);
    grouped.set(result.positionId, list);
  }
  const summaries = new Map<string, ValueSummary>();
  for (const [positionId, list] of grouped) summaries.set(positionId, summarizeValue(list));
  return summaries;
}

/** Colour for a per-game net: green above, red below, muted inside the even band. */
export function netTone(net: number | null): SignalTone {
  if (net === null) return 'none';
  if (Math.abs(net) < EVEN_BAND) return 'even';
  return net > 0 ? 'gain' : 'loss';
}

/**
 * What a held row says after "On your roster ·" / "Shorted ·": the current
 * position's net a game and games (positionValue, the Roster row's source),
 * or the price you locked in before his first game.
 */
export function heldDetail(summary: ValueSummary | undefined, lockedGameCost: number): {
  text: string;
  tone: SignalTone;
} {
  if (summary && summary.avgNet !== null && summary.games > 0) {
    // The Roster's precision, so the same figure reads the same on both screens.
    return {
      text: `${signedMoneyFine(summary.avgNet)} a game over ${summary.games === 1 ? '1 game' : `${summary.games} games`}`,
      tone: netTone(summary.avgNet),
    };
  }
  return { text: `locked at ${moneyFine(lockedGameCost)}`, tone: 'none' };
}

/**
 * The action button's visible word. A pending action waits; a lock or a full
 * side says so on the button itself, so a dimmed button never goes
 * unexplained; an armed Drop or Close reads "Confirm", the word the Roster
 * and Restart use. (At season end there are no buttons: see `rowActions`.)
 */
export function actionWord({
  side,
  held,
  pending,
  confirming,
  rosterLocked,
  full,
}: {
  side: PerGamePositionSide;
  held: boolean;
  pending: boolean;
  confirming: boolean;
  rosterLocked: boolean;
  full: boolean;
}): string {
  const verb = held ? closeVerb(side) : openVerb(side);
  if (pending) return 'Wait';
  if (rosterLocked) return 'Locked';
  if (held && confirming) return CONFIRM_LABEL;
  if (!held && full) return 'Full';
  return verb;
}

/**
 * What the live region says when a Drop or Close is armed: the same line the
 * button shows under it, led by what to tap.
 * "Tap Confirm to drop Nikola Jokic. $250 fee · his +$764K stays in your score."
 */
export function confirmAnnouncement(side: PerGamePositionSide, playerName: string, fee: number, total: number): string {
  const what = side === 'long' ? `drop ${playerName}` : `close your short on ${playerName}`;
  // With no fee the shared line starts "his …" or "this short's …"; it is a
  // sentence of its own here, so it starts with a capital.
  const line = confirmCloseLine(side, fee, total);
  return `Tap ${CONFIRM_LABEL} to ${what}. ${line.charAt(0).toUpperCase()}${line.slice(1)}.`;
}

/**
 * The season is over when practice has played its last day, or when a live
 * season has settled games and no next game: the rule the Roster uses, so
 * the Market never sells a player the Roster calls final.
 */
export function isSeasonOver({
  practiceComplete,
  lastSettledDate,
  nextGameDate,
}: {
  practiceComplete: boolean;
  lastSettledDate: string | null;
  nextGameDate: string | null;
}): boolean {
  return practiceComplete || (lastSettledDate !== null && nextGameDate === null);
}

/**
 * Whether market rows carry Add, Drop and Short at all. Once the season is
 * over nothing can be bought or sold, so the rows go quiet (no button column,
 * nothing that could charge a fee) and the header's one line, "The season is
 * over", says why: one clear state instead of a column of dead buttons.
 */
export function rowActions(seasonOver: boolean): boolean {
  return !seasonOver;
}

export interface HeaderStatus {
  /** The line under the slot count, or null. */
  text: string | null;
  /** 'lock' draws the padlock and the one warning colour. */
  kind: 'season' | 'lock' | 'full' | null;
}

/**
 * The one line under "8 of 10 on your roster": the season is over, or
 * roster changes are locked (with when they reopen), or the side is full.
 * Only one shows, so a locked roster never advises a drop it cannot make.
 */
export function headerStatus({
  side,
  seasonOver,
  rosterLocked,
  lockGameDate,
  full,
}: {
  side: PerGamePositionSide;
  seasonOver: boolean;
  rosterLocked: boolean;
  lockGameDate: string | null;
  full: boolean;
}): HeaderStatus {
  if (seasonOver) return { text: 'The season is over', kind: 'season' };
  if (rosterLocked) return { text: rosterReopensLine(lockGameDate), kind: 'lock' };
  if (full) return { text: side === 'long' ? 'Full: drop one to add' : 'Full: close one to short', kind: 'full' };
  return { text: null, kind: null };
}

/**
 * Below this width (a phone at 200% zoom) search, sort and Watching fold
 * behind one toggle, so the first player shows without scrolling past them.
 */
export const COLLAPSE_CONTROLS_BELOW = 300;

export function collapseControls(width: number): boolean {
  return width < COLLAPSE_CONTROLS_BELOW;
}

/**
 * From this width the kicker names the tier ("KARL-ANTHONY · STAR"). The
 * phone row puts the kicker and the price on one line, and below 380px the
 * longest given names only fit there without the tier.
 */
export const KICKER_TIER_MIN_WIDTH = 380;

/** "NIKOLA · STAR", or just "NIKOLA" below KICKER_TIER_MIN_WIDTH. */
export function rowKicker(given: string, tier: string | null | undefined, width: number): string {
  return [given, width >= KICKER_TIER_MIN_WIDTH ? tier : null].filter(Boolean).join(' · ');
}

/** How long a Drop or Close waits for its second tap. */
export const CONFIRM_WINDOW_MS = 4000;

export type MarketLayout = 'phone' | 'large' | 'table';

/**
 * Names stay whole at their hyphen ("Gilgeous-Alexander") while a line can
 * hold them. Below 320px even the longest surname no longer fits, and a break
 * at the hyphen beats the browser breaking inside the word.
 */
export function keepNamesWhole(width: number): boolean {
  return width >= 320;
}

/**
 * Row layout for a window: a table with aligned columns from tablet width up
 * (768px), the phone row below that, and the one-column large-text row when
 * text is scaled up or the window is under 300px (a phone zoomed to 200%).
 */
export function marketLayout(width: number, fontScale: number): MarketLayout {
  if (fontScale > 1.3 || width < 300) return 'large';
  return width >= 768 ? 'table' : 'phone';
}

export interface MarketColumnSet {
  avatar: number;
  price: number;
  lastSeason: number;
  edge: number;
  /** Your net a game column; 0 hides it (your stake then reads under the name). */
  yours: number;
  action: number;
  gap: number;
}

/**
 * Column widths for the table. A tablet or small laptop gets narrower columns
 * and no "Your net a game" column, so the player column keeps room for a name.
 */
export function marketColumns(width: number): MarketColumnSet {
  return width >= 1100
    ? { avatar: 36, price: 104, lastSeason: 104, edge: 140, yours: 150, action: 112, gap: 12 }
    : { avatar: 32, price: 100, lastSeason: 96, edge: 108, yours: 0, action: 96, gap: 12 };
}

/**
 * The row's screen-reader label. It always ends in "View profile" because the
 * row opens the profile; the QA harness and assistive tech both rely on it.
 */
export function rowProfileLabel({
  name,
  tier,
  price,
  detail,
  reason,
}: {
  name: string;
  tier: string;
  price: number;
  detail: string;
  reason?: string | null;
}): string {
  const facts = [name, tier.toLowerCase(), perGame(price), detail].filter(Boolean).join(', ');
  return reason ? `${facts}. ${reason} View profile` : `${facts}, View profile`;
}
