import {
  ContractError,
  parseActivity,
  parseBootstrap,
  parseCursorPage,
  parseDataEnvelope,
  parseGameState,
  parseInstrumentSummary,
  parseLeaderboardRow,
  parseMarketListing,
  parseMutationResult,
  parsePortfolio,
  parsePortfolioPoint,
  parseResetResult,
  parseSettlement,
  parseTradeResult,
  type InstrumentSummary,
  type MarketListing,
  type ServerBootstrap,
  type ServerGameState,
  type ServerMutationResult,
  type ServerPortfolio,
  type ServerResetResult,
  type ServerTradeResult,
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
    public readonly mutationMayHaveCommitted = false,
  ) {
    super(message);
    this.name = 'MarketApiError';
  }
}

export function mutationFailureMayHaveCommitted(error: unknown): boolean {
  if (!(error instanceof MarketApiError)) return true;
  if (error.mutationMayHaveCommitted) return true;
  if (error.status !== null && error.status >= 400 && error.status < 500) {
    return false;
  }
  return error.code === 'invalid_response'
    || error.status === null
    || error.status < 400
    || error.status >= 500;
}

interface ClientOptions {
  baseUrl: string;
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

export interface ServerAdvanceResult {
  gameDate: string;
  nextGameDate: string | null;
  isComplete: boolean;
  replayed: boolean;
}

function parseAdvanceResult(value: unknown, path = 'response.data'): ServerAdvanceResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContractError(`${path} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const gameDate = record.game_date;
  const nextGameDate = record.next_game_date;
  const isComplete = record.is_complete;
  const replayed = record.replayed;
  if (typeof gameDate !== 'string') {
    throw new ContractError(`${path}.game_date must be a string.`);
  }
  if (nextGameDate !== null && typeof nextGameDate !== 'string') {
    throw new ContractError(`${path}.next_game_date must be a string or null.`);
  }
  if (typeof isComplete !== 'boolean' || typeof replayed !== 'boolean') {
    throw new ContractError(`${path} settlement flags must be booleans.`);
  }
  return { gameDate, nextGameDate, isComplete, replayed };
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
  private readonly expectedUserId: string;
  private readonly getAccessToken: AccessTokenProvider;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retryTimeoutMs: number;
  private readonly idempotencyKeyFactory: () => string;
  private readonly settlementKey: string | null;

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.expectedUserId = options.expectedUserId;
    this.getAccessToken = options.getAccessToken;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.retryTimeoutMs = Math.max(options.retryTimeoutMs ?? 75_000, this.timeoutMs);
    this.idempotencyKeyFactory = options.idempotencyKeyFactory ?? randomIdempotencyKey;
    this.settlementKey = options.settlementKey ?? null;
  }

  get canAdvanceSeason(): boolean {
    return this.settlementKey !== null;
  }

  async market(): Promise<MarketListing[]> {
    return this.request('/api/v1/market', {
      parse: (value) => parseDataEnvelope(value, (data, path) => {
        if (!Array.isArray(data)) throw new ContractError(`${path} must be an array.`);
        return data.map((item, index) => parseMarketListing(item, `${path}[${index}]`));
      }),
    });
  }

  async portfolio(): Promise<ServerPortfolio> {
    return this.request('/api/v1/portfolio', {
      parse: (value) => parseDataEnvelope(value, parsePortfolio),
    });
  }

  async game(): Promise<ServerGameState> {
    return this.request('/api/v1/game', {
      parse: (value) => parseDataEnvelope(value, parseGameState),
    });
  }

  async instruments(): Promise<InstrumentSummary> {
    return this.request('/api/v1/instruments', {
      parse: (value) => parseDataEnvelope(value, parseInstrumentSummary),
    });
  }

  async activity(limit = 100) {
    return this.request(`/api/v1/activity?limit=${limit}`, {
      parse: (value) => parseDataEnvelope(
        value,
        (data, path) => parseCursorPage(data, path ?? 'response.data', parseActivity),
      ),
    });
  }

  async portfolioHistory(limit = 100) {
    return this.request(`/api/v1/portfolio/history?limit=${limit}`, {
      parse: (value) => parseDataEnvelope(
        value,
        (data, path) => parseCursorPage(data, path ?? 'response.data', parsePortfolioPoint),
      ),
    });
  }

  async settlements(limit = 30) {
    return this.request(`/api/v1/settlements?limit=${limit}`, {
      parse: (value) => parseDataEnvelope(value, (data, path) => {
        if (!Array.isArray(data)) throw new ContractError(`${path} must be an array.`);
        return data.map((item, index) => parseSettlement(item, `${path}[${index}]`));
      }),
    });
  }

  async leaderboard(limit = 100) {
    return this.request(`/api/v1/leaderboard?limit=${limit}`, {
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
    return this.request(`/api/v1/bootstrap${query}`, {
      parse: (value) => parseDataEnvelope(value, parseBootstrap),
    });
  }

  async trade(
    playerId: string,
    side: 'buy' | 'sell',
    settledResultsAfter?: string,
  ): Promise<ServerTradeResult> {
    return this.mutation(
      '/api/v1/trades',
      {
        player_id: playerId,
        side,
        ...(settledResultsAfter ? { settled_results_after: settledResultsAfter } : {}),
      },
      parseTradeResult,
    );
  }

  async armWeeklyShort(playerId: string): Promise<ServerMutationResult> {
    return this.mutation(
      '/api/v1/instruments/weekly-shorts',
      { player_id: playerId },
      parseMutationResult,
    );
  }

  async armBoost(playerId: string, gameDate: string): Promise<ServerMutationResult> {
    return this.mutation(
      '/api/v1/instruments/boosts',
      { player_id: playerId, game_date: gameDate },
      parseMutationResult,
    );
  }

  async advanceSettlement(expectedGameDate: string): Promise<ServerAdvanceResult> {
    if (!this.settlementKey) {
      throw new MarketApiError(
        'Season advancement is not configured for this build.',
        'advance_unavailable',
        null,
      );
    }
    return this.request('/api/v1/admin/settlements/next', {
      method: 'POST',
      body: { expected_game_date: expectedGameDate },
      idempotencyKey: this.idempotencyKeyFactory(),
      headers: { 'X-Settlement-Key': this.settlementKey },
      parse: (value) => parseDataEnvelope(value, parseAdvanceResult),
    });
  }

  async resetAccount(expectedAccountVersion: number): Promise<ServerResetResult> {
    return this.mutation(
      '/api/v1/account/reset',
      { confirmation: 'RESET', expected_account_version: expectedAccountVersion },
      parseResetResult,
    );
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
        throw new MarketApiError(
          'Sign in again to continue.',
          'unauthorized',
          401,
          mutationMayHaveCommitted,
        );
      }
      if (credentials.userId !== this.expectedUserId) {
        throw new MarketApiError(
          'The signed-in account changed. Try the action again.',
          'account_changed',
          401,
          mutationMayHaveCommitted,
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
        if (method === 'POST') mutationMayHaveCommitted = true;
        if (!transportRetryUsed) {
          transportRetryUsed = true;
          continue;
        }
        const timedOut = error instanceof Error && error.name === 'AbortError';
        throw new MarketApiError(
          timedOut ? 'The server took too long to respond. Try again.' : 'The server could not be reached. Check your connection and try again.',
          timedOut ? 'timeout' : 'network_error',
          null,
          mutationMayHaveCommitted,
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
        if (method === 'POST') mutationMayHaveCommitted = true;
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
            mutationMayHaveCommitted,
          );
        }
      }

      if (!response.ok) {
        const problem = publicProblem(payload);
        throw new MarketApiError(
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
          throw new MarketApiError(
            'The server returned data this app cannot safely use.',
            'invalid_response',
            response.status,
            mutationMayHaveCommitted || method === 'POST',
          );
        }
        throw error;
      }
    }
  }
}
