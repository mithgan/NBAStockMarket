/**
 * The player profile's numbers, per game and in dollars.
 *
 * The question the profile answers is "is he worth his price, game by game?",
 * so every figure here compares what he paid on a night (his dividend) with
 * what he cost that night (his price). Nothing divides a season of dividends
 * by one game's price; nothing is a percentage.
 *
 * Two sources feed a player's nights:
 *  - practice mode's league-wide nightly history (TrendPoint), where
 *    `np × dividendRate` is that night's dividend and `dividend_per_holder` is
 *    that dividend minus his price;
 *  - otherwise the nights this account settled with him, read straight from
 *    the settled results (exact dollars, latest revision only).
 */
import type {
  PerGameMarketPlayer,
  PerGamePosition,
  PerGamePositionSide,
  PerGameSettledResult,
} from '../api/contracts';
import { gamesCount, humanDate, money, perGame, signedMoney } from '../copy/terms';
import { currentResults, lastYearEdge } from './perGameMetrics';
import {
  selectHighLowPoints,
  selectSettledTrendPoints,
  selectTrendRange,
  type TrendPoint,
  type TrendRange,
} from './trendPresentation';

export interface ProfileNight {
  date: string;
  /** What he paid that night: his dividend. */
  dividend: number;
  /** What a game of him cost that night. */
  price: number;
  /** Dividend minus price: what one roster spot netted that night. */
  net: number;
}

/** Nights from practice mode's nightly history, settled nights only, oldest first. */
export function nightsFromTrends(
  points: readonly TrendPoint[],
  dividendRate: number,
  latestSettledDate: string | null,
): ProfileNight[] {
  return selectSettledTrendPoints(points, latestSettledDate)
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((point) => {
      const dividend = Math.round(point.np * dividendRate);
      const net = Math.round(point.dividend_per_holder);
      return { date: point.date, dividend, price: dividend - net, net };
    });
}

/**
 * Nights from this account's settled results with him: latest revision only,
 * did-not-play and unsettled nights left out (nothing was paid or charged).
 * Always the roster view of the night, even for a short, because the night
 * describes the player: did he beat his price?
 */
export function nightsFromResults(
  results: readonly PerGameSettledResult[],
  latestSettledDate: string | null = null,
): ProfileNight[] {
  const byDate = new Map<string, PerGameSettledResult>();
  for (const result of currentResults(results)) {
    if (result.status !== 'settled' || result.dividendDollars === null) continue;
    if (latestSettledDate !== null && result.gameDate > latestSettledDate) continue;
    const seen = byDate.get(result.gameDate);
    if (!seen || result.eventCursor > seen.eventCursor) byDate.set(result.gameDate, result);
  }
  return [...byDate.values()]
    .sort((left, right) => left.gameDate.localeCompare(right.gameDate))
    .map((result) => ({
      date: result.gameDate,
      dividend: result.dividendDollars ?? 0,
      price: result.lockedGameCost,
      net: (result.dividendDollars ?? 0) - result.lockedGameCost,
    }));
}

export interface NightsSummary {
  games: number;
  /** Average dividend a game, or null before his first game. */
  avgPaid: number | null;
  /** Average price a game over the same nights, or null. */
  avgPrice: number | null;
  /** Average net a game for one roster spot, or null. */
  avgNet: number | null;
  /** Nights his dividend beat his price. */
  beat: number;
  /** Net over every night, for one roster spot. */
  total: number;
  best: ProfileNight | null;
  worst: ProfileNight | null;
}

export function summarizeNights(nights: readonly ProfileNight[]): NightsSummary {
  let paid = 0;
  let price = 0;
  let total = 0;
  let beat = 0;
  let best: ProfileNight | null = null;
  let worst: ProfileNight | null = null;
  for (const night of nights) {
    paid += night.dividend;
    price += night.price;
    total += night.net;
    if (night.net > 0) beat += 1;
    if (!best || night.net > best.net) best = night;
    if (!worst || night.net < worst.net) worst = night;
  }
  const games = nights.length;
  return {
    games,
    avgPaid: games > 0 ? paid / games : null,
    avgPrice: games > 0 ? price / games : null,
    avgNet: games > 0 ? total / games : null,
    beat,
    total,
    best,
    worst,
  };
}

const EVEN_BAND = 500;

/**
 * The one-sentence answer, e.g. "Beat his price in 7 of his 11 games this
 * season, $41K a game ahead on average." `recent` says the nights are only his
 * latest few ("his last 5 games") rather than his whole season.
 */
export function formVerdict(summary: NightsSummary, recent = false): string {
  const { games, beat, avgNet } = summary;
  if (games === 0 || avgNet === null) return 'No games yet this season.';
  const even = Math.abs(avgNet) < EVEN_BAND;
  if (games === 1) {
    const which = recent ? 'his last game' : 'his only game so far';
    if (even) return `About even with his price in ${which}.`;
    return `${avgNet > 0 ? 'Beat' : 'Fell short of'} his price by ${money(Math.abs(avgNet))} in ${which}.`;
  }
  const lead = `Beat his price in ${beat} of ${recent ? `his last ${games} games` : `his ${games} games this season`}`;
  if (even) return `${lead}, about even on average.`;
  return avgNet > 0
    ? `${lead}, ${money(avgNet)} a game ahead on average.`
    : `${lead}, ${money(-avgNet)} a game behind on average.`;
}

/** How his price moved over some nights: "Price went from $100K to $105K a game." */
export function priceStory(nights: readonly ProfileNight[]): string {
  if (nights.length === 0) return 'No games yet.';
  const first = nights[0].price;
  const last = nights[nights.length - 1].price;
  if (Math.round(first / 1000) === Math.round(last / 1000)) {
    return `His price held near ${perGame(last)} over ${gamesCount(nights.length)}.`;
  }
  return `His price went from ${money(first)} to ${perGame(last)} over ${gamesCount(nights.length)}.`;
}

export const RANGE_OPTIONS: { key: TrendRange; label: string; hint: string }[] = [
  { key: 'L5', label: 'L5', hint: 'Last 5 games' },
  { key: 'L15', label: 'L15', hint: 'Last 15 games' },
  { key: 'L30', label: 'L30', hint: 'Last 30 games' },
  { key: 'Season', label: 'Season', hint: 'Every game this season' },
];

export function rangeNights(nights: readonly ProfileNight[], range: TrendRange): ProfileNight[] {
  return selectTrendRange(nights, range);
}

/** True when a range shows only his latest games rather than his whole season. */
export function isRecentRange(range: TrendRange, shown: number, total: number): boolean {
  return range !== 'Season' && shown < total;
}

export interface HoldingStatus {
  /** Tag text, or null when you do not hold him. */
  tag: 'On your roster' | 'Shorted' | null;
  /** The sentence beside the tag. */
  text: string;
}

/** Your status with him, in words: on your roster at a locked price, shorted, or not held. */
export function holdingStatus(position: Pick<PerGamePosition, 'side' | 'lockedGameCost' | 'expiresOn'> | null): HoldingStatus {
  if (!position) return { tag: null, text: 'Not on your roster or shorted' };
  if (position.side === 'long') {
    return { tag: 'On your roster', text: `Locked in at ${perGame(position.lockedGameCost)}` };
  }
  const until = position.expiresOn ? `, ends ${humanDate(position.expiresOn)}` : '';
  return { tag: 'Shorted', text: `Locked in at ${perGame(position.lockedGameCost)}${until}` };
}

/** Last season, and what one game at today's price would have made then. */
export function lastSeasonFacts(
  player: Pick<PerGameMarketPlayer, 'currentGameCost' | 'priorSeasonValuePerGame'>,
  side: PerGamePositionSide,
): { worth: number | null; edge: number | null; edgeCaption: string } {
  return {
    worth: player.priorSeasonValuePerGame,
    edge: lastYearEdge(player, side),
    edgeCaption: side === 'long' ? 'a game, for a roster spot' : 'a game, for your short',
  };
}

/** Newest night first, for the game-by-game log. */
export function gameLog(nights: readonly ProfileNight[], limit?: number): ProfileNight[] {
  const newest = [...nights].reverse();
  return limit === undefined ? newest : newest.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Chart geometry

export type ProfileMetric = 'dividends' | 'price';

export interface ChartInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ChartBar {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProfileChartModel {
  /** Horizontal slot per night; night i is centred at left + (i + 0.5) × slot. */
  slot: number;
  /** One bar per night (dividends view); empty in the price view. */
  bars: ChartBar[];
  /** The value end of each night: bar top/bottom, or the price point. */
  anchors: { x: number; y: number }[];
  /** His price as a step line across each night's slot (dividends view). */
  priceStepPath: string;
  /** His price as a line through each night (price view). */
  priceLinePath: string;
  /** Where $0 sits, when it is inside the plot (dividends view). */
  zeroY: number | null;
  /** Indices of the highest and lowest values, or null when not worth labelling. */
  high: number | null;
  low: number | null;
}

/**
 * Geometry for the profile chart. The dividends view draws one bar per game
 * from $0 and his price as a dashed step line, so every bar that clears the
 * line is a game he beat his price. The price view draws his price per game.
 */
export function profileChartModel(
  nights: readonly ProfileNight[],
  metric: ProfileMetric,
  width: number,
  height: number,
  insets: ChartInsets,
): ProfileChartModel {
  const empty: ProfileChartModel = {
    slot: 0, bars: [], anchors: [], priceStepPath: '', priceLinePath: '', zeroY: null, high: null, low: null,
  };
  const count = nights.length;
  const plotWidth = width - insets.left - insets.right;
  const plotHeight = height - insets.top - insets.bottom;
  if (count === 0 || plotWidth <= 0 || plotHeight <= 0) return empty;

  const slot = plotWidth / count;
  const centre = (index: number) => insets.left + (index + 0.5) * slot;
  const values = nights.map((night) => (metric === 'price' ? night.price : night.dividend));
  const prices = nights.map((night) => night.price);

  let low: number;
  let high: number;
  if (metric === 'price') {
    low = Math.min(...prices);
    high = Math.max(...prices);
    const pad = Math.max((high - low) * 0.2, Math.abs(high) * 0.02, 1);
    low -= pad;
    high += pad;
  } else {
    low = Math.min(0, ...values, ...prices);
    high = Math.max(0, ...values, ...prices);
    if (high === low) high = low + 1;
  }
  const y = (value: number) => insets.top + ((high - value) / (high - low)) * plotHeight;

  const bars: ChartBar[] = [];
  const anchors: { x: number; y: number }[] = [];
  let zeroY: number | null = null;
  if (metric === 'dividends') {
    zeroY = y(0);
    const barWidth = Math.max(1.5, Math.min(22, slot * 0.72));
    values.forEach((value, index) => {
      const top = Math.min(y(value), zeroY as number);
      const bottom = Math.max(y(value), zeroY as number);
      const barHeight = Math.max(1.5, bottom - top);
      bars.push({
        x: insets.left + index * slot + (slot - barWidth) / 2,
        y: value >= 0 ? bottom - barHeight : top,
        width: barWidth,
        height: barHeight,
      });
      anchors.push({ x: centre(index), y: y(value) });
    });
  } else {
    values.forEach((value, index) => anchors.push({ x: centre(index), y: y(value) }));
  }

  const priceStepPath = prices
    .map((price, index) => {
      const start = insets.left + index * slot;
      return `${index === 0 ? 'M' : 'L'} ${start} ${y(price)} L ${start + slot} ${y(price)}`;
    })
    .join(' ');
  const priceLinePath = prices
    .map((price, index) => `${index === 0 ? 'M' : 'L'} ${centre(index)} ${y(price)}`)
    .join(' ');

  const extrema = selectHighLowPoints(values);
  const flat = Math.max(...values) === Math.min(...values);
  const labelled = count >= 5 && !flat;

  return {
    slot,
    bars,
    anchors,
    priceStepPath,
    priceLinePath,
    zeroY,
    high: labelled ? extrema.high?.index ?? null : null,
    low: labelled ? extrema.low?.index ?? null : null,
  };
}

/** The night under a pointer at `x`, clamped to the plotted nights. */
export function nightIndexAt(x: number, slot: number, left: number, count: number): number | null {
  if (count === 0 || slot <= 0) return null;
  return Math.max(0, Math.min(count - 1, Math.floor((x - left) / slot)));
}

/** Screen-reader summary of what the chart shows. */
export function chartSummary(nights: readonly ProfileNight[], metric: ProfileMetric): string {
  if (nights.length === 0) return 'No games yet.';
  const values = nights.map((night) => (metric === 'price' ? night.price : night.dividend));
  const { high, low } = selectHighLowPoints(values);
  const highNight = high ? nights[high.index] : null;
  const lowNight = low ? nights[low.index] : null;
  const range = highNight && lowNight
    ? ` High ${money(high!.value)} on ${humanDate(highNight.date)}, low ${money(low!.value)} on ${humanDate(lowNight.date)}.`
    : '';
  if (metric === 'price') return `His price a game over ${gamesCount(nights.length)}.${range}`;
  const summary = summarizeNights(nights);
  return `What he paid each game against his price, over ${gamesCount(nights.length)}. He beat his price in ${summary.beat} of them.${range}`;
}

/** The chart's read-out for one night: "Paid $186K · price $105K · +$81K". */
export function nightReadout(night: ProfileNight, metric: ProfileMetric): string {
  if (metric === 'price') return `Price ${perGame(night.price)}`;
  return `Paid ${money(night.dividend)} · price ${money(night.price)} · ${signedMoney(night.net)}`;
}
