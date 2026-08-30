import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { parsePerGameBootstrap, type PerGameSettledResult } from '../api/contracts';
import {
  buildPerGameActivity,
  buildPerGameMarketRows,
  buildPnlSeries,
  mergePerGameBootstrap,
  perGamePlayerName,
  pnlChartDomain,
  settlementEquation,
} from './perGameState';

const example = JSON.parse(readFileSync(
  resolve(import.meta.dirname, '../../../docs/per-game-economy-v2-api-example.json'),
  'utf8',
)) as { bootstrap: unknown };

function bootstrap() {
  return parsePerGameBootstrap(example.bootstrap);
}

test('P&L series plots atomic game settlements without a fictitious cost-only loss', () => {
  const value = bootstrap();
  const base = value.ledger.items[0];
  const points = buildPnlSeries([
    {
      ...base,
      entryId: 'open-fee',
      eventCursor: 46,
      gameId: null,
      gameDate: null,
      resultRevision: null,
      kind: 'open_fee',
      amountDollars: -1_000,
    },
    { ...base, entryId: 'cost', eventCursor: 47, kind: 'game_cost', amountDollars: -480_000 },
    { ...base, entryId: 'dividend', eventCursor: 48, kind: 'game_dividend', amountDollars: 504_000 },
    {
      ...base,
      entryId: 'correction',
      eventCursor: 49,
      resultRevision: 2,
      kind: 'correction',
      amountDollars: -10_000,
    },
  ]);
  assert.deepEqual(points, [
    { eventCursor: 0, cumulativePnl: 0 },
    { eventCursor: 46, cumulativePnl: -1_000 },
    { eventCursor: 48, cumulativePnl: 23_000 },
    { eventCursor: 49, cumulativePnl: 13_000 },
  ]);
});

test('chart domain always contains zero and supports negative P&L', () => {
  const domain = pnlChartDomain([
    { eventCursor: 0, cumulativePnl: 0 },
    { eventCursor: 1, cumulativePnl: -50_000 },
    { eventCursor: 2, cumulativePnl: 20_000 },
  ]);
  assert.ok(domain.minimum < -50_000);
  assert.ok(domain.maximum > 20_000);
  assert.ok(domain.zeroRatio > 0 && domain.zeroRatio < 1);
});

test('settlement equations reconcile long and inverse base cash flow', () => {
  const long = bootstrap().settledResults[0];
  assert.deepEqual(settlementEquation(long), {
    firstLabel: 'Dividend',
    firstAmount: 504_000,
    secondLabel: 'Locked game cost',
    secondAmount: 480_000,
    operator: '-',
    netPnl: 24_000,
    reconciles: true,
    correction: false,
    correctionAdjustment: null,
  });

  const short: PerGameSettledResult = {
    ...long,
    side: 'short',
    dividendDollars: 430_000,
    netPnl: 50_000,
  };
  assert.equal(settlementEquation(short).reconciles, true);
  assert.equal(settlementEquation(short).firstLabel, 'Game cost credit');
});

test('correction equation uses the ledger delta but reconciles corrected game totals', () => {
  const base = bootstrap().settledResults[0];
  const correction: PerGameSettledResult = {
    ...base,
    eventCursor: 49,
    kind: 'correction',
    resultRevision: 2,
    adjustsResultRevision: 1,
    dividendDollars: 492_000,
    netPnl: 12_000,
  };
  const correctionEntry = {
    ...bootstrap().ledger.items[0],
    entryId: 'correction-entry',
    eventCursor: 49,
    resultRevision: 2,
    kind: 'dividend_correction' as const,
    amountDollars: -12_000,
  };
  const equation = settlementEquation(correction, [correctionEntry], [base, correction]);
  assert.equal(equation.correction, true);
  assert.equal(equation.correctionAdjustment, -12_000);
  assert.equal(equation.firstLabel, 'Corrected dividend');
  assert.equal(equation.secondAmount, 480_000);
  assert.equal(equation.netPnl, 12_000);
  assert.equal(equation.reconciles, true);
});

test('missing-projection results remain unsettled without invented arithmetic', () => {
  const base = bootstrap().settledResults[0];
  const missing: PerGameSettledResult = {
    ...base,
    status: 'unsettled_missing_projection',
    dividendDollars: null,
    netPnl: null,
  };
  assert.deepEqual(settlementEquation(missing), {
    firstLabel: 'Dividend',
    firstAmount: null,
    secondLabel: null,
    secondAmount: null,
    operator: null,
    netPnl: null,
    reconciles: null,
    correction: false,
    correctionAdjustment: null,
  });
});

test('incremental merge replaces an obsolete result with its correction', () => {
  const previous = bootstrap();
  const base = previous.settledResults[0];
  const correction: PerGameSettledResult = {
    ...base,
    eventCursor: 49,
    kind: 'correction',
    resultRevision: 2,
    adjustsResultRevision: 1,
    dividendDollars: 5_000,
    netPnl: 5_000,
  };
  const incoming = {
    ...previous,
    game: { ...previous.game, eventCursor: 49 },
    settledResults: [correction],
  };
  const merged = mergePerGameBootstrap(previous, incoming);
  assert.ok(merged);
  assert.equal(merged.settledResults.length, 1);
  assert.deepEqual(merged.settledResults.map((result) => result.kind), ['correction']);
  assert.equal(merged.settledResults[0].resultRevision, 2);
  assert.equal(merged.positions[0].lockedGameCost, 480_000);
});

test('incremental merge replaces history on account, season, or ruleset rollover', () => {
  const previous = bootstrap();
  const rolloverCases = [
    {
      ...previous,
      account: { ...previous.account, accountId: 'another-account' },
      game: { ...previous.game, eventCursor: 1 },
    },
    {
      ...previous,
      game: { ...previous.game, seasonId: '2027-28', eventCursor: 1 },
    },
    {
      ...previous,
      ruleset: { ...previous.ruleset, version: previous.ruleset.version + 1 },
      game: { ...previous.game, eventCursor: 1 },
    },
  ].map((incoming, index) => ({
    ...incoming,
    ledger: {
      items: [{
        ...incoming.ledger.items[0],
        eventCursor: 1,
        entryId: `rollover-${index}`,
      }],
      nextCursor: null,
    },
    settledResults: [{ ...incoming.settledResults[0], eventCursor: 1 }],
  }));

  for (const incoming of rolloverCases) {
    const merged = mergePerGameBootstrap(previous, incoming);
    assert.equal(merged, incoming);
    assert.deepEqual(merged?.ledger.items, incoming.ledger.items);
    assert.deepEqual(merged?.settledResults, incoming.settledResults);
  }
});

test('results retain player names after a closed player leaves the market', () => {
  const value = bootstrap();
  const closedPosition = { ...value.positions[0], status: 'closed' as const };
  const withoutListing = {
    ...value,
    market: [],
    positions: [closedPosition],
  };

  assert.equal(
    perGamePlayerName(
      withoutListing,
      value.settledResults[0].playerId,
      value.settledResults[0].positionId,
    ),
    closedPosition.playerName,
  );
});

test('results activity includes fee ledger rows that change the account score', () => {
  const value = bootstrap();
  const fee = {
    ...value.ledger.items[0],
    eventCursor: value.game.eventCursor + 1,
    entryId: 'open-fee-1',
    gameId: null,
    gameDate: null,
    resultRevision: null,
    kind: 'open_fee' as const,
    amountDollars: -2_500,
  };
  const activity = buildPerGameActivity({
    ...value,
    ledger: { ...value.ledger, items: [...value.ledger.items, fee] },
  });

  assert.equal(activity[0].type, 'fee');
  if (activity[0].type !== 'fee') assert.fail('expected fee activity');
  assert.equal(activity[0].entry.entryId, 'open-fee-1');
  assert.equal(activity[0].entry.amountDollars, -2_500);
  assert.ok(activity.some((row) => row.type === 'result'));
});

test('market rows show unavailable prior-season value and enforce full slots', () => {
  const value = bootstrap();
  const full = {
    ...value,
    market: [{ ...value.market[0], priorSeasonValuePerGame: null }],
    account: {
      ...value.account,
      longSlots: { used: 10, limit: 10, remaining: 0 },
    },
    positions: [],
  };
  const row = buildPerGameMarketRows(full, 'long')[0];
  assert.equal(row.player.priorSeasonValuePerGame, null);
  assert.equal(row.isFull, true);
  assert.equal(row.canSubmit, false);
  assert.equal(row.unavailableReason, 'Long slots are full.');
});

test('market blocks an opposing-side CTA unless the active rules allow it', () => {
  const value = bootstrap();
  const blocked = buildPerGameMarketRows({
    ...value,
    ruleset: { ...value.ruleset, allowOpposingPositions: false },
  }, 'short')[0];
  assert.equal(blocked.canSubmit, false);
  assert.equal(blocked.blockedByOpposingPosition, true);
  assert.match(blocked.unavailableReason ?? '', /Close the roster position/);

  const allowed = buildPerGameMarketRows({
    ...value,
    ruleset: { ...value.ruleset, allowOpposingPositions: true },
  }, 'short')[0];
  assert.equal(allowed.canSubmit, true);
  assert.equal(allowed.blockedByOpposingPosition, false);
});
