/**
 * Where you stand on the leaderboard, in plain words: your rank, how far you
 * are from the rank above and from #1, or — when you lead — by how much.
 *
 * Everyone else is placed by their board row (`cumulativePnl`, the total
 * score since the season started at $0). You are placed by the score the
 * screen shows you: your account's own figure, the Roster's number. The
 * board ranks you as of the last settled games, so after a roster move its
 * row for you can lag; the rank, ties and gaps here never do, and
 * `boardLag` says how far behind the board's own figure is. Gaps use the
 * app's one money format (`money`: "$250", "$12.5K", "$1.06M"), so a $250
 * gap never reads "$0".
 *
 * Places are competition ranks: equal scores share the best place, and the
 * next score down takes the place after everyone above it ("1, 2, 2, 4").
 */
import type { PerGameLeaderboardRow } from '../api/contracts';
import { money, ordinalWords, signedMoney, spokenRanks } from '../copy/terms';

export { ordinalWords, spokenRanks };

export interface BoardGap {
  rank: number;
  name: string;
  /** Always positive: dollars between the two scores. */
  gap: number;
}

export type Standing =
  | { kind: 'empty' }
  | { kind: 'absent'; of: number }
  /**
   * Before the first games: every row is still $0, so nobody holds a place
   * yet. `score` is your own figure, which fees may already have moved.
   */
  | { kind: 'level'; of: number; score: number }
  | {
      kind: 'ranked';
      /** The place you hold; in a tie, the best rank in it. */
      rank: number;
      /** Board size. */
      of: number;
      /** Your score: the account's figure when given, else the board's. Rank, ties and gaps use it. */
      score: number;
      /** The board's own figure for you, which can lag your score until the next games settle. */
      boardScore: number;
      /** Everyone else on exactly your score. */
      tiedWith: string[];
      /** No score above yours (alone or tied at the top). */
      leading: boolean;
      /** The closest score above yours. */
      above: BoardGap | null;
      /** #1, when it is not already the score just above yours. */
      first: BoardGap | null;
      /** When you lead: the best score below yours. */
      runnerUp: BoardGap | null;
    };

/** The board in rank order; equal ranks fall back to score, then a stable id. */
export function sortBoard(rows: readonly PerGameLeaderboardRow[]): PerGameLeaderboardRow[] {
  return [...rows].sort((left, right) => (
    left.rank - right.rank
    || right.cumulativePnl - left.cumulativePnl
    || left.entryId.localeCompare(right.entryId)
  ));
}

/** Every row still at $0: nobody has a score until the first games settle. */
export function boardIsLevel(rows: readonly PerGameLeaderboardRow[]): boolean {
  return rows.length > 0 && rows.every((row) => Math.abs(row.cumulativePnl) < 1);
}

/**
 * A level board's order (walk 9 T2-05): nobody is ahead yet, so the server's
 * order must not read as places ("Fast Break FC, Deep Threes, You…" read as
 * "you are third"). You come first, then everyone else A to Z.
 */
export function levelOrder(rows: readonly PerGameLeaderboardRow[]): PerGameLeaderboardRow[] {
  return [...rows].sort((left, right) => (
    Number(right.isCurrentUser) - Number(left.isCurrentUser)
    || left.displayName.localeCompare(right.displayName, 'en', { sensitivity: 'base' })
    || left.entryId.localeCompare(right.entryId)
  ));
}

/**
 * The dollars a figure shows once formatted ("+$453.8K" → 453,800), so a gap
 * can be worked out from what is on screen. Null when it does not parse.
 */
export function shownDollars(value: number): number | null {
  const match = /^\$([\d,]+(?:\.\d+)?)([KMB]?)$/.exec(money(Math.abs(value)));
  if (!match) return null;
  const scale = match[2] === 'K' ? 1e3 : match[2] === 'M' ? 1e6 : match[2] === 'B' ? 1e9 : 1;
  const amount = Math.round(Number(match[1].replace(/,/g, '')) * scale);
  return value < 0 ? -amount : amount;
}

/**
 * The gap between two scores as the board shows them (walk 11 T4-01): "+$453.8K"
 * and "+$340.2K" are "$113.6K" apart on screen, even when the exact figures
 * are $113.5K apart. A gap under $1K is said to the dollar ("$250 behind #4",
 * a fee), finer than the figures, so it stays exact; two figures that read
 * the same keep their exact gap too, so a gap never reads "$0".
 */
export function shownGap(theirs: number, yours: number): number {
  const exact = Math.abs(theirs - yours);
  if (exact < 1000) return exact;
  const a = shownDollars(theirs);
  const b = shownDollars(yours);
  const onScreen = a === null || b === null ? null : Math.abs(a - b);
  return onScreen ? onScreen : exact;
}

function gapTo(row: PerGameLeaderboardRow, score: number, rank = row.rank): BoardGap {
  return { rank, name: row.displayName, gap: shownGap(row.cumulativePnl, score) };
}

export interface BoardEntry {
  row: PerGameLeaderboardRow;
  /** The score this row is placed and shown by: your account's for you, the board's for everyone else. */
  score: number;
  /** Its place: an exact tie shares the best place in it. */
  place: number;
  tied: boolean;
  /** Your row only, while the board lags your score: the board's own figure, shown as a note. */
  boardScore: number | null;
  /**
   * Small notes under a score that reads the same as a different score next
   * to it: "$191 ahead of #2" on the higher row, "$191 behind #1" on the
   * lower. Empty when the score reads apart from its neighbours (or is an
   * exact tie, which the shared place already says).
   */
  closeCalls: string[];
}

/**
 * Every row keeps the app's one money format ("+$4.5M"), even when two
 * different scores round to the same text. Such a pair gets a small note on
 * each row instead, with the dollars between them: "$191 ahead of #2" on the
 * higher one and "$191 behind #1" on the lower. An exact tie gets no note:
 * the shared place already says it.
 */
export function closeCallNotes(
  entries: ReadonlyArray<{ score: number; place: number }>,
): string[][] {
  return entries.map(({ score }) => {
    const text = signedMoney(score);
    const higher = entries.filter((other) => Math.round(other.score) > Math.round(score));
    const lower = entries.filter((other) => Math.round(other.score) < Math.round(score));
    const notes: string[] = [];
    if (higher.length > 0) {
      const next = higher.reduce((best, other) => (other.score < best.score ? other : best));
      if (signedMoney(next.score) === text) notes.push(`${money(next.score - score)} behind #${next.place}`);
    }
    if (lower.length > 0) {
      const next = lower.reduce((best, other) => (other.score > best.score ? other : best));
      if (signedMoney(next.score) === text) notes.push(`${money(score - next.score)} ahead of #${next.place}`);
    }
    return notes;
  });
}

/**
 * The list under the standing. Everyone else sits where the board has them;
 * you sit where the score shown puts you (your account's, when given), so
 * the list never says "#1 … YOU $0" under a "#5 of 5" headline. Your row
 * keeps the board's own figure as a note while the two differ.
 */
export function boardList(
  rows: readonly PerGameLeaderboardRow[],
  accountScore?: number,
  /** The fee a move costs: a gap of whole fees is explained by the standing, and the row shows one figure (walk 8 T3-06). */
  feeDollars?: number,
): BoardEntry[] {
  // A level board (before the first games) keeps everyone at $0 together,
  // you first and the rest A to Z: no order that reads as places.
  const level = boardIsLevel(rows);
  const scored = (level ? levelOrder(rows) : sortBoard(rows)).map((row, order) => {
    const live = row.isCurrentUser && accountScore !== undefined && !level ? accountScore : row.cumulativePnl;
    return { row, order, score: live };
  });
  const scores = scored.map((entry) => entry.score);
  const entries = scored
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .map(({ row, score }) => ({
      row,
      score,
      place: 1 + scores.filter((other) => other > score).length,
      tied: scores.filter((other) => other === score).length > 1,
      // A board figure that reads the same as the score shown says nothing new.
      boardScore: row.isCurrentUser && signedMoney(score) !== signedMoney(row.cumulativePnl)
        && feesOnly(score - row.cumulativePnl, feeDollars) === null
        ? row.cumulativePnl
        : null,
    }));
  const notes = closeCallNotes(entries);
  return entries.map((entry, index) => ({ ...entry, closeCalls: notes[index] }));
}

/**
 * Your standing among the other rows. Pass your account score to be placed by
 * it (the figure the screen shows); without it the board's own row for you is
 * used.
 */
export function leaderStanding(
  rows: readonly PerGameLeaderboardRow[],
  accountScore?: number,
): Standing {
  const board = sortBoard(rows);
  if (board.length === 0) return { kind: 'empty' };
  const me = board.find((row) => row.isCurrentUser);
  if (!me) return { kind: 'absent', of: board.length };
  // Nobody is ahead of anybody before the first games, whatever your fees
  // have already done to your own score: no "#5 of 5" on a level board.
  if (boardIsLevel(board)) return { kind: 'level', of: board.length, score: accountScore ?? me.cumulativePnl };

  const score = accountScore ?? me.cumulativePnl;
  const others = board.filter((row) => row !== me);
  const tiedWith = others.filter((row) => row.cumulativePnl === score).map((row) => row.displayName);
  const higher = others.filter((row) => row.cumulativePnl > score);
  const lower = others.filter((row) => row.cumulativePnl < score);
  // Competition places over everyone's score, yours as shown.
  const scores = [...others.map((row) => row.cumulativePnl), score];
  const placeOfScore = (value: number) => 1 + scores.filter((other) => other > value).length;

  let above: BoardGap | null = null;
  let first: BoardGap | null = null;
  let runnerUp: BoardGap | null = null;
  if (higher.length > 0) {
    // The closest score above; a tie up there is named by the place it holds.
    const nextScore = Math.min(...higher.map((row) => row.cumulativePnl));
    const nearest = higher.filter((row) => row.cumulativePnl === nextScore);
    above = gapTo(nearest[nearest.length - 1] ?? higher[0], score, placeOfScore(nextScore));
    const topScore = Math.max(...higher.map((row) => row.cumulativePnl));
    if (topScore !== nextScore) {
      const top = higher.find((row) => row.cumulativePnl === topScore) ?? higher[0];
      first = gapTo(top, score, placeOfScore(topScore));
    }
  } else if (lower.length > 0) {
    const bestBelow = Math.max(...lower.map((row) => row.cumulativePnl));
    const next = lower.find((row) => row.cumulativePnl === bestBelow) ?? lower[0];
    runnerUp = gapTo(next, score, placeOfScore(bestBelow));
  }

  return {
    kind: 'ranked',
    rank: placeOfScore(score),
    of: board.length,
    score,
    boardScore: me.cumulativePnl,
    tiedWith,
    leading: higher.length === 0,
    above,
    first,
    runnerUp,
  };
}

/** "#2" or "Tied for #2". */
export function standingPlace(standing: Extract<Standing, { kind: 'ranked' }>): string {
  return standing.tiedWith.length > 0 ? `Tied for #${standing.rank}` : `#${standing.rank}`;
}

/**
 * The gaps, one plain sentence each: "$12K behind #2", "$240K behind #1";
 * when you lead, "$30K ahead of #2"; when tied, who with.
 */
export function standingLines(standing: Standing): string[] {
  if (standing.kind === 'empty') return [];
  if (standing.kind === 'absent') return ["You're not on the board yet."];
  if (standing.kind === 'level') return ['Everyone is level at $0 until the first games'];
  const lines: string[] = [];
  if (standing.tiedWith.length === 1) lines.push(`Level with ${standing.tiedWith[0]}`);
  if (standing.tiedWith.length > 1) lines.push(`Level with ${standing.tiedWith.length} others`);
  if (standing.above) lines.push(`${money(standing.above.gap)} behind #${standing.above.rank}`);
  if (standing.first) lines.push(`${money(standing.first.gap)} behind #${standing.first.rank}`);
  if (standing.runnerUp) lines.push(`${money(standing.runnerUp.gap)} ahead of #${standing.runnerUp.rank}`);
  if (standing.leading && standing.of === 1) lines.push('No one else is on the board yet.');
  return lines;
}

/**
 * How far the board's own figure for you trails the score you are placed by,
 * or null when they agree. The board is ranked as of the last settled games,
 * so a roster move's fee since then shows in your score first.
 */
export function boardLag(standing: Standing): number | null {
  if (standing.kind !== 'ranked') return null;
  const lag = standing.score - standing.boardScore;
  return Math.abs(lag) < 1 ? null : lag;
}

/** How many whole fees a gap below the board is ($250 → 1, $500 → 2), or null when it is anything else. */
export function feesOnly(lag: number, feeDollars?: number): number | null {
  if (!feeDollars || feeDollars <= 0 || lag >= 0) return null;
  const count = Math.round(-lag / feeDollars);
  return count >= 1 && Math.abs(-lag - count * feeDollars) < 1 ? count : null;
}

/**
 * Why the board's figure for you differs from your score, or null when the
 * two read the same. The board counts moves once the next games settle. A
 * gap of whole fees: the You row already shows your score, so the note names
 * the fee and no second score (walk 10 T1-08, T2-09: a "Board +$101.8K"
 * figure appeared nowhere on the board): "Your score includes today's $250
 * fee; rivals' scores change after the next games." Anything else keeps the
 * board's figure, which the You row shows too. Screen readers hear it
 * through `spokenLagLine`.
 */
export function lagLine(standing: Standing, feeDollars?: number): string | null {
  const lag = boardLag(standing);
  if (lag === null || standing.kind !== 'ranked') return null;
  const board = signedMoney(standing.boardScore);
  const yours = signedMoney(standing.score);
  // Two figures that read alike: a note between them would only confuse.
  if (board === yours) return null;
  const fees = feesOnly(lag, feeDollars);
  const later = "rivals' scores change after the next games.";
  if (fees === 1) return `Your score includes today's ${money(-lag)} fee; ${later}`;
  if (fees !== null) return `Your score includes today's ${money(-lag)} in fees; ${later}`;
  return `The board still has you at ${board} until the next games settle.`;
}

/**
 * `lagLine` as a screen reader hears it after "your score +$194K": "which
 * includes today's $250 fee; …", no closing full stop, and a score is never
 * said twice.
 */
export function spokenLagLine(line: string): string {
  return line.replace(/ · your score [^:]+/, '').replace(/^Your score includes /, 'which includes ').replace(/\.$/, '');
}

// ---------------------------------------------------------------------------
// Your seasons this visit (practice)

/**
 * A finished practice season, as `pastSeasonResults()` in web/practiceSession
 * gives it: the final score, the place ("#1 of 5", or null off the board) and
 * when it finished. The list is carried through Play another season and
 * Restart, and cleared by a manual reload.
 */
export interface PastSeason {
  score: number;
  rank: string | null;
  finishedOn: string;
}

export interface PastSeasonLine {
  key: string;
  /** "Season 2": numbered in the order played this visit. */
  label: string;
  /** "This season" under the season that just finished on screen, else null. */
  note: string | null;
  score: number;
  /** "#1 of 5", or null when the season ended off the board. */
  place: string | null;
  /** "Season 2: +$4.22M, first of 5". */
  spoken: string;
}

function isPastSeason(value: unknown): value is PastSeason {
  const season = value as Partial<PastSeason> | null;
  return Boolean(season) && typeof season?.score === 'number' && Number.isFinite(season.score)
    && (season.rank === null || typeof season.rank === 'string')
    && typeof season.finishedOn === 'string';
}

/**
 * The practice session's finished seasons, read from the session module when
 * it offers `pastSeasonResults()`; an empty list when it does not (a build
 * without it) or when it gives anything unexpected. Takes the module as an
 * argument so the screen stays import-safe.
 */
export function readPastSeasons(session: unknown): PastSeason[] {
  const read = (session as { pastSeasonResults?: unknown } | null)?.pastSeasonResults;
  if (typeof read !== 'function') return [];
  try {
    const list: unknown = read();
    return Array.isArray(list) ? list.filter(isPastSeason) : [];
  } catch {
    return [];
  }
}

/**
 * "Your seasons this visit" (walk 5 T2 NYI-1): each finished season's final
 * score and place, newest first, numbered in the order they were played (the
 * list comes oldest first). Seasons finished on the same day keep that
 * order, so a practice calendar's shared last day still sorts right.
 *
 * `finishedNow` is the season on screen once it is over: it joins the list at
 * once, marked "this season" (walk 10 T2-15: it appeared only after the next
 * season began). Alone it adds nothing the final standing does not say, so it
 * joins only a list that already has a season.
 */
export function pastSeasonLines(seasons: readonly PastSeason[], finishedNow: PastSeason | null = null): PastSeasonLine[] {
  // From the first finished season on (walk 11 T1-12): the record starts at once.
  const all = finishedNow ? [...seasons, finishedNow] : seasons;
  return all
    .map((season, index) => ({ season, number: index + 1, now: season === finishedNow }))
    .sort((left, right) => right.season.finishedOn.localeCompare(left.season.finishedOn) || right.number - left.number)
    .map(({ season, number, now }) => {
      const score = Math.round(season.score) === 0 ? '$0' : signedMoney(season.score);
      const place = season.rank && season.rank.trim() ? season.rank.trim() : null;
      return {
        key: `season-${number}`,
        label: `Season ${number}`,
        note: now ? 'This season' : null,
        score: season.score,
        place,
        spoken: `Season ${number}${now ? ', this season' : ''}: ${score}${place ? `, ${spokenRanks(place)}` : ''}`,
      };
    });
}

// ---------------------------------------------------------------------------
// Places read aloud (walk 6 T3-09, T3-07)

/** Your place, said: "First of 5", "Tied for second of 5". */
export function spokenPlace(rank: number, of: number, tied = false): string {
  const place = `${ordinalWords(rank)} of ${of}`;
  return tied ? `Tied for ${place}` : `${place.charAt(0).toUpperCase()}${place.slice(1)}`;
}

