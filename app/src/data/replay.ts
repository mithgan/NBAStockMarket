import { playerTrends } from './trends';

export interface ReplayEvent {
  playerId: string;
  date: string;
  actualNetPoints: number;
  expectedNetPoints: number;
  dividendPerHolder: number;
}

export interface ReplayDay {
  date: string;
  events: ReplayEvent[];
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

const eventsByDate = new Map<string, ReplayEvent[]>();

for (const [playerId, trendPoints] of Object.entries(playerTrends)) {
  for (const point of trendPoints) {
    if (
      !Number.isFinite(point.np)
      || !Number.isFinite(point.expected_np)
      || !Number.isFinite(point.dividend_per_holder)
    ) {
      continue;
    }

    const event: ReplayEvent = {
      playerId,
      date: point.date,
      actualNetPoints: point.np,
      expectedNetPoints: point.expected_np,
      dividendPerHolder: point.dividend_per_holder,
    };
    const dateEvents = eventsByDate.get(point.date);

    if (dateEvents) {
      dateEvents.push(event);
    } else {
      eventsByDate.set(point.date, [event]);
    }
  }
}

export const replayDays: ReplayDay[] = [...eventsByDate.entries()]
  .sort(([leftDate], [rightDate]) => compareText(leftDate, rightDate))
  .map(([date, events]) => ({
    date,
    events: events.sort((left, right) => compareText(left.playerId, right.playerId)),
  }));

export const replayDayByDate: Record<string, ReplayDay> = Object.fromEntries(
  replayDays.map((day) => [day.date, day]),
);

const replayEventsByPlayer = new Map<string, ReplayEvent[]>();

for (const day of replayDays) {
  for (const event of day.events) {
    const playerEvents = replayEventsByPlayer.get(event.playerId);

    if (playerEvents) {
      playerEvents.push(event);
    } else {
      replayEventsByPlayer.set(event.playerId, [event]);
    }
  }
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

export function nextEventForPlayer(playerId: string, afterDate: string | null): ReplayEvent | null {
  const events = replayEventsByPlayer.get(playerId);

  if (!events) return null;
  if (afterDate === null) return events[0] ?? null;
  return events.find((event) => event.date > afterDate) ?? null;
}
