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
  PerGameLedgerEntry,
  PerGameMarketPlayer,
  PerGamePosition,
  PerGamePositionSide,
  PerGameSettledResult,
} from '../api/contracts';
import { gamesCount, humanDate, money, moneyFine, perGame, signedMoneyFine } from '../copy/terms';
import { shownEdge } from './marketView';
import { PRICE_EXPLAINER } from './perGameRules';
import { currentResults, entryDay, lastYearEdge, type ValueSummary } from './perGameMetrics';
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
  /** What a game of him cost: his price (a short is credited it). */
  price: number;
  /** What that night made from the side you look from. */
  net: number;
  source: NightSource;
  /**
   * His market price that night, when practice history has it (also on the
   * nights you held him at your locked price), so the Price view can plot the
   * market against your line. Absent outside practice.
   */
  market?: number;
}

/** A night's net from one side: a roster spot keeps dividend − price, a short keeps price − dividend. */
export function sideNet(side: PerGamePositionSide, dividend: number, price: number): number {
  return side === 'long' ? dividend - price : price - dividend;
}

/**
 * The side the whole profile reads from. A player you hold reads from the
 * side you hold him on. Otherwise it is the side the action bar offers: the
 * market tab he was opened from, until "Short instead" or "Add instead"
 * switches the bar (`switched`). Every side-dependent figure (each game's net,
 * the verdict, last season's value, the labels) then reads exactly as if he
 * had been opened from that tab, so a short is never judged by a roster
 * spot's numbers (walk 4 T1-03).
 */
export function profileSide(
  position: Pick<PerGamePosition, 'side'> | null,
  opened: PerGamePositionSide | undefined,
  switched: PerGamePositionSide | null = null,
): PerGamePositionSide {
  return position?.side ?? switched ?? opened ?? 'long';
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
  // His market price each settled night, from practice history.
  const marketByDate = new Map<string, number>();
  for (const point of trends === undefined ? [] : selectSettledTrendPoints(trends, latestSettledDate)) {
    marketByDate.set(point.date, Math.round(point.np * dividendRate) - Math.round(point.dividend_per_holder));
  }
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
        ...(marketByDate.has(result.gameDate) ? { market: marketByDate.get(result.gameDate) } : {}),
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
      market.set(point.date, { date: point.date, dividend, price, net: sideNet(side, dividend, price), source: 'market', market: price });
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
  /** Average price a game over the same nights, or null. */
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
  /**
   * How many different locked prices your nights carry, as the
   * reader sees them: more than one after a drop and re-add, when the average
   * mixes two stints.
   */
  yourPrices: number;
}

export function summarizeNights(nights: readonly ProfileNight[]): NightsSummary {
  let dividends = 0;
  let prices = 0;
  let total = 0;
  let beat = 0;
  let yours = 0;
  const yourPrices = new Set<string>();
  let best: ProfileNight | null = null;
  let worst: ProfileNight | null = null;
  for (const night of nights) {
    dividends += night.dividend;
    prices += night.price;
    total += night.net;
    if (night.net > 0) beat += 1;
    if (night.source === 'yours') {
      yours += 1;
      yourPrices.add(moneyFine(night.price));
    }
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
    yourPrices: yourPrices.size,
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
  /**
   * Say the money. False when his one game shown is yours and the profile's
   * header already says its result ("Your roster spot: +$194.5K over 1
   * game"): the verdict tells how it went, once (walk 7 T1-05).
   */
  figure?: boolean;
}

/**
 * The one-sentence answer, from the side you look from, e.g. "Beat his price
 * in 8 of his 11 games this season, $146K a game ahead on average." or
 * "Stayed under his price in 2 of his 3 games this season, $126K a game ahead
 * on average for your short."
 */
export function formVerdict(summary: NightsSummary, options: VerdictOptions = {}): string {
  const { recent = false, side = 'long', held = false, scope = 'season', figure = true } = options;
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
    return figure
      ? `${verb} his price by ${moneyFine(Math.abs(avgNet))} in ${which}.`
      : `${verb} his price in ${which}.`;
  }
  const count = scope === 'yours'
    ? recent ? `your last ${games} games with him` : `your ${games} games with him`
    : recent ? `his last ${games} games` : `his ${games} games this season`;
  const lead = `${side === 'long' ? 'Beat' : 'Stayed under'} his price in ${beat} of ${count}`;
  if (even) return `${lead}, about even on average${forWho}.`;
  return `${lead}, ${moneyFine(Math.abs(avgNet))} a game ${avgNet > 0 ? 'ahead' : 'behind'} on average${forWho}.`;
}

/**
 * Labels for the side you look from, so a short never reads as a roster spot.
 * Both sides call what a game of him costs his price, as the Rules do ("each
 * game you're credited his price"): a short's figures never invent a "credit"
 * or a "market credit" beside it (walk 5 T1-11).
 */
export function sideWords(side: PerGamePositionSide): {
  price: 'Price';
  priceShort: 'price';
  netCaption: string;
  beat: 'Beat his price' | 'Under his price';
  missedCaption: (count: number) => string;
  legendGood: string;
  legendBad: string;
  legendLine: string;
} {
  return side === 'long'
    ? {
        price: 'Price',
        priceShort: 'price',
        netCaption: 'dividend − price',
        beat: 'Beat his price',
        missedCaption: (count) => (count === 0 ? 'no misses' : `missed ${count}`),
        legendGood: 'Beat his price',
        legendBad: 'Missed his price',
        legendLine: 'Price a game',
      }
    : {
        price: 'Price',
        priceShort: 'price',
        netCaption: 'price − dividend',
        beat: 'Under his price',
        missedCaption: (count) => (count === 0 ? 'never over' : `over ${count}`),
        legendGood: 'Under his price',
        legendBad: 'Over his price',
        legendLine: 'Price a game',
      };
}

/**
 * What the "price a game" figure is made of: your locked price, his market
 * price, or both. After a drop and re-add your nights carry two locked
 * prices, so the figure is plainly an average of them, never "your price"
 * beside a different "Locked in at".
 */
export function priceSourceCaption(
  summary: Pick<NightsSummary, 'games' | 'yours'> & Partial<Pick<NightsSummary, 'yourPrices'>>,
  // Both sides say "price" (walk 5 T1-11); kept so callers name the side they read.
  _side: PerGamePositionSide,
): string {
  if (summary.games === 0) return '';
  if (summary.yours === summary.games) return (summary.yourPrices ?? 1) > 1 ? 'average of your prices' : 'your price';
  if (summary.yours === 0) return 'his market price';
  return 'yours and market';
}

/**
 * Your nights' locked prices, grouped as the reader sees them (so two stints
 * never read "1 at $104.3K, 1 at $104.3K"): one price ("$169K"), a few in the
 * order you held them ("11 at $100K, 1 at $104.3K"), or a range for more.
 */
type YourPrices =
  | { kind: 'one'; text: string }
  | { kind: 'few'; text: string }
  | { kind: 'range'; text: string };

function yourPrices(yours: readonly ProfileNight[]): YourPrices {
  const counts = new Map<string, number>();
  for (const night of yours) {
    const shown = moneyFine(night.price);
    counts.set(shown, (counts.get(shown) ?? 0) + 1);
  }
  if (counts.size === 1) return { kind: 'one', text: moneyFine(yours[0].price) };
  if (counts.size <= 3) return { kind: 'few', text: [...counts].map(([shown, count]) => `${count} at ${shown}`).join(', ') };
  const prices = yours.map((night) => night.price);
  return { kind: 'range', text: `${moneyFine(Math.min(...prices))} to ${moneyFine(Math.max(...prices))}` };
}

/**
 * Where the shown games' prices came from, when one caption can't say it:
 * "These 11 games: 2 with you at $169K, 9 at his market price.", or after a
 * drop and re-add "These 12 games were at your prices: 11 at $100K, 1 at
 * $104.3K." Null when every game is at one locked price, or none is yours,
 * since the price caption already says so.
 */
export function mixNote(nights: readonly ProfileNight[], _side: PerGamePositionSide): string | null {
  const yours = nights.filter((night) => night.source === 'yours');
  if (yours.length === 0) return null;
  const noun = 'price';
  const prices = yourPrices(yours);
  const these = `These ${gamesCount(nights.length)}`;
  if (yours.length === nights.length) {
    if (prices.kind === 'one') return null;
    return prices.kind === 'few'
      ? `${these} were at your ${noun}s: ${prices.text}.`
      : `${these} were at your ${noun}s, ${prices.text}.`;
  }
  const withYou = prices.kind === 'few'
    ? `${yours.length} with you (${prices.text})`
    : `${yours.length} with you at ${prices.text}`;
  return `${these}: ${withYou}, ${nights.length - yours.length} at his market ${noun}.`;
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

/**
 * The game log shows the range's games (walk-1 T2-36), so its caption names
 * them: "His last 15 games, newest first." Your nights with no money (did not
 * play, waiting to settle) inside that window keep their rows.
 */
export function logCaption(range: ProfileRange, shown: number, scope: 'season' | 'yours'): string {
  if (range === 'Yours' || (range === 'Season' && scope === 'yours')) return 'Your games with him, newest first.';
  if (range === 'Season') return 'Every game this season, newest first.';
  return `His last ${gamesCount(shown)}, newest first.`;
}

/** Your no-money nights inside the range's window: all of them for Season and With you. */
export function logStatusNights(
  status: readonly StatusNight[],
  range: ProfileRange,
  shown: readonly ProfileNight[],
): StatusNight[] {
  if (range === 'Season' || range === 'Yours' || shown.length === 0) return [...status];
  return status.filter((night) => night.date >= shown[0].date);
}

/** The game log's price column header. */
export function logPriceHeader(nights: readonly ProfileNight[], _side: PerGamePositionSide): string {
  const yours = nights.filter((night) => night.source === 'yours').length;
  if (nights.length > 0 && yours === nights.length) return 'Your price';
  if (yours === 0) return 'Market price';
  return 'Price';
}

/** "your price" or "market price", for the chart read-out (a short's too). */
export function nightSourceLabel(night: Pick<ProfileNight, 'source'>, _side: PerGamePositionSide): string {
  return night.source === 'market' ? 'market price' : 'your price';
}

/**
 * The line above the chart's read-out, as a sentence rather than three
 * labels (walk 3 T1-18): "Latest game, Oct 27, against your price" before a
 * game is picked, "Oct 24 game, against your price" after. The Price view
 * of a game at his market price has nothing to set against it.
 */
export function readoutCaption(
  night: Pick<ProfileNight, 'date' | 'source'>,
  metric: ProfileMetric,
  side: PerGamePositionSide,
  latest: boolean,
): string {
  const game = latest ? `Latest game, ${humanDate(night.date)}` : `${humanDate(night.date)} game`;
  if (night.source === 'market') {
    return metric === 'price' ? `${game}, his market price` : `${game}, against his market price`;
  }
  return `${game}, against ${nightSourceLabel(night, side)}`;
}

/**
 * The games the profile reads: his latest few, his whole season, or only the
 * games he played for you ("With you"), so a short's numbers can be yours.
 */
export type ProfileRange = TrendRange | 'Yours';

export interface RangeOption {
  key: ProfileRange;
  label: string;
  hint: string;
}

const RECENT: { key: TrendRange; games: number }[] = [
  { key: 'L5', games: 5 },
  { key: 'L15', games: 15 },
  { key: 'L30', games: 30 },
];

/**
 * The range tabs for his games. A "Last N" tab only shows when he has more
 * than N games (with 1 game played, "Last 15" would show that 1 game).
 * "With you" shows when some of his games were yours and some were not.
 * Tabs are spelled out ("Last 15"); where they must fit 44px each (a phone at
 * 200% zoom) they read "L15", "Yours", "All", and the longest recent ranges
 * drop first so every tab keeps 44px.
 */
export function rangeOptions({ total, yours, room }: {
  /** Settled games he has played. */
  total: number;
  /** How many of them were yours, on the side you read from. */
  yours: number;
  /** 'narrow': three tabs fit; 'phone': four; 'wide': five. */
  room: 'narrow' | 'phone' | 'wide';
}): RangeOption[] {
  const narrow = room === 'narrow';
  const withYou: RangeOption[] = yours > 0 && yours < total
    ? [{ key: 'Yours', label: narrow ? 'Yours' : 'With you', hint: 'Only the games he played for you' }]
    : [];
  let recent: RangeOption[] = RECENT
    .filter((range) => total > range.games)
    .map((range) => ({
      key: range.key,
      label: narrow ? range.key : `Last ${range.games}`,
      hint: `His last ${range.games} games`,
    }));
  // Every game he has played was yours: the season is your time with him,
  // and says so (walk 3 T2-08).
  const allYours = yours > 0 && yours === total;
  const season: RangeOption = allYours
    ? { key: 'Season', label: narrow ? 'Yours' : 'With you', hint: 'Every game he has played, all for you' }
    : { key: 'Season', label: narrow ? 'All' : 'Season', hint: 'Every game he played this season' };
  const fit = room === 'wide' ? 5 : room === 'phone' ? 4 : 3;
  while (withYou.length + recent.length + 1 > fit) recent = recent.slice(0, -1);
  // "With you" always leads, as the widest range and the held default, so
  // the chosen tab reads first (walk 7 T2-19: "Last 5 | With you").
  return allYours ? [season, ...recent] : [...withYou, ...recent, season];
}

/**
 * Where the profile opens: your games when you hold him (the same span as
 * the header's result: "With you", or his season when every game was yours),
 * his last 15 once he has more than 15, otherwise his whole season.
 */
export function defaultRange(options: readonly RangeOption[], held: boolean): ProfileRange {
  if (held && options.some((option) => option.key === 'Yours')) return 'Yours';
  if (held) return 'Season';
  if (options.some((option) => option.key === 'L15')) return 'L15';
  return 'Season';
}

export function rangeNights(nights: readonly ProfileNight[], range: ProfileRange): ProfileNight[] {
  if (range === 'Yours') return nights.filter((night) => night.source === 'yours');
  return selectTrendRange(nights, range);
}

/** True when a range shows only his latest games rather than all of them. */
export function isRecentRange(range: ProfileRange, shown: number, total: number): boolean {
  return range !== 'Season' && range !== 'Yours' && shown < total;
}

/**
 * How his price moved over some nights, in plain words. With his market
 * history and today's price (the header's), it is short lines, one price a
 * line (walk 4 T2-05, T1-22): the price you locked, then his market price
 * today, up or down from the first of these games (today against that game,
 * so a price that ends lower never reads "rose"):
 *
 *   Your price: $259K (locked).
 *   Market price: $252.6K today, down from $259.6K at his first game with you.
 *
 * The chart ends at his price after his latest game; when today's differs, a
 * last line says why a price can change with no game in between: "His market
 * price moves between games too." `firstWithYou` is the date of your first
 * game with him (any range), so the first game is named as that when it is.
 */
export function priceStory(
  nights: readonly ProfileNight[],
  side: PerGamePositionSide = 'long',
  now?: number,
  firstWithYou: string | null = null,
  /** The price you hold him at now (your position's), or null when you don't. */
  locked: number | null = null,
): string {
  if (nights.length === 0) return 'No games yet.';
  // A short locks his price too (walk 5 T1-11).
  const word = 'price';
  const mine = nights.filter((night) => night.source === 'yours');
  if (now !== undefined && nights.every((night) => night.market !== undefined)) {
    // Walk 8 T1-07: lead with the comparison you act on, now against the price
    // you locked; a game night's price is read on the chart's picked point,
    // and the move since the first game shown is a percent (T2-06), so a 2%
    // drift reads as small.
    const first = nights[0];
    const start = first.market as number;
    const today = moneyFine(now);
    const since = first.date === firstWithYou ? 'his first game with you' : `his ${humanDate(first.date)} game`;
    const change = priceChange(start, now);
    const moved = change
      ? `${change} since ${since} (${moneyFine(start)})`
      : `the same as at ${since}`;
    const lines: string[] = [];
    if (locked !== null) {
      lines.push(`Now ${today} · you locked ${moneyFine(locked)}: ${versusNewMoves(side, now, locked)}.`);
      lines.push(`${moved.charAt(0).toUpperCase()}${moved.slice(1)}.`);
    } else {
      lines.push(`Now ${today} a game, ${moved}.`);
    }
    if (moneyFine(nights[nights.length - 1].market as number) !== today) lines.push(`His market ${word} moves between games too.`);
    return lines.join('\n');
  }
  // No price today to set against (a caller without the header's price).
  if (mine.length > 0 && nights.every((night) => night.market !== undefined)) {
    const from = nights[0].market as number;
    const to = nights[nights.length - 1].market as number;
    const move = Math.round(from / 1000) === Math.round(to / 1000)
      ? `held near ${moneyFine(to)}`
      : `went from ${moneyFine(from)} to ${moneyFine(to)}`;
    const prices = yourPrices(mine);
    const locked = prices.kind === 'one' ? `you locked ${prices.text}` : `your ${word}s were ${prices.text}`;
    const lead = `${locked.charAt(0).toUpperCase()}${locked.slice(1)}.`;
    if (nights.length === 1) return `${lead} His market ${word} was ${moneyFine(to)} in that game.`;
    return `${lead} Over these ${gamesCount(nights.length)} his market ${word} ${move}.`;
  }
  const first = nights[0].price;
  const last = nights[nights.length - 1].price;
  const yours = nights.filter((night) => night.source === 'yours').length;
  const note = yours === 0 ? '' : yours === nights.length ? ` (your locked ${word})` : ` (your locked ${word} in ${yours})`;
  if (Math.round(first / 1000) === Math.round(last / 1000)) {
    return `His ${word} held near ${moneyFine(last)} a game over ${gamesCount(nights.length)}${note}.`;
  }
  return `His ${word} went from ${moneyFine(first)} to ${moneyFine(last)} a game over ${gamesCount(nights.length)}${note}.`;
}

/**
 * His price's move as a percent, one decimal: "up 2.5%", "down 0.1%"; null
 * when it rounds to no change (walk 8 T2-06: "-1.9% since your first game").
 */
export function priceChange(from: number, to: number): string | null {
  if (from <= 0) return null;
  const percent = Math.round(((to - from) / from) * 1000) / 10;
  if (percent === 0) return null;
  return `${percent > 0 ? 'up' : 'down'} ${Math.abs(percent).toFixed(1)}%`;
}

/**
 * What today's price means for the price you locked, by side: a long pays
 * his locked price each game, a short is credited it (walk 8 T1-07).
 */
function versusNewMoves(side: PerGamePositionSide, now: number, locked: number): string {
  if (moneyFine(now) === moneyFine(locked)) return side === 'long' ? 'the same as new buyers pay' : 'the same as a new short gets';
  // The gap between the two figures as shown ("$418.2K", "$417.5K": $700, not $723).
  const gap = moneyFine(Math.abs(asShown(now) - asShown(locked)));
  if (side === 'long') return now > locked ? `you pay ${gap} a game less than new buyers` : `you pay ${gap} a game more than new buyers`;
  return now > locked ? `${gap} a game less than a new short gets` : `${gap} a game more than a new short gets`;
}

/** An amount rounded as `moneyFine` shows it: to $100 from $10K, to $10 from $1K. */
function asShown(amount: number): number {
  const abs = Math.abs(amount);
  const step = abs < 1_000 ? 1 : abs < 9_995 ? 10 : abs < 999_950 ? 100 : 10_000;
  return Math.round(amount / step) * step;
}

export interface HoldingStatus {
  /** Tag text, or null when you do not hold him. */
  tag: 'On your roster' | 'Shorted' | null;
  /** The sentence beside the tag. */
  text: string;
}

/**
 * Your status with him, in words: on your roster at a locked price, shorted,
 * or not held, said from the side the action bar offers (walk 7 T1-04: "Not
 * on your roster or shorted" read awkwardly).
 */
export function holdingStatus(
  position: Pick<PerGamePosition, 'side' | 'lockedGameCost' | 'expiresOn'> | null,
  side: PerGamePositionSide = 'long',
  /** His move on this side is saving (or waiting its turn): the header says so (walk 8 T4-11). */
  saving = false,
  /** His market price now: the line then names it beside "Locked in" (walk 9 T1-01). */
  market?: number,
): HoldingStatus {
  if (!position) {
    if (saving) return { tag: null, text: side === 'long' ? 'Adding him to your roster…' : 'Opening your short on him…' };
    return { tag: null, text: side === 'long' ? 'Not on your roster' : "You haven't shorted him" };
  }
  if (saving) {
    return position.side === 'long'
      ? { tag: 'On your roster', text: 'Dropping him from your roster…' }
      : { tag: 'Shorted', text: 'Closing your short on him…' };
  }
  const until = position.expiresOn ? `, ends ${humanDate(position.expiresOn)}` : '';
  if (market !== undefined) {
    // The header leads with your price ("Yours $417.5K a game"; walk 9
    // T1-01), so this line says it is locked and where the market is now.
    const same = moneyFine(market) === moneyFine(position.lockedGameCost);
    const now = same ? 'the same as the market' : `market now ${moneyFine(market)}`;
    return position.side === 'long'
      ? { tag: 'On your roster', text: `Locked in, ${now}` }
      : { tag: 'Shorted', text: `Credited each game${until}, ${now}` };
  }
  if (position.side === 'long') {
    return { tag: 'On your roster', text: `Locked in at ${moneyFine(position.lockedGameCost)} a game` };
  }
  return { tag: 'Shorted', text: `Credited ${moneyFine(position.lockedGameCost)} a game${until}` };
}

/**
 * The price beside his name (walk 9 T1-01): yours when you hold him ("Yours
 * $417.5K a game"), since the market's can move the moment you add him and
 * read like a bigger charge; otherwise the market's ("$418.5K a game").
 */
export function headerPrice(position: Pick<PerGamePosition, 'lockedGameCost'> | null, now: number): string {
  return position ? `Yours ${perGame(position.lockedGameCost)}` : perGame(now);
}

/**
 * The Price view's lead for a player you hold (walk 9 T1-08): one comparison
 * in two cells, then one plain line; the move since his first game is the
 * chart's caption (`priceMoveLine`).
 */
export function priceCompare(side: PerGamePositionSide, now: number, locked: number): {
  cells: [{ label: string; value: string }, { label: string; value: string }];
  line: string;
} {
  return side === 'long'
    ? {
        cells: [{ label: 'You pay', value: moneyFine(locked) }, { label: 'New buyers pay', value: moneyFine(now) }],
        line: 'Your price never changes while you hold him.',
      }
    : {
        cells: [{ label: 'You get', value: moneyFine(locked) }, { label: 'New shorts get', value: moneyFine(now) }],
        line: 'Your credit never changes while the short is open.',
      };
}

/**
 * His market price's move over the games shown, as the chart's caption, read
 * from the line it sits under: its first point to its last (walk 10 T1-09: a
 * caption measured to today's price said "down 0.1%" under a line that fell
 * 1.2%). "Market price down 1.2% from his first game with you to his latest."
 * One game draws no line: its caption measures to today's price.
 */
export function priceMoveLine(nights: readonly ProfileNight[], now: number, firstWithYou: string | null): string | null {
  const first = nights[0];
  if (!first || first.market === undefined) return null;
  const since = first.date === firstWithYou ? 'his first game with you' : `his ${humanDate(first.date)} game`;
  const last = nights[nights.length - 1];
  if (nights.length > 1 && last.market !== undefined) {
    const change = priceChange(first.market, last.market);
    return change ? `Market price ${change} from ${since} to his latest.` : `Market price the same at his latest game as at ${since}.`;
  }
  const change = priceChange(first.market, now);
  return change ? `Market price ${change} since ${since}.` : `Market price the same as at ${since}.`;
}

/** The app's column on a wide screen (App.tsx `styles.app.maxWidth`): the frame never grows past it. */
export const APP_COLUMN_MAX_WIDTH = 1200;

/**
 * Where the desktop profile panel docks, from the window's right edge: the
 * app column's right edge, so on a monitor wider than the column it opens
 * over the app, not out in the empty margin (walk 8 T2-03).
 */
export function panelDockRight(windowWidth: number, column = APP_COLUMN_MAX_WIDTH): number {
  return Math.max(0, Math.floor((windowWidth - column) / 2));
}

/** His move on this side is saving, or waiting its turn behind a night or another move. */
export function moveSaving(pending: ReadonlySet<string>, side: PerGamePositionSide, playerId: string): boolean {
  return pending.has(`position:${side}:${playerId}`) || pending.has(`queued:position:${side}:${playerId}`);
}

/**
 * The action bar while its move saves (walk 8 T4-11: a dashed "WAIT" read as
 * locked, with no reason): the button's word, its spoken name (which starts
 * with the word shown, so a voice command naming it still finds it), and one
 * line of status beside it.
 */
export function savingWords(kind: 'open' | 'close', side: PerGamePositionSide, playerName: string): {
  word: string;
  name: string;
  note: string;
} {
  if (kind === 'open') {
    return side === 'long'
      ? { word: 'Adding…', name: `Adding ${playerName}`, note: `Saving your add of ${playerName}…` }
      : { word: 'Shorting…', name: `Shorting ${playerName}`, note: `Saving your short on ${playerName}…` };
  }
  return side === 'long'
    ? { word: 'Dropping…', name: `Dropping ${playerName}`, note: `Saving your drop of ${playerName}…` }
    : { word: 'Closing…', name: `Closing your short on ${playerName}`, note: `Saving the close of your short on ${playerName}…` };
}

export type StakeTone = 'gain' | 'loss' | 'even' | 'none';

/**
 * The day you took a position: the day its add or short fee was booked.
 * Null when no fee is on record (a free move, or an older ledger page).
 */
export function positionOpenedDay(
  entries: readonly Pick<PerGameLedgerEntry, 'positionId' | 'kind' | 'gameDate' | 'createdAt' | 'eventCursor'>[],
  positionId: string,
): string | null {
  let first: (typeof entries)[number] | null = null;
  for (const entry of entries) {
    if (entry.positionId !== positionId || (entry.kind !== 'open_fee' && entry.kind !== 'fee')) continue;
    if (!first || entry.eventCursor < first.eventCursor) first = entry;
  }
  return first ? entryDay(first as PerGameLedgerEntry) : null;
}

/** "Oct 21", "Oct 21 to 27", "Oct 21 to Nov 3". */
function dateSpan(from: string, to: string): string {
  if (from === to) return humanDate(from);
  const end = humanDate(to);
  return `${humanDate(from)} to ${from.slice(0, 7) === to.slice(0, 7) ? end.split(' ').pop() : end}`;
}

/**
 * Who he was to you before, for a player you no longer hold (walk-2 T2-20):
 * the side, how many stints, and the game dates they spanned, as in "Your
 * short, Oct 21 to 27:". Null with no games with you.
 */
export function pastStintLead(
  results: readonly Pick<PerGameSettledResult, 'positionId' | 'side' | 'gameDate'>[],
): string | null {
  if (results.length === 0) return null;
  const sides = new Set(results.map((row) => row.side));
  const stints = new Set(results.map((row) => row.positionId)).size;
  const dates = results.map((row) => row.gameDate).sort();
  const who = sides.size > 1
    ? 'With you'
    : sides.has('long')
      ? stints > 1 ? `Your ${stints} roster spots` : 'Your roster spot'
      : stints > 1 ? `Your ${stints} shorts` : 'Your short';
  return `${who}, ${dateSpan(dates[0], dates[dates.length - 1])}:`;
}

/**
 * Your money with him in one line: the current position when you hold him
 * (the same numbers as its Roster row), otherwise every past stint, named by
 * side and dates (`past`, from pastStintLead).
 *
 * Held with no games yet: "No games since you added him (Oct 20)" (or
 * "shorted"), and "No games yet at this price" only for a re-add, when he
 * already played for you at another price (`readd`).
 */
export function stakeLine(
  summary: Pick<ValueSummary, 'games' | 'total'>,
  held: boolean,
  side: PerGamePositionSide = 'long',
  opened: { since?: string | null; readd?: boolean; past?: string | null } = {},
): {
  lead: string;
  total: string | null;
  tone: StakeTone;
} | null {
  if (summary.games === 0) {
    if (!held) return null;
    if (opened.readd) return { lead: 'No games yet at this price', total: null, tone: 'none' };
    const verb = side === 'long' ? 'added' : 'shorted';
    // "(Oct 20)" stays on one line at 320px (walk 9 T4-07).
    const day = opened.since ? ` (${humanDate(opened.since).replace(/ /g, '\u00a0')})` : '';
    return { lead: `No games since you ${verb} him${day}`, total: null, tone: 'none' };
  }
  const tone: StakeTone = Math.abs(summary.total) < EVEN_BAND ? 'even' : summary.total > 0 ? 'gain' : 'loss';
  // Your result leads (walk-1 T1-44): "Your short: -$699.2K over 3 games".
  const lead = !held ? opened.past ?? 'Before, with you:' : side === 'long' ? 'Your roster spot:' : 'Your short:';
  return { lead, total: `${signedMoneyFine(summary.total)} over ${gamesCount(summary.games)}`, tone };
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

/**
 * Last season's value as the profile shows it (walk 5 T4-02). For a player
 * you hold, it is measured against the price you locked, the figure the
 * Roster and the Market's held row show ("Value +$71K at your price"), so
 * your own add (which nudges his market price) never makes him look worse the
 * moment you pick him. Today's price joins the caption once it differs from
 * yours ("now $431.5K"). A player you do not hold reads at today's price,
 * from the side the action bar offers ("Short instead" flips it).
 *
 * The figure is the Market's own rule (`shownEdge`): his dividend as printed
 * minus the price as printed, so the profile and the row agree to the dollar.
 */
export function lastSeasonValue(
  player: Pick<PerGameMarketPlayer, 'currentGameCost' | 'priorSeasonValuePerGame'>,
  side: PerGamePositionSide,
  position: Pick<PerGamePosition, 'side' | 'lockedGameCost'> | null = null,
): { worth: number | null; edge: number | null; label: string; caption: string } {
  const facts = lastSeasonFacts(player, side);
  if (!position || position.side !== side) {
    return { worth: facts.worth, edge: shownEdge(player, side), label: "Value at today's price", caption: facts.edgeCaption };
  }
  const yours = moneyFine(position.lockedGameCost);
  const now = moneyFine(player.currentGameCost);
  return {
    worth: facts.worth,
    edge: shownEdge({ currentGameCost: position.lockedGameCost, priorSeasonValuePerGame: player.priorSeasonValuePerGame }, side),
    label: 'Value at your price',
    caption: `${side === 'long' ? 'a game' : 'a game for your short'}, against your ${yours}${now === yours ? '' : ` (now ${now})`}`,
  };
}

/**
 * Before his first game the profile says plainly what will fill it (walk 7
 * T1-04: the sheet was half empty with one line). 'season': practice, where
 * every game he plays shows; 'yours': live, only games you hold him.
 */
export function firstGamePreview(
  side: PerGamePositionSide,
  scope: 'season' | 'yours',
): { lead: string; items: string[] } {
  return {
    lead: scope === 'yours'
      ? 'No games with you yet. Once he plays for your roster or a short, this shows:'
      : 'No games yet this season. After his first game, this shows:',
    items: [
      'His dividend each game against his price, on a chart',
      side === 'long'
        ? 'How often he beats his price, and his average a game'
        : 'How often he stays under his price, and his average a game',
      'A game log, newest first',
    ],
  };
}

/**
 * What "Value" means, in one line, under last season's figures while he has
 * no games yet (walk 7 T1-04): the Market's rule, from the side you look from,
 * against the price you locked when you hold him.
 */
export function valueMeaning(side: PerGamePositionSide, held: boolean): string {
  const price = held ? 'your price' : "today's price";
  return side === 'long'
    ? `Value is his dividend last season minus ${price}: what each game would add to your score at that pace.`
    : `Value for a short is ${price} minus his dividend last season: what each game would add at that pace.`;
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
  /** His market price as a line through each night (price view; his price when the market is unknown). */
  priceLinePath: string;
  /** Your locked price across the nights you held him (price view), or ''. */
  yourPricePath: string;
  /** Where $0 sits, when it is inside the plot (dividends view). */
  zeroY: number | null;
  /** Indices of the highest and lowest values, or null when not worth labelling. */
  high: number | null;
  low: number | null;
  /**
   * Price view: the scale's marks, the highest and lowest price drawn (his
   * market line and your locked line) at their height, as the Score by night
   * chart names its high and low (walk 5 T2-08). One mark when they read the
   * same; none in the dividends view.
   */
  priceMarks: PriceMark[];
}

export interface PriceMark {
  value: number;
  /** Plot y of the value: where its guide line is drawn. */
  y: number;
  /**
   * Where its words are centred: at its line, or stepped just clear of the
   * other mark when a small move puts the lines close together.
   */
  labelY: number;
  kind: 'high' | 'low';
}

/** A mark's words are about 14px tall: 16px between centres keeps them apart. */
const MARK_GAP = 16;
const MARK_HALF = 7;

/** Steps two close marks' words apart, inside the chart's height. */
function spreadMarks(marks: PriceMark[], height: number): PriceMark[] {
  const clamp = (value: number) => Math.min(Math.max(value, MARK_HALF), Math.max(MARK_HALF, height - MARK_HALF));
  if (marks.length < 2) return marks.map((mark) => ({ ...mark, labelY: clamp(mark.y) }));
  const [high, low] = marks;
  const mid = (high.y + low.y) / 2;
  let up = low.y - high.y < MARK_GAP ? mid - MARK_GAP / 2 : high.y;
  let down = low.y - high.y < MARK_GAP ? mid + MARK_GAP / 2 : low.y;
  up = clamp(up);
  down = clamp(Math.max(down, up + MARK_GAP));
  up = Math.min(up, down - MARK_GAP);
  return [{ ...high, labelY: up }, { ...low, labelY: down }];
}

/**
 * The Price chart's least span, a share of his price: 16% (±8%), so a 3% move
 * fills about a fifth of the plot and a real slide still fills it (walk 8 T2-06).
 */
export const PRICE_MIN_SPAN = 0.16;

/** Room around a small drift: the band fills at most about 60% of a shrunk Price chart. */
const PRICE_ROOM = 1.6;
/** The least height of a Price chart shrunk to a small drift (walk 9 T2-03). */
export const PRICE_MIN_HEIGHT = 96;

interface PriceFrame {
  /** Your locked price (the latest, when you held him in these games), else the middle of the prices. */
  centre: number;
  /** The farthest price from the centre, in dollars. */
  dev: number;
  /** Every price sits well inside the least span: the chart centres on `centre` and shrinks. */
  small: boolean;
  held: boolean;
  spread: number;
}

function priceFrame(nights: readonly ProfileNight[]): PriceFrame | null {
  if (nights.length === 0) return null;
  const values = nights.map((night) => night.market ?? night.price);
  const yours = nights.filter((night) => night.source === 'yours').map((night) => night.price);
  const all = [...values, ...yours];
  const held = yours.length > 0;
  const top = Math.max(...all);
  const bottom = Math.min(...all);
  const centre = held ? yours[yours.length - 1] : (top + bottom) / 2;
  if (!(centre > 0)) return null;
  const dev = Math.max(...all.map((value) => Math.abs(value - centre)));
  return { centre, dev, small: dev * 1.25 <= (centre * PRICE_MIN_SPAN) / 2, held, spread: top - bottom };
}

/**
 * The Price chart's height (walk 9 T2-03): a small drift keeps the full
 * chart's scale (a 1% move is as tall as ever) on a shorter chart, so the
 * band is not a thin line in a tall, empty box; a real move gets the whole
 * height. Never under `PRICE_MIN_HEIGHT`.
 */
export function priceChartHeight(nights: readonly ProfileNight[], fullHeight: number, insets: ChartInsets): number {
  const frame = priceFrame(nights);
  if (!frame || !frame.small) return fullHeight;
  const fullPlot = fullHeight - insets.top - insets.bottom;
  const perDollar = fullPlot / (frame.centre * PRICE_MIN_SPAN);
  const plot = 2 * Math.max(frame.dev * PRICE_ROOM * perDollar, MARK_GAP);
  return Math.round(Math.min(fullHeight, Math.max(PRICE_MIN_HEIGHT, plot + insets.top + insets.bottom)));
}

/**
 * Why a Price chart looks flat (walk 9 T2-03): "Within 1.3% of your price in
 * these games." Null for a real move, or a single game.
 */
/**
 * The Price view's word on what moves a price (walk 11 T2-01), in the Rules'
 * own words (their first sentence): a player's price fell after a +$194.5K
 * night and read as the numbers being wrong.
 */
export function priceMovesNote(): string {
  const end = PRICE_EXPLAINER.indexOf('. ');
  return end > 0 ? PRICE_EXPLAINER.slice(0, end + 1) : PRICE_EXPLAINER;
}

export function priceDriftCaption(nights: readonly ProfileNight[]): string | null {
  const frame = priceFrame(nights);
  if (!frame || !frame.small || nights.length < 2) return null;
  // Rounded up, so "within" stays true.
  const within = (amount: number) => (Math.ceil((amount / frame.centre) * 1000) / 10).toFixed(1);
  if (frame.held) {
    return frame.dev < 1 ? 'His market price matched your price in these games.' : `Within ${within(frame.dev)}% of your price in these games.`;
  }
  return frame.spread < 1 ? 'His price held steady in these games.' : `A ${within(frame.spread)}% range in these games.`;
}

export interface ExtremeLabel {
  kind: 'HIGH' | 'LOW';
  index: number;
  text: string;
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
}

/** A label's baseline sits this far above a bar's top; 13px apart, two labels never touch. */
const LABEL_ABOVE = 7;
const LABEL_BELOW = 15;
const LABEL_STEP = 13;
const LABEL_MIN_Y = 12;

/**
 * Where the Dividends chart's HIGH and LOW labels sit (walk 9 T2-02, T1-07):
 * each just above its own bar's top, as HIGH always was, and just under the
 * end of a bar below $0; never under the $0 axis, where LOW read like an axis
 * mark. Two labels that would touch step apart, the higher value's on top.
 */
export function extremeLabels(
  model: Pick<ProfileChartModel, 'bars' | 'high' | 'low'>,
  dividends: readonly number[],
  width: number,
  height: number,
  format: (value: number) => string,
): ExtremeLabel[] {
  const anchorAt = (x: number): ExtremeLabel['anchor'] => (x < 60 ? 'start' : x > width - 60 ? 'end' : 'middle');
  const clampY = (y: number) => Math.max(LABEL_MIN_Y, Math.min(height - 3, y));
  const labels = ([['HIGH', model.high], ['LOW', model.low]] as const)
    .filter((entry): entry is readonly ['HIGH' | 'LOW', number] => entry[1] !== null && model.bars[entry[1]] !== undefined)
    .map(([kind, index]) => {
      const bar = model.bars[index];
      const x = bar.x + bar.width / 2;
      const below = dividends[index] < 0;
      const y = below ? bar.y + bar.height + LABEL_BELOW : bar.y - LABEL_ABOVE;
      return { kind, index, text: `${kind} ${format(dividends[index])}`, x, y: clampY(y), anchor: anchorAt(x) };
    });
  if (labels.length < 2) return labels;
  const extent = (label: ExtremeLabel) => {
    const size = label.text.length * 6.6;
    const left = label.anchor === 'start' ? label.x : label.anchor === 'end' ? label.x - size : label.x - size / 2;
    return [left - 2, left + size + 2];
  };
  const [first, second] = labels;
  const [a0, a1] = extent(first);
  const [b0, b1] = extent(second);
  if (a1 < b0 || b1 < a0 || Math.abs(first.y - second.y) >= LABEL_STEP) return labels;
  // Too close: HIGH (the higher value) goes on top, LOW under it.
  const high = first.kind === 'HIGH' ? first : second;
  const low = high === first ? second : first;
  const upper = Math.max(LABEL_MIN_Y, Math.min(high.y, low.y - LABEL_STEP));
  return [
    { ...high, y: upper },
    { ...low, y: clampY(Math.max(low.y, upper + LABEL_STEP)) },
  ];
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
  /** Price view: the chart's full height, when `height` is shrunk to a small drift (`priceChartHeight`). */
  fullHeight: number = height,
): ProfileChartModel {
  const empty: ProfileChartModel = {
    slot: 0, bars: [], anchors: [], priceStepPath: '', priceLinePath: '', yourPricePath: '', zeroY: null, high: null, low: null, priceMarks: [],
  };
  const count = nights.length;
  const plotWidth = width - insets.left - insets.right;
  const plotHeight = height - insets.top - insets.bottom;
  if (count === 0 || plotWidth <= 0 || plotHeight <= 0) return empty;

  const slot = plotWidth / count;
  const centre = (index: number) => insets.left + (index + 0.5) * slot;
  // Price view: his market price each night (walk-1 T2-33), against your
  // locked price on the nights you held him.
  const values = nights.map((night) => (metric === 'price' ? night.market ?? night.price : night.dividend));
  const prices = nights.map((night) => night.price);
  const yourPrices = nights.filter((night) => night.source === 'yours').map((night) => night.price);

  let low: number;
  let high: number;
  let priceHigh = 0;
  let priceLow = 0;
  if (metric === 'price') {
    low = Math.min(...values, ...yourPrices);
    high = Math.max(...values, ...yourPrices);
    priceHigh = high;
    priceLow = low;
    const mid = (high + low) / 2;
    const pad = Math.max((high - low) * 0.2, Math.abs(high) * 0.02, 1);
    low -= pad;
    high += pad;
    // A minimum span around the middle (walk 8 T2-06: a 2.5% drift drew as a
    // plunge from top to bottom): a few percent reads as a few percent.
    const span = Math.abs(mid) * PRICE_MIN_SPAN;
    const frame = priceFrame(nights);
    if (frame?.small) {
      // A small drift centres on your locked line (walk 9 T2-03: the band
      // sat at the top or the bottom, jumping as the range changed), at the
      // full chart's scale on a chart shrunk to fit it.
      const fullPlot = fullHeight - insets.top - insets.bottom;
      const half = ((frame.centre * PRICE_MIN_SPAN) / 2) * Math.min(1, plotHeight / Math.max(1, fullPlot));
      low = frame.centre - half;
      high = frame.centre + half;
    } else if (high - low < span) {
      low = mid - span / 2;
      high = mid + span / 2;
    }
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
  const priceLinePath = (metric === 'price' ? values : prices)
    .map((price, index) => `${index === 0 ? 'M' : 'L'} ${centre(index)} ${y(price)}`)
    .join(' ');
  const yourPricePath = metric !== 'price' ? '' : nights
    .map((night, index) => {
      // Without his market price the main line already is your price.
      if (night.source !== 'yours' || night.market === undefined) return '';
      const start = insets.left + index * slot;
      return `M ${start} ${y(night.price)} L ${start + slot} ${y(night.price)}`;
    })
    .filter(Boolean)
    .join(' ');

  const extrema = selectHighLowPoints(values);
  const flat = Math.max(...values) === Math.min(...values);
  const labelled = count >= 5 && !flat;
  const priceMarks: PriceMark[] = metric !== 'price'
    ? []
    : spreadMarks(moneyFine(priceHigh) === moneyFine(priceLow)
      ? [{ value: priceHigh, y: y(priceHigh), labelY: 0, kind: 'high' }]
      : [
          { value: priceHigh, y: y(priceHigh), labelY: 0, kind: 'high' },
          { value: priceLow, y: y(priceLow), labelY: 0, kind: 'low' },
        ], height);

  return {
    slot,
    bars,
    anchors,
    priceStepPath,
    priceLinePath,
    yourPricePath,
    zeroY,
    high: labelled ? extrema.high?.index ?? null : null,
    low: labelled ? extrema.low?.index ?? null : null,
    priceMarks,
  };
}

export interface ChartDateLabel {
  index: number;
  /** Left edge of the label's box, in chart pixels. */
  left: number;
  align: 'left' | 'center' | 'right';
}

/**
 * Where the chart's dates go: under his first and latest game, each centred
 * on its bar or point and pulled inside the chart at the edges, so a date
 * names the game above it. A lone game gets one date, under its bar (walk 5
 * T2-15: "Oct 21" sat at the left edge while the bar stood in the middle).
 * Two boxes that would touch keep only the latest.
 */
export function chartDateLabels(xs: readonly number[], width: number, boxWidth: number, gap = 4): ChartDateLabel[] {
  if (xs.length === 0 || width <= 0) return [];
  const maxLeft = Math.max(width - boxWidth, 0);
  const place = (index: number): ChartDateLabel => {
    const left = Math.min(Math.max(xs[index] - boxWidth / 2, 0), maxLeft);
    return { index, left, align: left <= 0 ? 'left' : left >= maxLeft ? 'right' : 'center' };
  };
  const last = place(xs.length - 1);
  if (xs.length === 1) return [last];
  const first = place(0);
  return Math.abs(last.left - first.left) < boxWidth + gap ? [last] : [first, last];
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
  const values = nights.map((night) => (metric === 'price' ? night.market ?? night.price : night.dividend));
  const { high, low } = selectHighLowPoints(values);
  const highNight = high ? nights[high.index] : null;
  const lowNight = low ? nights[low.index] : null;
  // A flat line has no high and low worth reading ("High $125K … low $125K").
  const range = highNight && lowNight && moneyFine(high!.value) !== moneyFine(low!.value)
    ? ` High ${moneyFine(high!.value)} on ${humanDate(highNight.date)}, low ${moneyFine(low!.value)} on ${humanDate(lowNight.date)}.`
    : '';
  if (metric === 'price') {
    const marketKnown = nights.every((night) => night.market !== undefined);
    const against = marketKnown && nights.some((night) => night.source === 'yours') ? `, against your locked ${words.priceShort}` : '';
    return `His ${marketKnown ? 'market ' : ''}${words.priceShort} a game over ${gamesCount(nights.length)}${against}.${range}`;
  }
  const summary = summarizeNights(nights);
  const tally = side === 'long'
    ? `He beat his price in ${summary.beat} of them.`
    : `He stayed under his price in ${summary.beat} of them, which is what a short wants.`;
  return `His dividend each game against his price, over ${gamesCount(nights.length)}. ${tally}${range}`;
}

/**
 * The chart legend's words, with values so a line is never unlabelled
 * (walk-1 T1-29): the gold line ("Your price $100K", "His market price") and,
 * in the Price view, your locked line when it is drawn beside the market.
 */
export function chartLegend(
  nights: readonly ProfileNight[],
  metric: ProfileMetric,
  _side: PerGamePositionSide = 'long',
): { line: string; yours: string | null } {
  const noun = 'price';
  const mine = nights.filter((night) => night.source === 'yours');
  const prices = new Set(mine.map((night) => moneyFine(night.price)));
  const yoursText = prices.size === 1 ? `Your ${noun} ${moneyFine(mine[0].price)}` : `Your ${noun}s`;
  const marketKnown = nights.length > 0 && nights.every((night) => night.market !== undefined);
  if (metric === 'price' && marketKnown) {
    return { line: `His market ${noun}`, yours: mine.length > 0 ? yoursText : null };
  }
  if (mine.length === nights.length && mine.length > 0) return { line: yoursText, yours: null };
  if (mine.length === 0) return { line: `His market ${noun}`, yours: null };
  return { line: 'Price: yours or market', yours: null };
}

/** The chart's read-out for one night: "Dividend $324K · price $104K · +$220K". */
export function nightReadout(night: ProfileNight, metric: ProfileMetric, side: PerGamePositionSide = 'long'): string {
  const words = sideWords(side);
  if (metric === 'price') {
    // "Market $128K · your price $125K": his market that night against your line.
    if (night.market !== undefined && night.source === 'yours') {
      return `Market ${moneyFine(night.market)} · your ${words.priceShort} ${moneyFine(night.price)}`;
    }
    return `Price ${moneyFine(night.market ?? night.price)} a game`;
  }
  return `Dividend ${moneyFine(night.dividend)} · ${words.priceShort} ${moneyFine(night.price)} · ${signedMoneyFine(night.net)}`;
}

// ---------------------------------------------------------------------------
// The action bar's words (walk 6)

/**
 * The profile's Drop / Close button. In a sheet whose × also closes, a bare
 * "Close" read like closing the panel (walk 6 T2-04): it names what goes.
 */
export function profileCloseWord(side: PerGamePositionSide): 'Drop player' | 'Close short' {
  return side === 'long' ? 'Drop player' : 'Close short';
}

/** Its spoken name starts with the words shown (voice control finds it): "Close short on Luka Doncic". */
export function profileCloseName(side: PerGamePositionSide, playerName: string): string {
  return side === 'long' ? `Drop player ${playerName}` : `Close short on ${playerName}`;
}

/** An ISO day `days` later: "2025-10-21" + 6 → "2025-10-27". */
function isoDayAfter(day: string, days: number): string | null {
  const date = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * The last day a short opened now runs: it starts with the next night of
 * games and lasts `shortTermDays` days, so the Roster's "Ends Oct 27" and
 * this promise name the same day. Null when there is no term or no next night.
 */
export function shortEndsOn(nextGameDate: string | null, shortTermDays: number | null): string | null {
  if (!nextGameDate || shortTermDays === null || shortTermDays < 1) return null;
  return isoDayAfter(nextGameDate, shortTermDays - 1);
}

/**
 * The terms beside Add or Short, read before you pay: the price it locks,
 * for a short how long it runs and when it ends by itself (walk 6 T1-11: the
 * 7 days used to show only after paying), then the fee. No-break spaces keep
 * "7 days", "Oct 27" and "$250 fee" whole.
 * "Locks his price at $176K a game for 7 days (ends Oct 27 by itself) · $250 fee"
 */
export function openTermsNote({ side, priceDollars, feeDollars, shortTermDays, nextGameDate }: {
  side: PerGamePositionSide;
  priceDollars: number;
  feeDollars: number;
  shortTermDays: number | null;
  nextGameDate: string | null;
}): string {
  const fee = feeDollars > 0 ? ` · ${moneyFine(feeDollars)} fee` : '';
  const lock = `Locks his price at ${perGame(priceDollars)}`;
  if (side === 'long' || shortTermDays === null || shortTermDays < 1) return `${lock}${fee}`;
  const days = `${shortTermDays} ${shortTermDays === 1 ? 'day' : 'days'}`;
  const end = shortEndsOn(nextGameDate, shortTermDays);
  const ends = end ? ` (ends ${humanDate(end).replace(' ', ' ')} by itself)` : ', then ends by itself';
  return `${lock} for ${days}${ends}${fee}`;
}

// ---------------------------------------------------------------------------
// Hollow bars for missed games (walk 6 T1-09)

/** A missed game's bar is drawn hollow only when an outline can keep a dark centre: this wide and tall. */
export const HOLLOW_BAR_MIN = 4;

/** True when a missed game's bar is drawn as an outline; below the minimum it is solid. */
export function drawsHollow(bar: { width: number; height: number }): boolean {
  return bar.width >= HOLLOW_BAR_MIN && bar.height >= HOLLOW_BAR_MIN;
}

/** The outline's width: 1px on a narrow bar, so its centre still shows (4px bar → 2px centre), else 1.5px. */
export function missStroke(barWidth: number): number {
  return barWidth < 6 ? 1 : 1.5;
}

/**
 * The legend's "Missed his price" swatch matches what the bars show: hollow
 * while the chart draws its misses hollow, solid once every bar is too
 * narrow for an outline (a whole season on a phone: about 3px a bar, where
 * the legend used to promise hollow bars the chart never drew).
 */
export function missSwatchHollow(bars: readonly { width: number }[]): boolean {
  return bars.length === 0 || bars.some((bar) => bar.width >= HOLLOW_BAR_MIN);
}
