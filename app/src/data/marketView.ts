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
import { closeVerb, money, openVerb, perGame, signedMoney } from '../copy/terms';
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
  /** What the row says: "+$20K a game last year", "No last season". */
  text: string;
  tone: SignalTone;
}

/**
 * The value line a fan reads at a glance: what one game at today's price
 * would have made last season. A short flips the sign (lastYearEdge does it).
 */
export function valueSignal(
  player: Pick<PerGameMarketPlayer, 'currentGameCost' | 'priorSeasonValuePerGame'>,
  side: PerGamePositionSide,
): ValueSignal {
  const edge = lastYearEdge(player, side);
  if (edge === null) return { edge, text: 'No last season', tone: 'none' };
  const tone = netTone(edge);
  if (tone === 'even') return { edge, text: 'Even with last year', tone };
  return { edge, text: `${signedMoney(edge)} a game last year`, tone };
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

/** Colour for a per-game net: green above, red below, muted inside the even band. */
export function netTone(net: number | null): SignalTone {
  if (net === null) return 'none';
  if (Math.abs(net) < EVEN_BAND) return 'even';
  return net > 0 ? 'gain' : 'loss';
}

/**
 * What a held row says after its tag: his net a game so far when games have
 * settled, otherwise the price you locked in.
 */
export function heldDetail(summary: ValueSummary | undefined, lockedGameCost: number): {
  text: string;
  tone: SignalTone;
} {
  if (summary && summary.avgNet !== null && summary.games > 0) {
    return { text: `${signedMoney(summary.avgNet)} a game so far`, tone: netTone(summary.avgNet) };
  }
  return { text: `locked at ${money(lockedGameCost)}`, tone: 'none' };
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
