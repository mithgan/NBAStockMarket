export interface ChartCoordinate {
  x: number;
  y: number;
}

export interface PortfolioChangePoint {
  totalValue: number;
}

export function portfolioPeriodChange(
  points: readonly PortfolioChangePoint[],
  baselineTotalValue: number,
): number {
  if (points.length === 0 || !Number.isFinite(baselineTotalValue)) return 0;
  const last = points.at(-1)!;
  return last.totalValue - baselineTotalValue;
}

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
