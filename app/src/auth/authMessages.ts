const NETWORK_ERROR_PATTERNS = [
  'failed to fetch',
  'fetch failed',
  'load failed',
  'network request failed',
];

export function authErrorMessage(message: string | undefined, fallback: string): string {
  const normalized = message?.trim();
  if (!normalized) return fallback;
  if (NETWORK_ERROR_PATTERNS.some((pattern) => normalized.toLowerCase().includes(pattern))) {
    return 'Unable to reach the authentication service. Check your connection and try again.';
  }
  return normalized;
}
