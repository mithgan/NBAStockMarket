import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifyMarketExport } from './verify-market-export';

const { marketBuildEnvironment, marketWorkerConfig } = require('./market-config.cjs');
const expoConfig = require('../app.config.js');
const inputs = {
  MARKET_STAGING_OAUTH_CLIENT_ID: 'registered-staging-public-id',
  MARKET_STAGING_API_URL: 'https://databallr-stock-market-api-staging.databallr.workers.dev/v1/apps/stock-market',
  MARKET_PRODUCTION_OAUTH_CLIENT_ID: 'registered-production-public-id',
  MARKET_PRODUCTION_API_URL: 'https://api.databallr.com/v1/apps/stock-market',
};

test('staging and production use independent explicit public inputs and exact callbacks', () => {
  for (const [environment, domain] of [['staging', 'databallr.dev'], ['production', 'databallr.com']]) {
    const result = marketBuildEnvironment(environment, inputs);
    assert.equal(result.EXPO_PUBLIC_DATABALLR_OAUTH_REDIRECT_URI, `https://${domain}/market/oauth/callback`);
    assert.equal(result.EXPO_PUBLIC_DATABALLR_OAUTH_ISSUER, `https://accounts.${domain}/api/auth`);
    assert.equal(result.EXPO_PUBLIC_DATABALLR_OAUTH_AUDIENCE, `https://api.${domain}/v1/apps/stock-market`);
    assert.equal(result.EXPO_PUBLIC_DATABALLR_OAUTH_CLIENT_ID, `registered-${environment}-public-id`);
    assert.equal(result.EXPO_PUBLIC_NBA_STOCK_API_PREFIX, '/v2');
    assert.equal(Object.keys(result).length, 7);
  }
  assert.throws(() => marketBuildEnvironment('staging', {
    ...inputs, MARKET_STAGING_OAUTH_CLIENT_ID: undefined,
    EXPO_PUBLIC_DATABALLR_OAUTH_CLIENT_ID: 'accidentally-inherited',
  }), /registered public client ID/);
});

test('hosting configuration rejects missing, placeholder, mixed-environment and unsafe URLs', () => {
  assert.throws(() => marketBuildEnvironment('preview', inputs), /environment/);
  for (const badClient of ['', 'your-client-id', 'replace-me', 'fixture-public-id', 'id with spaces']) {
    assert.throws(() => marketBuildEnvironment('staging', { ...inputs, MARKET_STAGING_OAUTH_CLIENT_ID: badClient }), /client ID/);
  }
  for (const apiUrl of [undefined, '', 'http://localhost:8787/v1/apps/stock-market',
    'https://api.databallr.com/v1/apps/stock-market',
    'https://api.databallr.dev/v1/apps/stock-market/',
    'https://api.databallr.dev/v1/apps/stock-market?key=secret',
    'https://user:password@api.databallr.dev/v1/apps/stock-market',
    'https://attacker.workers.dev/v1/apps/stock-market']) {
    assert.throws(() => marketBuildEnvironment('staging', { ...inputs, MARKET_STAGING_API_URL: apiUrl }), /approved staging/);
  }
  assert.throws(() => marketBuildEnvironment('production', {
    ...inputs, MARKET_PRODUCTION_API_URL: inputs.MARKET_STAGING_API_URL,
  }), /approved production/);
});

test('Expo retains the existing config and Pages path unless a market export is selected', () => {
  const original = process.env.MARKET_WEB_ENVIRONMENT;
  try {
    delete process.env.MARKET_WEB_ENVIRONMENT;
    for (const config of [{ name: 'existing' }, { experiments: { baseUrl: '/NBAStockMarket' } }]) {
      assert.strictEqual(expoConfig({ config }), config);
    }
    process.env.MARKET_WEB_ENVIRONMENT = 'invalid';
    assert.throws(() => expoConfig({ config: {} }), /environment/);
  } finally {
    if (original === undefined) delete process.env.MARKET_WEB_ENVIRONMENT;
    else process.env.MARKET_WEB_ENVIRONMENT = original;
  }
});

test('Worker configuration is unrouted by default and opt-in routes cannot claim adjacent paths', () => {
  for (const [environment, domain] of [['staging', 'databallr.dev'], ['production', 'databallr.com']]) {
    assert.deepEqual(marketWorkerConfig(environment).routes, []);
    const config = marketWorkerConfig(environment, true);
    assert.equal(config.account_id, 'c106bf9fdebefc994effa68697f1d8fe');
    assert.deepEqual(config.vars, { ENVIRONMENT: environment });
    assert.deepEqual(config.routes, ['/market', '/market/*'].map(path => ({ pattern: domain + path, zone_name: domain })));
    assert.equal(config.workers_dev, false);
    assert.equal(config.preview_urls, false);
    assert.equal(config.assets.run_worker_first, true);
    assert.equal(config.assets.html_handling, 'none');
    assert.equal(config.assets.not_found_handling, 'none');
  }
});

test('explicit Expo market builds reject inherited public configuration from another target', () => {
  const publicEnvironment = marketBuildEnvironment('staging', inputs);
  const required = { ...inputs, ...publicEnvironment, MARKET_WEB_ENVIRONMENT: 'staging' };
  const original = Object.fromEntries(Object.keys(required).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, required);
    const config = { experiments: { baseUrl: '/NBAStockMarket', other: true } };
    assert.deepEqual(expoConfig({ config }), { experiments: { baseUrl: '/market', other: true } });
    process.env.EXPO_PUBLIC_NBA_STOCK_API_URL = inputs.MARKET_PRODUCTION_API_URL;
    assert.throws(() => expoConfig({ config }), /matching public build configuration/);
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('export verification catches broken, missing and escaping resource paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'market-export-'));
  try {
    await mkdir(join(directory, '_expo'));
    await writeFile(join(directory, '_expo/app.js'), '');
    await writeFile(join(directory, 'index.html'), '<script src="/market/_expo/app.js"></script>');
    await verifyMarketExport(directory);
    for (const resource of ['/_expo/app.js', '/market/../_expo/app.js', '//other.example/app.js', '/market/_expo/missing.js']) {
      await writeFile(join(directory, 'index.html'), `<script src="${resource}"></script>`);
      await assert.rejects(() => verifyMarketExport(directory));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
