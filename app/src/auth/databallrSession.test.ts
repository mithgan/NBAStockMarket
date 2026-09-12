import assert from 'node:assert/strict';
import test from 'node:test';
import { MarketApiClient } from '../api/client';
import { PerGameApiClient } from '../api/perGameClient';
import type { GameAuthSession } from './authTypes';

import { DataballrSessionStore, exchangeDataballrCode } from './databallrSession';

const config = {
  issuer: 'https://accounts.databallr.dev/api/auth',
  audience: 'https://api.databallr.dev/v1/apps/stock-market',
  clientId: 'test-client',
  redirectUri: 'http://localhost:8080/',
};
const userId = '4c706596-c975-4bdb-a0ec-c4586fa19f61';
const callback = (overrides: Record<string, string> = {}) => {
  const url = new URL(config.redirectUri);
  url.search = new URLSearchParams({
    code: 'single-use-code',
    state: 'expected-state',
    iss: config.issuer,
    ...overrides,
  }).toString();
  return url.toString();
};
const request = {
  callbackUrl: callback(),
  expectedState: 'expected-state',
  codeVerifier: 'v'.repeat(43),
};
const token = {
  access_token: 'signed-access-token',
  token_type: 'Bearer',
  expires_in: 3600,
  scope: 'openid profile email',
};
const user = { sub: userId, email: 'player@example.test', email_verified: true };
const fakeFetch = (bodies: unknown[] = [token, user]) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return Response.json(bodies[calls.length - 1]);
  }) as typeof fetch;
  return { calls, fetcher };
};

test('exchanges a bound PKCE code without cookies/secrets, then trusts HTTPS userinfo identity', async () => {
  const { calls, fetcher } = fakeFetch();
  const result = await exchangeDataballrCode(
    config,
    request,
    new AbortController().signal,
    fetcher,
    () => 1000,
  );
  assert.equal(result.user.id, userId);
  assert.equal(result.user.email, user.email);
  assert.equal(result.expires_at, 3601);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, config.issuer + '/oauth2/token');
  const body = new URLSearchParams(String(calls[0].init.body));
  assert.equal(body.get('code_verifier'), request.codeVerifier);
  assert.equal(body.get('resource'), config.audience);
  assert.equal(body.get('redirect_uri'), config.redirectUri);
  assert.equal(body.get('client_id'), config.clientId);
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.has('client_secret'), false);
  assert.equal(calls[1].url, config.issuer + '/oauth2/userinfo');
  assert.equal(
    new Headers(calls[1].init.headers).get('authorization'),
    'Bearer signed-access-token',
  );
  for (const call of calls) {
    assert.equal(call.init.credentials, 'omit');
    assert.equal(call.init.redirect, 'error');
  }
  assert.equal('refresh_token' in result, false);
  assert.equal(result.user.created_at, undefined);
});

test('invalid callbacks are rejected before any network request', async () => {
  for (const callbackUrl of [
    callback({ state: 'wrong' }),
    callback({ iss: 'https://evil.test' }),
    callback({ iss: '' }),
    callback({ code: '' }),
    callback({ error: 'access_denied' }),
    callback() + '&code=second',
    callback() + '&state=second',
    callback() + '&iss=second',
    callback() + '#access_token=bad',
    callback().replace('localhost', '127.0.0.1'),
    callback().replace(':8080/', ':8080/other'),
    callback().replace('http:', 'https:'),
    'not a URL',
  ]) {
    const { fetcher, calls } = fakeFetch();
    await assert.rejects(
      exchangeDataballrCode(
        config,
        { ...request, callbackUrl },
        new AbortController().signal,
        fetcher,
      ),
      /sign-in response/i,
    );
    assert.equal(calls.length, 0, callbackUrl);
  }
});

test('invalid token or identity data cannot become a signed-in session', async () => {
  const cases = [
    [{ ...token, access_token: '' }, user],
    [{ ...token, token_type: 'Basic' }, user],
    [{ ...token, expires_in: 0 }, user],
    [{ ...token, expires_in: '3600' }, user],
    [{ ...token, expires_in: 3601 }, user],
    [{ ...token, expires_in: 1e30 }, user],
    [{ ...token, scope: 'openid' }, user],
    [token, { ...user, sub: '' }],
    [token, { ...user, email: null }],
    [token, null],
  ];
  for (const bodies of cases) {
    await assert.rejects(
      exchangeDataballrCode(
        config,
        request,
        new AbortController().signal,
        fakeFetch(bodies).fetcher,
      ),
    );
  }
});

test('upstream errors do not echo service response bodies or driver messages', async () => {
  for (const fetcher of [
    async () => new Response('private provider error', { status: 503 }),
    async () => {
      throw new Error('private network message');
    },
    async () => new Response('not json'),
  ]) {
    await assert.rejects(
      exchangeDataballrCode(config, request, new AbortController().signal, fetcher as typeof fetch),
      (error: Error) => {
        assert.doesNotMatch(error.message, /private|not json/);
        return true;
      },
    );
  }
});

test('a session expires, or is discarded immediately when the API rejects it', async () => {
  let now = 1000;
  const snapshots: unknown[] = [];
  const store = new DataballrSessionStore(
    config,
    (session) => snapshots.push(session),
    fakeFetch().fetcher,
    () => now,
  );
  assert.equal(store.getAccessToken(false), null);
  assert.equal(await store.complete(store.begin(), request), true);
  assert.deepEqual(store.getAccessToken(false), { accessToken: token.access_token, userId });
  now = 3_601_000;
  assert.equal(store.getAccessToken(false), null);
  assert.equal(snapshots.at(-1), null);
  const second = new DataballrSessionStore(
    config,
    () => {},
    fakeFetch().fetcher,
    () => 1000,
  );
  await second.complete(second.begin(), request);
  assert.equal(second.getAccessToken(true), null);
  assert.equal(second.getAccessToken(false), null);
});

test('sign-out fences a delayed response and permits a new account attempt', async () => {
  let resolve!: (response: Response) => void;
  const fetcher = (() =>
    new Promise<Response>((done) => {
      resolve = done;
    })) as typeof fetch;
  const snapshots: unknown[] = [];
  const store = new DataballrSessionStore(config, (session) => snapshots.push(session), fetcher);
  const attempt = store.begin();
  const pending = store.complete(attempt, request);
  store.clear();
  resolve(Response.json(token));
  assert.equal(await pending, false);
  assert.equal(store.getAccessToken(false), null);
  assert.equal(snapshots.at(-1), null);
  assert.notEqual(store.begin(), attempt);
});

test('concurrent sign-in and callback replay do not duplicate the code exchange', async () => {
  const { fetcher, calls } = fakeFetch();
  const store = new DataballrSessionStore(config, () => {}, fetcher);
  const attempt = store.begin();
  assert.throws(() => store.begin(), /already/);
  const first = store.complete(attempt, request);
  assert.equal(await store.complete(attempt, request), false);
  assert.equal(await first, true);
  assert.equal(await store.complete(attempt, request), false);
  assert.equal(calls.length, 2);
});

test('late API rejections cannot clear a newer session or an in-progress login', async () => {
  for (const Client of [MarketApiClient, PerGameApiClient]) {
    for (const completeNewLogin of [true, false]) {
      const snapshots: (GameAuthSession | null)[] = [];
      const nextUser = { ...user, sub: '90525cbd-126c-414d-819a-9a78691e6ccc' };
      const auth = fakeFetch([token, user, { ...token, access_token: 'new-token' }, nextUser]);
      const store = new DataballrSessionStore(
        config,
        (session) => snapshots.push(session),
        auth.fetcher,
      );
      await store.complete(store.begin(), request);
      const originalSession = snapshots.at(-1)!;
      let reply!: (value: Response) => void;
      let entered!: () => void;
      const fetchStarted = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const client = new Client({
        baseUrl: 'https://api.example.test',
        expectedUserId: userId,
        getAccessToken: async (force) => store.getAccessToken(force, originalSession),
        fetchImpl: (async () => {
          entered();
          return new Promise<Response>((resolve) => {
            reply = resolve;
          });
        }) as typeof fetch,
      });
      const pending = client.bootstrap();
      await fetchStarted;
      store.clear();
      const nextAttempt = store.begin();
      if (completeNewLogin) await store.complete(nextAttempt, request);
      reply(Response.json({ error: 'expired' }, { status: 401 }));
      await assert.rejects(pending);
      if (!completeNewLogin) assert.equal(await store.complete(nextAttempt, request), true);
      assert.deepEqual(store.getAccessToken(false), {
        accessToken: 'new-token',
        userId: nextUser.sub,
      });
    }
  }
});
