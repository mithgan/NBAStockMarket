/**
 * Pure view logic for the Roster screen: the score header, the per-game row
 * figures and the night-by-night score chart.
 *
 * The screen answers one question, "how am I doing, and which of my players
 * are paying for themselves?", so everything here turns ledger rows and
 * settled results into the few words and numbers that answer it. Numbers come
 * from `perGameMetrics` so the roster agrees with every other screen.
 */
import type {
  PerGameAccount,
  PerGameLeaderboardRow,
  PerGameLedgerEntry,
  PerGamePosition,
  PerGamePositionSide,
  PerGameSettledResult,
} from '../api/contracts';
import {
  exactMoney,
  exactSignedMoney,
  humanDate,
  moneyFine,
  signedMoney,
  signedMoneyFine,
} from '../copy/terms';
import type { PnlPoint } from '../state/perGameState';
import type { TagTone } from '../ui/kit';
import {
  entryDay,
  positionValue,
  valueVerdict,
  type ScoreBreakdown,
  type ValueSummary,
  type ValueVerdict,
} from './perGameMetrics';

// ---------------------------------------------------------------------------
// Layout

/**
 * How roster rows lay out:
 *  - `table`: a wide list (desktop, tablet) with one header row;
 *  - `stacked`: a phone, name on top and the four figures on one line under a
 *    single legend per section;
 *  - `compact`: under 330 CSS px (a phone at 200% zoom) or with very large
 *    text, where four figures cannot share a line, so each row lists them.
 */
export type RowLayout = 'table' | 'stacked' | 'compact';

/** Below this window width rows reflow (a 390px phone at 200% zoom is 195px). */
export const COMPACT_MAX_WIDTH = 330;
/**
 * At or above this list width rows read as a table: below it the player
 * column would be too narrow for a name like "Gilgeous-Alexander" on one line.
 */
export const TABLE_MIN_LIST_WIDTH = 680;
/** Text enlarged past this scale reflows rows the same way a narrow window does. */
export const LARGE_TEXT_SCALE = 1.3;

export function rowLayout(listWidth: number, windowWidth: number, fontScale: number): RowLayout {
  if (fontScale > LARGE_TEXT_SCALE || windowWidth < COMPACT_MAX_WIDTH) return 'compact';
  return listWidth >= TABLE_MIN_LIST_WIDTH ? 'table' : 'stacked';
}

// ---------------------------------------------------------------------------
// Rows

/** The one-glance answer to "is he paying for himself?", as a Tag. */
export function verdictTag(verdict: ValueVerdict): { label: string; tone: TagTone } {
  switch (verdict) {
    case 'profit':
      return { label: 'Paying off', tone: 'green' };
    case 'loss':
      return { label: 'Losing money', tone: 'red' };
    case 'even':
      return { label: 'Break-even', tone: 'neutral' };
    default:
      return { label: 'No games yet', tone: 'neutral' };
  }
}

/**
 * Games behind the averages, plus the nights that did not count: "11 games",
 * "11 games · 1 DNP", "1 unsettled". Empty when there is nothing to say
 * beyond the "No games yet" tag.
 */
export function gamesLine(summary: Pick<ValueSummary, 'games' | 'dnp' | 'pending'>): string {
  const parts: string[] = [];
  if (summary.games > 0) parts.push(`${summary.games} ${summary.games === 1 ? 'game' : 'games'}`);
  if (summary.dnp > 0) parts.push(`${summary.dnp} DNP`);
  if (summary.pending > 0) parts.push(`${summary.pending} unsettled`);
  return parts.join(' · ');
}

/**
 * True when a short's next games are its last: it ends by itself once they
 * settle, so closing it now would only cost a fee.
 */
export function shortEndsNext(
  position: Pick<PerGamePosition, 'side' | 'expiresOn'>,
  nextGameDate: string | null | undefined,
): boolean {
  return position.side === 'short' && Boolean(position.expiresOn) && Boolean(nextGameDate)
    && (position.expiresOn as string) <= (nextGameDate as string);
}

/**
 * "Ends Nov 20" for a short with an end date; null otherwise. In its last
 * games: "Ends after the next games · no need to close", so nobody pays a
 * fee to close a short that is about to end for free.
 */
export function expiryLine(
  position: Pick<PerGamePosition, 'side' | 'expiresOn'>,
  nextGameDate: string | null = null,
): string | null {
  if (position.side !== 'short' || !position.expiresOn) return null;
  if (shortEndsNext(position, nextGameDate)) return 'Ends after the next games · no need to close';
  return `Ends ${humanDate(position.expiresOn)}`;
}

/** Column captions for a side: what you pay or get each game, then the result. */
export function figureCaptions(side: PerGamePosition['side']): {
  price: string;
  dividend: string;
  net: string;
  total: string;
} {
  return side === 'long'
    ? { price: 'Price a game', dividend: 'Dividend a game', net: 'Profit a game', total: 'Total' }
    : { price: 'Credit a game', dividend: 'Dividend a game', net: 'Profit a game', total: 'Total' };
}

export interface RosterRowView {
  summary: ValueSummary;
  verdict: ValueVerdict;
  tag: { label: string; tone: TagTone };
  games: string;
  expiry: string | null;
}

/** Everything one roster or short row shows, from the shared per-game metrics. */
export function rosterRowView(
  position: PerGamePosition,
  results: readonly PerGameSettledResult[],
  nextGameDate: string | null = null,
): RosterRowView {
  const summary = positionValue(results, position.positionId);
  const verdict = valueVerdict(summary);
  return {
    summary,
    verdict,
    tag: verdictTag(verdict),
    games: gamesLine(summary),
    expiry: expiryLine(position, nextGameDate),
  };
}

// ---------------------------------------------------------------------------
// Score header

/** "10 of 10 on your roster · 2 of 5 shorts". */
export function slotLine(account: Pick<PerGameAccount, 'longSlots' | 'shortSlots'>): string {
  return `${account.longSlots.used} of ${account.longSlots.limit} on your roster · `
    + `${account.shortSlots.used} of ${account.shortSlots.limit} shorts`;
}

/**
 * "#3 of 12" from the leaderboard row marked as you; "#3" when the board is
 * only a page of the standings; null when you are not on it.
 */
export function rankLine(leaderboard: readonly PerGameLeaderboardRow[] | undefined): string | null {
  const you = leaderboard?.find((row) => row.isCurrentUser);
  if (!you || !leaderboard) return null;
  return you.rank <= leaderboard.length ? `#${you.rank} of ${leaderboard.length}` : `#${you.rank}`;
}

export interface BreakdownPart {
  key: 'roster' | 'shorts' | 'closed' | 'fees' | 'other';
  label: string;
  value: number;
}

/**
 * The score by where it came from, in the order the screen lists it: your
 * roster, your shorts, closed positions, fees, and "Other" only when the
 * positions and fees do not explain the whole score.
 */
export function breakdownParts(breakdown: ScoreBreakdown): BreakdownPart[] {
  const parts: BreakdownPart[] = [
    { key: 'roster', label: 'Roster', value: breakdown.roster },
    { key: 'shorts', label: 'Shorts', value: breakdown.shorts },
    { key: 'closed', label: 'Closed', value: breakdown.closed },
    { key: 'fees', label: 'Fees', value: breakdown.fees },
  ];
  if (breakdown.other !== 0) parts.push({ key: 'other', label: 'Other', value: breakdown.other });
  return parts;
}

const FEE_KINDS = new Set(['open_fee', 'drop_fee', 'fee', 'penalty']);

/** How many fee entries the ledger holds: "12 roster moves". */
export function feeMoves(ledger: readonly PerGameLedgerEntry[]): number {
  return ledger.filter((entry) => FEE_KINDS.has(entry.kind)).length;
}

export interface ClosedRow {
  positionId: string;
  playerId: string;
  name: string;
  side: PerGamePositionSide;
  /** What the position made or lost while it was open. */
  total: number;
  games: number;
  /** "Dropped Nov 6 · last game Nov 5", "Short ended Oct 28", "Short closed Oct 26". */
  how: string;
  /** A short that ran its full term (not closed by you): it can be shorted again. */
  endedByTerm: boolean;
  /**
   * Closed before he played a game for you and nothing but fees moved: the
   * screen folds these into the Fees line instead of listing a row of zeros.
   */
  unplayed: boolean;
}

/**
 * Dropped players and ended shorts, most recently closed first. Their money
 * stays in the score, so the screen keeps listing them: without these rows the
 * roster stops adding up to the score as soon as anything closes.
 *
 * A move reads the day you made it, then his last game for you when that was
 * earlier: "Dropped Oct 23 · last game Oct 21". The day is the drop fee's day
 * (practice books fees on the day the player made the move); without a fee
 * the row falls back to the last game ("Dropped after Oct 21"). A short that
 * ran its term shows the day it ended.
 */
export function closedRows(
  positions: readonly PerGamePosition[],
  ledger: readonly PerGameLedgerEntry[],
  results: readonly PerGameSettledResult[],
): ClosedRow[] {
  const closedOn = new Map<string, string | null>();
  for (const entry of ledger) {
    if (entry.kind === 'drop_fee' && entry.positionId) closedOn.set(entry.positionId, entryDay(entry));
  }
  return positions
    .filter((position) => position.status === 'closed')
    .sort((left, right) => (right.closedEventSequence ?? 0) - (left.closedEventSequence ?? 0))
    .map((position) => {
      const value = positionValue(results, position.positionId);
      const byYou = closedOn.has(position.positionId);
      const day = closedOn.get(position.positionId) ?? null;
      const verb = position.side === 'long' ? 'Dropped' : 'Short closed';
      let how: string;
      if (position.side === 'short' && !byYou && position.expiresOn) {
        how = `Short ended ${humanDate(position.expiresOn)}`;
      } else if (day) {
        const last = value.lastDate && value.lastDate !== day ? ` · last game ${humanDate(value.lastDate)}` : '';
        how = value.lastDate ? `${verb} ${humanDate(day)}${last}` : `${verb} ${humanDate(day)} before he played`;
      } else {
        how = value.lastDate ? `${verb} after ${humanDate(value.lastDate)}` : `${verb} before he played`;
      }
      return {
        positionId: position.positionId,
        playerId: position.playerId,
        name: position.playerName,
        side: position.side,
        total: position.cumulativePnl,
        games: value.games,
        how,
        endedByTerm: position.side === 'short' && !byYou && Boolean(position.expiresOn),
        unplayed: value.games === 0 && Math.round(position.cumulativePnl) === 0,
      };
    });
}

/**
 * Label for the header's week figure, `recentEarnings().week`: what your
 * players made in the seven calendar days ending on the last settled day,
 * games only. Practice's +1 week moves the clock exactly seven days and its
 * notice reports the same games-only sum over the days that settled, so the
 * two agree to the dollar whatever the size of the roster.
 */
export const WEEK_LABEL = 'Last 7 days';

/**
 * How precisely the breakdown shows its parts. `fine` is `moneyFine` ("$552.1K",
 * "$1.05M"); `fine3` adds a digit to millions ("$1.052M"); `exact` is dollars.
 */
export type PartPrecision = 'fine' | 'fine3' | 'exact';

const PRECISIONS: PartPrecision[] = ['fine', 'fine3', 'exact'];

/** The value a reader sees once an amount is formatted at this precision. */
function shownValue(amount: number, precision: PartPrecision): number {
  const rounded = Math.round(amount);
  const abs = Math.abs(rounded);
  const sign = rounded < 0 ? -1 : 1;
  if (precision === 'exact' || abs < 10_000) return rounded;
  if (abs < 999_950) return sign * Math.round(abs / 100) * 100;
  return sign * Math.round(abs / (precision === 'fine3' ? 1_000 : 10_000)) * (precision === 'fine3' ? 1_000 : 10_000);
}

function trimZeros(value: string): string {
  return value.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

/** Format money at a breakdown precision, signed ("+$1.052M") or plain. */
export function formatAt(amount: number, precision: PartPrecision, signed: boolean): string {
  if (precision === 'exact') return signed ? exactSignedMoney(amount) : exactMoney(amount);
  const rounded = Math.round(amount);
  if (precision === 'fine3' && Math.abs(rounded) >= 999_950) {
    const text = `$${trimZeros((Math.abs(rounded) / 1_000_000).toFixed(3))}M`;
    if (rounded < 0) return `-${text}`;
    return signed ? `+${text}` : text;
  }
  return signed ? signedMoneyFine(amount) : moneyFine(amount);
}

/**
 * The least precision at which the parts, as a reader sees them, add up to
 * the score as the hero shows it. `moneyFine` rounds millions to $10K, so
 * "-$1.05M + $552.1K - $3,000" reads -$500.9K beside a "-$503K" hero; one more
 * digit ("-$1.052M") or, failing that, exact dollars makes the sum agree.
 */
export function breakdownPrecision(values: readonly number[], score: number): PartPrecision {
  const hero = signedMoney(score);
  for (const precision of PRECISIONS) {
    const sum = values.reduce((total, value) => total + shownValue(value, precision), 0);
    if (signedMoney(sum) === hero) return precision;
  }
  return 'exact';
}

// ---------------------------------------------------------------------------
// Score chart

export interface NightPoint {
  eventCursor: number;
  /** Your score right after this point. */
  cumulativePnl: number;
  /** `start` is the $0 you begin with; `now` holds fees paid since the last night. */
  kind: 'start' | 'night' | 'now';
  /** The game night, for `night` points. */
  date: string | null;
  /** "Start", "Nov 5" or "Now". */
  label: string;
  /**
   * What that night's games made, from the ledger by game date — the same
   * sum the score header calls "Last night". For `now`, the fees since.
   */
  change: number;
}

/**
 * One chart point per game night: your score after the night settled.
 *
 * `buildPnlSeries` emits one point per movement (every player's game and every
 * fee), and all of a night's games settle together, so plotting those points
 * draws swings inside a night that never happened. This keeps the last point
 * of each night instead. A correction to an earlier game lands in the night it
 * was posted, because that is when your score moved. Fees paid between nights
 * are carried into the next night; fees paid since the last night become a
 * final `now` point so the line always ends on your actual score.
 */
export function nightlySeries(
  points: readonly PnlPoint[],
  entries: readonly PerGameLedgerEntry[],
): NightPoint[] {
  const dateByCursor = new Map<number, string>();
  const changeByDate = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.gameDate) continue;
    dateByCursor.set(entry.eventCursor, entry.gameDate);
    changeByDate.set(entry.gameDate, (changeByDate.get(entry.gameDate) ?? 0) + entry.amountDollars);
  }

  const series: NightPoint[] = [{
    eventCursor: points[0]?.eventCursor ?? 0,
    cumulativePnl: 0,
    kind: 'start',
    date: null,
    label: 'Start',
    change: 0,
  }];
  let night: NightPoint | null = null;
  for (const point of points.slice(1)) {
    const date = dateByCursor.get(point.eventCursor) ?? null;
    if (date === null) continue;
    if (night === null || date > (night.date ?? '')) {
      night = {
        eventCursor: point.eventCursor,
        cumulativePnl: point.cumulativePnl,
        kind: 'night',
        date,
        label: humanDate(date),
        change: changeByDate.get(date) ?? 0,
      };
      series.push(night);
    } else {
      night.eventCursor = point.eventCursor;
      night.cumulativePnl = point.cumulativePnl;
    }
  }

  const last = points.at(-1);
  const plotted = series.at(-1)!;
  if (
    night !== null
    && last !== undefined
    && last.eventCursor > plotted.eventCursor
    && last.cumulativePnl !== plotted.cumulativePnl
  ) {
    series.push({
      eventCursor: last.eventCursor,
      cumulativePnl: last.cumulativePnl,
      kind: 'now',
      date: null,
      label: 'Now',
      change: last.cumulativePnl - plotted.cumulativePnl,
    });
  }
  return series;
}

/** True once at least one game night has been plotted. */
export function hasNights(series: readonly NightPoint[]): boolean {
  return series.some((point) => point.kind === 'night');
}

/**
 * Which points get a date under the x-axis: the first night and the last
 * night always, plus one in the middle when the plot is wide enough that the
 * three labels cannot touch. A `now` point (fees since the last night) is
 * never labelled, so a move never swaps the last date for a word.
 */
export function axisLabelIndexes(series: readonly NightPoint[], plotWidth: number): number[] {
  const first = series.findIndex((point) => point.kind === 'night');
  if (first === -1) return [];
  let last = series.length - 1;
  while (last > first && series[last].kind !== 'night') last -= 1;
  if (last === first) return [first];
  const indexes = [first, last];
  if (plotWidth >= 300 && last - first >= 4) indexes.splice(1, 0, Math.round((first + last) / 2));
  return indexes;
}

/** Nearest plotted point to a pointer x, snapping so a reading is always a real night. */
export function nearestIndex(xs: readonly number[], x: number): number | null {
  if (xs.length === 0) return null;
  let best = 0;
  for (let index = 1; index < xs.length; index += 1) {
    if (Math.abs(xs[index] - x) < Math.abs(xs[best] - x)) best = index;
  }
  return best;
}

/** One-sentence summary of the chart for screen readers. */
export function chartSummary(series: readonly NightPoint[]): string {
  const nights = series.filter((point) => point.kind === 'night');
  if (nights.length === 0) return 'Your score chart starts at $0. It fills in after your first game night.';
  const end = series.at(-1)!;
  const best = nights.reduce((top, point) => (point.cumulativePnl > top.cumulativePnl ? point : top));
  const worst = nights.reduce((low, point) => (point.cumulativePnl < low.cumulativePnl ? point : low));
  const span = nights.length === 1
    ? `after ${nights[0].label}`
    : `from ${nights[0].label} to ${nights.at(-1)!.label}`;
  return `Your score by night ${span}: started at $0, now ${signedMoney(end.cumulativePnl)}. `
    + `Best ${signedMoney(best.cumulativePnl)} after ${best.label}, `
    + `lowest ${signedMoney(worst.cumulativePnl)} after ${worst.label}.`;
}

export interface AxisLabel {
  index: number;
  /** Left edge of the label's box, in plot pixels. */
  left: number;
  align: 'left' | 'center' | 'right';
}

/**
 * Where the x-axis dates go: centred under their night, pulled inside the
 * plot at the edges, and never two boxes closer than `gap` (the most recent
 * date wins, the earlier one is dropped), so no two labels ever touch.
 */
export function placeAxisLabels(
  xs: readonly number[],
  indexes: readonly number[],
  width: number,
  boxWidth: number,
  gap = 4,
): AxisLabel[] {
  const maxLeft = Math.max(width - boxWidth, 0);
  const placed: AxisLabel[] = [];
  for (const index of [...indexes].reverse()) {
    const left = Math.min(Math.max(xs[index] - boxWidth / 2, 0), maxLeft);
    if (placed.some((label) => Math.abs(label.left - left) < boxWidth + gap)) continue;
    placed.push({ index, left, align: left <= 0 ? 'left' : left >= maxLeft ? 'right' : 'center' });
  }
  return placed.reverse();
}

export interface ValueTick {
  value: number;
  /** Plot y of the value. */
  y: number;
  kind: 'high' | 'zero' | 'low';
}

/**
 * The y-axis marks: $0 always, the season's high when it is above $0 and its
 * low when it is below. A mark that would crowd one already placed (less than
 * `minGap` px apart) is dropped; $0 is placed first, so it always stays.
 */
export function valueTicks(
  values: readonly number[],
  yOf: (value: number) => number,
  // Marks are about 14px tall: 18px between centres leaves clear air.
  minGap = 18,
): ValueTick[] {
  const high = Math.max(0, ...values);
  const low = Math.min(0, ...values);
  const candidates: ValueTick[] = [{ value: 0, y: yOf(0), kind: 'zero' }];
  if (high > 0) candidates.push({ value: high, y: yOf(high), kind: 'high' });
  if (low < 0) candidates.push({ value: low, y: yOf(low), kind: 'low' });
  const kept: ValueTick[] = [];
  for (const tick of candidates) {
    if (kept.every((other) => Math.abs(other.y - tick.y) >= minGap)) kept.push(tick);
  }
  return kept.sort((left, right) => left.y - right.y);
}
