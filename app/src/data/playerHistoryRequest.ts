/** Public statistics only: never attach account tokens or provider credentials. */
export const PLAYER_HISTORY_API = 'https://api.databallr.com/v1/nba/players/gamelog';

export function priorSeason(current: string): { id: string; endYear: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(current);
  if (!match) return null;
  const start = Number(match[1]);
  if (start < 1947 || start > 2100 || Number(match[2]) !== (start + 1) % 100) return null;
  return { id: `${start - 1}-${String(start % 100).padStart(2, '0')}`, endYear: start };
}

export function normalizePlayerName(name: string): string {
  return name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
