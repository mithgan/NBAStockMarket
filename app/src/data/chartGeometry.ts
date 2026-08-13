import type { ChartCoordinate } from './marketPresentation';

/**
 * Index of the plotted point nearest to a pointer position, or null when there
 * is nothing to snap to. Scrub readouts must always name a night that actually
 * happened, so the pointer never reads between points — it snaps to the closest
 * one. The x offset is clamped into the surface first so a pointer skimming
 * just past either edge still resolves to the edge point instead of nothing.
 */
export function nearestPointIndex(
  points: readonly ChartCoordinate[],
  offsetX: number,
  width: number,
): number | null {
  if (points.length === 0 || width <= 0) return null;

  const clampedX = Math.max(0, Math.min(width, offsetX));
  let nearest = 0;
  let smallestDistance = Infinity;
  points.forEach((point, index) => {
    const distance = Math.abs(point.x - clampedX);
    if (distance < smallestDistance) {
      smallestDistance = distance;
      nearest = index;
    }
  });
  return nearest;
}
