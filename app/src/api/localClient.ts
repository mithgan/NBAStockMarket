import marketSeed from '../data/localMarketSeed.json';
import replaySeed from '../data/localReplaySeed.json';
import { weekStartOf } from '../data/calendar';
import {
  BOOST_FEE_PCT,
  BOOST_MULTIPLIER,
  BOOST_SLOTS,
  DOLLARS_PER_NET_POINT,
  FEE_PCT,
  SHORT_FEE_PCT,
  SHORT_MIN_FEE,
  STARTING_CASH,
  WEEKLY_GAME_CLAMP_NP,
  WEEKLY_SHORT_COLLATERAL,
  WEEKLY_SHORT_SLOTS,
  WEEKLY_TOTAL_CLAMP_NP,
} from '../state/game';
import type {
  InstrumentTarget,
  MarketListing,
  ServerActivity,
  ServerAdvanceResult,
  ServerBootstrap,
  ServerBoost,
  ServerBoostMutationResult,
  ServerGameState,
  ServerHolding,
  ServerLeaderboardRow,
  ServerPortfolio,
  ServerPortfolioPoint,
  ServerResetResult,
  ServerSettledResult,
  ServerSettlement,
  ServerTrade,
  ServerTradeMutationResult,
  ServerWeeklyShort,
  ServerWeeklyShortMutationResult,
} from './contracts';

/**
 * Offline stand-in for MarketApiClient (src/api/client.ts).
 *
 * The public deploy runs without a server: App.tsx hands PortfolioProvider a
 * LocalMarketClient instead, and every screen keeps consuming the exact
 * response shapes from src/api/contracts.ts. The market is a bundled snapshot
 * (localMarketSeed.json) and each night replays a pre-generated season
 * dataset (localReplaySeed.json), so the demo is fully deterministic: the
 * same settled-day count always yields the same dividends and leaderboard.
 * Prices never move — the demo replays payouts, not price action.
 */
const CENTS_PER_DOLLAR = 100;
const MICROS = 1e6;

const SEASON_ID = replaySeed.season_id;
const players = marketSeed.players;
const replayDays = replaySeed.days;
const eventsByDate = new Map(replayDays.map((day) => [day.date, day.events]));
const nameById = new Map(players.map((player) => [player.id, player.name]));

type LocalHolding = {
  playerId: string;
  averageCostCents: number;
};

type LocalState = {
  version: number;
  cashCents: number;
  holdings: LocalHolding[];
  settledDateCount: number;
  trades: ServerTrade[];
  activity: ServerActivity[];
  history: ServerPortfolioPoint[];
  settlements: ServerSettlement[];
  weeklyShorts: ServerWeeklyShort[];
  boosts: ServerBoost[];
  sequence: number;
};

function initialState(): LocalState {
  return {
    version: 0,
    cashCents: STARTING_CASH * CENTS_PER_DOLLAR,
    holdings: [],
    settledDateCount: 0,
    trades: [],
    activity: [],
    history: [],
    settlements: [],
    weeklyShorts: [],
    boosts: [],
    sequence: 0,
  };
}

/** Versioned so a breaking save-shape change can move to a fresh key. */
const STORAGE_KEY = 'nba-stock-market:local-demo:v1';

function priceOf(playerId: string): number {
  return players.find((player) => player.id === playerId)?.current_price_cents ?? 0;
}

function feeOn(amountCents: number, pct: number): number {
  return Math.round(amountCents * pct);
}

export class LocalMarketClient {
  private state = initialState();

  constructor() {
    this.restore();
  }

  /** The sandbox always lets the user advance the replay. */
  readonly canAdvanceSeason = true;

  /**
   * Merge the saved state over the defaults so a save written before a field
   * existed still loads with that field's default instead of `undefined`.
   */
  private restore(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        this.state = { ...initialState(), ...(JSON.parse(raw) as Partial<LocalState>) };
      }
    } catch {
      this.state = initialState();
    }
  }

  /** Best-effort: private browsing or a full quota degrades to in-memory. */
  private persist(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {}
  }

  private nextId(prefix: string): string {
    this.state.sequence += 1;
    return `${prefix}-${this.state.sequence}`;
  }

  /**
   * Deterministic stand-in for a server timestamp: a fixed date carrying the
   * padded mutation sequence, so chronological ordering is stable across
   * reloads without ever reading the wall clock.
   */
  private stamp(): string {
    return `2000-01-01T00:00:${String(this.state.sequence).padStart(6, '0')}Z`;
  }

  private lastSettledDate(): string | null {
    return this.state.settledDateCount === 0
      ? null
      : replayDays[this.state.settledDateCount - 1].date;
  }

  private nextGameDate(): string | null {
    return replayDays[this.state.settledDateCount]?.date ?? null;
  }

  private reservedCollateralCents(): number {
    return this.state.weeklyShorts
      .filter((position) => position.status === 'active')
      .reduce((total, position) => total + position.collateral_cents, 0);
  }

  /** Holdings are always exactly one share, so value is a sum of prices. */
  private marketValueCents(): number {
    return this.state.holdings.reduce((total, holding) => total + priceOf(holding.playerId), 0);
  }

  private holdsPlayer(playerId: string): boolean {
    return this.state.holdings.some((holding) => holding.playerId === playerId);
  }

  private currentWeekStart(): string | null {
    const next = this.nextGameDate();
    return next === null ? null : weekStartOf(next);
  }

  private activeShortCount(): number {
    const weekStart = this.currentWeekStart();
    return this.state.weeklyShorts.filter(
      (position) => position.status === 'active' && position.week_start === weekStart,
    ).length;
  }

  /** Refunded boosts hand their slot back; consumed ones do not. */
  private usedBoostCount(): number {
    const weekStart = this.currentWeekStart();
    return this.state.boosts.filter(
      (boost) => boost.week_start === weekStart && boost.status !== 'refunded',
    ).length;
  }

  private hasOpenPosition(playerId: string): boolean {
    return (
      this.state.weeklyShorts.some(
        (position) => position.player_id === playerId && position.status === 'active',
      ) ||
      this.state.boosts.some(
        (boost) => boost.player_id === playerId && boost.status === 'armed',
      )
    );
  }

  private log(
    kind: string,
    playerId: string,
    amountCents: number,
    gameDate: string | null,
    details: Record<string, unknown> = {},
  ): void {
    this.state.activity.push({
      id: this.nextId('activity'),
      kind,
      player_id: playerId,
      game_date: gameDate,
      amount_cents: amountCents,
      details,
      occurred_at: this.stamp(),
    });
  }

  private listings(): MarketListing[] {
    return players.map((player) => {
      const held = this.holdsPlayer(player.id);
      return {
        id: player.id,
        name: player.name,
        tier: player.tier,
        version: 1,
        current_price_cents: player.current_price_cents,
        opening_price_cents: player.opening_price_cents,
        actual_salary_cents: player.actual_salary_cents,
        shares_outstanding: player.shares_outstanding,
        available_shares: held ? player.shares_outstanding - 1 : player.shares_outstanding,
        buy_fee_cents: feeOn(player.current_price_cents, FEE_PCT),
        // Your single share expressed as basis points of the float.
        ownership_bps: held ? Math.round(10_000 / player.shares_outstanding) : 0,
        volume_30d: 0,
      };
    });
  }

  private holdingRows(): ServerHolding[] {
    return this.state.holdings.map((holding) => {
      const price = priceOf(holding.playerId);
      return {
        player_id: holding.playerId,
        player_name: nameById.get(holding.playerId) ?? holding.playerId,
        shares: 1,
        average_cost_cents: holding.averageCostCents,
        current_price_cents: price,
        market_value_cents: price,
        unrealized_pnl_cents: price - holding.averageCostCents,
      };
    });
  }

  /**
   * Instrument targets for the next game night. Shorts want players you do
   * not hold (mustHold = false); boosts want players you do (mustHold = true).
   */
  private targetsFor(feePct: number, minFeeDollars: number, mustHold: boolean): InstrumentTarget[] {
    const gameDate = this.nextGameDate();
    if (gameDate === null) return [];
    return (eventsByDate.get(gameDate) ?? [])
      .filter((event) => nameById.has(event.player_id))
      .filter((event) => event.qualifies_for_instruments)
      .filter((event) => !this.hasOpenPosition(event.player_id))
      .filter((event) => this.holdsPlayer(event.player_id) === mustHold)
      .map((event) => ({
        player_id: event.player_id,
        game_date: gameDate,
        fee_cents: Math.max(
          feeOn(priceOf(event.player_id), feePct),
          minFeeDollars * CENTS_PER_DOLLAR,
        ),
      }));
  }

  private portfolio(): ServerPortfolio {
    const reserved = this.reservedCollateralCents();
    const marketValue = this.marketValueCents();
    const weekStart = this.currentWeekStart();
    const shortsUsed = this.activeShortCount();
    const boostsUsed = this.usedBoostCount();
    return {
      account_id: 'local-demo',
      display_name: 'You',
      version: this.state.version,
      reset_at: this.stamp(),
      cash_cents: this.state.cashCents,
      free_cash_cents: this.state.cashCents - reserved,
      reserved_collateral_cents: reserved,
      market_value_cents: marketValue,
      total_value_cents: this.state.cashCents + marketValue,
      holdings: this.holdingRows(),
      recent_trades: this.state.trades.slice(-20).reverse(),
      instruments: {
        week_start: weekStart,
        reserved_collateral_cents: reserved,
        free_cash_cents: this.state.cashCents - reserved,
        weekly_short_slots: {
          limit: WEEKLY_SHORT_SLOTS,
          used: shortsUsed,
          remaining: Math.max(0, WEEKLY_SHORT_SLOTS - shortsUsed),
        },
        boost_slots: {
          limit: BOOST_SLOTS,
          used: boostsUsed,
          remaining: Math.max(0, BOOST_SLOTS - boostsUsed),
        },
        weekly_shorts: this.state.weeklyShorts,
        boosts: this.state.boosts,
        weekly_short_targets: this.targetsFor(SHORT_FEE_PCT, SHORT_MIN_FEE, false),
        boost_targets: this.targetsFor(BOOST_FEE_PCT, 0, true),
      },
    };
  }

  private game(): ServerGameState {
    const next = this.nextGameDate();
    return {
      season_id: SEASON_ID,
      last_settled_date: this.lastSettledDate(),
      next_game_date: next,
      // The night's schedule is public before it settles.
      next_game_player_ids: next === null
        ? []
        : (eventsByDate.get(next) ?? []).map((event) => event.player_id),
      is_complete: this.state.settledDateCount >= replayDays.length,
      version: this.state.settledDateCount,
    };
  }

  /**
   * The server twin supports incremental fetches via `settled_results_after`;
   * locally the dataset is already in memory, so just return everything that
   * has settled so far.
   */
  private settledResults(): ServerSettledResult[] {
    const results: ServerSettledResult[] = [];
    for (let day = 0; day < this.state.settledDateCount; day += 1) {
      for (const event of replayDays[day].events) {
        if (nameById.has(event.player_id)) {
          results.push({
            player_id: event.player_id,
            game_date: event.game_date,
            actual_net_points_micros: event.actual_net_points_micros,
            expected_net_points_micros: event.expected_net_points_micros,
            dividend_cents: event.dividend_cents,
          });
        }
      }
    }
    return results;
  }

  /**
   * Rival accounts are pure functions of the settled-day count: a linear
   * drift plus a phase-shifted sine wobble per bot. Reloading never
   * reshuffles the board, and the user's row is ranked among them live.
   */
  private leaderboard(): ServerLeaderboardRow[] {
    const startCents = STARTING_CASH * CENTS_PER_DOLLAR;
    const totalCents = this.state.cashCents + this.marketValueCents();
    const settledDays = this.state.settledDateCount;
    const rows = [
      { name: 'Cap Room Kenny', drift: 0.00042, swing: 0.9 },
      { name: 'The Sixth Man', drift: 0.00031, swing: 1.6 },
      { name: 'Bench Mob', drift: 0.00024, swing: 0.5 },
      { name: 'Two-Way Contract', drift: 0.00012, swing: 2.1 },
      { name: 'Luxury Tax', drift: -0.00008, swing: 1.2 },
      { name: 'Buyout Market', drift: -0.00019, swing: 0.7 },
      { name: 'Tanking On Purpose', drift: -0.00036, swing: 1.9 },
    ].map((rival, index) => {
      const wobble = Math.sin((settledDays + 7 * index) / 5.5) * rival.swing * 0.0009;
      const total = Math.round(startCents * (1 + rival.drift * settledDays + wobble));
      return { name: rival.name, total, isUser: false };
    });
    rows.push({ name: 'You', total: totalCents, isUser: true });
    return rows
      .sort((left, right) => right.total - left.total)
      .map((row, index) => ({
        rank: index + 1,
        display_name: row.name,
        total_value_cents: row.total,
        return_bps: Math.round(((row.total - startCents) / startCents) * 10_000),
        is_current_user: row.isUser,
      }));
  }

  private bootstrapPayload(): ServerBootstrap {
    return {
      market: this.listings(),
      portfolio: this.portfolio(),
      game: this.game(),
      activity: {
        items: this.state.activity.slice(-100),
        next_cursor: null,
      },
      portfolioHistory: {
        items: this.state.history.slice(-200),
        next_cursor: null,
      },
      settlements: this.state.settlements.slice(-30),
      leaderboard: this.leaderboard(),
      settledResults: this.settledResults(),
      capabilities: {
        can_advance_day: true,
      },
    };
  }

  async bootstrap(): Promise<ServerBootstrap> {
    return this.bootstrapPayload();
  }

  async trade(
    playerId: string,
    side: 'buy' | 'sell',
    expectedPlayerVersion: number,
  ): Promise<ServerTradeMutationResult> {
    const price = priceOf(playerId);
    const fee = feeOn(price, FEE_PCT);
    const held = this.holdsPlayer(playerId);
    if (side === 'buy') {
      if (held) throw new Error('You already own this player.');
      if (this.hasOpenPosition(playerId)) {
        throw new Error('An open play blocks buying this player.');
      }
      const reserved = this.reservedCollateralCents();
      if (this.state.cashCents - reserved < price + fee) {
        throw new Error('Not enough free cash for this trade.');
      }
      this.state.cashCents -= price + fee;
      this.state.holdings.push({ playerId, averageCostCents: price + fee });
      this.log('trade_buy', playerId, -(price + fee), null, {
        fee_cents: fee,
        execution_price_cents: price,
      });
    } else {
      if (!held) throw new Error('You do not own this player.');
      if (this.state.boosts.some(
        (boost) => boost.player_id === playerId && boost.status === 'armed',
      )) {
        throw new Error('An armed boost needs this holding.');
      }
      this.state.cashCents += price - fee;
      this.state.holdings = this.state.holdings.filter(
        (holding) => holding.playerId !== playerId,
      );
      this.log('trade_sell', playerId, price - fee, null, {
        fee_cents: fee,
        execution_price_cents: price,
      });
    }
    const trade: ServerTrade = {
      id: this.nextId('trade'),
      player_id: playerId,
      side,
      execution_price_cents: price,
      fee_cents: fee,
      new_price_cents: price,
      created_at: this.stamp(),
    };
    this.state.trades.push(trade);
    this.state.version += 1;
    this.persist();
    return { replayed: false, portfolio: this.portfolio(), trade };
  }

  async armWeeklyShort(
    playerId: string,
    expectedGameDate: string,
    expectedPlayerVersion: number,
  ): Promise<ServerWeeklyShortMutationResult> {
    const weekStart = this.currentWeekStart();
    if (weekStart === null) throw new Error('The replay is complete.');
    if (this.activeShortCount() >= WEEKLY_SHORT_SLOTS) {
      throw new Error('No weekly short slots remain.');
    }
    if (this.hasOpenPosition(playerId) || this.holdsPlayer(playerId)) {
      throw new Error('You already have a position on this player.');
    }
    const price = priceOf(playerId);
    const fee = Math.max(feeOn(price, SHORT_FEE_PCT), SHORT_MIN_FEE * CENTS_PER_DOLLAR);
    const collateral = WEEKLY_SHORT_COLLATERAL * CENTS_PER_DOLLAR;
    // The fee leaves cash now; the collateral stays in cash but is held back
    // from free cash through reservedCollateralCents() until the short exits.
    if (this.state.cashCents - this.reservedCollateralCents() < fee + collateral) {
      throw new Error('Not enough free cash to reserve collateral.');
    }
    this.state.cashCents -= fee;
    const position: ServerWeeklyShort = {
      id: this.nextId('short'),
      player_id: playerId,
      week_start: weekStart,
      status: 'active',
      opening_price_cents: price,
      fee_cents: fee,
      collateral_cents: collateral,
      accrued_net_points_micros: 0,
      qualifying_games: 0,
      payout_cents: null,
      settled_game_date: null,
      created_at: this.stamp(),
    };
    this.state.weeklyShorts.push(position);
    this.log('weekly_short_opened', playerId, -fee, null, { fee_cents: fee });
    this.state.version += 1;
    this.persist();
    return { replayed: false, portfolio: this.portfolio(), position };
  }

  async armBoost(
    playerId: string,
    gameDate: string,
    expectedPlayerVersion: number,
  ): Promise<ServerBoostMutationResult> {
    const weekStart = this.currentWeekStart();
    if (weekStart === null) throw new Error('The replay is complete.');
    if (this.usedBoostCount() >= BOOST_SLOTS) throw new Error('No boost slots remain.');
    if (!this.holdsPlayer(playerId)) throw new Error('You must own a player to boost him.');
    if (this.hasOpenPosition(playerId)) {
      throw new Error('You already have a play on this player.');
    }
    const price = priceOf(playerId);
    const fee = feeOn(price, BOOST_FEE_PCT);
    if (this.state.cashCents - this.reservedCollateralCents() < fee) {
      throw new Error('Not enough free cash for the boost fee.');
    }
    this.state.cashCents -= fee;
    const position: ServerBoost = {
      id: this.nextId('boost'),
      player_id: playerId,
      week_start: weekStart,
      game_date: gameDate,
      status: 'armed',
      opening_price_cents: price,
      fee_cents: fee,
      payout_cents: null,
      settled_game_date: null,
      created_at: this.stamp(),
    };
    this.state.boosts.push(position);
    this.log('boost_armed', playerId, -fee, gameDate, { fee_cents: fee });
    this.state.version += 1;
    this.persist();
    return { replayed: false, portfolio: this.portfolio(), position };
  }

  /**
   * Settle the next replay night: pay dividends on holdings, resolve boosts
   * armed for tonight, accrue weekly shorts, and — when the coming date
   * crosses a week boundary — settle or void the week's shorts.
   */
  async advanceDay(expectedGameDate: string): Promise<ServerAdvanceResult> {
    const gameDate = this.nextGameDate();
    if (gameDate === null) throw new Error('The replay is complete.');
    const events = eventsByDate.get(gameDate) ?? [];
    const eventByPlayer = new Map(events.map((event) => [event.player_id, event]));

    let dividendCents = 0;
    let boostCents = 0;
    let shortCents = 0;
    let payoutCount = 0;

    for (const holding of this.state.holdings) {
      const event = eventByPlayer.get(holding.playerId);
      if (event) {
        dividendCents += event.dividend_cents;
        payoutCount += 1;
        this.log('dividend', holding.playerId, event.dividend_cents, gameDate);
      }
    }

    for (const boost of this.state.boosts) {
      if (boost.status !== 'armed' || boost.game_date !== gameDate) continue;
      const event = eventByPlayer.get(boost.player_id);
      if (!event) {
        // The player never took the floor tonight: hand the fee back.
        boost.status = 'refunded';
        boost.settled_game_date = gameDate;
        this.state.cashCents += boost.fee_cents;
        this.log('boost_refunded', boost.player_id, boost.fee_cents, gameDate);
        continue;
      }
      // The base dividend was already paid above; a boost adds the extra
      // multiples on top.
      const payout = event.dividend_cents * (BOOST_MULTIPLIER - 1);
      boost.status = 'consumed';
      boost.payout_cents = payout;
      boost.settled_game_date = gameDate;
      boostCents += payout;
      this.log('boost_consumed', boost.player_id, payout, gameDate);
    }

    for (const position of this.state.weeklyShorts) {
      if (position.status !== 'active') continue;
      const event = eventByPlayer.get(position.player_id);
      if (event && event.qualifies_for_instruments) {
        const surprise = event.actual_net_points_micros - event.expected_net_points_micros;
        const gameClamp = WEEKLY_GAME_CLAMP_NP * MICROS;
        position.accrued_net_points_micros += Math.max(-gameClamp, Math.min(gameClamp, surprise));
        position.qualifying_games += 1;
      }
      // The short stays open while the next replay date is still inside its
      // week; it settles on the week's final game night.
      const nextDate = replayDays[this.state.settledDateCount + 1]?.date ?? null;
      const weekContinues = nextDate !== null && weekStartOf(nextDate) === position.week_start;
      if (weekContinues) continue;
      if (position.qualifying_games === 0) {
        position.status = 'voided';
        position.settled_game_date = gameDate;
        this.state.cashCents += position.fee_cents;
        this.log('weekly_short_voided', position.player_id, position.fee_cents, gameDate);
        continue;
      }
      const totalClamp = WEEKLY_TOTAL_CLAMP_NP * MICROS;
      const clamped = Math.max(
        -totalClamp,
        Math.min(totalClamp, position.accrued_net_points_micros),
      );
      // Underperformance (negative accrued surprise) pays the short.
      const payout = Math.round((-clamped / MICROS) * DOLLARS_PER_NET_POINT * CENTS_PER_DOLLAR);
      position.status = 'settled';
      position.payout_cents = payout;
      position.settled_game_date = gameDate;
      shortCents += payout;
      this.log('weekly_short_settled', position.player_id, payout, gameDate);
    }

    const netCash = dividendCents + boostCents + shortCents;
    this.state.cashCents += netCash;
    this.state.settledDateCount += 1;
    this.state.version += 1;

    const reserved = this.reservedCollateralCents();
    const marketValue = this.marketValueCents();
    this.state.history.push({
      game_date: gameDate,
      cash_cents: this.state.cashCents,
      free_cash_cents: this.state.cashCents - reserved,
      reserved_collateral_cents: reserved,
      market_value_cents: marketValue,
      total_value_cents: this.state.cashCents + marketValue,
      created_at: this.stamp(),
    });
    this.state.settlements.push({
      game_date: gameDate,
      event_count: events.length,
      payout_count: payoutCount,
      net_cash_cents: netCash,
      current_user_dividend_cents: dividendCents,
      settled_at: this.stamp(),
    });
    this.persist();
    return {
      replayed: false,
      game_date: gameDate,
      next_game_date: this.nextGameDate(),
      is_complete: this.state.settledDateCount >= replayDays.length,
      event_count: events.length,
      payout_count: payoutCount,
      net_cash_cents: netCash,
      cash_breakdown_cents: {
        dividends: dividendCents,
        boosts: boostCents,
        weekly_shorts: shortCents,
      },
    };
  }

  /** Wipe the account but keep the world: the replay stays where it was. */
  async resetAccount(expectedAccountVersion: number): Promise<ServerResetResult> {
    const settledDateCount = this.state.settledDateCount;
    this.state = { ...initialState(), settledDateCount };
    this.persist();
    return { replayed: false, portfolio: this.portfolio(), reset_at: this.stamp() };
  }

  /** Rewind everything to opening night. */
  async resetSeason(): Promise<void> {
    this.state = initialState();
    this.persist();
  }
}
