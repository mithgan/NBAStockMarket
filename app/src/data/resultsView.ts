/**
 * The Results feed as one flat list the screen can virtualise:
 * [day header, its rows…, the next day's header, its rows…], newest day
 * first. It answers "what happened last night, and each night before?".
 *
 * - A day lists each player's game once, at its latest revision: a correction
 *   replaces its base result (perGameMetrics.currentResults).
 * - A day's total is what your players made that night: its settled games,
 *   perGameMetrics.nightTotals, the figure every screen uses. Games only, like
 *   recentEarnings, so the newest night here is the "Last night" the chrome
 *   and the Roster show.
 * - The day's fees sit on their own "Roster moves" line with their own amount,
 *   so the night still adds up on screen: the header is its game rows, the
 *   fees line is its fee rows. A fee belongs to its game date or, for an add
 *   or drop fee, to the day it was booked (perGameMetrics.entryDay).
 * - A day with fees but no games (moves made for games still to come, or a
 *   night none of your players played) is still a day in the feed.
 */
import type {
  PerGameBootstrap,
  PerGameLedgerEntry,
  PerGamePositionSide,
  PerGameSettledResult,
} from '../api/contracts';
import { exactMoney, moneyFine } from '../copy/terms';
import type { SettlementEquation } from '../state/perGameState';
import { currentResults, entryDay, nightTotals, summarizeValue } from './perGameMetrics';

export type ResultsFeedSource = Pick<PerGameBootstrap, 'settledResults' | 'ledger' | 'positions'>;

/**
 * Money at the precision a night's rows add up at. Below a million it is
 * `moneyFine` ("$446.5K", "$3,500"); from a million up it stays in thousands
 * with one decimal ("$1,279K") where `moneyFine` would round to the nearest
 * $10K ("$1.28M") and a night's header would stop equalling its rows.
 */
export function amountFine(value: number): string {
  const rounded = Math.round(value);
  const abs = Math.abs(rounded);
  if (abs < 999_950) return moneyFine(rounded);
  const [whole, decimal] = (Math.round(abs / 100) / 10).toFixed(1).split('.');
  return `${rounded < 0 ? '-' : ''}$${Number(whole).toLocaleString('en-US')}${decimal === '0' ? '' : `.${decimal}`}K`;
}

/** Signed `amountFine`: "+$446.5K", "-$1,215.5K", and "$0" for nothing. */
export function signedAmountFine(value: number): string {
  if (Math.round(value) === 0) return '$0';
  const text = amountFine(value);
  return text.startsWith('-') ? text : `+${text}`;
}

/**
 * True when `amountFine` shows this amount exactly: to the dollar under $10K,
 * or in whole hundreds above. A night whose amounts all pass adds up at that
 * precision; any other night is shown to the dollar (`NightSummary.exact`).
 */
export function shownExactly(value: number): boolean {
  const rounded = Math.round(value);
  return Math.abs(rounded) < 10_000 || rounded % 100 === 0;
}

export interface ResultsFeedOptions {
  /** The last settled game day. A later day can only hold moves for games still to come. */
  lastSettledDate?: string | null;
}

const FEE_KINDS: ReadonlySet<string> = new Set(['open_fee', 'drop_fee', 'fee', 'penalty']);
const MOVE_KINDS: ReadonlySet<string> = new Set(['open_fee', 'drop_fee']);

/** Ledger rows that are account activity rather than a game's cost or dividend. */
export function isFeeEntry(entry: PerGameLedgerEntry): boolean {
  return FEE_KINDS.has(entry.kind);
}

/**
 * The day a fee counts on: its game date, else the day it was booked. This
 * is perGameMetrics.entryDay itself, the rule recentEarnings uses, so a
 * night here and "Last night" everywhere else can never disagree.
 */
export function feeDay(entry: PerGameLedgerEntry): string | null {
  return entryDay(entry);
}

export interface NightSummary {
  /** The day, "2025-11-05". */
  date: string;
  /** What your players made: the day's settled games alone (nightTotals), fees apart. */
  total: number;
  /** Everything the day did to your score: `total` plus `fees`. */
  scoreChange: number;
  /** Game rows listed under the day (every status). */
  results: number;
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
  /** The day's fees, summed, and how many; `moves` of them are add or drop fees. */
  fees: number;
  feeCount: number;
  moves: number;
  /** Games whose current result is a correction. */
  corrections: number;
  /** After the last settled day: only moves for games still to come. */
  upcoming: boolean;
  /**
   * Show this day's amounts to the dollar. Set when one of them (a row's
   * net, dividend, price or fee, or the total) is not in whole hundreds, so
   * at `amountFine`'s tenth of a thousand the rows would stop adding up to
   * the total. Round nights keep the shorter form.
   */
  exact: boolean;
}

/** Every row carries its day's `exact`, so a day's amounts share one precision. */
export type ResultsFeedItem =
  | { type: 'night'; key: string; night: NightSummary }
  | { type: 'result'; key: string; date: string; exact: boolean; result: PerGameSettledResult }
  | {
      /** The fees under a day that also had games, introduced by a small heading. */
      type: 'fees';
      key: string;
      date: string;
      exact: boolean;
      count: number;
      total: number;
      /** Every fee is an add or a drop. */
      moves: boolean;
    }
  | {
      type: 'fee';
      key: string;
      date: string;
      exact: boolean;
      entry: PerGameLedgerEntry;
      side: PerGamePositionSide | null;
    };

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

/** Fees with no day at all sort after every real day, under this key. */
const NO_DAY = '';

function summarizeNight(
  date: string,
  results: readonly PerGameSettledResult[],
  fees: readonly PerGameLedgerEntry[],
  totals: ReadonlyMap<string, { net: number; games: number; wins: number; dnp: number; pending: number }>,
  lastSettledDate: string | null,
): NightSummary {
  const total = totals.get(date);
  const roster = summarizeValue(results.filter((result) => result.side === 'long'));
  const shorts = summarizeValue(results.filter((result) => result.side === 'short'));
  const feeTotal = fees.reduce((sum, entry) => sum + entry.amountDollars, 0);
  const gamesNet = total?.net ?? 0;
  const shown = [
    gamesNet,
    feeTotal,
    ...fees.map((entry) => entry.amountDollars),
    ...results.flatMap((result) => (isCounted(result)
      ? [result.netPnl ?? 0, result.dividendDollars ?? 0, result.lockedGameCost]
      : result.status === 'verified_dnp' ? [result.netPnl ?? 0] : [])),
  ];
  return {
    date,
    total: gamesNet,
    scoreChange: gamesNet + feeTotal,
    results: results.length,
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
    moves: fees.filter((entry) => MOVE_KINDS.has(entry.kind)).length,
    corrections: results.filter((result) => result.kind === 'correction').length,
    upcoming: results.length === 0 && date !== NO_DAY
      && lastSettledDate !== null && date > lastSettledDate,
    exact: !shown.every(shownExactly),
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
  const lastSettledDate = options.lastSettledDate ?? null;
  const totals = new Map(nightTotals(source.settledResults).map((night) => [night.date, night]));
  const sideOf = new Map(source.positions.map((position) => [position.positionId, position.side]));

  const resultsByDay = new Map<string, PerGameSettledResult[]>();
  for (const result of currentResults(source.settledResults)) {
    const list = resultsByDay.get(result.gameDate) ?? [];
    list.push(result);
    resultsByDay.set(result.gameDate, list);
  }
  const feesByDay = new Map<string, PerGameLedgerEntry[]>();
  for (const entry of source.ledger.items) {
    if (!isFeeEntry(entry)) continue;
    const day = feeDay(entry) ?? NO_DAY;
    const list = feesByDay.get(day) ?? [];
    list.push(entry);
    feesByDay.set(day, list);
  }

  const days = [...new Set([...resultsByDay.keys(), ...feesByDay.keys()])]
    .sort((left, right) => right.localeCompare(left));
  const items: ResultsFeedItem[] = [];
  for (const date of days) {
    const results = [...(resultsByDay.get(date) ?? [])].sort(byRowOrder);
    const fees = [...(feesByDay.get(date) ?? [])].sort(byNewestEntry);
    const night = summarizeNight(date, results, fees, totals, lastSettledDate);
    const { exact } = night;
    items.push({ type: 'night', key: `night:${date}`, night });
    for (const result of results) {
      items.push({ type: 'result', key: `result:${result.positionId}:${result.gameId}`, date, exact, result });
    }
    if (fees.length > 0) {
      items.push({
        type: 'fees',
        key: `fees:${date}`,
        date,
        exact,
        count: fees.length,
        total: night.fees,
        moves: night.moves === fees.length,
      });
    }
    for (const entry of fees) {
      items.push({ type: 'fee', key: `fee:${entry.entryId}`, date, exact, entry, side: sideOf.get(entry.positionId) ?? null });
    }
  }
  return items;
}

/** Days in the feed, newest first. */
export function feedNights(items: readonly ResultsFeedItem[]): NightSummary[] {
  return items.flatMap((item) => (item.type === 'night' ? [item.night] : []));
}

/**
 * One plain line under a day's date: "5 of 8 beat their price · 1 of 2
 * shorts paid off · 2 didn't play". A short pays off when its player stays
 * under his price, so shorts are counted apart instead of "beating" it. A day
 * with only fees says why there are no games; the fees have their own line.
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
  if (night.results === 0) {
    if (night.upcoming) parts.push('games still to come');
    else if (night.date !== NO_DAY) parts.push('none of your players played');
  }
  return parts.join(' · ');
}

/** True when what your players made is still unknown: nothing settled yet, games still waiting. */
export function nightTotalPending(night: NightSummary): boolean {
  return night.games === 0 && night.pending > 0;
}

/** The heading of a day's fees line: add and drop fees are "Roster moves". */
export function feesLineName(moves: boolean): string {
  return moves ? 'Roster moves' : 'Fees';
}

// ---------------------------------------------------------------------------
// One result row

/**
 * The two amounts a settled game compares, in the order they subtract to
 * the net: a roster spot's dividend minus his price; a short's credit (his
 * price) minus his dividend. Never "paid": that word ran backwards for shorts.
 */
export interface ValuePair {
  first: { label: string; amount: number };
  second: { label: string; amount: number };
}

export function valuePair(
  result: Pick<PerGameSettledResult, 'side' | 'lockedGameCost'>,
  dividend: number,
): ValuePair {
  return result.side === 'short'
    ? { first: { label: 'Credit', amount: result.lockedGameCost }, second: { label: 'dividend', amount: dividend } }
    : { first: { label: 'Dividend', amount: dividend }, second: { label: 'price', amount: result.lockedGameCost } };
}

/** One line of the opened math: what it was, and what it did to your score. */
export interface EffectLine {
  label: string;
  /** The effect on you, signed: + added to your score, - took from it. */
  amount: number;
}

/**
 * The settlement of one game, line by line, each by its effect on you, so no
 * line ever needs a minus sign in front of a negative number. The lines sum to
 * the net. A short turns his dividend around, and the label says so:
 *   roster: Dividend collected +$584,000 · Price charged -$137,500
 *   short:  Price credited +$112,500 · His dividend was -$320,000, which a short collects +$320,000
 */
export function settlementLines(input: {
  side: PerGamePositionSide;
  dividend: number;
  price: number;
  corrected: boolean;
}): EffectLine[] {
  const noun = input.corrected ? 'corrected dividend' : 'dividend';
  const Noun = input.corrected ? 'Corrected dividend' : 'Dividend';
  const was = `His ${noun} was ${exactMoney(input.dividend)}`;
  if (input.side === 'short') {
    const dividend: EffectLine = input.dividend > 0
      ? { label: `${was}, which a short pays`, amount: -input.dividend }
      : input.dividend < 0
        ? { label: `${was}, which a short collects`, amount: -input.dividend }
        : { label: Noun, amount: 0 };
    return [{ label: 'Price credited', amount: input.price }, dividend];
  }
  const dividend: EffectLine = input.dividend > 0
    ? { label: `${Noun} collected`, amount: input.dividend }
    : input.dividend < 0
      ? { label: `${was}, which a roster spot pays`, amount: input.dividend }
      : { label: Noun, amount: 0 };
  return [dividend, { label: 'Price charged', amount: -input.price }];
}

/**
 * What one result row shows, decided from its status and its settlement
 * equation (perGameState.settlementEquation). The screen turns this into
 * words; keeping the decisions here lets every status be unit tested.
 */
export interface ResultRowModel {
  /** The net for the number column; null means "Net profit and loss unavailable". */
  net: number | null;
  /** A settled game's arithmetic: the pair on the row, and the lines a tap opens. */
  math: {
    pair: ValuePair;
    lines: EffectLine[];
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
  const settled = result.status === 'settled'
    && result.dividendDollars !== null
    && equation.firstAmount !== null
    && equation.secondAmount !== null
    && equation.netPnl !== null;
  const math = settled && result.dividendDollars !== null && equation.netPnl !== null ? {
    pair: valuePair(result, result.dividendDollars),
    lines: settlementLines({
      side: result.side,
      dividend: result.dividendDollars,
      price: result.lockedGameCost,
      corrected: result.kind === 'correction',
    }),
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
