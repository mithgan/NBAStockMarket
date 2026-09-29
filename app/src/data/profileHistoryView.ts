import { humanDateWithYear } from '../copy/terms';
import type { HistoricalGame } from './playerHistory';

type HistoryAverages = Pick<HistoricalGame, 'minutes' | 'points' | 'rebounds' | 'assists'>;

export type HistorySeasonView = {
  games: HistoricalGame[];
  gameCount: number;
  averages: HistoryAverages | null;
  lowPoints: number | null;
  highPoints: number | null;
};

/** Keep the source intact and retain zero-point appearances in every average. */
export function historySeasonView(games: readonly HistoricalGame[]): HistorySeasonView {
  const ordered = [...games].sort((a, b) => a.date.localeCompare(b.date) || a.gameId.localeCompare(b.gameId));
  if (ordered.length === 0) {
    return { games: [], gameCount: 0, averages: null, lowPoints: null, highPoints: null };
  }
  const totals = ordered.reduce((sum, game) => ({
    minutes: sum.minutes + game.minutes,
    points: sum.points + game.points,
    rebounds: sum.rebounds + game.rebounds,
    assists: sum.assists + game.assists,
  }), { minutes: 0, points: 0, rebounds: 0, assists: 0 });
  return {
    games: ordered,
    gameCount: ordered.length,
    averages: {
      minutes: totals.minutes / ordered.length,
      points: totals.points / ordered.length,
      rebounds: totals.rebounds / ordered.length,
      assists: totals.assists / ordered.length,
    },
    lowPoints: Math.min(...ordered.map((game) => game.points)),
    highPoints: Math.max(...ordered.map((game) => game.points)),
  };
}

export type HistoryPointsChart = {
  points: { game: HistoricalGame; x: number; y: number }[];
  left: number;
  right: number;
  top: number;
  bottom: number;
  maxPoints: number;
  averageY: number;
};

/** One chronological position per played game; the points scale always starts at zero. */
export function historyPointsChart(
  games: readonly HistoricalGame[],
  width: number,
  height: number,
): HistoryPointsChart | null {
  const left = 28;
  const right = width - 6;
  const top = 10;
  const bottom = height - 10;
  if (!Number.isFinite(width) || !Number.isFinite(height) || right <= left || bottom <= top) return null;
  const view = historySeasonView(games);
  if (!view.averages || view.highPoints === null) return null;
  const maxPoints = Math.max(10, Math.ceil(view.highPoints / 10) * 10);
  const projectY = (value: number) => bottom - (value / maxPoints) * (bottom - top);
  return {
    left, right, top, bottom, maxPoints,
    averageY: projectY(view.averages.points),
    points: view.games.map((game, index) => ({
      game,
      x: view.gameCount === 1 ? (left + right) / 2 : left + (index / (view.gameCount - 1)) * (right - left),
      y: projectY(game.points),
    })),
  };
}

export function historyGameLabel(game: HistoricalGame): string {
  const date = humanDateWithYear(game.date);
  if (!game.opponent) return date;
  const prefix = game.venue === 'home' ? 'vs ' : game.venue === 'away' ? 'at ' : '';
  return `${date} · ${prefix}${game.opponent}`;
}
