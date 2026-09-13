import assert from 'node:assert/strict';
import test from 'node:test';

import { databallrOAuthScopes, resolvePublicAppConfig } from './config';

const stagingEnvironment = {
  authProvider: 'databallr',
  apiUrl: 'http://localhost:8787/v1/apps/stock-market',
  apiPrefix: '/v2',
  oauthIssuer: 'https://accounts.databallr.dev/api/auth',
  oauthClientId: 'registered-public-client',
  oauthAudience: 'https://api.databallr.dev/v1/apps/stock-market',
  oauthRedirectUri: 'http://localhost:8080/',
};

test('explicit staging login needs no Supabase credentials and preserves the exact callback', () => {
  const result = resolvePublicAppConfig(stagingEnvironment);
  assert.equal(result.error, null);
  assert.equal(result.config?.authProvider, 'databallr');
  assert.ok(result.config?.authProvider === 'databallr');
  assert.equal(result.config.oauth.redirectUri, 'http://localhost:8080/');
  assert.equal('supabaseUrl' in result.config, false);
});

test('invalid Databallr configuration cannot fall back to valid Supabase credentials', () => {
  for (const override of [
    { oauthClientId: '' }, { oauthIssuer: 'https://accounts.databallr.com/api/auth' },
    { oauthIssuer: 'http://accounts.databallr.dev/api/auth' },
    { oauthAudience: 'https://api.databallr.dev/v1/other' },
    { oauthRedirectUri: 'http://127.0.0.1:8080/' },
    { oauthRedirectUri: 'http://localhost:8080' },
    { oauthRedirectUri: 'http://localhost:8080/?next=other' },
    { authProvider: 'databallr-typo' },
  ]) {
    const result = resolvePublicAppConfig({ ...stagingEnvironment,
      supabaseUrl: 'https://example.supabase.co', supabasePublishableKey: 'public-key', ...override });
    assert.equal(result.config, null, JSON.stringify(override));
    assert.ok(result.error);
  }
});

test('public app config accepts only explicit HTTP URLs and a publishable key', () => {
  assert.deepEqual(resolvePublicAppConfig({
    apiUrl: 'http://127.0.0.1:8011/',
    apiPrefix: '/api/v2/',
    supabaseUrl: 'https://example.supabase.co/',
    supabasePublishableKey: 'public-key',
  }), {
    config: {
      apiUrl: 'http://127.0.0.1:8011',
      apiPrefix: '/api/v2',
      supabaseUrl: 'https://example.supabase.co',
      supabasePublishableKey: 'public-key',
    },
    error: null,
  });

  assert.match(resolvePublicAppConfig({
    apiUrl: 'file:///tmp/api',
    supabaseUrl: 'https://example.supabase.co',
    supabasePublishableKey: 'public-key',
  }).error ?? '', /HTTP or HTTPS/);
  assert.match(resolvePublicAppConfig({
    apiUrl: 'https://api.example.com',
    supabaseUrl: 'https://example.supabase.co',
  }).error ?? '', /publishable key/i);
  assert.match(resolvePublicAppConfig({
    apiUrl: 'http://api.example.com',
    supabaseUrl: 'https://example.supabase.co',
    supabasePublishableKey: 'public-key',
  }).error ?? '', /HTTPS outside local development/);
  assert.match(resolvePublicAppConfig({
    apiUrl: 'https://api.example.com',
    supabaseUrl: 'https://example.supabase.co',
    supabasePublishableKey: 'sb_secret_do-not-bundle',
  }).error ?? '', /must not be a secret/);

  const servicePayload = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url');
  assert.match(resolvePublicAppConfig({
    apiUrl: 'https://api.example.com',
    supabaseUrl: 'https://example.supabase.co',
    supabasePublishableKey: `header.${servicePayload}.signature`,
  }).error ?? '', /service-role key/);

  assert.equal(resolvePublicAppConfig({
    apiUrl: 'http://10.0.2.2:8011',
    supabaseUrl: 'https://example.supabase.co',
    supabasePublishableKey: 'public-key',
  }).config?.apiUrl, 'http://10.0.2.2:8011');

  assert.equal(resolvePublicAppConfig({
    apiUrl: 'http://127.0.0.1:8011',
    supabaseUrl: 'https://example.supabase.co',
    supabasePublishableKey: 'public-key',
  }).config?.apiPrefix, '/api/v2');

  assert.equal(resolvePublicAppConfig({
    apiUrl: 'https://api.example.com/api/nba-stock-market',
    apiPrefix: '/v2',
    supabaseUrl: 'https://example.supabase.co',
    supabasePublishableKey: 'public-key',
  }).config?.apiPrefix, '/v2');
  assert.match(resolvePublicAppConfig({
    apiUrl: 'https://api.example.com/api/nba-stock-market',
    supabaseUrl: 'https://example.supabase.co',
    supabasePublishableKey: 'public-key',
  }).error ?? '', /API prefix is required/);
  assert.match(resolvePublicAppConfig({
    apiUrl: 'https://api.example.com',
    apiPrefix: 'https://other.example.com/api/v2',
    supabaseUrl: 'https://example.supabase.co',
    supabasePublishableKey: 'public-key',
  }).error ?? '', /URL path/);
});

const productionEnvironment = {
  ...stagingEnvironment,
  apiUrl: 'https://api.example.test/stock-market',
  oauthIssuer: 'https://accounts.databallr.com/api/auth',
  oauthAudience: 'https://api.databallr.com/v1/apps/stock-market',
  oauthClientId: 'fixture-production-public-client',
  oauthRedirectUri: 'https://game.example.test/oauth/callback',
};

test('production accepts an explicit fixture registration tuple without guessing any defaults', () => {
  const result = resolvePublicAppConfig(productionEnvironment);
  assert.equal(result.error, null);
  assert.ok(result.config?.authProvider === 'databallr');
  assert.deepEqual(result.config.oauth, {
    issuer: productionEnvironment.oauthIssuer, audience: productionEnvironment.oauthAudience,
    clientId: productionEnvironment.oauthClientId, redirectUri: productionEnvironment.oauthRedirectUri,
  });
  assert.equal('supabaseUrl' in result.config, false);
  assert.deepEqual(databallrOAuthScopes(result.config.oauth), ['openid', 'profile', 'email', 'offline_access']);
  const staging = resolvePublicAppConfig(stagingEnvironment);
  assert.ok(staging.config?.authProvider === 'databallr');
  assert.deepEqual(databallrOAuthScopes(staging.config.oauth), ['openid', 'profile', 'email']);
});

test('production requires its matching resource and an exact HTTPS callback with no fallback', () => {
  for (const override of [
    { oauthClientId: '' }, { oauthRedirectUri: '' },
    { oauthIssuer: stagingEnvironment.oauthIssuer }, { oauthAudience: stagingEnvironment.oauthAudience },
    { oauthAudience: 'https://api.databallr.com' },
    { oauthIssuer: 'https://accounts.databallr.com/api/auth.evil' },
    { oauthRedirectUri: 'http://game.example.test/oauth/callback' },
    { oauthRedirectUri: 'http://localhost:8080/' },
    { oauthRedirectUri: 'https://localhost:8080/' },
    { oauthRedirectUri: 'https://game.example.test/oauth/callback?next=/game' },
    { oauthRedirectUri: 'https://game.example.test/oauth/callback#code' },
    { oauthRedirectUri: 'https://user:password@game.example.test/oauth/callback' },
    { oauthRedirectUri: 'https://game.example.test/oauth/../callback' },
    { oauthRedirectUri: 'https://game.example.test' },
  ]) {
    const result = resolvePublicAppConfig({ ...productionEnvironment,
      supabaseUrl: 'https://example.supabase.co', supabasePublishableKey: 'public-key', ...override });
    assert.equal(result.config, null, JSON.stringify(override));
    assert.ok(result.error);
  }
});
