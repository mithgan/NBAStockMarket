import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePublicAppConfig } from './config';

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
