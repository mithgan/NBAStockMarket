/**
 * The player profile's numbers, per game and in dollars.
 *
 * The question the profile answers is "is he worth his price, game by game?",
 * so every figure compares his dividend on a night with what a game of him
 * cost that night. Nothing divides a season of dividends by one game's price;
 * nothing is a percentage.
 *
 * Two rules keep the profile honest with the Roster and Results screens:
 *
 *  - It reads from the side you look at him from. On your roster (or from the
 *    Roster tab) a game nets his dividend minus his price; as a short (or from
 *    the Short tab) it nets the price you are credited minus his dividend.
 *    Green and red always mean gain and loss for that side.
 *  - A night you held him on that side is your settled result, at the price you
 *    locked in: the same numbers Results shows. Any other night is his market
 *    price that night, and is labelled as such.
 */
import type {
  PerGameMarketPlayer,
  PerGamePosition,
  PerGamePositionSide,
  PerGameSettledResult,
} from '../api/contracts';
import { gamesCount, humanDate, money, moneyFine, signedMoneyFine } from '../copy/terms';
import { currentResults, lastYearEdge, type ValueSummary } from './perGameMetrics';
import {
  selectHighLowPoints,
  selectSettledTrendPoints,
  selectTrendRange,
  type TrendPoint,
  type TrendRange,
} from './trendPresentation';

/** Where a night's price comes from: your locked price, or his market price that night. */
export type NightSource = 'yours' | 'market';

export interface ProfileNight {
  date: string;
  /** His dividend that night (can be negative after a bad game). */
  dividend: number;
  /** What a game of him cost: the price on a roster, the credit on a short. */
  price: number;
  /** What that night made from the side you look from. */
  net: number;
  source: NightSource;
}

/** A night's net from one side: a roster spot keeps dividend − price, a short keeps price − dividend. */
export function sideNet(side: PerGamePositionSide, dividend: number, price: number): number {
  return side === 'long' ? dividend - price : price - dividend;
}

/**
 * Every settled night he played, oldest first, from the side you look from.
 *
 * Your settled results on that side come first (your locked price, your net,
 * latest revision only; did-not-play and unsettled nights are skipped because
 * nothing was paid or charged). Practice mode's league history fills in every
 * other night at his market price. Outside practice there is no league
 * history, so the only other nights are your results from the other side,
 * read at the price you held him at.
 */
export function buildProfileNights({
  results,
  trends,
  dividendRate,
  latestSettledDate,
  side,
}: {
  results: readonly PerGameSettledResult[];
  /** Practice mode's league-wide nightly history; undefined outside practice. */
  trends: readonly TrendPoint[] | undefined;
  dividendRate: number;
  latestSettledDate: string | null;
  side: PerGamePositionSide;
}): ProfileNight[] {
  const yours = new Map<string, ProfileNight>();
  const otherSide = new Map<string, ProfileNight>();
  for (const result of currentResults(results)) {
    if (result.status !== 'settled' || result.dividendDollars === null) continue;
    if (latestSettledDate !== null && result.gameDate > latestSettledDate) continue;
    const dividend = result.dividendDollars;
    const price = result.lockedGameCost;
    if (result.side === side) {
      yours.set(result.gameDate, {
        date: result.gameDate,
        dividend,
        price,
        net: result.netPnl ?? sideNet(side, dividend, price),
        source: 'yours',
      });
    } else {
      otherSide.set(result.gameDate, {
        date: result.gameDate,
        dividend,
        price,
        net: sideNet(side, dividend, price),
        source: 'market',
      });
    }
  }
  const market = new Map<string, ProfileNight>();
  if (trends !== undefined) {
    for (const point of selectSettledTrendPoints(trends, latestSettledDate)) {
      if (yours.has(point.date)) continue;
      const dividend = Math.round(point.np * dividendRate);
      const price = dividend - Math.round(point.dividend_per_holder);
      market.set(point.date, { date: point.date, dividend, price, net: sideNet(side, dividend, price), source: 'market' });
    }
  } else {
    for (const [date, night] of otherSide) if (!yours.has(date)) market.set(date, night);
  }
  return [...yours.values(), ...market.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export interface NightsSummary {
  games: number;
  /** Average dividend a game, or null before his first game. */
  avgDividend: number | null;
  /** Average price (credit, for a short) a game over the same nights, or null. */
  avgPrice: number | null;
  /** Average net a game from the side you look from, or null. */
  avgNet: number | null;
  /** Nights that side came out ahead: he beat his price, or stayed under it for a short. */
  beat: number;
  /** Net over every night. */
  total: number;
  best: ProfileNight | null;
  worst: ProfileNight | null;
  /** How many of the nights are your own results. */
  yours: number;
}

export function summarizeNights(nights: readonly ProfileNight[]): NightsSummary {
  let dividends = 0;
  let prices = 0;
  let total = 0;
  let beat = 0;
  let yours = 0;
  let best: ProfileNight | null = null;
  let worst: ProfileNight | null = null;
  for (const night of nights) {
    dividends += night.dividend;
    prices += night.price;
    total += night.net;
    if (night.net > 0) beat += 1;
    if (night.source === 'yours') yours += 1;
    if (!best || night.net > best.net) best = night;
    if (!worst || night.net < worst.net) worst = night;
  }
  const games = nights.length;
  return {
    games,
    avgDividend: games > 0 ? dividends / games : null,
    avgPrice: games > 0 ? prices / games : null,
    avgNet: games > 0 ? total / games : null,
    beat,
    total,
    best,
    worst,
    yours,
  };
}

const EVEN_BAND = 500;

export interface VerdictOptions {
  /** The nights are only his latest few ("his last 5 games"). */
  recent?: boolean;
  side?: PerGamePositionSide;
  /** You hold him on this side now. */
  held?: boolean;
  /**
   * 'season': every game he played (practice has the whole league's history).
   * 'yours': only games you held him (outside practice, the only history there is).
   */
  scope?: 'season' | 'yours';
}

/**
 * The one-sentence answer, from the side you look from, e.g. "Beat his price
 * in 8 of his 11 games this season, $146K a game ahead on average." or
 * "Stayed under his price in 2 of his 3 games this season, $126K a game ahead
 * on average for your short."
 */
export function formVerdict(summary: NightsSummary, options: VerdictOptions = {}): string {
  const { recent = false, side = 'long', held = false, scope = 'season' } = options;
  const { games, beat, avgNet } = summary;
  if (games === 0 || avgNet === null) {
    return scope === 'yours' ? 'No games with you yet.' : 'No games yet this season.';
  }
  const even = Math.abs(avgNet) < EVEN_BAND;
  const forWho = side === 'long' ? '' : held ? ' for your short' : ' for a short';
  if (games === 1) {
    const which = scope === 'yours'
      ? recent ? 'your last game with him' : 'your only game with him'
      : recent ? 'his last game' : 'his only game so far';
    if (even) return `About even with his price in ${which}.`;
    const good = avgNet > 0;
    const verb = side === 'long'
      ? good ? 'Beat' : 'Missed'
      : good ? 'Stayed under' : 'Went over';
    return `${verb} his price by ${moneyFine(Math.abs(avgNet))} in ${which}.`;
  }
  const count = scope === 'yours'
    ? recent ? `your last ${games} games with him` : `your ${games} games with him`
    : recent ? `his last ${games} games` : `his ${games} games this season`;
  const lead = `${side === 'long' ? 'Beat' : 'Stayed under'} his price in ${beat} of ${count}`;
  if (even) return `${lead}, about even on average${forWho}.`;
  return `${lead}, ${moneyFine(Math.abs(avgNet))} a game ${avgNet > 0 ? 'ahead' : 'behind'} on average${forWho}.`;
}

/** Labels for the side you look from, so a short never reads as a roster spot. */
export function sideWords(side: PerGamePositionSide): {
  price: 'Price a game' | 'Credit a game';
  priceShort: 'price' | 'credit';
  netCaption: string;
  beat: 'Beat his price' | 'Under his price';
  missedCaption: (count: number) => string;
  legendGood: string;
  legendBad: string;
  legendLine: string;
} {
  return side === 'long'
    ? {
        price: 'Price a game',
        priceShort: 'price',
        netCaption: 'dividend minus price',
        beat: 'Beat his price',
        missedCaption: (count) => (count === 0 ? 'every game' : `missed ${count}`),
        legendGood: 'Beat his price',
        legendBad: 'Missed his price',
        legendLine: 'Price a game',
      }
    : {
        price: 'Credit a game',
        priceShort: 'credit',
        netCaption: 'credit minus dividend',
        beat: 'Under his price',
        missedCaption: (count) => (count === 0 ? 'every game' : `over ${count}`),
        legendGood: 'Under his price',
        legendBad: 'Over his price',
        legendLine: 'Credit a game',
      };
}

/** What the "price a game" figure is made of: your locked price, his market price, or both. */
export function priceSourceCaption(summary: Pick<NightsSummary, 'games' | 'yours'>, side: PerGamePositionSide): string {
  const yourWord = side === 'long' ? 'your price' : 'your credit';
  if (summary.games === 0) return '';
  if (summary.yours === summary.games) return yourWord;
  if (summary.yours === 0) return 'his market price';
  return 'average of both';
}

/**
 * Which of the shown games were yours, when they are a mix: "These 11 games:
 * 2 with you at $169K, 9 at his market price." Null when every game is yours
 * or none is, since the price caption already says so.
 */
export function mixNote(nights: readonly ProfileNight[], side: PerGamePositionSide): string | null {
  const yours = nights.filter((night) => night.source === 'yours');
  if (yours.length === 0 || yours.length === nights.length) return null;
  const prices = new Set(yours.map((night) => Math.round(night.price)));
  const at = prices.size === 1
    ? `at ${moneyFine(yours[0].price)}`
    : `at your locked ${side === 'long' ? 'prices' : 'credits'}`;
  const market = nights.length - yours.length;
  return `These ${gamesCount(nights.length)}: ${yours.length} with you ${at}, ${market} at his market ${side === 'long' ? 'price' : 'credit'}.`;
}

export interface StatusNight {
  date: string;
  /** Did not play (nothing charged), or played but not settled yet. */
  kind: 'dnp' | 'pending';
}

/**
 * Your nights with him that have no money to show: verified did-not-play
 * nights and games still waiting to settle, on the side you look from. They
 * stay out of the chart and the averages but keep their line in the log.
 */
export function statusNights(results: readonly PerGameSettledResult[], side: PerGamePositionSide): StatusNight[] {
  const byDate = new Map<string, StatusNight>();
  for (const result of currentResults(results)) {
    if (result.side !== side) continue;
    if (result.status === 'verified_dnp') byDate.set(result.gameDate, { date: result.gameDate, kind: 'dnp' });
    else if (result.status !== 'settled' || result.dividendDollars === null) {
      byDate.set(result.gameDate, { date: result.gameDate, kind: 'pending' });
    }
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

/** "Did not play 1 night (nothing charged) · 2 games waiting to settle", or null. */
export function unsettledNote(summary: Pick<ValueSummary, 'dnp' | 'pending'>): string | null {
  const parts: string[] = [];
  if (summary.dnp > 0) parts.push(`Did not play ${summary.dnp === 1 ? '1 night' : `${summary.dnp} nights`} (nothing charged)`);
  if (summary.pending > 0) parts.push(`${gamesCount(summary.pending)} waiting to settle`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export type LogRow =
  | { kind: 'game'; night: ProfileNight }
  | { kind: 'dnp' | 'pending'; date: string };

/** The game log, newest first: settled games with their money, and the nights that have none. */
export function logRows(nights: readonly ProfileNight[], status: readonly StatusNight[], limit?: number): LogRow[] {
  const rows: LogRow[] = [
    ...nights.map((night) => ({ kind: 'game' as const, night })),
    ...status.map((night) => ({ kind: night.kind, date: night.date })),
  ];
  const dateOf = (row: LogRow) => (row.kind === 'game' ? row.night.date : row.date);
  rows.sort((left, right) => dateOf(right).localeCompare(dateOf(left)));
  return limit === undefined ? rows : rows.slice(0, limit);
}

/** The game log's price column header. */
export function logPriceHeader(nights: readonly ProfileNight[], side: PerGamePositionSide): string {
  const yours = nights.filter((night) => night.source === 'yours').length;
  if (nights.length > 0 && yours === nights.length) return side === 'long' ? 'Your price' : 'Your credit';
  if (yours === 0) return 'Market price';
  return side === 'long' ? 'Price' : 'Credit';
}

/** "your price" / "your credit" / "market price", for the chart read-out. */
export function nightSourceLabel(night: Pick<ProfileNight, 'source'>, side: PerGamePositionSide): string {
  if (night.source === 'market') return 'market price';
  return side === 'long' ? 'your price' : 'your credit';
}

export const RANGE_OPTIONS: { key: TrendRange; label: string; hint: string }[] = [
  { key: 'L5', label: 'L5', hint: 'Last 5 games' },
  { key: 'L15', label: 'L15', hint: 'Last 15 games' },
  { key: 'L30', label: 'L30', hint: 'Last 30 games' },
  { key: 'Season', label: 'Season', hint: 'Every game this season' },
];

/**
 * The range choices for a width. Four tabs in a 195px sheet (a phone at 200%
 * zoom) leave 44px each, too narrow for "Season", so it reads "All" there.
 */
export function rangeOptions(narrow: boolean): { key: TrendRange; label: string; hint: string }[] {
  return narrow
    ? RANGE_OPTIONS.map((option) => (option.key === 'Season' ? { ...option, label: 'All' } : option))
    : RANGE_OPTIONS;
}

export function rangeNights(nights: readonly ProfileNight[], range: TrendRange): ProfileNight[] {
  return selectTrendRange(nights, range);
}

/** True when a range shows only his latest games rather than all of them. */
export function isRecentRange(range: TrendRange, shown: number, total: number): boolean {
  return range !== 'Season' && shown < total;
}

/** How his price moved over some nights, in plain words. */
export function priceStory(nights: readonly ProfileNight[], side: PerGamePositionSide = 'long'): string {
  if (nights.length === 0) return 'No games yet.';
  const word = side === 'long' ? 'price' : 'credit';
  const first = nights[0].price;
  const last = nights[nights.length - 1].price;
  const yours = nights.filter((night) => night.source === 'yours').length;
  const note = yours === 0 ? '' : yours === nights.length ? ` (your locked ${word})` : ` (your locked ${word} in ${yours})`;
  if (Math.round(first / 1000) === Math.round(last / 1000)) {
    return `His ${word} held near ${moneyFine(last)} a game over ${gamesCount(nights.length)}${note}.`;
  }
  return `His ${word} went from ${moneyFine(first)} to ${moneyFine(last)} a game over ${gamesCount(nights.length)}${note}.`;
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
    return { tag: 'On your roster', text: `Locked in at ${moneyFine(position.lockedGameCost)} a game` };
  }
  const until = position.expiresOn ? `, ends ${humanDate(position.expiresOn)}` : '';
  return { tag: 'Shorted', text: `Credited ${moneyFine(position.lockedGameCost)} a game${until}` };
}

export type StakeTone = 'gain' | 'loss' | 'even' | 'none';

/**
 * Your money with him in one line: the current position when you hold him
 * (the same numbers as its Roster row), otherwise every past stint.
 */
export function stakeLine(summary: Pick<ValueSummary, 'games' | 'total'>, held: boolean): {
  lead: string;
  total: string | null;
  tone: StakeTone;
} | null {
  if (summary.games === 0) return held ? { lead: 'No games yet at this price', total: null, tone: 'none' } : null;
  const tone: StakeTone = Math.abs(summary.total) < EVEN_BAND ? 'even' : summary.total > 0 ? 'gain' : 'loss';
  return {
    lead: held ? `${gamesCount(summary.games)} with you ·` : `Before: ${gamesCount(summary.games)} with you ·`,
    total: `${signedMoneyFine(summary.total)} total`,
    tone,
  };
}

/** Last season, and what one game at today's price would have made then from this side. */
export function lastSeasonFacts(
  player: Pick<PerGameMarketPlayer, 'currentGameCost' | 'priorSeasonValuePerGame'>,
  side: PerGamePositionSide,
): { worth: number | null; edge: number | null; edgeCaption: string } {
  const now = money(player.currentGameCost);
  return {
    worth: player.priorSeasonValuePerGame,
    edge: lastYearEdge(player, side),
    edgeCaption: side === 'long' ? `a game, against ${now} now` : `a game for a short, against ${now} now`,
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

/** The next night a key moves to on the chart slider, or null for other keys. */
export function steppedIndex(key: string, current: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      return Math.max(0, current - 1);
    case 'ArrowRight':
    case 'ArrowUp':
      return Math.min(count - 1, current + 1);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/** Screen-reader summary of what the chart shows. */
export function chartSummary(
  nights: readonly ProfileNight[],
  metric: ProfileMetric,
  side: PerGamePositionSide = 'long',
): string {
  if (nights.length === 0) return 'No games yet.';
  const words = sideWords(side);
  const values = nights.map((night) => (metric === 'price' ? night.price : night.dividend));
  const { high, low } = selectHighLowPoints(values);
  const highNight = high ? nights[high.index] : null;
  const lowNight = low ? nights[low.index] : null;
  const range = highNight && lowNight
    ? ` High ${moneyFine(high!.value)} on ${humanDate(highNight.date)}, low ${moneyFine(low!.value)} on ${humanDate(lowNight.date)}.`
    : '';
  if (metric === 'price') return `His ${words.priceShort} a game over ${gamesCount(nights.length)}.${range}`;
  const summary = summarizeNights(nights);
  const tally = side === 'long'
    ? `He beat his price in ${summary.beat} of them.`
    : `He stayed under his price in ${summary.beat} of them, which is what a short wants.`;
  return `His dividend each game against his price, over ${gamesCount(nights.length)}. ${tally}${range}`;
}

/** The chart's read-out for one night: "Dividend $324K · price $104K · +$220K". */
export function nightReadout(night: ProfileNight, metric: ProfileMetric, side: PerGamePositionSide = 'long'): string {
  const words = sideWords(side);
  if (metric === 'price') return `${side === 'long' ? 'Price' : 'Credit'} ${moneyFine(night.price)} a game`;
  return `Dividend ${moneyFine(night.dividend)} · ${words.priceShort} ${moneyFine(night.price)} · ${signedMoneyFine(night.net)}`;
}
