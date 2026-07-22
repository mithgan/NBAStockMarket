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
