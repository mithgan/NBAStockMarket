import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  PerGameApiClient,
  PerGameApiError,
  perGameMutationOutcomeMayHaveCommitted,
} from './perGameClient';

const example = JSON.parse(readFileSync(
  resolve(import.meta.dirname, '../api/fixtures/perGameApiExample.json'),
  'utf8',
)) as { bootstrap: unknown; open_position_response: unknown };

function envelope(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function client(fetchImpl: typeof fetch) {
  return new PerGameApiClient({
    baseUrl: 'https://api.example.test/market',
    expectedUserId: 'user-1',
    getAccessToken: async () => ({ accessToken: 'token-1', userId: 'user-1' }),
    fetchImpl,
    idempotencyKeyFactory: () => 'idem-v2-1',
  });
}

test('bootstrap uses only the versioned v2 route and event cursor', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const api = client((async (url, init) => {
    calls.push({ url: String(url), init });
    return envelope(example.bootstrap);
  }) as typeof fetch);

  const result = await api.bootstrap(48);
  assert.equal(result.game.eventCursor, 48);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.example.test/market/api/v2/bootstrap?after_event_cursor=48');
  assert.doesNotMatch(calls[0].url, /api\/v1/);
  assert.equal(calls[0].init?.method, 'GET');
});

test('the Flask mount uses its explicit v2 prefix without duplicating the API root', async () => {
  const calls: string[] = [];
  const api = new PerGameApiClient({
    baseUrl: 'https://api.databallr.com/api/nba-stock-market/',
    apiPrefix: '/v2',
    expectedUserId: 'user-1',
    getAccessToken: async () => ({ accessToken: 'token-1', userId: 'user-1' }),
    fetchImpl: (async (url) => {
      calls.push(String(url));
      return envelope(example.bootstrap);
    }) as typeof fetch,
  });

  await api.bootstrap();

  assert.deepEqual(calls, [
    'https://api.databallr.com/api/nba-stock-market/v2/bootstrap',
  ]);
});

test('bootstrap consumes every monotonic ledger page before installing account history', async () => {
  const first = structuredClone(example.bootstrap) as Record<string, unknown>;
  const firstLedger = first.ledger as Record<string, unknown>;
  firstLedger.next_cursor = 48;
  const second = structuredClone(example.bootstrap) as Record<string, unknown>;
  const secondGame = second.game as Record<string, unknown>;
  secondGame.event_cursor = 49;
  const secondLedger = second.ledger as Record<string, unknown>;
  secondLedger.next_cursor = null;
  secondLedger.items = [{
    ...((secondLedger.items as Record<string, unknown>[])[0]),
    event_cursor: 49,
    entry_id: 'entry-49',
    result_revision: 2,
    kind: 'dividend_correction',
    amount_dollars: -12_000,
    adjusts_entry_id: 'entry-48',
  }];
  const secondResults = second.settled_results as Record<string, unknown>[];
  secondResults[0] = {
    ...secondResults[0],
    event_cursor: 49,
    result_revision: 2,
    kind: 'correction',
    dividend_dollars: 492_000,
    net_pnl_dollars: 12_000,
    adjusts_result_revision: 1,
  };
  const calls: string[] = [];
  const api = client((async (url) => {
    calls.push(String(url));
    return envelope(calls.length === 1 ? first : second);
  }) as typeof fetch);

  const result = await api.bootstrap();
  assert.deepEqual(calls, [
    'https://api.example.test/market/api/v2/bootstrap',
    'https://api.example.test/market/api/v2/bootstrap?after_event_cursor=48',
  ]);
  assert.deepEqual(result.ledger.items.map((entry) => entry.entryId), ['entry-48', 'entry-49']);
  assert.deepEqual(result.settledResults.map((row) => row.resultRevision), [2]);
  assert.equal(result.game.eventCursor, 49);
});

test('paginated bootstrap replaces history when account identity rolls over', async () => {
  const first = structuredClone(example.bootstrap) as Record<string, unknown>;
  (first.ledger as Record<string, unknown>).next_cursor = 48;

  const second = structuredClone(example.bootstrap) as Record<string, unknown>;
  (second.account as Record<string, unknown>).account_id = 'account-2';
  (second.game as Record<string, unknown>).event_cursor = 1;
  const secondLedger = second.ledger as Record<string, unknown>;
  secondLedger.next_cursor = null;
  secondLedger.items = [{
    ...((secondLedger.items as Record<string, unknown>[])[0]),
    event_cursor: 1,
    entry_id: 'account-2-entry',
  }];
  const secondResults = second.settled_results as Record<string, unknown>[];
  secondResults[0] = { ...secondResults[0], event_cursor: 1 };

  const fullSecond = structuredClone(second) as Record<string, unknown>;
  const fullSecondLedger = fullSecond.ledger as Record<string, unknown>;
  fullSecondLedger.items = [{
    ...((fullSecondLedger.items as Record<string, unknown>[])[0]),
    entry_id: 'account-2-full-history',
  }];
  const calls: string[] = [];
  const api = client((async (url) => {
    calls.push(String(url));
    return envelope(calls.length === 1 ? first : calls.length === 2 ? second : fullSecond);
  }) as typeof fetch);

  const result = await api.bootstrap();
  assert.equal(result.account.accountId, 'account-2');
  assert.deepEqual(result.ledger.items.map((entry) => entry.entryId), ['account-2-full-history']);
  assert.deepEqual(calls, [
    'https://api.example.test/market/api/v2/bootstrap',
    'https://api.example.test/market/api/v2/bootstrap?after_event_cursor=48',
    'https://api.example.test/market/api/v2/bootstrap',
  ]);
});

test('incremental bootstrap can paginate a new season below the prior season cursor', async () => {
  const first = structuredClone(example.bootstrap) as Record<string, unknown>;
  const firstGame = first.game as Record<string, unknown>;
  firstGame.season_id = '2027-28';
  firstGame.event_cursor = 1;
  const firstLedger = first.ledger as Record<string, unknown>;
  firstLedger.next_cursor = 1;
  firstLedger.items = [{
    ...((firstLedger.items as Record<string, unknown>[])[0]),
    event_cursor: 1,
    entry_id: 'new-season-1',
  }];
  const firstResults = first.settled_results as Record<string, unknown>[];
  firstResults[0] = { ...firstResults[0], event_cursor: 1 };

  const second = structuredClone(first) as Record<string, unknown>;
  (second.game as Record<string, unknown>).event_cursor = 2;
  const secondLedger = second.ledger as Record<string, unknown>;
  secondLedger.next_cursor = null;
  secondLedger.items = [{
    ...((secondLedger.items as Record<string, unknown>[])[0]),
    event_cursor: 2,
    entry_id: 'new-season-2',
  }];
  const secondResults = second.settled_results as Record<string, unknown>[];
  secondResults[0] = { ...secondResults[0], event_cursor: 2 };

  const calls: string[] = [];
  const api = client((async (url) => {
    calls.push(String(url));
    return envelope(calls.length === 1 ? first : second);
  }) as typeof fetch);

  const result = await api.bootstrap(48);
  assert.deepEqual(calls, [
    'https://api.example.test/market/api/v2/bootstrap?after_event_cursor=48',
    'https://api.example.test/market/api/v2/bootstrap?after_event_cursor=1',
  ]);
  assert.equal(result.game.seasonId, '2027-28');
  assert.deepEqual(
    result.ledger.items.map((entry) => entry.entryId),
    ['new-season-1', 'new-season-2'],
  );
});

test('only mutation errors marked as possibly committed require reconciliation', () => {
  assert.equal(
    perGameMutationOutcomeMayHaveCommitted(
      new PerGameApiError('timeout', 'timeout', null, true),
    ),
    true,
  );
  assert.equal(
    perGameMutationOutcomeMayHaveCommitted(
      new PerGameApiError('conflict', 'opposing_position', 409, false),
    ),
    false,
  );
  assert.equal(perGameMutationOutcomeMayHaveCommitted(new Error('unknown')), true);
});

test('open position sends idempotency and the exact displayed quote precondition', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const api = client((async (url, init) => {
    calls.push({ url: String(url), init });
    return envelope(example.open_position_response);
  }) as typeof fetch);

  await api.openPosition({
    playerId: 'player-2',
    side: 'long',
    expectedAccountVersion: 8,
    expectedQuoteVersion: 5,
  });

  assert.equal(calls[0].url, 'https://api.example.test/market/api/v2/positions');
  assert.equal(calls[0].init?.method, 'POST');
  assert.equal((calls[0].init?.headers as Record<string, string>)['Idempotency-Key'], 'idem-v2-1');
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    player_id: 'player-2',
    side: 'long',
    expected_account_version: 8,
    expected_quote_version: 5,
  });
});

test('a stale displayed quote is a confirmed conflict and does not require reconciliation', async () => {
  const api = client((async () => new Response(JSON.stringify({
    error: {
      code: 'quote_conflict',
      message: 'The displayed quote is stale. Refresh the market and try again.',
    },
  }), {
    status: 409,
    headers: { 'Content-Type': 'application/json' },
  })) as typeof fetch);

  await assert.rejects(
    api.openPosition({
      playerId: 'player-2',
      side: 'short',
      expectedAccountVersion: 8,
      expectedQuoteVersion: 5,
    }),
    (error: unknown) => {
      assert.ok(error instanceof PerGameApiError);
      assert.equal(error.code, 'quote_conflict');
      assert.equal(error.status, 409);
      assert.equal(perGameMutationOutcomeMayHaveCommitted(error), false);
      return true;
    },
  );
});

test('close position targets the stable position id with an account precondition', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const api = client((async (url, init) => {
    calls.push({ url: String(url), init });
    return envelope({
      replayed: false,
      account_version: 10,
      position_id: 'position / two',
      player_id: 'player-2',
      side: 'long',
      closed_event_sequence: 14,
      quote_version: 7,
      current_game_cost_dollars: 210_000,
    });
  }) as typeof fetch);

  await api.closePosition('position / two', 9);
  assert.equal(
    calls[0].url,
    'https://api.example.test/market/api/v2/positions/position%20%2F%20two',
  );
  assert.equal(calls[0].init?.method, 'DELETE');
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    expected_account_version: 9,
  });
});

test('paginated bootstrap rejects a regressive account snapshot before exposing history', async () => {
  const first = structuredClone(example.bootstrap) as { ledger: { next_cursor: number | null }; account: { version: number } };
  first.ledger.next_cursor = 48;
  first.account.version = 9;
  const second = structuredClone(first);
  second.account.version = 8;
  second.ledger.next_cursor = null;
  let pages = 0;
  const api = client((async () => envelope(++pages === 1 ? first : second)) as typeof fetch);
  await assert.rejects(api.bootstrap(), (error: unknown) => {
    assert.ok(error instanceof PerGameApiError);
    assert.equal(error.code, 'invalid_account_version');
    return true;
  });
});
