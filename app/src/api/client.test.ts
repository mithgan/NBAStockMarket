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
  current_price_cents: 5_000_000_000, opening_price_cents: 5_000_000_000,
  actual_salary_cents: 4_000_000_000, shares_outstanding: 100,
  available_shares: 100, buy_fee_cents: 12_500_000, ownership_bps: 0, volume_30d: 0,
}];

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

test('bootstrap creates the portfolio before parallel account reads begin', async () => {
  let releasePortfolio!: () => void;
  const portfolioGate = new Promise<void>((resolve) => { releasePortfolio = resolve; });
  const requestedPaths: string[] = [];
  const client = new MarketApiClient({
    baseUrl: 'https://api.example.com',
    expectedUserId: 'alice',
    getAccessToken: aliceToken,
    fetchImpl: async (input) => {
      const path = new URL(String(input)).pathname;
      requestedPaths.push(path);
      if (path === '/api/v1/portfolio') {
        await portfolioGate;
        return new Response(JSON.stringify({ data: portfolio }), { status: 200 });
      }
      const payloads: Record<string, unknown> = {
        '/api/v1/market': market,
        '/api/v1/game': {
          season_id: '2025-26', last_settled_date: null,
          next_game_date: '2025-10-20', is_complete: false, version: 0,
        },
        '/api/v1/activity': { items: [], next_cursor: null },
        '/api/v1/portfolio/history': { items: [], next_cursor: null },
        '/api/v1/settlements': [],
        '/api/v1/leaderboard': [],
      };
      return new Response(JSON.stringify({ data: payloads[path] }), { status: 200 });
    },
  });

  const pending = client.bootstrap();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(requestedPaths, ['/api/v1/portfolio']);

  releasePortfolio();
  const result = await pending;
  assert.equal(result.portfolio.account_id, 'alice');
  assert.deepEqual(new Set(requestedPaths.slice(1)), new Set([
    '/api/v1/market',
    '/api/v1/game',
    '/api/v1/activity',
    '/api/v1/portfolio',
    '/api/v1/portfolio/history',
    '/api/v1/settlements',
    '/api/v1/leaderboard',
  ]));
  assert.equal(requestedPaths.filter((path) => path === '/api/v1/portfolio').length, 2);
  assert.equal(requestedPaths.filter((path) => path === '/api/v1/game').length, 2);
});

test('bootstrap retries when the account changes across its read window', async () => {
  let portfolioReads = 0;
  let gameReads = 0;
  let marketReads = 0;
  const client = new MarketApiClient({
    baseUrl: 'https://api.example.com',
    expectedUserId: 'alice',
    getAccessToken: aliceToken,
    fetchImpl: async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/portfolio') {
        portfolioReads += 1;
        const version = portfolioReads === 1 ? 1 : 2;
        return new Response(JSON.stringify({ data: { ...portfolio, version } }), { status: 200 });
      }
      if (path === '/api/v1/game') {
        gameReads += 1;
        return new Response(JSON.stringify({ data: {
          season_id: '2025-26', last_settled_date: null,
          next_game_date: '2025-10-20', is_complete: false, version: 0,
        } }), { status: 200 });
      }
      if (path === '/api/v1/market') {
        marketReads += 1;
        return new Response(JSON.stringify({ data: market }), { status: 200 });
      }
      const payloads: Record<string, unknown> = {
        '/api/v1/activity': { items: [], next_cursor: null },
        '/api/v1/portfolio/history': { items: [], next_cursor: null },
        '/api/v1/settlements': [],
        '/api/v1/leaderboard': [],
      };
      return new Response(JSON.stringify({ data: payloads[path] }), { status: 200 });
    },
  });

  const result = await client.bootstrap();

  assert.equal(result.portfolio.version, 2);
  assert.equal(portfolioReads, 3);
  assert.equal(gameReads, 4);
  assert.equal(marketReads, 2);
});
