import assert from 'node:assert/strict';
import test from 'node:test';
import { canStartDataballrLogin, completeDataballrPopup, openDataballrPopup } from './databallrPopup';

const redirect = 'http://localhost:8080/';
const authUrl = 'https://accounts.databallr.dev/api/auth/oauth2/authorize';
function browserHarness() {
  const listeners = new Set<(event: MessageEvent) => void>();
  const opened: { closed: boolean; close(): void }[] = [];
  let blocked = false;
  const host = {
    location: { href: redirect, origin: new URL(redirect).origin },
    open() {
      if (blocked) return null;
      const popup = {
        closed: false,
        close() {
          this.closed = true;
        },
      };
      opened.push(popup);
      return popup;
    },
    addEventListener(_type: string, listener: (event: MessageEvent) => void) {
      listeners.add(listener);
    },
    removeEventListener(_type: string, listener: (event: MessageEvent) => void) {
      listeners.delete(listener);
    },
  } as unknown as Window;
  return {
    host,
    listeners,
    opened,
    block: () => {
      blocked = true;
    },
    message(source: unknown, origin: string, data: unknown) {
      for (const listener of [...listeners])
        listener({ source, origin, data, isTrusted: true } as MessageEvent);
    },
  };
}

test('cancel settles the promise, removes listeners, closes the popup and permits repeated retry', async () => {
  const harness = browserHarness();
  for (let i = 0; i < 3; i++) {
    const flow = openDataballrPopup(authUrl, redirect, harness.host);
    flow.cancel();
    assert.deepEqual(await flow.result, { type: 'cancel' });
    assert.equal(harness.listeners.size, 0);
    assert.equal(harness.opened[i].closed, true);
  }
});

test('a callback must come from the exact popup and registered origin', async () => {
  const h = browserHarness();
  const flow = openDataballrPopup(authUrl, redirect, h.host);
  let settled = false;
  void flow.result.then(() => {
    settled = true;
  });
  const data = { type: 'databallr-oauth-callback', url: redirect + '?code=test&state=test' };
  h.message({}, new URL(redirect).origin, data);
  h.message(h.opened[0], 'https://evil.test', data);
  h.message(h.opened[0], new URL(redirect).origin, { ...data, type: 'other' });
  await Promise.resolve();
  assert.equal(settled, false);
  h.message(h.opened[0], new URL(redirect).origin, data);
  assert.deepEqual(await flow.result, { type: 'success', url: data.url });
  assert.equal(h.listeners.size, 0);
  assert.equal(h.opened[0].closed, true);
});

test('a late cancelled callback cannot complete the next attempt', async () => {
  const h = browserHarness();
  const first = openDataballrPopup(authUrl, redirect, h.host);
  first.cancel();
  await first.result;
  const second = openDataballrPopup(authUrl, redirect, h.host);
  h.message(h.opened[0], new URL(redirect).origin, {
    type: 'databallr-oauth-callback',
    url: redirect,
  });
  assert.equal(h.listeners.size, 1);
  second.cancel();
  assert.deepEqual(await second.result, { type: 'cancel' });
});

test('a blocked popup rejects without leaving any listeners', async () => {
  const h = browserHarness();
  h.block();
  const flow = openDataballrPopup(authUrl, redirect, h.host);
  await assert.rejects(flow.result, /popup/i);
  assert.equal(h.listeners.size, 0);
});

test('a user-closed popup resolves rather than holding the next attempt', async () => {
  const h = browserHarness();
  const flow = openDataballrPopup(authUrl, redirect, h.host);
  h.opened[0].closed = true;
  assert.deepEqual(await flow.result, { type: 'cancel' });
  assert.equal(h.listeners.size, 0);
});

test('callback completion sends only to the registered opener origin and cleans its URL', () => {
  const sent: unknown[] = [];
  const replaced: unknown[] = [];
  const host = {
    location: { href: redirect + '?code=single-use-code&state=state' },
    opener: { postMessage: (...args: unknown[]) => sent.push(args) },
    history: { state: null, replaceState: (...args: unknown[]) => replaced.push(args) },
  } as unknown as Window;
  assert.equal(completeDataballrPopup(redirect, host), 'delivered');
  assert.deepEqual(sent, [
    [{ type: 'databallr-oauth-callback', url: host.location.href }, 'http://localhost:8080'],
  ]);
  assert.deepEqual(replaced, [[null, '', redirect]]);
  assert.equal(completeDataballrPopup(redirect, { ...host, opener: null } as Window), 'orphan');
  assert.equal(
    completeDataballrPopup(redirect, {
      ...host,
      location: { href: 'https://evil.test/?code=a' },
    } as Window),
    'invalid',
  );
});

test('the game root can start a dedicated-path login but callback delivery requires the exact path', () => {
  const callback = 'https://game.example.test/oauth/callback';
  assert.equal(canStartDataballrLogin(callback, 'https://game.example.test/'), true);
  assert.equal(canStartDataballrLogin(callback, 'https://game.example.test/market'), true);
  for (const current of ['https://evil.test/', 'http://game.example.test/',
    'https://game.example.test:444/', 'https://user@game.example.test/', 'bad url']) {
    assert.equal(canStartDataballrLogin(callback, current), false, current);
  }
  const sent: unknown[] = [];
  const cleaned: unknown[] = [];
  const host = {
    location: { href: callback + '?code=fixture&state=fixture' },
    opener: { postMessage: (...args: unknown[]) => sent.push(args) },
    history: { state: null, replaceState: (...args: unknown[]) => cleaned.push(args) },
  } as unknown as Window;
  for (const path of ['/', '/oauth/callback/', '/oauth/other']) {
    assert.equal(completeDataballrPopup(callback, { ...host,
      location: { href: 'https://game.example.test' + path + '?code=fixture' } } as Window), 'invalid');
  }
  assert.equal(sent.length, 0);
  assert.equal(completeDataballrPopup(callback, host), 'delivered');
  assert.deepEqual(sent, [[{ type: 'databallr-oauth-callback', url: host.location.href },
    'https://game.example.test']]);
  assert.deepEqual(cleaned, [[null, '', callback]]);
});
