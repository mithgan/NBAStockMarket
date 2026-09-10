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

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function addDays(iso: string, days: number): string {
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Deterministic RNG so a mock session replays the same season every reload. */
function makeRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

export class MockPerGameApiClient {
  private snapshot: PerGameBootstrap;
  private rng = makeRng(20_262_027);
  private sequence: number;
  private cursor: number;
  private positionCounter = 0;

  constructor() {
    const parsed = parsePerGameBootstrap(
      (fixtureJson as { data: unknown }).data,
      'mockFixture',
    );
    this.snapshot = clone(parsed);
    this.snapshot.capabilities = { ...this.snapshot.capabilities, canAdvanceReplay: true };
    this.snapshot.ruleset = {
      ...this.snapshot.ruleset,
      rosterMutationsLocked: false,
      rosterLockGameDate: null,
    };
    this.snapshot.account = { ...this.snapshot.account, displayName: 'Mock preview' };
    this.cursor = this.snapshot.game.eventCursor;
    this.sequence = this.cursor;
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
      throw new PerGameApiError('Roster changes are locked for the current game.', 'roster_locked', 423);
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
      expiresOn: side === 'short' && state.ruleset.shortTermDays !== null && state.game.nextGameDate
        ? addDays(state.game.nextGameDate, state.ruleset.shortTermDays)
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
      throw new PerGameApiError('Roster changes are locked for the current game.', 'roster_locked', 423);
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
  advanceNight(): void {
    const state = this.snapshot;
    const date = state.game.nextGameDate;
    if (!date) return;
    state.ruleset.rosterMutationsLocked = false;
    state.ruleset.rosterLockGameDate = null;

    const rate = state.ruleset.dividendDollarsPerNetPoint;
    let nightPnl = 0;
    for (const position of state.positions) {
      if (position.status !== 'active') continue;
      if (position.expiresOn !== null && position.expiresOn < date) {
        this.sequence += 1;
        position.status = 'closed';
        position.closedEventSequence = this.sequence;
        const slots = position.side === 'long' ? state.account.longSlots : state.account.shortSlots;
        slots.used = Math.max(0, slots.used - 1);
        slots.remaining = Math.max(0, slots.limit - slots.used);
        continue;
      }
      if (this.rng() > 0.55) continue;
      const player = state.market.find((row) => row.playerId === position.playerId);
      const expectedNp = (player?.currentGameCost ?? position.lockedGameCost) / rate;
      const noise = (this.rng() + this.rng() + this.rng() - 1.5) * 14;
      const actualNp = Math.round((expectedNp + noise) * 10) / 10;
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
        createdAt: new Date().toISOString(),
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
        createdAt: new Date().toISOString(),
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

    for (const player of state.market) {
      const drift = 1 + (this.rng() - 0.5) * 0.04;
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
        row.cumulativePnl += Math.round((this.rng() - 0.48) * 800_000);
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
    if (this.rng() < 0.25) {
      state.ruleset.rosterMutationsLocked = true;
      state.ruleset.rosterLockGameDate = state.game.nextGameDate;
    }
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
      createdAt: new Date().toISOString(),
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

/** Called by the status strip's sandbox control; true when a mock is active. */
export function advanceMockNight(): boolean {
  if (!singleton) return false;
  singleton.advanceNight();
  return true;
}
