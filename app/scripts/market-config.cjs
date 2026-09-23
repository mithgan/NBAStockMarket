const TARGETS = Object.freeze({
  staging: { domain: 'databallr.dev', prefix: 'MARKET_STAGING' },
  production: { domain: 'databallr.com', prefix: 'MARKET_PRODUCTION' },
});

function marketBuildEnvironment(environment, inputs) {
  const target = Object.hasOwn(TARGETS, environment) && TARGETS[environment];
  if (!target) throw new Error('Market environment must be staging or production.');
  const clientKey = `${target.prefix}_OAUTH_CLIENT_ID`;
  const clientId = inputs[clientKey]?.trim();
  if (!clientId || /\s|^(?:your[-_]|replace[-_]|placeholder|changeme|fixture[-_]|test[-_])/i.test(clientId)) {
    throw new Error(`${clientKey} must contain the registered public client ID.`);
  }
  const apiKey = `${target.prefix}_API_URL`;
  const apiUrl = inputs[apiKey];
  const canonicalApi = `https://api.${target.domain}/v1/apps/stock-market`;
  // A temporary staging endpoint must still be this application's known Worker.
  const stagingWorker = 'https://databallr-stock-market-api-staging.databallr.workers.dev/v1/apps/stock-market';
  if (apiUrl !== canonicalApi && !(environment === 'staging' && apiUrl === stagingWorker)) {
    throw new Error(`${apiKey} must be the approved ${environment} stock-market API URL.`);
  }
  return {
    EXPO_PUBLIC_AUTH_PROVIDER: 'databallr',
    EXPO_PUBLIC_NBA_STOCK_API_URL: apiUrl,
    EXPO_PUBLIC_NBA_STOCK_API_PREFIX: '/v2',
    EXPO_PUBLIC_DATABALLR_OAUTH_ISSUER: `https://accounts.${target.domain}/api/auth`,
    EXPO_PUBLIC_DATABALLR_OAUTH_CLIENT_ID: clientId,
    EXPO_PUBLIC_DATABALLR_OAUTH_AUDIENCE: canonicalApi,
    EXPO_PUBLIC_DATABALLR_OAUTH_REDIRECT_URI: `https://${target.domain}/market/oauth/callback`,
  };
}

function marketWorkerConfig(environment, withRoutes = false) {
  const target = Object.hasOwn(TARGETS, environment) && TARGETS[environment];
  if (!target) throw new Error('Market environment must be staging or production.');
  const routes = withRoutes ? ['/market', '/market/*'].map(path => ({
    pattern: `${target.domain}${path}`, zone_name: target.domain,
  })) : [];
  if (withRoutes && environment === 'production') {
    // Netlify forwards the apex site's /market/ paths through this proxied origin.
    routes.push({ pattern: 'api.databallr.com/market/*', zone_name: target.domain });
  }
  return {
    name: `databallr-market-web-${environment}`,
    account_id: 'c106bf9fdebefc994effa68697f1d8fe',
    main: '../../worker.ts',
    compatibility_date: '2026-09-18',
    workers_dev: false,
    preview_urls: false,
    vars: { ENVIRONMENT: environment },
    routes,
    assets: {
      directory: './assets', binding: 'ASSETS', run_worker_first: true,
      html_handling: 'none', not_found_handling: 'none',
    },
  };
}

module.exports = { marketBuildEnvironment, marketWorkerConfig };
