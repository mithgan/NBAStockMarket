/**
 * NBA season label ("2025-26") for a game date. Seasons straddle the calendar
 * year: anything from August onward opens that year's season, earlier dates
 * belong to the season that started the year before.
 */
export function seasonLabelFor(date: string | null): string {
  if (date === null) return 'Not started';
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  if (!Number.isFinite(year) || !Number.isFinite(month)) return 'Unknown';
  const startYear = month >= 8 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** Monday of the ISO week containing the date, as a YYYY-MM-DD string. */
export function weekStartOf(date: string): string {
  const calendarDate = new Date(`${date}T00:00:00Z`);
  const isoDay = calendarDate.getUTCDay() || 7;
  calendarDate.setUTCDate(calendarDate.getUTCDate() - (isoDay - 1));
  return calendarDate.toISOString().slice(0, 10);
}

export function weekKey(date: string): string {
  const calendarDate = new Date(`${date}T00:00:00Z`);
  const isoDay = calendarDate.getUTCDay() || 7;
  calendarDate.setUTCDate(calendarDate.getUTCDate() + 4 - isoDay);
  const isoYear = calendarDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const weekNumber = Math.ceil(
    ((calendarDate.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return `${isoYear}-W${String(weekNumber).padStart(2, '0')}`;
}
