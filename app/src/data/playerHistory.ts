import { HISTORY_PLAYERS } from './playerHistoryPlayers';
import { normalizePlayerName, PLAYER_HISTORY_API, priorSeason } from './playerHistoryRequest';

export interface HistoricalGame {
  /** Stable display key, not a provider game ID. */
  gameId: string;
  date: string;
  opponent: string | null;
  venue: 'home' | 'away' | null;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
}

export interface HistoricalPlayerSeason {
  playerId: string;
  playerName: string;
  seasonId: string;
  games: HistoricalGame[];
  sourceUrl: string;
}

export interface HistoryPlayer { playerId: string; name: string }
type HistoryOptions = { signal?: AbortSignal; fetcher?: typeof fetch; timeoutMs?: number };
const MAX_ROWS = 200;
const CACHE_MS = 15 * 60_000;
const cache = new Map<string, { value: HistoricalPlayerSeason | null; expires: number }>();

function copyHistory(value: HistoricalPlayerSeason | null): HistoricalPlayerSeason | null {
  return value ? { ...value, games: value.games.map((game) => ({ ...game })) } : null;
}

function checkAborted(signal?: AbortSignal): void {
  // React Native's AbortSignal supports `aborted`, but not throwIfAborted().
  if (!signal?.aborted) return;
  const error = new Error('The history request was canceled.');
  error.name = 'AbortError';
  throw signal.reason ?? error;
}

function invalid(): never { throw new Error('The historical stats response could not be verified.'); }
function statistic(value: unknown, integer: boolean): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) return invalid();
  return value;
}
function gameDate(value: unknown, year: number): string {
  if (typeof value !== 'number' || !Number.isInteger(value)) return invalid();
  const raw = String(value);
  if (!/^\d{8}$/.test(raw)) return invalid();
  const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date
    || Number(raw.slice(0, 4)) < year - 1 || Number(raw.slice(0, 4)) > year) return invalid();
  return date;
}

/** Reject mixed identities/seasons or malformed rows instead of displaying partial history. */
export function parsePlayerHistory(
  payload: unknown, player: HistoryPlayer, nbaId: number, season: { id: string; endYear: number }, sourceUrl: string,
): HistoricalPlayerSeason | null {
  if (!Array.isArray(payload) || payload.length >= MAX_ROWS) return invalid();
  const dates = new Set<string>();
  const games: HistoricalGame[] = [];
  for (const value of payload) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
    const row = value as Record<string, unknown>;
    if (row.nba_id !== nbaId || typeof row.player_name !== 'string'
      || normalizePlayerName(row.player_name) !== normalizePlayerName(player.name)
      || row.year !== season.endYear || row.playoffs !== false) return invalid();
    const date = gameDate(row.date, season.endYear);
    if (dates.has(date)) return invalid();
    dates.add(date);
    const minutes = statistic(row.MIN, false);
    if (minutes === 0) continue; // Explicit DNP only; missing minutes are not fabricated.
    const opponent = typeof row.Opponent === 'string' && /^[A-Z]{2,4}$/.test(row.Opponent.trim())
      ? row.Opponent.trim() : null;
    games.push({
      gameId: `nba:${nbaId}:${date}`, date, opponent, venue: null,
      minutes, points: statistic(row.PTS, true), rebounds: statistic(row.REB, true), assists: statistic(row.AST, true),
    });
  }
  if (games.length === 0) return null;
  return { playerId: player.playerId, playerName: player.name, seasonId: season.id,
    sourceUrl, games: games.sort((a, b) => a.date.localeCompare(b.date)) };
}

/** Fetch a selected player's complete prior regular season from the existing Databallr API. */
export async function loadPlayerHistory(
  player: HistoryPlayer, currentSeasonId: string, options: HistoryOptions = {},
): Promise<HistoricalPlayerSeason | null> {
  checkAborted(options.signal);
  const season = priorSeason(currentSeasonId);
  const identity = Object.prototype.hasOwnProperty.call(HISTORY_PLAYERS, player.playerId)
    ? HISTORY_PLAYERS[player.playerId] : undefined;
  if (!season || !identity || normalizePlayerName(identity.name) !== normalizePlayerName(player.name)) return null;
  const url = new URL(PLAYER_HISTORY_API);
  url.search = new URLSearchParams({
    nba_id: String(identity.nbaId), year: String(season.endYear), playoffs: '0', limit: String(MAX_ROWS),
  }).toString();
  const key = `${player.playerId}:${normalizePlayerName(player.name)}:${season.id}`;
  // Injected fetchers are test-only and must not read/write the shared application cache.
  const cached = !options.fetcher ? cache.get(key) : undefined;
  if (cached && cached.expires > Date.now()) return copyHistory(cached.value);
  const controller = new AbortController();
  const onAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', onAbort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 12_000);
  try {
    const response = await (options.fetcher ?? fetch)(url.toString(), {
      signal: controller.signal, credentials: 'omit', redirect: 'error', headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error('The history service is unavailable. Please try again.');
    const history = parsePlayerHistory(await response.json(), player, identity.nbaId, season, url.toString());
    checkAborted(controller.signal);
    if (!options.fetcher) {
      if (cache.size >= 100) cache.delete(cache.keys().next().value!);
      cache.set(key, { value: history, expires: Date.now() + CACHE_MS });
    }
    return copyHistory(history);
  } catch (error) {
    if (timedOut) throw new Error('The history request timed out. Please try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
