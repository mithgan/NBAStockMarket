import type { TrendPoint } from '../data/trends';
import type { Holding } from '../data/types';

// The replay clock starts on the eve of opening night: day 0 = nothing has
// happened yet. Advancing to a date credits every game with
// eve < game_date <= simDate.
export const SIM_START = '2025-10-20';
export const SEASON_END = '2026-04-12';

const DAY_MS = 86_400_000;

export function addDays(isoDate: string, days: number): string {
  const time = Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS;
  return new Date(time).toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY_MS,
  );
}

export const SEASON_TOTAL_DAYS = daysBetween(SIM_START, SEASON_END);

export function clampToSeason(isoDate: string): string {
  if (isoDate < SIM_START) return SIM_START;
  if (isoDate > SEASON_END) return SEASON_END;
  return isoDate;
}

export function seasonDayNumber(isoDate: string): number {
  return daysBetween(SIM_START, clampToSeason(isoDate));
}

export function seasonProgress(isoDate: string): number {
  return seasonDayNumber(isoDate) / SEASON_TOTAL_DAYS;
}

export interface CollectedDividend {
  player_id: string;
  date: string;
  np: number;
  expected_np: number;
  amount: number;
}

export interface DividendCollection {
  total: number;
  events: CollectedDividend[];
}

export function collectDividends(
  holdings: readonly Holding[],
  trends: Record<string, TrendPoint[]>,
  fromExclusive: string,
  toInclusive: string,
): DividendCollection {
  const events: CollectedDividend[] = [];
  for (const holding of holdings) {
    for (const point of trends[holding.player_id] ?? []) {
      if (point.date > fromExclusive && point.date <= toInclusive) {
        events.push({
          player_id: holding.player_id,
          date: point.date,
          np: point.np,
          expected_np: point.expected_np,
          amount: point.dividend_per_holder,
        });
      }
    }
  }
  events.sort((left, right) => {
    if (left.date !== right.date) return left.date < right.date ? 1 : -1;
    return Math.abs(right.amount) - Math.abs(left.amount);
  });
  return { total: events.reduce((sum, event) => sum + event.amount, 0), events };
}

export function clipTrends(points: readonly TrendPoint[], throughIso: string): TrendPoint[] {
  return points.filter((point) => point.date <= throughIso);
}
