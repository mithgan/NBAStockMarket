import type {
  PerGameBootstrap,
  PerGameLedgerEntry,
  PerGameMarketPlayer,
  PerGamePosition,
  PerGamePositionSide,
  PerGameSettledResult,
} from '../api/contracts';

export interface PnlPoint {
  eventCursor: number;
  cumulativePnl: number;
}

export interface PnlDomain {
  minimum: number;
  maximum: number;
  zeroRatio: number;
}

export interface SettlementEquation {
  firstLabel: string;
  firstAmount: number | null;
  secondLabel: string | null;
  secondAmount: number | null;
  operator: '+' | '-' | null;
  netPnl: number | null;
  reconciles: boolean | null;
  correction: boolean;
  correctionAdjustment: number | null;
}

export interface PerGameMarketRow {
  player: PerGameMarketPlayer;
  side: PerGamePositionSide;
  position: PerGamePosition | null;
  isFull: boolean;
  blockedByOpposingPosition: boolean;
  canSubmit: boolean;
  unavailableReason: string | null;
}

export type PerGameActivity =
  | {
      type: 'result';
      key: string;
      eventCursor: number;
      result: PerGameSettledResult;
    }
  | {
      type: 'fee';
      key: string;
      eventCursor: number;
      entry: PerGameLedgerEntry;
    };

function byCursorThenId(
  left: { eventCursor: number; entryId?: string },
  right: { eventCursor: number; entryId?: string },
): number {
  return left.eventCursor - right.eventCursor
    || (left.entryId ?? '').localeCompare(right.entryId ?? '');
}

export function buildPnlSeries(entries: readonly PerGameLedgerEntry[]): PnlPoint[] {
  const movements = new Map<string, { eventCursor: number; amountDollars: number }>();
  for (const entry of entries) {
    const movementKey = entry.gameId !== null && entry.resultRevision !== null
      ? `game:${entry.positionId}:${entry.gameId}:${entry.resultRevision}`
      : `event:${entry.eventCursor}:${entry.entryId}`;
    const current = movements.get(movementKey);
    movements.set(movementKey, {
      eventCursor: Math.max(current?.eventCursor ?? 0, entry.eventCursor),
      amountDollars: (current?.amountDollars ?? 0) + entry.amountDollars,
    });
  }
  let cumulativePnl = 0;
  const points: PnlPoint[] = [{ eventCursor: 0, cumulativePnl: 0 }];
  const orderedMovements = [...movements.values()].sort(
    (left, right) => left.eventCursor - right.eventCursor,
  );
  for (const movement of orderedMovements) {
    cumulativePnl += movement.amountDollars;
    points.push({ eventCursor: movement.eventCursor, cumulativePnl });
  }
  return points;
}

export function pnlChartDomain(points: readonly PnlPoint[]): PnlDomain {
  const values = [0, ...points.map((point) => point.cumulativePnl)];
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (low === high) return { minimum: -1, maximum: 1, zeroRatio: 0.5 };
  const padding = Math.max((high - low) * 0.08, 1);
  const minimum = Math.min(0, low - padding);
  const maximum = Math.max(0, high + padding);
  return {
    minimum,
    maximum,
    zeroRatio: maximum / (maximum - minimum),
  };
}

function correctionAdjustment(
  result: PerGameSettledResult,
  ledger: readonly PerGameLedgerEntry[],
  results: readonly PerGameSettledResult[],
): number | null {
  const ledgerAdjustment = ledger.find((entry) => (
    entry.positionId === result.positionId
    && entry.gameId === result.gameId
    && entry.resultRevision === result.resultRevision
    && (entry.kind === 'dividend_correction' || entry.kind === 'correction')
  ));
  if (ledgerAdjustment) return ledgerAdjustment.amountDollars;

  const prior = results.find((candidate) => (
    candidate.positionId === result.positionId
    && candidate.gameId === result.gameId
    && candidate.resultRevision === result.adjustsResultRevision
  ));
  if (prior?.netPnl !== null && prior?.netPnl !== undefined && result.netPnl !== null) {
    return result.netPnl - prior.netPnl;
  }
  if (
    prior?.dividendDollars !== null
    && prior?.dividendDollars !== undefined
    && result.dividendDollars !== null
  ) {
    const dividendDelta = result.dividendDollars - prior.dividendDollars;
    return result.side === 'long' ? dividendDelta : -dividendDelta;
  }
  return null;
}

export function settlementEquation(
  result: PerGameSettledResult,
  ledger: readonly PerGameLedgerEntry[] = [],
  results: readonly PerGameSettledResult[] = [],
): SettlementEquation {
  const correction = result.kind === 'correction';
  const adjustment = correction ? correctionAdjustment(result, ledger, results) : null;
  if (
    result.status !== 'settled'
    || result.dividendDollars === null
    || result.netPnl === null
  ) {
    return {
      firstLabel: correction ? 'Corrected dividend' : 'Dividend',
      firstAmount: result.dividendDollars,
      secondLabel: null,
      secondAmount: null,
      operator: null,
      netPnl: result.netPnl,
      reconciles: null,
      correction,
      correctionAdjustment: adjustment,
    };
  }

  const firstAmount = result.side === 'long'
    ? result.dividendDollars
    : result.lockedGameCost;
  const secondAmount = result.side === 'long'
    ? result.lockedGameCost
    : result.dividendDollars;
  return {
    firstLabel: result.side === 'long'
      ? correction ? 'Corrected dividend' : 'Dividend'
      : 'Game cost credit',
    firstAmount,
    secondLabel: result.side === 'long'
      ? 'Locked game cost'
      : correction ? 'Corrected dividend paid' : 'Dividend paid',
    secondAmount,
    operator: '-',
    netPnl: result.netPnl,
    reconciles: firstAmount - secondAmount === result.netPnl,
    correction,
    correctionAdjustment: adjustment,
  };
}

export function activePosition(
  positions: readonly PerGamePosition[],
  playerId: string,
  side: PerGamePositionSide,
): PerGamePosition | null {
  return positions.find((position) => (
    position.playerId === playerId
    && position.side === side
    && position.status === 'active'
  )) ?? null;
}

export function buildPerGameMarketRows(
  bootstrap: PerGameBootstrap,
  side: PerGamePositionSide,
): PerGameMarketRow[] {
  const slots = side === 'long' ? bootstrap.account.longSlots : bootstrap.account.shortSlots;
  const capability = side === 'long'
    ? bootstrap.capabilities.canOpenLong
    : bootstrap.capabilities.canOpenShort;
  return bootstrap.market.map((player) => {
    const position = activePosition(bootstrap.positions, player.playerId, side);
    const opposingPosition = activePosition(
      bootstrap.positions,
      player.playerId,
      side === 'long' ? 'short' : 'long',
    );
    const blockedByOpposingPosition = (
      position === null
      && opposingPosition !== null
      && !bootstrap.ruleset.allowOpposingPositions
    );
    const isFull = position === null && slots.remaining === 0;
    const unavailableReason = position
      ? null
      : !capability
        ? `${side === 'long' ? 'Roster' : 'Inverse'} adds are unavailable.`
        : blockedByOpposingPosition
          ? `Close the ${side === 'long' ? 'inverse' : 'roster'} position before opening this side.`
        : isFull
          ? `${side === 'long' ? 'Long' : 'Short'} slots are full.`
          : null;
    return {
      player,
      side,
      position,
      isFull,
      blockedByOpposingPosition,
      canSubmit: position !== null || unavailableReason === null,
      unavailableReason,
    };
  });
}

function settledResultIdentity(result: PerGameSettledResult): string {
  return `${result.positionId}:${result.gameId}`;
}

export function mergePerGameBootstrap(
  previous: PerGameBootstrap,
  incoming: PerGameBootstrap,
): PerGameBootstrap | null {
  if (!samePerGameBootstrapIdentity(previous, incoming)) return incoming;
  if (incoming.game.eventCursor < previous.game.eventCursor) return null;

  const ledgerById = new Map(previous.ledger.items.map((entry) => [entry.entryId, entry]));
  for (const entry of incoming.ledger.items) ledgerById.set(entry.entryId, entry);

  const resultsByIdentity = new Map(
    previous.settledResults.map((result) => [settledResultIdentity(result), result]),
  );
  for (const result of incoming.settledResults) {
    resultsByIdentity.set(settledResultIdentity(result), result);
  }

  return {
    ...incoming,
    ledger: {
      ...incoming.ledger,
      items: [...ledgerById.values()].sort(byCursorThenId),
    },
    settledResults: [...resultsByIdentity.values()].sort((left, right) => (
      left.eventCursor - right.eventCursor
      || left.resultRevision - right.resultRevision
      || left.positionId.localeCompare(right.positionId)
    )),
  };
}

export function samePerGameBootstrapIdentity(
  left: PerGameBootstrap,
  right: PerGameBootstrap,
): boolean {
  return (
    left.account.accountId === right.account.accountId
    && left.game.seasonId === right.game.seasonId
    && left.ruleset.id === right.ruleset.id
    && left.ruleset.version === right.ruleset.version
  );
}

export function perGamePlayerName(
  bootstrap: PerGameBootstrap,
  playerId: string,
  positionId?: string,
): string {
  const listed = bootstrap.market.find((player) => player.playerId === playerId);
  if (listed) return listed.name;
  const exactPosition = positionId
    ? bootstrap.positions.find((position) => position.positionId === positionId)
    : null;
  if (exactPosition) return exactPosition.playerName;
  return bootstrap.positions.find((position) => position.playerId === playerId)?.playerName
    ?? playerId;
}

function isFeeActivity(entry: PerGameLedgerEntry): boolean {
  return ['open_fee', 'drop_fee', 'fee', 'penalty'].includes(entry.kind);
}

export function buildPerGameActivity(bootstrap: PerGameBootstrap): PerGameActivity[] {
  const results: PerGameActivity[] = bootstrap.settledResults.map((result) => ({
    type: 'result',
    key: `result:${settledResultIdentity(result)}`,
    eventCursor: result.eventCursor,
    result,
  }));
  const fees: PerGameActivity[] = bootstrap.ledger.items
    .filter(isFeeActivity)
    .map((entry) => ({
      type: 'fee',
      key: `fee:${entry.entryId}`,
      eventCursor: entry.eventCursor,
      entry,
    }));
  return [...results, ...fees].sort((left, right) => (
    right.eventCursor - left.eventCursor || right.key.localeCompare(left.key)
  ));
}

export function latestResults(
  results: readonly PerGameSettledResult[],
): PerGameSettledResult[] {
  return [...results].sort((left, right) => (
    right.eventCursor - left.eventCursor
    || right.resultRevision - left.resultRevision
    || right.positionId.localeCompare(left.positionId)
  ));
}
