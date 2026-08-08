import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MarketApiClient,
  MarketApiError,
  mutationFailureMayHaveCommitted,
} from './client';
import { parseLeaderboardRow } from './contracts';

test('mutation failures distinguish definite rejections from indeterminate commits', () => {
  assert.equal(
    mutationFailureMayHaveCommitted(
      new MarketApiError('Already owned.', 'holding_cap', 409),
    ),
    false,
  );
  assert.equal(
    mutationFailureMayHaveCommitted(
      new MarketApiError('Unreadable.', 'invalid_response', 201),
    ),
    true,
  );
  assert.equal(
    mutationFailureMayHaveCommitted(
      new MarketApiError('Unreadable rejection.', 'invalid_response', 409),
    ),
    false,
  );
  assert.equal(
    mutationFailureMayHaveCommitted(
      new MarketApiError('Retry rejected.', 'request_failed', 409, true),
    ),
    true,
  );
  assert.equal(
    mutationFailureMayHaveCommitted(
      new MarketApiError('Timed out.', 'timeout', null),
    ),
    true,
  );
});

test('leaderboard rows prefer opaque IDs and keep legacy Flask rows unique', () => {
  const opaque = parseLeaderboardRow({
    rank: 1,
    entry_id: 'trader_opaque_one',
    display_name: 'Trader abc123',
    total_value_cents: 14_000_000_000,
    return_bps: 0,
    is_current_user: false,
  });
  const legacy = parseLeaderboardRow({
    rank: 2,
    display_name: 'Trader abc123',
    total_value_cents: 13_000_000_000,
    return_bps: -100,
    is_current_user: false,
  });

  assert.equal(opaque.account_id, 'trader_opaque_one');
  assert.equal(legacy.account_id, 'legacy:2:Trader abc123');
  assert.notEqual(opaque.account_id, legacy.account_id);
});

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
  current_price_cents: 5_000_000_000, opening_price_cents: 5_000_000_000,
  actual_salary_cents: 4_000_000_000, shares_outstanding: 100,
  available_shares: 100, buy_fee_cents: 12_500_000, ownership_bps: 0,
  volume_30d: 0, version: 7,
}];

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
    'https://api.example.com/api/nba-stock-market/portfolio',
    'https://api.example.com/api/nba-stock-market/portfolio',
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
      return new Response(JSON.stringify({ data: { replayed: true, portfolio } }), { status: 200 });
    },
  });

  const result = await client.trade('3112335', 'buy');
  assert.equal(result.replayed, true);
  assert.deepEqual(seenKeys, ['fixed-request-key', 'fixed-request-key']);
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
      return new Response(JSON.stringify({ data: { replayed: true, portfolio } }), { status: 200 });
    },
  });

  const result = await client.trade('3112335', 'buy');

  assert.equal(result.replayed, true);
  assert.deepEqual(seenKeys, ['body-retry-key', 'body-retry-key']);
});

test('a mutation preserves commit uncertainty when its retry gets a malformed 4xx', async () => {
  let calls = 0;
  const client = new MarketApiClient({
    baseUrl: 'https://api.example.com',
    expectedUserId: 'alice',
    getAccessToken: aliceToken,
    idempotencyKeyFactory: () => 'uncertain-trade-key',
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('connection reset');
      return new Response('<html>conflict</html>', { status: 409 });
    },
  });

  await assert.rejects(
    client.trade('3112335', 'buy'),
    (error: unknown) => mutationFailureMayHaveCommitted(error),
  );
  assert.equal(calls, 2);
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
    client.trade('3112335', 'buy'),
    (error: unknown) => error instanceof MarketApiError && error.code === 'account_changed',
  );
  assert.equal(fetchCalls, 1);
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

test('public FastAPI problem codes survive for user-safe conflict handling', async () => {
  const client = new MarketApiClient({
    baseUrl: 'https://api.example.com',
    expectedUserId: 'alice',
    getAccessToken: aliceToken,
    fetchImpl: async () => new Response(JSON.stringify({
      error: { code: 'holding_cap', message: 'You already own this player.' },
    }), { status: 409 }),
  });

  await assert.rejects(
    client.trade('3112335', 'buy'),
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
  assert.equal(result.capabilities.can_advance_day, true);
  assert.deepEqual(requestedPaths, ['/api/nba-stock-market/bootstrap']);
});

test('bootstrap can request only results after the last installed settlement', async () => {
  const requestedUrls: string[] = [];
  const client = new MarketApiClient({
    baseUrl: 'https://api.example.com',
    expectedUserId: 'alice',
    getAccessToken: aliceToken,
    fetchImpl: async (input) => {
      requestedUrls.push(String(input));
      return new Response(JSON.stringify({ data: bootstrapPayload }), { status: 200 });
    },
  });

  await client.bootstrap('2025-10-21');

  assert.deepEqual(requestedUrls, [
    'https://api.example.com/api/nba-stock-market/bootstrap?settled_results_after=2025-10-21',
  ]);
});

test('trade requests one authoritative incremental snapshot in its mutation response', async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const client = new MarketApiClient({
    baseUrl: 'https://api.example.com',
    expectedUserId: 'alice',
    getAccessToken: aliceToken,
    idempotencyKeyFactory: () => 'trade-bootstrap-key',
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)),
      });
      return new Response(JSON.stringify({
        data: { replayed: false, portfolio, bootstrap: bootstrapPayload },
      }), { status: 201 });
    },
  });

  const result = await client.trade('sga', 'buy', 7, '2025-10-21');

  assert.equal(result.bootstrap?.portfolio.account_id, 'alice');
  assert.deepEqual(requests, [{
    url: 'https://api.example.com/api/nba-stock-market/trades',
    body: {
      player_id: 'sga',
      side: 'buy',
      expected_player_version: 7,
      settled_results_after: '2025-10-21',
    },
  }]);
});

test('trade remains compatible with an older backend that omits the snapshot', async () => {
  const client = new MarketApiClient({
    baseUrl: 'https://api.example.com',
    expectedUserId: 'alice',
    getAccessToken: aliceToken,
    fetchImpl: async () => new Response(JSON.stringify({
      data: { replayed: false, portfolio },
    }), { status: 201 }),
  });

  const result = await client.trade('sga', 'buy', 7, '2025-10-21');

  assert.equal(result.bootstrap, null);
});

test('weekly plays send Flask stale-state guards', async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const client = new MarketApiClient({
    baseUrl: 'https://api.example.com',
    expectedUserId: 'alice',
    getAccessToken: aliceToken,
    idempotencyKeyFactory: () => 'weekly-play-key',
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)),
      });
      return new Response(JSON.stringify({ data: { replayed: false, portfolio } }), { status: 201 });
    },
  });

  await client.armWeeklyShort('sga', '2025-10-22', 7);
  await client.armBoost('sga', '2025-10-23', 7);

  assert.deepEqual(requests, [
    {
      url: 'https://api.example.com/api/nba-stock-market/instruments/weekly-shorts',
      body: {
        player_id: 'sga',
        expected_game_date: '2025-10-22',
        expected_player_version: 7,
      },
    },
    {
      url: 'https://api.example.com/api/nba-stock-market/instruments/boosts',
      body: {
        player_id: 'sga',
        game_date: '2025-10-23',
        expected_player_version: 7,
      },
    },
  ]);
});

test('admin day advancement targets the Flask settlement route with an idempotency key', async () => {
  const requests: Array<{ url: string; headers: Headers; body: unknown }> = [];
  const client = new MarketApiClient({
    baseUrl: 'https://api.example.com',
    expectedUserId: 'alice',
    getAccessToken: aliceToken,
    idempotencyKeyFactory: () => 'advance-day-key',
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)),
      });
      return new Response(JSON.stringify({ data: { replayed: false } }), { status: 201 });
    },
  });

  await client.settleNext('2025-10-22');

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.example.com/api/nba-stock-market/admin/settlements/next');
  assert.equal(requests[0].headers.get('Idempotency-Key'), 'advance-day-key');
  assert.deepEqual(requests[0].body, { expected_game_date: '2025-10-22' });
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
