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
  STARTING_CASH,
  type ActivityEvent,
  type ActivityKind,
  type GameLeaderboardEntry,
  type GameState,
} from './game';

const CENTS_PER_DOLLAR = 100;
const MICROS_PER_POINT = 1_000_000;

export interface ServerPresentationState {
  state: GameState;
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
}

export interface InstrumentTargetView {
  playerId: string;
  gameDate: string;
  fee: number;
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
    id: row.account_id,
    rank: row.rank,
    name: row.display_name,
    value: dollars(row.total_value_cents),
    returnPct: row.return_bps / 100,
    isUser: row.is_current_user,
  }));
}

export function isServerAccountPristine(bootstrap: ServerBootstrap): boolean {
  const { portfolio } = bootstrap;
  return (
    portfolio.version === 0
    && portfolio.cash_cents === STARTING_CASH * CENTS_PER_DOLLAR
    && portfolio.holdings.length === 0
    && portfolio.recent_trades.length === 0
    && portfolio.instruments.weekly_shorts.length === 0
    && portfolio.instruments.boosts.length === 0
    && bootstrap.activity.items.length === 0
  );
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
        ? STARTING_CASH
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
    holdings: bootstrap.portfolio.holdings.map((holding) => ({
      player_id: holding.player_id,
      shares: 1,
      average_price: dollars(holding.average_cost_cents),
      cost_basis: dollars(holding.average_cost_cents),
    })),
    settledDates,
    settledPlayerWeeks,
    weeklyShorts: instruments.weekly_shorts.map((position) => ({
      id: position.id,
      playerId: position.player_id,
      week: weekKey(position.week_start),
      feePaid: dollars(position.fee_cents),
      collateral: dollars(position.collateral_cents),
      accruedNetPoints: position.accrued_net_points_micros / MICROS_PER_POINT,
      qualifyingGames: position.qualifying_games,
      status: position.status,
      payout: position.payout_cents === null ? null : dollars(position.payout_cents),
    })),
    boosts: instruments.boosts.map((position) => ({
      id: position.id,
      playerId: position.player_id,
      week: weekKey(position.week_start),
      gameDate: position.game_date,
      feePaid: dollars(position.fee_cents),
      status: position.status,
      payout: position.payout_cents === null ? 0 : dollars(position.payout_cents),
    })),
    activity: activities,
    portfolioHistory,
    transitionCount: bootstrap.portfolio.version,
  };

  return {
    state,
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
    weeklyShortTargets: instruments.weekly_short_targets.map((target) => ({
      playerId: target.player_id,
      gameDate: target.game_date,
      fee: dollars(target.fee_cents),
    })),
    boostTargets: instruments.boost_targets.map((target) => ({
      playerId: target.player_id,
      gameDate: target.game_date,
      fee: dollars(target.fee_cents),
    })),
  };
}

export function serverPortfolioHasActivity(portfolio: ServerPortfolio): boolean {
  return portfolio.version > 0
    || portfolio.holdings.length > 0
    || portfolio.recent_trades.length > 0
    || portfolio.instruments.weekly_shorts.length > 0
    || portfolio.instruments.boosts.length > 0;
}
