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
 * - The day's fees fold under their own "Roster moves" line with their own
 *   amount, apart from the header's games figure. A fee belongs to its game
 *   date or, for an add or drop fee, to the day it was made
 *   (perGameMetrics.entryDay).
 * - A day with fees but no games (moves made before the first games, for
 *   games still to come, or on a night none of your players played) is still
 *   a day in the feed, and reads as moves.
 * - Every amount on a row or a header is the app's one money format
 *   (copy/terms `money`); exact dollars appear only inside a row's opened math.
 */
import type {
  PerGameBootstrap,
  PerGameLedgerEntry,
  PerGamePositionSide,
  PerGameSettledResult,
  DividendBasis,
} from '../api/contracts';
import { exactMoney } from '../copy/terms';
import type { SettlementEquation } from '../state/perGameState';
import { currentResults, entryDay, nightTotals, summarizeValue } from './perGameMetrics';

export type ResultsFeedSource = Pick<PerGameBootstrap, 'settledResults' | 'ledger' | 'positions'>;

/**
 * One player's games (walk 8 T2-I4, from his profile's "See his games"): his
 * results, his fees and his positions only, so each night's header totals his
 * games alone. The default feed never passes through here.
 */
export function playerFeedSource<T extends ResultsFeedSource>(source: T, playerId: string): T {
  return {
    ...source,
    settledResults: source.settledResults.filter((result) => result.playerId === playerId),
    ledger: { ...source.ledger, items: source.ledger.items.filter((entry) => entry.playerId === playerId) },
    positions: source.positions.filter((position) => position.playerId === playerId),
  };
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
  /** No game of yours on or before this day: moves made before your first games. */
  beforeGames: boolean;
}

export type ResultsFeedItem =
  | { type: 'night'; key: string; night: NightSummary }
  | { type: 'result'; key: string; date: string; result: PerGameSettledResult }
  | {
      /** The line a day's fees fold under: "Roster moves · 8   -$2,000". */
      type: 'fees';
      key: string;
      date: string;
      count: number;
      total: number;
      /** Every fee is an add or a drop. */
      moves: boolean;
      /** Some of them opened or closed a short, so they are not all roster moves. */
      shorts: boolean;
    }
  | {
      type: 'fee';
      key: string;
      date: string;
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
  firstGameDate: string | null,
): NightSummary {
  const total = totals.get(date);
  const roster = summarizeValue(results.filter((result) => result.side === 'long'));
  const shorts = summarizeValue(results.filter((result) => result.side === 'short'));
  const feeTotal = fees.reduce((sum, entry) => sum + entry.amountDollars, 0);
  const gamesNet = total?.net ?? 0;
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
    beforeGames: results.length === 0 && (firstGameDate === null || date < firstGameDate),
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
  const gameDays = [...resultsByDay.keys()].sort();
  const firstGameDate = gameDays[0] ?? null;
  const items: ResultsFeedItem[] = [];
  for (const date of days) {
    const results = [...(resultsByDay.get(date) ?? [])].sort(byRowOrder);
    const fees = [...(feesByDay.get(date) ?? [])].sort(byNewestEntry);
    const night = summarizeNight(date, results, fees, totals, lastSettledDate, firstGameDate);
    items.push({ type: 'night', key: `night:${date}`, night });
    for (const result of results) {
      items.push({ type: 'result', key: `result:${result.positionId}:${result.gameId}`, date, result });
    }
    if (fees.length > 0) {
      items.push({
        type: 'fees',
        key: `fees:${date}`,
        date,
        count: fees.length,
        total: night.fees,
        moves: night.moves === fees.length,
        shorts: fees.some((entry) => sideOf.get(entry.positionId) === 'short'),
      });
    }
    for (const entry of fees) {
      items.push({ type: 'fee', key: `fee:${entry.entryId}`, date, entry, side: sideOf.get(entry.positionId) ?? null });
    }
  }
  return items;
}

/**
 * The feed as the screen lists it: each day's fee rows only while its
 * "Roster moves" line is open (`openDays` holds those days).
 */
export function visibleFeed(
  items: readonly ResultsFeedItem[],
  openDays: ReadonlySet<string>,
): ResultsFeedItem[] {
  return items.filter((item) => item.type !== 'fee' || openDays.has(item.date));
}

export type FeeFeedItem = Extract<ResultsFeedItem, { type: 'fee' }>;

/**
 * The feed as the list shows it: each day's moves live inside their fold,
 * as one list, rather than as loose rows between the days (walk 3 T3-32).
 */
export function foldedFeed(items: readonly ResultsFeedItem[]): ResultsFeedItem[] {
  return items.filter((item) => item.type !== 'fee');
}

/** Each day's moves, in feed order (newest first), for the list under its fold. */
export function movesByDay(items: readonly ResultsFeedItem[]): Map<string, FeeFeedItem[]> {
  const days = new Map<string, FeeFeedItem[]>();
  for (const item of items) {
    if (item.type !== 'fee') continue;
    const day = days.get(item.date) ?? [];
    day.push(item);
    days.set(item.date, day);
  }
  return days;
}

/**
 * One move as a list item reads it: the player named once, what happened,
 * then the fee: "Dyson Daniels, short opened, fee $250".
 */
export function moveWords(playerName: string, what: string, amountDollars: number, noun = 'fee'): string {
  const amount = Math.round(amountDollars);
  const money = amount < 0 ? `${noun} ${exactMoney(-amount)}` : amount > 0 ? `${noun} refunded, ${exactMoney(amount)}` : `no ${noun}`;
  return `${playerName}, ${what.charAt(0).toLowerCase()}${what.slice(1)}, ${money}`;
}

/** A month in the feed, and where its newest day starts in the list. */
export interface MonthAnchor {
  /** "2025-11". */
  key: string;
  /** "Nov" (with the year when the feed spans two of the same month). */
  label: string;
  /** "November 2025", for screen readers and tooltips. */
  name: string;
  /** Index of the month's newest day header in `items`. */
  index: number;
  /** That day, "2025-11-30". */
  date: string;
}

function monthName(key: string, style: 'short' | 'long', withYear: boolean): string {
  const date = new Date(`${key}-01T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return key;
  return new Intl.DateTimeFormat('en-US', {
    month: style,
    ...(withYear ? { year: style === 'short' ? '2-digit' : 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(date);
}

/**
 * The months a long feed can jump to, newest first like the feed itself:
 * one anchor per month, at that month's newest day header.
 */
export function monthAnchors(items: readonly ResultsFeedItem[]): MonthAnchor[] {
  const found: Array<{ key: string; index: number; date: string }> = [];
  items.forEach((item, index) => {
    if (item.type !== 'night' || !item.night.date) return;
    const key = item.night.date.slice(0, 7);
    if (!found.some((month) => month.key === key)) found.push({ key, index, date: item.night.date });
  });
  const shortNames = found.map((month) => monthName(month.key, 'short', false));
  const repeats = new Set(shortNames.filter((name, index) => shortNames.indexOf(name) !== index));
  return found.map((month, index) => ({
    ...month,
    label: repeats.has(shortNames[index]) ? monthName(month.key, 'short', true) : shortNames[index],
    name: monthName(month.key, 'long', true),
  }));
}

/**
 * The month "Jump to" marks as the one you are reading, on every screen size
 * (walk 7 T1-07: phones marked none). It is the month at the top of the
 * feed; until the list has said what is on screen (first paint, a new
 * season's feed) you are at the top, so the newest month. Null without months.
 */
export function readingMonth(anchors: readonly MonthAnchor[], onScreen: string | null): string | null {
  if (onScreen && anchors.some((anchor) => anchor.key === onScreen)) return onScreen;
  return anchors[0]?.key ?? null;
}

/** Days in the feed, newest first. */
export function feedNights(items: readonly ResultsFeedItem[]): NightSummary[] {
  return items.flatMap((item) => (item.type === 'night' ? [item.night] : []));
}

/**
 * The facts under a day's date, one phrase each: "5 of 8 beat their price",
 * "1 of 2 shorts paid off", "2 didn't play". A short pays off when its player
 * stays under his price, so shorts are counted apart instead of "beating" it.
 * A day with only fees says why there are no games, except before your first
 * games, where the moves speak for themselves.
 */
export function nightSummaryParts(night: NightSummary): string[] {
  const parts: string[] = [];
  // One game that night (one player held, or one player's games shown):
  // "Beat his price", never "1 of 1 beat their price".
  const single = night.rosterGames + night.shortGames + night.pending + night.dnp === 1;
  if (night.rosterGames > 0) {
    parts.push(single
      ? night.rosterWins > 0 ? 'Beat his price' : "Didn't beat his price"
      : `${night.rosterWins} of ${night.rosterGames} beat their price`);
  }
  if (night.shortGames > 0) {
    parts.push(single
      ? night.shortWins > 0 ? 'The short paid off' : "The short didn't pay off"
      : `${night.shortWins} of ${night.shortGames} ${night.shortGames === 1 ? 'short' : 'shorts'} paid off`);
  }
  if (night.pending > 0) parts.push(`${night.pending} waiting on stats`);
  if (night.dnp > 0) parts.push(`${night.dnp} didn't play`);
  if (night.corrections > 0) parts.push(`${night.corrections} corrected`);
  if (night.results === 0) {
    if (night.upcoming) parts.push('games still to come');
    else if (night.date !== NO_DAY && !night.beforeGames) parts.push('none of your players played');
  }
  return parts;
}

/** The facts as one line: "5 of 8 beat their price · 1 of 2 shorts paid off". */
export function nightSummaryLine(night: NightSummary): string {
  return nightSummaryParts(night).join(' · ');
}

/**
 * The same line for the screen: each phrase kept whole (no-break spaces), so
 * a narrow header wraps between phrases and never leaves "off" on a line of
 * its own. The separator stays with the phrase before it.
 */
export function nightSummaryWrapped(night: NightSummary): string {
  const parts = nightSummaryParts(night).map((part) => part.replace(/ /g, '\u00a0'));
  return parts.map((part, index) => (index < parts.length - 1 ? `${part}\u00a0·` : part)).join(' ');
}

/** True when what your players made is still unknown: nothing settled yet, games still waiting. */
export function nightTotalPending(night: NightSummary): boolean {
  return night.games === 0 && night.pending > 0;
}

/**
 * The heading of a day's fees line: add and drop fees are "Roster moves", or
 * just "Moves" once a short is among them (a short is not on your roster).
 */
export function feesLineName(moves: boolean, shorts = false): string {
  if (!moves) return 'Fees';
  return shorts ? 'Moves' : 'Roster moves';
}

// ---------------------------------------------------------------------------
// One result row

/**
 * The two amounts a settled game compares, in one column order on every row:
 * his price (a roster spot is charged it, a short is credited it), then his
 * dividend, then the profit. The SHORT tag says which way the sign runs.
 * Never "paid": that word ran backwards for shorts.
 */
export interface ValuePair {
  first: { label: string; amount: number };
  second: { label: string; amount: number };
}

export function valuePair(
  result: Pick<PerGameSettledResult, 'side' | 'lockedGameCost'>,
  dividend: number,
): ValuePair {
  return {
    first: { label: result.side === 'short' ? 'Credit' : 'Price', amount: result.lockedGameCost },
    second: { label: 'dividend', amount: dividend },
  };
}

/** Net points shown to one decimal, or two when one would not multiply back to the dividend. */
function pointsText(points: number, rate: number, dividend: number): string | null {
  for (const digits of [1, 2]) {
    const shown = Number(points.toFixed(digits));
    if (Math.abs(shown * rate - dividend) < 1) return shown.toFixed(digits);
  }
  return null;
}

/**
 * Where a dividend came from: "7.4 net points × $40,000 = $296,000". Null
 * when the rate is unknown or the figures would not multiply back exactly
 * (a line that does not add up is worse than none).
 */
export function dividendBasisLine(input: {
  dividend: number;
  rate: number;
  basis: DividendBasis;
}): string | null {
  const { dividend, rate, basis } = input;
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(dividend)) return null;
  const points = pointsText(dividend / rate, rate, dividend);
  if (points === null) return null;
  const what = basis === 'surprise_vs_projection' ? 'net points over his projection' : 'net points';
  // No-break spaces keep "× $40,000" and "= $296,000" whole when the line wraps.
  return `${points} ${what} ×\u00a0${exactMoney(rate)} =\u00a0${exactMoney(dividend)}`;
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
 * the profit, in the row's column order (price first, then dividend). A
 * short turns his dividend around, and the label says so. A dividend below
 * zero is told as plain money that changed hands, never as a minus sign the
 * reader has to work out (walk 4 T2-09):
 *   roster: Price charged -$137,500 · Dividend collected +$584,000
 *   roster: Price charged -$176,000 · Bad game: his dividend was below zero, so you also paid $128,000 -$128,000
 *   short:  Price credited +$112,500 · His dividend was $328,000, which a short pays -$328,000
 *   short:  Price credited +$112,500 · Bad game: his dividend was below zero, so your short also collected $320,000 +$320,000
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
  const below = `Bad game: his ${noun} was below zero`;
  const size = exactMoney(Math.abs(input.dividend));
  if (input.side === 'short') {
    const dividend: EffectLine = input.dividend > 0
      ? { label: `${was}, which a short pays`, amount: -input.dividend }
      : input.dividend < 0
        ? { label: `${below}, so your short also collected ${size}`, amount: -input.dividend }
        : { label: Noun, amount: 0 };
    return [{ label: 'Price credited', amount: input.price }, dividend];
  }
  const dividend: EffectLine = input.dividend > 0
    ? { label: `${Noun} collected`, amount: input.dividend }
    : input.dividend < 0
      ? { label: `${below}, so you also paid ${size}`, amount: input.dividend }
      : { label: Noun, amount: 0 };
  return [{ label: 'Price charged', amount: -input.price }, dividend];
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

/**
 * How far to scroll the feed once a row opens, so its whole math shows (walk
 * 6 T2-07: opened near the bottom, only its first line was on screen).
 * Nothing when it already fits; otherwise just enough to bring the row's
 * bottom into view with a small margin, and never so far that the row's own
 * top leaves the view (a row taller than the view lines its top up instead).
 * Positions are screen pixels (top < bottom).
 *
 * `mathTop` is where the opened math starts (the row's headline ends there).
 * In a view too short to hold the headline and as much again of the math
 * (400% zoom: an 81px headline fills a 74px feed), the headline gives way and
 * the math's first line comes to the top of what is visible (walk 8 T3-14:
 * Enter changed nothing but the chevron, the math sat below the view).
 */
export function revealScroll({ rowTop, rowBottom, mathTop = rowTop, viewTop, viewBottom, margin = 12 }: {
  rowTop: number;
  rowBottom: number;
  mathTop?: number;
  viewTop: number;
  viewBottom: number;
  margin?: number;
}): number {
  const below = rowBottom + margin - viewBottom;
  if (below <= 0) return 0;
  const headline = Math.max(0, mathTop - rowTop);
  if (headline + margin > (viewBottom - viewTop) / 2) {
    return Math.max(0, Math.round(Math.min(below, mathTop - viewTop)));
  }
  const room = rowTop - viewTop - margin;
  return Math.max(0, Math.round(Math.min(below, room)));
}

/**
 * Closing a row whose headline has scrolled above the view (it gave way to
 * the math at 400% zoom): scroll back up so the headline you just pressed is
 * at the top again, not the next row. Negative is up; 0 when it shows.
 */
export function closeScroll({ rowTop, viewTop }: { rowTop: number; viewTop: number }): number {
  return rowTop < viewTop - 0.5 ? Math.round(rowTop - viewTop) : 0;
}
