/**
 * Watchlist lines have different history lengths. Align their latest values to
 * the shared right edge so the axis and scrubber both mean "latest game."
 */
export function alignedAxisIndex(
  localIndex: number,
  seriesLength: number,
  axisLength: number,
): number {
  return Math.max(axisLength - seriesLength, 0) + localIndex;
}

/** Local series index at a shared-axis position, or null before it begins. */
export function localSeriesIndex(
  axisIndex: number,
  seriesLength: number,
  axisLength: number,
): number | null {
  const localIndex = axisIndex - Math.max(axisLength - seriesLength, 0);
  return localIndex >= 0 && localIndex < seriesLength ? localIndex : null;
}
