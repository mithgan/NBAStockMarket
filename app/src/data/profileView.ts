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
import { gamesCount, humanDate, money, moneyFine, signedMoneyFine } from '../copy/terms';
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
  /** What a game of him cost: the price on a roster, the credit on a short. */
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
  /**
   * How many different locked prices (credits) your nights carry, as the
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
  price: 'Price' | 'Credit';
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
        price: 'Credit',
        priceShort: 'credit',
        netCaption: 'credit − dividend',
        beat: 'Under his price',
        missedCaption: (count) => (count === 0 ? 'never over' : `over ${count}`),
        legendGood: 'Under his price',
        legendBad: 'Over his price',
        legendLine: 'Credit a game',
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
  side: PerGamePositionSide,
): string {
  const noun = side === 'long' ? 'price' : 'credit';
  if (summary.games === 0) return '';
  if (summary.yours === summary.games) return (summary.yourPrices ?? 1) > 1 ? `average of your ${noun}s` : `your ${noun}`;
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
export function mixNote(nights: readonly ProfileNight[], side: PerGamePositionSide): string | null {
  const yours = nights.filter((night) => night.source === 'yours');
  if (yours.length === 0) return null;
  const noun = side === 'long' ? 'price' : 'credit';
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
    const noun = side === 'long' ? 'price' : 'credit';
    return metric === 'price' ? `${game}, his market ${noun}` : `${game}, against his market ${noun}`;
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
  return [...withYou, ...recent, season];
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
): string {
  if (nights.length === 0) return 'No games yet.';
  const word = side === 'long' ? 'price' : 'credit';
  const mine = nights.filter((night) => night.source === 'yours');
  if (now !== undefined && nights.every((night) => night.market !== undefined)) {
    const first = nights[0];
    const start = first.market as number;
    const today = moneyFine(now);
    const since = first.date === firstWithYou ? 'at his first game with you' : `at his ${humanDate(first.date)} game`;
    const lines: string[] = [];
    if (mine.length > 0) {
      const prices = yourPrices(mine);
      lines.push(prices.kind === 'one' ? `Your ${word}: ${prices.text} (locked).` : `Your ${word}s: ${prices.text} (locked).`);
    }
    lines.push(moneyFine(start) === today
      ? `Market ${word}: ${today} today, the same as ${since}.`
      : `Market ${word}: ${today} today, ${now > start ? 'up' : 'down'} from ${moneyFine(start)} ${since}.`);
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
    const day = opened.since ? ` (${humanDate(opened.since)})` : '';
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
    slot: 0, bars: [], anchors: [], priceStepPath: '', priceLinePath: '', yourPricePath: '', zeroY: null, high: null, low: null,
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
  if (metric === 'price') {
    low = Math.min(...values, ...yourPrices);
    high = Math.max(...values, ...yourPrices);
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
  side: PerGamePositionSide = 'long',
): { line: string; yours: string | null } {
  const noun = side === 'long' ? 'price' : 'credit';
  const mine = nights.filter((night) => night.source === 'yours');
  const prices = new Set(mine.map((night) => moneyFine(night.price)));
  const yoursText = prices.size === 1 ? `Your ${noun} ${moneyFine(mine[0].price)}` : `Your ${noun}s`;
  const marketKnown = nights.length > 0 && nights.every((night) => night.market !== undefined);
  if (metric === 'price' && marketKnown) {
    return { line: `His market ${noun}`, yours: mine.length > 0 ? yoursText : null };
  }
  if (mine.length === nights.length && mine.length > 0) return { line: yoursText, yours: null };
  if (mine.length === 0) return { line: `His market ${noun}`, yours: null };
  return { line: `${noun === 'price' ? 'Price' : 'Credit'}: yours or market`, yours: null };
}

/** The chart's read-out for one night: "Dividend $324K · price $104K · +$220K". */
export function nightReadout(night: ProfileNight, metric: ProfileMetric, side: PerGamePositionSide = 'long'): string {
  const words = sideWords(side);
  if (metric === 'price') {
    // "Market $128K · your price $125K": his market that night against your line.
    if (night.market !== undefined && night.source === 'yours') {
      return `Market ${moneyFine(night.market)} · your ${words.priceShort} ${moneyFine(night.price)}`;
    }
    return `${side === 'long' ? 'Price' : 'Credit'} ${moneyFine(night.market ?? night.price)} a game`;
  }
  return `Dividend ${moneyFine(night.dividend)} · ${words.priceShort} ${moneyFine(night.price)} · ${signedMoneyFine(night.net)}`;
}
