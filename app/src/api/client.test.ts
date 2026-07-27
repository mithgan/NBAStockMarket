import assert from 'node:assert/strict';
import test from 'node:test';

import { MarketApiClient, MarketApiError } from './client';

const portfolio = {
  account_id: 'alice',
  display_name: 'Alice',
  version: 1,
  reset_at: '2026-07-21T00:00:00Z',
  cash_cents: 14_000_000_000,
  free_cash_cents: 14_000_000_000,
  reserved_collateral_cents: 0,
  market_value_cents: 0,
  total_value_cents: 14_000_000_000,
  holdings: [],
  recent_trades: [],
  instruments: {
    week_start: '2025-10-20',
    reserved_collateral_cents: 0,
    free_cash_cents: 14_000_000_000,
    weekly_short_slots: { limit: 3, used: 0, remaining: 3 },
    boost_slots: { limit: 2, used: 0, remaining: 2 },
    weekly_shorts: [],
    boosts: [],
    weekly_short_targets: [],
    boost_targets: [],
  },
};

const market = [{
  id: 'sga', name: 'Shai Gilgeous-Alexander', tier: 'star',
  version: 4,
  current_price_cents: 5_000_000_000, opening_price_cents: 5_000_000_000,
  actual_salary_cents: 4_000_000_000, shares_outstanding: 100,
  available_shares: 100, buy_fee_cents: 12_500_000, ownership_bps: 0, volume_30d: 0,
}];

const trade = {
  id: 'trade-1',
  player_id: '3112335',
  side: 'buy',
  execution_price_cents: 5_000_000_000,
  fee_cents: 12_500_000,
  new_price_cents: 5_010_000_000,
  created_at: '2026-07-21T00:00:00Z',
};

const bootstrapPayload = {
  market,
  portfolio,
  game: {
    season_id: '2025-26', last_settled_date: null,
    next_game_date: '2025-10-20', is_complete: false, version: 0,
  },
  activity: { items: [], next_cursor: null },
  portfolio_history: { items: [], next_cursor: null },
  settlements: [],
  leaderboard: [],
  settled_results: [],
  capabilities: { can_advance_day: true },
};

const aliceToken = async () => ({ accessToken: 'token', userId: 'alice' });

test('the default fetch keeps its browser global binding', async () => {
  const originalFetch = globalThis.fetch;
  let receiver: unknown = null;
  globalThis.fetch = function boundFetch(this: unknown) {
    receiver = this;
    return Promise.resolve(new Response(JSON.stringify({ data: portfolio }), { status: 200 }));
  } as typeof fetch;

  try {
    const client = new MarketApiClient({
      baseUrl: 'https://api.example.com',
      expectedUserId: 'alice',
      getAccessToken: aliceToken,
    });
    assert.equal((await client.portfolio()).account_id, 'alice');
    assert.equal(receiver, globalThis);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('authenticated reads refresh once after a 401', async () => {
  const tokens: boolean[] = [];
  const requests: RequestInit[] = [];
  const client = new MarketApiClient({
    baseUrl: 'https://api.example.com',
    expectedUserId: 'alice',
    getAccessToken: async (refresh) => {
      tokens.push(refresh);
      return {
        accessToken: refresh ? 'fresh-token' : 'stale-token',
        userId: 'alice',
      };
    },
    fetchImpl: async (_url, init) => {
      requests.push(init ?? {});
      if (requests.length === 1) {
        return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'No.' } }), { status: 401 });
      }
      return new Response(JSON.stringify({ data: portfolio }), { status: 200 });
    },
  });

  assert.equal((await client.portfolio()).account_id, 'alice');
  assert.deepEqual(tokens, [false, true]);
  assert.equal((requests[1].headers as Record<string, string>).Authorization, 'Bearer fresh-token');
});

test('a cold-start retry gets a longer timeout without changing the request', async () => {
  const seenUrls: string[] = [];
  const seenMethods: Array<string | undefined> = [];
  let calls = 0;
  const client = new MarketApiClient({
    baseUrl: 'https://api.example.com',
    expectedUserId: 'alice',
    getAccessToken: aliceToken,
    timeoutMs: 5,
    retryTimeoutMs: 50,
    fetchImpl: async (url, init) => {
      calls += 1;
      seenUrls.push(String(url));
      seenMethods.push(init?.method);
      if (calls === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
      }
      return new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
        setTimeout(() => {
          resolve(new Response(JSON.stringify({ data: portfolio }), { status: 200 }));
        }, 20);
      });
    },
  });

  assert.equal((await client.portfolio()).account_id, 'alice');
  assert.equal(calls, 2);
  assert.deepEqual(seenUrls, [
    'https://api.example.com/portfolio',
    'https://api.example.com/portfolio',
  ]);
  assert.deepEqual(seenMethods, ['GET', 'GET']);
});

test('a retried mutation reuses exactly one idempotency key', async () => {
  const seenKeys: string[] = [];
  let calls = 0;
  const client = new MarketApiClient({
    baseUrl: 'https://api.example.com',
    expectedUserId: 'alice',
    getAccessToken: aliceToken,
    idempotencyKeyFactory: () => 'fixed-request-key',
    fetchImpl: async (_url, init) => {
      calls += 1;
      seenKeys.push((init?.headers as Record<string, string>)['Idempotency-Key']);
      if (calls === 1) throw new TypeError('connection reset');
      return new Response(JSON.stringify({
        data: { replayed: true, portfolio, trade },
      }), { status: 200 });
    },
  });

  const result = await client.trade('3112335', 'buy', 4);
  assert.equal(result.replayed, true);
  assert.deepEqual(seenKeys, ['fixed-request-key', 'fixed-request-key']);
});

test('trades use the Flask route and include the listing version', async () => {
  let requestedUrl = '';
  let requestedBody = '';
  const client = new MarketApiClient({
    baseUrl: 'https://api.example.com/api/nba-stock-market/',
    expectedUserId: 'alice',
    getAccessToken: aliceToken,
    idempotencyKeyFactory: () => 'trade-contract-key',
    fetchImpl: async (url, init) => {
      requestedUrl = String(url);
      requestedBody = String(init?.body);
      return new Response(JSON.stringify({
        data: { replayed: false, portfolio, trade },
      }), { status: 200 });
    },
  });

  await client.trade('3112335', 'buy', 4);

  assert.equal(
    requestedUrl,
    'https://api.example.com/api/nba-stock-market/trades',
  );
  assert.deepEqual(JSON.parse(requestedBody), {
    player_id: '3112335',
    side: 'buy',
    expected_player_version: 4,
  });
});

test('weekly shorts bind the mutation to the displayed replay date', async () => {
  let requestedBody = '';
  const client = new MarketApiClient({
    baseUrl: 'https://api.example.com/api/nba-stock-market',
    expectedUserId: 'alice',
    getAccessToken: aliceToken,
    idempotencyKeyFactory: () => 'short-contract-key',
    fetchImpl: async (_url, init) => {
      requestedBody = String(init?.body);
      return new Response(JSON.stringify({
        data: {
          replayed: false,
          portfolio,
          position: {
            id: 'short-one',
            player_id: '3112335',
            week_start: '2025-10-20',
            week_end: '2025-10-27',
            status: 'active',
            opening_price_cents: 5_000_000_000,
            fee_cents: 12_500_000,
            collateral_cents: 200_000_000,
            accrued_net_points_micros: 0,
            payout_cents: null,
            qualifying_games: 0,
            settled_game_date: null,
            created_at: '2026-07-21T00:00:00Z',
          },
        },
      }), { status: 200 });
    },
  });

  await client.armWeeklyShort('3112335', '2025-10-21', 4);

  assert.deepEqual(JSON.parse(requestedBody), {
    player_id: '3112335',
    expected_game_date: '2025-10-21',
    expected_player_version: 4,
  });
});

test('historical day advancement uses the Flask admin settlement contract', async () => {
  let requestedUrl = '';
  let requestedBody = '';
  const client = new MarketApiClient({
    baseUrl: 'https://api.example.com/api/nba-stock-market',
    expectedUserId: 'alice',
    getAccessToken: aliceToken,
    idempotencyKeyFactory: () => 'advance-contract-key',
    fetchImpl: async (url, init) => {
      requestedUrl = String(url);
      requestedBody = String(init?.body);
      return new Response(JSON.stringify({
        data: {
          replayed: false,
          game_date: '2025-10-20',
          next_game_date: '2025-10-21',
          is_complete: false,
          event_count: 12,
          payout_count: 4,
          net_cash_cents: 150_000,
          cash_breakdown_cents: {
            dividends: 200_000,
            weekly_shorts: -50_000,
            boosts: 0,
          },
        },
      }), { status: 200 });
    },
  });

  const result = await client.advanceDay('2025-10-20');

  assert.equal(
    requestedUrl,
    'https://api.example.com/api/nba-stock-market/admin/settlements/next',
  );
  assert.deepEqual(JSON.parse(requestedBody), {
    confirmation: 'SETTLE',
    expected_game_date: '2025-10-20',
  });
  assert.equal(result.next_game_date, '2025-10-21');
});

test('a mutation retries a failed response body with the same idempotency key', async () => {
  const seenKeys: string[] = [];
  let calls = 0;
  const client = new MarketApiClient({
    baseUrl: 'https://api.example.com',
    expectedUserId: 'alice',
    getAccessToken: aliceToken,
    idempotencyKeyFactory: () => 'body-retry-key',
    fetchImpl: async (_url, init) => {
      calls += 1;
      seenKeys.push((init?.headers as Record<string, string>)['Idempotency-Key']);
      if (calls === 1) {
        return {
          ok: true,
          status: 200,
          text: async () => { throw new TypeError('response body disconnected'); },
        } as unknown as Response;
      }
      return new Response(JSON.stringify({
        data: { replayed: true, portfolio, trade },
      }), { status: 200 });
    },
  });

  const result = await client.trade('3112335', 'buy', 4);

  assert.equal(result.replayed, true);
  assert.deepEqual(seenKeys, ['body-retry-key', 'body-retry-key']);
});

test('a mutation retry cannot cross into a newly signed-in account', async () => {
  let tokenReads = 0;
  let fetchCalls = 0;
  const client = new MarketApiClient({
    baseUrl: 'https://api.example.com',
    expectedUserId: 'alice',
    getAccessToken: async () => {
      tokenReads += 1;
      return tokenReads === 1
        ? { accessToken: 'alice-token', userId: 'alice' }
        : { accessToken: 'bob-token', userId: 'bob' };
    },
    idempotencyKeyFactory: () => 'account-bound-key',
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new TypeError('connection reset');
    },
  });

  await assert.rejects(
    client.trade('3112335', 'buy', 4),
    (error: unknown) => (
      error instanceof MarketApiError
      && error.code === 'account_changed'
      && error.requestMayHaveCommitted
    ),
  );
  assert.equal(fetchCalls, 1);
});

test('a terminal auth response preserves ambiguity from an earlier mutation attempt', async () => {
  let fetchCalls = 0;
  const client = new MarketApiClient({
    baseUrl: 'https://api.example.com',
    expectedUserId: 'alice',
    getAccessToken: aliceToken,
    idempotencyKeyFactory: () => 'ambiguous-auth-key',
    fetchImpl: async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) throw new TypeError('connection reset');
      return new Response(
        JSON.stringify({ error: { code: 'unauthorized', message: 'No.' } }),
        { status: 401 },
      );
    },
  });

  await assert.rejects(
    client.trade('3112335', 'buy', 4),
    (error: unknown) => (
      error instanceof MarketApiError
      && error.code === 'unauthorized'
      && error.requestMayHaveCommitted
    ),
  );
  assert.equal(fetchCalls, 3);
});

test('armed boosts accept the API null payout until settlement', async () => {
  const armedPortfolio = {
    ...portfolio,
    instruments: {
      ...portfolio.instruments,
      boost_slots: { limit: 2, used: 1, remaining: 1 },
      boosts: [{
        id: 'boost-1', player_id: 'sga', week_start: '2025-10-20',
        game_date: '2025-10-23', status: 'armed', opening_price_cents: 5_000_000_000,
        fee_cents: 12_500_000, payout_cents: null, settled_game_date: null,
        created_at: '2025-10-20T12:00:00Z',
      }],
    },
  };
  const client = new MarketApiClient({
    baseUrl: 'https://api.example.com',
    expectedUserId: 'alice',
    getAccessToken: aliceToken,
    fetchImpl: async () => new Response(JSON.stringify({ data: armedPortfolio }), { status: 200 }),
  });

  const result = await client.portfolio();

  assert.equal(result.instruments.boosts[0].payout_cents, null);
});

test('malformed success payloads fail closed instead of becoming app state', async () => {
  const client = new MarketApiClient({
    baseUrl: 'https://api.example.com',
    expectedUserId: 'alice',
    getAccessToken: aliceToken,
    fetchImpl: async () => new Response(JSON.stringify({ data: { ...portfolio, cash_cents: 3.5 } }), { status: 200 }),
  });

  await assert.rejects(
    client.portfolio(),
    (error: unknown) => error instanceof MarketApiError && error.code === 'invalid_response',
  );
});

test('malformed server dates fail closed before reaching rendering', async () => {
  const client = new MarketApiClient({
    baseUrl: 'https://api.example.com',
    expectedUserId: 'alice',
    getAccessToken: aliceToken,
    fetchImpl: async () => new Response(JSON.stringify({
      data: {
        season_id: '2025-26', last_settled_date: null,
        next_game_date: '2025-02-30', is_complete: false, version: 0,
      },
    }), { status: 200 }),
  });

  await assert.rejects(
    client.game(),
    (error: unknown) => error instanceof MarketApiError && error.code === 'invalid_response',
  );
});

test('malformed server timestamps fail closed before becoming account state', async () => {
  const client = new MarketApiClient({
    baseUrl: 'https://api.example.com',
    expectedUserId: 'alice',
    getAccessToken: aliceToken,
    fetchImpl: async () => new Response(JSON.stringify({
      data: { ...portfolio, reset_at: '2026-07-21T25:00:00Z' },
    }), { status: 200 }),
  });

  await assert.rejects(
    client.portfolio(),
    (error: unknown) => error instanceof MarketApiError && error.code === 'invalid_response',
  );
});

test('public Flask problem codes survive for user-safe conflict handling', async () => {
  const client = new MarketApiClient({
    baseUrl: 'https://api.example.com',
    expectedUserId: 'alice',
    getAccessToken: aliceToken,
    fetchImpl: async () => new Response(JSON.stringify({
      error: { code: 'holding_cap', message: 'You already own this player.' },
    }), { status: 409 }),
  });

  await assert.rejects(
    client.trade('3112335', 'buy', 4),
    (error: unknown) => error instanceof MarketApiError
      && error.code === 'holding_cap'
      && error.message === 'You already own this player.',
  );
});

test('bootstrap loads one server-owned snapshot instead of stitching client reads', async () => {
  const requestedPaths: string[] = [];
  const client = new MarketApiClient({
    baseUrl: 'https://api.example.com',
    expectedUserId: 'alice',
    getAccessToken: aliceToken,
    fetchImpl: async (input) => {
      const path = new URL(String(input)).pathname;
      requestedPaths.push(path);
      return new Response(JSON.stringify({ data: bootstrapPayload }), { status: 200 });
    },
  });

  const result = await client.bootstrap();

  assert.equal(result.portfolio.account_id, 'alice');
  assert.deepEqual(requestedPaths, ['/bootstrap']);
});

test('bootstrap rejects future-result contract corruption before it becomes app state', async () => {
  const client = new MarketApiClient({
    baseUrl: 'https://api.example.com',
    expectedUserId: 'alice',
    getAccessToken: aliceToken,
    fetchImpl: async () => new Response(JSON.stringify({
      data: {
        ...bootstrapPayload,
        settled_results: [{
          player_id: 'sga', game_date: 'not-a-date',
          actual_net_points_micros: 1,
          expected_net_points_micros: 1,
          dividend_cents: 0,
        }],
      },
    }), { status: 200 }),
  });

  await assert.rejects(
    client.bootstrap(),
    (error: unknown) => error instanceof MarketApiError && error.code === 'invalid_response',
  );
});
