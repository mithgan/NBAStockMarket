import type { TrendPoint } from './trendPresentation';

export function formatOwnership(ownershipBps: number | undefined): string {
  if (!Number.isFinite(ownershipBps)) return 'Ownership unavailable';
  const percentage = Math.max(0, Math.min(10_000, ownershipBps!)) / 100;
  const formatted = Number.isInteger(percentage)
    ? percentage.toFixed(0)
    : percentage.toFixed(1);
  return `${formatted}% owned`;
}

/** Bare percentage for a column that is already headed OWNED. */
export function formatOwnershipShort(ownershipBps: number | undefined): string {
  if (!Number.isFinite(ownershipBps)) return '-';
  const percentage = Math.max(0, Math.min(10_000, ownershipBps!)) / 100;
  return `${Number.isInteger(percentage) ? percentage.toFixed(0) : percentage.toFixed(1)}%`;
}

export function formatTradeVolume(volume30d: number | undefined): string {
  if (!Number.isFinite(volume30d)) return 'Activity unavailable';
  const volume = Math.max(0, Math.round(volume30d!));
  return `${volume.toLocaleString('en-US')} ${volume === 1 ? 'trade' : 'trades'} / 30d`;
}

export function priceChangePercent(currentPrice: number, openingPrice: number): number | null {
  if (!Number.isFinite(currentPrice) || !Number.isFinite(openingPrice) || openingPrice <= 0) {
    return null;
  }
  return ((currentPrice - openingPrice) / openingPrice) * 100;
}

export function metricDirection(value: number): -1 | 0 | 1 {
  if (Math.abs(value) < 0.05) return 0;
  return value > 0 ? 1 : -1;
}

export function formatSignedPercent(value: number): string {
  const direction = metricDirection(value);
  if (direction === 0) return '0.0%';
  return `${direction > 0 ? '+' : '-'}${Math.abs(value).toFixed(1)}%`;
}

export function formatSignedMetric(value: number): string {
  const direction = metricDirection(value);
  if (direction === 0) return '0.0';
  return `${direction > 0 ? '+' : '-'}${Math.abs(value).toFixed(1)}`;
}

export function recentForm(points: readonly TrendPoint[]): {
  games: number;
  averageSurprise: number;
} | null {
  const visible = points.slice(-5);
  if (visible.length === 0) return null;
  const totalSurprise = visible.reduce(
    (sum, point) => sum + point.np - point.expected_np,
    0,
  );
  return {
    games: visible.length,
    averageSurprise: totalSurprise / visible.length,
  };
}

export interface ChartCoordinate {
  x: number;
  y: number;
}

export function lineChartCoordinates(
  values: readonly number[],
  width: number,
  height: number,
  inset = 3,
): ChartCoordinate[] {
  if (values.length === 0 || width <= inset * 2 || height <= inset * 2) return [];
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum;
  const centerY = height / 2;
  return values.map((value, index) => ({
    // A single point sits in the middle of the surface, not on the left inset,
    // so a one-game series still reads as a deliberate mark.
    x: values.length === 1
      ? width / 2
      : inset + (index / (values.length - 1)) * (width - inset * 2),
    y: span === 0
      ? centerY
      : inset + ((maximum - value) / span) * (height - inset * 2),
  }));
}

/**
 * Below this many points the midpoint-bezier smoothing invents curvature that
 * the data does not have, so sparse series fall back to honest straight
 * segments.
 */
const SMOOTH_MIN_POINTS = 5;

export function smoothLinePath(coordinates: readonly ChartCoordinate[]): string {
  if (coordinates.length === 0) return '';
  const start = `M ${coordinates[0].x} ${coordinates[0].y}`;
  if (coordinates.length < SMOOTH_MIN_POINTS) {
    return coordinates.slice(1).reduce((path, point) => `${path} L ${point.x} ${point.y}`, start);
  }
  return coordinates.slice(1).reduce((path, point, index) => {
    const previous = coordinates[index];
    const middleX = (previous.x + point.x) / 2;
    return `${path} C ${middleX} ${previous.y}, ${middleX} ${point.y}, ${point.x} ${point.y}`;
  }, start);
}

/**
 * Average surprise (actual minus projected net points) over the last
 * `games` settled games, or over the whole settled season when `games` is
 * null. This is the number behind the market's Trending sort, so the window
 * definition has to live in one place.
 */
export function windowSurprise(
  points: readonly TrendPoint[],
  games: number | null,
): number | null {
  const visible = games === null ? points : points.slice(-games);
  if (visible.length === 0) return null;
  return (
    visible.reduce((sum, point) => sum + point.np - point.expected_np, 0) / visible.length
  );
}

/**
 * How much a player's last five games have out- or under-performed the ten
 * games before them, in surprise per game. Needs at least eight settled games
 * so the baseline holds three or more — with less than that, "momentum" would
 * just be noise wearing a trend's clothes.
 */
export function playerMomentum(points: readonly TrendPoint[]): number | null {
  if (points.length < 8) return null;
  const surprise = (point: TrendPoint) => point.np - point.expected_np;
  const mean = (values: number[]) =>
    values.reduce((sum, value) => sum + value, 0) / values.length;
  const recent = points.slice(-5).map(surprise);
  const baseline = points.slice(Math.max(0, points.length - 5 - 10), -5).map(surprise);
  if (baseline.length === 0) return null;
  return mean(recent) - mean(baseline);
}
