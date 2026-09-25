/**
 * The Results feed as one flat list the screen can virtualise:
 * [night header, its rows…, the next night's header, its rows…], newest night
 * first. It answers "what happened last night, and each night before?".
 *
 * - A night lists each player's game once, at its latest revision: a
 *   correction replaces its base result (perGameMetrics.currentResults).
 * - A night's total is perGameMetrics.nightTotals — the same number every
 *   screen uses — plus any fee the ledger dated to that night, so the newest
 *   night agrees with recentEarnings' "last night" exactly as the score counts it.
 * - Fees with no game night (adding, dropping or shorting a player) are
 *   grouped as roster moves by the day they were charged and placed where they
 *   happened between nights, by event cursor. The group is labelled with that
 *   day when it fits between those nights, otherwise by the nights themselves.
 */
import type {
  PerGameBootstrap,
  PerGameLedgerEntry,
  PerGamePositionSide,
  PerGameSettledResult,
} from '../api/contracts';
import { humanDay, signedMoney } from '../copy/terms';
import type { SettlementEquation } from '../state/perGameState';
import { currentResults, nightTotals, summarizeValue } from './perGameMetrics';

export type ResultsFeedSource = Pick<PerGameBootstrap, 'settledResults' | 'ledger' | 'positions'>;

const FEE_KINDS: ReadonlySet<string> = new Set(['open_fee', 'drop_fee', 'fee', 'penalty']);

/** Ledger rows that are account activity rather than a game's cost or dividend. */
export function isFeeEntry(entry: PerGameLedgerEntry): boolean {
  return FEE_KINDS.has(entry.kind);
}

export interface NightSummary {
  /** The game night, "2025-11-05". */
  date: string;
  /** What the night did to your score: its settled games plus fees dated to it. */
  total: number;
  /** Net of the night's settled games alone (nightTotals). */
  gamesNet: number;
  /** Settled games with a known result, and how many made money. */
  games: number;
  wins: number;
  /** The same split by side: roster games that beat their price, shorts that paid off. */
  rosterGames: number;
  rosterWins: number;
  shortGames: number;
  shortWins: number;
  /** Verified did-not-play games: nothing charged, nothing paid. */
  dnp: number;
  /** Games played but not settled yet. */
  pending: number;
  /** Fees the ledger dated to this night, summed, and how many. */
  fees: number;
  feeCount: number;
  /** Games whose current result is a correction. */
  corrections: number;
}

export interface MovesSummary {
  /**
   * The day the fees were charged ("2025-11-05", the viewer's own calendar
   * day), or null when that day does not fit between the nights around it —
   * practice mode stamps fees with the real clock, not the simulated season.
   */
  date: string | null;
  /** The newer night these moves came before, for "before the Wed, Nov 5 games". */
  before: string | null;
  /** The older night these moves came after, for "after the Tue, Nov 4 games". */
  after: string | null;
  total: number;
  count: number;
}

export interface ResultsFeedOptions {
  /** The next scheduled games; a roster move made since the newest night cannot be dated past it. */
  nextGameDate?: string | null;
  /** The calendar day of a ledger timestamp. Defaults to the viewer's local day. */
  dayOf?: (timestamp: string) => string;
}

export type ResultsFeedItem =
  | { type: 'night'; key: string; night: NightSummary }
  | { type: 'result'; key: string; date: string; result: PerGameSettledResult }
  | {
      type: 'fee';
      key: string;
      /** The night the fee belongs to, or null for a roster move between nights. */
      date: string | null;
      entry: PerGameLedgerEntry;
      side: PerGamePositionSide | null;
    }
  | { type: 'moves'; key: string; moves: MovesSummary };

function isoDay(value: string): string {
  return value.includes('T') ? value.slice(0, 10) : value;
}

/**
 * The viewer's calendar day for a ledger timestamp: a fee charged at 9pm in
 * New York on Nov 5 belongs to Nov 5, though it is already Nov 6 in UTC.
 * Game dates are calendar days already and never go through this.
 */
export function localDay(timestamp: string): string {
  if (!timestamp.includes('T')) return timestamp;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return isoDay(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function isCounted(result: PerGameSettledResult): boolean {
  return result.status === 'settled' && result.netPnl !== null && result.dividendDollars !== null;
}

/** Settled games first (best result first), then games waiting on stats, then DNPs. */
function rowGroup(result: PerGameSettledResult): number {
  if (result.status === 'verified_dnp') return 2;
  return isCounted(result) ? 0 : 1;
}

function byRowOrder(left: PerGameSettledResult, right: PerGameSettledResult): number {
  return rowGroup(left) - rowGroup(right)
    || (isCounted(left) && isCounted(right) ? (right.netPnl ?? 0) - (left.netPnl ?? 0) : 0)
    || left.positionId.localeCompare(right.positionId)
    || left.gameId.localeCompare(right.gameId);
}

function byNewestEntry(left: PerGameLedgerEntry, right: PerGameLedgerEntry): number {
  return right.eventCursor - left.eventCursor || right.entryId.localeCompare(left.entryId);
}

function summarizeNight(
  date: string,
  results: readonly PerGameSettledResult[],
  fees: readonly PerGameLedgerEntry[],
  totals: ReadonlyMap<string, { net: number; games: number; wins: number; dnp: number; pending: number }>,
): NightSummary {
  const total = totals.get(date);
  const roster = summarizeValue(results.filter((result) => result.side === 'long'));
  const shorts = summarizeValue(results.filter((result) => result.side === 'short'));
  const feeTotal = fees.reduce((sum, entry) => sum + entry.amountDollars, 0);
  const gamesNet = total?.net ?? 0;
  return {
    date,
    total: gamesNet + feeTotal,
    gamesNet,
    games: total?.games ?? 0,
    wins: total?.wins ?? 0,
    rosterGames: roster.games,
    rosterWins: roster.wins,
    shortGames: shorts.games,
    shortWins: shorts.wins,
    dnp: total?.dnp ?? 0,
    pending: total?.pending ?? 0,
    fees: feeTotal,
    feeCount: fees.length,
    corrections: results.filter((result) => result.kind === 'correction').length,
  };
}

/**
 * Build the feed. Pure: the same bootstrap always yields the same items in the
 * same order, so keys stay stable across refreshes.
 */
export function buildResultsFeed(
  source: ResultsFeedSource,
  options: ResultsFeedOptions = {},
): ResultsFeedItem[] {
  const dayOf = options.dayOf ?? localDay;
  const current = currentResults(source.settledResults);
  const totals = new Map(nightTotals(source.settledResults).map((night) => [night.date, night]));
  const sideOf = new Map(source.positions.map((position) => [position.positionId, position.side]));

  const resultsByNight = new Map<string, PerGameSettledResult[]>();
  for (const result of current) {
    const list = resultsByNight.get(result.gameDate) ?? [];
    list.push(result);
    resultsByNight.set(result.gameDate, list);
  }

  // When each night was first settled (its earliest event), so roster moves
  // can be placed between the nights they happened between.
  const settledAt = new Map<string, number>();
  for (const result of source.settledResults) {
    const seen = settledAt.get(result.gameDate);
    if (seen === undefined || result.eventCursor < seen) settledAt.set(result.gameDate, result.eventCursor);
  }

  const feesByNight = new Map<string, PerGameLedgerEntry[]>();
  const moves: PerGameLedgerEntry[] = [];
  for (const entry of source.ledger.items) {
    if (!isFeeEntry(entry)) continue;
    if (entry.gameDate) {
      const date = isoDay(entry.gameDate);
      const list = feesByNight.get(date) ?? [];
      list.push(entry);
      feesByNight.set(date, list);
      const seen = settledAt.get(date);
      if (seen === undefined || entry.eventCursor < seen) settledAt.set(date, entry.eventCursor);
    } else {
      moves.push(entry);
    }
  }
  moves.sort(byNewestEntry);

  const items: ResultsFeedItem[] = [];
  let nextMove = 0;
  /**
   * Emit every roster move newer than `cursor` (all that remain when null).
   * They sit between the older night `after` and the newer night `before`;
   * their charge day is shown only when it fits between those two nights.
   */
  const emitMoves = (cursor: number | null, before: string | null, after: string | null) => {
    const latest = before ?? options.nextGameDate ?? null;
    // Before any night has settled, the moves were made for the next games.
    const ahead = before ?? (after === null ? options.nextGameDate ?? null : null);
    let group: PerGameLedgerEntry[] = [];
    const flush = () => {
      if (group.length === 0) return;
      const day = dayOf(group[0].createdAt);
      const fits = (after === null || day >= after) && (latest === null || day <= latest);
      items.push({
        type: 'moves',
        key: `moves:${group[0].entryId}`,
        moves: {
          date: fits ? day : null,
          before: ahead,
          after,
          total: group.reduce((sum, entry) => sum + entry.amountDollars, 0),
          count: group.length,
        },
      });
      for (const entry of group) {
        items.push({
          type: 'fee',
          key: `fee:${entry.entryId}`,
          date: null,
          entry,
          side: sideOf.get(entry.positionId) ?? null,
        });
      }
      group = [];
    };
    while (nextMove < moves.length && (cursor === null || moves[nextMove].eventCursor > cursor)) {
      const entry = moves[nextMove];
      if (group.length > 0 && dayOf(group[0].createdAt) !== dayOf(entry.createdAt)) flush();
      group.push(entry);
      nextMove += 1;
    }
    flush();
  };

  const dates = [...new Set([...resultsByNight.keys(), ...feesByNight.keys()])]
    .sort((left, right) => right.localeCompare(left));
  let newer: string | null = null;
  for (const date of dates) {
    emitMoves(settledAt.get(date) ?? Number.NEGATIVE_INFINITY, newer, date);
    newer = date;
    const results = [...(resultsByNight.get(date) ?? [])].sort(byRowOrder);
    const fees = [...(feesByNight.get(date) ?? [])].sort(byNewestEntry);
    items.push({ type: 'night', key: `night:${date}`, night: summarizeNight(date, results, fees, totals) });
    for (const result of results) {
      items.push({ type: 'result', key: `result:${result.positionId}:${result.gameId}`, date, result });
    }
    for (const entry of fees) {
      items.push({ type: 'fee', key: `fee:${entry.entryId}`, date, entry, side: sideOf.get(entry.positionId) ?? null });
    }
  }
  emitMoves(null, newer, null);
  return items;
}

/** Nights in the feed, newest first. */
export function feedNights(items: readonly ResultsFeedItem[]): NightSummary[] {
  return items.flatMap((item) => (item.type === 'night' ? [item.night] : []));
}

/**
 * One plain line under a night's date: "5 of 8 beat their price · 1 of 2
 * shorts paid off · 2 didn't play". A short pays off when its player stays
 * under his price, so shorts are counted apart instead of "beating" it.
 */
export function nightSummaryLine(night: NightSummary): string {
  const parts: string[] = [];
  if (night.rosterGames > 0) parts.push(`${night.rosterWins} of ${night.rosterGames} beat their price`);
  if (night.shortGames > 0) {
    parts.push(`${night.shortWins} of ${night.shortGames} ${night.shortGames === 1 ? 'short' : 'shorts'} paid off`);
  }
  if (night.pending > 0) parts.push(`${night.pending} waiting on stats`);
  if (night.dnp > 0) parts.push(`${night.dnp} didn't play`);
  if (night.corrections > 0) parts.push(`${night.corrections} corrected`);
  if (night.feeCount > 0) parts.push(`fees ${signedMoney(night.fees)}`);
  return parts.join(' · ');
}

/**
 * The line under "Roster moves": "2 fees · Thu, Nov 6", or, when the charge
 * day does not fit the season around it, where the moves sit instead:
 * "12 fees · before the Tue, Oct 21 games".
 */
export function movesSummaryLine(moves: MovesSummary): string {
  const count = `${moves.count} ${moves.count === 1 ? 'fee' : 'fees'}`;
  if (moves.date) return `${count} · ${humanDay(moves.date)}`;
  if (moves.before) return `${count} · before the ${humanDay(moves.before)} games`;
  if (moves.after) return `${count} · after the ${humanDay(moves.after)} games`;
  return count;
}

/** True when a night's total is still unknown: nothing settled yet, games still waiting. */
export function nightTotalPending(night: NightSummary): boolean {
  return night.games === 0 && night.pending > 0 && night.feeCount === 0;
}

/**
 * What one result row shows, decided from its status and its settlement
 * equation (perGameState.settlementEquation). The screen turns this into
 * words; keeping the decisions here lets every status be unit tested.
 */
export interface ResultRowModel {
  /** The net for the number column; null means "Net profit and loss unavailable". */
  net: number | null;
  /** The arithmetic a tap opens. Only a settled game with every amount has one. */
  math: {
    firstLabel: string;
    firstAmount: number;
    secondLabel: string;
    secondAmount: number;
    net: number;
  } | null;
  /**
   * Corrections only: undefined shows no adjustment line, null says the
   * adjustment amount is unavailable, a number is the change to the score.
   */
  adjustment: number | null | undefined;
  /** The stored amounts do not add up to the stored net. */
  mismatch: boolean;
  /** 0 for an original result; 1 for the first correction, 2 for the next. */
  correctionNumber: number;
}

export function resultRowModel(
  result: PerGameSettledResult,
  equation: SettlementEquation,
): ResultRowModel {
  const math = (
    result.status === 'settled'
    && equation.firstAmount !== null
    && equation.secondAmount !== null
    && equation.secondLabel !== null
    && equation.netPnl !== null
  ) ? {
      firstLabel: equation.firstLabel,
      firstAmount: equation.firstAmount,
      secondLabel: equation.secondLabel,
      secondAmount: equation.secondAmount,
      net: equation.netPnl,
    } : null;
  // Only a fully settled game or a verified did-not-play has a final net —
  // the same games the night total counts. Anything still waiting shows no
  // number rather than a provisional one.
  const final = result.status === 'verified_dnp' || isCounted(result);
  return {
    net: final ? equation.netPnl : null,
    math,
    adjustment: equation.correction && (math !== null || result.status === 'verified_dnp')
      ? equation.correctionAdjustment
      : undefined,
    mismatch: equation.reconciles === false,
    correctionNumber: result.kind === 'correction' ? Math.max(1, result.resultRevision - 1) : 0,
  };
}
