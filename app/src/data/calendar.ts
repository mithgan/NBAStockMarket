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
