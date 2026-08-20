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

export interface EarningsWindows {
  /** Net dividends on the latest settled date. */
  tonight: number;
  /** Net dividends across the seven calendar days ending on that date. */
  week: number;
}

function isoDaysBefore(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() - days);
  return parsed.toISOString().slice(0, 10);
}

/**
 * The account's standing daily and weekly result, from the activity ledger —
 * the two numbers the top-of-screen readout carries. Dated entries only;
 * trades are dateless and never counted.
 */
export function earningsWindows(
  activity: readonly { date: string | null; cashDelta: number }[],
  latestSettledDate: string | null,
): EarningsWindows {
  if (latestSettledDate === null) return { tonight: 0, week: 0 };
  const weekStart = isoDaysBefore(latestSettledDate, 6);
  let tonight = 0;
  let week = 0;
  for (const entry of activity) {
    if (entry.date === null || entry.date > latestSettledDate) continue;
    if (entry.date === latestSettledDate) tonight += entry.cashDelta;
    if (entry.date >= weekStart) week += entry.cashDelta;
  }
  return { tonight, week };
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
