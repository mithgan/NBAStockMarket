import type { Player } from './types';
import type { TrendPoint } from './trendPresentation';
import { priceChangePercent, recentForm, windowSurprise } from './marketPresentation';

export type MarketSort = 'value' | 'move' | 'form' | 'trending' | 'name';
export type MarketFilter = 'all' | 'held' | 'affordable';

export const MARKET_SORTS: { key: MarketSort; label: string; hint: string }[] = [
  { key: 'value', label: 'Price', hint: 'Sort by highest price' },
  { key: 'move', label: 'Move', hint: 'Sort by biggest price move since listing' },
  { key: 'form', label: 'Form', hint: 'Sort by best recent form versus expected' },
  { key: 'trending', label: 'Trending', hint: 'Sort by highest average net points over projection' },
  { key: 'name', label: 'A-Z', hint: 'Sort players alphabetically' },
];

export const MARKET_FILTERS: { key: MarketFilter; label: string; hint: string }[] = [
  { key: 'all', label: 'All', hint: 'Show every listed player' },
  { key: 'held', label: 'Owned', hint: 'Show only players you own' },
  { key: 'affordable', label: 'Can buy', hint: 'Show only players you can afford now' },
];

export interface MarketRowModel {
  player: Player;
  currentPrice: number;
  changePercent: number | null;
  formSurprise: number | null;
  /** Average surprise across the selected trending window; null with no games. */
  windowSurprise: number | null;
  held: boolean;
  affordable: boolean;
}

export interface BuildMarketRowsInput {
  players: readonly Player[];
  prices: Readonly<Record<string, number>>;
  trends: Readonly<Record<string, TrendPoint[]>>;
  freeCash: number;
  isHeld: (playerId: string) => boolean;
  /**
   * Players the account cannot trade right now — an active weekly short blocks
   * buying even though the player is unowned and affordable. Without this the
   * "Can buy" filter would advertise rows whose button renders as SHORTED.
   */
  isBlocked?: (playerId: string) => boolean;
  query: string;
  sort: MarketSort;
  filter: MarketFilter;
  /**
   * Window for the Trending sort, in settled games; null means the whole
   * settled season. Owned by the screen's window picker so the sort and its
   * label can never disagree.
   */
  trendingGames?: number | null;
}

function matchesQuery(name: string, normalizedQuery: string): boolean {
  if (normalizedQuery === '') return true;
  return name.toLocaleLowerCase().includes(normalizedQuery);
}

/**
 * One pass that resolves price, movement, form, ownership and affordability for
 * every listing, then filters and sorts. Kept pure so the ordering rules can be
 * unit tested without rendering ~300 rows.
 */
export function buildMarketRows({
  players,
  prices,
  trends,
  freeCash,
  isHeld,
  isBlocked,
  query,
  sort,
  filter,
  trendingGames,
}: BuildMarketRowsInput): MarketRowModel[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  const rows = players.reduce<MarketRowModel[]>((accumulator, player) => {
    if (!matchesQuery(player.name, normalizedQuery)) return accumulator;

    const currentPrice = prices[player.id] ?? player.listing_price;
    const held = isHeld(player.id);
    const buyTotal = currentPrice + (player.buy_fee ?? 0);
    const soldOut = player.available_shares === 0;
    const blocked = isBlocked ? isBlocked(player.id) : false;
    const affordable = !held && !soldOut && !blocked && buyTotal <= freeCash;

    if (filter === 'held' && !held) return accumulator;
    if (filter === 'affordable' && !affordable) return accumulator;

    const form = recentForm(trends[player.id] ?? []);
    accumulator.push({
      player,
      currentPrice,
      changePercent: priceChangePercent(currentPrice, player.listing_price),
      formSurprise: form ? form.averageSurprise : null,
      windowSurprise: windowSurprise(trends[player.id] ?? [], trendingGames ?? null),
      held,
      affordable,
    });
    return accumulator;
  }, []);

  const byName = (a: MarketRowModel, b: MarketRowModel) =>
    a.player.name.localeCompare(b.player.name);

  // Rows missing a metric always sort last rather than being treated as zero.
  const descendingBy = (pick: (row: MarketRowModel) => number | null) =>
    (a: MarketRowModel, b: MarketRowModel) => {
      const left = pick(a);
      const right = pick(b);
      if (left === null && right === null) return byName(a, b);
      if (left === null) return 1;
      if (right === null) return -1;
      if (right === left) return byName(a, b);
      return right - left;
    };

  switch (sort) {
    case 'name':
      return rows.sort(byName);
    case 'move':
      return rows.sort(descendingBy((row) => row.changePercent));
    case 'form':
      return rows.sort(descendingBy((row) => row.formSurprise));
    case 'value':
    default:
      return rows.sort(descendingBy((row) => row.currentPrice));
  }
}
