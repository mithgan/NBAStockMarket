/**
 * Per-game value numbers, computed once so every screen agrees.
 *
 * Roster rows, the market's value signal, the player profile and the results
 * feed all answer the same question — "is he worth his price, game by game?" —
 * so they read these helpers instead of re-deriving averages inline.
 *
 * A game counts once, at its latest revision: a correction replaces the base
 * result for that position and game, it does not add to it. Only settled games
 * with a known net enter the averages. A verified did-not-play night charges
 * nothing and pays nothing, so it is counted separately and never averaged in.
 */
import type {
  PerGameLedgerEntry,
  PerGameMarketPlayer,
  PerGamePositionSide,
  PerGameSettledResult,
} from '../api/contracts';

/** The latest revision of each (position, game), oldest game first. */
export function currentResults(
  results: readonly PerGameSettledResult[],
): PerGameSettledResult[] {
  const latest = new Map<string, PerGameSettledResult>();
  for (const result of results) {
    const key = `${result.positionId}:${result.gameId}`;
    const seen = latest.get(key);
    if (
      !seen
      || result.resultRevision > seen.resultRevision
      || (result.resultRevision === seen.resultRevision && result.eventCursor > seen.eventCursor)
    ) {
      latest.set(key, result);
    }
  }
  return [...latest.values()].sort((left, right) => (
    left.gameDate.localeCompare(right.gameDate) || left.eventCursor - right.eventCursor
  ));
}

export interface ValueSummary {
  /** Settled games with a known result. */
  games: number;
  /** Verified did-not-play nights: nothing charged, nothing paid. */
  dnp: number;
  /** Nights played but not settled yet. */
  pending: number;
  /** Sum of net profit over settled games. */
  total: number;
  /** Net profit per settled game, or null before his first one. */
  avgNet: number | null;
  /** Dividend per settled game, or null before his first one. */
  avgDividend: number | null;
  /** Price per settled game (the locked price, averaged), or null. */
  avgPrice: number | null;
  /** Settled games where he beat his price (net above $0). */
  wins: number;
  /** Net of the most recent settled game, or null. */
  lastNet: number | null;
  /** Date of the most recent settled game, or null. */
  lastDate: string | null;
}

function isCounted(result: PerGameSettledResult): boolean {
  return result.status === 'settled' && result.netPnl !== null && result.dividendDollars !== null;
}

/** Summarise a set of current results (see `currentResults`). */
export function summarizeValue(results: readonly PerGameSettledResult[]): ValueSummary {
  let games = 0;
  let dnp = 0;
  let pending = 0;
  let total = 0;
  let dividends = 0;
  let prices = 0;
  let wins = 0;
  let last: PerGameSettledResult | null = null;
  for (const result of results) {
    if (result.status === 'verified_dnp') {
      dnp += 1;
      continue;
    }
    if (!isCounted(result)) {
      pending += 1;
      continue;
    }
    const net = result.netPnl ?? 0;
    games += 1;
    total += net;
    dividends += result.dividendDollars ?? 0;
    prices += result.lockedGameCost;
    if (net > 0) wins += 1;
    if (!last || result.gameDate > last.gameDate
      || (result.gameDate === last.gameDate && result.eventCursor > last.eventCursor)) {
      last = result;
    }
  }
  return {
    games,
    dnp,
    pending,
    total,
    avgNet: games > 0 ? total / games : null,
    avgDividend: games > 0 ? dividends / games : null,
    avgPrice: games > 0 ? prices / games : null,
    wins,
    lastNet: last?.netPnl ?? null,
    lastDate: last?.gameDate ?? null,
  };
}

/** Value of one position (one stint on the roster or one short). */
export function positionValue(
  results: readonly PerGameSettledResult[],
  positionId: string,
): ValueSummary {
  return summarizeValue(currentResults(results).filter((result) => result.positionId === positionId));
}

/** Value of every stint this account has had with a player, optionally one side only. */
export function playerValue(
  results: readonly PerGameSettledResult[],
  playerId: string,
  side?: PerGamePositionSide,
): ValueSummary {
  return summarizeValue(currentResults(results).filter((result) => (
    result.playerId === playerId && (side === undefined || result.side === side)
  )));
}

export type ValueVerdict = 'profit' | 'loss' | 'even' | 'untested';

/**
 * The one-word answer to "is he paying for himself?". Untested until he has
 * a settled game; even when the average rounds to under $500 either way.
 */
export function valueVerdict(summary: ValueSummary): ValueVerdict {
  if (summary.avgNet === null) return 'untested';
  if (Math.abs(summary.avgNet) < 500) return 'even';
  return summary.avgNet > 0 ? 'profit' : 'loss';
}

/**
 * What one game at today's price would have made last season, per game.
 * A roster spot profits when he out-earns his price; a short profits when he
 * falls short of it. Null when there is no prior season to compare against.
 */
export function lastYearEdge(
  player: Pick<PerGameMarketPlayer, 'currentGameCost' | 'priorSeasonValuePerGame'>,
  side: PerGamePositionSide,
): number | null {
  if (player.priorSeasonValuePerGame === null) return null;
  const edge = player.priorSeasonValuePerGame - player.currentGameCost;
  return side === 'long' ? edge : -edge;
}

export interface NightTotal {
  date: string;
  /** Net over the night's settled games, at their latest revision. */
  net: number;
  games: number;
  wins: number;
  dnp: number;
  pending: number;
}

/** One total per game night, newest night first. */
export function nightTotals(results: readonly PerGameSettledResult[]): NightTotal[] {
  const byDate = new Map<string, PerGameSettledResult[]>();
  for (const result of currentResults(results)) {
    const list = byDate.get(result.gameDate) ?? [];
    list.push(result);
    byDate.set(result.gameDate, list);
  }
  return [...byDate.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([date, list]) => {
      const summary = summarizeValue(list);
      return {
        date,
        net: summary.total,
        games: summary.games,
        wins: summary.wins,
        dnp: summary.dnp,
        pending: summary.pending,
      };
    });
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Score change on the last settled night and over the seven nights ending on
 * it, from the ledger, so fees count exactly as they do in the score.
 */
export function recentEarnings(
  ledger: readonly PerGameLedgerEntry[] | undefined,
  lastSettledDate: string | null | undefined,
): { night: number; week: number } | null {
  if (!ledger || !lastSettledDate) return null;
  const weekStart = addDays(lastSettledDate, -6);
  let night = 0;
  let week = 0;
  for (const entry of ledger) {
    if (!entry.gameDate) continue;
    if (entry.gameDate === lastSettledDate) night += entry.amountDollars;
    if (entry.gameDate >= weekStart && entry.gameDate <= lastSettledDate) week += entry.amountDollars;
  }
  return { night, week };
}
