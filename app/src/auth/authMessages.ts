const NETWORK_ERROR_PATTERNS = [
  'failed to fetch',
  'fetch failed',
  'load failed',
  'network request failed',
];

const UNHELPFUL_ERROR_MESSAGES = new Set([
  '{}',
  '[]',
  '[object object]',
  'unknown error',
]);

export function authErrorMessage(message: string | undefined, fallback: string): string {
  const normalized = message?.trim();
  if (!normalized) return fallback;
  const lowercase = normalized.toLowerCase();
  if (UNHELPFUL_ERROR_MESSAGES.has(lowercase)) return fallback;
  if (NETWORK_ERROR_PATTERNS.some((pattern) => lowercase.includes(pattern))) {
    return 'Unable to reach the authentication service. Check your connection and try again.';
  }
  return normalized;
}

const OAUTH_ERROR_FIELDS = [
  'error',
  'error_code',
  'error_description',
  'error_uri',
  'state',
];

export interface OAuthCallbackError {
  cleanUrl: string;
  message: string;
}

export function oauthCallbackErrorFromUrl(rawUrl: string): OAuthCallbackError | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const hashParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);
  const queryHasError = url.searchParams.has('error') || url.searchParams.has('error_code');
  const hashHasError = hashParams.has('error') || hashParams.has('error_code');
  if (!queryHasError && !hashHasError) return null;

  const source = queryHasError ? url.searchParams : hashParams;
  const code = (source.get('error_code') ?? source.get('error') ?? '').toLowerCase();
  const description = (source.get('error_description') ?? '').toLowerCase();
  const cancelled = code === 'access_denied'
    || description.includes('cancel')
    || description.includes('denied');

  if (queryHasError) {
    for (const field of OAUTH_ERROR_FIELDS) url.searchParams.delete(field);
  } else {
    for (const field of OAUTH_ERROR_FIELDS) hashParams.delete(field);
    url.hash = hashParams.toString() ? `#${hashParams.toString()}` : '';
  }

  return {
    cleanUrl: `${url.pathname}${url.search}${url.hash}`,
    message: cancelled
      ? 'Google sign-in was cancelled. You can try again when you are ready.'
      : 'Google sign-in could not be completed. Try again.',
  };
}
