import type { PerGameLeaderboardRow } from '../api/contracts';

export interface LeaderboardOptions {
  /** Only practice supplies the whole board and can safely recompute places. */
  complete?: boolean;
}

type RankedScore = Pick<PerGameLeaderboardRow, 'rank' | 'cumulativePnl' | 'isCurrentUser'>;

/** Production returns the top 50 plus you, with no total population count. */
export function leaderboardPlace(
  rows: readonly RankedScore[],
  accountScore: number,
  { complete = false }: LeaderboardOptions = {},
): { rank: number | null; of: number | null } {
  if (rows.length === 0) return { rank: null, of: null };
  if (!complete) {
    return { rank: rows.find((row) => row.isCurrentUser)?.rank ?? null, of: null };
  }
  const others = rows.filter((row) => !row.isCurrentUser);
  return {
    rank: 1 + others.filter((row) => row.cumulativePnl > accountScore).length,
    of: others.length + 1,
  };
}
