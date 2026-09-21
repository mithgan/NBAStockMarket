import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Explicit integration check: two real exports must inline their own public
 * client, even with a warm Metro cache. Synthetic clients never get deployed. */
async function main() {
  const appDirectory = resolve(import.meta.dirname, '..');
  const generated = resolve(appDirectory, 'hosting/.generated');
  const output = resolve(generated, 'staging');
  await mkdir(generated, { recursive: true });
  const backup = await mkdtemp(resolve(generated, '.cache-check-'));
  let hadOutput = false;
  try {
    await access(output);
    hadOutput = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (hadOutput) await rename(output, resolve(backup, 'staging'));
  const suffix = randomUUID();
  const clients = [`cache-proof-first-${suffix}`, `cache-proof-second-${suffix}`];
  const bundles: string[] = [];
  try {
    for (const clientId of clients) {
      const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/export-market.ts', 'staging'], {
        cwd: appDirectory,
        stdio: 'inherit',
        env: {
          ...process.env,
          MARKET_STAGING_OAUTH_CLIENT_ID: clientId,
          MARKET_STAGING_API_URL: 'https://databallr-stock-market-api-staging.databallr.workers.dev/v1/apps/stock-market',
        },
      });
      if (result.error) throw result.error;
      assert.equal(result.status, 0, 'The staging export must succeed.');
      const html = await readFile(resolve(output, 'assets/index.html'), 'utf8');
      const script = html.match(/<script\b[^>]*\bsrc=["'](\/market\/[^"']+\.js)["']/)?.[1];
      assert.ok(script, 'The emitted HTML must reference its /market JavaScript bundle.');
      bundles.push(await readFile(resolve(output, 'assets', '.' + script.slice('/market'.length)), 'utf8'));
    }
    for (const [index, bundle] of bundles.entries()) {
      assert.ok(bundle.includes(clients[index]), `Export ${index + 1} must inline its current client ID.`);
      assert.ok(!bundle.includes(clients[1 - index]), `Export ${index + 1} must not inline the other export's client ID.`);
    }
    const hashes = bundles.map(bundle => createHash('sha256').update(bundle).digest('hex'));
    assert.notEqual(hashes[0], hashes[1], 'Changing the public client must change the emitted JavaScript.');
    console.log('PASS: successive client exports contain only their current client; bundle SHA-256 values differ.');
  } finally {
    await rm(output, { recursive: true, force: true });
    if (hadOutput) await rename(resolve(backup, 'staging'), output);
    await rm(backup, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Market export cache check failed.');
  process.exitCode = 1;
});
