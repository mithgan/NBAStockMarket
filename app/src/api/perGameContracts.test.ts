import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  ContractError,
  parsePerGameBootstrap,
  parsePerGamePositionMutationResult,
} from './contracts';

const example = JSON.parse(readFileSync(
  resolve(import.meta.dirname, '../../../docs/per-game-economy-v2-api-example.json'),
  'utf8',
)) as { bootstrap: unknown; open_position_response: unknown };

function fixture(): Record<string, unknown> {
  return structuredClone(example.bootstrap) as Record<string, unknown>;
}

test('the exact frozen v2 bootstrap fixture parses into explicit per-game concepts', () => {
  const parsed = parsePerGameBootstrap(example.bootstrap);
  assert.equal(parsed.ruleset.dividendBasis, 'raw_net_points');
  assert.equal(parsed.ruleset.allowOpposingPositions, false);
  assert.equal(parsed.ruleset.rosterMutationsLocked, false);
  assert.equal(parsed.ruleset.rosterLockGameDate, null);
  assert.equal(parsed.market[0].currentGameCost, 500_000);
  assert.equal(parsed.market[0].priorSeasonValuePerGame, 472_000);
  assert.equal(parsed.positions[0].lockedGameCost, 480_000);
  assert.equal(parsed.positions[0].expiresOn, null);
  assert.equal(parsed.positions[0].cumulativePnl, 76_000);
  assert.equal(parsed.game.eventCursor, 48);
  assert.equal(parsed.settledResults[0].resultRevision, 1);
  assert.equal(parsed.settledResults[0].netPnl, 24_000);
});

test('v2 preserves an explicit opposing-position policy', () => {
  const value = fixture();
  const ruleset = value.ruleset as Record<string, unknown>;
  ruleset.allow_opposing_positions = true;

  const parsed = parsePerGameBootstrap(value);
  assert.equal(parsed.ruleset.allowOpposingPositions, true);
});

test('v2 parses roster locks and fails closed on missing or inconsistent lock data', () => {
  const locked = fixture();
  const lockedRuleset = locked.ruleset as Record<string, unknown>;
  const lockedCapabilities = locked.capabilities as Record<string, unknown>;
  lockedRuleset.roster_mutations_locked = true;
  lockedRuleset.roster_lock_game_date = '2026-10-26';
  lockedCapabilities.can_open_long = false;
  lockedCapabilities.can_open_short = false;

  const parsed = parsePerGameBootstrap(locked);
  assert.equal(parsed.ruleset.rosterMutationsLocked, true);
  assert.equal(parsed.ruleset.rosterLockGameDate, '2026-10-26');

  const missingFlag = fixture();
  delete (missingFlag.ruleset as Record<string, unknown>).roster_mutations_locked;
  assert.throws(() => parsePerGameBootstrap(missingFlag), /roster_mutations_locked/);

  const missingDate = fixture();
  delete (missingDate.ruleset as Record<string, unknown>).roster_lock_game_date;
  assert.throws(() => parsePerGameBootstrap(missingDate), /roster_lock_game_date/);

  const malformedDate = fixture();
  (malformedDate.ruleset as Record<string, unknown>).roster_lock_game_date = '10/26/2026';
  assert.throws(() => parsePerGameBootstrap(malformedDate), /roster_lock_game_date/);

  const inconsistent = fixture();
  (inconsistent.ruleset as Record<string, unknown>).roster_mutations_locked = true;
  (inconsistent.ruleset as Record<string, unknown>).roster_lock_game_date = '2026-10-26';
  assert.throws(() => parsePerGameBootstrap(inconsistent), /cannot allow roster opens/);
});

test('the frozen open-position response preserves versions and locked cost', () => {
  const parsed = parsePerGamePositionMutationResult(example.open_position_response);
  assert.deepEqual(parsed, {
    replayed: false,
    accountVersion: 9,
    positionId: 'position-2',
    playerId: 'player-2',
    side: 'long',
    lockedGameCost: 210_000,
    quoteVersion: 6,
    currentGameCost: 210_525,
  });
});

test('v2 rejects fractional money instead of silently rounding it', () => {
  const value = fixture();
  const market = value.market as Record<string, unknown>[];
  market[0].current_game_cost_dollars = 500_000.5;
  assert.throws(() => parsePerGameBootstrap(value), ContractError);
});

test('v2 rejects unsupported position sides', () => {
  const value = fixture();
  const positions = value.positions as Record<string, unknown>[];
  positions[0].side = 'neutral';
  assert.throws(() => parsePerGameBootstrap(value), ContractError);
});

test('v2 rejects nonpositive result revisions', () => {
  const value = fixture();
  const results = value.settled_results as Record<string, unknown>[];
  results[0].result_revision = 0;
  assert.throws(() => parsePerGameBootstrap(value), ContractError);
});

test('v2 rejects malformed event and page cursors', () => {
  const eventValue = fixture();
  (eventValue.game as Record<string, unknown>).event_cursor = -1;
  assert.throws(() => parsePerGameBootstrap(eventValue), ContractError);

  const pageValue = fixture();
  (pageValue.ledger as Record<string, unknown>).next_cursor = 2.5;
  assert.throws(() => parsePerGameBootstrap(pageValue), ContractError);
});

test('v2 validates slot arithmetic and correction linkage', () => {
  const slotsValue = fixture();
  const account = slotsValue.account as Record<string, unknown>;
  (account.long_slots as Record<string, unknown>).remaining = 8;
  assert.throws(() => parsePerGameBootstrap(slotsValue), ContractError);

  const correctionValue = fixture();
  const results = correctionValue.settled_results as Record<string, unknown>[];
  results[0].kind = 'correction';
  assert.throws(() => parsePerGameBootstrap(correctionValue), ContractError);
});

test('v2 accepts lifecycle ledger rows and keeps missing projections unsettled', () => {
  const value = fixture();
  const ledger = (value.ledger as Record<string, unknown>).items as Record<string, unknown>[];
  ledger[0] = {
    ...ledger[0],
    kind: 'open_fee',
    game_id: null,
    game_date: null,
    result_revision: null,
    amount_dollars: -2_000,
  };
  const results = value.settled_results as Record<string, unknown>[];
  results[0] = {
    ...results[0],
    status: 'unsettled_missing_projection',
    dividend_dollars: null,
    net_pnl_dollars: null,
  };

  const parsed = parsePerGameBootstrap(value);
  assert.equal(parsed.ledger.items[0].kind, 'open_fee');
  assert.equal(parsed.ledger.items[0].gameId, null);
  assert.equal(parsed.settledResults[0].status, 'unsettled_missing_projection');
  assert.equal(parsed.settledResults[0].netPnl, null);
});

test('v2 accepts an immediate close at the same event sequence', () => {
  const value = fixture();
  const positions = value.positions as Record<string, unknown>[];
  positions[0] = {
    ...positions[0],
    status: 'closed',
    closed_event_sequence: positions[0].opened_event_sequence,
  };

  const parsed = parsePerGameBootstrap(value);
  assert.equal(parsed.positions[0].status, 'closed');
  assert.equal(
    parsed.positions[0].closedEventSequence,
    parsed.positions[0].openedEventSequence,
  );

  positions[0].closed_event_sequence = Number(positions[0].opened_event_sequence) - 1;
  assert.throws(() => parsePerGameBootstrap(value), /cannot precede the open sequence/);
});

test('v2 accepts a null short term for season-long or no-expiry inverse positions', () => {
  const value = fixture();
  const ruleset = value.ruleset as Record<string, unknown>;
  ruleset.short_term_days = null;

  const parsed = parsePerGameBootstrap(value);
  assert.equal(parsed.ruleset.shortTermDays, null);
});

test('v2 preserves inverse expiry and rejects expiry on a long position', () => {
  const value = fixture();
  const positions = value.positions as Record<string, unknown>[];
  positions[0].side = 'short';
  positions[0].expires_on = '2026-10-31';
  assert.equal(parsePerGameBootstrap(value).positions[0].expiresOn, '2026-10-31');

  positions[0].side = 'long';
  assert.throws(
    () => parsePerGameBootstrap(value),
    /expires_on is only valid for inverse positions/,
  );
});
