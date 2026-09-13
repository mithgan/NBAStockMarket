import { databallrOAuthScopes, type DataballrOAuthConfig } from '../api/config';
import type { AuthenticatedAccessToken } from '../api/client';
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

interface TokenGrant {
  accessToken: string;
  expiresAt: number;
  refreshToken: string | null;
}

function opaqueToken(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 16384
    && !/\s/.test(value);
}

function parseGrant(
  config: DataballrOAuthConfig,
  token: Record<string, unknown>,
  requestedAt: number,
  now: () => number,
): TokenGrant {
  const expiresAt = typeof token.expires_in === 'number'
    ? Math.floor(requestedAt / 1000) + token.expires_in : NaN;
  const scopes = databallrOAuthScopes(config);
  if (!opaqueToken(token.access_token)
      || typeof token.token_type !== 'string' || token.token_type.toLowerCase() !== 'bearer'
      || typeof token.expires_in !== 'number' || token.expires_in <= 0 || token.expires_in > 3600
      || !Number.isSafeInteger(expiresAt) || expiresAt <= now() / 1000
      || (token.scope !== undefined && (typeof token.scope !== 'string'
        || !scopes.every((scope) => (token.scope as string).split(' ').includes(scope))))
      || (scopes.includes('offline_access') && !opaqueToken(token.refresh_token))) {
    throw new Error('Databallr returned an invalid access token. Sign in again.');
  }
  return {
    accessToken: token.access_token, expiresAt,
    refreshToken: scopes.includes('offline_access') ? token.refresh_token as string : null,
  };
}

async function confirmAccount(
  config: DataballrOAuthConfig,
  grant: TokenGrant,
  signal: AbortSignal,
  fetcher: typeof fetch,
  now: () => number,
): Promise<ExpiringSession> {
  const user = await fetchJson(config.issuer + '/oauth2/userinfo', {
    headers: { Authorization: `Bearer ${grant.accessToken}`, Accept: 'application/json' },
  }, signal, fetcher);
  if (typeof user.sub !== 'string' || !user.sub || typeof user.email !== 'string' || !user.email
      || grant.expiresAt <= now() / 1000 || signal.aborted) {
    throw new Error('Databallr could not confirm your account. Sign in again.');
  }
  // HTTPS userinfo confirms identity. The game independently verifies the bearer
  // signature, audience, scope, client and subject; no decoded JWT supplies identity.
  return {
    access_token: grant.accessToken, expires_at: grant.expiresAt,
    user: { id: user.sub, email: user.email, app_metadata: { provider: 'databallr' } },
  };
}

async function revokeRefreshToken(
  config: DataballrOAuthConfig,
  refreshToken: string,
  fetcher: typeof fetch,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    // One attempt only. A retry of a consumed/revoked token can revoke siblings.
    await fetcher(config.issuer + '/oauth2/revoke', {
      method: 'POST', credentials: 'omit', redirect: 'error', keepalive: true,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.clientId, token: refreshToken,
        token_type_hint: 'refresh_token' }).toString(),
      signal: controller.signal,
    });
  } catch {
    // Local sign-out succeeds even when remote revocation is unavailable.
  } finally {
    clearTimeout(timeout);
  }
}

async function exchangeGrant(
  config: DataballrOAuthConfig,
  response: DataballrCodeResponse,
  signal: AbortSignal,
  fetcher: typeof fetch,
  now: () => number,
): Promise<{ session: ExpiringSession; refreshToken: string | null }> {
  const code = authorizationCode(config, response);
  const requestedAt = now();
  const token = await fetchJson(config.issuer + '/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: config.clientId,
      redirect_uri: config.redirectUri, code, code_verifier: response.codeVerifier,
      resource: config.audience }).toString(),
  }, signal, fetcher);
  const issuedRefresh = opaqueToken(token.refresh_token) ? token.refresh_token : null;
  try {
    const grant = parseGrant(config, token, requestedAt, now);
    const session = await confirmAccount(config, grant, signal, fetcher, now);
    return { session, refreshToken: grant.refreshToken };
  } catch (error) {
    if (issuedRefresh) await revokeRefreshToken(config, issuedRefresh, fetcher);
    throw error;
  }
}

/** One-shot exchange for callers that do not own a refresh lifecycle. */
export async function exchangeDataballrCode(
  config: DataballrOAuthConfig,
  response: DataballrCodeResponse,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<ExpiringSession> {
  const grant = await exchangeGrant(config, response, signal, fetcher, now);
  if (grant.refreshToken) await revokeRefreshToken(config, grant.refreshToken, fetcher);
  return grant.session;
}

interface LoginAttempt {
  controller: AbortController;
  started: boolean;
  pending: Promise<boolean> | null;
}

interface LoginGeneration {
  initialSession: ExpiringSession;
  session: ExpiringSession;
  refreshToken: string | null;
  refresh: Promise<AuthenticatedAccessToken | null> | null;
  closed: boolean;
}

/** Refresh credentials remain in private memory, never in context or storage.
 * Public session snapshots identify a login generation, not one token version. */
export class DataballrSessionStore {
  #current: LoginGeneration | null = null;
  #attempt: LoginAttempt | null = null;
  #generations = new WeakMap<GameAuthSession, LoginGeneration>();
  #cleanups = new Set<Promise<void>>();

  constructor(
    private readonly config: DataballrOAuthConfig,
    private readonly onChange: (session: ExpiringSession | null) => void,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  begin(): LoginAttempt {
    if (this.#attempt) throw new Error('Sign-in is already in progress.');
    this.clear();
    this.#attempt = { controller: new AbortController(), started: false, pending: null };
    return this.#attempt;
  }

  complete(attempt: LoginAttempt, response: DataballrCodeResponse): Promise<boolean> {
    if (this.#attempt !== attempt || attempt.started) return Promise.resolve(false);
    attempt.started = true;
    attempt.pending = this.finishLogin(attempt, response);
    return attempt.pending;
  }

  private async finishLogin(attempt: LoginAttempt, response: DataballrCodeResponse): Promise<boolean> {
    try {
      const grant = await exchangeGrant(this.config, response, attempt.controller.signal,
        this.fetcher, this.now);
      if (this.#attempt !== attempt || attempt.controller.signal.aborted) {
        if (grant.refreshToken) await revokeRefreshToken(this.config, grant.refreshToken, this.fetcher);
        return false;
      }
      const generation: LoginGeneration = { ...grant, initialSession: grant.session,
        refresh: null, closed: false };
      this.#current = generation;
      this.#generations.set(grant.session, generation);
      this.onChange(grant.session);
      return true;
    } catch (error) {
      if (this.#attempt !== attempt || attempt.controller.signal.aborted) return false;
      throw error;
    } finally {
      if (this.#attempt === attempt) this.#attempt = null;
    }
  }

  clear(): void {
    void this.signOut();
  }

  async signOut(): Promise<void> {
    const attempt = this.#attempt;
    this.#attempt = null;
    // A production code exchange may already have minted an offline credential.
    // Drain it so finishLogin can revoke the received value without publishing it.
    if (!attempt?.started || !databallrOAuthScopes(this.config).includes('offline_access'))
      attempt?.controller.abort();
    if (attempt?.pending) this.trackCleanup(attempt.pending.then(() => {}, () => {}));
    const generation = this.#current;
    this.#current = null;
    this.onChange(null);
    if (generation) {
      generation.closed = true;
      // Do not abort an exchange that might already have consumed its token.
      // Wait for its successor, then revoke that owned value exactly once.
      const cleanup = (async () => {
        if (generation.refresh) await generation.refresh;
        await this.revokeAvailable(generation);
      })();
      this.trackCleanup(cleanup);
    }
    await Promise.all([...this.#cleanups]);
  }

  private trackCleanup(cleanup: Promise<void>): void {
    this.#cleanups.add(cleanup);
    void cleanup.finally(() => this.#cleanups.delete(cleanup));
  }

  private async revokeAvailable(generation: LoginGeneration): Promise<void> {
    const token = generation.refreshToken;
    generation.refreshToken = null;
    if (token) await revokeRefreshToken(this.config, token, this.fetcher);
  }

  private credentials(generation: LoginGeneration): AuthenticatedAccessToken | null {
    return this.#current === generation && !generation.closed
      ? { accessToken: generation.session.access_token, userId: generation.session.user.id }
      : null;
  }

  private async rotate(generation: LoginGeneration, previousRefresh: string)
    : Promise<AuthenticatedAccessToken | null> {
    let issuedRefresh: string | null = null;
    try {
      const requestedAt = this.now();
      const token = await fetchJson(this.config.issuer + '/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'refresh_token', client_id: this.config.clientId,
          refresh_token: previousRefresh, resource: this.config.audience,
          scope: databallrOAuthScopes(this.config).join(' ') }).toString(),
      }, new AbortController().signal, this.fetcher);
      // Never reuse or revoke the old value after submitting it for rotation.
      if (opaqueToken(token.refresh_token) && token.refresh_token !== previousRefresh)
        issuedRefresh = token.refresh_token;
      const grant = parseGrant(this.config, token, requestedAt, this.now);
      if (!issuedRefresh || grant.refreshToken !== issuedRefresh)
        throw new Error('Databallr did not rotate the refresh token.');
      const session = await confirmAccount(this.config, grant,
        new AbortController().signal, this.fetcher, this.now);
      if (session.user.id !== generation.session.user.id)
        throw new Error('The signed-in account changed.');
      // Commit token and identity together, only after the issuer confirms them.
      generation.refreshToken = issuedRefresh;
      if (this.#current === generation && !generation.closed) {
        generation.session = session;
        this.#generations.set(session, generation);
        this.onChange(session);
      }
      return this.credentials(generation);
    } catch {
      if (this.#current === generation) {
        this.#current = null;
        this.onChange(null);
      }
      generation.closed = true;
      generation.refreshToken = issuedRefresh;
      await this.revokeAvailable(generation);
      return null;
    }
  }

  /** Stable public anchor lets React retain the game client across token rotation. */
  getLoginSession(session: GameAuthSession | null): GameAuthSession | null {
    const generation = session ? this.#generations.get(session) : null;
    return generation && this.#current === generation && !generation.closed
      ? generation.initialSession : null;
  }

  async getAccessToken(
    forceRefresh: boolean,
    expectedSession?: GameAuthSession | null,
    rejectedAccessToken?: string,
  ): Promise<AuthenticatedAccessToken | null> {
    const generation = this.#current;
    if (!generation || generation.closed || (expectedSession !== undefined
        && (!expectedSession || this.#generations.get(expectedSession) !== generation))) return null;
    if (generation.refresh) {
      await generation.refresh;
      return this.credentials(generation);
    }
    const expired = generation.session.expires_at <= this.now() / 1000;
    // A delayed 401 must reuse the token another request already rotated to.
    const rejectedCurrent = forceRefresh && (rejectedAccessToken === undefined
      || rejectedAccessToken === generation.session.access_token);
    if (!expired && !rejectedCurrent) return this.credentials(generation);
    const refreshToken = generation.refreshToken;
    if (!refreshToken) {
      this.clear();
      return null;
    }
    // Transfer ownership before sending. On an ambiguous failure it stays gone.
    generation.refreshToken = null;
    const pending = this.rotate(generation, refreshToken);
    generation.refresh = pending;
    try {
      await pending;
      return this.credentials(generation);
    } finally {
      if (generation.refresh === pending) generation.refresh = null;
    }
  }
}
