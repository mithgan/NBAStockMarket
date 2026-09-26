/**
 * The market's answers, as pure functions: which players to show, in what
 * order, and the one line that says whether each is worth his price.
 *
 * The screen owns layout; everything a fan reads about value comes from here
 * (and from perGameMetrics underneath) so the list, the desktop columns and the
 * screen-reader labels always say the same thing.
 */
import type {
  PerGameMarketPlayer,
  PerGamePositionSide,
  PerGameSettledResult,
  PerGameSlotSummary,
} from '../api/contracts';
import {
  closeVerb,
  exactMoney,
  money,
  openVerb,
  perGame,
  rosterReopensLine,
  signedMoney,
  moneyCompact,
  signedMoneyCompact,
} from '../copy/terms';
import {
  currentResults,
  lastYearEdge,
  summarizeValue,
  type ValueSummary,
} from './perGameMetrics';
import { splitPlayerName } from './playerName';

export type MarketSort = 'price' | 'value' | 'name' | 'dividend';

export interface MarketSortOption {
  key: MarketSort;
  /** The word on the control, and the start of its name. */
  label: string;
  /** The accessible name: the label, or the column's full words. */
  name: string;
}

/** Sort choices, in the order the control shows them. */
export const MARKET_SORT_OPTIONS: MarketSortOption[] = [
  { key: 'price', label: 'Price', name: 'Price' },
  { key: 'value', label: 'Value', name: 'Value' },
  { key: 'name', label: 'Name', name: 'Name' },
];

const DIVIDEND_OPTION: MarketSortOption = { key: 'dividend', label: 'Dividend', name: 'Dividend last season' };

/**
 * The sort choices: Price / Value / Name, plus Dividend where the table shows
 * its column (or while it is the sort, so the chosen one is never hidden).
 * Choosing one never flips it: the order has its own button (walk 3 T1-08,
 * T2-05), so the labels carry no arrow and never run out of room.
 */
export function marketSortOptions(sort: MarketSort, withDividend = false): MarketSortOption[] {
  if (!withDividend && sort !== 'dividend') return MARKET_SORT_OPTIONS;
  const [price, ...rest] = MARKET_SORT_OPTIONS;
  return [price, DIVIDEND_OPTION, ...rest];
}

export interface SortState {
  sort: MarketSort;
  reversed: boolean;
}

/**
 * The one rule for every sort control (toolbar radios and table headers):
 * choosing a sort shows it in its natural order (Price lowest first, Value
 * and Dividend highest first, Name A to Z) and choosing the one in use
 * changes nothing; only the order button flips it.
 */
export function nextSortState(current: SortState, action: { choose: MarketSort } | 'flip'): SortState {
  if (action === 'flip') return { sort: current.sort, reversed: !current.reversed };
  if (action.choose === current.sort) return current;
  return { sort: action.choose, reversed: false };
}

/** The order button's name: "Order: highest first", "Order: A to Z". */
export function orderButtonName(sort: MarketSort, reversed: boolean): string {
  return `Order: ${sortDirection(sort, reversed)}`;
}

/** The order button's hover title: what it shows now and what a press does. */
export function orderButtonTitle(sort: MarketSort, reversed: boolean): string {
  return `${orderButtonName(sort, reversed)}. Flip to ${sortDirection(sort, !reversed)}.`;
}

/** What the table's Value and Dividend last season headers explain on hover and focus. */
export const COLUMN_EXPLANATIONS = {
  value: "Last season's dividend minus today's price, for this side",
  dividend: 'What he paid out a game last season',
} as const;

/** Under half a thousand either way reads as even, matching valueVerdict. */
const EVEN_BAND = 500;

function nameKey(name: string): string {
  const { given, surname } = splitPlayerName(name);
  return `${surname} ${given}`.trim();
}

function compareNames(left: string, right: string): number {
  return nameKey(left).localeCompare(nameKey(right), 'en', { sensitivity: 'base' });
}

/**
 * Order market rows. Price runs cheapest first, Value runs best last-season
 * edge first (players with no last season go last), Name runs by surname.
 * Ties fall back to price, then name, so the order never shuffles between
 * renders.
 */
export function sortMarketRows<T extends { player: PerGameMarketPlayer }>(
  rows: readonly T[],
  sort: MarketSort,
  side: PerGamePositionSide,
  reversed = false,
): T[] {
  const ordered = sortForward(rows, sort, side);
  if (!reversed) return ordered;
  // The other way round, but players with no last season still go last.
  if (sort !== 'value' && sort !== 'dividend') return ordered.reverse();
  const known = ordered.filter((row) => row.player.priorSeasonValuePerGame !== null && lastYearEdge(row.player, side) !== null);
  return [...known.reverse(), ...ordered.filter((row) => !known.includes(row))];
}

function sortForward<T extends { player: PerGameMarketPlayer }>(
  rows: readonly T[],
  sort: MarketSort,
  side: PerGamePositionSide,
): T[] {
  const byPrice = (left: T, right: T) => left.player.currentGameCost - right.player.currentGameCost;
  const byName = (left: T, right: T) => compareNames(left.player.name, right.player.name);
  const sorted = [...rows];
  if (sort === 'name') return sorted.sort((left, right) => byName(left, right) || byPrice(left, right));
  if (sort === 'price') return sorted.sort((left, right) => byPrice(left, right) || byName(left, right));
  const figure = sort === 'dividend'
    ? (row: T) => row.player.priorSeasonValuePerGame
    : (row: T) => lastYearEdge(row.player, side);
  return sorted.sort((left, right) => {
    const leftEdge = figure(left);
    const rightEdge = figure(right);
    if (leftEdge === null || rightEdge === null) {
      if (leftEdge !== rightEdge) return leftEdge === null ? 1 : -1;
      return byPrice(left, right) || byName(left, right);
    }
    return rightEdge - leftEdge || byPrice(left, right) || byName(left, right);
  });
}

/**
 * Players you hold on the other side cannot be opened on this one, so they
 * follow everyone you can act on. Order inside each group is kept.
 */
export function actionableFirst<T extends { blockedByOpposingPosition: boolean }>(rows: readonly T[]): T[] {
  return [
    ...rows.filter((row) => !row.blockedByOpposingPosition),
    ...rows.filter((row) => row.blockedByOpposingPosition),
  ];
}

/**
 * Lower-case, accent-free text without apostrophes, quotes or dots, so
 * "doncic" finds "Dončić" and "De’Aaron" (a phone's curly apostrophe),
 * "DeAaron" and "de aaron" all find "De'Aaron Fox". Hyphens stay, so
 * "Karl-Anthony" and "karl anthony" both work, and the other dashes
 * (U+2010 to U+2015, e.g. the non-breaking hyphen the rows print in
 * "Gilgeous‑Alexander") count as a hyphen, so a copied name finds him.
 */
export function searchKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2010-\u2015]/g, '-')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim();
}

/** What the Market asks for when a search has no letters ("🏀", "'", "-", "23"). */
export const SEARCH_NEEDS_LETTERS = "Type part of a player's name";

/**
 * Whether a search has a letter to look for. Names have no digits, so a
 * jersey number ("23", "123") gets the same hint as "!!" rather than "no
 * listed player matches", which suggested the player was missing (walk 4
 * T2-19, T4-10, T1-15).
 */
export function searchHasLetters(query: string): boolean {
  return /\p{L}/u.test(searchKey(query));
}

/**
 * The name run together from each of its parts: "Karl-Anthony Towns" gives
 * "karlanthonytowns", "anthonytowns" and "towns", so "karlanthony" finds him
 * (walk 3 T4-05) while "ad" never matches across "Luka Doncic".
 */
function runTogether(text: string): string[] {
  const parts = searchKey(text).split(/[\s-]+/).filter(Boolean);
  return parts.map((_, index) => parts.slice(index).join(''));
}

const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);

/**
 * A name's initials, as fans type them: "Shai Gilgeous-Alexander" is "sga",
 * "Karl-Anthony Towns" "kat", "Anthony Davis" "ad"; "Jaren Jackson Jr." is
 * "jjj" or "jj" (walk 3 T4-12).
 */
export function nameInitials(name: string): string[] {
  const parts = searchKey(name).split(/[\s-]+/).filter(Boolean);
  const all = parts.map((part) => part[0]).join('');
  if (parts.length > 2 && NAME_SUFFIXES.has(parts[parts.length - 1])) return [all, all.slice(0, -1)];
  return [all];
}

/** The longest search the empty state repeats back before it trims it. */
const ECHO_MAX = 24;

/**
 * The search as the empty state repeats it: trimmed to a readable length
 * and given a break point every 10 characters, so a pasted run with no
 * spaces wraps instead of running off the screen.
 */
export function echoQuery(query: string): string {
  const trimmed = query.trim();
  const short = trimmed.length > ECHO_MAX ? `${trimmed.slice(0, ECHO_MAX)}…` : trimmed;
  return short.replace(/(\S{10})(?=\S)/g, '$1\u200B');
}

/**
 * Keep the rows whose name contains every word typed (in any order, spaces
 * and hyphens ignored, so "karlanthony" and "gilgeousalexander" work), or
 * whose initials are the 2 to 4 letters typed ("sga", "kat", "ad"), and,
 * when `watchedOnly` is on, only the players on the watchlist. A search with
 * no letters or digits ("🏀", "'", "-") matches nobody: the screen asks for
 * part of a name instead of showing everyone as if nothing were typed.
 */
export function filterMarketRows<T extends { player: PerGameMarketPlayer }>(
  rows: readonly T[],
  {
    query,
    watchedOnly,
    watched,
  }: { query: string; watchedOnly: boolean; watched: readonly string[] },
): T[] {
  if (query.trim() !== '' && !searchHasLetters(query)) return [];
  // A number beside a name ("luka 77") cannot match a name: it is left out.
  const words = searchKey(query).split(/\s+/).map((word) => word.replace(/-/g, '')).filter((word) => /\p{L}/u.test(word));
  const initials = words.length === 1 && /^\p{L}{2,4}$/u.test(words[0]) ? words[0] : null;
  const watchedSet = new Set(watched);
  return rows.filter((row) => {
    if (watchedOnly && !watchedSet.has(row.player.playerId)) return false;
    if (words.length === 0) return true;
    const key = searchKey(row.player.name);
    const starts = runTogether(row.player.name);
    if (words.every((word) => key.includes(word) || starts.some((start) => start.startsWith(word)))) return true;
    return initials !== null && nameInitials(row.player.name).includes(initials);
  });
}

export type SignalTone = 'gain' | 'loss' | 'even' | 'none';

export interface ValueSignal {
  /** Per-game edge at today's price from last season, sign already set for the side. */
  edge: number | null;
  /** The fact: "Dividend last season $120K a game ·", or null with no last season. */
  lead: string | null;
  /** The comparison: "$20K over his price", "+$20K for a short", "No last season". */
  text: string;
  tone: SignalTone;
}

/**
 * An amount rounded the way `money` prints it (to $1 under $10K, to $100
 * under $1M, then to $10K), so a difference of two printed figures is
 * itself a printed figure and the row's numbers add up on screen.
 */
export function shownAmount(amount: number): number {
  const abs = Math.abs(Math.round(amount));
  const step = abs < 10_000 ? 1 : abs < 999_950 ? 100 : 10_000;
  return Math.sign(amount) * Math.round(abs / step) * step;
}

/** Last season against today's price, from the figures as printed. */
export function shownEdge(
  player: Pick<PerGameMarketPlayer, 'currentGameCost' | 'priorSeasonValuePerGame'>,
  side: PerGamePositionSide,
): number | null {
  if (player.priorSeasonValuePerGame === null) return null;
  const edge = shownAmount(player.priorSeasonValuePerGame) - shownAmount(player.currentGameCost);
  return side === 'long' ? edge : -edge;
}

/**
 * The value line a fan reads at a glance: what his dividend paid a game last
 * season, then how that compares with his price today. On the Short tab the
 * comparison is what a short would have made (the sign flips).
 */
export function valueSignal(
  player: Pick<PerGameMarketPlayer, 'currentGameCost' | 'priorSeasonValuePerGame'>,
  side: PerGamePositionSide,
): ValueSignal {
  const edge = lastYearEdge(player, side) === null ? null : shownEdge(player, side);
  if (edge === null || player.priorSeasonValuePerGame === null) {
    return { edge: null, lead: null, text: 'No last season', tone: 'none' };
  }
  // "Dividend", not "Paid": a fan reads "paid $120K a game" as his salary.
  const lead = `Dividend last season ${money(player.priorSeasonValuePerGame)} a game ·`;
  const tone = netTone(edge);
  if (tone === 'even') return { edge, lead, text: 'even with his price', tone };
  // Compact, so a list reads "$6.5K under" beside "$21.5K over" (edges are
  // whole $100s, so nothing is lost).
  if (side === 'short') return { edge, lead, text: `${signedMoneyCompact(edge)} for a short`, tone };
  return { edge, lead, text: `${moneyCompact(Math.abs(edge))} ${edge > 0 ? 'over' : 'under'} his price`, tone };
}

/** "8 of 10 on your roster" / "1 of 5 shorts". */
export function slotSummary(side: PerGamePositionSide, slots: Pick<PerGameSlotSummary, 'used' | 'limit'>): string {
  return side === 'long'
    ? `${slots.used} of ${slots.limit} on your roster`
    : `${slots.used} of ${slots.limit} ${slots.limit === 1 ? 'short' : 'shorts'}`;
}

/** The action button's accessible name: "Add LeBron James at $105K a game". */
export function actionName(
  kind: 'open' | 'close',
  side: PerGamePositionSide,
  playerName: string,
  price: number,
): string {
  if (kind === 'open') return `${openVerb(side)} ${playerName} at ${perGame(price)}`;
  return side === 'long'
    ? `${closeVerb(side)} ${playerName} from your roster`
    : `${closeVerb(side)} your short on ${playerName}`;
}

/**
 * The button's accessible name during the moment after an Add or Short, while
 * it shows "Added ✓" and ignores taps: "Added Nikola Jokic to your roster".
 * It never starts with "Add" or "Short", so nothing mistakes it for an offer.
 */
export function justOpenedName(side: PerGamePositionSide, playerName: string): string {
  return side === 'long' ? `Added ${playerName} to your roster` : `Shorted ${playerName}`;
}

/** The same moment after a confirmed Drop or Close: "Dropped Nikola Jokic". */
export function justClosedName(side: PerGamePositionSide, playerName: string): string {
  return side === 'long' ? `Dropped ${playerName}` : `Closed your short on ${playerName}`;
}

/** How long the "Added ✓" / "Dropped ✓" state holds after the action lands. */
export const JUST_OPENED_MS = 1200;

/**
 * This account's own settled games with each player on one side, keyed by
 * player id. Corrections count once, at their latest revision.
 */
export function accountValueByPlayer(
  results: readonly PerGameSettledResult[],
  side: PerGamePositionSide,
): Map<string, ValueSummary> {
  const grouped = new Map<string, PerGameSettledResult[]>();
  for (const result of currentResults(results)) {
    if (result.side !== side) continue;
    const list = grouped.get(result.playerId) ?? [];
    list.push(result);
    grouped.set(result.playerId, list);
  }
  const summaries = new Map<string, ValueSummary>();
  for (const [playerId, list] of grouped) summaries.set(playerId, summarizeValue(list));
  return summaries;
}

/**
 * Each position's own settled games, keyed by position id: exactly
 * positionValue(results, id) for every position, in one pass. A held market
 * row reads its current position from here, the same source as its Roster row.
 */
export function valueByPosition(results: readonly PerGameSettledResult[]): Map<string, ValueSummary> {
  const grouped = new Map<string, PerGameSettledResult[]>();
  for (const result of currentResults(results)) {
    const list = grouped.get(result.positionId) ?? [];
    list.push(result);
    grouped.set(result.positionId, list);
  }
  const summaries = new Map<string, ValueSummary>();
  for (const [positionId, list] of grouped) summaries.set(positionId, summarizeValue(list));
  return summaries;
}

/** Colour for a per-game net: green above, red below, muted inside the even band. */
export function netTone(net: number | null): SignalTone {
  if (net === null) return 'none';
  if (Math.abs(net) < EVEN_BAND) return 'even';
  return net > 0 ? 'gain' : 'loss';
}

/**
 * What a held row says after "On your roster ·" / "Shorted ·": the current
 * position's net a game and games (positionValue, the Roster row's source),
 * or the price you locked in before his first game.
 */
export function heldDetail(summary: ValueSummary | undefined, lockedGameCost: number): {
  text: string;
  tone: SignalTone;
} {
  if (summary && summary.avgNet !== null && summary.games > 0) {
    // The Roster's per-game precision ("+$1.5K a game", not "+$1,473"), so
    // the same figure reads the same on both screens (walk 4 T4-13).
    return {
      text: `${signedMoneyCompact(summary.avgNet)} a game over ${summary.games === 1 ? '1 game' : `${summary.games} games`}`,
      tone: netTone(summary.avgNet),
    };
  }
  // His price box already shows your locked price ("yours $104.3K").
  return { text: 'no games yet', tone: 'none' };
}

/**
 * The action button's visible word. A pending action waits; a lock or a full
 * side says so on the button itself, so a dimmed button never goes
 * unexplained; right after an Add or Short it reads "Added ✓" / "Shorted ✓".
 * A Drop or Close asks in a confirm strip under the row, so the button itself
 * never turns into a second, costly tap. (At season end there are no buttons:
 * see `rowActions`.)
 */
export function actionWord({
  side,
  held,
  pending,
  rosterLocked,
  full,
  justOpened = false,
  justClosed = false,
}: {
  side: PerGamePositionSide;
  held: boolean;
  pending: boolean;
  rosterLocked: boolean;
  full: boolean;
  /** He was added or shorted a moment ago: the button says so and takes no taps. */
  justOpened?: boolean;
  /** He was dropped (or his short closed) a moment ago: the same quiet beat. */
  justClosed?: boolean;
}): string {
  const verb = held ? closeVerb(side) : openVerb(side);
  if (pending) return 'Wait';
  if (held && justOpened) return side === 'long' ? 'Added ✓' : 'Shorted ✓';
  if (!held && justClosed) return side === 'long' ? 'Dropped ✓' : 'Closed ✓';
  if (rosterLocked) return 'Locked';
  if (!held && full) return 'Full';
  return verb;
}


/** What the live region says when a player backs out of a Drop or Close. */
export function keptAnnouncement(side: PerGamePositionSide, playerName: string): string {
  return side === 'long' ? `Kept ${playerName} on your roster.` : `Kept your short on ${playerName}.`;
}

/**
 * The season is over when practice has played its last day, or when a live
 * season has settled games and no next game: the rule the Roster uses, so
 * the Market never sells a player the Roster calls final.
 */
export function isSeasonOver({
  practiceComplete,
  lastSettledDate,
  nextGameDate,
}: {
  practiceComplete: boolean;
  lastSettledDate: string | null;
  nextGameDate: string | null;
}): boolean {
  return practiceComplete || (lastSettledDate !== null && nextGameDate === null);
}

/**
 * Whether market rows carry Add, Drop and Short at all. Once the season is
 * over nothing can be bought or sold, so the rows go quiet (no button column,
 * nothing that could charge a fee) and the header's one line, "The season is
 * over", says why: one clear state instead of a column of dead buttons.
 */
export function rowActions(seasonOver: boolean): boolean {
  return !seasonOver;
}

export interface HeaderStatus {
  /** The line under the slot count, or null. */
  text: string | null;
  /** 'lock' draws the padlock and the one warning colour. */
  kind: 'season' | 'lock' | 'full' | null;
}

/**
 * The one line under "8 of 10 on your roster": the season is over, or
 * roster changes are locked (with when they reopen), or the side is full.
 * Only one shows, so a locked roster never advises a drop it cannot make.
 */
export function headerStatus({
  side,
  seasonOver,
  rosterLocked,
  lockGameDate,
  full,
}: {
  side: PerGamePositionSide;
  seasonOver: boolean;
  rosterLocked: boolean;
  lockGameDate: string | null;
  full: boolean;
}): HeaderStatus {
  if (seasonOver) return { text: 'The season is over', kind: 'season' };
  if (rosterLocked) return { text: rosterReopensLine(lockGameDate), kind: 'lock' };
  if (full) return { text: side === 'long' ? 'Full: drop one to add' : 'Full: close one to short', kind: 'full' };
  return { text: null, kind: null };
}

/**
 * Below this width (a phone at 200% zoom) search, sort and Watching fold
 * behind one toggle, so the first player shows without scrolling past them.
 */
export const COLLAPSE_CONTROLS_BELOW = 300;

/**
 * Below this height (a 600x400 window, a phone turned sideways) the phone
 * rows' toolbar would take most of the screen: search, sort and Watching fold
 * behind the same toggle, so at least three players show (walk 3 T4-16). The
 * table keeps its one-row toolbar.
 */
export const COLLAPSE_CONTROLS_BELOW_HEIGHT = 500;

/**
 * Folded below 300px wide, or below 500px tall at any width: a 1280x440
 * laptop window kept the full toolbar and showed about three rows (walk 4
 * T2-18). `table` is kept for callers; the rule no longer depends on it.
 */
export function collapseControls(width: number, height = Infinity, _table = false): boolean {
  return width < COLLAPSE_CONTROLS_BELOW || height < COLLAPSE_CONTROLS_BELOW_HEIGHT;
}

/**
 * The slot line ("0 of 10 on your roster", "$250 to add or drop") sits beside
 * the side toggle from this width, in up to three short lines; narrower, it
 * goes under the toggle, left-aligned, so no empty block is left beside it
 * (walk 3 T1-09).
 */
export const SLOT_LINE_BESIDE_MIN_WIDTH = 340;

export function slotLineBeside(width: number): boolean {
  return width >= SLOT_LINE_BESIDE_MIN_WIDTH;
}

/**
 * From this width the kicker names the tier ("KARL-ANTHONY · STAR"). The
 * phone row puts the kicker and the price on one line, and below 380px the
 * longest given names only fit there without the tier.
 */
export const KICKER_TIER_MIN_WIDTH = 380;

/**
 * "NIKOLA · STAR", or just "NIKOLA" below KICKER_TIER_MIN_WIDTH. The space
 * before the dot does not break, so a wrapped kicker never starts a line
 * with "·" (walk 3 T2-12).
 */
export function rowKicker(given: string, tier: string | null | undefined, width: number): string {
  const label = width >= KICKER_TIER_MIN_WIDTH ? tierLabel(tier) : '';
  if (!label) return given;
  // The tier only where the whole kicker fits beside the price: "DONOVAN ·
  // ROLE PLAYER" at 390 pushed the price onto its own line, so the row was
  // taller than it is once held (first name only) and the rows below moved
  // when he was added.
  const full = `${given}\u00A0· ${label}`;
  return full.length <= kickerRoom(width) ? full : given;
}

/** About how many kicker characters fit beside the price on a row this wide. */
function kickerRoom(width: number): number {
  return Math.floor((width - 245) / 7);
}

/**
 * The tier in words where a row shows it: "Role player", "Starter", "Star".
 * A bare "ROLE" beside a first name read like part of his name (walk 4
 * T1-21). "Role player" never breaks inside.
 */
export function tierLabel(tier: string | null | undefined): string {
  const word = spokenTier(tier);
  return word ? `${word[0].toUpperCase()}${word.slice(1)}`.replace(' ', '\u00A0') : '';
}

/** The tier as a word aloud: "role player", "starter", "star" (walk 3 T3-30). */
export function spokenTier(tier: string | null | undefined): string {
  const word = (tier ?? '').toLowerCase();
  return word === 'role' ? 'role player' : word;
}

/**
 * What a held row still says about value, aloud: "last season $120K a game,
 * $6.5K under today's price" (walk 3 T3-30: holding him used to drop it).
 */
export function heldValuePhrase(
  player: Pick<PerGameMarketPlayer, 'currentGameCost' | 'priorSeasonValuePerGame'>,
  side: PerGamePositionSide,
): string {
  const signal = valueSignal(player, side);
  if (signal.edge === null || player.priorSeasonValuePerGame === null) return 'no last season';
  const lead = `last season ${money(player.priorSeasonValuePerGame)} a game`;
  if (signal.tone === 'even') return `${lead}, even with today's price`;
  if (side === 'short') return `${lead}, ${signedMoneyCompact(signal.edge)} for a short at today's price`;
  return `${lead}, ${moneyCompact(Math.abs(signal.edge))} ${signal.edge > 0 ? 'over' : 'under'} today's price`;
}

export type MarketLayout = 'phone' | 'large' | 'table';

/**
 * Names stay whole at their hyphen ("Gilgeous-Alexander") while a line can
 * hold them. Below 320px even the longest surname no longer fits, and a break
 * at the hyphen beats the browser breaking inside the word.
 */
export function keepNamesWhole(width: number): boolean {
  return width >= 320;
}

/**
 * Below this height (a phone turned sideways, 844x390) the table's toolbar and
 * column labels would fill the screen, and once they scroll away the rows are
 * bare numbers. Short windows get the phone rows instead, which label their
 * own figures, with the toolbar scrolling away with the list.
 */
export const SHORT_WINDOW_BELOW = 500;

/**
 * From this height the table keeps its toolbar and column labels in view and
 * explains the side in a sentence. A shorter window (a laptop split screen)
 * drops the sentence and lets the toolbar and labels scroll with the list,
 * so more players show at once.
 */
export const ROOMY_MIN_HEIGHT = 560;

/**
 * Row layout for a window: a table with aligned columns from tablet width up
 * (768px) when the window is tall enough to keep its labels in view, the
 * phone row otherwise, and the one-column large-text row when text is scaled
 * up or the window is under 300px (a phone zoomed to 200%).
 */
export function marketLayout(width: number, fontScale: number, height = Infinity): MarketLayout {
  if (fontScale > 1.3 || width < 300) return 'large';
  if (width < 768) return 'phone';
  // A phone turned sideways (short and under 1000px) gets the phone rows, which
  // label their own figures; a short desktop window keeps the table rather
  // than stretching phone rows across 1200px (walk 3 T2-10).
  return height >= SHORT_WINDOW_BELOW || width >= 1000 ? 'table' : 'phone';
}

export interface MarketColumnSet {
  avatar: number;
  price: number;
  lastSeason: number;
  edge: number;
  /** Your net a game column; 0 hides it (your stake then reads under the name). */
  yours: number;
  action: number;
  gap: number;
}

/**
 * Column widths for the table. A tablet or small laptop gets narrower columns
 * and no "Your net a game" column, so the player column keeps room for a name.
 */
export function marketColumns(width: number): MarketColumnSet {
  // Each sortable label keeps a 24px sort mark to its left: "PRICE A GAME"
  // fits one line from 1100px; "DIVIDEND" / "LAST SEASON" takes two.
  return width >= 1100
    ? { avatar: 36, price: 116, lastSeason: 112, edge: 140, yours: 150, action: 112, gap: 12 }
    : { avatar: 32, price: 96, lastSeason: 110, edge: 108, yours: 0, action: 90, gap: 12 };
}

/**
 * The row's screen-reader label. It always ends in "View profile" because the
 * row opens the profile; the QA harness and assistive tech both rely on it.
 */
export function rowProfileLabel({
  name,
  tier,
  price,
  detail,
  reason,
}: {
  name: string;
  tier: string;
  price: number;
  detail: string;
  reason?: string | null;
}): string {
  const facts = [name, spokenTier(tier), perGame(price), detail].filter(Boolean).join(', ');
  return reason ? `${facts}. ${reason} View profile` : `${facts}, View profile`;
}

/** What a screen reader hears when typing pauses: "7 players match "le"". */
export function searchResultLine(query: string, count: number): string {
  if (!query) return `Showing all ${count} ${count === 1 ? 'player' : 'players'}.`;
  if (count === 0) return `No players match "${query}".`;
  return `${count} ${count === 1 ? 'player matches' : 'players match'} "${query}".`;
}

/**
 * What a screen reader hears when the list changes, once typing pauses: a
 * search's matches; right after a search is cleared, that the list is back
 * ("Search cleared, 30 players."); the Watching filter's count against
 * everyone ("Watching: 0 players. Show everyone to see all 30.").
 */
export function listCountLine({
  query,
  count,
  total,
  watchedOnly,
  cleared = false,
}: {
  query: string;
  count: number;
  /** Every player on this side, before any filter. */
  total: number;
  watchedOnly: boolean;
  /** The search was just emptied. */
  cleared?: boolean;
}): string {
  const players = (n: number) => `${n} ${n === 1 ? 'player' : 'players'}`;
  if (query && !searchHasLetters(query)) return `${SEARCH_NEEDS_LETTERS}.`;
  if (query) return searchResultLine(query, count);
  if (cleared) return watchedOnly ? `Search cleared. Watching: ${players(count)}.` : `Search cleared, ${players(count)}.`;
  if (watchedOnly) return `Watching: ${players(count)}. Show everyone to see all ${total}.`;
  return `Showing all ${players(count)}.`;
}

/**
 * Whether a sort runs low to high (aria-sort "ascending", the ↑ arrow).
 * Price and Name start low to high; Value starts with the highest value.
 */
export function sortAscending(sort: MarketSort, reversed = false): boolean {
  return sort === 'value' || sort === 'dividend' ? reversed : !reversed;
}

/** The sort's direction in plain words: "lowest first", "highest first", "A to Z". */
export function sortDirection(sort: MarketSort, reversed = false): string {
  const ascending = sortAscending(sort, reversed);
  if (sort === 'name') return ascending ? 'A to Z' : 'Z to A';
  return ascending ? 'lowest first' : 'highest first';
}

/**
 * The list in its unusual order says so in words, with the way back
 * (walk 3 T1-08: a second tap on Value quietly showed the worst value first).
 */
export function flippedSortNote(sort: MarketSort): { text: string; restore: string } {
  if (sort === 'value') return { text: 'Showing the worst value first.', restore: 'Best value first' };
  if (sort === 'price') return { text: 'Showing the highest price first.', restore: 'Lowest price first' };
  if (sort === 'dividend') return { text: 'Showing the lowest dividend first.', restore: 'Highest dividend first' };
  return { text: 'Showing names Z to A.', restore: 'A to Z' };
}

/** What a screen reader hears when the sort changes: "Sorted by price, lowest first." */
export function sortedLine(sort: MarketSort, reversed = false): string {
  return `Sorted by ${sort === 'dividend' ? 'dividend last season' : sort}, ${sortDirection(sort, reversed)}.`;
}

/**
 * Why FULL cannot add him, and what to do: "Your roster is full (10 of 10).
 * Drop a player to add Tyrese Maxey." The button under it opens the Roster.
 */
export function fullNote(side: PerGamePositionSide, playerName: string, limit: number): { message: string; action: string } {
  return side === 'long'
    ? { message: `Your roster is full (${limit} of ${limit}). Drop a player to add ${playerName}.`, action: 'Choose who to drop' }
    : { message: `All ${limit} short ${limit === 1 ? 'slot is' : 'slots are'} in use. Close a short to short ${playerName}.`, action: 'Choose a short to close' };
}

/**
 * FULL's accessible name: why it cannot add him, with the visible word in it
 * for voice control. It never starts with "Add" or "Short", so nothing reads
 * it as an offer.
 */
export function fullActionName(side: PerGamePositionSide, playerName: string): string {
  return side === 'long'
    ? `Roster full: drop a player to add ${playerName}`
    : `Shorts full: close a short to short ${playerName}`;
}

/** What the Roster says when "Choose who to drop" brings its list forward. */
export function rosterPickReason(playerName: string, side: 'long' | 'short' = 'long'): string {
  return side === 'long'
    ? `Pick a player to drop to make room for ${playerName}.`
    : `Pick a short to close to make room for ${playerName}.`;
}

/**
 * The slot line as the toolbar prints it: "0 of 10" and "on your roster"
 * each stay whole, so a narrow phone breaks only between them, never
 * "0 of 10 on / your roster" (walk 4 T1-11).
 */
export function slotLine(side: PerGamePositionSide, slots: Pick<PerGameSlotSummary, 'used' | 'limit'>): string {
  const count = `${slots.used}\u00A0of\u00A0${slots.limit}`;
  return `${count} ${slotSummary(side, slots).slice(`${slots.used} of ${slots.limit} `.length).replace(/ /g, '\u00A0')}`;
}

/** The fee line as the toolbar prints it: it breaks only after the amount ("$250" / "to add or drop"). */
export function feeLine(side: PerGamePositionSide, fee: number): string {
  return feeHint(side, fee).replace(/ /g, '\u00A0').replace('\u00A0', ' ');
}

/** The fee, said where the side is chosen: "$250 to add or drop". Empty with no fee. */
export function feeHint(side: PerGamePositionSide, fee: number): string {
  if (fee <= 0) return '';
  return side === 'long' ? `${exactMoney(fee)} to add or drop` : `${exactMoney(fee)} to short or close`;
}

/** Two flat records (a player, a position, a value summary) hold the same values. */
export function sameFlat(a: object | null | undefined, b: object | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => Object.is(left[key], right[key]));
}

interface RowFields {
  player: object;
  position: object | null;
  side: string;
  isFull: boolean;
  blockedByOpposingPosition: boolean;
  canSubmit: boolean;
  unavailableReason: string | null;
}

/**
 * A market row shows the same thing: its player, its position and its own
 * flags hold the same values. Every snapshot rebuilds the row objects, so
 * identity alone would redraw all thirty rows for one Add (walk 4 T4-11).
 */
export function sameMarketRow(a: RowFields, b: RowFields): boolean {
  return a === b || (
    a.side === b.side
    && a.isFull === b.isFull
    && a.blockedByOpposingPosition === b.blockedByOpposingPosition
    && a.canSubmit === b.canSubmit
    && a.unavailableReason === b.unavailableReason
    && sameFlat(a.player, b.player)
    && sameFlat(a.position, b.position)
  );
}

/** Row props compared by value: records field by field, everything else (flags, stable callbacks) by identity. */
const FLAT_ROW_PROPS = new Set(['columns', 'currentValue', 'pastValue']);

/**
 * Whether a market row can skip a redraw: only the row an Add, a Drop or a
 * star touched draws again, not the whole list (walk 4 T4-11). A callback
 * that is not stable simply redraws the row, so a wrong answer is never stale.
 */
export function sameMarketRowProps(prev: Readonly<Record<string, unknown>>, next: Readonly<Record<string, unknown>>): boolean {
  const keys = Object.keys(next);
  if (keys.length !== Object.keys(prev).length) return false;
  return keys.every((key) => {
    if (key === 'row') return sameMarketRow(prev.row as RowFields, next.row as RowFields);
    if (FLAT_ROW_PROPS.has(key)) return sameFlat(prev[key] as object | undefined, next[key] as object | undefined);
    return Object.is(prev[key], next[key]);
  });
}

/**
 * The list in the order it was shown (`previousIds`), with rows new to it at
 * the end in their sorted order; the sorted list itself when there is no
 * earlier order for this view. Keeps rows from trading places under the
 * finger when a move changes a player's price.
 */
export function keepListOrder<T extends { player: { playerId: string } }>(
  sorted: readonly T[],
  previousIds: readonly string[] | null,
): T[] {
  if (!previousIds) return [...sorted];
  const place = new Map(previousIds.map((id, index) => [id, index]));
  const known = sorted.filter((row) => place.has(row.player.playerId));
  const added = sorted.filter((row) => !place.has(row.player.playerId));
  known.sort((a, b) => (place.get(a.player.playerId) as number) - (place.get(b.player.playerId) as number));
  return [...known, ...added];
}
