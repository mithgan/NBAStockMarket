import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './worker';

function fixture(deploymentEnvironment?: string) {
  const requests: Request[] = [];
  return {
    requests,
    ENVIRONMENT: deploymentEnvironment,
    ASSETS: {
      async fetch(request: Request) {
        requests.push(request);
        const path = new URL(request.url).pathname;
        const body = path === '/index.html' ? '<html>market</html>'
          : path === '/_expo/app.js' ? 'console.log("market")'
          : path === '/assets/icon.png' ? 'image' : null;
        return new Response(body ?? 'Not found', { status: body ? 200 : 404 });
      },
    },
  };
}

test('bare market redirects to its canonical slash and preserves the query', async () => {
  const environment = fixture();
  const response = await worker.fetch(new Request('https://databallr.dev/market?utm_source=test'), environment);
  assert.equal(response.status, 308);
  assert.equal(response.headers.get('Location'), 'https://databallr.dev/market/?utm_source=test');
  assert.equal(environment.requests.length, 0);
});

test('staging indexing restriction follows the deployment binding, independent of hostname', async () => {
  for (const deploymentEnvironment of ['staging', undefined, 'invalid', 'production']) {
    for (const hostname of ['databallr.dev', 'databallr.com']) {
      for (const path of ['/market/', '/market/oauth/callback?code=one-use&state=proof']) {
        const response = await worker.fetch(new Request(`https://${hostname}${path}`), fixture(deploymentEnvironment));
        assert.equal(response.headers.get('X-Robots-Tag'), deploymentEnvironment === 'production' ? null : 'noindex, nofollow');
      }
    }
  }
});

test('direct entry and exact callback serve the shell without changing OAuth query parameters', async () => {
  for (const path of ['/market/', '/market/oauth/callback?code=one-use&state=a%2Bb&iss=https%3A%2F%2Faccounts.databallr.dev%2Fapi%2Fauth']) {
    const environment = fixture();
    const request = new Request(`https://databallr.dev${path}`);
    const response = await worker.fetch(request, environment);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '<html>market</html>');
    assert.equal(response.headers.get('Location'), null);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
    const bound = new URL(environment.requests[0].url);
    assert.equal(bound.pathname, '/index.html');
    assert.equal(bound.search, new URL(request.url).search);
  }
});

test('assets are looked up without the mount prefix and missing assets stay 404', async () => {
  const environment = fixture();
  for (const [path, status] of [
    ['/_expo/app.js?v=1', 200], ['/assets/icon.png', 200], ['/_expo/missing.js', 404],
    ['/oauth/callback/', 404], ['/unknown', 404],
  ] as const) {
    const response = await worker.fetch(new Request(`https://databallr.dev/market${path}`), environment);
    assert.equal(response.status, status);
    assert.equal(environment.requests.at(-1)?.url, `https://databallr.dev${path}`);
    if (status === 404) assert.notEqual(await response.text(), '<html>market</html>');
  }
});

test('unrelated site paths never fetch assets and writes are rejected', async () => {
  const environment = fixture();
  for (const path of ['/', '/marketplace', '/marketing/', '/api', '/_expo/app.js', '/market/../api']) {
    assert.equal((await worker.fetch(new Request(`https://databallr.dev${path}`), environment)).status, 404);
  }
  assert.equal(environment.requests.length, 0);
  const post = await worker.fetch(new Request('https://databallr.dev/market/', { method: 'POST', body: 'ignored' }), environment);
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('Allow'), 'GET, HEAD');
  assert.equal(environment.requests.length, 0);
  const head = await worker.fetch(new Request('https://databallr.dev/market/oauth/callback', { method: 'HEAD' }), environment);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(environment.requests[0].method, 'HEAD');
});
