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
  moneyFine,
  openVerb,
  perGame,
  rosterReopensLine,
  signedMoney,
  signedMoneyFine,
} from '../copy/terms';
import {
  currentResults,
  lastYearEdge,
  summarizeValue,
  type ValueSummary,
} from './perGameMetrics';
import { splitPlayerName } from './playerName';

export type MarketSort = 'price' | 'value' | 'name';

/** Sort choices, in the order the control shows them. Hints are for screen readers. */
export const MARKET_SORT_OPTIONS: { key: MarketSort; label: string; hint: string }[] = [
  { key: 'price', label: 'Price', hint: 'Lowest price a game first' },
  { key: 'value', label: 'Value', hint: 'Highest value against last season first' },
  { key: 'name', label: 'Name', hint: 'By last name, A to Z' },
];

/**
 * The sort choices with the chosen one's direction on it: "Price ↑" runs
 * lowest first, "Price ↓" highest first. Choosing it again flips it.
 */
export function marketSortOptions(sort: MarketSort, reversed: boolean): { key: MarketSort; label: string; hint: string }[] {
  return MARKET_SORT_OPTIONS.map((option) => {
    if (option.key !== sort) return option;
    // Price and Name run low to high (↑) by default; Value runs highest first (↓).
    const up = sortAscending(option.key, reversed);
    return { ...option, label: `${option.label} ${up ? '↑' : '↓'}`, hint: `${sortedLine(option.key, reversed)} Choose again to flip.` };
  });
}

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
  if (sort !== 'value') return ordered.reverse();
  const known = ordered.filter((row) => lastYearEdge(row.player, side) !== null);
  return [...known.reverse(), ...ordered.filter((row) => lastYearEdge(row.player, side) === null)];
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
  return sorted.sort((left, right) => {
    const leftEdge = lastYearEdge(left.player, side);
    const rightEdge = lastYearEdge(right.player, side);
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
 * Keep the rows whose name contains every word typed (in any order), and,
 * when `watchedOnly` is on, only the players on the watchlist.
 */
export function filterMarketRows<T extends { player: PerGameMarketPlayer }>(
  rows: readonly T[],
  {
    query,
    watchedOnly,
    watched,
  }: { query: string; watchedOnly: boolean; watched: readonly string[] },
): T[] {
  const words = searchKey(query).split(/\s+/).filter(Boolean);
  const watchedSet = new Set(watched);
  return rows.filter((row) => {
    if (watchedOnly && !watchedSet.has(row.player.playerId)) return false;
    if (words.length === 0) return true;
    const key = searchKey(row.player.name);
    return words.every((word) => key.includes(word));
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
  if (side === 'short') return { edge, lead, text: `${signedMoney(edge)} for a short`, tone };
  return { edge, lead, text: `${money(Math.abs(edge))} ${edge > 0 ? 'over' : 'under'} his price`, tone };
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
    // The Roster's precision, so the same figure reads the same on both screens.
    return {
      text: `${signedMoneyFine(summary.avgNet)} a game over ${summary.games === 1 ? '1 game' : `${summary.games} games`}`,
      tone: netTone(summary.avgNet),
    };
  }
  return { text: `locked at ${moneyFine(lockedGameCost)}`, tone: 'none' };
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

export function collapseControls(width: number): boolean {
  return width < COLLAPSE_CONTROLS_BELOW;
}

/**
 * From this width the kicker names the tier ("KARL-ANTHONY · STAR"). The
 * phone row puts the kicker and the price on one line, and below 380px the
 * longest given names only fit there without the tier.
 */
export const KICKER_TIER_MIN_WIDTH = 380;

/** "NIKOLA · STAR", or just "NIKOLA" below KICKER_TIER_MIN_WIDTH. */
export function rowKicker(given: string, tier: string | null | undefined, width: number): string {
  return [given, width >= KICKER_TIER_MIN_WIDTH ? tier : null].filter(Boolean).join(' · ');
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
  return width >= 768 && height >= SHORT_WINDOW_BELOW ? 'table' : 'phone';
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
  return width >= 1100
    ? { avatar: 36, price: 104, lastSeason: 104, edge: 140, yours: 150, action: 112, gap: 12 }
    : { avatar: 32, price: 100, lastSeason: 96, edge: 108, yours: 0, action: 96, gap: 12 };
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
  const facts = [name, tier.toLowerCase(), perGame(price), detail].filter(Boolean).join(', ');
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
  return sort === 'value' ? reversed : !reversed;
}

/** The sort's direction in plain words: "lowest first", "highest first", "A to Z". */
export function sortDirection(sort: MarketSort, reversed = false): string {
  const ascending = sortAscending(sort, reversed);
  if (sort === 'name') return ascending ? 'A to Z' : 'Z to A';
  return ascending ? 'lowest first' : 'highest first';
}

/** What a screen reader hears when the sort changes: "Sorted by price, lowest first." */
export function sortedLine(sort: MarketSort, reversed = false): string {
  return `Sorted by ${sort}, ${sortDirection(sort, reversed)}.`;
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

/** The fee, said where the side is chosen: "$250 to add or drop". Empty with no fee. */
export function feeHint(side: PerGamePositionSide, fee: number): string {
  if (fee <= 0) return '';
  return side === 'long' ? `${exactMoney(fee)} to add or drop` : `${exactMoney(fee)} to short or close`;
}
