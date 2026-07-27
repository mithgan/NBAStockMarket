export type TrendRange = 'L5' | 'L15' | 'Season';

export interface TrendPoint {
  date: string;
  np: number;
  expected_np: number;
  dividend_per_holder: number;
}

export interface IndexedValue {
  index: number;
  value: number;
}

export function selectTrendRange<T>(points: readonly T[], range: TrendRange): T[] {
  if (range === 'Season') return [...points];
  return points.slice(-Number(range.slice(1)));
}

export function selectSettledTrendPoints<T extends { date: string }>(
  points: readonly T[],
  latestSettledDate: string | null,
): T[] {
  if (latestSettledDate === null) return [];
  return points.filter((point) => point.date <= latestSettledDate);
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
