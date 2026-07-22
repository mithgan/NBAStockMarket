import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePublicAppConfig } from './config';

test('public app config accepts only explicit HTTP URLs and a publishable key', () => {
  assert.deepEqual(resolvePublicAppConfig({
    apiUrl: 'http://127.0.0.1:8011/',
    supabaseUrl: 'https://example.supabase.co/',
    supabasePublishableKey: 'public-key',
  }), {
    config: {
      apiUrl: 'http://127.0.0.1:8011',
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
});
