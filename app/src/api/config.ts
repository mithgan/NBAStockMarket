interface ApiConfiguration {
  apiUrl: string;
  apiPrefix: string;
}

export interface SupabaseAppConfig extends ApiConfiguration {
  authProvider?: 'supabase';
  supabaseUrl: string;
  supabasePublishableKey: string;
}

export interface DataballrOAuthConfig {
  issuer: string;
  clientId: string;
  audience: string;
  redirectUri: string;
}

export interface DataballrAppConfig extends ApiConfiguration {
  authProvider: 'databallr';
  oauth: DataballrOAuthConfig;
}

export type PublicAppConfig = SupabaseAppConfig | DataballrAppConfig;

export type PublicAppConfigResult =
  | { config: PublicAppConfig; error: null }
  | { config: null; error: string };

interface PublicAppEnvironment {
  authProvider?: string;
  apiUrl?: string;
  apiPrefix?: string;
  supabaseUrl?: string;
  supabasePublishableKey?: string;
  oauthIssuer?: string;
  oauthClientId?: string;
  oauthAudience?: string;
  oauthRedirectUri?: string;
}

function oauthConfig(environment: PublicAppEnvironment): DataballrOAuthConfig {
  const issuer = normalizedHttpUrl(environment.oauthIssuer, 'Databallr login issuer');
  const audience = normalizedHttpUrl(environment.oauthAudience, 'Databallr game audience');
  const staging = issuer === 'https://accounts.databallr.dev/api/auth'
    && audience === 'https://api.databallr.dev/v1/apps/stock-market';
  const production = issuer === 'https://accounts.databallr.com/api/auth'
    && audience === 'https://api.databallr.com/v1/apps/stock-market';
  if (!staging && !production) {
    throw new Error('Databallr login issuer and game audience must belong to the same environment.');
  }
  const clientId = environment.oauthClientId?.trim();
  if (!clientId) throw new Error('Databallr OAuth client ID is missing.');
  const redirectUri = environment.oauthRedirectUri?.trim();
  if (staging && redirectUri !== 'http://localhost:8080/'
      && redirectUri !== 'https://databallr.dev/market/oauth/callback') {
    throw new Error('Staging login requires its exact registered localhost or /market callback.');
  }
  if (!redirectUri) throw new Error('Databallr OAuth redirect URI is missing.');
  if (production) {
    // Registration is an operator prerequisite. Never guess a client or callback.
    normalizedHttpUrl(redirectUri, 'Databallr login redirect URI');
    const parsed = new URL(redirectUri);
    if (parsed.protocol !== 'https:' || parsed.toString() !== redirectUri
        || ['localhost', '127.0.0.1', '[::1]', '10.0.2.2'].includes(parsed.hostname)) {
      throw new Error('Production login requires an exact registered HTTPS redirect URI.');
    }
  }
  return { issuer, audience, clientId, redirectUri };
}

export function databallrOAuthScopes(config: DataballrOAuthConfig): string[] {
  const production = config.issuer === 'https://accounts.databallr.com/api/auth'
    && config.audience === 'https://api.databallr.com/v1/apps/stock-market';
  const hostedStaging = config.issuer === 'https://accounts.databallr.dev/api/auth'
    && config.audience === 'https://api.databallr.dev/v1/apps/stock-market'
    && config.redirectUri === 'https://databallr.dev/market/oauth/callback';
  if (production || hostedStaging) {
    return ['openid', 'profile', 'email', 'offline_access'];
  }
  return ['openid', 'profile', 'email'];
}

function normalizedApiPrefix(value: string | undefined, apiUrl: string): string {
  const explicitPrefix = value?.trim();
  if (explicitPrefix === undefined) {
    const basePath = new URL(apiUrl).pathname.replace(/\/+$/, '');
    if (basePath) {
      throw new Error('API prefix is required when API URL includes a path.');
    }
  }
  const candidate = explicitPrefix ?? '/api/v2';
  if (candidate === '' || candidate === '/') return '';
  if (candidate.includes('?') || candidate.includes('#') || candidate.includes('://')) {
    throw new Error('API prefix must be a URL path, not a URL.');
  }
  const segments = candidate.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('API prefix must not contain relative path segments.');
  }
  return `/${segments.join('/')}`;
}

function normalizedHttpUrl(value: string | undefined, label: string): string {
  const candidate = value?.trim();
  if (!candidate) throw new Error(`${label} is missing.`);
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${label} must use HTTP or HTTPS.`);
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]', '10.0.2.2'].includes(parsed.hostname);
  if (parsed.protocol === 'http:' && !loopback) {
    throw new Error(`${label} must use HTTPS outside local development.`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${label} must not contain credentials, a query, or a fragment.`);
  }
  return parsed.toString().replace(/\/$/, '');
}

function supabaseKeyRole(value: string): string | null {
  const parts = value.split('.');
  if (parts.length !== 3 || typeof globalThis.atob !== 'function') return null;
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const decoded = JSON.parse(globalThis.atob(padded)) as { role?: unknown };
    return typeof decoded.role === 'string' ? decoded.role : null;
  } catch {
    return null;
  }
}

function validatePublishableKey(value: string | undefined): string {
  const key = value?.trim();
  if (!key) throw new Error('Supabase publishable key is missing.');
  if (key.startsWith('sb_secret_') || supabaseKeyRole(key) === 'service_role') {
    throw new Error('Supabase publishable key must not be a secret or service-role key.');
  }
  return key;
}

export function resolvePublicAppConfig(
  environment: PublicAppEnvironment = {
    authProvider: process.env.EXPO_PUBLIC_AUTH_PROVIDER,
    apiUrl: process.env.EXPO_PUBLIC_NBA_STOCK_API_URL,
    apiPrefix: process.env.EXPO_PUBLIC_NBA_STOCK_API_PREFIX,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    oauthIssuer: process.env.EXPO_PUBLIC_DATABALLR_OAUTH_ISSUER,
    oauthClientId: process.env.EXPO_PUBLIC_DATABALLR_OAUTH_CLIENT_ID,
    oauthAudience: process.env.EXPO_PUBLIC_DATABALLR_OAUTH_AUDIENCE,
    oauthRedirectUri: process.env.EXPO_PUBLIC_DATABALLR_OAUTH_REDIRECT_URI,
  },
): PublicAppConfigResult {
  try {
    const provider = environment.authProvider?.trim() || 'supabase';
    if (provider === 'databallr') {
      const apiUrl = normalizedHttpUrl(environment.apiUrl, 'API URL');
      const oauth = oauthConfig(environment);
      if (oauth.redirectUri === 'https://databallr.dev/market/oauth/callback'
          && apiUrl !== 'https://api.databallr.dev/v1/apps/stock-market'
          && apiUrl !== 'https://databallr-stock-market-api-staging.databallr.workers.dev/v1/apps/stock-market') {
        throw new Error('Hosted staging requires the staging stock-market API.');
      }
      if (oauth.redirectUri === 'https://databallr.com/market/oauth/callback'
          && (oauth.issuer !== 'https://accounts.databallr.com/api/auth'
            || apiUrl !== 'https://api.databallr.com/v1/apps/stock-market')) {
        throw new Error('Hosted production requires the production login and stock-market API.');
      }
      if (oauth.redirectUri === 'https://databallr.dev/market/oauth/callback'
          && oauth.issuer !== 'https://accounts.databallr.dev/api/auth') {
        throw new Error('Hosted staging requires the staging login.');
      }
      return {
        config: {
          authProvider: 'databallr', apiUrl,
          apiPrefix: normalizedApiPrefix(environment.apiPrefix, apiUrl),
          oauth,
        },
        error: null,
      };
    }
    if (provider !== 'supabase') throw new Error('Unknown authentication provider.');
    const supabasePublishableKey = validatePublishableKey(environment.supabasePublishableKey);
    const apiUrl = normalizedHttpUrl(environment.apiUrl, 'API URL');
    return {
      config: {
        apiUrl,
        apiPrefix: normalizedApiPrefix(environment.apiPrefix, apiUrl),
        supabaseUrl: normalizedHttpUrl(environment.supabaseUrl, 'Supabase URL'),
        supabasePublishableKey,
      },
      error: null,
    };
  } catch (error) {
    return {
      config: null,
      error: error instanceof Error ? error.message : 'Public app configuration is invalid.',
    };
  }
}
