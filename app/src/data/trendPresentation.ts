export type TrendDirection = 'up' | 'down';

export function trendDirection(values: number[]): TrendDirection {
  if (values.length < 2) return 'up';
  return values[values.length - 1] >= values[0] ? 'up' : 'down';
}

export function sparklineHeights(values: number[]): number[] {
  if (values.length === 0) return [];
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  if (minimum === maximum) return values.map(() => 17.5);
  return values.map((value) => 5 + ((value - minimum) / (maximum - minimum)) * 25);
}
