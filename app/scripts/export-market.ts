import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { resolvePublicAppConfig } from '../src/api/config';
import { verifyMarketExport } from './verify-market-export';

const { marketBuildEnvironment, marketWorkerConfig } = require('./market-config.cjs');

async function main() {
  const [environment, ...options] = process.argv.slice(2);
  if (options.some(option => option !== '--with-routes') || options.length > 1) {
    throw new Error('Usage: export-market.ts staging|production [--with-routes]');
  }
  const publicEnvironment = marketBuildEnvironment(environment, process.env);
  const checked = resolvePublicAppConfig({
    authProvider: publicEnvironment.EXPO_PUBLIC_AUTH_PROVIDER,
    apiUrl: publicEnvironment.EXPO_PUBLIC_NBA_STOCK_API_URL,
    apiPrefix: publicEnvironment.EXPO_PUBLIC_NBA_STOCK_API_PREFIX,
    oauthIssuer: publicEnvironment.EXPO_PUBLIC_DATABALLR_OAUTH_ISSUER,
    oauthClientId: publicEnvironment.EXPO_PUBLIC_DATABALLR_OAUTH_CLIENT_ID,
    oauthAudience: publicEnvironment.EXPO_PUBLIC_DATABALLR_OAUTH_AUDIENCE,
    oauthRedirectUri: publicEnvironment.EXPO_PUBLIC_DATABALLR_OAUTH_REDIRECT_URI,
  });
  if (checked.error) throw new Error(checked.error);
  const appDirectory = resolve(import.meta.dirname, '..');
  const output = resolve(appDirectory, 'hosting/.generated', environment);
  // A failed rebuild must not leave a deployable config pointing at partial assets.
  await rm(resolve(output, 'wrangler.json'), { force: true });
  await rm(resolve(output, 'build.json'), { force: true });
  const childEnvironment = Object.fromEntries(Object.entries(process.env)
    .filter(([name]) => !name.startsWith('EXPO_PUBLIC_')));
  const result = spawnSync(process.execPath, [
    resolve(appDirectory, 'node_modules/expo/bin/cli'), 'export', '--platform', 'web',
    // Expo 54 inlines EXPO_PUBLIC values during transformation, but they do not
    // invalidate its Metro transform cache when only build inputs change.
    '--clear',
    '--output-dir', resolve(output, 'assets'),
  ], {
    cwd: appDirectory, stdio: 'inherit',
    env: { ...childEnvironment, ...publicEnvironment, EXPO_NO_DOTENV: '1',
      MARKET_WEB_ENVIRONMENT: environment, CI: '1' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Expo export failed (${result.status}).`);
  await verifyMarketExport(resolve(output, 'assets'));
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'wrangler.json'), JSON.stringify(
    marketWorkerConfig(environment, options.includes('--with-routes')), null, 2) + '\n');
  await writeFile(resolve(output, 'build.json'), JSON.stringify({
    environment, basePath: '/market', publicEnvironment,
    expoVersion: JSON.parse(await readFile(resolve(appDirectory, 'node_modules/expo/package.json'), 'utf8')).version,
  }, null, 2) + '\n');
  console.log(`Verified ${environment} /market export: ${output}`);
  console.log(options.includes('--with-routes')
    ? 'Generated the environment-specific /market route patterns; no deployment was performed.'
    : 'Generated an unrouted Worker configuration; no deployment was performed.');
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Market export failed.');
  process.exitCode = 1;
});
