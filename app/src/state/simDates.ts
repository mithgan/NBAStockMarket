// Season-calendar math for the replay progression bar. Dates are ET calendar
// labels (YYYY-MM-DD) treated as opaque strings; construct Date only with a
// forced UTC midnight so device timezones can never shift a game date.
export const SIM_START = '2025-10-20';
export const SEASON_END = '2026-04-12';

const DAY_MS = 24 * 60 * 60 * 1000;

function toUtc(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getTime();
}

export function addIsoDays(isoDate: string, days: number): string {
  return new Date(toUtc(isoDate) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((toUtc(toIso) - toUtc(fromIso)) / DAY_MS);
}

export const SEASON_TOTAL_DAYS = daysBetween(SIM_START, SEASON_END);

export function seasonDayNumber(nextGameDate: string | null): number {
  if (nextGameDate === null) return SEASON_TOTAL_DAYS;
  return Math.min(Math.max(daysBetween(SIM_START, nextGameDate), 0), SEASON_TOTAL_DAYS);
}

export function seasonProgress(nextGameDate: string | null): number {
  return seasonDayNumber(nextGameDate) / SEASON_TOTAL_DAYS;
}
