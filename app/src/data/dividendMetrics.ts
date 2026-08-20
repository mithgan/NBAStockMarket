import type { TrendPoint } from './trendPresentation';

/**
 * The value-language core (after "From Impact to Winning"): a payout stream is
 * read as rate × exposure = total, never as one undifferentiated number.
 *
 * - `perGame` is the rate: what he pays per night he actually plays.
 * - `gamesPlayed` is the exposure: how many nights that rate applied.
 * - `total` is what the window banked — the only one the ledger records.
 *
 * Everything here is pure arithmetic over settled rows; formatting and
 * baselines are the caller's business.
 */
export interface DividendSummary {
  /** Settled games the player actually appeared in over the window. */
  gamesPlayed: number;
  /** Sum of dividends per holder across the window. */
  total: number;
  /** Average payout per game played — null until he has played one. */
  perGame: number | null;
}

export function summarizeDividends(points: readonly TrendPoint[]): DividendSummary {
  const total = points.reduce((sum, point) => sum + point.dividend_per_holder, 0);
  return {
    gamesPlayed: points.length,
    total,
    perGame: points.length === 0 ? null : total / points.length,
  };
}

/**
 * Window payout per dollar of share price — the "vs contract" of this market:
 * a salary buys wins, a share price buys dividends. Fraction, not percent;
 * null when the price cannot carry a yield.
 */
export function dividendYield(total: number, price: number): number | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  return total / price;
}

export interface SettlementRecap {
  /** Net dollars the settlements paid this account since the cutoff. */
  paid: number;
  /** Distinct settled dates in that span. */
  nights: number;
}

/**
 * What the newly settled nights did to this account, straight from the
 * activity ledger: every dated entry after `sinceDate`, summed. This is the
 * figure the notice banner leads with — the money is the message; the
 * mechanical "N game dates settled" is only the fallback.
 */
export function settlementRecapSince(
  activity: readonly { game_date: string | null; amount_cents: number }[],
  sinceDate: string | null,
): SettlementRecap {
  const dates = new Set<string>();
  let cents = 0;
  for (const entry of activity) {
    if (entry.game_date === null) continue;
    if (sinceDate !== null && entry.game_date <= sinceDate) continue;
    dates.add(entry.game_date);
    cents += entry.amount_cents;
  }
  return { paid: cents / 100, nights: dates.size };
}

/**
 * The average-payer baseline: mean per-game payout across every listed player
 * who has played at least once in the window. The 50%-line of this market —
 * a number only means something against a named comparison.
 */
export function marketAverageRate(
  trendsByPlayer: readonly (readonly TrendPoint[])[],
): number | null {
  const rates = trendsByPlayer
    .map((points) => summarizeDividends(points).perGame)
    .filter((rate): rate is number => rate !== null);
  if (rates.length === 0) return null;
  return rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
}
