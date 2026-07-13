export type TrendDirection = 'up' | 'down';
export type TrendRange = 'L5' | 'L15' | 'Season';

export interface IndexedValue {
  index: number;
  value: number;
}

export function selectTrendRange<T>(points: readonly T[], range: TrendRange): T[] {
  if (range === 'Season') return [...points];
  return points.slice(-Number(range.slice(1)));
}

export function cumulativeValues(values: readonly number[]): number[] {
  let total = 0;
  return values.map((value) => (total += value));
}

export function selectHighLowPoints(values: readonly number[]): {
  high: IndexedValue | null;
  low: IndexedValue | null;
} {
  if (values.length === 0) return { high: null, low: null };

  let high: IndexedValue = { index: 0, value: values[0] };
  let low: IndexedValue = { index: 0, value: values[0] };
  values.forEach((value, index) => {
    if (value > high.value) high = { index, value };
    if (value < low.value) low = { index, value };
  });
  return { high, low };
}

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
