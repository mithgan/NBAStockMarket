/**
 * Where you stand on the leaderboard, in plain words: your rank, how far you
 * are from the rank above and from #1, or — when you lead — by how much.
 *
 * Everyone else is placed by their board row (`cumulativePnl`, the total
 * score since the season started at $0). You are placed by the score the
 * screen shows you: your account's own figure, the Roster's number. The
 * board ranks you as of the last settled games, so after a roster move its
 * row for you can lag; the rank, ties and gaps here never do, and
 * `boardLag` says how far behind the board's own figure is. Gaps use
 * `moneyFine`, one more digit than a score, so a $250 gap never reads "$0"
 * and two gaps to different scores never read the same.
 *
 * Places are competition ranks: equal scores share the best place, and the
 * next score down takes the place after everyone above it ("1, 2, 2, 4").
 */
import type { PerGameLeaderboardRow } from '../api/contracts';
import { moneyFine } from '../copy/terms';

export interface BoardGap {
  rank: number;
  name: string;
  /** Always positive: dollars between the two scores. */
  gap: number;
}

export type Standing =
  | { kind: 'empty' }
  | { kind: 'absent'; of: number }
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
  const scored = sortBoard(rows).map((row, order) => {
    const live = row.isCurrentUser && accountScore !== undefined ? accountScore : row.cumulativePnl;
    return { row, order, score: live };
  });
  const scores = scored.map((entry) => entry.score);
  return scored
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .map(({ row, score }) => ({
      row,
      score,
      place: 1 + scores.filter((other) => other > score).length,
      tied: scores.filter((other) => other === score).length > 1,
      boardScore: row.isCurrentUser && Math.abs(score - row.cumulativePnl) >= 1 ? row.cumulativePnl : null,
    }));
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
  const lines: string[] = [];
  if (standing.tiedWith.length === 1) lines.push(`Level with ${standing.tiedWith[0]}`);
  if (standing.tiedWith.length > 1) lines.push(`Level with ${standing.tiedWith.length} others`);
  if (standing.above) lines.push(`${moneyFine(standing.above.gap)} behind #${standing.above.rank}`);
  if (standing.first) lines.push(`${moneyFine(standing.first.gap)} behind #${standing.first.rank}`);
  if (standing.runnerUp) lines.push(`${moneyFine(standing.runnerUp.gap)} ahead of #${standing.runnerUp.rank}`);
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
