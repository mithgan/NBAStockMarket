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
  humanDay,
  humanDaySpan,
  moneyFine,
  signedMoney,
  signedMoneyFine,
  moneyCompact,
  ordinalWords,
  signedMoneyCompact,
  spokenRanks,
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

/**
 * The one-glance answer to "is he paying for himself?", as a Tag. Once the
 * season is over (`over`) it reads in the past tense, "Paid off" / "Lost
 * money" (walk 6 T1-10c): nothing is still happening.
 */
export function verdictTag(verdict: ValueVerdict, over = false): { label: string; tone: TagTone } {
  switch (verdict) {
    case 'profit':
      return { label: over ? 'Paid off' : 'Paying off', tone: 'green' };
    case 'loss':
      return { label: over ? 'Lost money' : 'Losing money', tone: 'red' };
    case 'even':
      return { label: over ? 'Broke even' : 'Break-even', tone: 'neutral' };
    default:
      return { label: over ? 'No games' : 'No games yet', tone: 'neutral' };
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

/**
 * One line on a row whose dividend a game is below zero, where the figure
 * shows (walk 8 T1-01): everything before the first night says a dividend is
 * money you collect, so "-$56K" beside a -$315K profit read as a mistake. A
 * roster spot pays a below-zero dividend on top of his price; a short, which
 * is credited his price and pays his dividend, keeps his price and gets it back.
 * Null when there is nothing to explain.
 */
export function belowZeroNote(
  side: PerGamePositionSide,
  summary: Pick<ValueSummary, 'games' | 'avgDividend'>,
): string | null {
  const { games, avgDividend } = summary;
  if (avgDividend === null || games <= 0 || Math.round(avgDividend) >= 0) return null;
  const more = moneyCompact(-avgDividend);
  const one = games === 1;
  if (side === 'long') {
    return one
      ? `Bad night: below zero, so you paid his price and ${more} more.`
      : `Bad games: below zero on average, so you paid his price and ${more} more a game.`;
  }
  return one
    ? `Bad night for him: below zero, so you kept his price and ${more} more.`
    : `Bad games for him: below zero on average, so you kept his price and ${more} more a game.`;
}

/** The welcome's word on a bad game, right after it says what a dividend is (walk 8 T1-01). */
export const BELOW_ZERO_WELCOME = 'A bad game can push his dividend below zero, and you pay that too.';

/**
 * Which side the first-night tip speaks to (walk 8 T4-10): a player who has
 * only ever shorted gets the short's reading of PAYING OFF, not the roster's,
 * which is backwards for a short.
 */
export function tipSide(positions: readonly Pick<PerGamePosition, 'side'>[]): PerGamePositionSide {
  const longs = positions.some((position) => position.side === 'long');
  return !longs && positions.some((position) => position.side === 'short') ? 'short' : 'long';
}

/** The tag the first-night tip explains (`tipVerdict`). */
export type TipVerdict = 'profit' | 'loss';

/**
 * The tag the first-night tip explains: the one on screen (walk 9 T1-14).
 * PAYING OFF while any open row on the tip's side shows it; LOSING MONEY when
 * none does and one shows that, so a shorts-only player whose short lost is
 * told what his red tag means, not what a green one would.
 */
export function tipVerdict(
  positions: readonly PerGamePosition[],
  results: readonly PerGameSettledResult[],
  side: PerGamePositionSide,
): TipVerdict {
  const verdicts = positions
    .filter((position) => position.status === 'active' && position.side === side)
    .map((position) => valueVerdict(positionValue(results, position.positionId)));
  if (verdicts.includes('profit')) return 'profit';
  return verdicts.includes('loss') ? 'loss' : 'profit';
}

/** The first-night tip's tag, as the rows draw it. */
export function tipTag(verdict: TipVerdict): string {
  return verdict === 'loss' ? 'LOSING MONEY' : 'PAYING OFF';
}

/** The first-night tip's words after its tag, for the side it speaks to and the tag on screen. */
export function tipWords(side: PerGamePositionSide, verdict: TipVerdict = 'profit'): string {
  const results = " Results shows each game's math.";
  if (side === 'short') {
    return verdict === 'loss'
      // Why a short loses when he plays well, in the tip's slim band.
      ? ` on a short means he played well: his dividends beat his price so far.${results}`
      : ` on a short means his dividends came in under his price so far.${results}`;
  }
  return verdict === 'loss'
    ? ` means his dividends came in under your price so far.${results}`
    : ` means his dividends beat your price so far.${results}`;
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
  over = false,
): RosterRowView {
  const summary = positionValue(results, position.positionId);
  const verdict = valueVerdict(summary);
  return {
    summary,
    verdict,
    tag: verdictTag(verdict, over),
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

/** After this many days of games (about a month) the value line drops its luck caution. */
export const LUCK_MAX_DAYS = 31;

/** The systematic part of the gap, said plainly (walk 6 T2-16): prices sit below last season's dividends. */
export const LAST_SEASON_TRUTH = 'Players usually pay out less than last season; beating their price is what scores.';

/**
 * When the games made more than last season's numbers, the caution above
 * would explain a gap that is not there (walk 7 T4-12), so the line says what
 * happened instead.
 */
export const LAST_SEASON_BEATEN = "Your picks did better than last season's numbers suggested.";

function dayIndex(isoDate: string): number {
  return Math.round(Date.parse(`${isoDate.slice(0, 10)}T00:00:00Z`) / 86_400_000);
}

/**
 * A short sample's caution, scaled to what was played (walk 6 T1-05): "One
 * night is mostly luck." after one night, "A few nights…" inside a week, "One
 * week…", then "A few weeks…", and nothing after about a month.
 */
export function luckLine(gameDates: readonly string[]): string | null {
  const nights = [...new Set(gameDates.map((date) => date.slice(0, 10)))].sort();
  if (nights.length === 0) return null;
  if (nights.length === 1) return 'One night is mostly luck.';
  const days = dayIndex(nights.at(-1)!) - dayIndex(nights[0]) + 1;
  if (days < 7) return 'A few nights is mostly luck.';
  if (days <= 8) return 'One week is mostly luck.';
  if (days <= LUCK_MAX_DAYS) return 'A few weeks is mostly luck.';
  return null;
}

/** "Kon Knueppel", "Kon Knueppel and Cooper Flagg", "3 players". */
function whoPlayed(names: readonly string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.length} players`;
}

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
  /** What the games left out (players with no last season) made. */
  leftOut: number;
  /**
   * "On last season's numbers, the 12 games your picks played would have
   * made +$120K. They made -$85K before fees. Players usually pay out less
   * than last season; beating their price is what scores. A few weeks is
   * mostly luck."
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
 * The gap is mostly not luck (walk 6 T2-16, T1-05, T4-04): a player's price
 * sits between his worth and last season's dividend, and players usually pay
 * out less than last season, so the line says that plainly. A luck caution
 * stays only while the sample is small, scaled to the nights played
 * (`luckLine`), and the games left out are named with what they made
 * ("82 games by Kon Knueppel (no last season) are left out: -$1.85M."), so
 * the made figures square with the score.
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
  const names = new Map(positions.map((position) => [position.playerId, position.playerName]));
  let byLastSeason = 0;
  let soFar = 0;
  let leftOut = 0;
  let games = 0;
  let allGames = 0;
  const compared = new Set<string>();
  const playedFor = new Set<string>();
  const dates: string[] = [];
  // Players with no last season, in the order they first played for you.
  const unrated: string[] = [];
  for (const result of currentResults(results)) {
    const side = sides.get(result.positionId);
    if (!side) continue;
    if (result.status !== 'settled' || result.netPnl === null || result.dividendDollars === null) continue;
    allGames += 1;
    playedFor.add(result.positionId);
    if (result.gameDate) dates.push(result.gameDate);
    const prior = lastSeasonDividend(result.playerId);
    if (prior === null) {
      leftOut += result.netPnl;
      if (!unrated.includes(result.playerId)) unrated.push(result.playerId);
      continue;
    }
    const edge = prior - result.lockedGameCost;
    byLastSeason += side === 'long' ? edge : -edge;
    soFar += result.netPnl;
    games += 1;
    compared.add(result.positionId);
  }
  if (games === 0) return null;
  const players = compared.size;
  const gamesEach = games / players;
  const everyGame = games === allGames;
  const played = `your ${playedFor.size === 1 ? 'pick' : 'picks'} played`;
  const base = everyGame
    ? games === 1 ? `the 1 game ${played}` : `the ${games} games ${played}`
    : `${games} of the ${allGames} games ${played}`;
  const they = everyGame ? (games === 1 ? 'It' : 'They') : games === 1 ? 'That game' : `Those ${games}`;
  const beforeFees = everyGame && Math.round(fees) !== 0 ? ' before fees' : '';
  const skipped = allGames - games;
  const left = everyGame ? null
    : `${skipped} ${skipped === 1 ? 'game' : 'games'} by ${whoPlayed(unrated.map((id) => names.get(id) ?? 'a player'))} `
      + `(no last season) ${skipped === 1 ? 'is' : 'are'} left out: ${signedMoney(leftOut)}.`;
  return {
    byLastSeason,
    soFar,
    games,
    allGames,
    players,
    gamesEach,
    leftOut,
    // Both halves are totals over the same games, in the score's own format,
    // so "They made" (plus the games left out) and the Fees part read as the score.
    text: twoDecimalMillions([
      `On last season's numbers, ${base} would have made ${signedMoney(byLastSeason)}.`,
      `${they} made ${signedMoney(soFar)}${beforeFees}.`,
      left,
      // "Pay out less" only where it explains the gap (walk 7 T4-12).
      Math.round(soFar) > Math.round(byLastSeason) ? LAST_SEASON_BEATEN : LAST_SEASON_TRUTH,
      luckLine(dates),
    ].filter(Boolean).join(' ')),
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
 * Never end a wrapped line on a lone "·" (walk 7 T1-12): each dot holds on to
 * the words after it, so a narrow row breaks before the dot, not after it.
 */
export function holdDots(text: string): string {
  return text.replace(/ \u00b7 /g, ' \u00b7\u00a0');
}

/** "Derrick White", "Derrick White and Jalen Duren", "A, B and C", "A, B and 3 more". */
export function namesList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/**
 * Names in the order they first came, a repeated one named once with how
 * many times (walk 9 T4-09): "Luka Doncic ×3", never "Luka Doncic, Luka
 * Doncic and Luka Doncic". The count holds on to the name.
 */
export function countedNames(names: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(([name, count]) => (count > 1 ? `${name}\u00a0\u00d7${count}` : name));
}

/** The words as a screen reader should say them: "Luka Doncic ×3" is "Luka Doncic 3 times". */
export function spokenRepeats(text: string): string {
  return text.replace(/\u00a0\u00d7(\d+)/g, ' $1 times');
}

/**
 * Where a player from Closed is now, when he is on a list again (walk 9
 * T4-N2), keyed by his latest shown Closed row: "Back on your roster since
 * Oct 22". The day is his new move's fee day; without a fee it is left out.
 */
export function backLines(
  rows: readonly ClosedRow[],
  positions: readonly PerGamePosition[],
  ledger: readonly PerGameLedgerEntry[],
): Map<string, string> {
  const openedOn = new Map<string, string | null>();
  for (const entry of ledger) {
    if (entry.kind === 'open_fee' && entry.positionId && !openedOn.has(entry.positionId)) {
      openedOn.set(entry.positionId, entryDay(entry));
    }
  }
  const lines = new Map<string, string>();
  const seen = new Set<string>();
  // Rows come most recent first; a row folded into the Fees line is not shown.
  for (const row of rows) {
    if (row.unplayed || seen.has(row.playerId)) continue;
    seen.add(row.playerId);
    const now = positions.find((position) => position.status === 'active' && position.playerId === row.playerId);
    if (!now) continue;
    const day = openedOn.get(now.positionId);
    const again = now.side === row.side;
    const where = now.side === 'long'
      ? again ? 'Back on your roster' : 'On your roster'
      : again ? 'Back in your shorts' : 'In your shorts';
    lines.set(row.positionId, day ? `${where} since ${humanDate(day)}` : where);
  }
  return lines;
}

/**
 * The Fees line's words: the moves, the fee each, and who was dropped or
 * whose short was closed before playing, by name, so every paid move can be
 * traced on the Roster (walk 7 T2-18): "13 moves · $250 each · 1 dropped
 * before playing (Derrick White)".
 */
export function feesDetail({ moves, feeEach, dropped, closedShorts }: {
  moves: number;
  feeEach: number;
  /** Players dropped before they played a game for you. */
  dropped: readonly string[];
  /** Shorts closed before he played. */
  closedShorts: readonly string[];
}): string {
  return [
    `${moves} ${moves === 1 ? 'move' : 'moves'}`,
    feeEach > 0 ? `${exactMoney(feeEach)} each` : null,
    dropped.length > 0 ? `${dropped.length} dropped before playing (${namesList(countedNames(dropped))})` : null,
    closedShorts.length > 0
      ? `${closedShorts.length} ${closedShorts.length === 1 ? 'short' : 'shorts'} closed before playing (${namesList(countedNames(closedShorts))})`
      : null,
  ].filter(Boolean).join(' \u00b7 ');
}

/**
 * Label for the header's week figure, `recentEarnings().week`: what your
 * players made in the seven calendar days ending on the last settled day,
 * games only. Practice's +1 week moves the clock exactly seven days and its
 * notice reports the same games-only sum over the days that settled, so the
 * two agree to the dollar whatever the size of the roster.
 */
export const WEEK_LABEL = 'Games, last 7 days';

/**
 * The week figure's label in the days it covers (walk 7 T1-13, T3-14), the
 * way the notices and the status row name games: "Oct 21 games" after the
 * first night, "Oct 22–28 games" once a week has gone by. The seven calendar
 * days end on the last settled day (`recentEarnings`) and start no earlier
 * than your first game night, so the words never promise days you had no
 * players in. `spoken` reads the dash as "to". WEEK_LABEL without dates.
 */
export function weekLabel(
  firstGameDate: string | null | undefined,
  lastSettledDate: string | null | undefined,
): { label: string; spoken: string } {
  if (!lastSettledDate) return { label: WEEK_LABEL, spoken: WEEK_LABEL.toLowerCase() };
  const last = lastSettledDate.slice(0, 10);
  const weekStart = new Date((dayIndex(last) - 6) * 86_400_000).toISOString().slice(0, 10);
  const first = firstGameDate && firstGameDate.slice(0, 10) > weekStart ? firstGameDate.slice(0, 10) : weekStart;
  const label = `${humanDaySpan(first <= last ? first : last, last)} games`;
  return { label, spoken: label.replace('\u2013', ' to ') };
}

/**
 * The score block's recent line: the games your last press played (a night,
 * a week or a run of presses), in the words and at the figure the status row
 * and the notice give them ("Oct 30 games -$40.5K", "Oct 28\u2013Nov 10 games
 * +$96K"). A rolling seven days beside the status row read as a second
 * answer to "how did the games I just played go?", even in the other sign
 * (walk 8 T2-01). `span` is chromeView.resultSpan's; `amount` the games-only
 * sum over it. `spoken` reads the dash as "to".
 */
export function pressLine(
  span: { label: string } | null | undefined,
  amount: number | null | undefined,
): { label: string; spoken: string; value: number } | null {
  if (!span || amount === null || amount === undefined) return null;
  const label = `${span.label} games`;
  return { label, spoken: label.replace('\u2013', ' to '), value: amount };
}

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

/**
 * One precision for millions on the Roster (walk 7 T4-14): always two
 * decimals, so "+$1.60M" sits beside "+$1.61M" (not "+$1.6M", which looked
 * $10K away) and "-$28.64M" beside "-$9.85M". K and dollar amounts are left
 * as they are.
 */
export function twoDecimalMillions(text: string): string {
  return text.replace(/\$(\d+)(?:\.(\d))?M\b/g, (_, whole: string, tenth: string | undefined) => `$${whole}.${(tenth ?? '').padEnd(2, '0')}M`);
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
  return twoDecimalMillions(signed ? signedMoneyFine(amount) : moneyFine(amount));
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

/** The step `moneyFine` rounds an amount to: $1 under $1K, $10 under $10K, $100 in K, $10K in M. */
export function fineStep(amount: number): number {
  const abs = Math.abs(Math.round(amount));
  if (abs < 1_000) return 1;
  if (abs < 9_995) return 10;
  if (abs < 999_950) return 100;
  return 10_000;
}

/** An amount as `moneyFine` shows it, back in dollars: 148,449 reads "$148.4K", so 148,400. */
export function fineValue(amount: number): number {
  const match = /^(-?)\$([\d.]+)([KM]?)$/.exec(moneyFine(amount));
  if (!match) return Math.round(amount);
  const scale = match[3] === 'M' ? 1_000_000 : match[3] === 'K' ? 1_000 : 1;
  return (match[1] ? -1 : 1) * Math.round(Number(match[2]) * scale);
}

/**
 * The score's parts as the screen shows them (walk 6 T2-08, T4-09, T3-12):
 * every part in the app's one money format (`moneyFine`: K from $1,000, two
 * decimals in millions), the same as the score above them, never exact
 * dollars and never a third decimal. When the parts, rounded each on its own,
 * would not add up to the score as shown (to within half its last digit),
 * the parts nearest a rounding edge round the other way (largest remainder),
 * each by one step at most and never away from $0 or across it; an amount
 * the format already shows exactly (fees under $10K) never moves. Returns each part's shown value, which
 * the section totals repeat, so a part and its list's total read alike.
 */
export function shownParts<T extends { value: number }>(parts: readonly T[], score: number): T[] {
  const natural = parts.map((part) => fineValue(part.value));
  const hero = fineValue(score);
  const tolerance = fineStep(score) / 2;
  const shown = [...natural];
  const gap = () => hero - shown.reduce((sum, value) => sum + value, 0);
  const moved = new Set<number>();
  while (Math.abs(gap()) > tolerance) {
    const need = gap();
    const direction = Math.sign(need);
    let best = -1;
    let bestMiss = Number.POSITIVE_INFINITY;
    parts.forEach((part, index) => {
      if (moved.has(index)) return;
      const value = Math.round(part.value);
      const step = fineStep(value);
      const next = shown[index] + direction * step;
      const miss = Math.abs(next - value);
      // The other rounding of the same amount only, never its sign or $0.
      if (value === 0 || shown[index] === value || miss >= step || Math.sign(next) !== Math.sign(value)) return;
      // Only a step that brings the sum closer to the score.
      if (Math.abs(need - direction * step) >= Math.abs(need)) return;
      if (miss < bestMiss) {
        best = index;
        bestMiss = miss;
      }
    });
    if (best < 0) return parts.map((part, index) => ({ ...part, value: natural[index] }));
    shown[best] += direction * fineStep(parts[best].value);
    moved.add(best);
  }
  return parts.map((part, index) => ({ ...part, value: shown[index] }));
}

/**
 * The season card's exact final score, when rounding hides a part (walk 6
 * T1-10: "+$4.13M" final beside "Roster +$4.13M" and "Fees -$750", so the
 * fees seemed to vanish): "Exactly +$4,129,750, fees -$750 included." Null
 * when every part visibly moves the score.
 */
export function exactFinalLine(parts: readonly BreakdownPart[], score: number): string | null {
  const half = fineStep(score) / 2;
  const hidden = parts.filter((part) => Math.round(part.value) !== 0 && Math.abs(part.value) < half);
  if (hidden.length === 0) return null;
  const named = hidden.map((part) => `${part.label.toLowerCase()} ${signedMoney(part.value)}`);
  return `Exactly ${exactSignedMoney(score)}, ${named.join(' and ')} included.`;
}

// ---------------------------------------------------------------------------
// Season card, welcome and first-night tip

// Places in words, shared with Leaders and the notices (copy/terms).
export { ordinalWords, spokenRanks };

/**
 * The season card's one spoken summary (walk 6 T3-07), in the Leaders style
 * ("First of 5, your score +$453.8K, $113.5K ahead of second place"): places
 * in words, money as the screen writes it. "Final score +$4.95M, first of 5.
 * Roster +$4.95M, shorts $0, closed $0, fees -$500." The score leads, as it
 * does on the card. `place` is the drawn "#1 of 5"; `parts` are the shown
 * parts, so the words match the figures.
 */
export function finalSummary(
  score: number,
  place: string | null,
  parts: readonly BreakdownPart[] | null,
): string {
  const head = `Final score ${formatAt(score, 'fine', true)}${place ? `, ${spokenRanks(place)}` : ''}.`;
  if (!parts || parts.length === 0) return head;
  const split = parts.map((part, index) => `${index === 0 ? part.label : part.label.toLowerCase()} ${formatAt(part.value, 'fine', true)}`);
  return `${head} ${split.join(', ')}.`;
}

/**
 * What a player earns, in one plain line for the welcome (walk 6 T1-02), each
 * word said before it is used (walk 7 T1-03): "Each game a player plays, you
 * pay his price and collect his dividend: $40K for every net point, his box
 * score in one number."
 */
export function earnLine(dollarsPerNetPoint: number | null | undefined): string {
  const rate = dollarsPerNetPoint && dollarsPerNetPoint > 0
    ? `: ${moneyCompact(dollarsPerNetPoint)} for every net point, his box score in one number`
    : ', his box score in money';
  return `Each game a player plays, you pay his price and collect his dividend${rate}.`;
}

/** The first-night tip stays up to a week of game nights (walk 6 T1-17). */
export const TIP_DAYS = 7;

/**
 * Whether the first-night tip is done (walk 6 T1-17): once its Results button
 * has been used, or once the season's first week of game nights is over
 * (`firstGameDate`: the first night your players played). × still hides it
 * early.
 */
export function tipRetired(firstGameDate: string | null, lastSettledDate: string | null, usedResults: boolean): boolean {
  if (usedResults) return true;
  if (!firstGameDate || !lastSettledDate) return false;
  return dayIndex(lastSettledDate) - dayIndex(firstGameDate) >= TIP_DAYS;
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
  return twoDecimalMillions(`Your score by night ${span}: started at $0, now ${signedMoney(end.cumulativePnl)}. `
    + `Best ${signedMoney(best.cumulativePnl)} ${best.kind === 'now' ? 'now' : `after ${best.label}`}, `
    + `lowest ${signedMoney(worst.cumulativePnl)} ${worst.kind === 'now' ? 'now' : `after ${worst.label}`}.`);
}

/**
 * A reading's parts, labels first: what the night's games made, any fees
 * paid since the night before (they come off the score between nights), and
 * the score after. A `now` point is the fees paid since the last night.
 */
export function nightReadingParts(point: NightPoint, previous: NightPoint | undefined): { when: string; fees: number } {
  const when = point.kind === 'night' && point.date ? humanDay(point.date) : `After ${previous?.label ?? 'the last night'}`;
  const fees = point.kind === 'night' && previous
    ? Math.round(point.cumulativePnl - previous.cumulativePnl - point.change)
    : 0;
  return { when, fees };
}

/** "Wed, Oct 29: that night +$12K, fees -$250, score +$40K", for the slider value. */
export function nightReadingText(point: NightPoint, previous: NightPoint | undefined): string {
  const fine = (amount: number) => formatAt(amount, 'fine', true);
  if (point.kind === 'start') return 'Start: everyone begins at $0';
  const { when, fees } = nightReadingParts(point, previous);
  if (point.kind !== 'night') return `${when}: fees ${fine(point.change)}, score ${fine(point.cumulativePnl)}`;
  const feeText = fees !== 0 ? `, fees ${fine(fees)}` : '';
  return `${when}: that night ${fine(point.change)}${feeText}, score ${fine(point.cumulativePnl)}`;
}

/**
 * The score chart's value for screen readers: the selected night's reading,
 * else the last night's, never empty, so the slider reads as a night, not
 * "slider, 6", before anyone focuses it (walk 8 T3-03).
 */
export function chartValueText(series: readonly NightPoint[], selected: number | null): string {
  if (series.length === 0) return 'Start: everyone begins at $0';
  const index = selected !== null && selected >= 0 && selected < series.length ? selected : series.length - 1;
  return nightReadingText(series[index], series[index - 1]);
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

/**
 * A value mark as drawn: millions in the Roster's one precision (two
 * decimals, so the chart's "+$1.60M" matches the score above it; walk 7
 * T4-14), smaller amounts as `axisMoney` ("-$334K"). The gutter is sized to
 * the mark (PerGamePnlChart), so the longer millions never cut.
 */
export function axisMark(value: number): string {
  return Math.abs(Math.round(value)) >= 999_950 ? formatAt(value, 'fine', true) : axisMoney(value);
}

/** Half a value mark's height: its words are about 14px tall. */
const MARK_HALF = 7;

/**
 * The score chart's least distance between a high or low mark and "$0",
 * centre to centre (walk 9 T1-11): the marks are about 14px tall, so 26px
 * leaves 12px of clear air between their words. A mark any closer gives way;
 * $0 always stays, and a night's reading still gives the figure.
 */
export const MARK_MIN_GAP = 26;

/**
 * The night whose reading takes the most room (its date and figures, by
 * length), so the chart's heading can keep that height from the start and a
 * selected night never pushes the page (walk 9 T1-03).
 */
export function widestReading(series: readonly NightPoint[]): number {
  const fine = (amount: number) => formatAt(amount, 'fine', true).length;
  let widest = 0;
  let room = -1;
  series.forEach((point, index) => {
    let length: number;
    if (point.kind === 'start') {
      length = 'Start'.length + 'Everyone starts at $0'.length;
    } else {
      const { when, fees } = nightReadingParts(point, series[index - 1]);
      length = when.length + 'That night'.length + fine(point.change)
        + (fees !== 0 ? 'Fees'.length + fine(fees) : 0)
        + 'Score'.length + fine(point.cumulativePnl);
    }
    if (length > room) {
      room = length;
      widest = index;
    }
  });
  return widest;
}

/** The days since 1970 of a "2025-10-21" date. */
function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) / 86_400_000);
}

/**
 * Page Up / Page Down on the score chart (walk 9 T3-N1): the night a week
 * later (1) or earlier (-1), by date: the first night at least seven days on,
 * or the last one at least seven days back; the season's last night or the
 * start when there is none that far. The start counts as the day before the
 * first night.
 */
export function weekStepIndex(series: readonly NightPoint[], from: number, direction: 1 | -1): number {
  const last = series.length - 1;
  if (last < 0) return 0;
  const firstDated = series.find((point) => point.date);
  const dayOf = (index: number): number | null => {
    const date = series[index]?.date;
    if (date) return dayNumber(date);
    return series[index]?.kind === 'start' && firstDated?.date ? dayNumber(firstDated.date) - 1 : null;
  };
  const start = Math.min(Math.max(from, 0), last);
  const today = dayOf(start);
  if (today === null) return Math.min(Math.max(start + direction * 7, 0), last);
  const target = today + direction * 7;
  if (direction > 0) {
    for (let index = start + 1; index <= last; index += 1) {
      const day = dayOf(index);
      if (day !== null && day >= target) return index;
    }
    return last;
  }
  for (let index = start - 1; index >= 0; index -= 1) {
    const day = dayOf(index);
    if (day !== null && day <= target) return index;
  }
  return 0;
}

/**
 * The y-axis marks: $0 always, the season's high when it is above $0 and its
 * low when it is below, so a score that ran both ways names both (walk 4
 * T4-09). Every mark's words sit on the line they name (walk 8 T1-09): "$0"
 * nudged 8px off its dashed line read as a level above zero. An extreme
 * whose line runs closer than `minGap` px to $0 has no mark, since its words
 * could only sit on it by covering "$0" (a night's reading still gives it);
 * high and low sit on either side of $0, so they never meet. Words stay
 * inside the plot (`height`).
 */
export function valueTicks(
  values: readonly number[],
  yOf: (value: number) => number,
  // Marks are about 14px tall: 18px between centres leaves clear air.
  { height = Number.POSITIVE_INFINITY, minGap = 18 }: { height?: number; minGap?: number } = {},
): ValueTick[] {
  const high = Math.max(0, ...values);
  const low = Math.min(0, ...values);
  const top = MARK_HALF;
  const bottom = height - MARK_HALF;
  const clamp = (y: number) => Math.min(Math.max(y, top), Math.max(top, bottom));
  const zero: ValueTick = { value: 0, y: yOf(0), labelY: clamp(yOf(0)), kind: 'zero' };
  const mark = (value: number, kind: ValueTick['kind']): ValueTick[] => {
    const y = yOf(value);
    const labelY = clamp(y);
    return Math.abs(labelY - zero.labelY) >= minGap ? [{ value, y, labelY, kind }] : [];
  };
  // An extreme that would also read "$0" is no second mark.
  return [
    ...(Math.round(high) > 0 ? mark(high, 'high') : []),
    zero,
    ...(Math.round(low) < 0 ? mark(low, 'low') : []),
  ];
}
