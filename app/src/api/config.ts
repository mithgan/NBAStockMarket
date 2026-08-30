export interface PublicAppConfig {
  apiUrl: string;
  apiPrefix: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
}

export type PublicAppConfigResult =
  | { config: PublicAppConfig; error: null }
  | { config: null; error: string };

interface PublicAppEnvironment {
  apiUrl?: string;
  apiPrefix?: string;
  supabaseUrl?: string;
  supabasePublishableKey?: string;
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
    apiUrl: process.env.EXPO_PUBLIC_NBA_STOCK_API_URL,
    apiPrefix: process.env.EXPO_PUBLIC_NBA_STOCK_API_PREFIX,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  },
): PublicAppConfigResult {
  try {
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
