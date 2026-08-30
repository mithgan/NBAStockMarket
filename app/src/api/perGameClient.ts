import {
  ContractError,
  parseDataEnvelope,
  parsePerGameBootstrap,
  parsePerGameClosePositionMutationResult,
  parsePerGamePositionMutationResult,
  type PerGameBootstrap,
  type PerGameClosePositionMutationResult,
  type PerGameOpenPositionRequest,
  type PerGamePositionMutationResult,
} from './contracts';
import { samePerGameBootstrapIdentity } from '../state/perGameState';

export interface PerGameAuthenticatedAccessToken {
  accessToken: string;
  userId: string;
}

export type PerGameAccessTokenProvider = (
  forceRefresh: boolean,
) => Promise<PerGameAuthenticatedAccessToken | null>;

export class PerGameApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number | null,
    public readonly requestMayHaveCommitted = false,
  ) {
    super(message);
    this.name = 'PerGameApiError';
  }
}

export function perGameMutationOutcomeMayHaveCommitted(error: unknown): boolean {
  if (!(error instanceof PerGameApiError)) return true;
  return error.requestMayHaveCommitted;
}

interface PerGameClientOptions {
  baseUrl: string;
  apiPrefix?: string;
  expectedUserId: string;
  getAccessToken: PerGameAccessTokenProvider;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retryTimeoutMs?: number;
  idempotencyKeyFactory?: () => string;
}

interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  idempotencyKey?: string;
  parse: (value: unknown) => T;
}

function randomIdempotencyKey(): string {
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (randomUUID) return `app-v2-${randomUUID()}`;
  return `app-v2-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function publicProblem(value: unknown): { code: string; message: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const error = (value as Record<string, unknown>).error;
  if (!error || typeof error !== 'object' || Array.isArray(error)) return null;
  const code = (error as Record<string, unknown>).code;
  const message = (error as Record<string, unknown>).message;
  return typeof code === 'string' && typeof message === 'string' ? { code, message } : null;
}

function settledResultIdentity(result: PerGameBootstrap['settledResults'][number]): string {
  return `${result.positionId}:${result.gameId}`;
}

function mergeBootstrapPages(
  previous: PerGameBootstrap,
  incoming: PerGameBootstrap,
): PerGameBootstrap {
  if (!samePerGameBootstrapIdentity(previous, incoming)) return incoming;
  if (incoming.game.eventCursor < previous.game.eventCursor) {
    throw new PerGameApiError(
      'The per-game event cursor moved backward while loading account history.',
      'invalid_cursor',
      200,
    );
  }
  const ledgerById = new Map(previous.ledger.items.map((entry) => [entry.entryId, entry]));
  for (const entry of incoming.ledger.items) ledgerById.set(entry.entryId, entry);
  const resultsByIdentity = new Map(
    previous.settledResults.map((result) => [settledResultIdentity(result), result]),
  );
  for (const result of incoming.settledResults) {
    resultsByIdentity.set(settledResultIdentity(result), result);
  }
  return {
    ...incoming,
    ledger: {
      ...incoming.ledger,
      items: [...ledgerById.values()].sort((left, right) => (
        left.eventCursor - right.eventCursor || left.entryId.localeCompare(right.entryId)
      )),
    },
    settledResults: [...resultsByIdentity.values()].sort((left, right) => (
      left.eventCursor - right.eventCursor
      || left.resultRevision - right.resultRevision
      || left.positionId.localeCompare(right.positionId)
    )),
  };
}

export class PerGameApiClient {
  private readonly baseUrl: string;
  private readonly apiPrefix: string;
  private readonly expectedUserId: string;
  private readonly getAccessToken: PerGameAccessTokenProvider;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retryTimeoutMs: number;
  private readonly idempotencyKeyFactory: () => string;

  constructor(options: PerGameClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    const apiPrefix = options.apiPrefix ?? '/api/v2';
    this.apiPrefix = apiPrefix === '' || apiPrefix === '/'
      ? ''
      : `/${apiPrefix.replace(/^\/+|\/+$/g, '')}`;
    this.expectedUserId = options.expectedUserId;
    this.getAccessToken = options.getAccessToken;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.retryTimeoutMs = Math.max(options.retryTimeoutMs ?? 75_000, this.timeoutMs);
    this.idempotencyKeyFactory = options.idempotencyKeyFactory ?? randomIdempotencyKey;
  }

  async bootstrap(afterCursor?: number): Promise<PerGameBootstrap> {
    let requestedCursor = afterCursor;
    let snapshot = await this.bootstrapPage(requestedCursor);
    const seenCursors = new Set<number>();
    while (snapshot.ledger.nextCursor !== null) {
      const nextCursor = snapshot.ledger.nextCursor;
      if (
        seenCursors.has(nextCursor)
        || (
          seenCursors.size > 0
          && requestedCursor !== undefined
          && nextCursor <= requestedCursor
        )
      ) {
        throw new PerGameApiError(
          'The server returned a repeated per-game history cursor.',
          'invalid_cursor',
          200,
        );
      }
      seenCursors.add(nextCursor);
      const page = await this.bootstrapPage(nextCursor);
      const identityChanged = !samePerGameBootstrapIdentity(snapshot, page);
      if (identityChanged) {
        snapshot = await this.bootstrapPage();
        seenCursors.clear();
        requestedCursor = undefined;
      } else {
        snapshot = mergeBootstrapPages(snapshot, page);
        requestedCursor = nextCursor;
      }
    }
    return snapshot;
  }

  async openPosition({
    playerId,
    side,
    expectedAccountVersion,
    expectedQuoteVersion,
  }: PerGameOpenPositionRequest): Promise<PerGamePositionMutationResult> {
    return this.mutation(this.apiPath('/positions'), 'POST', {
      player_id: playerId,
      side,
      expected_account_version: expectedAccountVersion,
      expected_quote_version: expectedQuoteVersion,
    });
  }

  async closePosition(
    positionId: string,
    expectedAccountVersion: number,
  ): Promise<PerGameClosePositionMutationResult> {
    return this.request(this.apiPath(`/positions/${encodeURIComponent(positionId)}`), {
      method: 'DELETE',
      body: { expected_account_version: expectedAccountVersion },
      idempotencyKey: this.idempotencyKeyFactory(),
      parse: (value) => parseDataEnvelope(value, parsePerGameClosePositionMutationResult),
    });
  }

  private mutation(
    path: string,
    method: 'POST' | 'DELETE',
    body: unknown,
  ): Promise<PerGamePositionMutationResult> {
    return this.request(path, {
      method,
      body,
      idempotencyKey: this.idempotencyKeyFactory(),
      parse: (value) => parseDataEnvelope(value, parsePerGamePositionMutationResult),
    });
  }

  private bootstrapPage(afterCursor?: number): Promise<PerGameBootstrap> {
    const query = afterCursor === undefined
      ? ''
      : `?after_event_cursor=${encodeURIComponent(String(afterCursor))}`;
    return this.request(this.apiPath(`/bootstrap${query}`), {
      parse: (value) => parseDataEnvelope(value, parsePerGameBootstrap),
    });
  }

  private apiPath(path: string): string {
    return `${this.apiPrefix}/${path.replace(/^\/+/, '')}`;
  }

  private async request<T>(path: string, options: RequestOptions<T>): Promise<T> {
    const method = options.method ?? 'GET';
    let forceRefresh = false;
    let authRefreshUsed = false;
    let transportRetryUsed = false;
    let mutationMayHaveCommitted = false;

    while (true) {
      const credentials = await this.getAccessToken(forceRefresh);
      forceRefresh = false;
      if (!credentials) {
        throw new PerGameApiError(
          'Sign in again to continue.',
          'unauthorized',
          401,
          mutationMayHaveCommitted,
        );
      }
      if (credentials.userId !== this.expectedUserId) {
        throw new PerGameApiError(
          'The signed-in account changed. Try the action again.',
          'account_changed',
          401,
          mutationMayHaveCommitted,
        );
      }

      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        transportRetryUsed ? this.retryTimeoutMs : this.timeoutMs,
      );
      let response: Response;
      let rawText: string;
      try {
        response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method,
          cache: method === 'GET' ? 'no-store' : undefined,
          headers: {
            Authorization: `Bearer ${credentials.accessToken}`,
            Accept: 'application/json',
            ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: controller.signal,
        });
        rawText = await response.text();
      } catch (error) {
        if (method !== 'GET') mutationMayHaveCommitted = true;
        if (!transportRetryUsed) {
          transportRetryUsed = true;
          continue;
        }
        const timedOut = error instanceof Error && error.name === 'AbortError';
        throw new PerGameApiError(
          timedOut
            ? 'The server took too long to respond. Try again.'
            : 'The server could not be reached. Check your connection and try again.',
          timedOut ? 'timeout' : 'network_error',
          null,
          method !== 'GET',
        );
      } finally {
        clearTimeout(timeout);
      }

      if (response.status === 401 && !authRefreshUsed) {
        authRefreshUsed = true;
        forceRefresh = true;
        continue;
      }
      if (response.status >= 500 && !transportRetryUsed) {
        if (method !== 'GET') mutationMayHaveCommitted = true;
        transportRetryUsed = true;
        continue;
      }

      let payload: unknown = null;
      if (rawText) {
        try {
          payload = JSON.parse(rawText);
        } catch {
          throw new PerGameApiError(
            'The server returned an unreadable response.',
            'invalid_response',
            response.status,
            mutationMayHaveCommitted || (method !== 'GET' && response.ok),
          );
        }
      }

      if (!response.ok) {
        const problem = publicProblem(payload);
        throw new PerGameApiError(
          problem?.message ?? 'The request could not be completed.',
          problem?.code ?? 'request_failed',
          response.status,
          mutationMayHaveCommitted,
        );
      }

      try {
        return options.parse(payload);
      } catch (error) {
        if (error instanceof ContractError) {
          throw new PerGameApiError(
            'The server returned per-game market data this app cannot safely use.',
            'invalid_response',
            response.status,
            mutationMayHaveCommitted || method !== 'GET',
          );
        }
        throw error;
      }
    }
  }
}
