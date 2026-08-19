import {
  ContractError,
  parseAdvanceResult,
  parseActivity,
  parseBootstrap,
  parseBoostMutationResult,
  parseCursorPage,
  parseDataEnvelope,
  parseGameState,
  parseInstrumentSummary,
  parseLeaderboardRow,
  parseMarketListing,
  parsePortfolio,
  parsePortfolioPoint,
  parseResetResult,
  parseSettlement,
  parseTradeMutationResult,
  parseWeeklyShortMutationResult,
  type InstrumentSummary,
  type MarketListing,
  type ServerAdvanceResult,
  type ServerBootstrap,
  type ServerBoostMutationResult,
  type ServerGameState,
  type ServerPortfolio,
  type ServerResetResult,
  type ServerTradeMutationResult,
  type ServerWeeklyShortMutationResult,
} from './contracts';

export interface AuthenticatedAccessToken {
  accessToken: string;
  userId: string;
}

export type AccessTokenProvider = (
  forceRefresh: boolean,
) => Promise<AuthenticatedAccessToken | null>;

export class MarketApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number | null,
    public readonly requestMayHaveCommitted = false,
  ) {
    super(message);
    this.name = 'MarketApiError';
  }
}

interface ClientOptions {
  baseUrl: string;
  apiPrefix?: string;
  adminAuthMode?: 'bearer' | 'settlement-key';
  expectedUserId: string;
  getAccessToken: AccessTokenProvider;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retryTimeoutMs?: number;
  idempotencyKeyFactory?: () => string;
  settlementKey?: string | null;
}

interface RequestOptions<T> {
  method?: 'GET' | 'POST';
  body?: unknown;
  idempotencyKey?: string;
  headers?: Record<string, string>;
  parse: (value: unknown) => T;
}

function randomIdempotencyKey(): string {
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (randomUUID) return `app-${randomUUID()}`;
  return `app-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function publicProblem(value: unknown): { code: string; message: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const error = (value as Record<string, unknown>).error;
  if (!error || typeof error !== 'object' || Array.isArray(error)) return null;
  const code = (error as Record<string, unknown>).code;
  const message = (error as Record<string, unknown>).message;
  return typeof code === 'string' && typeof message === 'string' ? { code, message } : null;
}

export class MarketApiClient {
  private readonly baseUrl: string;
  private readonly apiPrefix: string;
  private readonly expectedUserId: string;
  private readonly getAccessToken: AccessTokenProvider;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retryTimeoutMs: number;
  private readonly idempotencyKeyFactory: () => string;
  private readonly settlementKey: string | null;
  private readonly adminAuthMode: 'bearer' | 'settlement-key';

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    const apiPrefix = options.apiPrefix ?? '/api/v1';
    this.apiPrefix = apiPrefix === '' || apiPrefix === '/'
      ? ''
      : `/${apiPrefix.replace(/^\/+|\/+$/g, '')}`;
    this.expectedUserId = options.expectedUserId;
    this.getAccessToken = options.getAccessToken;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.retryTimeoutMs = Math.max(options.retryTimeoutMs ?? 75_000, this.timeoutMs);
    this.idempotencyKeyFactory = options.idempotencyKeyFactory ?? randomIdempotencyKey;
    this.settlementKey = options.settlementKey ?? null;
    this.adminAuthMode = options.adminAuthMode ?? 'settlement-key';
  }

  get canAdvanceSeason(): boolean {
    return this.settlementKey !== null;
  }

  async market(): Promise<MarketListing[]> {
    return this.request(this.apiPath('/market'), {
      parse: (value) => parseDataEnvelope(value, (data, path) => {
        if (!Array.isArray(data)) throw new ContractError(`${path} must be an array.`);
        return data.map((item, index) => parseMarketListing(item, `${path}[${index}]`));
      }),
    });
  }

  async portfolio(): Promise<ServerPortfolio> {
    return this.request(this.apiPath('/portfolio'), {
      parse: (value) => parseDataEnvelope(value, parsePortfolio),
    });
  }

  async game(): Promise<ServerGameState> {
    return this.request(this.apiPath('/game'), {
      parse: (value) => parseDataEnvelope(value, parseGameState),
    });
  }

  async instruments(): Promise<InstrumentSummary> {
    return this.request(this.apiPath('/instruments'), {
      parse: (value) => parseDataEnvelope(value, parseInstrumentSummary),
    });
  }

  async activity(limit = 100) {
    return this.request(this.apiPath(`/activity?limit=${limit}`), {
      parse: (value) => parseDataEnvelope(
        value,
        (data, path) => parseCursorPage(data, path ?? 'response.data', parseActivity),
      ),
    });
  }

  async portfolioHistory(limit = 100) {
    return this.request(this.apiPath(`/portfolio/history?limit=${limit}`), {
      parse: (value) => parseDataEnvelope(
        value,
        (data, path) => parseCursorPage(data, path ?? 'response.data', parsePortfolioPoint),
      ),
    });
  }

  async settlements(limit = 30) {
    return this.request(this.apiPath(`/settlements?limit=${limit}`), {
      parse: (value) => parseDataEnvelope(value, (data, path) => {
        if (!Array.isArray(data)) throw new ContractError(`${path} must be an array.`);
        return data.map((item, index) => parseSettlement(item, `${path}[${index}]`));
      }),
    });
  }

  async leaderboard(limit = 100) {
    return this.request(this.apiPath(`/leaderboard?limit=${limit}`), {
      parse: (value) => parseDataEnvelope(value, (data, path) => {
        if (!Array.isArray(data)) throw new ContractError(`${path} must be an array.`);
        return data.map((item, index) => parseLeaderboardRow(item, `${path}[${index}]`));
      }),
    });
  }

  async bootstrap(settledResultsAfter?: string): Promise<ServerBootstrap> {
    const query = settledResultsAfter
      ? `?settled_results_after=${encodeURIComponent(settledResultsAfter)}`
      : '';
    return this.request(this.apiPath(`/bootstrap${query}`), {
      parse: (value) => parseDataEnvelope(value, parseBootstrap),
    });
  }

  async trade(
    playerId: string,
    side: 'buy' | 'sell',
    expectedPlayerVersion: number,
  ): Promise<ServerTradeMutationResult> {
    return this.mutation(
      this.apiPath('/trades'),
      {
        player_id: playerId,
        side,
        expected_player_version: expectedPlayerVersion,
      },
      parseTradeMutationResult,
    );
  }

  async armWeeklyShort(
    playerId: string,
    expectedGameDate: string,
    expectedPlayerVersion: number,
  ): Promise<ServerWeeklyShortMutationResult> {
    return this.mutation(
      this.apiPath('/instruments/weekly-shorts'),
      {
        player_id: playerId,
        expected_game_date: expectedGameDate,
        expected_player_version: expectedPlayerVersion,
      },
      parseWeeklyShortMutationResult,
    );
  }

  async armBoost(
    playerId: string,
    gameDate: string,
    expectedPlayerVersion: number,
  ): Promise<ServerBoostMutationResult> {
    return this.mutation(
      this.apiPath('/instruments/boosts'),
      {
        player_id: playerId,
        game_date: gameDate,
        expected_player_version: expectedPlayerVersion,
      },
      parseBoostMutationResult,
    );
  }

  async resetAccount(expectedAccountVersion: number): Promise<ServerResetResult> {
    return this.mutation(
      this.apiPath('/account/reset'),
      { confirmation: 'RESET', expected_account_version: expectedAccountVersion },
      parseResetResult,
    );
  }

  // Sandbox-only: rewinds the shared season replay to opening night. Gated on
  // the same settlement key as advanceDay, so public builds never expose it.
  async resetSeason(): Promise<void> {
    if (!this.settlementKey) {
      throw new MarketApiError(
        'Season reset is not configured for this build.',
        'advance_unavailable',
        null,
      );
    }
    await this.request(this.apiPath('/admin/season/reset'), {
      method: 'POST',
      body: { confirmation: 'RESET_SEASON' },
      idempotencyKey: this.idempotencyKeyFactory(),
      headers: { 'X-Settlement-Key': this.settlementKey },
      parse: () => {},
    });
  }

  async advanceDay(expectedGameDate: string): Promise<ServerAdvanceResult> {
    if (this.adminAuthMode === 'settlement-key' && !this.settlementKey) {
      throw new MarketApiError(
        'Season advancement is not configured for this build.',
        'advance_unavailable',
        null,
      );
    }
    return this.request(this.apiPath('/admin/settlements/next'), {
      method: 'POST',
      // Flask's bearer-admin route accepts the expected date directly. The
      // standalone key-authenticated API uses the same request body.
      body: { expected_game_date: expectedGameDate },
      idempotencyKey: this.idempotencyKeyFactory(),
      headers: this.adminAuthMode === 'settlement-key'
        ? { 'X-Settlement-Key': this.settlementKey as string }
        : undefined,
      parse: (value) => parseDataEnvelope(value, parseAdvanceResult),
    });
  }

  private mutation<T>(
    path: string,
    body: unknown,
    parser: (value: unknown, path?: string) => T,
  ): Promise<T> {
    const idempotencyKey = this.idempotencyKeyFactory();
    return this.request(path, {
      method: 'POST',
      body,
      idempotencyKey,
      parse: (value) => parseDataEnvelope(value, parser),
    });
  }

  private apiPath(path: string): string {
    return `${this.apiPrefix}${path}`;
  }

  private async request<T>(path: string, options: RequestOptions<T>): Promise<T> {
    const method = options.method ?? 'GET';
    let forceRefresh = false;
    let authRefreshUsed = false;
    let transportRetryUsed = false;
    let priorMutationAttemptMayHaveCommitted = false;

    while (true) {
      const credentials = await this.getAccessToken(forceRefresh);
      forceRefresh = false;
      if (!credentials) {
        throw new MarketApiError(
          'Sign in again to continue.',
          'unauthorized',
          401,
          priorMutationAttemptMayHaveCommitted,
        );
      }
      if (credentials.userId !== this.expectedUserId) {
        throw new MarketApiError(
          'The signed-in account changed. Try the action again.',
          'account_changed',
          401,
          priorMutationAttemptMayHaveCommitted,
        );
      }
      const token = credentials.accessToken;

      const controller = new AbortController();
      const requestTimeoutMs = transportRetryUsed
        ? this.retryTimeoutMs
        : this.timeoutMs;
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
      let response: Response;
      let rawText: string;
      try {
        response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
            ...(options.headers ?? {}),
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: controller.signal,
        });
        rawText = await response.text();
      } catch (error) {
        if (method === 'POST') priorMutationAttemptMayHaveCommitted = true;
        if (!transportRetryUsed) {
          transportRetryUsed = true;
          continue;
        }
        const timedOut = error instanceof Error && error.name === 'AbortError';
        throw new MarketApiError(
          timedOut ? 'The server took too long to respond. Try again.' : 'The server could not be reached. Check your connection and try again.',
          timedOut ? 'timeout' : 'network_error',
          null,
          method === 'POST',
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
        if (method === 'POST') priorMutationAttemptMayHaveCommitted = true;
        transportRetryUsed = true;
        continue;
      }

      let payload: unknown = null;
      if (rawText) {
        try {
          payload = JSON.parse(rawText);
        } catch {
          throw new MarketApiError(
            'The server returned an unreadable response.',
            'invalid_response',
            response.status,
            priorMutationAttemptMayHaveCommitted || (method === 'POST' && response.ok),
          );
        }
      }

      if (!response.ok) {
        const problem = publicProblem(payload);
        throw new MarketApiError(
          problem?.message ?? 'The request could not be completed.',
          problem?.code ?? 'request_failed',
          response.status,
          priorMutationAttemptMayHaveCommitted,
        );
      }

      try {
        return options.parse(payload);
      } catch (error) {
        if (error instanceof ContractError) {
          throw new MarketApiError(
            'The server returned data this app cannot safely use.',
            'invalid_response',
            response.status,
            priorMutationAttemptMayHaveCommitted || method === 'POST',
          );
        }
        throw error;
      }
    }
  }
}
