import type {
  ServerActivity,
  ServerBootstrap,
  ServerLeaderboardRow,
  ServerPortfolio,
} from '../api/contracts';
import { weekKey } from '../data/calendar';
import type { TrendPoint } from '../data/trendPresentation';
import type { Player } from '../data/types';
import {
  GAME_STATE_VERSION,
  type ActivityEvent,
  type ActivityKind,
  type GameLeaderboardEntry,
  type GameSummary,
  type GameState,
} from './game';
import { STARTING_BANKROLL } from './economy';

const CENTS_PER_DOLLAR = 100;
const MICROS_PER_POINT = 1_000_000;

export interface ServerPresentationState {
  state: GameState;
  portfolioValuation: PortfolioValuation;
  players: Player[];
  leaderboard: GameLeaderboardEntry[];
  playerTrends: Record<string, TrendPoint[]>;
  nextGameDate: string | null;
  settledGameDateCount: number;
  latestSettledDate: string | null;
  currentWeek: string | null;
  isComplete: boolean;
  displayName: string;
  shortSlots: { used: number; total: number };
  boostSlots: { used: number; total: number };
  weeklyShortTargets: InstrumentTargetView[];
  boostTargets: InstrumentTargetView[];
  canAdvanceDay: boolean;
}

export interface InstrumentTargetView {
  playerId: string;
  gameDate: string;
  fee: number;
}

export interface PortfolioValuation {
  cash: number;
  freeCash: number;
  reservedCollateral: number;
  marketValue: number;
  totalValue: number;
  holdings: Record<string, {
    currentPrice: number;
    marketValue: number;
    unrealizedPnl: number;
  }>;
}

function dollars(cents: number): number {
  return cents / CENTS_PER_DOLLAR;
}

function detailInteger(details: Record<string, unknown>, key: string): number | null {
  const value = details[key];
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function playerName(names: ReadonlyMap<string, string>, playerId: string | null): string {
  if (!playerId) return 'your account';
  return names.get(playerId) ?? playerId;
}

function mapActivityKind(kind: string): ActivityKind | null {
  const kinds: Record<string, ActivityKind> = {
    trade_buy: 'buy',
    trade_sell: 'sell',
    dividend: 'dividend',
    weekly_short_opened: 'weekly-short-armed',
    weekly_short_settled: 'weekly-short-settled',
    weekly_short_voided: 'weekly-short-voided',
    boost_armed: 'boost-armed',
    boost_consumed: 'boost-consumed',
    boost_refunded: 'boost-refunded',
  };
  return kinds[kind] ?? null;
}

function activityMessage(
  item: ServerActivity,
  kind: ActivityKind,
  names: ReadonlyMap<string, string>,
): string {
  const name = playerName(names, item.player_id);
  switch (kind) {
    case 'buy': return `Bought one share of ${name}`;
    case 'sell': return `Sold one share of ${name}`;
    case 'dividend': return `${name} daily dividend`;
    case 'weekly-short-armed': return `Armed a weekly short on ${name}`;
    case 'weekly-short-settled': return `Settled ${name} weekly short`;
    case 'weekly-short-voided': return `Voided ${name} weekly short`;
    case 'boost-armed': return `Armed a boost on ${name}`;
    case 'boost-consumed': return `Settled ${name} boost`;
    case 'boost-refunded': return `Refunded ${name} boost`;
  }
}

function mapActivity(
  item: ServerActivity,
  names: ReadonlyMap<string, string>,
): ActivityEvent | null {
  const kind = mapActivityKind(item.kind);
  if (!kind) return null;
  const feeCents = detailInteger(item.details, 'fee_cents') ?? 0;
  const priceCents = detailInteger(item.details, 'execution_price_cents')
    ?? detailInteger(item.details, 'opening_price_cents');
  return {
    id: item.id,
    kind,
    playerId: item.player_id ?? 'account',
    date: item.game_date,
    cashDelta: dollars(item.amount_cents),
    fee: dollars(feeCents),
    price: priceCents === null ? null : dollars(priceCents),
    message: activityMessage(item, kind, names),
  };
}

function mapLeaderboard(rows: ServerLeaderboardRow[]): GameLeaderboardEntry[] {
  return rows.map((row) => ({
    id: row.is_current_user
      ? 'current-user'
      : `leaderboard:${row.rank}:${row.display_name}`,
    rank: row.rank,
    name: row.display_name,
    value: dollars(row.total_value_cents),
    returnPct: row.return_bps / 100,
    isUser: row.is_current_user,
  }));
}

function mapPortfolioHoldings(portfolio: ServerPortfolio): GameState['holdings'] {
  return portfolio.holdings.map((holding) => ({
    player_id: holding.player_id,
    shares: 1,
    average_price: dollars(holding.average_cost_cents),
    cost_basis: dollars(holding.average_cost_cents),
  }));
}

function mapPortfolioValuation(portfolio: ServerPortfolio): PortfolioValuation {
  return {
    cash: dollars(portfolio.cash_cents),
    freeCash: dollars(portfolio.free_cash_cents),
    reservedCollateral: dollars(portfolio.reserved_collateral_cents),
    marketValue: dollars(portfolio.market_value_cents),
    totalValue: dollars(portfolio.total_value_cents),
    holdings: Object.fromEntries(portfolio.holdings.map((holding) => [
      holding.player_id,
      {
        currentPrice: dollars(holding.current_price_cents),
        marketValue: dollars(holding.market_value_cents),
        unrealizedPnl: dollars(holding.unrealized_pnl_cents),
      },
    ])),
  };
}

export function applyPortfolioValuationToSummary(
  summary: GameSummary,
  valuation: PortfolioValuation,
): GameSummary {
  return {
    ...summary,
    cash: valuation.cash,
    freeCash: valuation.freeCash,
    reservedCollateral: valuation.reservedCollateral,
    marketValue: valuation.marketValue,
    totalValue: valuation.totalValue,
    holdings: summary.holdings.map((holding) => {
      const authoritative = valuation.holdings[holding.player_id];
      return authoritative ? { ...holding, ...authoritative } : holding;
    }),
  };
}

function mapWeeklyShorts(portfolio: ServerPortfolio): GameState['weeklyShorts'] {
  return portfolio.instruments.weekly_shorts.map((position) => ({
    id: position.id,
    playerId: position.player_id,
    week: weekKey(position.week_start),
    feePaid: dollars(position.fee_cents),
    collateral: dollars(position.collateral_cents),
    accruedNetPoints: position.accrued_net_points_micros / MICROS_PER_POINT,
    qualifyingGames: position.qualifying_games,
    status: position.status,
    payout: position.payout_cents === null ? null : dollars(position.payout_cents),
  }));
}

function mapBoosts(portfolio: ServerPortfolio): GameState['boosts'] {
  return portfolio.instruments.boosts.map((position) => ({
    id: position.id,
    playerId: position.player_id,
    week: weekKey(position.week_start),
    gameDate: position.game_date,
    feePaid: dollars(position.fee_cents),
    status: position.status,
    payout: position.payout_cents === null ? 0 : dollars(position.payout_cents),
  }));
}

function mapInstrumentTargets(
  targets: ServerPortfolio['instruments']['weekly_short_targets'],
): InstrumentTargetView[] {
  return targets.map((target) => ({
    playerId: target.player_id,
    gameDate: target.game_date,
    fee: dollars(target.fee_cents),
  }));
}

export interface MutationPriceUpdate {
  playerId: string;
  currentPriceCents: number;
}

export function applyServerPortfolioToPresentation(
  current: ServerPresentationState,
  portfolio: ServerPortfolio,
  priceUpdate?: MutationPriceUpdate,
): ServerPresentationState {
  const prices = { ...current.state.prices };
  if (priceUpdate) {
    prices[priceUpdate.playerId] = dollars(priceUpdate.currentPriceCents);
  }

  return {
    ...current,
    portfolioValuation: mapPortfolioValuation(portfolio),
    state: {
      ...current.state,
      cash: dollars(portfolio.cash_cents),
      prices,
      holdings: mapPortfolioHoldings(portfolio),
      weeklyShorts: mapWeeklyShorts(portfolio),
      boosts: mapBoosts(portfolio),
      transitionCount: portfolio.version,
    },
    displayName: portfolio.display_name,
    shortSlots: {
      used: portfolio.instruments.weekly_short_slots.used,
      total: portfolio.instruments.weekly_short_slots.limit,
    },
    boostSlots: {
      used: portfolio.instruments.boost_slots.used,
      total: portfolio.instruments.boost_slots.limit,
    },
    weeklyShortTargets: mapInstrumentTargets(
      portfolio.instruments.weekly_short_targets,
    ),
    boostTargets: mapInstrumentTargets(portfolio.instruments.boost_targets),
  };
}

export function isServerAccountPristine(bootstrap: ServerBootstrap): boolean {
  const { portfolio } = bootstrap;
  return (
    portfolio.version === 0
    && portfolio.cash_cents === STARTING_BANKROLL * CENTS_PER_DOLLAR
    && portfolio.holdings.length === 0
    && portfolio.recent_trades.length === 0
    && portfolio.instruments.weekly_shorts.length === 0
    && portfolio.instruments.boosts.length === 0
    && bootstrap.activity.items.length === 0
  );
}

export function serverRefreshNotice(bootstrap: ServerBootstrap): string {
  if (bootstrap.game.next_game_date === null) {
    return bootstrap.game.is_complete
      ? 'Server data is up to date. The historical replay is complete.'
      : 'Server data is up to date. Waiting for the next game date to become available.';
  }
  const nextDate = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${bootstrap.game.next_game_date}T00:00:00Z`));
  return `You are up to date. Next replay date: ${nextDate}. Replay dates advance for everyone only after the server settles them.`;
}

export type IncrementalBootstrapMerge =
  | { kind: 'merged'; bootstrap: ServerBootstrap }
  | { kind: 'reload'; bootstrap: ServerBootstrap };

export function mergeIncrementalBootstrap(
  previous: ServerBootstrap,
  incoming: ServerBootstrap,
  requestedAfter: string,
): IncrementalBootstrapMerge {
  const incomingDate = incoming.game.last_settled_date;
  if (incomingDate === null || incomingDate < requestedAfter) {
    return { kind: 'reload', bootstrap: incoming };
  }
  const results = new Map(
    previous.settledResults.map((result) => [
      `${result.game_date}:${result.player_id}`,
      result,
    ]),
  );
  for (const result of incoming.settledResults) {
    results.set(`${result.game_date}:${result.player_id}`, result);
  }
  return {
    kind: 'merged',
    bootstrap: {
      ...incoming,
      settledResults: [...results.values()].sort((left, right) => (
        left.game_date.localeCompare(right.game_date)
        || left.player_id.localeCompare(right.player_id)
      )),
    },
  };
}

export function mapServerBootstrap(bootstrap: ServerBootstrap): ServerPresentationState {
  const players: Player[] = bootstrap.market.map((listing) => ({
    id: listing.id,
    name: listing.name,
    tier: listing.tier,
    listing_price: dollars(listing.opening_price_cents),
    actual_salary: dollars(listing.actual_salary_cents),
    available_shares: listing.available_shares,
    buy_fee: dollars(listing.buy_fee_cents),
    ownership_bps: listing.ownership_bps,
    shares_outstanding: listing.shares_outstanding,
    volume_30d: listing.volume_30d,
  }));
  const names = new Map(players.map((player) => [player.id, player.name]));
  const latestSettledDate = bootstrap.game.last_settled_date;
  const settledResults = latestSettledDate === null
    ? []
    : bootstrap.settledResults.filter(
      (result) => result.game_date <= latestSettledDate,
    );
  const settledDates = [...new Set([
    ...settledResults.map((result) => result.game_date),
    ...bootstrap.settlements.map((settlement) => settlement.game_date),
  ])].sort();
  const settledPlayerWeeks = [...new Set(settledResults.map(
    (result) => `${weekKey(result.game_date)}:${result.player_id}`,
  ))];
  const playerTrends: Record<string, TrendPoint[]> = {};
  for (const result of settledResults) {
    const point = {
      date: result.game_date,
      np: result.actual_net_points_micros / MICROS_PER_POINT,
      expected_np: result.expected_net_points_micros / MICROS_PER_POINT,
      dividend_per_holder: dollars(result.dividend_cents),
    };
    (playerTrends[result.player_id] ??= []).push(point);
  }
  const portfolioHistory = [...bootstrap.portfolioHistory.items]
    .sort((left, right) => left.game_date.localeCompare(right.game_date))
    .map((point, index, rows) => {
      const totalValue = dollars(point.total_value_cents);
      const previousValue = index === 0
        ? STARTING_BANKROLL
        : dollars(rows[index - 1].total_value_cents);
      return {
        id: `portfolio:${point.game_date}`,
        date: point.game_date,
        cash: dollars(point.cash_cents),
        marketValue: dollars(point.market_value_cents),
        totalValue,
        dailyChange: totalValue - previousValue,
      };
    });
  const activities = [...bootstrap.activity.items]
    .sort((left, right) => left.occurred_at.localeCompare(right.occurred_at))
    .map((item) => mapActivity(item, names))
    .filter((item): item is ActivityEvent => item !== null);
  const prices = Object.fromEntries(
    bootstrap.market.map((listing) => [listing.id, dollars(listing.current_price_cents)]),
  );
  const instruments = bootstrap.portfolio.instruments;
  const nextDate = bootstrap.game.next_game_date;
  const state: GameState = {
    version: GAME_STATE_VERSION,
    cash: dollars(bootstrap.portfolio.cash_cents),
    prices,
    holdings: mapPortfolioHoldings(bootstrap.portfolio),
    settledDates,
    settledPlayerWeeks,
    weeklyShorts: mapWeeklyShorts(bootstrap.portfolio),
    boosts: mapBoosts(bootstrap.portfolio),
    activity: activities,
    portfolioHistory,
    transitionCount: bootstrap.portfolio.version,
  };

  return {
    state,
    portfolioValuation: mapPortfolioValuation(bootstrap.portfolio),
    players,
    leaderboard: mapLeaderboard(bootstrap.leaderboard),
    playerTrends,
    nextGameDate: nextDate,
    settledGameDateCount: bootstrap.game.version,
    latestSettledDate,
    currentWeek: nextDate === null ? null : weekKey(nextDate),
    isComplete: bootstrap.game.is_complete,
    displayName: bootstrap.portfolio.display_name,
    shortSlots: {
      used: instruments.weekly_short_slots.used,
      total: instruments.weekly_short_slots.limit,
    },
    boostSlots: {
      used: instruments.boost_slots.used,
      total: instruments.boost_slots.limit,
    },
    weeklyShortTargets: mapInstrumentTargets(instruments.weekly_short_targets),
    boostTargets: mapInstrumentTargets(instruments.boost_targets),
    canAdvanceDay: bootstrap.capabilities.can_advance_day,
  };
}

export function serverPortfolioHasActivity(portfolio: ServerPortfolio): boolean {
  return portfolio.version > 0
    || portfolio.holdings.length > 0
    || portfolio.recent_trades.length > 0
    || portfolio.instruments.weekly_shorts.length > 0
    || portfolio.instruments.boosts.length > 0;
}
