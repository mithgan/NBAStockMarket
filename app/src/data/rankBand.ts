/**
 * Familiar leaderboard cutoffs. A band only applies while it is strictly
 * smaller than the field, or "Top 100" in a field of 100 would brag about
 * last place.
 */
const RANK_BANDS = [10, 50, 100, 500, 1_000, 5_000, 10_000, 50_000, 100_000];

/**
 * Human label for a leaderboard position. First place is simply "Leading";
 * small fields (under 40) speak in percentages because "Top 10" of a dozen
 * players reads as flattery; large fields snap to the familiar bands above,
 * falling back to a percentage past the largest one. Anything unresolvable is
 * "Unranked" rather than a made-up number.
 */
export function rankBand(rank: number, fieldSize: number): string {
  if (!Number.isFinite(rank) || !Number.isFinite(fieldSize) || rank < 1 || fieldSize < 1) {
    return 'Unranked';
  }
  if (rank === 1) return 'Leading';
  if (fieldSize < 40) return `Top ${Math.max(1, Math.ceil((rank / fieldSize) * 100))}%`;
  const band = RANK_BANDS.find((threshold) => rank <= threshold && threshold < fieldSize);
  return band
    ? `Top ${band.toLocaleString('en-US')}`
    : `Top ${Math.ceil((rank / fieldSize) * 100)}%`;
}
