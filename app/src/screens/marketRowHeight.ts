export const BASE_MARKET_ROW_HEIGHT = 68;
export const BASE_MARKET_ACTION_WIDTH = 76;

/**
 * Row geometry stops growing at 2x, so row text is capped at the same multiple.
 * Without this, text keeps scaling past the container and clips.
 */
export const MAX_ROW_FONT_SCALE = 2;

function clampScale(fontScale: number): number {
  const scale = Number.isFinite(fontScale) ? fontScale : 1;
  return Math.min(Math.max(scale, 1), MAX_ROW_FONT_SCALE);
}

/**
 * Market rows are fixed-height so the list can virtualize ~300 listings through
 * getItemLayout, but the height has to follow the OS text-size setting or
 * enlarged copy gets clipped. Capped at 2x so one row can never fill the screen,
 * and floored at 1x so the row never drops below the 44px touch target.
 */
export function marketRowHeight(fontScale: number): number {
  return Math.round(BASE_MARKET_ROW_HEIGHT * clampScale(fontScale));
}

/**
 * The action column is one shared width so BUY / SELL / SOLD OUT / BOOSTED line
 * up down 300 rows, and it grows with the text-size setting so longer status
 * labels are not truncated.
 *
 * It is also bounded by a share of the row width: unbounded growth would let a
 * 2x action column eat a narrow (320px) row and squeeze the player name — the
 * row's primary identifier — down to nothing.
 */
export function marketActionWidth(fontScale: number, availableWidth?: number): number {
  const scaled = Math.round(BASE_MARKET_ACTION_WIDTH * clampScale(fontScale));
  if (!Number.isFinite(availableWidth) || (availableWidth as number) <= 0) return scaled;
  const ceiling = Math.round((availableWidth as number) * 0.3);
  return Math.max(BASE_MARKET_ACTION_WIDTH, Math.min(scaled, ceiling));
}
