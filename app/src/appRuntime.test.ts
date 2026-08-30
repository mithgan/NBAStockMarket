import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const appSource = readFileSync(resolve(import.meta.dirname, '../App.tsx'), 'utf8');
const workflowSource = readFileSync(
  resolve(import.meta.dirname, '../../.github/workflows/deploy-pages.yml'),
  'utf8',
);

test('the production app authenticates before mounting the Flask-backed per-game market', () => {
  assert.match(appSource, /import \{ PerGameApiClient as MarketApiClient \} from '\.\/src\/api\/perGameClient'/);
  assert.match(appSource, /import \{[^}]*AuthProvider[^}]*useAuth[^}]*\} from '\.\/src\/auth\/AuthContext'/);
  assert.match(appSource, /import \{ AuthScreen \} from '\.\/src\/auth\/AuthScreen'/);
  assert.match(appSource, /<AuthProvider config=\{config\}>/);
  assert.match(appSource, /if \(!user\) return <AuthScreen \/>/);
  assert.match(appSource, /new MarketApiClient\(\{/);
  assert.match(appSource, /baseUrl: config\.apiUrl/);
  assert.match(appSource, /apiPrefix: config\.apiPrefix/);
  assert.match(appSource, /expectedUserId: user\?\.id \?\? ''/);
  assert.match(appSource, /getAccessToken/);
  assert.match(appSource, /<PortfolioProvider apiClient=\{client\} key=\{user\.id\} userId=\{user\.id\}>/);
});

test('the production route fails closed instead of serving the local simulator', () => {
  assert.match(appSource, /const configResult = resolvePublicAppConfig\(\)/);
  assert.match(appSource, /title="App configuration missing"/);
  assert.doesNotMatch(appSource, /LocalMarketClient/);
  assert.doesNotMatch(appSource, /userId="local-demo"/);
  assert.match(appSource, /Per-game market unavailable/);
});

test('the Pages build uses the live Flask mount without exposing admin credentials', () => {
  assert.match(
    workflowSource,
    /EXPO_PUBLIC_NBA_STOCK_API_URL: https:\/\/api\.databallr\.com\/api\/nba-stock-market/,
  );
  assert.match(
    workflowSource,
    /if: \$\{\{ vars\.NBA_STOCK_V2_ENABLED == 'true' && vars\.NBA_STOCK_V2_API_PREFIX != '' \}\}/,
  );
  assert.match(
    workflowSource,
    /EXPO_PUBLIC_NBA_STOCK_API_PREFIX: \$\{\{ vars\.NBA_STOCK_V2_API_PREFIX \}\}/,
  );
  assert.match(workflowSource, /Verify the mounted v2 backend before replacing Pages/);
  assert.match(workflowSource, /NBA_STOCK_API_PREFIX\}\/meta/);
  assert.match(workflowSource, /"economy": "per_game"/);
  assert.match(workflowSource, /actual != expected/);
  assert.match(
    workflowSource,
    /EXPO_PUBLIC_SUPABASE_URL: https:\/\/bvwahamwfvolchcezxnw\.supabase\.co/,
  );
  assert.doesNotMatch(workflowSource, /vykoykabweuemstpqljg\.supabase\.co/);
  assert.doesNotMatch(workflowSource, /EXPO_PUBLIC_NBA_STOCK_SETTLEMENT_KEY/);
});
