/**
 * Dev-only mock of the per-game API: the real app shell against an in-memory
 * game, reachable only from the `?mock` route in development builds. It parses
 * Ryan's captured Flask fixture through the production contract parser, then
 * plays the actual rules: version-checked opens, slot limits, opposing-position
 * blocks, open/drop fees, short expiry, roster locks, and night-by-night
 * settlements that pay dividend minus locked cost into the ledger.
 *
 * The production route never imports a fake account: this module is reached
 * only through the explicit mock route (see App.tsx), mirroring `?design`.
 */
import fixtureJson from './fixtures/flaskPerGameBootstrap.json';
import {
  parsePerGameBootstrap,
  type PerGameBootstrap,
  type PerGameClosePositionMutationResult,
  type PerGameOpenPositionRequest,
  type PerGamePosition,
  type PerGamePositionMutationResult,
} from './contracts';
import { PerGameApiError } from './perGameClient';
import type { TrendPoint } from '../data/trendPresentation';
import { rosterReopensLine } from '../copy/terms';

/**
 * Practice runs on last season's calendar, so its ledger is stamped in that
 * calendar too: a roster move at midday on the day of the next games, a
 * settlement late that night. Real wall-clock stamps would put a fee in
 * September 2026 beside October 2025 games.
 */
function simulatedTime(day: string, when: 'move' | 'settlement'): string {
  return `${day}T${when === 'move' ? '23:45:00' : '23:30:00'}.000Z`;
}

/** Other players on the practice leaderboard. */
/**
 * Practice's market from the best player down, which sets each price (and so
 * each player's simulated games) and his tier: the top ten are stars, the
 * next twelve starters, the rest role players.
 */
const PRACTICE_QUALITY = [
  'Nikola Jokic', 'Shai Gilgeous-Alexander', 'Giannis Antetokounmpo', 'Luka Doncic',
  'Victor Wembanyama', 'Jalen Brunson', 'Cade Cunningham', 'Karl-Anthony Towns',
  'Donovan Mitchell', 'Kevin Durant', 'Devin Booker', 'Tyrese Maxey', 'Evan Mobley',
  'Kawhi Leonard', 'LaMelo Ball', 'Jamal Murray', 'Bam Adebayo', 'Scottie Barnes',
  'Jaylen Brown', 'Chet Holmgren', "De'Aaron Fox", 'Desmond Bane', 'Derrick White',
  'Amen Thompson', 'Jalen Duren', 'OG Anunoby', 'Dyson Daniels', 'Donovan Clingan',
  'Collin Gillespie', 'Kon Knueppel',
];
/** The best player's price a game; the last on the list costs about a fifth of it. */
const PRACTICE_TOP_PRICE = 462_500;
/** Players with no NBA season before this one. */
const PRACTICE_ROOKIES = new Set(['Kon Knueppel']);

const PRACTICE_RIVALS = ['Fast Break FC', 'Deep Threes', 'Glass Cleaners', 'Pick and Roll Club', 'Bench Mob'];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function addDays(iso: string, days: number): string {
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Deterministic RNG so a mock session replays the same season every reload. */
/** Opening-night eve of the 2025-26 season — the sandbox's Day 0. */
const SANDBOX_OPENING_EVE = '2025-10-20';

function makeRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

/**
 * The seed for a season's nights. Each practice season plays its own games
 * (so "Play another season" is a new season, not a replay); `?mock&seed=42`
 * pins one for a reproducible walk. The market itself is always the same.
 */
function seasonSeed(): number {
  if (typeof window !== 'undefined') {
    const pinned = Number(new URLSearchParams(window.location.search).get('seed'));
    if (Number.isInteger(pinned) && pinned > 0) return pinned;
    return 1 + Math.floor(Math.random() * 2_147_483_000);
  }
  return 20_262_027;
}

export class MockPerGameApiClient {
  private snapshot: PerGameBootstrap;
  private rng = makeRng(seasonSeed());
  private sequence: number;
  private cursor: number;
  private positionCounter = 0;
  /** Full nightly history per listed player, for the in-depth profile. */
  private trendsByPlayer: Record<string, TrendPoint[]> = {};
  /** Each player's last two game days, so his schedule reads like a team's. */
  private recentGamesByPlayer = new Map<string, string[]>();
  /**
   * What each player's games are really worth a game this season: between
   * his opening price and last season's dividend, so the market's "over his
   * price" line is a real (if noisy) signal a player can learn to use.
   */
  private trueValueByPlayer = new Map<string, number>();
  /** Each practice rival's steady lean per night: some climb, some sink. */
  private rivalLeanByEntry = new Map<string, number>();

  /** The sandbox season's opening date, for the sim bar's day counter. */
  seasonStart: string | null;

  constructor() {
    this.seasonStart = null;
    this.snapshot = this.openingSnapshot();
    this.cursor = this.snapshot.game.eventCursor;
    this.sequence = this.cursor;
  }

  /** Restart the season in place — the provider keeps its client reference. */
  reset(): void {
    this.snapshot = this.openingSnapshot();
    this.cursor = this.snapshot.game.eventCursor;
    this.sequence = this.cursor;
    this.positionCounter = 0;
    this.trendsByPlayer = {};
    this.recentGamesByPlayer = new Map();
    this.rng = makeRng(seasonSeed());
  }

  private openingSnapshot(): PerGameBootstrap {
    const parsed = parsePerGameBootstrap(
      (fixtureJson as { data: unknown }).data,
      'mockFixture',
    );
    const snapshot = clone(parsed);
    // The sandbox replays last season's calendar: Day 0 is the eve of the
    // 2025-26 opener (Oct 21, 2025), so the 174-day track walks the real dates.
    snapshot.game = {
      ...snapshot.game,
      seasonId: '2025-26',
      lastSettledDate: SANDBOX_OPENING_EVE,
      nextGameDate: addDays(SANDBOX_OPENING_EVE, 1),
    };
    this.seasonStart = snapshot.game.lastSettledDate ?? snapshot.game.nextGameDate;
    snapshot.capabilities = { ...snapshot.capabilities, canAdvanceReplay: true };
    snapshot.ruleset = {
      ...snapshot.ruleset,
      rosterMutationsLocked: false,
      rosterLockGameDate: null,
    };
    snapshot.account = { ...snapshot.account, displayName: 'You' };
    // A practice season starts everyone at $0, as the Leaders screen says;
    // the fixture's standings belong to the live sample, not to night zero.
    // Rivals get readable names instead of account hashes.
    let rival = 0;
    snapshot.leaderboard = snapshot.leaderboard.map((row, index) => ({
      ...row,
      rank: index + 1,
      displayName: row.isCurrentUser ? 'You' : PRACTICE_RIVALS[rival++ % PRACTICE_RIVALS.length],
      cumulativePnl: row.isCurrentUser ? snapshot.account.cumulativePnl : 0,
    }));
    // Practice prices follow how good each player is, in three tiers, with
    // uneven steps (the fixture prices the list as a $12.5K staircase in
    // alphabetical-ish order, so Jokic was the cheapest player and every
    // "mid" player cost more than every "star"). Games are simulated around
    // each price, so a fair price stays fair. Seeded: every practice season
    // starts from the same market.
    const priceRng = makeRng(20_251_021);
    snapshot.market = snapshot.market.map((player) => {
      const quality = PRACTICE_QUALITY.findIndex((name) => name === player.name);
      if (quality === -1) return player;
      const base = PRACTICE_TOP_PRICE * (1 - (quality / PRACTICE_QUALITY.length) * 0.78);
      const jitter = 1 + (priceRng() - 0.5) * 0.06;
      return {
        ...player,
        tier: quality < 10 ? 'star' : quality < 22 ? 'starter' : 'role',
        currentGameCost: Math.round((base * jitter) / 500) * 500,
      };
    });
    // Last season's value per game, varied per player (the fixture puts every
    // player exactly $20K from his price, which makes a Value sort pointless).
    // A rookie has no last season. Seeded, so every practice season starts
    // from the same market.
    const valueRng = makeRng(20_262_028);
    snapshot.market = snapshot.market.map((player) => {
      if (PRACTICE_ROOKIES.has(player.name)) return { ...player, priorSeasonValuePerGame: null };
      const ratio = 0.82 + valueRng() * 0.36;
      return { ...player, priorSeasonValuePerGame: Math.round((player.currentGameCost * ratio) / 500) * 500 };
    });
    // A player's real worth this season sits a little under halfway from his
    // price to last season's dividend; a rookie's is a coin toss around his
    // price. Fair on average, so a season is won by picking, not by luck.
    this.trueValueByPlayer = new Map(snapshot.market.map((player) => {
      const price = player.currentGameCost;
      const prior = player.priorSeasonValuePerGame;
      const worth = prior === null ? price * (0.94 + valueRng() * 0.12) : price + (prior - price) * 0.3;
      return [player.playerId, worth];
    }));
    // Rivals lean from about +$22K to -$14K a night: the best finish a few
    // million up, the worst a million or two down, so a well-picked roster
    // can win and a careless one ends mid-table or last.
    const rivals = snapshot.leaderboard.filter((row) => !row.isCurrentUser);
    this.rivalLeanByEntry = new Map(rivals.map((row, index) => [
      row.entryId,
      rivals.length > 1 ? Math.round(22_000 - (36_000 * index) / (rivals.length - 1)) : 0,
    ]));
    return snapshot;
  }

  async bootstrap(afterCursor?: number): Promise<PerGameBootstrap> {
    void afterCursor;
    const copy = clone(this.snapshot);
    copy.ledger.nextCursor = null;
    return copy;
  }

  async openPosition({
    playerId,
    side,
    expectedAccountVersion,
    expectedQuoteVersion,
  }: PerGameOpenPositionRequest): Promise<PerGamePositionMutationResult> {
    const state = this.snapshot;
    if (state.ruleset.rosterMutationsLocked) {
      throw new PerGameApiError(
        `Your roster is locked. ${rosterReopensLine(state.ruleset.rosterLockGameDate)}.`,
        'roster_locked',
        423,
      );
    }
    if (expectedAccountVersion !== state.account.version) {
      throw new PerGameApiError('Your account changed. Refresh and retry.', 'account_version_conflict', 409);
    }
    const player = state.market.find((row) => row.playerId === playerId);
    if (!player) {
      throw new PerGameApiError('That player is not listed.', 'player_not_found', 404);
    }
    if (expectedQuoteVersion !== player.quoteVersion) {
      throw new PerGameApiError('The quote moved. Review the new cost and retry.', 'quote_version_conflict', 409);
    }
    const active = state.positions.filter((position) => position.status === 'active');
    if (active.some((position) => position.playerId === playerId && position.side === side)) {
      throw new PerGameApiError('You already hold this position.', 'position_exists', 409);
    }
    if (
      !state.ruleset.allowOpposingPositions
      && active.some((position) => position.playerId === playerId)
    ) {
      throw new PerGameApiError('You already hold the opposing side of this player.', 'opposing_position', 409);
    }
    const slots = side === 'long' ? state.account.longSlots : state.account.shortSlots;
    if (slots.used >= slots.limit) {
      throw new PerGameApiError('Every slot on this side is in use.', 'slots_full', 409);
    }

    this.positionCounter += 1;
    this.sequence += 1;
    const position: PerGamePosition = {
      positionId: `mock-position-${this.positionCounter}`,
      playerId,
      playerName: player.name,
      side,
      status: 'active',
      lockedGameCost: player.currentGameCost,
      openedEventSequence: this.sequence,
      closedEventSequence: null,
      // The last day the short counts: a 7-day short opened before the Oct 21
      // games plays Oct 21-27 and ends when the Oct 27 games are in.
      expiresOn: side === 'short' && state.ruleset.shortTermDays !== null && state.game.nextGameDate
        ? addDays(state.game.nextGameDate, Math.max(0, state.ruleset.shortTermDays - 1))
        : null,
      cumulativeGameCost: 0,
      cumulativeDividend: 0,
      cumulativePnl: 0,
    };
    state.positions.push(position);
    this.appendFee('open_fee', position);
    slots.used += 1;
    slots.remaining = Math.max(0, slots.limit - slots.used);

    const impactBps = side === 'long'
      ? state.ruleset.quoteAddImpactBps
      : -state.ruleset.quoteDropImpactBps;
    player.currentGameCost = Math.max(
      25_000,
      Math.round(player.currentGameCost * (1 + impactBps / 10_000)),
    );
    player.quoteVersion += 1;
    state.account.version += 1;

    return {
      replayed: false,
      accountVersion: state.account.version,
      positionId: position.positionId,
      playerId,
      side,
      lockedGameCost: position.lockedGameCost,
      quoteVersion: player.quoteVersion,
      currentGameCost: player.currentGameCost,
    };
  }

  async closePosition(
    positionId: string,
    expectedAccountVersion: number,
  ): Promise<PerGameClosePositionMutationResult> {
    const state = this.snapshot;
    if (state.ruleset.rosterMutationsLocked) {
      throw new PerGameApiError(
        `Your roster is locked. ${rosterReopensLine(state.ruleset.rosterLockGameDate)}.`,
        'roster_locked',
        423,
      );
    }
    if (expectedAccountVersion !== state.account.version) {
      throw new PerGameApiError('Your account changed. Refresh and retry.', 'account_version_conflict', 409);
    }
    const position = state.positions.find(
      (row) => row.positionId === positionId && row.status === 'active',
    );
    if (!position) {
      throw new PerGameApiError('That position is not open.', 'position_not_found', 404);
    }
    this.sequence += 1;
    position.status = 'closed';
    position.closedEventSequence = this.sequence;
    this.appendFee('drop_fee', position);
    const slots = position.side === 'long' ? state.account.longSlots : state.account.shortSlots;
    slots.used = Math.max(0, slots.used - 1);
    slots.remaining = Math.max(0, slots.limit - slots.used);
    const player = state.market.find((row) => row.playerId === position.playerId);
    if (player) {
      const impactBps = position.side === 'long'
        ? -state.ruleset.quoteDropImpactBps
        : state.ruleset.quoteAddImpactBps;
      player.currentGameCost = Math.max(
        25_000,
        Math.round(player.currentGameCost * (1 + impactBps / 10_000)),
      );
      player.quoteVersion += 1;
    }
    state.account.version += 1;

    return {
      replayed: false,
      accountVersion: state.account.version,
      positionId: position.positionId,
      playerId: position.playerId,
      side: position.side,
      closedEventSequence: this.sequence,
      quoteVersion: player?.quoteVersion ?? 0,
      currentGameCost: player?.currentGameCost ?? position.lockedGameCost,
    };
  }

  /** Settle one night: every active position whose player plays gets paid. */
  /**
   * A believable NBA schedule for one player (walk 4 T1-08: four nights in a
   * row for one, a single game in ten days for another). Never three nights
   * running (after a back-to-back he rests), never more than three days
   * without a game, otherwise a little over half of the game nights. About
   * three or four games a week, like a real team. One roll every night, so
   * a pinned seed stays reproducible.
   */
  private playsTonight(playerId: string, date: string): boolean {
    const roll = this.rng();
    const recent = this.recentGamesByPlayer.get(playerId) ?? [];
    const last = recent[recent.length - 1];
    const before = recent[recent.length - 2];
    const backToBack = last !== undefined && before !== undefined
      && addDays(before, 1) === last && addDays(last, 1) === date;
    const plays = backToBack ? false : last === undefined || addDays(last, 3) <= date ? true : roll < 0.62;
    if (plays) this.recentGamesByPlayer.set(playerId, [...recent.slice(-1), date]);
    return plays;
  }

  advanceNight(): void {
    const state = this.snapshot;
    const date = state.game.nextGameDate;
    if (!date) return;
    // A lock covers one night; tonight's lock ends when tonight's games are in.
    const lockedTonight = state.ruleset.rosterMutationsLocked && state.ruleset.rosterLockGameDate === date;
    state.ruleset.rosterMutationsLocked = false;
    state.ruleset.rosterLockGameDate = null;

    const rate = state.ruleset.dividendDollarsPerNetPoint;
    // One roll per listed player: does he play tonight, and what does he
    // produce? Every played night lands in his trend history, whether or not
    // anyone holds him — the profile chart reads the whole league.
    const actualByPlayer = new Map<string, number>();
    for (const player of state.market) {
      if (!this.playsTonight(player.playerId, date)) continue;
      const expectedNp = (this.trueValueByPlayer.get(player.playerId) ?? player.currentGameCost) / rate;
      // Most nights land within about half his worth either way; now and
      // then a bad night goes below zero, as the rules say it can. Ordinary
      // nights sit about 9% above his worth, which pays for the bad nights:
      // on average a player earns what he is worth (the old draw lost about
      // 9% of the price every game, so every long lost money).
      const swing = (this.rng() + this.rng() + this.rng() - 1.5) * 0.5;
      const badNight = this.rng() < 0.06;
      const rawNp = badNight ? -expectedNp * (0.2 + 0.5 * this.rng()) : expectedNp * (1.093 + swing);
      const actualNp = Math.round(rawNp * 10) / 10;
      actualByPlayer.set(player.playerId, actualNp);
      const trend = this.trendsByPlayer[player.playerId]
        ?? (this.trendsByPlayer[player.playerId] = []);
      trend.push({
        date,
        np: actualNp,
        expected_np: Math.round(expectedNp * 10) / 10,
        dividend_per_holder: Math.round(actualNp * rate) - player.currentGameCost,
      });
    }
    // A short whose term ended before tonight (no games on its last days)
    // closes now, before the games: it never plays past its term.
    for (const position of state.positions) {
      if (position.status !== 'active' || position.expiresOn === null || position.expiresOn >= date) continue;
      this.sequence += 1;
      position.status = 'closed';
      position.closedEventSequence = this.sequence;
      const slots = position.side === 'long' ? state.account.longSlots : state.account.shortSlots;
      slots.used = Math.max(0, slots.used - 1);
      slots.remaining = Math.max(0, slots.limit - slots.used);
    }
    let nightPnl = 0;
    for (const position of state.positions) {
      if (position.status !== 'active') continue;
      const actualNp = actualByPlayer.get(position.playerId);
      if (actualNp === undefined) continue;
      const dividend = Math.round(actualNp * rate);
      const cost = position.lockedGameCost;
      const pnl = position.side === 'long' ? dividend - cost : cost - dividend;

      this.cursor += 1;
      const gameId = `mock-${date}-${position.playerId}`;
      state.ledger.items.push({
        eventCursor: this.cursor,
        entryId: `mock-cost-${this.cursor}`,
        positionId: position.positionId,
        playerId: position.playerId,
        gameId,
        gameDate: date,
        resultRevision: 1,
        kind: 'game_cost',
        amountDollars: position.side === 'long' ? -cost : cost,
        adjustsEntryId: null,
        createdAt: simulatedTime(date, 'settlement'),
      });
      this.cursor += 1;
      state.ledger.items.push({
        eventCursor: this.cursor,
        entryId: `mock-dividend-${this.cursor}`,
        positionId: position.positionId,
        playerId: position.playerId,
        gameId,
        gameDate: date,
        resultRevision: 1,
        kind: 'game_dividend',
        amountDollars: position.side === 'long' ? dividend : -dividend,
        adjustsEntryId: null,
        createdAt: simulatedTime(date, 'settlement'),
      });
      this.cursor += 1;
      state.settledResults.push({
        eventCursor: this.cursor,
        positionId: position.positionId,
        playerId: position.playerId,
        gameId,
        gameDate: date,
        resultRevision: 1,
        side: position.side,
        kind: 'base',
        status: 'settled',
        lockedGameCost: cost,
        dividendDollars: dividend,
        netPnl: pnl,
        adjustsResultRevision: null,
      });
      position.cumulativeGameCost += cost;
      position.cumulativeDividend += dividend;
      position.cumulativePnl += pnl;
      nightPnl += pnl;
    }

    state.account.latestGamePnl = nightPnl;
    state.account.cumulativePnl += nightPnl;

    // A short ends once its last game is in, so its slot is free for the
    // next night's games (no $250 to close a short that is already over).
    this.closeShortsEndedBy(date);

    for (const player of state.market) {
      // Prices wander, and slowly follow what the player is really worth, so
      // a price you locked early can turn out to be a bargain (or not).
      const worth = this.trueValueByPlayer.get(player.playerId) ?? player.currentGameCost;
      const pull = Math.max(-1, Math.min(1, (worth - player.currentGameCost) / player.currentGameCost));
      const drift = 1 + (this.rng() - 0.5) * 0.03 + 0.012 * pull;
      const next = Math.max(25_000, Math.round(player.currentGameCost * drift));
      if (next !== player.currentGameCost) {
        player.currentGameCost = next;
        player.quoteVersion += 1;
      }
    }

    for (const row of state.leaderboard) {
      if (row.isCurrentUser) {
        row.cumulativePnl = state.account.cumulativePnl;
      } else {
        row.cumulativePnl += Math.round((this.rng() - 0.5) * 500_000) + (this.rivalLeanByEntry.get(row.entryId) ?? 0);
      }
    }
    state.leaderboard.sort((left, right) => right.cumulativePnl - left.cumulativePnl);
    state.leaderboard.forEach((row, index) => {
      row.rank = index + 1;
    });

    state.game.lastSettledDate = date;
    state.game.nextGameDate = addDays(date, this.rng() < 0.3 ? 2 : 1);
    state.game.eventCursor = this.cursor;

    // A quarter of nights close with the next slate already locked, so the
    // LOCKED chip and disabled mutation states stay reviewable in the mock.
    // Never two nights in a row: "Moves reopen after <date>" must hold.
    // The opening week never locks: a new player's first nights are for
    // building a roster.
    const openingWeek = this.seasonStart !== null && date < addDays(this.seasonStart, 7);
    if (!lockedTonight && !openingWeek && this.rng() < 0.25) {
      state.ruleset.rosterMutationsLocked = true;
      state.ruleset.rosterLockGameDate = state.game.nextGameDate;
    }
  }

  /**
   * Settle every game night in the next `days` calendar days, then move the
   * clock the full span, so a practice week is seven days on the track even
   * when its last day has no games. Never runs past `lastDay` when given.
   */
  advanceDays(days: number, lastDay?: string | null): void {
    const start = this.snapshot.game.lastSettledDate;
    if (!start || days <= 0) return;
    let target = addDays(start, days);
    if (lastDay && target > lastDay) target = lastDay;
    while (this.snapshot.game.nextGameDate && this.snapshot.game.nextGameDate <= target) {
      this.advanceNight();
    }
    if ((this.snapshot.game.lastSettledDate ?? start) < target) {
      this.snapshot.game.lastSettledDate = target;
      // The clock passed days with no games: a short whose term ended on one
      // of them is over too, not left holding its slot and offering a $250
      // close that changes nothing (walk 4 T2-12).
      this.closeShortsEndedBy(target);
    }
  }

  /** Close every active short whose term ends on or before `date`. */
  private closeShortsEndedBy(date: string): void {
    const state = this.snapshot;
    for (const position of state.positions) {
      if (position.status !== 'active' || position.expiresOn === null || position.expiresOn > date) continue;
      this.sequence += 1;
      position.status = 'closed';
      position.closedEventSequence = this.sequence;
      const slots = position.side === 'long' ? state.account.longSlots : state.account.shortSlots;
      slots.used = Math.max(0, slots.used - 1);
      slots.remaining = Math.max(0, slots.limit - slots.used);
    }
  }

  trendsFor(playerId: string): TrendPoint[] {
    return clone(this.trendsByPlayer[playerId] ?? []);
  }

  private appendFee(kind: 'open_fee' | 'drop_fee', position: PerGamePosition): void {
    const fee = this.snapshot.ruleset.transactionFeeDollars;
    if (fee <= 0) return;
    this.cursor += 1;
    this.snapshot.ledger.items.push({
      eventCursor: this.cursor,
      entryId: `mock-fee-${this.cursor}`,
      positionId: position.positionId,
      playerId: position.playerId,
      gameId: null,
      gameDate: null,
      resultRevision: null,
      kind,
      amountDollars: -fee,
      adjustsEntryId: null,
      // Booked on the day the status bar shows (the move is made after that
      // day's games), so Results files it where the player made it.
      createdAt: simulatedTime(
        this.snapshot.game.lastSettledDate ?? SANDBOX_OPENING_EVE,
        'move',
      ),
    });
    this.snapshot.account.cumulativePnl -= fee;
    this.snapshot.game.eventCursor = this.cursor;
  }
}

let singleton: MockPerGameApiClient | null = null;

export function mockPerGameClient(): MockPerGameApiClient {
  if (!singleton) singleton = new MockPerGameApiClient();
  return singleton;
}

/** True only while the ?mock route has instantiated the sandbox client. */
export function isMockActive(): boolean {
  return singleton !== null;
}

/** Full sandbox nightly history for one player; empty outside the mock. */
export function mockPlayerTrends(playerId: string): TrendPoint[] {
  return singleton ? singleton.trendsFor(playerId) : [];
}

/** The sandbox season's opening date; null outside the mock. */
export function mockSeasonStart(): string | null {
  return singleton?.seasonStart ?? null;
}

/** Settle several game nights in one gesture (+1 night uses one; +1 week uses advanceMockDays). */
export function advanceMockNights(count: number): boolean {
  if (!singleton) return false;
  for (let night = 0; night < count; night += 1) singleton.advanceNight();
  return true;
}

/** Settle a practice span of calendar days (the practice bar's +1 week). */
export function advanceMockDays(days: number, lastDay?: string | null): boolean {
  if (!singleton) return false;
  singleton.advanceDays(days, lastDay);
  return true;
}

/** Restart the sandbox season from the opening snapshot. */
export function resetMock(): boolean {
  if (!singleton) return false;
  singleton.reset();
  return true;
}

/** Called by the status strip's sandbox control; true when a mock is active. */
export function advanceMockNight(): boolean {
  if (!singleton) return false;
  singleton.advanceNight();
  return true;
}
