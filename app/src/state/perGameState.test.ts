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
  resolve(import.meta.dirname, '../api/fixtures/perGameApiExample.json'),
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

test('verified DNP has zero cash flow on both sides while retaining the saved game cost', () => {
  const base = bootstrap().settledResults[0];
  for (const side of ['long', 'short'] as const) {
    const dnp: PerGameSettledResult = {
      ...base,
      side,
      status: 'verified_dnp',
      dividendDollars: 0,
      netPnl: 0,
    };
    const equation = settlementEquation(dnp);
    assert.equal(equation.firstAmount, 0);
    assert.equal(equation.secondAmount, 0);
    assert.equal(equation.operator, '-');
    assert.equal(equation.netPnl, 0);
    assert.equal(equation.reconciles, true);
    assert.equal(dnp.lockedGameCost, 480_000);
  }
});

test('played-to-DNP corrections reverse both game cost and dividend on either side', () => {
  const value = bootstrap();
  const base = value.settledResults[0];
  for (const side of ['long', 'short'] as const) {
    for (const dividend of [0, 504_000]) {
      const direction = side === 'long' ? 1 : -1;
      const prior: PerGameSettledResult = {
        ...base,
        side,
        dividendDollars: dividend,
        netPnl: direction * (dividend - base.lockedGameCost),
      };
      const dnp: PerGameSettledResult = {
        ...prior,
        status: 'verified_dnp',
        kind: 'correction',
        resultRevision: 2,
        adjustsResultRevision: 1,
        dividendDollars: 0,
        netPnl: 0,
      };
      const costCorrection = {
        ...value.ledger.items[0],
        entryId: 'dnp-cost-reversal',
        resultRevision: 2,
        kind: 'game_cost_correction' as const,
        amountDollars: direction * base.lockedGameCost,
      };
      const ledger = [
        costCorrection,
        {
          ...costCorrection,
          entryId: 'dnp-dividend-reversal',
          kind: 'dividend_correction' as const,
          amountDollars: -direction * dividend,
        },
        { ...costCorrection, entryId: 'other-position', positionId: 'another-position' },
        { ...costCorrection, entryId: 'other-game', gameId: 'another-game' },
        { ...costCorrection, entryId: 'other-revision', resultRevision: 3 },
        { ...costCorrection, entryId: 'fee', kind: 'fee' as const },
      ];
      // Incremental bootstrap keeps only the latest result, so the ledger must
      // explain a participation reversal without relying on a retained prior row.
      const equation = settlementEquation(dnp, ledger, [dnp]);
      assert.equal(equation.correctionAdjustment, -prior.netPnl!);
      assert.equal(equation.firstAmount, 0);
      assert.equal(equation.secondAmount, 0);
      assert.equal(equation.netPnl, 0);
      assert.equal(equation.reconciles, true);
      assert.equal(settlementEquation(dnp, [], [prior]).correctionAdjustment, -prior.netPnl!);
    }
  }
});

test('DNP-to-played corrections include the newly applicable cost and dividend', () => {
  const value = bootstrap();
  for (const side of ['long', 'short'] as const) {
    const direction = side === 'long' ? 1 : -1;
    const prior: PerGameSettledResult = {
      ...value.settledResults[0],
      side,
      status: 'verified_dnp',
      dividendDollars: 0,
      netPnl: 0,
    };
    const correction: PerGameSettledResult = {
      ...prior,
      status: 'settled',
      kind: 'correction',
      resultRevision: 2,
      adjustsResultRevision: 1,
      dividendDollars: 504_000,
      netPnl: direction * 24_000,
    };
    const costCorrection = {
      ...value.ledger.items[0],
      entryId: 'played-cost',
      resultRevision: 2,
      kind: 'game_cost_correction' as const,
      amountDollars: -direction * 480_000,
    };
    const equation = settlementEquation(correction, [
      costCorrection,
      {
        ...costCorrection,
        entryId: 'played-dividend',
        kind: 'dividend_correction',
        amountDollars: direction * 504_000,
      },
    ]);
    assert.equal(equation.correctionAdjustment, direction * 24_000);
    assert.equal(equation.netPnl, direction * 24_000);
    assert.equal(equation.reconciles, true);
    assert.equal(settlementEquation(correction, [], [prior]).correctionAdjustment, direction * 24_000);
  }
});

test('complete ledger retains ordinary long and short adjustments with only the latest result', () => {
  const value = bootstrap();
  for (const side of ['long', 'short'] as const) {
    const direction = side === 'long' ? 1 : -1;
    const correction: PerGameSettledResult = {
      ...value.settledResults[0],
      side,
      kind: 'correction',
      resultRevision: 2,
      adjustsResultRevision: 1,
      dividendDollars: 532_000,
      netPnl: direction * 52_000,
    };
    const ledger = [
      {
        ...value.ledger.items[0],
        entryId: 'ordinary-original-cost',
        resultRevision: 1,
        kind: 'game_cost' as const,
        amountDollars: -direction * 480_000,
      },
      {
        ...value.ledger.items[0],
        entryId: 'ordinary-original-dividend',
        resultRevision: 1,
        kind: 'game_dividend' as const,
        amountDollars: direction * 504_000,
      },
      {
        ...value.ledger.items[0],
        entryId: 'ordinary-dividend-correction',
        resultRevision: 2,
        kind: 'dividend_correction' as const,
        amountDollars: direction * 28_000,
      },
    ];
    const equation = settlementEquation(correction, ledger, [correction], { ledgerComplete: true });
    assert.equal(equation.correctionAdjustment, direction * 28_000);
    assert.equal(equation.netPnl, direction * 52_000);
    assert.equal(equation.reconciles, true);
    // Arbitrary partial input remains conservative, even with an older cost row.
    assert.equal(settlementEquation(correction, ledger, [correction]).correctionAdjustment, null);
    assert.equal(settlementEquation(correction, ledger, [correction], {
      ledgerComplete: false,
    }).correctionAdjustment, null);
  }
});

test('complete history proves a zero adjustment for a revised DNP with no money movements', () => {
  const correction: PerGameSettledResult = {
    ...bootstrap().settledResults[0],
    status: 'verified_dnp',
    kind: 'correction',
    resultRevision: 2,
    adjustsResultRevision: 1,
    dividendDollars: 0,
    netPnl: 0,
  };
  assert.equal(settlementEquation(correction, [], [correction], {
    ledgerComplete: true,
  }).correctionAdjustment, 0);
  assert.equal(settlementEquation(correction, [], [correction]).correctionAdjustment, null);
});

test('a DNP status change cannot infer its adjustment from dividends alone', () => {
  const prior: PerGameSettledResult = {
    ...bootstrap().settledResults[0],
    netPnl: null,
  };
  const dnp: PerGameSettledResult = {
    ...prior,
    status: 'verified_dnp',
    kind: 'correction',
    resultRevision: 2,
    adjustsResultRevision: 1,
    dividendDollars: 0,
    netPnl: 0,
  };
  assert.equal(settlementEquation(dnp, [], [prior]).correctionAdjustment, null);
});

test('partial participation-correction ledger rows do not claim a complete adjustment', () => {
  const value = bootstrap();
  const correction: PerGameSettledResult = {
    ...value.settledResults[0],
    status: 'verified_dnp',
    kind: 'correction',
    resultRevision: 2,
    adjustsResultRevision: 1,
    dividendDollars: 0,
    netPnl: 0,
  };
  const cost = {
    ...value.ledger.items[0],
    resultRevision: 2,
    kind: 'game_cost_correction' as const,
    amountDollars: 480_000,
  };
  const dividend = { ...cost, kind: 'dividend_correction' as const, amountDollars: -504_000 };
  assert.equal(settlementEquation(correction, [cost]).correctionAdjustment, null);
  assert.equal(settlementEquation(correction, [dividend]).correctionAdjustment, null);
  assert.equal(settlementEquation(correction, [cost], value.settledResults).correctionAdjustment, -24_000);
  assert.equal(settlementEquation(correction, [dividend], value.settledResults).correctionAdjustment, -24_000);

  const playedCorrection: PerGameSettledResult = {
    ...correction,
    status: 'settled',
    dividendDollars: 492_000,
    netPnl: 12_000,
  };
  const playedDividend = { ...dividend, amountDollars: -12_000 };
  assert.equal(settlementEquation(playedCorrection, [playedDividend]).correctionAdjustment, null);
  assert.equal(settlementEquation(playedCorrection, [
    { ...cost, resultRevision: 1, kind: 'game_cost', amountDollars: -480_000 },
    playedDividend,
  ]).correctionAdjustment, null);
});

test('incremental history replaces a played result with DNP without changing saved costs', () => {
  const previous = bootstrap();
  const correction: PerGameSettledResult = {
    ...previous.settledResults[0],
    status: 'verified_dnp',
    kind: 'correction',
    eventCursor: 49,
    resultRevision: 2,
    adjustsResultRevision: 1,
    dividendDollars: 0,
    netPnl: 0,
  };
  const merged = mergePerGameBootstrap(previous, {
    ...previous,
    game: { ...previous.game, eventCursor: 49 },
    settledResults: [correction],
  });
  assert.ok(merged);
  assert.equal(merged.settledResults.length, 1);
  assert.equal(merged.settledResults[0].status, 'verified_dnp');
  assert.equal(merged.settledResults[0].lockedGameCost, 480_000);
  assert.equal(merged.positions[0].lockedGameCost, 480_000);
  assert.equal(buildPerGameActivity(merged)[0].type, 'result');
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

test('same identity rejects a regressive account version even when the world cursor advances', () => {
  const previous = bootstrap();
  for (const eventCursor of [previous.game.eventCursor, previous.game.eventCursor + 1]) {
    const incoming = {
      ...previous,
      account: { ...previous.account, version: previous.account.version - 1 },
      game: { ...previous.game, eventCursor },
      positions: [],
    };
    assert.equal(mergePerGameBootstrap(previous, incoming), null);
  }
});
