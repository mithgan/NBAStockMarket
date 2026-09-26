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
  moneyCompact,
  signedMoneyCompact,
} from '../copy/terms';
import type { PnlPoint } from '../state/perGameState';
import type { TagTone } from '../ui/kit';
import {
  currentResults,
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
  if (shortEndsNext(position, nextGameDate)) {
    return nextGameDate && (position.expiresOn as string) < nextGameDate
      // His term is over and he has no game in it before it ends.
      ? `Term over ${humanDate(position.expiresOn)}: it ends by itself, nothing more can change`
      : 'Ends by itself after the next games, no need to close';
  }
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

/**
 * Below this many games a player, on average, the gap between what your picks
 * are worth by last season and what they have made is mostly luck (about the
 * first six weeks: a team plays three or four games a week).
 */
export const EARLY_GAMES_EACH = 20;

export interface PickValue {
  /**
   * What the compared games would have made on last season's numbers: for
   * each game, his dividend a game last season minus the price you locked
   * (flipped for a short), added up.
   */
  byLastSeason: number;
  /** What the same games made (each game's net, added up). */
  soFar: number;
  /** Games compared: settled games of a player with a last season. */
  games: number;
  /** Every settled game your roster and shorts played, dropped and ended ones included. */
  allGames: number;
  /** Positions (a stint on the roster or a short) with a compared game. */
  players: number;
  /** Compared games a position, on average. */
  gamesEach: number;
  /**
   * "On last season's numbers, the 12 games your picks played would have
   * made +$120K. They made -$85K before fees. A few weeks is mostly luck."
   */
  text: string;
}

/**
 * Value against results, so a cold first month reads as luck and not as a
 * broken signal (walk 3 T1-N1), comparing like with like (walk 5 T1-07): the
 * games your picks have played, what they would have made on last season's
 * numbers (his dividend a game last season against the price you locked),
 * beside what those same games made. Every settled game your roster and
 * shorts played counts, dropped players and ended shorts included, so the
 * made half is the Roster, Shorts and Closed parts added up: the score before
 * fees. Dropping a loser no longer flatters it (his games stay in both
 * halves). A player with no last season (a rookie) has no expected figure: his
 * games are left out of both halves and the words say "11 of the 12 games",
 * so the base never silently changes. Null when there is nothing to compare
 * (no games yet, or no last season for anyone who played).
 *
 * `over`: the season has ended; "They made" reads right either way, so it
 * changes nothing now (kept so callers need not change).
 * `fees`: the Fees part; "before fees" is said only when fees moved the score
 * and every game is compared, so the made figure plus the fees is the score.
 */
export function pickValue(
  positions: readonly PerGamePosition[],
  lastSeasonDividend: (playerId: string) => number | null,
  results: readonly PerGameSettledResult[],
  { fees = 0 }: { over?: boolean; fees?: number } = {},
): PickValue | null {
  const sides = new Map(positions.map((position) => [position.positionId, position.side]));
  let byLastSeason = 0;
  let soFar = 0;
  let games = 0;
  let allGames = 0;
  const compared = new Set<string>();
  const playedFor = new Set<string>();
  for (const result of currentResults(results)) {
    const side = sides.get(result.positionId);
    if (!side) continue;
    if (result.status !== 'settled' || result.netPnl === null || result.dividendDollars === null) continue;
    allGames += 1;
    playedFor.add(result.positionId);
    const prior = lastSeasonDividend(result.playerId);
    if (prior === null) continue;
    const edge = prior - result.lockedGameCost;
    byLastSeason += side === 'long' ? edge : -edge;
    soFar += result.netPnl;
    games += 1;
    compared.add(result.positionId);
  }
  if (games === 0) return null;
  const players = compared.size;
  const gamesEach = games / players;
  const lesson = gamesEach < EARLY_GAMES_EACH ? 'A few weeks is mostly luck.' : 'Last season is a guide, not a promise.';
  const everyGame = games === allGames;
  const played = `your ${playedFor.size === 1 ? 'pick' : 'picks'} played`;
  const base = everyGame
    ? games === 1 ? `the 1 game ${played}` : `the ${games} games ${played}`
    : `${games} of the ${allGames} games ${played}`;
  const they = everyGame ? (games === 1 ? 'It' : 'They') : `Those ${games}`;
  const beforeFees = everyGame && Math.round(fees) !== 0 ? ' before fees' : '';
  return {
    byLastSeason,
    soFar,
    games,
    allGames,
    players,
    gamesEach,
    // Both halves are totals over the same games, in the score's own format,
    // so "They made" plus the Fees part reads as the score.
    text: `On last season's numbers, ${base} would have made ${signedMoney(byLastSeason)}. `
      + `${they} made ${signedMoney(soFar)}${beforeFees}. ${lesson}`,
  };
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

/**
 * What the season's moves were, in words (walk 5 T1-13): "4 (3 adds, 1 short)
 * · $1K in fees", "6 (3 adds, 1 short, 1 drop, 1 close) · $1.5K in fees". Each
 * fee entry is one move: an add or a short opened, a player dropped or a
 * short closed early (by the position's side); anything else is "other".
 * `fees` is the Fees part (negative), shown as what the moves cost.
 */
export function movesLine(
  ledger: readonly PerGameLedgerEntry[],
  positions: readonly Pick<PerGamePosition, 'positionId' | 'side'>[],
  fees: number,
): string {
  const sides = new Map(positions.map((position) => [position.positionId, position.side]));
  const counts = { add: 0, short: 0, drop: 0, close: 0, other: 0 };
  for (const entry of ledger) {
    if (!FEE_KINDS.has(entry.kind)) continue;
    const side = entry.positionId ? sides.get(entry.positionId) : undefined;
    if (entry.kind === 'open_fee' && side) counts[side === 'long' ? 'add' : 'short'] += 1;
    else if (entry.kind === 'drop_fee' && side) counts[side === 'long' ? 'drop' : 'close'] += 1;
    else counts.other += 1;
  }
  const total = counts.add + counts.short + counts.drop + counts.close + counts.other;
  const words: [number, string, string][] = [
    [counts.add, 'add', 'adds'],
    [counts.short, 'short', 'shorts'],
    [counts.drop, 'drop', 'drops'],
    [counts.close, 'close', 'closes'],
    [counts.other, 'other', 'other'],
  ];
  const kinds = words.filter(([count]) => count > 0).map(([count, one, many]) => `${count} ${count === 1 ? one : many}`);
  const cost = Math.round(fees) === 0 ? '' : ` · ${moneyFine(Math.abs(fees))} in fees`;
  return `${total}${kinds.length > 0 ? ` (${kinds.join(', ')})` : ''}${cost}`;
}

/** A finger that stays this close to where it landed is a tap. */
export const CHART_TAP_SLOP = 10;
/** Sideways this far, and clearly more sideways than up or down, a touch scrubs the chart. */
export const CHART_SLIDE_MIN = 6;

/**
 * What a touch on the score chart is doing so far (walk 5 T1-21): `slide`
 * once it has gone clearly sideways (scrub the nights), `scroll` once it has
 * gone up or down (the page's; it never selects a night), `wait` while it
 * has barely moved. A tap selects only when the finger lifts (`chartTouchIsTap`).
 */
export function chartTouchMove(dx: number, dy: number, sliding: boolean): 'slide' | 'scroll' | 'wait' {
  if (sliding) return 'slide';
  const across = Math.abs(dx);
  const down = Math.abs(dy);
  if (across >= CHART_SLIDE_MIN && across > down * 1.5) return 'slide';
  if (down >= CHART_SLIDE_MIN && down >= across) return 'scroll';
  return 'wait';
}

/** A touch that lifts close to where it landed, never having slid or scrolled, is a tap. */
export function chartTouchIsTap(dx: number, dy: number): boolean {
  return Math.abs(dx) <= CHART_TAP_SLOP && Math.abs(dy) <= CHART_TAP_SLOP;
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
export const WEEK_LABEL = 'Games, last 7 days';

/** A heavy display figure is about this many ems wide per character. */
const HERO_EM_PER_CHAR = 0.62;
/** The score never shrinks below this, so it stays the biggest thing on the screen. */
const HERO_MIN_SIZE = 26;

/**
 * The hero score's font size for a line `room` pixels wide: full size when it
 * fits, smaller when it would run off the edge (a phone at 200% zoom is about
 * 195px wide, and "+$139.5K" at full size did: walk 3 T3-28).
 */
export function heroFontSize(text: string, room: number, fullSize: number): number {
  const fits = Math.floor(room / (Math.max(1, text.length) * HERO_EM_PER_CHAR));
  return Math.max(HERO_MIN_SIZE, Math.min(fullSize, fits));
}

/**
 * How precisely the breakdown shows its parts. `fine` is `moneyFine` ("$552.1K",
 * "$1.05M"); `fine3` adds a digit to millions ("$1.052M"); `exact` is dollars.
 */
export type PartPrecision = 'fine' | 'fine3' | 'exact' | 'compact';

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
  if (precision === 'compact') return signed ? signedMoneyCompact(amount) : moneyCompact(amount);
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
  // High and low come from every point that is said, "now" included, so the
  // lowest is never above the score it ends on (fees after the last night).
  const said = end.kind === 'now' ? [...nights, end] : nights;
  const best = said.reduce((top, point) => (point.cumulativePnl > top.cumulativePnl ? point : top));
  const worst = said.reduce((low, point) => (point.cumulativePnl < low.cumulativePnl ? point : low));
  const span = nights.length === 1
    ? `after ${nights[0].label}`
    : `from ${nights[0].label} to ${nights.at(-1)!.label}`;
  return `Your score by night ${span}: started at $0, now ${signedMoney(end.cumulativePnl)}. `
    + `Best ${signedMoney(best.cumulativePnl)} ${best.kind === 'now' ? 'now' : `after ${best.label}`}, `
    + `lowest ${signedMoney(worst.cumulativePnl)} ${worst.kind === 'now' ? 'now' : `after ${worst.label}`}.`;
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
  /** Plot y of the value: where its line is drawn. */
  y: number;
  /**
   * Where its words are centred: at its line, or stepped just clear of a mark
   * too close to it, inside the plot (walk 4 T4-09).
   */
  labelY: number;
  kind: 'high' | 'zero' | 'low';
}

/**
 * A value mark's words on the chart's narrow left gutter: three significant
 * figures at most ("-$348K", "+$1.06M", "+$9.5K"), so a mark always fits on
 * one line. The exact figure is one tap away in the reading.
 */
export function axisMoney(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return '$0';
  const sign = rounded < 0 ? '-' : '+';
  const abs = Math.abs(rounded);
  const trim = (text: string) => text.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
  let body: string;
  if (abs >= 999_500) body = `$${trim((abs / 1_000_000).toPrecision(3))}M`;
  else if (abs >= 1_000) body = `$${trim((abs / 1_000).toPrecision(3))}K`;
  else body = `$${abs}`;
  return `${sign}${body}`;
}

/** Half a value mark's height: its words are about 14px tall. */
const MARK_HALF = 7;

/**
 * The y-axis marks: $0 always, the season's high when it is above $0 and its
 * low when it is below, so a score that ran both ways names both (walk 4
 * T4-09: a +$22.8K peak and a -$8,000 low; a -$1.56M season with a short
 * stretch above $0). Each line is drawn at its value. When marks come closer
 * than `minGap` px, $0's words stay on its line and the high's step up, the
 * low's down, just far enough to read, inside the plot (`height`). Only a
 * plot too short for three marks leaves out the extreme nearest $0.
 */
export function valueTicks(
  values: readonly number[],
  yOf: (value: number) => number,
  // Marks are about 14px tall: 18px between centres leaves clear air.
  { height = Number.POSITIVE_INFINITY, minGap = 18 }: { height?: number; minGap?: number } = {},
): ValueTick[] {
  const high = Math.max(0, ...values);
  const low = Math.min(0, ...values);
  const zero: ValueTick = { value: 0, y: yOf(0), labelY: yOf(0), kind: 'zero' };
  // An extreme that would also read "$0" is no second mark.
  const extremes: ValueTick[] = [];
  if (Math.round(high) > 0) extremes.push({ value: high, y: yOf(high), labelY: yOf(high), kind: 'high' });
  if (Math.round(low) < 0) extremes.push({ value: low, y: yOf(low), labelY: yOf(low), kind: 'low' });
  const top = MARK_HALF;
  const bottom = height - MARK_HALF;
  const clamp = (y: number) => Math.min(Math.max(y, top), Math.max(top, bottom));
  const place = (marks: ValueTick[]): ValueTick[] | null => {
    const above = marks.find((tick) => tick.kind === 'high');
    const below = marks.find((tick) => tick.kind === 'low');
    let at = clamp(zero.y);
    let up = above ? Math.min(clamp(above.y), at - minGap) : null;
    let down = below ? Math.max(clamp(below.y), at + minGap) : null;
    // Out of room at an edge: $0's words give way too.
    if (up !== null && up < top) {
      at += top - up;
      up = top;
      if (down !== null) down = Math.max(down, at + minGap);
    }
    if (down !== null && down > bottom) {
      at -= down - bottom;
      down = bottom;
      if (up !== null) up = Math.min(up, at - minGap);
    }
    if ((up !== null && up < top - 0.5) || at < top - 0.5 || at > bottom + 0.5) return null;
    return [
      ...(above && up !== null ? [{ ...above, labelY: up }] : []),
      { ...zero, labelY: at },
      ...(below && down !== null ? [{ ...below, labelY: down }] : []),
    ];
  };
  const all = place(extremes);
  if (all) return all;
  // Too short for every mark: keep the extreme farther from $0.
  const farther = [...extremes].sort((left, right) => Math.abs(right.y - zero.y) - Math.abs(left.y - zero.y));
  return place(farther.slice(0, 1)) ?? [{ ...zero, labelY: clamp(zero.y) }];
}
