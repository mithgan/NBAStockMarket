import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const appSource = readFileSync(resolve(import.meta.dirname, '../App.tsx'), 'utf8');

test('the production app authenticates before mounting the Flask-backed portfolio', () => {
  assert.match(appSource, /import \{ MarketApiClient \} from '\.\/src\/api\/client'/);
  assert.match(appSource, /import \{[^}]*AuthProvider[^}]*useAuth[^}]*\} from '\.\/src\/auth\/AuthContext'/);
  assert.match(appSource, /import \{ AuthScreen \} from '\.\/src\/auth\/AuthScreen'/);
  assert.match(appSource, /<AuthProvider config=\{config\}>/);
  assert.match(appSource, /if \(!user\) return <AuthScreen \/>/);
  assert.match(appSource, /new MarketApiClient\(\{/);
  assert.match(appSource, /baseUrl: config\.apiUrl/);
  assert.match(appSource, /expectedUserId: user\?\.id \?\? ''/);
  assert.match(appSource, /getAccessToken/);
  assert.match(appSource, /<PortfolioProvider apiClient=\{apiClient\} key=\{user\.id\} userId=\{user\.id\}>/);
});

test('the production route fails closed instead of serving the local simulator', () => {
  assert.match(appSource, /const configResult = resolvePublicAppConfig\(\)/);
  assert.match(appSource, /title="App configuration missing"/);
  assert.doesNotMatch(appSource, /LocalMarketClient/);
  assert.doesNotMatch(appSource, /userId="local-demo"/);
});
