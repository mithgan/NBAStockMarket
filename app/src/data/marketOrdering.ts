import type { Player } from './types';
import { dividendYield, summarizeDividends } from './dividendMetrics';
import type { TrendPoint } from './trendPresentation';
import { priceChangePercent, recentForm } from './marketPresentation';

/**
 * Money-first ordering (after "From Impact to Winning"): the market ranks by
 * what players PAY, not by prices that never move in this world. 'pays' is
 * the rate over the screen's window picker; 'yield' is the season's payout
 * per dollar of price — the value-hunting sort. 'move' died with the flat
 * prices it measured: a number that is always 0.0% cannot rank anything.
 */
export type MarketSort = 'pays' | 'yield' | 'value' | 'form' | 'name';
export type MarketFilter = 'all' | 'held' | 'affordable';

export const MARKET_SORTS: { key: MarketSort; label: string; hint: string }[] = [
  { key: 'pays', label: 'Pays', hint: 'Sort by payout per game over the window' },
  { key: 'yield', label: 'Yield', hint: 'Sort by season payout per dollar of price' },
  { key: 'value', label: 'Price', hint: 'Sort by highest price' },
  { key: 'form', label: 'Form', hint: 'Sort by best recent form versus expected' },
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
  /** Payout per game over the selected window — the rate; null with no games. */
  windowRate: number | null;
  /** Games he actually played in the window — the exposure. */
  windowGames: number;
  /** What the window banked in total. */
  windowTotal: number;
  /** Season payout per dollar of current price — the vs-price baseline. */
  seasonYield: number | null;
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
 * One pass that resolves price, movement, form, trending window, ownership and
 * affordability for every listing, then filters and sorts. Kept pure so the
 * ordering rules can be unit tested without rendering ~300 rows.
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
    const settled = trends[player.id] ?? [];
    const windowPoints = trendingGames === null || trendingGames === undefined
      ? settled
      : settled.slice(-trendingGames);
    const window = summarizeDividends(windowPoints);
    const season = summarizeDividends(settled);
    accumulator.push({
      player,
      currentPrice,
      changePercent: priceChangePercent(currentPrice, player.listing_price),
      formSurprise: form ? form.averageSurprise : null,
      windowRate: window.perGame,
      windowGames: window.gamesPlayed,
      windowTotal: window.total,
      seasonYield: season.gamesPlayed === 0 ? null : dividendYield(season.total, currentPrice),
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
    case 'yield':
      return rows.sort(descendingBy((row) => row.seasonYield));
    case 'form':
      return rows.sort(descendingBy((row) => row.formSurprise));
    case 'value':
      return rows.sort(descendingBy((row) => row.currentPrice));
    case 'pays':
    default:
      return rows.sort(descendingBy((row) => row.windowRate));
  }
}
