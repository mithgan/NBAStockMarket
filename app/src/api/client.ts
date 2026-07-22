import {
  ContractError,
  parseActivity,
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
  type InstrumentSummary,
  type MarketListing,
  type ServerBootstrap,
  type ServerGameState,
  type ServerMutationResult,
  type ServerPortfolio,
  type ServerResetResult,
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
  ) {
    super(message);
    this.name = 'MarketApiError';
  }
}

interface ClientOptions {
  baseUrl: string;
  expectedUserId: string;
  getAccessToken: AccessTokenProvider;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  idempotencyKeyFactory?: () => string;
}

interface RequestOptions<T> {
  method?: 'GET' | 'POST';
  body?: unknown;
  idempotencyKey?: string;
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
  private readonly expectedUserId: string;
  private readonly getAccessToken: AccessTokenProvider;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly idempotencyKeyFactory: () => string;

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.expectedUserId = options.expectedUserId;
    this.getAccessToken = options.getAccessToken;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.idempotencyKeyFactory = options.idempotencyKeyFactory ?? randomIdempotencyKey;
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

  async bootstrap(): Promise<ServerBootstrap> {
    // Portfolio creation is the account boundary. Finish it before fan-out so a
    // first sign-in cannot race multiple account-creation reads.
    let portfolioBefore = await this.portfolio();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const [
        market,
        game,
        activity,
        portfolioHistory,
        settlements,
        leaderboard,
      ] = await Promise.all([
        this.market(),
        this.game(),
        this.activity(),
        this.portfolioHistory(),
        this.settlements(),
        this.leaderboard(),
      ]);
      const [portfolioAfter, gameAfter] = await Promise.all([
        this.portfolio(),
        this.game(),
      ]);
      if (
        portfolioBefore.version === portfolioAfter.version
        && game.version === gameAfter.version
      ) {
        return {
          market,
          portfolio: portfolioAfter,
          game: gameAfter,
          activity,
          portfolioHistory,
          settlements,
          leaderboard,
        };
      }
      portfolioBefore = portfolioAfter;
    }
    throw new MarketApiError(
      'Your account changed while it was loading. Try again.',
      'snapshot_conflict',
      409,
    );
  }

  async trade(playerId: string, side: 'buy' | 'sell'): Promise<ServerMutationResult> {
    return this.mutation('/api/v1/trades', { player_id: playerId, side }, parseMutationResult);
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

    while (true) {
      const credentials = await this.getAccessToken(forceRefresh);
      forceRefresh = false;
      if (!credentials) {
        throw new MarketApiError('Sign in again to continue.', 'unauthorized', 401);
      }
      if (credentials.userId !== this.expectedUserId) {
        throw new MarketApiError(
          'The signed-in account changed. Try the action again.',
          'account_changed',
          401,
        );
      }
      const token = credentials.accessToken;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
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
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: controller.signal,
        });
        rawText = await response.text();
      } catch (error) {
        if (!transportRetryUsed) {
          transportRetryUsed = true;
          continue;
        }
        const timedOut = error instanceof Error && error.name === 'AbortError';
        throw new MarketApiError(
          timedOut ? 'The server took too long to respond. Try again.' : 'The server could not be reached. Check your connection and try again.',
          timedOut ? 'timeout' : 'network_error',
          null,
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
        transportRetryUsed = true;
        continue;
      }

      let payload: unknown = null;
      if (rawText) {
        try {
          payload = JSON.parse(rawText);
        } catch {
          throw new MarketApiError('The server returned an unreadable response.', 'invalid_response', response.status);
        }
      }

      if (!response.ok) {
        const problem = publicProblem(payload);
        throw new MarketApiError(
          problem?.message ?? 'The request could not be completed.',
          problem?.code ?? 'request_failed',
          response.status,
        );
      }

      try {
        return options.parse(payload);
      } catch (error) {
        if (error instanceof ContractError) {
          throw new MarketApiError('The server returned data this app cannot safely use.', 'invalid_response', response.status);
        }
        throw error;
      }
    }
  }
}
