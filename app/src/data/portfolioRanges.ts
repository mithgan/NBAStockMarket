import type { ChartCoordinate } from './chartGeometry';

/**
 * Range selection for the portfolio history chart.
 *
 * The portfolio history holds one point per settled date, so every window here
 * counts settled dates, not calendar days: '1W' is the last 7 settled points.
 */

export const PORTFOLIO_RANGES = ['1W', '1M', '3M', 'Season'] as const;

export type PortfolioRange = (typeof PORTFOLIO_RANGES)[number];

/** The slice of a history point that period math needs. */
export interface PortfolioChangePoint {
  totalValue: number;
}

const RANGE_POINT_COUNTS: Record<Exclude<PortfolioRange, 'Season'>, number> = {
  '1W': 7,
  '1M': 30,
  '3M': 90,
};

/**
 * Slice the window a range shows, plus the baseline it is measured against:
 * the point just before the window when one exists, otherwise the caller's
 * fallback (the opening bankroll, for windows that reach back to day one).
 */
export function selectPortfolioRange<T extends PortfolioChangePoint>(
  points: readonly T[],
  range: PortfolioRange,
  fallbackBaseline: number,
): { visible: T[]; baseline: number } {
  const windowLength = range === 'Season' ? points.length : RANGE_POINT_COUNTS[range];
  const startIndex = Math.max(0, points.length - windowLength);
  return {
    visible: points.slice(startIndex),
    baseline: startIndex > 0 ? points[startIndex - 1].totalValue : fallbackBaseline,
  };
}

/**
 * A range is offered only once the history holds MORE points than it shows,
 * so picking it actually narrows the chart and a true baseline point exists
 * ahead of the window. 'Season' is always available.
 */
export function availablePortfolioRanges(pointCount: number): PortfolioRange[] {
  return PORTFOLIO_RANGES.filter(
    (range) => range === 'Season' || pointCount > RANGE_POINT_COUNTS[range],
  );
}

export function portfolioPeriodChange(
  points: readonly PortfolioChangePoint[],
  baselineTotalValue: number,
): number {
  if (points.length === 0 || !Number.isFinite(baselineTotalValue)) return 0;
  const last = points.at(-1)!;
  return last.totalValue - baselineTotalValue;
}

/**
 * Map values onto plot coordinates, inset so the stroke and end dot stay
 * inside the surface. A single point centers; a flat series draws midline.
 */
export function chartCoordinates(
  values: number[],
  width: number,
  height: number,
): ChartCoordinate[] {
  if (values.length === 0 || width <= 0 || height <= 0) return [];

  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum;
  const xInset = 10;
  const yInset = 12;

  return values.map((value, index) => ({
    x: values.length === 1
      ? width / 2
      : xInset + (index / (values.length - 1)) * (width - xInset * 2),
    y: span === 0
      ? height / 2
      : yInset + ((maximum - value) / span) * (height - yInset * 2),
  }));
}
