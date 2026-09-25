/**
 * Where you stand on the leaderboard, in plain words: your rank, how far you
 * are from the rank above and from #1, or — when you lead — by how much.
 *
 * Every number comes from the board rows themselves (each row's
 * `cumulativePnl`, the total score since the season started at $0), so the
 * gaps always add up against the list shown underneath.
 *
 * Ties: two scores that are exactly equal share a place. You are "tied for #2"
 * with the best rank in the tie, whatever order the server listed them in.
 */
import type { PerGameLeaderboardRow } from '../api/contracts';
import { money } from '../copy/terms';

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
      /** Your score on the board. */
      score: number;
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

/** The best (lowest) rank among rows holding exactly `score`. */
function placeOf(board: readonly PerGameLeaderboardRow[], score: number): number {
  return Math.min(...board.filter((row) => row.cumulativePnl === score).map((row) => row.rank));
}

export interface BoardPlace {
  /** The place shown on the row: an exact tie shares the best rank in it. */
  place: number;
  tied: boolean;
}

/** Each row's shown place by entry id, so the list agrees with "Tied for #2". */
export function boardPlaces(rows: readonly PerGameLeaderboardRow[]): Map<string, BoardPlace> {
  const board = sortBoard(rows);
  const counts = new Map<number, number>();
  for (const row of board) counts.set(row.cumulativePnl, (counts.get(row.cumulativePnl) ?? 0) + 1);
  return new Map(board.map((row) => [row.entryId, {
    place: placeOf(board, row.cumulativePnl),
    tied: (counts.get(row.cumulativePnl) ?? 0) > 1,
  }]));
}

export function leaderStanding(rows: readonly PerGameLeaderboardRow[]): Standing {
  const board = sortBoard(rows);
  if (board.length === 0) return { kind: 'empty' };
  const me = board.find((row) => row.isCurrentUser);
  if (!me) return { kind: 'absent', of: board.length };

  const score = me.cumulativePnl;
  const others = board.filter((row) => row !== me);
  const tiedWith = others.filter((row) => row.cumulativePnl === score).map((row) => row.displayName);
  const higher = others.filter((row) => row.cumulativePnl > score);
  const lower = others.filter((row) => row.cumulativePnl < score);

  let above: BoardGap | null = null;
  let first: BoardGap | null = null;
  let runnerUp: BoardGap | null = null;
  if (higher.length > 0) {
    // The closest score above. A tie up there shares its best rank, so the
    // gap is named by the place you would take, not by listing order.
    const nextScore = Math.min(...higher.map((row) => row.cumulativePnl));
    const nearest = higher.filter((row) => row.cumulativePnl === nextScore);
    above = gapTo(nearest[nearest.length - 1] ?? higher[0], score, placeOf(board, nextScore));
    const topScore = Math.max(...higher.map((row) => row.cumulativePnl));
    if (topScore !== nextScore) {
      const top = higher.find((row) => row.cumulativePnl === topScore) ?? higher[0];
      first = gapTo(top, score, placeOf(board, topScore));
    }
  } else if (lower.length > 0) {
    const bestBelow = Math.max(...lower.map((row) => row.cumulativePnl));
    const next = lower.find((row) => row.cumulativePnl === bestBelow) ?? lower[0];
    runnerUp = gapTo(next, score, placeOf(board, bestBelow));
  }

  return {
    kind: 'ranked',
    rank: placeOf(board, score),
    of: board.length,
    score,
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
  if (standing.above) lines.push(`${money(standing.above.gap)} behind #${standing.above.rank}`);
  if (standing.first) lines.push(`${money(standing.first.gap)} behind #${standing.first.rank}`);
  if (standing.runnerUp) lines.push(`${money(standing.runnerUp.gap)} ahead of #${standing.runnerUp.rank}`);
  if (standing.leading && standing.of === 1) lines.push('No one else is on the board yet.');
  return lines;
}
