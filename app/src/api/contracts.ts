export class ContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractError';
  }
}

export interface MarketListing {
  id: string;
  name: string;
  tier: string;
  version: number;
  current_price_cents: number;
  opening_price_cents: number;
  actual_salary_cents: number;
  shares_outstanding: number;
  available_shares: number;
  buy_fee_cents: number;
  ownership_bps: number;
  volume_30d: number;
}

export interface ServerHolding {
  player_id: string;
  player_name: string;
  shares: number;
  average_cost_cents: number;
  current_price_cents: number;
  market_value_cents: number;
  unrealized_pnl_cents: number;
  /** Account-specific dividends received from this player in the active season. */
  season_dividend_cents: number | null;
}

export interface ServerTrade {
  id: string;
  player_id: string;
  side: 'buy' | 'sell';
  execution_price_cents: number;
  fee_cents: number;
  new_price_cents: number;
  created_at: string;
}

export interface ServerWeeklyShort {
  id: string;
  player_id: string;
  week_start: string;
  status: 'active' | 'settled' | 'voided';
  opening_price_cents: number;
  fee_cents: number;
  collateral_cents: number;
  accrued_net_points_micros: number;
  qualifying_games: number;
  payout_cents: number | null;
  settled_game_date: string | null;
  created_at: string;
}

export interface ServerBoost {
  id: string;
  player_id: string;
  week_start: string;
  game_date: string;
  status: 'armed' | 'consumed' | 'refunded';
  opening_price_cents: number;
  fee_cents: number;
  payout_cents: number | null;
  settled_game_date: string | null;
  created_at: string;
}

export interface SlotSummary {
  limit: number;
  used: number;
  remaining: number;
}

export interface InstrumentTarget {
  player_id: string;
  game_date: string;
  fee_cents: number;
}

export interface InstrumentSummary {
  week_start: string | null;
  reserved_collateral_cents: number;
  free_cash_cents: number;
  weekly_short_slots: SlotSummary;
  boost_slots: SlotSummary;
  weekly_shorts: ServerWeeklyShort[];
  boosts: ServerBoost[];
  weekly_short_targets: InstrumentTarget[];
  boost_targets: InstrumentTarget[];
}

export interface ServerPortfolio {
  account_id: string;
  display_name: string;
  version: number;
  reset_at: string;
  cash_cents: number;
  free_cash_cents: number;
  reserved_collateral_cents: number;
  market_value_cents: number;
  total_value_cents: number;
  holdings: ServerHolding[];
  recent_trades: ServerTrade[];
  instruments: InstrumentSummary;
}

export interface ServerGameState {
  season_id: string;
  last_settled_date: string | null;
  next_game_date: string | null;
  /** Players scheduled on next_game_date — public schedule, not lookahead. */
  next_game_player_ids?: string[];
  /** Pregame projections for that date — the number each player must beat. */
  next_game_projections?: { player_id: string; expected_net_points_micros: number }[];
  is_complete: boolean;
  version: number;
}

export interface ServerActivity {
  id: string;
  kind: string;
  player_id: string | null;
  game_date: string | null;
  amount_cents: number;
  details: Record<string, unknown>;
  occurred_at: string;
}

export interface ServerPortfolioPoint {
  game_date: string;
  cash_cents: number;
  free_cash_cents: number;
  reserved_collateral_cents: number;
  market_value_cents: number;
  total_value_cents: number;
  created_at: string;
}

export interface ServerSettlement {
  game_date: string;
  event_count: number;
  payout_count: number;
  net_cash_cents: number;
  current_user_dividend_cents: number;
  settled_at: string;
}

export interface ServerSettledResult {
  player_id: string;
  game_date: string;
  actual_net_points_micros: number;
  expected_net_points_micros: number;
  dividend_cents: number;
}

export interface ServerLeaderboardRow {
  rank: number;
  display_name: string;
  total_value_cents: number;
  return_bps: number;
  is_current_user: boolean;
}

export interface MarketCapabilities {
  can_advance_day: boolean;
}

export interface CursorPage<T> {
  items: T[];
  next_cursor: string | null;
}

export interface ServerMutationResult {
  replayed: boolean;
  portfolio: ServerPortfolio;
}

export interface ServerTradeMutationResult extends ServerMutationResult {
  trade: ServerTrade;
}

export interface ServerWeeklyShortMutationResult extends ServerMutationResult {
  position: ServerWeeklyShort;
}

export interface ServerBoostMutationResult extends ServerMutationResult {
  position: ServerBoost;
}

export interface ServerResetResult extends ServerMutationResult {
  reset_at: string;
}

export interface ServerAdvanceResult {
  replayed: boolean;
  game_date: string;
  next_game_date: string | null;
  is_complete: boolean;
  event_count: number;
  payout_count: number;
  net_cash_cents: number;
  cash_breakdown_cents: {
    dividends: number;
    boosts: number;
    weekly_shorts: number;
  };
}

export interface ServerBootstrap {
  market: MarketListing[];
  portfolio: ServerPortfolio;
  game: ServerGameState;
  activity: CursorPage<ServerActivity>;
  portfolioHistory: CursorPage<ServerPortfolioPoint>;
  settlements: ServerSettlement[];
  leaderboard: ServerLeaderboardRow[];
  settledResults: ServerSettledResult[];
  capabilities: MarketCapabilities;
}

// Per-game economy v2 intentionally lives beside the legacy asset-market
// contract while the backend rolls out. The app runtime below consumes only
// these types and never coerces a v1 response into the new economy.
export type DividendBasis = 'raw_net_points' | 'surprise_vs_projection';
export type PerGamePositionSide = 'long' | 'short';
export type PerGamePositionStatus = 'active' | 'closed';
export type PerGameResultKind = 'base' | 'correction';
export type PerGameResultStatus = 'settled' | 'unsettled' | 'unsettled_missing_projection';
export type PerGameLedgerKind =
  | 'game_cost'
  | 'game_dividend'
  | 'dividend_correction'
  | 'open_fee'
  | 'drop_fee'
  // The frozen fixture uses the generic names while the additive API uses the
  // more explicit values above. Both sets remain finite and validated.
  | 'dividend'
  | 'correction'
  | 'fee'
  | 'penalty';

export interface PerGameRuleset {
  id: string;
  version: number;
  allowOpposingPositions: boolean;
  rosterMutationsLocked: boolean;
  rosterLockGameDate: string | null;
  dividendBasis: DividendBasis;
  dividendDollarsPerNetPoint: number;
  longSlotLimit: number;
  shortSlotLimit: number;
  quoteAddImpactBps: number;
  quoteDropImpactBps: number;
  transactionFeeDollars: number;
  shortTermDays: number | null;
}

export interface PerGameMarketPlayer {
  playerId: string;
  name: string;
  tier: string;
  quoteVersion: number;
  currentGameCost: number;
  priorSeasonValuePerGame: number | null;
}

export interface PerGameSlotSummary {
  used: number;
  limit: number;
  remaining: number;
}

export interface PerGameAccount {
  accountId: string;
  displayName: string;
  version: number;
  cumulativePnl: number;
  latestGamePnl: number;
  longSlots: PerGameSlotSummary;
  shortSlots: PerGameSlotSummary;
}

export interface PerGamePosition {
  positionId: string;
  playerId: string;
  playerName: string;
  side: PerGamePositionSide;
  status: PerGamePositionStatus;
  lockedGameCost: number;
  openedEventSequence: number;
  closedEventSequence: number | null;
  expiresOn: string | null;
  cumulativeGameCost: number;
  cumulativeDividend: number;
  cumulativePnl: number;
}

export interface PerGameState {
  seasonId: string;
  lastSettledDate: string | null;
  nextGameDate: string | null;
  eventCursor: number;
}

export interface PerGameLedgerEntry {
  eventCursor: number;
  entryId: string;
  positionId: string;
  playerId: string;
  gameId: string | null;
  gameDate: string | null;
  resultRevision: number | null;
  kind: PerGameLedgerKind;
  amountDollars: number;
  adjustsEntryId: string | null;
  createdAt: string;
}

export interface PerGameLedgerPage {
  items: PerGameLedgerEntry[];
  nextCursor: number | null;
}

export interface PerGameSettledResult {
  eventCursor: number;
  positionId: string;
  playerId: string;
  gameId: string;
  gameDate: string;
  resultRevision: number;
  side: PerGamePositionSide;
  kind: PerGameResultKind;
  status: PerGameResultStatus;
  lockedGameCost: number;
  dividendDollars: number | null;
  netPnl: number | null;
  adjustsResultRevision: number | null;
}

export interface PerGameLeaderboardRow {
  rank: number;
  entryId: string;
  displayName: string;
  cumulativePnl: number;
  isCurrentUser: boolean;
}

export interface PerGameCapabilities {
  canOpenLong: boolean;
  canOpenShort: boolean;
  canAdvanceReplay: boolean;
}

export interface PerGameBootstrap {
  ruleset: PerGameRuleset;
  market: PerGameMarketPlayer[];
  account: PerGameAccount;
  positions: PerGamePosition[];
  game: PerGameState;
  ledger: PerGameLedgerPage;
  settledResults: PerGameSettledResult[];
  leaderboard: PerGameLeaderboardRow[];
  capabilities: PerGameCapabilities;
}

export interface PerGamePositionMutationResult {
  replayed: boolean;
  accountVersion: number;
  positionId: string;
  playerId: string;
  side: PerGamePositionSide;
  lockedGameCost: number;
  quoteVersion: number;
  currentGameCost: number;
}

export interface PerGameOpenPositionIntent {
  playerId: string;
  playerName: string;
  side: PerGamePositionSide;
  expectedQuoteVersion: number;
}

export interface PerGameOpenPositionRequest {
  playerId: string;
  side: PerGamePositionSide;
  expectedAccountVersion: number;
  expectedQuoteVersion: number;
}

export interface PerGameClosePositionMutationResult {
  replayed: boolean;
  accountVersion: number;
  positionId: string;
  playerId: string;
  side: PerGamePositionSide;
  closedEventSequence: number;
  quoteVersion: number;
  currentGameCost: number;
}

type Parser<T> = (value: unknown, path?: string) => T;

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContractError(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new ContractError(`${path} must be a string.`);
  return value;
}

function nullableText(value: unknown, path: string): string | null {
  return value === null ? null : text(value, path);
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/;

function isoDate(value: unknown, path: string): string {
  const parsed = text(value, path);
  const match = ISO_DATE_PATTERN.exec(parsed);
  if (!match) throw new ContractError(`${path} must be an ISO calendar date.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year === 0 || month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) {
    throw new ContractError(`${path} must be an ISO calendar date.`);
  }
  return parsed;
}

function nullableIsoDate(value: unknown, path: string): string | null {
  return value === null ? null : isoDate(value, path);
}

function isoTimestamp(value: unknown, path: string): string {
  const parsed = text(value, path);
  const match = ISO_TIMESTAMP_PATTERN.exec(parsed);
  if (!match) throw new ContractError(`${path} must be an ISO timestamp with a timezone.`);
  isoDate(match[1], `${path} date`);
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4]);
  const offsetHour = match[6] === undefined ? 0 : Number(match[6]);
  const offsetMinute = match[7] === undefined ? 0 : Number(match[7]);
  if (
    hour > 23
    || minute > 59
    || second > 59
    || offsetHour > 23
    || offsetMinute > 59
    || !Number.isFinite(Date.parse(parsed))
  ) {
    throw new ContractError(`${path} must be an ISO timestamp with a timezone.`);
  }
  return parsed;
}

function integer(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new ContractError(`${path} must be a safe integer.`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  const parsed = integer(value, path);
  if (parsed < 0) throw new ContractError(`${path} must be non-negative.`);
  return parsed;
}

function flag(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new ContractError(`${path} must be a boolean.`);
  return value;
}

function parseCashBreakdown(
  value: unknown,
  path: string,
): ServerAdvanceResult['cash_breakdown_cents'] {
  const row = record(value, path);
  return {
    dividends: integer(row.dividends, `${path}.dividends`),
    boosts: integer(row.boosts, `${path}.boosts`),
    weekly_shorts: integer(row.weekly_shorts, `${path}.weekly_shorts`),
  };
}

function list<T>(value: unknown, path: string, parser: Parser<T>): T[] {
  if (!Array.isArray(value)) throw new ContractError(`${path} must be an array.`);
  return value.map((item, index) => parser(item, `${path}[${index}]`));
}

function oneOf<T extends string>(value: unknown, path: string, options: readonly T[]): T {
  const parsed = text(value, path);
  if (!options.includes(parsed as T)) {
    throw new ContractError(`${path} has an unsupported value.`);
  }
  return parsed as T;
}

export function parseDataEnvelope<T>(value: unknown, parser: Parser<T>): T {
  const envelope = record(value, 'response');
  if (!Object.prototype.hasOwnProperty.call(envelope, 'data')) {
    throw new ContractError('response.data is missing.');
  }
  return parser(envelope.data, 'response.data');
}

export function parseMarketListing(value: unknown, path = 'listing'): MarketListing {
  const row = record(value, path);
  return {
    id: text(row.id, `${path}.id`),
    name: text(row.name, `${path}.name`),
    tier: text(row.tier, `${path}.tier`),
    version: nonNegativeInteger(row.version, `${path}.version`),
    current_price_cents: nonNegativeInteger(row.current_price_cents, `${path}.current_price_cents`),
    opening_price_cents: nonNegativeInteger(row.opening_price_cents, `${path}.opening_price_cents`),
    actual_salary_cents: nonNegativeInteger(row.actual_salary_cents, `${path}.actual_salary_cents`),
    shares_outstanding: nonNegativeInteger(row.shares_outstanding, `${path}.shares_outstanding`),
    available_shares: nonNegativeInteger(row.available_shares, `${path}.available_shares`),
    buy_fee_cents: nonNegativeInteger(row.buy_fee_cents, `${path}.buy_fee_cents`),
    ownership_bps: nonNegativeInteger(row.ownership_bps, `${path}.ownership_bps`),
    volume_30d: nonNegativeInteger(row.volume_30d, `${path}.volume_30d`),
  };
}

function parseHolding(value: unknown, path = 'holding'): ServerHolding {
  const row = record(value, path);
  return {
    player_id: text(row.player_id, `${path}.player_id`),
    player_name: text(row.player_name, `${path}.player_name`),
    shares: nonNegativeInteger(row.shares, `${path}.shares`),
    average_cost_cents: nonNegativeInteger(row.average_cost_cents, `${path}.average_cost_cents`),
    current_price_cents: nonNegativeInteger(row.current_price_cents, `${path}.current_price_cents`),
    market_value_cents: nonNegativeInteger(row.market_value_cents, `${path}.market_value_cents`),
    unrealized_pnl_cents: integer(row.unrealized_pnl_cents, `${path}.unrealized_pnl_cents`),
    // Null keeps an older backend from being presented as a real $0 result
    // while frontend and backend deployments roll independently.
    season_dividend_cents: row.season_dividend_cents === undefined
      ? null
      : nullableInteger(row.season_dividend_cents, `${path}.season_dividend_cents`),
  };
}

export function parseTrade(value: unknown, path = 'trade'): ServerTrade {
  const row = record(value, path);
  return {
    id: text(row.id, `${path}.id`),
    player_id: text(row.player_id, `${path}.player_id`),
    side: oneOf(row.side, `${path}.side`, ['buy', 'sell'] as const),
    execution_price_cents: nonNegativeInteger(row.execution_price_cents, `${path}.execution_price_cents`),
    fee_cents: nonNegativeInteger(row.fee_cents, `${path}.fee_cents`),
    new_price_cents: nonNegativeInteger(row.new_price_cents, `${path}.new_price_cents`),
    created_at: isoTimestamp(row.created_at, `${path}.created_at`),
  };
}

function nullableInteger(value: unknown, path: string): number | null {
  return value === null ? null : integer(value, path);
}

export function parseWeeklyShort(value: unknown, path = 'weekly_short'): ServerWeeklyShort {
  const row = record(value, path);
  return {
    id: text(row.id, `${path}.id`),
    player_id: text(row.player_id, `${path}.player_id`),
    week_start: isoDate(row.week_start, `${path}.week_start`),
    status: oneOf(row.status, `${path}.status`, ['active', 'settled', 'voided'] as const),
    opening_price_cents: nonNegativeInteger(row.opening_price_cents, `${path}.opening_price_cents`),
    fee_cents: nonNegativeInteger(row.fee_cents, `${path}.fee_cents`),
    collateral_cents: nonNegativeInteger(row.collateral_cents, `${path}.collateral_cents`),
    accrued_net_points_micros: integer(row.accrued_net_points_micros, `${path}.accrued_net_points_micros`),
    qualifying_games: nonNegativeInteger(row.qualifying_games, `${path}.qualifying_games`),
    payout_cents: nullableInteger(row.payout_cents, `${path}.payout_cents`),
    settled_game_date: nullableIsoDate(row.settled_game_date, `${path}.settled_game_date`),
    created_at: isoTimestamp(row.created_at, `${path}.created_at`),
  };
}

export function parseBoost(value: unknown, path = 'boost'): ServerBoost {
  const row = record(value, path);
  return {
    id: text(row.id, `${path}.id`),
    player_id: text(row.player_id, `${path}.player_id`),
    week_start: isoDate(row.week_start, `${path}.week_start`),
    game_date: isoDate(row.game_date, `${path}.game_date`),
    status: oneOf(row.status, `${path}.status`, ['armed', 'consumed', 'refunded'] as const),
    opening_price_cents: nonNegativeInteger(row.opening_price_cents, `${path}.opening_price_cents`),
    fee_cents: nonNegativeInteger(row.fee_cents, `${path}.fee_cents`),
    payout_cents: nullableInteger(row.payout_cents, `${path}.payout_cents`),
    settled_game_date: nullableIsoDate(row.settled_game_date, `${path}.settled_game_date`),
    created_at: isoTimestamp(row.created_at, `${path}.created_at`),
  };
}

function parseSlots(value: unknown, path = 'slots'): SlotSummary {
  const row = record(value, path);
  return {
    limit: nonNegativeInteger(row.limit, `${path}.limit`),
    used: nonNegativeInteger(row.used, `${path}.used`),
    remaining: nonNegativeInteger(row.remaining, `${path}.remaining`),
  };
}

function parseInstrumentTarget(value: unknown, path = 'instrument_target'): InstrumentTarget {
  const row = record(value, path);
  return {
    player_id: text(row.player_id, `${path}.player_id`),
    game_date: isoDate(row.game_date, `${path}.game_date`),
    fee_cents: nonNegativeInteger(row.fee_cents, `${path}.fee_cents`),
  };
}

export function parseInstrumentSummary(value: unknown, path = 'instruments'): InstrumentSummary {
  const row = record(value, path);
  return {
    week_start: nullableIsoDate(row.week_start, `${path}.week_start`),
    reserved_collateral_cents: nonNegativeInteger(row.reserved_collateral_cents, `${path}.reserved_collateral_cents`),
    free_cash_cents: integer(row.free_cash_cents, `${path}.free_cash_cents`),
    weekly_short_slots: parseSlots(row.weekly_short_slots, `${path}.weekly_short_slots`),
    boost_slots: parseSlots(row.boost_slots, `${path}.boost_slots`),
    weekly_shorts: list(row.weekly_shorts, `${path}.weekly_shorts`, parseWeeklyShort),
    boosts: list(row.boosts, `${path}.boosts`, parseBoost),
    weekly_short_targets: list(
      row.weekly_short_targets,
      `${path}.weekly_short_targets`,
      parseInstrumentTarget,
    ),
    boost_targets: list(row.boost_targets, `${path}.boost_targets`, parseInstrumentTarget),
  };
}

export function parsePortfolio(value: unknown, path = 'portfolio'): ServerPortfolio {
  const row = record(value, path);
  return {
    account_id: text(row.account_id, `${path}.account_id`),
    display_name: text(row.display_name, `${path}.display_name`),
    version: nonNegativeInteger(row.version, `${path}.version`),
    reset_at: isoTimestamp(row.reset_at, `${path}.reset_at`),
    cash_cents: integer(row.cash_cents, `${path}.cash_cents`),
    free_cash_cents: integer(row.free_cash_cents, `${path}.free_cash_cents`),
    reserved_collateral_cents: nonNegativeInteger(row.reserved_collateral_cents, `${path}.reserved_collateral_cents`),
    market_value_cents: nonNegativeInteger(row.market_value_cents, `${path}.market_value_cents`),
    total_value_cents: integer(row.total_value_cents, `${path}.total_value_cents`),
    holdings: list(row.holdings, `${path}.holdings`, parseHolding),
    recent_trades: list(row.recent_trades, `${path}.recent_trades`, parseTrade),
    instruments: parseInstrumentSummary(row.instruments, `${path}.instruments`),
  };
}

export function parseGameState(value: unknown, path = 'game'): ServerGameState {
  const row = record(value, path);
  return {
    season_id: text(row.season_id, `${path}.season_id`),
    last_settled_date: nullableIsoDate(row.last_settled_date, `${path}.last_settled_date`),
    next_game_date: nullableIsoDate(row.next_game_date, `${path}.next_game_date`),
    ...(Array.isArray(row.next_game_player_ids)
      ? { next_game_player_ids: row.next_game_player_ids.map((id, index) => text(id, `${path}.next_game_player_ids[${index}]`)) }
      : {}),
    ...(Array.isArray(row.next_game_projections)
      ? {
        next_game_projections: row.next_game_projections.map((entry, index) => {
          const projection = record(entry, `${path}.next_game_projections[${index}]`);
          return {
            player_id: text(projection.player_id, `${path}.next_game_projections[${index}].player_id`),
            expected_net_points_micros: integer(projection.expected_net_points_micros, `${path}.next_game_projections[${index}].expected_net_points_micros`),
          };
        }),
      }
      : {}),
    is_complete: flag(row.is_complete, `${path}.is_complete`),
    version: nonNegativeInteger(row.version, `${path}.version`),
  };
}

export function parseActivity(value: unknown, path = 'activity'): ServerActivity {
  const row = record(value, path);
  return {
    id: text(row.id, `${path}.id`),
    kind: text(row.kind, `${path}.kind`),
    player_id: nullableText(row.player_id, `${path}.player_id`),
    game_date: nullableIsoDate(row.game_date, `${path}.game_date`),
    amount_cents: integer(row.amount_cents, `${path}.amount_cents`),
    details: { ...record(row.details, `${path}.details`) },
    occurred_at: isoTimestamp(row.occurred_at, `${path}.occurred_at`),
  };
}

export function parsePortfolioPoint(value: unknown, path = 'history'): ServerPortfolioPoint {
  const row = record(value, path);
  return {
    game_date: isoDate(row.game_date, `${path}.game_date`),
    cash_cents: integer(row.cash_cents, `${path}.cash_cents`),
    free_cash_cents: integer(row.free_cash_cents, `${path}.free_cash_cents`),
    reserved_collateral_cents: nonNegativeInteger(row.reserved_collateral_cents, `${path}.reserved_collateral_cents`),
    market_value_cents: nonNegativeInteger(row.market_value_cents, `${path}.market_value_cents`),
    total_value_cents: integer(row.total_value_cents, `${path}.total_value_cents`),
    created_at: isoTimestamp(row.created_at, `${path}.created_at`),
  };
}

export function parseSettlement(value: unknown, path = 'settlement'): ServerSettlement {
  const row = record(value, path);
  return {
    game_date: isoDate(row.game_date, `${path}.game_date`),
    event_count: nonNegativeInteger(row.event_count, `${path}.event_count`),
    payout_count: nonNegativeInteger(row.payout_count, `${path}.payout_count`),
    net_cash_cents: integer(row.net_cash_cents, `${path}.net_cash_cents`),
    current_user_dividend_cents: integer(row.current_user_dividend_cents, `${path}.current_user_dividend_cents`),
    settled_at: isoTimestamp(row.settled_at, `${path}.settled_at`),
  };
}

export function parseSettledResult(value: unknown, path = 'settled_result'): ServerSettledResult {
  const row = record(value, path);
  return {
    player_id: text(row.player_id, `${path}.player_id`),
    game_date: isoDate(row.game_date, `${path}.game_date`),
    actual_net_points_micros: integer(
      row.actual_net_points_micros,
      `${path}.actual_net_points_micros`,
    ),
    expected_net_points_micros: integer(
      row.expected_net_points_micros,
      `${path}.expected_net_points_micros`,
    ),
    dividend_cents: integer(row.dividend_cents, `${path}.dividend_cents`),
  };
}

export function parseLeaderboardRow(value: unknown, path = 'leaderboard'): ServerLeaderboardRow {
  const row = record(value, path);
  return {
    rank: nonNegativeInteger(row.rank, `${path}.rank`),
    display_name: text(row.display_name, `${path}.display_name`),
    total_value_cents: integer(row.total_value_cents, `${path}.total_value_cents`),
    return_bps: integer(row.return_bps, `${path}.return_bps`),
    is_current_user: flag(row.is_current_user, `${path}.is_current_user`),
  };
}

export function parseCapabilities(
  value: unknown,
  path = 'capabilities',
): MarketCapabilities {
  // The FastAPI backend does not serve capabilities; only the standalone
  // preview server ever did. Absence means "no server-granted advance".
  if (value === undefined || value === null) {
    return { can_advance_day: false };
  }
  const row = record(value, path);
  return {
    can_advance_day: flag(row.can_advance_day, `${path}.can_advance_day`),
  };
}

export function parseBootstrap(value: unknown, path = 'bootstrap'): ServerBootstrap {
  const row = record(value, path);
  return {
    market: list(row.market, `${path}.market`, parseMarketListing),
    portfolio: parsePortfolio(row.portfolio, `${path}.portfolio`),
    game: parseGameState(row.game, `${path}.game`),
    activity: parseCursorPage(row.activity, `${path}.activity`, parseActivity),
    portfolioHistory: parseCursorPage(
      row.portfolio_history,
      `${path}.portfolio_history`,
      parsePortfolioPoint,
    ),
    settlements: list(row.settlements, `${path}.settlements`, parseSettlement),
    leaderboard: list(row.leaderboard, `${path}.leaderboard`, parseLeaderboardRow),
    settledResults: list(
      row.settled_results,
      `${path}.settled_results`,
      parseSettledResult,
    ),
    capabilities: parseCapabilities(row.capabilities, `${path}.capabilities`),
  };
}

export function parseCursorPage<T>(value: unknown, path: string, parser: Parser<T>): CursorPage<T> {
  const row = record(value, path);
  return {
    items: list(row.items, `${path}.items`, parser),
    next_cursor: nullableText(row.next_cursor, `${path}.next_cursor`),
  };
}

export function parseMutationResult(value: unknown, path = 'mutation'): ServerMutationResult {
  const row = record(value, path);
  return {
    replayed: flag(row.replayed, `${path}.replayed`),
    portfolio: parsePortfolio(row.portfolio, `${path}.portfolio`),
  };
}

export function parseTradeMutationResult(
  value: unknown,
  path = 'trade_mutation',
): ServerTradeMutationResult {
  const row = record(value, path);
  return {
    ...parseMutationResult(row, path),
    trade: parseTrade(row.trade, `${path}.trade`),
  };
}

export function parseWeeklyShortMutationResult(
  value: unknown,
  path = 'weekly_short_mutation',
): ServerWeeklyShortMutationResult {
  const row = record(value, path);
  return {
    ...parseMutationResult(row, path),
    position: parseWeeklyShort(row.position, `${path}.position`),
  };
}

export function parseBoostMutationResult(
  value: unknown,
  path = 'boost_mutation',
): ServerBoostMutationResult {
  const row = record(value, path);
  return {
    ...parseMutationResult(row, path),
    position: parseBoost(row.position, `${path}.position`),
  };
}

export function parseResetResult(value: unknown, path = 'reset'): ServerResetResult {
  const row = record(value, path);
  return {
    ...parseMutationResult(row, path),
    reset_at: isoTimestamp(row.reset_at, `${path}.reset_at`),
  };
}

export function parseAdvanceResult(
  value: unknown,
  path = 'advance',
): ServerAdvanceResult {
  const row = record(value, path);
  return {
    replayed: flag(row.replayed, `${path}.replayed`),
    game_date: isoDate(row.game_date, `${path}.game_date`),
    next_game_date: nullableIsoDate(row.next_game_date, `${path}.next_game_date`),
    is_complete: flag(row.is_complete, `${path}.is_complete`),
    event_count: nonNegativeInteger(row.event_count, `${path}.event_count`),
    payout_count: nonNegativeInteger(row.payout_count, `${path}.payout_count`),
    net_cash_cents: integer(row.net_cash_cents, `${path}.net_cash_cents`),
    cash_breakdown_cents: parseCashBreakdown(
      row.cash_breakdown_cents,
      `${path}.cash_breakdown_cents`,
    ),
  };
}

function nullableNonNegativeInteger(value: unknown, path: string): number | null {
  return value === null ? null : nonNegativeInteger(value, path);
}

function positiveInteger(value: unknown, path: string): number {
  const parsed = integer(value, path);
  if (parsed <= 0) throw new ContractError(`${path} must be positive.`);
  return parsed;
}

function nullablePositiveInteger(value: unknown, path: string): number | null {
  return value === null ? null : positiveInteger(value, path);
}

function parsePerGameSlots(value: unknown, path: string): PerGameSlotSummary {
  const row = record(value, path);
  const slots = {
    used: nonNegativeInteger(row.used, `${path}.used`),
    limit: nonNegativeInteger(row.limit, `${path}.limit`),
    remaining: nonNegativeInteger(row.remaining, `${path}.remaining`),
  };
  if (slots.used + slots.remaining !== slots.limit) {
    throw new ContractError(`${path} must reconcile used, remaining, and limit.`);
  }
  return slots;
}

function parsePerGameRuleset(value: unknown, path: string): PerGameRuleset {
  const row = record(value, path);
  return {
    id: text(row.id, `${path}.id`),
    version: positiveInteger(row.version, `${path}.version`),
    // Older frozen v2 fixtures predate this field. Missing policy data must
    // fail closed because the server default also forbids opposing positions.
    allowOpposingPositions: row.allow_opposing_positions === undefined
      ? false
      : flag(row.allow_opposing_positions, `${path}.allow_opposing_positions`),
    rosterMutationsLocked: flag(
      row.roster_mutations_locked,
      `${path}.roster_mutations_locked`,
    ),
    rosterLockGameDate: nullableIsoDate(
      row.roster_lock_game_date,
      `${path}.roster_lock_game_date`,
    ),
    dividendBasis: oneOf(
      row.dividend_basis,
      `${path}.dividend_basis`,
      ['raw_net_points', 'surprise_vs_projection'] as const,
    ),
    dividendDollarsPerNetPoint: nonNegativeInteger(
      row.dividend_dollars_per_net_point,
      `${path}.dividend_dollars_per_net_point`,
    ),
    longSlotLimit: nonNegativeInteger(row.long_slot_limit, `${path}.long_slot_limit`),
    shortSlotLimit: nonNegativeInteger(row.short_slot_limit, `${path}.short_slot_limit`),
    quoteAddImpactBps: nonNegativeInteger(
      row.quote_add_impact_bps,
      `${path}.quote_add_impact_bps`,
    ),
    quoteDropImpactBps: nonNegativeInteger(
      row.quote_drop_impact_bps,
      `${path}.quote_drop_impact_bps`,
    ),
    transactionFeeDollars: nonNegativeInteger(
      row.transaction_fee_dollars,
      `${path}.transaction_fee_dollars`,
    ),
    shortTermDays: nullablePositiveInteger(
      row.short_term_days,
      `${path}.short_term_days`,
    ),
  };
}

export function parsePerGameMarketPlayer(
  value: unknown,
  path = 'market_player',
): PerGameMarketPlayer {
  const row = record(value, path);
  return {
    playerId: text(row.player_id, `${path}.player_id`),
    name: text(row.name, `${path}.name`),
    tier: text(row.tier, `${path}.tier`),
    quoteVersion: nonNegativeInteger(row.quote_version, `${path}.quote_version`),
    currentGameCost: nonNegativeInteger(
      row.current_game_cost_dollars,
      `${path}.current_game_cost_dollars`,
    ),
    priorSeasonValuePerGame: nullableNonNegativeInteger(
      row.prior_season_value_per_game_dollars,
      `${path}.prior_season_value_per_game_dollars`,
    ),
  };
}

export function parsePerGameAccount(value: unknown, path = 'account'): PerGameAccount {
  const row = record(value, path);
  return {
    accountId: text(row.account_id, `${path}.account_id`),
    displayName: text(row.display_name, `${path}.display_name`),
    version: nonNegativeInteger(row.version, `${path}.version`),
    cumulativePnl: integer(row.cumulative_pnl_dollars, `${path}.cumulative_pnl_dollars`),
    latestGamePnl: integer(row.latest_game_pnl_dollars, `${path}.latest_game_pnl_dollars`),
    longSlots: parsePerGameSlots(row.long_slots, `${path}.long_slots`),
    shortSlots: parsePerGameSlots(row.short_slots, `${path}.short_slots`),
  };
}

export function parsePerGamePosition(value: unknown, path = 'position'): PerGamePosition {
  const row = record(value, path);
  const openedEventSequence = nonNegativeInteger(
    row.opened_event_sequence,
    `${path}.opened_event_sequence`,
  );
  const closedEventSequence = nullableNonNegativeInteger(
    row.closed_event_sequence,
    `${path}.closed_event_sequence`,
  );
  if (closedEventSequence !== null && closedEventSequence < openedEventSequence) {
    throw new ContractError(
      `${path}.closed_event_sequence cannot precede the open sequence.`,
    );
  }
  const status = oneOf(row.status, `${path}.status`, ['active', 'closed'] as const);
  const side = oneOf(row.side, `${path}.side`, ['long', 'short'] as const);
  const expiresOn = nullableIsoDate(row.expires_on, `${path}.expires_on`);
  if ((status === 'active') !== (closedEventSequence === null)) {
    throw new ContractError(`${path}.status must agree with its close sequence.`);
  }
  if (side === 'long' && expiresOn !== null) {
    throw new ContractError(`${path}.expires_on is only valid for inverse positions.`);
  }
  return {
    positionId: text(row.position_id, `${path}.position_id`),
    playerId: text(row.player_id, `${path}.player_id`),
    playerName: text(row.player_name, `${path}.player_name`),
    side,
    status,
    lockedGameCost: nonNegativeInteger(
      row.locked_game_cost_dollars,
      `${path}.locked_game_cost_dollars`,
    ),
    openedEventSequence,
    closedEventSequence,
    expiresOn,
    cumulativeGameCost: nonNegativeInteger(
      row.cumulative_game_cost_dollars,
      `${path}.cumulative_game_cost_dollars`,
    ),
    cumulativeDividend: integer(
      row.cumulative_dividend_dollars,
      `${path}.cumulative_dividend_dollars`,
    ),
    cumulativePnl: integer(row.cumulative_pnl_dollars, `${path}.cumulative_pnl_dollars`),
  };
}

function parsePerGameState(value: unknown, path: string): PerGameState {
  const row = record(value, path);
  return {
    seasonId: text(row.season_id, `${path}.season_id`),
    lastSettledDate: nullableIsoDate(row.last_settled_date, `${path}.last_settled_date`),
    nextGameDate: nullableIsoDate(row.next_game_date, `${path}.next_game_date`),
    eventCursor: nonNegativeInteger(row.event_cursor, `${path}.event_cursor`),
  };
}

export function parsePerGameLedgerEntry(
  value: unknown,
  path = 'ledger_entry',
): PerGameLedgerEntry {
  const row = record(value, path);
  return {
    eventCursor: nonNegativeInteger(row.event_cursor, `${path}.event_cursor`),
    entryId: text(row.entry_id, `${path}.entry_id`),
    positionId: text(row.position_id, `${path}.position_id`),
    playerId: text(row.player_id, `${path}.player_id`),
    gameId: nullableText(row.game_id, `${path}.game_id`),
    gameDate: nullableIsoDate(row.game_date, `${path}.game_date`),
    resultRevision: nullablePositiveInteger(row.result_revision, `${path}.result_revision`),
    kind: oneOf(
      row.kind,
      `${path}.kind`,
      [
        'game_cost',
        'game_dividend',
        'dividend_correction',
        'open_fee',
        'drop_fee',
        'dividend',
        'correction',
        'fee',
        'penalty',
      ] as const,
    ),
    amountDollars: integer(row.amount_dollars, `${path}.amount_dollars`),
    adjustsEntryId: nullableText(row.adjusts_entry_id, `${path}.adjusts_entry_id`),
    createdAt: isoTimestamp(row.created_at, `${path}.created_at`),
  };
}

export function parsePerGameSettledResult(
  value: unknown,
  path = 'settled_result_v2',
): PerGameSettledResult {
  const row = record(value, path);
  const kind = oneOf(row.kind, `${path}.kind`, ['base', 'correction'] as const);
  const adjustsResultRevision = nullableInteger(
    row.adjusts_result_revision,
    `${path}.adjusts_result_revision`,
  );
  if (adjustsResultRevision !== null && adjustsResultRevision <= 0) {
    throw new ContractError(`${path}.adjusts_result_revision must be positive when present.`);
  }
  if ((kind === 'correction') !== (adjustsResultRevision !== null)) {
    throw new ContractError(`${path}.kind must agree with its adjusted revision.`);
  }
  return {
    eventCursor: nonNegativeInteger(row.event_cursor, `${path}.event_cursor`),
    positionId: text(row.position_id, `${path}.position_id`),
    playerId: text(row.player_id, `${path}.player_id`),
    gameId: text(row.game_id, `${path}.game_id`),
    gameDate: isoDate(row.game_date, `${path}.game_date`),
    resultRevision: positiveInteger(row.result_revision, `${path}.result_revision`),
    side: oneOf(row.side, `${path}.side`, ['long', 'short'] as const),
    kind,
    status: oneOf(
      row.status,
      `${path}.status`,
      ['settled', 'unsettled', 'unsettled_missing_projection'] as const,
    ),
    lockedGameCost: nonNegativeInteger(
      row.locked_game_cost_dollars,
      `${path}.locked_game_cost_dollars`,
    ),
    dividendDollars: nullableInteger(row.dividend_dollars, `${path}.dividend_dollars`),
    netPnl: nullableInteger(row.net_pnl_dollars, `${path}.net_pnl_dollars`),
    adjustsResultRevision,
  };
}

function parsePerGameLeaderboardRow(
  value: unknown,
  path = 'leaderboard_v2',
): PerGameLeaderboardRow {
  const row = record(value, path);
  return {
    rank: positiveInteger(row.rank, `${path}.rank`),
    entryId: text(row.entry_id, `${path}.entry_id`),
    displayName: text(row.display_name, `${path}.display_name`),
    cumulativePnl: integer(row.cumulative_pnl_dollars, `${path}.cumulative_pnl_dollars`),
    isCurrentUser: flag(row.is_current_user, `${path}.is_current_user`),
  };
}

function parsePerGameCapabilities(value: unknown, path: string): PerGameCapabilities {
  const row = record(value, path);
  return {
    canOpenLong: flag(row.can_open_long, `${path}.can_open_long`),
    canOpenShort: flag(row.can_open_short, `${path}.can_open_short`),
    canAdvanceReplay: flag(row.can_advance_replay, `${path}.can_advance_replay`),
  };
}

export function parsePerGameBootstrap(
  value: unknown,
  path = 'bootstrap_v2',
): PerGameBootstrap {
  const row = record(value, path);
  if (row.schema_version !== 2) {
    throw new ContractError(`${path}.schema_version must be 2.`);
  }
  const ledger = record(row.ledger, `${path}.ledger`);
  const ruleset = parsePerGameRuleset(row.ruleset, `${path}.ruleset`);
  const capabilities = parsePerGameCapabilities(row.capabilities, `${path}.capabilities`);
  if (
    ruleset.rosterMutationsLocked
    && (capabilities.canOpenLong || capabilities.canOpenShort)
  ) {
    throw new ContractError(
      `${path}.capabilities cannot allow roster opens while roster mutations are locked.`,
    );
  }
  return {
    ruleset,
    market: list(row.market, `${path}.market`, parsePerGameMarketPlayer),
    account: parsePerGameAccount(row.account, `${path}.account`),
    positions: list(row.positions, `${path}.positions`, parsePerGamePosition),
    game: parsePerGameState(row.game, `${path}.game`),
    ledger: {
      items: list(ledger.items, `${path}.ledger.items`, parsePerGameLedgerEntry),
      nextCursor: nullableNonNegativeInteger(
        ledger.next_cursor,
        `${path}.ledger.next_cursor`,
      ),
    },
    settledResults: list(
      row.settled_results,
      `${path}.settled_results`,
      parsePerGameSettledResult,
    ),
    leaderboard: list(
      row.leaderboard,
      `${path}.leaderboard`,
      parsePerGameLeaderboardRow,
    ),
    capabilities,
  };
}

export function parsePerGamePositionMutationResult(
  value: unknown,
  path = 'position_mutation_v2',
): PerGamePositionMutationResult {
  const row = record(value, path);
  return {
    replayed: flag(row.replayed, `${path}.replayed`),
    accountVersion: nonNegativeInteger(row.account_version, `${path}.account_version`),
    positionId: text(row.position_id, `${path}.position_id`),
    playerId: text(row.player_id, `${path}.player_id`),
    side: oneOf(row.side, `${path}.side`, ['long', 'short'] as const),
    lockedGameCost: nonNegativeInteger(
      row.locked_game_cost_dollars,
      `${path}.locked_game_cost_dollars`,
    ),
    quoteVersion: nonNegativeInteger(row.quote_version, `${path}.quote_version`),
    currentGameCost: nonNegativeInteger(
      row.current_game_cost_dollars,
      `${path}.current_game_cost_dollars`,
    ),
  };
}

export function parsePerGameClosePositionMutationResult(
  value: unknown,
  path = 'close_position_mutation_v2',
): PerGameClosePositionMutationResult {
  const row = record(value, path);
  return {
    replayed: flag(row.replayed, `${path}.replayed`),
    accountVersion: nonNegativeInteger(row.account_version, `${path}.account_version`),
    positionId: text(row.position_id, `${path}.position_id`),
    playerId: text(row.player_id, `${path}.player_id`),
    side: oneOf(row.side, `${path}.side`, ['long', 'short'] as const),
    closedEventSequence: nonNegativeInteger(
      row.closed_event_sequence,
      `${path}.closed_event_sequence`,
    ),
    quoteVersion: nonNegativeInteger(row.quote_version, `${path}.quote_version`),
    currentGameCost: nonNegativeInteger(
      row.current_game_cost_dollars,
      `${path}.current_game_cost_dollars`,
    ),
  };
}
