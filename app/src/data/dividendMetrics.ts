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
  /** Nights he beat projection — the ones that actually paid. */
  paidNights: number;
  /** Sum of dividends per holder across the window. */
  total: number;
  /** Average payout per game played — null until he has played one. */
  perGame: number | null;
}

export function summarizeDividends(points: readonly TrendPoint[]): DividendSummary {
  const total = points.reduce((sum, point) => sum + point.dividend_per_holder, 0);
  return {
    gamesPlayed: points.length,
    paidNights: points.filter((point) => point.dividend_per_holder > 0).length,
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
 * What settled after `sinceDate` did to this account — the while-you-were-away
 * greeting's arithmetic, straight from authoritative settlement summaries.
 */
export function settlementRecapSince(
  settlements: readonly { game_date: string; current_user_dividend_cents: number }[],
  sinceDate: string | null,
  throughDate: string,
): SettlementRecap {
  const dates = new Set<string>();
  let cents = 0;
  for (const entry of settlements) {
    if (sinceDate !== null && entry.game_date <= sinceDate) continue;
    if (entry.game_date > throughDate) continue;
    dates.add(entry.game_date);
    cents += entry.current_user_dividend_cents;
  }
  return { paid: cents / 100, nights: dates.size };
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
 * The account's standing daily and weekly dividend result, from authoritative
 * settlement summaries. Boosts, shorts, fees, refunds, and trades are excluded.
 */
export function earningsWindows(
  settlements: readonly { game_date: string; current_user_dividend_cents: number }[],
  latestSettledDate: string | null,
): EarningsWindows {
  if (latestSettledDate === null) return { tonight: 0, week: 0 };
  const weekStart = isoDaysBefore(latestSettledDate, 6);
  let tonight = 0;
  let week = 0;
  for (const settlement of settlements) {
    if (settlement.game_date > latestSettledDate) continue;
    const dividend = settlement.current_user_dividend_cents / 100;
    if (settlement.game_date === latestSettledDate) tonight += dividend;
    if (settlement.game_date >= weekStart) week += dividend;
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
