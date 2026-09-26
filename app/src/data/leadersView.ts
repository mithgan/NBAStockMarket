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
import { money, signedMoney } from '../copy/terms';

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

function gapTo(row: PerGameLeaderboardRow, score: number, rank = row.rank): BoardGap {
  return { rank, name: row.displayName, gap: Math.abs(row.cumulativePnl - score) };
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
): BoardEntry[] {
  // A level board (before the first games) keeps everyone at $0 together.
  const level = boardIsLevel(rows);
  const scored = sortBoard(rows).map((row, order) => {
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
      boardScore: row.isCurrentUser && Math.abs(score - row.cumulativePnl) >= 1 ? row.cumulativePnl : null,
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
  score: number;
  /** "#1 of 5", or null when the season ended off the board. */
  place: string | null;
  /** "Season 2: +$4.22M, number 1 of 5". */
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
 */
export function pastSeasonLines(seasons: readonly PastSeason[]): PastSeasonLine[] {
  return seasons
    .map((season, index) => ({ season, number: index + 1 }))
    .sort((left, right) => right.season.finishedOn.localeCompare(left.season.finishedOn) || right.number - left.number)
    .map(({ season, number }) => {
      const score = Math.round(season.score) === 0 ? '$0' : signedMoney(season.score);
      const place = season.rank && season.rank.trim() ? season.rank.trim() : null;
      return {
        key: `season-${number}`,
        label: `Season ${number}`,
        score: season.score,
        place,
        spoken: `Season ${number}: ${score}${place ? `, ${place.replace('#', 'number ')}` : ''}`,
      };
    });
}
