import type { DataballrOAuthConfig } from '../api/config';
import type { GameAuthSession } from './authTypes';

export interface DataballrCodeResponse {
  callbackUrl: string;
  expectedState: string;
  codeVerifier: string;
}

type ExpiringSession = GameAuthSession & { expires_at: number };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Databallr returned an invalid sign-in response. Try again.');
  }
  return value as Record<string, unknown>;
}

function authorizationCode(config: DataballrOAuthConfig, response: DataballrCodeResponse): string {
  const invalid = () => new Error('The sign-in response did not match this login. Try again.');
  let url: URL;
  try {
    url = new URL(response.callbackUrl);
  } catch {
    throw invalid();
  }
  const expected = new URL(config.redirectUri);
  if (
    url.origin !== expected.origin ||
    url.pathname !== expected.pathname ||
    url.username ||
    url.password ||
    url.hash ||
    url.searchParams.has('error') ||
    !response.expectedState ||
    !/^[A-Za-z0-9._~-]{43,128}$/.test(response.codeVerifier)
  ) {
    throw invalid();
  }
  for (const key of ['state', 'iss', 'code']) {
    if (url.searchParams.getAll(key).length !== 1) throw invalid();
  }
  const code = url.searchParams.get('code');
  if (
    !code ||
    url.searchParams.get('state') !== response.expectedState ||
    url.searchParams.get('iss') !== config.issuer
  )
    throw invalid();
  return code;
}

async function fetchJson(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  fetcher: typeof fetch,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 15_000);
  try {
    if (signal.aborted) throw new Error('cancelled');
    const response = await fetcher(url, {
      ...init,
      credentials: 'omit',
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok || signal.aborted || controller.signal.aborted) throw new Error('unavailable');
    return record(await response.json());
  } catch {
    throw new Error('Databallr sign-in could not be completed. Try again.');
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
  }
}

export async function exchangeDataballrCode(
  config: DataballrOAuthConfig,
  response: DataballrCodeResponse,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<ExpiringSession> {
  const code = authorizationCode(config, response);
  const requestedAt = now();
  const token = await fetchJson(
    config.issuer + '/oauth2/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        code,
        code_verifier: response.codeVerifier,
        resource: config.audience,
      }).toString(),
    },
    signal,
    fetcher,
  );
  const expiresAt =
    typeof token.expires_in === 'number' ? Math.floor(requestedAt / 1000) + token.expires_in : NaN;
  if (
    typeof token.access_token !== 'string' ||
    !token.access_token ||
    token.access_token.length > 16384 ||
    /\s/.test(token.access_token) ||
    typeof token.token_type !== 'string' ||
    token.token_type.toLowerCase() !== 'bearer' ||
    typeof token.expires_in !== 'number' ||
    token.expires_in <= 0 ||
    token.expires_in > 3600 ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= now() / 1000 ||
    (token.scope !== undefined &&
      (typeof token.scope !== 'string' ||
        !['openid', 'profile', 'email'].every((scope) =>
          (token.scope as string).split(' ').includes(scope),
        )))
  ) {
    throw new Error('Databallr returned an invalid access token. Sign in again.');
  }
  const user = await fetchJson(
    config.issuer + '/oauth2/userinfo',
    {
      headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' },
    },
    signal,
    fetcher,
  );
  if (
    typeof user.sub !== 'string' ||
    !user.sub ||
    typeof user.email !== 'string' ||
    !user.email ||
    expiresAt <= now() / 1000 ||
    signal.aborted
  ) {
    throw new Error('Databallr could not confirm your account. Sign in again.');
  }
  // Identity comes from the configured issuer over HTTPS; the game API also
  // verifies the access-token signature, audience, scope, client and subject.
  return {
    access_token: token.access_token,
    expires_at: expiresAt,
    user: { id: user.sub, email: user.email, app_metadata: { provider: 'databallr' } },
  };
}

interface LoginAttempt {
  controller: AbortController;
  started: boolean;
}

/** Memory-only preview sessions. Clearing fences even a late sign-in response. */
export class DataballrSessionStore {
  private session: ExpiringSession | null = null;
  private attempt: LoginAttempt | null = null;

  constructor(
    private readonly config: DataballrOAuthConfig,
    private readonly onChange: (session: ExpiringSession | null) => void,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  begin(): LoginAttempt {
    if (this.attempt) throw new Error('Sign-in is already in progress.');
    this.clear();
    this.attempt = { controller: new AbortController(), started: false };
    return this.attempt;
  }

  async complete(attempt: LoginAttempt, response: DataballrCodeResponse): Promise<boolean> {
    if (this.attempt !== attempt || attempt.started) return false;
    attempt.started = true;
    try {
      const session = await exchangeDataballrCode(
        this.config,
        response,
        attempt.controller.signal,
        this.fetcher,
        this.now,
      );
      if (this.attempt !== attempt || attempt.controller.signal.aborted) return false;
      this.session = session;
      this.onChange(session);
      return true;
    } catch (error) {
      if (this.attempt !== attempt || attempt.controller.signal.aborted) return false;
      throw error;
    } finally {
      if (this.attempt === attempt) this.attempt = null;
    }
  }

  clear(): void {
    this.attempt?.controller.abort();
    this.attempt = null;
    this.session = null;
    this.onChange(null);
  }

  getAccessToken(forceRefresh: boolean, expectedSession?: GameAuthSession | null) {
    // Each API client retains the provider for the session that created it.
    // A late 401 from that client cannot invalidate a replacement login.
    if (expectedSession !== undefined && expectedSession !== this.session) return null;
    if (this.session && (forceRefresh || this.session.expires_at <= this.now() / 1000))
      this.clear();
    return this.session
      ? { accessToken: this.session.access_token, userId: this.session.user.id }
      : null;
  }
}
