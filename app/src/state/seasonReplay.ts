import type { ServerAdvanceResult } from '../api/contracts';

export interface SeasonReplayProgress {
  completedDates: number;
  lastSettledDate: string;
  nextGameDate: string | null;
}

export interface SeasonReplaySummary extends SeasonReplayProgress {
  isComplete: true;
}

export class SeasonReplayError extends Error {
  constructor(
    message: string,
    public readonly completedDates: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SeasonReplayError';
  }
}

const MAX_REPLAY_DATES = 220;

export async function settleRemainingSeason(
  firstGameDate: string,
  settleDate: (expectedGameDate: string) => Promise<ServerAdvanceResult>,
  onProgress?: (progress: SeasonReplayProgress) => void,
): Promise<SeasonReplaySummary> {
  let nextGameDate: string | null = firstGameDate;
  let completedDates = 0;
  let lastSettledDate = firstGameDate;
  const visited = new Set<string>();

  try {
    while (nextGameDate !== null) {
      if (completedDates >= MAX_REPLAY_DATES) {
        throw new Error('The replay exceeded its historical date limit.');
      }
      if (visited.has(nextGameDate)) {
        throw new Error('The server returned a repeated replay date.');
      }
      visited.add(nextGameDate);

      const expectedGameDate = nextGameDate;
      const result = await settleDate(expectedGameDate);
      if (result.game_date !== expectedGameDate) {
        throw new Error('The server settled a different date than requested.');
      }
      if (result.next_game_date !== null && result.next_game_date <= expectedGameDate) {
        throw new Error('The server replay clock did not move forward.');
      }

      completedDates += 1;
      lastSettledDate = result.game_date;
      nextGameDate = result.next_game_date;
      onProgress?.({ completedDates, lastSettledDate, nextGameDate });

      if (result.is_complete !== (nextGameDate === null)) {
        throw new Error('The server returned an inconsistent replay completion state.');
      }
    }
  } catch (error) {
    throw new SeasonReplayError(
      completedDates > 0
        ? `${completedDates} game dates were saved before the replay stopped. Refresh and resume from the next server date.`
        : 'The season replay could not start. Refresh and try again.',
      completedDates,
      { cause: error },
    );
  }

  return {
    completedDates,
    lastSettledDate,
    nextGameDate,
    isComplete: true,
  };
}
