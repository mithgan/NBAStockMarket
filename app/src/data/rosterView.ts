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
  PerGameSettledResult,
} from '../api/contracts';
import { humanDate, signedMoney } from '../copy/terms';
import type { PnlPoint } from '../state/perGameState';
import type { TagTone } from '../ui/kit';
import { positionValue, valueVerdict, type ValueSummary, type ValueVerdict } from './perGameMetrics';

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

/** "Ends Nov 20" for a short with an end date; null otherwise. */
export function expiryLine(position: Pick<PerGamePosition, 'side' | 'expiresOn'>): string | null {
  if (position.side !== 'short' || !position.expiresOn) return null;
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
    ? { price: 'Price a game', dividend: 'Dividend a game', net: 'Net a game', total: 'Total' }
    : { price: 'Credit a game', dividend: 'Dividend a game', net: 'Net a game', total: 'Total' };
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
): RosterRowView {
  const summary = positionValue(results, position.positionId);
  const verdict = valueVerdict(summary);
  return {
    summary,
    verdict,
    tag: verdictTag(verdict),
    games: gamesLine(summary),
    expiry: expiryLine(position),
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
 * point always, plus one in the middle when the plot is wide enough that the
 * three labels cannot touch.
 */
export function axisLabelIndexes(series: readonly NightPoint[], plotWidth: number): number[] {
  const first = series.findIndex((point) => point.kind === 'night');
  if (first === -1) return [];
  const last = series.length - 1;
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
