export const GAME_STATE_VERSION = 1 as const;
export const STARTING_CASH = 140_000_000;
export const FEE_PCT = 0.0025;
export const IMPACT_K = 0.003;

export const WEEKLY_SHORT_SLOTS = 3;
export const WEEKLY_GAME_CLAMP_NP = 25;
export const WEEKLY_TOTAL_CLAMP_NP = 50;
export const WEEKLY_SHORT_COLLATERAL = 2_000_000;
export const SHORT_FEE_PCT = 0.0025;
export const SHORT_MIN_FEE = 10_000;
export const DOLLARS_PER_NET_POINT = 40_000;

export const BOOST_SLOTS = 2;
export const BOOST_MULTIPLIER = 2;
export const BOOST_FEE_PCT = 0.0025;

const HISTORY_LIMIT = 200;

export interface GamePlayer {
  id: string;
  name: string;
  listing_price: number;
}

export interface SettlementEvent {
  playerId: string;
  date: string;
  actualNetPoints: number;
  expectedNetPoints: number;
  dividendPerHolder: number;
}

export interface GameHolding {
  player_id: string;
  shares: 1;
  average_price: number;
}

export type WeeklyShortStatus = 'active' | 'settled' | 'voided';

export interface WeeklyShortPosition {
  id: string;
  playerId: string;
  week: string;
  feePaid: number;
  collateral: number;
  accruedNetPoints: number;
  qualifyingGames: number;
  status: WeeklyShortStatus;
  payout: number | null;
}

export type BoostStatus = 'armed' | 'consumed' | 'refunded';

export interface BoostPosition {
  id: string;
  playerId: string;
  week: string;
  gameDate: string;
  feePaid: number;
  status: BoostStatus;
  payout: number;
}

export type ActivityKind =
  | 'buy'
  | 'sell'
  | 'dividend'
  | 'weekly-short-armed'
  | 'weekly-short-settled'
  | 'weekly-short-voided'
  | 'boost-armed'
  | 'boost-consumed'
  | 'boost-refunded';

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  playerId: string;
  date: string | null;
  cashDelta: number;
  fee: number;
  price: number | null;
  message: string;
}

export interface PortfolioPoint {
  id: string;
  date: string;
  cash: number;
  marketValue: number;
  totalValue: number;
  dailyChange: number;
}

export interface GameState {
  version: typeof GAME_STATE_VERSION;
  cash: number;
  prices: Record<string, number>;
  holdings: GameHolding[];
  settledDates: string[];
  settledPlayerWeeks: string[];
  weeklyShorts: WeeklyShortPosition[];
  boosts: BoostPosition[];
  activity: ActivityEvent[];
  portfolioHistory: PortfolioPoint[];
  transitionCount: number;
}

export type TradeSide = 'buy' | 'sell';

export interface TransitionResult {
  state: GameState;
  error: string | null;
}

export interface GameSummaryHolding extends GameHolding {
  name: string;
  currentPrice: number;
  costBasis: number;
  marketValue: number;
  unrealizedPnl: number;
}

export interface GameSummary {
  cash: number;
  freeCash: number;
  reservedCollateral: number;
  marketValue: number;
  totalValue: number;
  holdings: GameSummaryHolding[];
  latestDailyChange: number;
}

export interface GameLeaderboardRival {
  name: string;
  value: number;
  dailyChange?: number;
}

export interface GameLeaderboardEntry {
  rank: number;
  name: string;
  value: number;
  returnPct: number;
  isUser: boolean;
}

function failure(state: GameState, error: string): TransitionResult {
  return { state, error };
}

function appendLatest<T>(current: readonly T[], additions: readonly T[]): T[] {
  return [...current, ...additions].slice(-HISTORY_LIMIT);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function hasOwn(record: Record<string, number>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isDateString(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function isoWeekKey(value: string): string | null {
  if (!isDateString(value)) {
    return null;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  const isoDay = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - isoDay);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const weekNumber = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return `${isoYear}-W${String(weekNumber).padStart(2, '0')}`;
}

function isWeekKey(value: string): boolean {
  const match = /^(\d{4})-W(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const weekNumber = Number(match[2]);
  return weekNumber >= 1 && weekNumber <= 53;
}

const activityKinds = new Set<ActivityKind>([
  'buy',
  'sell',
  'dividend',
  'weekly-short-armed',
  'weekly-short-settled',
  'weekly-short-voided',
  'boost-armed',
  'boost-consumed',
  'boost-refunded',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasUniqueStrings(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function isOrderedPrefix(values: readonly string[], expected: readonly string[]): boolean {
  return values.length <= expected.length
    && values.every((value, index) => value === expected[index]);
}

export function isGameState(value: unknown): value is GameState {
  if (!isRecord(value)) return false;
  const state = value as unknown as GameState;
  if (
    state.version !== GAME_STATE_VERSION ||
    !Number.isFinite(state.cash) ||
    !Number.isSafeInteger(state.transitionCount) ||
    state.transitionCount < 0 ||
    !isRecord(state.prices) ||
    Object.keys(state.prices).length === 0 ||
    !Array.isArray(state.holdings) ||
    !Array.isArray(state.settledDates) ||
    !Array.isArray(state.settledPlayerWeeks) ||
    !Array.isArray(state.weeklyShorts) ||
    !Array.isArray(state.boosts) ||
    !Array.isArray(state.activity) ||
    !Array.isArray(state.portfolioHistory)
  ) {
    return false;
  }

  if (!Object.values(state.prices).every(isFinitePositive)) {
    return false;
  }
  const priceIds = new Set(Object.keys(state.prices));
  if (
    !state.settledDates.every(isDateString) ||
    !hasUniqueStrings(state.settledDates) ||
    !state.settledPlayerWeeks.every(
      (key) => typeof key === 'string' && /^\d{4}-W\d{2}:.+$/.test(key),
    ) ||
    !hasUniqueStrings(state.settledPlayerWeeks)
  ) {
    return false;
  }
  if (
    !state.holdings.every(
      (holding) =>
        isRecord(holding) &&
        typeof holding.player_id === 'string' &&
        priceIds.has(holding.player_id) &&
        holding.shares === 1 &&
        Number.isFinite(holding.average_price) &&
        holding.average_price > 0,
    ) ||
    !hasUniqueStrings(state.holdings.map((holding) => holding.player_id))
  ) {
    return false;
  }
  if (
    !state.weeklyShorts.every(
      (position) =>
        isRecord(position) &&
        typeof position.id === 'string' &&
        typeof position.playerId === 'string' &&
        priceIds.has(position.playerId) &&
        typeof position.week === 'string' &&
        isWeekKey(position.week) &&
        Number.isFinite(position.feePaid) &&
        position.feePaid >= 0 &&
        Number.isFinite(position.collateral) &&
        position.collateral >= 0 &&
        Number.isFinite(position.accruedNetPoints) &&
        Number.isSafeInteger(position.qualifyingGames) &&
        position.qualifyingGames >= 0 &&
        ['active', 'settled', 'voided'].includes(position.status) &&
        (position.payout === null || Number.isFinite(position.payout)),
    ) ||
    !hasUniqueStrings(state.weeklyShorts.map((position) => position.id))
  ) {
    return false;
  }
  if (
    !state.boosts.every(
      (position) =>
        isRecord(position) &&
        typeof position.id === 'string' &&
        typeof position.playerId === 'string' &&
        priceIds.has(position.playerId) &&
        typeof position.week === 'string' &&
        isWeekKey(position.week) &&
        typeof position.gameDate === 'string' &&
        isDateString(position.gameDate) &&
        Number.isFinite(position.feePaid) &&
        position.feePaid >= 0 &&
        ['armed', 'consumed', 'refunded'].includes(position.status) &&
        Number.isFinite(position.payout),
    ) ||
    !hasUniqueStrings(state.boosts.map((position) => position.id))
  ) {
    return false;
  }
  if (
    !state.activity.every(
      (item) =>
        isRecord(item) &&
        typeof item.id === 'string' &&
        activityKinds.has(item.kind) &&
        typeof item.playerId === 'string' &&
        priceIds.has(item.playerId) &&
        typeof item.message === 'string' &&
        (item.date === null || typeof item.date === 'string') &&
        Number.isFinite(item.cashDelta) &&
        Number.isFinite(item.fee) &&
        item.fee >= 0 &&
        (item.price === null || Number.isFinite(item.price)),
    ) ||
    !hasUniqueStrings(state.activity.map((item) => item.id))
  ) {
    return false;
  }
  return (
    state.portfolioHistory.every(
      (point) =>
      isRecord(point) &&
      typeof point.id === 'string' &&
      typeof point.date === 'string' &&
      isDateString(point.date) &&
      Number.isFinite(point.cash) &&
      Number.isFinite(point.marketValue) &&
      Number.isFinite(point.totalValue) &&
      Number.isFinite(point.dailyChange),
    ) &&
    hasUniqueStrings(state.portfolioHistory.map((point) => point.id))
  );
}

export function isGameStateForPlayers(
  value: unknown,
  expectedPlayers: readonly GamePlayer[],
  expectedReplayDates: readonly string[],
): value is GameState {
  if (!isGameState(value)) return false;
  const expectedIds = expectedPlayers
    .filter((player) => isFinitePositive(player.listing_price))
    .map((player) => player.id);
  if (!hasUniqueStrings(expectedIds)) return false;
  const actualIds = Object.keys(value.prices);
  return (
    actualIds.length === expectedIds.length
    && expectedIds.every((playerId) => hasOwn(value.prices, playerId))
    && isOrderedPrefix(value.settledDates, expectedReplayDates)
  );
}

function stateHasFiniteValues(state: GameState): boolean {
  return isGameState(state);
}

function transitionActivity(
  state: GameState,
  index: number,
  kind: ActivityKind,
  playerId: string,
  date: string | null,
  cashDelta: number,
  fee: number,
  price: number | null,
  message: string,
): ActivityEvent {
  return {
    id: `${state.transitionCount + 1}:${index}:${kind}:${playerId}:${date ?? 'none'}`,
    kind,
    playerId,
    date,
    cashDelta,
    fee,
    price,
    message,
  };
}

function playerName(players: readonly GamePlayer[], playerId: string): string {
  return players.find((player) => player.id === playerId)?.name ?? playerId;
}

function marketValue(state: Pick<GameState, 'holdings' | 'prices'>): number {
  return state.holdings.reduce(
    (total, holding) => total + (state.prices[holding.player_id] ?? 0),
    0,
  );
}

export function createInitialGameState(players: readonly GamePlayer[]): GameState {
  const uniquePrices = new Map<string, number>();
  for (const player of players) {
    if (
      typeof player.id === 'string' &&
      player.id.length > 0 &&
      isFinitePositive(player.listing_price) &&
      !uniquePrices.has(player.id)
    ) {
      uniquePrices.set(player.id, player.listing_price);
    }
  }

  return {
    version: GAME_STATE_VERSION,
    cash: STARTING_CASH,
    prices: Object.fromEntries(uniquePrices),
    holdings: [],
    settledDates: [],
    settledPlayerWeeks: [],
    weeklyShorts: [],
    boosts: [],
    activity: [],
    portfolioHistory: [],
    transitionCount: 0,
  };
}

export function getFreeCash(state: GameState): number {
  const reservedCollateral = state.weeklyShorts.reduce(
    (total, position) =>
      total + (position.status === 'active' ? position.collateral : 0),
    0,
  );
  return state.cash - reservedCollateral;
}

export function getGameSummary(
  state: GameState,
  players: readonly GamePlayer[],
): GameSummary {
  const names = new Map(players.map((player) => [player.id, player.name]));
  const holdings = state.holdings.map((holding) => {
    const currentPrice = state.prices[holding.player_id] ?? 0;
    const costBasis = holding.average_price * (1 + FEE_PCT);
    return {
      ...holding,
      name: names.get(holding.player_id) ?? holding.player_id,
      currentPrice,
      costBasis,
      marketValue: currentPrice,
      unrealizedPnl: currentPrice - costBasis,
    };
  });
  const heldMarketValue = holdings.reduce(
    (total, holding) => total + holding.marketValue,
    0,
  );
  const freeCash = getFreeCash(state);

  return {
    cash: state.cash,
    freeCash,
    reservedCollateral: state.cash - freeCash,
    marketValue: heldMarketValue,
    totalValue: state.cash + heldMarketValue,
    holdings,
    latestDailyChange:
      state.portfolioHistory[state.portfolioHistory.length - 1]?.dailyChange ?? 0,
  };
}

export function tradePlayer(
  state: GameState,
  player: GamePlayer,
  side: TradeSide,
): TransitionResult {
  if (!stateHasFiniteValues(state)) {
    return failure(state, 'Game state contains non-finite values');
  }
  if (side !== 'buy' && side !== 'sell') {
    return failure(state, 'Trade side must be buy or sell');
  }
  if (!hasOwn(state.prices, player.id)) {
    return failure(state, 'Unknown player');
  }

  const holding = state.holdings.find((item) => item.player_id === player.id);
  const executionPrice = state.prices[player.id];
  const fee = executionPrice * FEE_PCT;
  const direction = side === 'buy' ? 1 : -1;
  const newPrice = executionPrice * Math.exp(IMPACT_K * direction);
  if (!Number.isFinite(newPrice)) {
    return failure(state, 'Price impact produced a non-finite price');
  }

  if (side === 'buy') {
    if (holding) {
      return failure(state, 'One share per player maximum');
    }
    if (
      state.weeklyShorts.some(
        (position) =>
          position.playerId === player.id && position.status === 'active',
      )
    ) {
      return failure(state, 'Cannot buy a player you are shorting');
    }
    const cost = executionPrice + fee;
    if (getFreeCash(state) < cost) {
      return failure(state, 'Not enough free cash');
    }
    const activity = transitionActivity(
      state,
      0,
      'buy',
      player.id,
      state.settledDates[state.settledDates.length - 1] ?? null,
      -cost,
      fee,
      executionPrice,
      `Bought one share of ${player.name}`,
    );
    return {
      state: {
        ...state,
        cash: state.cash - cost,
        prices: { ...state.prices, [player.id]: newPrice },
        holdings: [
          ...state.holdings,
          {
            player_id: player.id,
            shares: 1,
            average_price: executionPrice,
          },
        ],
        activity: appendLatest(state.activity, [activity]),
        transitionCount: state.transitionCount + 1,
      },
      error: null,
    };
  }

  if (!holding) {
    return failure(state, 'No share to sell');
  }
  if (
    state.boosts.some(
      (boost) => boost.playerId === player.id && boost.status === 'armed',
    )
  ) {
    return failure(state, 'Cannot sell a player with an active boost');
  }
  const proceeds = executionPrice - fee;
  const activity = transitionActivity(
    state,
    0,
    'sell',
    player.id,
    state.settledDates[state.settledDates.length - 1] ?? null,
    proceeds,
    fee,
    executionPrice,
    `Sold one share of ${player.name}`,
  );
  return {
    state: {
      ...state,
      cash: state.cash + proceeds,
      prices: { ...state.prices, [player.id]: newPrice },
      holdings: state.holdings.filter((item) => item.player_id !== player.id),
      activity: appendLatest(state.activity, [activity]),
      transitionCount: state.transitionCount + 1,
    },
    error: null,
  };
}

export function armWeeklyShort(
  state: GameState,
  player: GamePlayer,
  week: string,
): TransitionResult {
  if (!stateHasFiniteValues(state)) {
    return failure(state, 'Game state contains non-finite values');
  }
  if (!isWeekKey(week)) {
    return failure(state, 'Invalid week');
  }
  if (!hasOwn(state.prices, player.id)) {
    return failure(state, 'Unknown player');
  }
  if (state.holdings.some((holding) => holding.player_id === player.id)) {
    return failure(state, 'Cannot short a player you hold');
  }
  if (state.settledPlayerWeeks.includes(`${week}:${player.id}`)) {
    return failure(state, 'Player has already played this week');
  }
  if (
    state.boosts.some(
      (boost) =>
        boost.playerId === player.id &&
        boost.week === week &&
        boost.status !== 'refunded',
    )
  ) {
    return failure(state, 'Cannot short a player you boosted this week');
  }
  if (
    state.weeklyShorts.some(
      (position) =>
        position.playerId === player.id && position.status === 'active',
    )
  ) {
    return failure(state, 'Already shorting this player');
  }
  if (
    state.weeklyShorts.filter(
      (position) => position.week === week && position.status === 'active',
    ).length >= WEEKLY_SHORT_SLOTS
  ) {
    return failure(state, 'All weekly short slots are armed');
  }

  const price = state.prices[player.id];
  const fee = Math.max(SHORT_MIN_FEE, SHORT_FEE_PCT * price);
  if (getFreeCash(state) < fee + WEEKLY_SHORT_COLLATERAL) {
    return failure(state, 'Not enough free cash for fee plus collateral');
  }
  const id = `weekly-short:${state.transitionCount + 1}:${week}:${player.id}`;
  const position: WeeklyShortPosition = {
    id,
    playerId: player.id,
    week,
    feePaid: fee,
    collateral: WEEKLY_SHORT_COLLATERAL,
    accruedNetPoints: 0,
    qualifyingGames: 0,
    status: 'active',
    payout: null,
  };
  const activity = transitionActivity(
    state,
    0,
    'weekly-short-armed',
    player.id,
    week,
    -fee,
    fee,
    price,
    `Armed a weekly short on ${player.name}`,
  );
  return {
    state: {
      ...state,
      cash: state.cash - fee,
      weeklyShorts: [...state.weeklyShorts, position],
      activity: appendLatest(state.activity, [activity]),
      transitionCount: state.transitionCount + 1,
    },
    error: null,
  };
}

export function armBoost(
  state: GameState,
  player: GamePlayer,
  gameDate: string,
  week: string,
): TransitionResult {
  if (!stateHasFiniteValues(state)) {
    return failure(state, 'Game state contains non-finite values');
  }
  const targetWeek = isoWeekKey(gameDate);
  if (targetWeek === null) {
    return failure(state, 'Invalid game date');
  }
  if (!isWeekKey(week)) {
    return failure(state, 'Invalid week');
  }
  if (targetWeek !== week) {
    return failure(state, 'Game date does not match week');
  }
  if (state.settledDates.includes(gameDate)) {
    return failure(state, 'This replay date has already been settled');
  }
  if (!hasOwn(state.prices, player.id)) {
    return failure(state, 'Unknown player');
  }
  if (!state.holdings.some((holding) => holding.player_id === player.id)) {
    return failure(state, 'Boosts require holding the player');
  }
  if (
    state.weeklyShorts.some(
      (position) =>
        position.playerId === player.id &&
        position.week === week &&
        position.status === 'active',
    )
  ) {
    return failure(state, 'Cannot boost a player you shorted this week');
  }
  if (
    state.boosts.some(
      (boost) =>
        boost.playerId === player.id &&
        boost.gameDate === gameDate &&
        boost.status !== 'refunded',
    )
  ) {
    return failure(state, 'Already boosting this player for this game');
  }
  if (
    state.boosts.filter(
      (boost) => boost.week === week && boost.status !== 'refunded',
    ).length >= BOOST_SLOTS
  ) {
    return failure(state, 'All boost slots are used this week');
  }

  const price = state.prices[player.id];
  const fee = price * BOOST_FEE_PCT;
  if (getFreeCash(state) < fee) {
    return failure(state, 'Not enough free cash for boost fee');
  }
  const position: BoostPosition = {
    id: `boost:${state.transitionCount + 1}:${gameDate}:${player.id}`,
    playerId: player.id,
    week,
    gameDate,
    feePaid: fee,
    status: 'armed',
    payout: 0,
  };
  const activity = transitionActivity(
    state,
    0,
    'boost-armed',
    player.id,
    gameDate,
    -fee,
    fee,
    price,
    `Boosted ${player.name} for ${gameDate}`,
  );
  return {
    state: {
      ...state,
      cash: state.cash - fee,
      boosts: [...state.boosts, position],
      activity: appendLatest(state.activity, [activity]),
      transitionCount: state.transitionCount + 1,
    },
    error: null,
  };
}

function compareEvents(left: SettlementEvent, right: SettlementEvent): number {
  return (
    left.playerId.localeCompare(right.playerId) ||
    left.date.localeCompare(right.date) ||
    left.actualNetPoints - right.actualNetPoints ||
    left.expectedNetPoints - right.expectedNetPoints ||
    left.dividendPerHolder - right.dividendPerHolder
  );
}

export function advanceReplayDay(
  state: GameState,
  gameDate: string,
  events: readonly SettlementEvent[],
  nextGameDate: string | null,
  players: readonly GamePlayer[],
): TransitionResult {
  if (!stateHasFiniteValues(state)) {
    return failure(state, 'Game state contains non-finite values');
  }
  const currentWeek = isoWeekKey(gameDate);
  if (currentWeek === null) {
    return failure(state, 'Invalid replay date');
  }
  if (state.settledDates.includes(gameDate)) {
    return failure(state, 'This replay date has already been settled');
  }
  const nextWeek = nextGameDate === null ? null : isoWeekKey(nextGameDate);
  if (nextGameDate !== null && nextWeek === null) {
    return failure(state, 'Invalid next replay date');
  }
  if (nextGameDate !== null && nextGameDate <= gameDate) {
    return failure(state, 'Next replay date must be later');
  }
  if (
    !events.every(
      (item) =>
        Number.isFinite(item.actualNetPoints) &&
        Number.isFinite(item.expectedNetPoints) &&
        Number.isFinite(item.dividendPerHolder) &&
        Number.isFinite(item.actualNetPoints - item.expectedNetPoints),
    )
  ) {
    return failure(state, 'Settlement events must contain finite values');
  }
  if (events.some((item) => item.date !== gameDate)) {
    return failure(state, 'Settlement events must match the replay date');
  }

  const uniqueEvents: SettlementEvent[] = [];
  const seenPlayers = new Set<string>();
  for (const item of [...events].sort(compareEvents)) {
    if (!hasOwn(state.prices, item.playerId) || seenPlayers.has(item.playerId)) {
      continue;
    }
    seenPlayers.add(item.playerId);
    uniqueEvents.push(item);
  }

  let cash = state.cash;
  let weeklyShorts = state.weeklyShorts.map((position) => ({ ...position }));
  let boosts = state.boosts.map((position) => ({ ...position }));
  const additions: ActivityEvent[] = [];
  let activityIndex = 0;
  const heldPlayerIds = new Set(
    state.holdings.map((holding) => holding.player_id),
  );

  for (const item of uniqueEvents) {
    const name = playerName(players, item.playerId);
    if (heldPlayerIds.has(item.playerId)) {
      cash += item.dividendPerHolder;
      additions.push(
        transitionActivity(
          state,
          activityIndex,
          'dividend',
          item.playerId,
          gameDate,
          item.dividendPerHolder,
          0,
          state.prices[item.playerId],
          `Settled ${name} dividend`,
        ),
      );
      activityIndex += 1;
    }

    // The committed dividend already includes the rolling projection-bias correction.
    const surprise = item.dividendPerHolder / DOLLARS_PER_NET_POINT;
    const shortAccrual = -clamp(
      surprise,
      -WEEKLY_GAME_CLAMP_NP,
      WEEKLY_GAME_CLAMP_NP,
    );
    weeklyShorts = weeklyShorts.map((position) =>
      position.status === 'active' &&
      position.week === currentWeek &&
      position.playerId === item.playerId
        ? {
            ...position,
            accruedNetPoints: position.accruedNetPoints + shortAccrual,
            qualifyingGames: position.qualifyingGames + 1,
          }
        : position,
    );

    boosts = boosts.map((boost) => {
      if (
        boost.status !== 'armed' ||
        boost.playerId !== item.playerId ||
        boost.gameDate !== gameDate
      ) {
        return boost;
      }
      const payout = (BOOST_MULTIPLIER - 1) * item.dividendPerHolder;
      cash += payout;
      additions.push(
        transitionActivity(
          state,
          activityIndex,
          'boost-consumed',
          item.playerId,
          gameDate,
          payout,
          0,
          state.prices[item.playerId],
          `Settled ${name} boost`,
        ),
      );
      activityIndex += 1;
      return { ...boost, status: 'consumed', payout };
    });
  }

  boosts = boosts.map((boost) => {
    if (boost.status !== 'armed' || boost.gameDate !== gameDate) {
      return boost;
    }
    cash += boost.feePaid;
    additions.push(
      transitionActivity(
        state,
        activityIndex,
        'boost-refunded',
        boost.playerId,
        gameDate,
        boost.feePaid,
        0,
        state.prices[boost.playerId] ?? null,
        `Refunded ${playerName(players, boost.playerId)} boost`,
      ),
    );
    activityIndex += 1;
    return { ...boost, status: 'refunded' };
  });

  const crossesWeekBoundary = nextWeek === null || nextWeek !== currentWeek;
  if (crossesWeekBoundary) {
    boosts = boosts.map((boost) => {
      if (boost.status !== 'armed' || boost.week !== currentWeek) {
        return boost;
      }
      cash += boost.feePaid;
      additions.push(
        transitionActivity(
          state,
          activityIndex,
          'boost-refunded',
          boost.playerId,
          gameDate,
          boost.feePaid,
          0,
          state.prices[boost.playerId] ?? null,
          `Refunded ${playerName(players, boost.playerId)} boost`,
        ),
      );
      activityIndex += 1;
      return { ...boost, status: 'refunded' };
    });

    weeklyShorts = weeklyShorts.map((position) => {
      if (position.status !== 'active' || position.week !== currentWeek) {
        return position;
      }
      if (position.qualifyingGames === 0) {
        cash += position.feePaid;
        additions.push(
          transitionActivity(
            state,
            activityIndex,
            'weekly-short-voided',
            position.playerId,
            gameDate,
            position.feePaid,
            0,
            state.prices[position.playerId] ?? null,
            `Voided ${playerName(players, position.playerId)} weekly short`,
          ),
        );
        activityIndex += 1;
        return { ...position, status: 'voided', payout: 0 };
      }
      const payout =
        clamp(
          position.accruedNetPoints,
          -WEEKLY_TOTAL_CLAMP_NP,
          WEEKLY_TOTAL_CLAMP_NP,
        ) * DOLLARS_PER_NET_POINT;
      cash += payout;
      additions.push(
        transitionActivity(
          state,
          activityIndex,
          'weekly-short-settled',
          position.playerId,
          gameDate,
          payout,
          0,
          state.prices[position.playerId] ?? null,
          `Settled ${playerName(players, position.playerId)} weekly short`,
        ),
      );
      activityIndex += 1;
      return { ...position, status: 'settled', payout };
    });
  }

  const nextStateBase: GameState = {
    ...state,
    cash,
    settledDates: [...state.settledDates, gameDate],
    settledPlayerWeeks: [
      ...new Set([
        ...state.settledPlayerWeeks,
        ...uniqueEvents.map((item) => `${currentWeek}:${item.playerId}`),
      ]),
    ],
    weeklyShorts,
    boosts,
    activity: appendLatest(state.activity, additions),
    transitionCount: state.transitionCount + 1,
    portfolioHistory: state.portfolioHistory,
  };
  const heldMarketValue = marketValue(nextStateBase);
  const historyPoint: PortfolioPoint = {
    id: `portfolio:${gameDate}`,
    date: gameDate,
    cash,
    marketValue: heldMarketValue,
    totalValue: cash + heldMarketValue,
    dailyChange: cash - state.cash,
  };
  const nextState: GameState = {
    ...nextStateBase,
    portfolioHistory: appendLatest(state.portfolioHistory, [historyPoint]),
  };

  if (!stateHasFiniteValues(nextState)) {
    return failure(state, 'Settlement produced non-finite values');
  }
  return { state: nextState, error: null };
}

export function rankGameLeaderboard(
  rivals: readonly GameLeaderboardRival[],
  totalValue: number,
  settledDayCount: number,
): GameLeaderboardEntry[] {
  const dayCount =
    Number.isSafeInteger(settledDayCount) && settledDayCount >= 0
      ? settledDayCount
      : 0;
  const entries: Omit<GameLeaderboardEntry, 'rank'>[] = rivals
    .filter(
      (rival) =>
        Number.isFinite(rival.value) &&
        Number.isFinite(rival.dailyChange ?? 0) &&
        Number.isFinite(rival.value + (rival.dailyChange ?? 0) * dayCount),
    )
    .map((rival) => {
      const value = rival.value + (rival.dailyChange ?? 0) * dayCount;
      return {
        name: rival.name,
        value,
        returnPct: (value / STARTING_CASH - 1) * 100,
        isUser: false,
      };
    });

  if (Number.isFinite(totalValue)) {
    entries.push({
      name: 'You',
      value: totalValue,
      returnPct: (totalValue / STARTING_CASH - 1) * 100,
      isUser: true,
    });
  }

  return entries
    .sort((left, right) => right.value - left.value)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}
