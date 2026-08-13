import type { TrendPoint } from './trendPresentation';

export interface PlayerStats {
  games: number;
  avgNp: number;
  avgExpected: number;
  /** Mean of (actual - projected) net points; positive means over-delivering. */
  avgSurprise: number;
  /** Share of settled games that beat the projection. */
  beatRate: number;
  /** Population standard deviation of the surprise — lower is more repeatable. */
  consistency: number;
  best: TrendPoint | null;
  worst: TrendPoint | null;
  totalPaid: number;
  /** Average surprise across only the last five settled games. */
  lastFive: number;
}

/**
 * One pass over a player's settled games producing everything the stat grid
 * shows. Every number is derived from the same surprise definition —
 * actual net points minus the projection — so the tiles cannot disagree with
 * each other about what "beating expectations" means.
 */
export function derivePlayerStats(points: readonly TrendPoint[]): PlayerStats | null {
  if (points.length === 0) return null;

  const surprises = points.map((point) => point.np - point.expected_np);
  const mean = (values: number[]) =>
    values.reduce((sum, value) => sum + value, 0) / values.length;
  const avgSurprise = mean(surprises);
  const variance = mean(surprises.map((value) => (value - avgSurprise) ** 2));
  const lastFive = points.slice(-5);

  return {
    games: points.length,
    avgNp: mean(points.map((point) => point.np)),
    avgExpected: mean(points.map((point) => point.expected_np)),
    avgSurprise,
    beatRate: surprises.filter((value) => value > 0).length / points.length,
    consistency: Math.sqrt(variance),
    best: points.reduce<TrendPoint | null>(
      (best, point) =>
        !best || point.np - point.expected_np > best.np - best.expected_np ? point : best,
      null,
    ),
    worst: points.reduce<TrendPoint | null>(
      (worst, point) =>
        !worst || point.np - point.expected_np < worst.np - worst.expected_np ? point : worst,
      null,
    ),
    totalPaid: points.reduce((sum, point) => sum + point.dividend_per_holder, 0),
    lastFive: lastFive.length > 0
      ? mean(lastFive.map((point) => point.np - point.expected_np))
      : 0,
  };
}
