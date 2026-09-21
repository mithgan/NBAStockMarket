import assert from 'node:assert/strict';
import test from 'node:test';
import type { GameAuthSession } from './authTypes';
import { DataballrSessionStore } from './databallrSession';
import { MarketApiClient } from '../api/client';
import { PerGameApiClient } from '../api/perGameClient';

const config = {
  issuer: 'https://accounts.databallr.com/api/auth',
  audience: 'https://api.databallr.com/v1/apps/stock-market',
  clientId: 'fixture-production-public-client',
  redirectUri: 'https://game.example.test/oauth/callback',
};
const user = { sub: '4c706596-c975-4bdb-a0ec-c4586fa19f61', email: 'player@example.test' };
const request = {
  callbackUrl: config.redirectUri + '?' + new URLSearchParams({
    code: 'fixture-code', state: 'fixture-state', iss: config.issuer,
  }),
  expectedState: 'fixture-state', codeVerifier: 'v'.repeat(43),
};
const token = (label: string, overrides: Record<string, unknown> = {}) => ({
  access_token: 'access-' + label, refresh_token: 'refresh-' + label,
  token_type: 'Bearer', expires_in: 60, scope: 'openid profile email offline_access', ...overrides,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function harness() {
  let now = 1000;
  let codeCalls = 0;
  let refreshCalls = 0;
  let identity = user;
  const calls: { url: string; init: RequestInit; form: URLSearchParams }[] = [];
  const snapshots: (GameAuthSession | null)[] = [];
  let refresh: (form: URLSearchParams, init: RequestInit) => Promise<Response> = async () =>
    Response.json(token('rotated-' + refreshCalls));
  let userinfo: (init: RequestInit) => Promise<Response> = async () => Response.json(identity);
  let revoke: () => Promise<Response> = async () => new Response(null, { status: 204 });
  let code: () => Promise<Response> = async () => Response.json(token('login-' + codeCalls));
  const fetcher = (async (url, init = {}) => {
    const form = new URLSearchParams(String(init.body ?? ''));
    calls.push({ url: String(url), init, form });
    if (String(url).endsWith('/oauth2/userinfo')) return userinfo(init);
    if (String(url).endsWith('/oauth2/revoke')) return revoke();
    assert.equal(String(url), config.issuer + '/oauth2/token');
    if (form.get('grant_type') === 'refresh_token') {
      refreshCalls++;
      return refresh(form, init);
    }
    assert.equal(form.get('grant_type'), 'authorization_code');
    codeCalls++;
    return code();
  }) as typeof fetch;
  const store = new DataballrSessionStore(config, (session) => snapshots.push(session), fetcher, () => now);
  return {
    store, snapshots, calls,
    login: () => store.complete(store.begin(), request),
    session: () => snapshots.at(-1)!,
    setTime: (value: number) => { now = value; },
    setIdentity: (value: typeof user) => { identity = value; },
    setRefresh: (handler: typeof refresh) => { refresh = handler; },
    setUserinfo: (handler: typeof userinfo) => { userinfo = handler; },
    setRevoke: (handler: typeof revoke) => { revoke = handler; },
    setCode: (handler: typeof code) => { code = handler; },
    refreshes: () => calls.filter((call) => call.form.get('grant_type') === 'refresh_token'),
    revokes: () => calls.filter((call) => call.url.endsWith('/oauth2/revoke')),
  };
}

test('production callback remains exact, bound to state/issuer and one code', async () => {
  for (const callbackUrl of [
    request.callbackUrl.replace('/oauth/callback?', '/?'),
    request.callbackUrl.replace('/oauth/callback?', '/oauth/callback/?'),
    request.callbackUrl.replace('game.example.test', 'other.example.test'),
    request.callbackUrl + '&code=second', request.callbackUrl + '&state=second',
    request.callbackUrl + '&iss=second', request.callbackUrl + '#fragment',
  ]) {
    const h = harness();
    await assert.rejects(h.store.complete(h.store.begin(), { ...request, callbackUrl }));
    assert.equal(h.calls.length, 0);
  }
});

test('production requires refresh issuance and never exposes refresh credentials in public snapshots', async () => {
  const h = harness();
  await h.login();
  assert.deepEqual(Object.keys(h.session()).sort(), ['access_token', 'expires_at', 'user']);
  assert.doesNotMatch(JSON.stringify(h.snapshots), /refresh-login/);
  assert.doesNotMatch(JSON.stringify(h.store), /refresh-login/);
  const missing = harness();
  missing.setCode(async () => Response.json(token('missing', { refresh_token: undefined })));
  await assert.rejects(missing.login(), /invalid access token/);
  assert.equal(await missing.store.getAccessToken(false), null);
  assert.equal(missing.calls.length, 1);
  await h.store.signOut();
});

test('simultaneous expired/401 requests share one rotation and retained clients survive token changes', async () => {
  const h = harness();
  await h.login();
  const original = h.session();
  const response = deferred<Response>();
  h.setRefresh(async () => response.promise);
  h.setTime(61_000);
  const first = h.store.getAccessToken(false, original);
  const second = h.store.getAccessToken(true, original, 'access-login-1');
  const third = h.store.getAccessToken(false, original);
  assert.equal(h.refreshes().length, 1);
  response.resolve(Response.json(token('rotated-1')));
  const expected = { accessToken: 'access-rotated-1', userId: user.sub };
  assert.deepEqual(await Promise.all([first, second, third]), [expected, expected, expected]);
  assert.deepEqual(await h.store.getAccessToken(false, original), expected);
  const form = h.refreshes()[0].form;
  assert.equal(form.get('refresh_token'), 'refresh-login-1');
  assert.equal(form.get('client_id'), config.clientId);
  assert.equal(form.get('resource'), config.audience);
  assert.equal(form.get('scope'), 'openid profile email offline_access');
  assert.equal(form.has('client_secret'), false);
  for (const call of h.calls) {
    assert.equal(call.init.credentials, 'omit');
    assert.equal(call.init.redirect, 'error');
  }
  assert.notEqual(h.session(), original);
  assert.equal(h.store.getLoginSession(h.session()), original);
  assert.equal(h.store.getLoginSession(original), original);
  h.setRefresh(async () => Response.json(token('rotated-2')));
  await h.store.getAccessToken(true, original, 'access-rotated-1');
  assert.equal(h.refreshes()[1].form.get('refresh_token'), 'refresh-rotated-1');
  await h.store.signOut();
  assert.deepEqual(h.revokes().map((call) => call.form.get('token')), ['refresh-rotated-2']);
});

test('a delayed 401 reuses the newer bearer; rejection of that bearer can rotate again', async () => {
  const h = harness();
  await h.login();
  const original = h.session();
  await h.store.getAccessToken(true, original, 'access-login-1');
  assert.deepEqual(await h.store.getAccessToken(true, original, 'access-login-1'), {
    accessToken: 'access-rotated-1', userId: user.sub,
  });
  assert.equal(h.refreshes().length, 1);
  await h.store.getAccessToken(true, original, 'access-rotated-1');
  assert.equal(h.refreshes().length, 2);
  await h.store.signOut();
});

test('ambiguous refresh failure never retries or revokes the possibly consumed token', async () => {
  for (const failure of [
    async () => { throw new Error('private lost response'); },
    async () => new Response('private invalid json'),
    async () => Response.json({ error: 'invalid_grant', detail: 'private' }, { status: 400 }),
  ]) {
    const h = harness();
    await h.login();
    h.setRefresh(failure);
    const expected = h.session();
    assert.deepEqual(await Promise.all([
      h.store.getAccessToken(true, expected, 'access-login-1'),
      h.store.getAccessToken(true, expected, 'access-login-1'),
    ]), [null, null]);
    assert.equal(await h.store.getAccessToken(true, expected), null);
    await h.store.signOut();
    assert.equal(h.session(), null);
    assert.equal(h.refreshes().length, 1);
    assert.equal(h.revokes().length, 0);
  }
});

test('malformed or missing rotated tokens fail closed without reusing the old token', async () => {
  for (const overrides of [
    { refresh_token: undefined }, { refresh_token: 'refresh-login-1' },
    { refresh_token: '' }, { refresh_token: 'has whitespace' },
    { access_token: '' }, { access_token: 'has whitespace' },
    { token_type: 'Basic' }, { expires_in: 0 }, { expires_in: 3601 },
    { expires_in: 0.5 }, { scope: 'openid profile email' },
  ]) {
    const h = harness();
    await h.login();
    h.setRefresh(async () => Response.json(token('rotated', overrides)));
    assert.equal(await h.store.getAccessToken(true), null);
    assert.equal(await h.store.getAccessToken(true), null);
    await h.store.signOut();
    assert.equal(h.refreshes().length, 1);
    assert.equal(h.revokes().some((call) => call.form.get('token') === 'refresh-login-1'), false);
    const newTokenIssued = !('refresh_token' in overrides);
    assert.equal(h.revokes().length, newTokenIssued ? 1 : 0);
  }
});

test('refresh confirms the original subject, rejects incomplete identity and expired issuer userinfo', async () => {
  for (const rejectedIdentity of [
    async () => Response.json({ ...user, sub: '90525cbd-126c-414d-819a-9a78691e6ccc' }),
    async () => Response.json({ ...user, email: null }),
    async () => Response.json({ error: 'issuer_session_expired' }, { status: 401 }),
    async () => { throw new Error('private userinfo unavailable'); },
  ]) {
    const h = harness();
    await h.login();
    h.setUserinfo(rejectedIdentity);
    assert.equal(await h.store.getAccessToken(true), null);
    assert.equal(h.session(), null);
    await h.store.signOut();
    assert.equal(h.refreshes().length, 1);
    assert.deepEqual(h.revokes().map((call) => call.form.get('token')), ['refresh-rotated-1']);
    assert.equal(await h.store.getAccessToken(false), null);
  }
});

test('rotation publishes neither new access nor refresh until userinfo succeeds', async () => {
  const h = harness();
  await h.login();
  const original = h.session();
  const userinfoEntered = deferred<void>();
  const profile = deferred<Response>();
  h.setUserinfo(async () => { userinfoEntered.resolve(); return profile.promise; });
  const pending = h.store.getAccessToken(true, original);
  await userinfoEntered.promise;
  assert.equal(h.session(), original);
  assert.equal(h.revokes().length, 0);
  profile.resolve(Response.json({ ...user, email: 'updated@example.test' }));
  await pending;
  assert.equal(h.session().user.email, 'updated@example.test');
  assert.equal(h.session().user.id, user.sub);
  await h.store.signOut();
});

test('a token that expires during identity confirmation is never published', async () => {
  const h = harness();
  await h.login();
  h.setUserinfo(async () => { h.setTime(61_000); return Response.json(user); });
  assert.equal(await h.store.getAccessToken(true), null);
  assert.equal(h.session(), null);
  assert.deepEqual(h.revokes().map((call) => call.form.get('token')), ['refresh-rotated-1']);
});

test('logout during a refresh waits for the successor and revokes it once without restoring login', async () => {
  const h = harness();
  await h.login();
  const response = deferred<Response>();
  h.setRefresh(async () => response.promise);
  const pending = h.store.getAccessToken(true);
  const signedOut = h.store.signOut();
  const duplicateSignOut = h.store.signOut();
  assert.equal(h.session(), null);
  assert.equal(h.refreshes()[0].init.signal?.aborted, false);
  assert.equal(h.revokes().length, 0);
  response.resolve(Response.json(token('late')));
  assert.equal(await pending, null);
  await Promise.all([signedOut, duplicateSignOut]);
  assert.equal(h.session(), null);
  assert.deepEqual(h.revokes().map((call) => call.form.get('token')), ['refresh-late']);
  assert.equal(await h.store.getAccessToken(false), null);
});

test('logout during identity confirmation revokes only the fresh token even if identity fails', async () => {
  for (const status of [200, 401]) {
    const h = harness();
    await h.login();
    const entered = deferred<void>();
    const profile = deferred<Response>();
    h.setUserinfo(async () => { entered.resolve(); return profile.promise; });
    const pending = h.store.getAccessToken(true);
    await entered.promise;
    const logout = h.store.signOut();
    profile.resolve(Response.json(status === 200 ? user : { error: 'expired' }, { status }));
    assert.equal(await pending, null);
    await logout;
    assert.equal(h.session(), null);
    assert.deepEqual(h.revokes().map((call) => call.form.get('token')), ['refresh-rotated-1']);
  }
});

test('account switch fences an old refresh response and old clients, including same-user relogin', async () => {
  for (const sameUser of [false, true]) {
    const h = harness();
    await h.login();
    const original = h.session();
    const response = deferred<Response>();
    h.setRefresh(async () => response.promise);
    const pending = h.store.getAccessToken(true, original);
    const logout = h.store.signOut();
    const newUser = sameUser ? user : { ...user, sub: '90525cbd-126c-414d-819a-9a78691e6ccc' };
    h.setIdentity(newUser);
    await h.login();
    const replacement = h.session();
    response.resolve(Response.json(token('old-generation')));
    assert.equal(await pending, null);
    await logout;
    assert.equal(h.session(), replacement);
    assert.equal(h.store.getLoginSession(original), null);
    assert.equal(h.store.getLoginSession(replacement), replacement);
    assert.equal(await h.store.getAccessToken(false, original), null);
    assert.deepEqual(await h.store.getAccessToken(false, replacement), {
      accessToken: 'access-login-2', userId: newUser.sub,
    });
    assert.deepEqual(h.revokes().map((call) => call.form.get('token')), ['refresh-old-generation']);
    await h.store.signOut();
  }
});

test('logout is local immediately, attempts revocation once and never signs out the account SSO', async () => {
  for (const failure of [
    async () => { throw new Error('private revocation failure'); },
    async () => new Response('private', { status: 503 }),
  ]) {
    const h = harness();
    await h.login();
    h.setRevoke(failure);
    const pending = h.store.signOut();
    assert.equal(h.session(), null);
    assert.equal(await h.store.getAccessToken(false), null);
    await pending;
    await h.store.signOut();
    assert.equal(h.revokes().length, 1);
    const call = h.revokes()[0];
    assert.equal(call.form.get('client_id'), config.clientId);
    assert.equal(call.form.get('token'), 'refresh-login-1');
    assert.equal(call.form.get('token_type_hint'), 'refresh_token');
    assert.equal(call.form.has('client_secret'), false);
    assert.equal(call.init.keepalive, true);
    assert.equal(h.calls.some((entry) => entry.url.includes('sign-out')), false);
  }
});

test('both API clients pass the actual rejected bearer so a delayed 401 cannot consume another refresh', async () => {
  for (const Client of [MarketApiClient, PerGameApiClient]) {
    const h = harness();
    await h.login();
    const original = h.session();
    const firstStarted = deferred<void>();
    const secondStarted = deferred<void>();
    const firstResponse = deferred<Response>();
    const secondResponse = deferred<Response>();
    const rejected: (string | undefined)[] = [];
    const sent: string[] = [];
    const api = new Client({
      baseUrl: 'https://api.example.test', expectedUserId: user.sub,
      getAccessToken: async (force, oldToken) => {
        if (force) rejected.push(oldToken);
        return h.store.getAccessToken(force, original, oldToken);
      },
      fetchImpl: (async (_url, init) => {
        sent.push(new Headers(init?.headers).get('authorization')!);
        if (sent.length === 1) { firstStarted.resolve(); return firstResponse.promise; }
        if (sent.length === 2) { secondStarted.resolve(); return secondResponse.promise; }
        // A terminal conflict proves the auth retry completed without needing
        // identical legacy/v2 bootstrap fixture shapes in this shared test.
        return Response.json({ error: { code: 'fixture_conflict', message: 'Fixture conflict' } }, { status: 409 });
      }) as typeof fetch,
    });
    const first = assert.rejects(api.bootstrap(), /Fixture conflict/);
    await firstStarted.promise;
    const second = assert.rejects(api.bootstrap(), /Fixture conflict/);
    await secondStarted.promise;
    firstResponse.resolve(Response.json({ error: 'expired' }, { status: 401 }));
    await first;
    secondResponse.resolve(Response.json({ error: 'expired' }, { status: 401 }));
    await second;
    assert.deepEqual(rejected, ['access-login-1', 'access-login-1']);
    assert.deepEqual(sent, ['Bearer access-login-1', 'Bearer access-login-1',
      'Bearer access-rotated-1', 'Bearer access-rotated-1']);
    assert.equal(h.refreshes().length, 1);
    await h.store.signOut();
  }
});

test('logout drains a started production code exchange and revokes its offline token without signing in', async () => {
  const h = harness();
  const response = deferred<Response>();
  h.setCode(async () => response.promise);
  const pending = h.login();
  const logout = h.store.signOut();
  const duplicate = h.store.signOut();
  assert.equal(h.session(), null);
  assert.equal(h.calls[0].init.signal?.aborted, false);
  response.resolve(Response.json(token('late-code')));
  assert.equal(await pending, false);
  await Promise.all([logout, duplicate]);
  assert.equal(await h.store.getAccessToken(false), null);
  assert.equal(h.session(), null);
  assert.deepEqual(h.revokes().map((call) => call.form.get('token')), ['refresh-late-code']);
});

test('an ambiguous cancelled code exchange is not retried and cannot revoke an unknown token', async () => {
  const h = harness();
  const response = deferred<Response>();
  h.setCode(async () => response.promise);
  const pending = h.login();
  const logout = h.store.signOut();
  response.resolve(new Response('malformed token response'));
  assert.equal(await pending, false);
  await logout;
  assert.equal(h.calls.length, 1);
  assert.equal(h.revokes().length, 0);
  assert.equal(h.session(), null);
});

test('both API clients stop after one refresh when the replacement bearer is also rejected', async () => {
  for (const Client of [MarketApiClient, PerGameApiClient]) {
    const h = harness();
    await h.login();
    const original = h.session();
    let apiCalls = 0;
    const api = new Client({
      baseUrl: 'https://api.example.test', expectedUserId: user.sub,
      getAccessToken: async (force, oldToken) => h.store.getAccessToken(force, original, oldToken),
      fetchImpl: async () => { apiCalls++; return Response.json({
        error: { code: 'unauthorized', message: 'Still rejected' },
      }, { status: 401 }); },
    });
    await assert.rejects(api.bootstrap(), /Still rejected/);
    assert.equal(apiCalls, 2);
    assert.equal(h.refreshes().length, 1);
    await h.store.signOut();
  }
});
