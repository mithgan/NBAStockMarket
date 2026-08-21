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

/**
 * Vertical position for a comparison baseline within a chart's plotted range.
 * A baseline outside that range is omitted rather than drawn over unrelated
 * data. Flat series are the important edge case: only the same value belongs
 * on the line.
 */
export function baselineYPosition(
  values: readonly number[],
  baseline: number,
  height: number,
): number | null {
  if (values.length === 0 || height <= 0) return null;

  const high = Math.max(...values);
  const low = Math.min(...values);
  const span = high - low;
  if (span === 0) return baseline === high ? height / 2 : null;
  if (baseline <= low || baseline >= high) return null;
  return 12 + ((high - baseline) / span) * (height - 24);
}
