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
  humanDate,
  humanDaySpan,
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
 * choosing a sort shows it in its natural order (Price, Value and Dividend
 * highest first, Name A to Z) and choosing the one in use
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

/** What the table's Dividend last season and Your profit headers explain on hover and focus. */
export const COLUMN_EXPLANATIONS = {
  dividend: 'What he paid out a game last season',
  // "Your profit a game" says what it is, like its neighbours (walk 6 T2-03).
  yours: 'Your result a game so far, on players you hold',
} as const;

/**
 * What the Value header explains, true to its side (walk 10 T2-07: the
 * Short side stated the roster's formula, so +$69K read as a player who
 * out-earned his price). Plus is good for you on either side.
 */
export function valueColumnExplanation(side: PerGamePositionSide): string {
  return side === 'short'
    ? "His price minus last season's dividend (your price once you short him). Plus is good for you."
    : "Last season's dividend minus his price (your price once you hold him). Plus is good for you.";
}

/**
 * A held row's caption under its price at table widths: today's price when
 * your add has moved it ("now $387.5K"; the big figure above is already
 * yours, walk 6 T2-14: "yours · now $387.5K" wrapped at 768px), or that the
 * price is locked.
 */
export function heldPriceCaption(lockedGameCost: number, currentGameCost: number): string {
  return lockedGameCost !== currentGameCost ? `now ${money(currentGameCost)}` : 'yours, locked in';
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
export function sortMarketRows<T extends MarketSortRow>(
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

/** A row the market can sort: its player, and your position on this side if you hold him. */
export interface MarketSortRow {
  player: PerGameMarketPlayer;
  position?: { lockedGameCost: number } | null;
}

/**
 * The Value a row shows, as printed: last season's dividend against the price
 * you locked once you hold him (the Roster's figure, walk 5 T4-02, T1-02),
 * against today's price otherwise. A short is the other way round (locked
 * credit minus dividend). Null with no last season.
 */
export function rowValueEdge(
  player: Pick<PerGameMarketPlayer, 'currentGameCost' | 'priorSeasonValuePerGame'>,
  side: PerGamePositionSide,
  position?: { lockedGameCost: number } | null,
): number | null {
  return shownEdge(position ? { ...player, currentGameCost: position.lockedGameCost } : player, side);
}

function sortForward<T extends MarketSortRow>(
  rows: readonly T[],
  sort: MarketSort,
  side: PerGamePositionSide,
): T[] {
  const byPrice = (left: T, right: T) => left.player.currentGameCost - right.player.currentGameCost;
  const byName = (left: T, right: T) => compareNames(left.player.name, right.player.name);
  const sorted = [...rows];
  if (sort === 'name') return sorted.sort((left, right) => byName(left, right) || byPrice(left, right));
  // Price starts with the stars, highest first, like Value (walk 9 T1-16).
  if (sort === 'price') return sorted.sort((left, right) => byPrice(right, left) || byName(left, right));
  // Value sorts by the figure each row prints (a held row's is at your price).
  const figure = sort === 'dividend'
    ? (row: T) => row.player.priorSeasonValuePerGame
    : (row: T) => rowValueEdge(row.player, side, row.position);
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
  const watchedSet = new Set(watched);
  const shown = rows.filter((row) => !watchedOnly || watchedSet.has(row.player.playerId));
  if (words.length === 0) return shown;
  // A fan's nickname for a listed player finds him alone ("wemby", "joker").
  const nickname = nicknameFor(query);
  if (nickname !== null) {
    const found = shown.filter((row) => searchKey(row.player.name) === nickname);
    if (found.length > 0) return found;
  }
  // Single letters with spaces between ("O G", "s g a") are initials or a
  // name spelled out: they find OG Anunoby, not every name holding an O and
  // a G (walk 5 T4-10).
  if (words.length > 1 && words.every((word) => word.length === 1)) {
    const letters = words.join('');
    return shown.filter((row) => nameInitials(row.player.name).includes(letters)
      || searchKey(row.player.name).split(/[\s-]+/).includes(letters));
  }
  const initials = words.length === 1 && /^\p{L}{2,4}$/u.test(words[0]) ? words[0] : null;
  return shown.filter((row) => {
    const key = searchKey(row.player.name);
    const starts = runTogether(row.player.name);
    if (words.every((word) => key.includes(word) || starts.some((start) => start.startsWith(word)))) return true;
    return initials !== null && nameInitials(row.player.name).includes(initials);
  });
}

/** Edits between two words, a swap of neighbours counting as one ("jokci" is one from "jokic"). */
function typoDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Typos a typed word may hold and still name a player: none under 4 letters, then 1, 2 from 6, 3 from 9. */
function typoAllowance(length: number): number {
  return length < 4 ? 0 : length < 6 ? 1 : length < 9 ? 2 : 3;
}

/** A search's way on when it finds nobody: what the button says and what it searches for. */
export interface NameSuggestion {
  label: string;
  query: string;
}

/**
 * The listed players a search that found nobody most likely meant (walk 14
 * T4-N1: "jokci", "doncci", "lukka", "antetokounpo", "brunsen" and "shai ga"
 * found nobody): every word typed is a part of his name, or its start, within
 * a typo or two (typoAllowance), or a short word is his surname's initials
 * ("shai ga"), and at least one word of 3 letters or more is spelled out.
 * The closest wins; two names that tie are both offered, in the list's order;
 * more that tie on the same word ("jalne": three Jalens) offer that word.
 */
export function nearestNames(query: string, names: readonly string[], max = 2): NameSuggestion[] {
  if (!searchHasLetters(query)) return [];
  const words = searchKey(query).split(/\s+/).map((word) => word.replace(/-/g, '')).filter((word) => /\p{L}/u.test(word));
  if (!words.some((word) => word.length >= 3)) return [];
  const scored: Array<{ name: string; cost: number; matched: string }> = [];
  for (const name of names) {
    const parts = searchKey(name).split(/[\s-]+/).filter(Boolean);
    const targets = new Set<string>();
    for (let from = 0; from < parts.length; from += 1) {
      for (let to = from + 1; to <= parts.length; to += 1) targets.add(parts.slice(from, to).join(''));
    }
    const surnameInitials = parts.slice(1).map((part) => part[0]).join('');
    let cost = 0;
    let spelled = false;
    const matched: string[] = [];
    for (const word of words) {
      let best = Infinity;
      let bestTarget = '';
      for (const target of targets) {
        const whole = typoDistance(word, target);
        const start = word.length >= 3 && target.length > word.length ? typoDistance(word, target.slice(0, word.length)) : Infinity;
        const distance = Math.min(whole, start);
        if (distance < best) {
          best = distance;
          bestTarget = target;
        }
      }
      if (best <= typoAllowance(word.length)) {
        cost += best;
        spelled = spelled || word.length >= 3;
        matched.push(bestTarget);
      } else if (word.length >= 2 && word.length <= 4 && word === surnameInitials) {
        cost += 1;
        matched.push(word);
      } else {
        cost = Infinity;
        break;
      }
    }
    if (Number.isFinite(cost) && spelled) scored.push({ name, cost, matched: matched.join(' ') });
  }
  if (scored.length === 0) return [];
  const best = Math.min(...scored.map((entry) => entry.cost));
  const tied = scored.filter((entry) => entry.cost === best);
  if (tied.length > max && tied.every((entry) => entry.matched === tied[0].matched)) {
    const label = tied[0].matched.replace(/(^|\s)\p{L}/gu, (letter) => letter.toLocaleUpperCase());
    return [{ label, query: label }];
  }
  return tied.slice(0, max).map((entry) => ({ label: entry.name, query: entry.name }));
}

/** "Did you mean Nikola Jokic?", "Did you mean Jalen Brunson or Jalen Duren?"; '' with none. */
export function didYouMeanLine(suggestions: readonly NameSuggestion[]): string {
  if (suggestions.length === 0) return '';
  return `Did you mean ${suggestions.map((entry) => entry.label).join(' or ')}?`;
}

/**
 * Nicknames fans type for well-known players (walk 5 T4-N3), each to one
 * full name. Only whole nicknames count, so "ant" finds Anthony Edwards when
 * he is listed and nobody else; when he is not, the search reads as letters.
 */
export const PLAYER_NICKNAMES: Readonly<Record<string, string>> = {
  wemby: 'Victor Wembanyama',
  joker: 'Nikola Jokic',
  'the joker': 'Nikola Jokic',
  'greek freak': 'Giannis Antetokounmpo',
  'the greek freak': 'Giannis Antetokounmpo',
  greekfreak: 'Giannis Antetokounmpo',
  spida: 'Donovan Mitchell',
  ant: 'Anthony Edwards',
  'ant man': 'Anthony Edwards',
  antman: 'Anthony Edwards',
  dame: 'Damian Lillard',
  'dame time': 'Damian Lillard',
  klaw: 'Kawhi Leonard',
  'the klaw': 'Kawhi Leonard',
  swipa: "De'Aaron Fox",
  durantula: 'Kevin Durant',
  'slim reaper': 'Kevin Durant',
  'the brow': 'Anthony Davis',
  'king james': 'LeBron James',
  'chef curry': 'Stephen Curry',
  'the process': 'Joel Embiid',
  'the beard': 'James Harden',
  // Walk 16 T4-03: "Bron" suggested Jalen Brunson or Jaylen Brown.
  bron: 'LeBron James',
  'the king': 'LeBron James',
  steph: 'Stephen Curry',
  kd: 'Kevin Durant',
  cp3: 'Chris Paul',
  'jimmy buckets': 'Jimmy Butler',
};

/**
 * Retired stars fans still type (walk 16 T4-01, T4-03), and their nicknames:
 * practice lists none of them, so a search for one says "No listed player
 * matches", with no near name offered ("Kobe" read "Rudy Gobert is not in
 * this practice season's 30 players"; "Shaq" offered Shai Gilgeous-Alexander).
 */
export const RETIRED_STARS: readonly string[] = [
  'Kobe Bryant', 'Michael Jordan', "Shaquille O'Neal", 'Tim Duncan', 'Larry Bird', 'Magic Johnson',
  'Kareem Abdul-Jabbar', 'Dirk Nowitzki', 'Dwyane Wade', 'Allen Iverson', 'Wilt Chamberlain', 'Bill Russell',
  'Hakeem Olajuwon', 'Kevin Garnett', 'Vince Carter', 'Tracy McGrady', 'Carmelo Anthony', 'Derrick Rose',
  'Yao Ming', 'Steve Nash', 'Dennis Rodman', 'Scottie Pippen', 'Charles Barkley', 'Karl Malone',
  'John Stockton', 'Dwight Howard', 'Pau Gasol', 'Manu Ginobili', 'Tony Parker', 'Paul Pierce',
];

export const RETIRED_NICKNAMES: Readonly<Record<string, string>> = {
  mj: 'Michael Jordan',
  'air jordan': 'Michael Jordan',
  shaq: "Shaquille O'Neal",
  'black mamba': 'Kobe Bryant',
  mamba: 'Kobe Bryant',
  'the answer': 'Allen Iverson',
  kg: 'Kevin Garnett',
  tmac: 'Tracy McGrady',
  't mac': 'Tracy McGrady',
  melo: 'Carmelo Anthony',
  'd rose': 'Derrick Rose',
  drose: 'Derrick Rose',
  'the mailman': 'Karl Malone',
  'the dream': 'Hakeem Olajuwon',
  vinsanity: 'Vince Carter',
};

/**
 * Well-known players a fan may search for by name. Practice lists 30 of the
 * league, so a search for one it leaves out says so by name (walk 15 T1-N4:
 * "lebron" read "No listed player matches", and the fan scrolled 30 rows to
 * see who is here).
 */
export const WELL_KNOWN_PLAYERS: readonly string[] = [
  'LeBron James', 'Stephen Curry', 'Kevin Durant', 'Joel Embiid', 'James Harden', 'Anthony Davis',
  'Jayson Tatum', 'Jimmy Butler', 'Ja Morant', 'Zion Williamson', 'Paul George', 'Kyrie Irving',
  'Damian Lillard', 'Anthony Edwards', 'Trae Young', 'Tyrese Haliburton', 'Paolo Banchero', 'Chris Paul',
  'Klay Thompson', 'Russell Westbrook', 'Zach LaVine', 'DeMar DeRozan', 'Domantas Sabonis', 'Pascal Siakam',
  'Jalen Williams', 'Alperen Sengun', 'Franz Wagner', 'Lauri Markkanen', 'Jaren Jackson Jr.', 'Darius Garland',
  'Kristaps Porzingis', 'Jrue Holiday', 'Draymond Green', 'Rudy Gobert', 'Julius Randle', 'Mikal Bridges',
  'Jalen Green', 'Cooper Flagg', 'Luka Doncic', 'Nikola Jokic', 'Giannis Antetokounmpo', 'Shai Gilgeous-Alexander',
  'Victor Wembanyama', 'Jalen Brunson', 'Donovan Mitchell', 'Devin Booker', 'Kawhi Leonard', 'Jaylen Brown',
];

/** The name parts a search word can be exactly: first name, surname, any run of parts ("gilgeousalexander"). */
function nameTargets(name: string): Set<string> {
  const parts = searchKey(name).split(/[\s-]+/).filter(Boolean);
  const targets = new Set<string>();
  for (let from = 0; from < parts.length; from += 1) {
    for (let to = from + 1; to <= parts.length; to += 1) targets.add(parts.slice(from, to).join(''));
  }
  return targets;
}

/** First names fans shorten, read as the name itself ("steph curry" is Stephen Curry's full name). */
const FIRST_NAME_SHORT: Readonly<Record<string, string>> = { steph: 'stephen', bron: 'lebron' };

/** The names among `names` that every word of the search is exactly a part of. */
function exactNameHits(query: string, names: readonly string[]): string[] {
  const words = searchKey(query).split(/\s+/).map((word) => word.replace(/-/g, '')).filter((word) => /\p{L}/u.test(word))
    .map((word) => FIRST_NAME_SHORT[word] ?? word);
  if (words.length === 0) return [];
  return names.filter((name) => {
    const targets = nameTargets(name);
    return words.every((word) => targets.has(word));
  });
}

/**
 * What a practice search that found nobody says about a player practice
 * leaves out (walk 16 T4-01, T4-03):
 * - `star`: the search really names one well-known player: his first name,
 *   surname or full name, or a nickname fans use ("lebron", "bron", "king
 *   james", "curry"). The title names him; no near names are offered.
 * - `guess`: it only comes close to one ("embid"): a question under "No
 *   listed player matches", never a statement.
 * - `retired`: it names a retired star ("kobe", "shaq", "mj"): "No listed
 *   player matches", with no did-you-mean.
 * A name two players share ("james", "kevin") names nobody.
 */
export function unlistedSearch(query: string, listed: readonly string[]): { star: string | null; guess: string | null; retired: boolean } {
  const none = { star: null, guess: null, retired: false };
  if (!searchHasLetters(query)) return none;
  const listedKeys = new Set(listed.map((name) => searchKey(name)));
  const unlisted = WELL_KNOWN_PLAYERS.filter((name) => !listedKeys.has(searchKey(name)));
  const key = searchKey(query).replace(/[\s-]+/g, ' ');
  const nick = PLAYER_NICKNAMES[key];
  if (nick) return listedKeys.has(searchKey(nick)) ? none : { star: nick, guess: null, retired: false };
  if (RETIRED_NICKNAMES[key] || RETIRED_NICKNAMES[key.replace(/ /g, '')]) return { ...none, retired: true };
  const active = exactNameHits(query, WELL_KNOWN_PLAYERS);
  const retired = exactNameHits(query, RETIRED_STARS);
  if (active.length + retired.length > 1) return none;
  if (active.length === 1) return unlisted.includes(active[0]) ? { star: active[0], guess: null, retired: false } : none;
  if (retired.length === 1) return { ...none, retired: true };
  // Close to one name only, among the stars fans type: a question for an
  // active one, nothing for a retired one ("kobi").
  const near = nearestNames(query, [...WELL_KNOWN_PLAYERS, ...RETIRED_STARS], 2).map((entry) => entry.label);
  if (near.length !== 1) return none;
  if (RETIRED_STARS.includes(near[0])) return { ...none, retired: true };
  return unlisted.includes(near[0]) ? { star: null, guess: near[0], retired: false } : none;
}

/** The well-known player a search really names when practice does not list him, or null (unlistedSearch). */
export function unlistedStarFor(query: string, listed: readonly string[]): string | null {
  return unlistedSearch(query, listed).star;
}

/** A close search's question: "Did you mean Joel Embiid? He is not in this practice season's 30 players." */
export function unlistedGuessLine(name: string, listedCount: number): string {
  return `Did you mean ${name}? He is not in this practice season's ${listedCount} players.`;
}

/** "LeBron James is not in this practice season's 30 players" (walk 15 T1-N4). */
export function unlistedStarLine(name: string, listedCount: number): string {
  return `${name} is not in this practice season's ${listedCount} players`;
}

/** The player a nickname names, as a search key ("wemby" → "victor wembanyama"), or null. */
export function nicknameFor(query: string): string | null {
  const key = searchKey(query).replace(/[\s-]+/g, ' ');
  const name = PLAYER_NICKNAMES[key];
  return name ? searchKey(name) : null;
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
 * A per-game figure as the rows write it, in K to one decimal ("+$1.5K a
 * game"), except that one game's figure is its total and reads the same as
 * the total everywhere ("+$7.15K" on the Roster, the Market and the profile;
 * walk 15 T1-04: "+$7.1K" beside "+$7.15K" for one game).
 */
export function perGameFigure(summary: Pick<ValueSummary, 'games' | 'avgNet'>): string {
  if (summary.avgNet === null) return '';
  // One game's average is its total: written as totals are.
  return summary.games === 1 ? signedMoney(summary.avgNet) : signedMoneyCompact(summary.avgNet);
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
 * position's result (positionValue, the Roster row's source), the total
 * first, as the profile and the Roster's Total lead with it, then the average
 * (walk 10 T1-05: "+$113.5K a game over 4 games" beside the profile's
 * "+$454K over 4 games"); one game is "+$194.5K in 1 game" (walk 5 T1-05).
 * Before his first game: "no games yet". `why` explains a result bigger than
 * his price, muted beside it (walk 10 T1-03: "-$315K in 1 game" under "yours
 * $259K" read as a mistake): his dividend went below zero, so a roster spot
 * paid his price and more (a short kept his price and more).
 */
export function heldDetail(summary: ValueSummary | undefined, lockedGameCost: number): {
  text: string;
  /** The total alone ("+$454K over 4 games"), for a line too narrow for the average too. */
  total: string;
  tone: SignalTone;
  why: string | null;
} {
  if (summary && summary.avgNet !== null && summary.games > 0) {
    // The Roster's per-game precision for the average ("+$1.5K a game", not
    // "+$1,473"), the profile's for the total (walk 4 T4-13).
    const one = summary.games === 1;
    const below = summary.avgDividend !== null && Math.round(summary.avgDividend) < 0;
    const total = one ? `${perGameFigure(summary)} in 1 game` : `${signedMoney(summary.total)} over ${summary.games} games`;
    return {
      text: one ? total : `${total}, ${signedMoneyCompact(summary.avgNet)} a game`,
      total,
      tone: netTone(one ? summary.avgNet : summary.total),
      why: below ? (one ? 'a below-zero night' : 'below zero on average') : null,
    };
  }
  // His price box already shows your locked price ("yours $104.3K/game").
  return { text: 'no games yet', total: 'no games yet', tone: 'none', why: null };
}

/** A phrase kept on one line: its spaces made no-break ("over 82 games"). */
function unbroken(phrase: string): string {
  return phrase.replace(/ /g, ' ');
}

/**
 * The wordings a held row's first value line tries after its tag, fullest
 * first: with the average, the why, the short why, the total alone, then the
 * figure alone (the tag already says whose, and at season end when). The row
 * shows the first that fits on its one line; each phrase keeps its words
 * together, so a line that must still wrap never leaves one word alone (walk
 * 12 T1-05 at 360px: "(a below-zero" / "night)", "+$5.50M over 82" / "games").
 * `shortWhy` starts from the short why (below 360px).
 */
export function heldLineWordings(
  held: { text: string; total: string; why: string | null },
  shortWhy = false,
): Array<{ text: string; why: string | null }> {
  const why = held.why && shortWhy ? 'below zero' : held.why;
  const figure = held.total.replace(/ (?:in|over) \d+ games?$/, '');
  const steps = [
    { text: held.text, why },
    { text: held.total, why },
    { text: held.total, why: why ? 'below zero' : null },
    { text: held.total, why: null },
    { text: figure, why: null },
  ];
  const out: Array<{ text: string; why: string | null }> = [];
  for (const step of steps) {
    const shown = { text: step.text.split(', ').map(unbroken).join(', '), why: step.why ? unbroken(step.why) : null };
    if (!out.some((seen) => seen.text === shown.text && seen.why === shown.why)) out.push(shown);
  }
  return out;
}

/**
 * A held phone row's second value line: last season's dividend against the
 * price you locked, then today's price ("Last season +$71K at your price ·
 * now $418.5K"), so the figure matches the Roster's and today's price stays
 * in view (walk 5 T4-02, T1-02, T2-06). It says where the figure comes from
 * and the row draws it in neutral ink, so it never reads as what he made you
 * this season, which is the row's coloured result (walk 9 T1-06: a green
 * "Value +$35K" under a red -$153K a game). The price box carries "/game";
 * the line leaves "a game" out, like an unheld row's "$71K over his price".
 */
export function heldValueLine(
  player: Pick<PerGameMarketPlayer, 'currentGameCost' | 'priorSeasonValuePerGame'>,
  side: PerGamePositionSide,
  lockedGameCost: number,
): { edge: number | null; value: string; now: string; tone: SignalTone } {
  const edge = player.priorSeasonValuePerGame === null ? null : rowValueEdge(player, side, { lockedGameCost });
  // "price now", never a bare "now $418.5K" (walk 13 T1-05: it had no noun).
  const now = `price now ${money(player.currentGameCost)}`;
  if (edge === null) return { edge, value: 'No last season', now, tone: 'none' };
  const tone = netTone(edge);
  // Named Value, the word the list sorts by and the Market defines (walk 13
  // T1-05: "Last season +$71K" read as money he made you last season).
  return { edge, value: tone === 'even' ? 'Value even at your price' : `Value ${signedMoneyCompact(edge)} at your price`, now, tone };
}

/**
 * A held phone row's second line once he has played for you, fullest first
 * (walk 14 T1-09: "+$310K over 4 games" above "Value -$59.5K at your price"
 * read as a verdict against his result): today's price, then last season as
 * history, "last season -$59.5K a game at your price", in the row's neutral
 * ink. Every step says "a game" with the figure (walk 15 T1-03: "+$71K at
 * your price" read as money made last season), and the steps line up across
 * players, so the list shows every held row at one step (heldStepFloor): at
 * 360-390px all keep last season together (walk 15 T1-02: one row of three
 * lost it). A narrow row keeps last season, the figure the list sorts by;
 * today's price is in his profile. Before his first game for you the row
 * keeps "Value … at your price" (heldValueLine), a guide for the pick.
 */
export function heldPlayedWordings(
  player: Pick<PerGameMarketPlayer, 'currentGameCost' | 'priorSeasonValuePerGame'>,
  side: PerGamePositionSide,
  lockedGameCost: number,
): string[] {
  const now = `Price now ${money(player.currentGameCost)}`;
  const edge = player.priorSeasonValuePerGame === null ? null : rowValueEdge(player, side, { lockedGameCost });
  // Once he has played for you, today's price is the line's lead (walk 14
  // T1-09): where both halves do not fit, it is today's price that stays.
  if (edge === null) return [`${now} · no last season`, now];
  const yours = 'at your price';
  const past = netTone(edge) === 'even' ? `last season even ${yours}` : `last season ${signedMoneyCompact(edge)} a game ${yours}`;
  return [`${now} · ${past}`, now];
}

/**
 * A held phone row's first value line, decided once per list (walk 16 T1-13:
 * at 360px one held row kept "-$3K over 3 games, -$1K a game" while its
 * neighbours dropped their average): once any held row of the list has had
 * to drop its per-game average, every held row starts from the wording
 * without it (step 1 of heldLineWordings); a row's own fit may go further.
 */
export function heldFirstStep(ownStep: number, listDropsAverage: boolean, hasAverage: boolean, steps: number): number {
  const floor = listDropsAverage && hasAverage ? 1 : 0;
  return Math.max(0, Math.min(Math.max(ownStep, floor), steps - 1));
}

/** A row whose own fit could not keep its average (it has one): the list drops it on every held row. */
export function heldDropsAverage(ownStep: number, hasAverage: boolean): boolean {
  return hasAverage && ownStep > 0;
}

/**
 * The step every held row of a list shows (heldPlayedWordings): the most
 * compact any of them needs, so rows at one width say the same things (walk
 * 15 T1-02). `needed` is each row's own step, measured before paint.
 */
export function heldStepFloor(needed: readonly number[]): number {
  return needed.reduce((most, step) => Math.max(most, step), 0);
}

/**
 * What Value is, said once on a phone's Market, under the sort (walk 13
 * T1-01: "sorted by value" was a guess until a profile was opened; phones
 * have no hover tip). True to the side, as the table's header explains it.
 */
export function valueDefinition(side: PerGamePositionSide, narrow = false): string {
  // Below 360px the rows' own words, so it keeps one line (46 characters).
  if (narrow) return side === 'short' ? "Value: his price minus last season's dividend." : "Value: last season's dividend minus his price.";
  return side === 'short'
    ? "Value: today's price minus last season's dividend a game."
    : "Value: last season's dividend a game minus today's price.";
}

/**
 * Under a held row's Value on the tables: where the figure comes from, as a
 * held phone row says it ("Last season +$35K at your price"), so it never
 * reads as this season's result (walk 10 T2-12).
 */
export const HELD_VALUE_CAPTION = 'last season at\u00A0your\u00A0price';

/**
 * A held phone row's price keeps its "/game" (walk 10 T1-02: "yours $417.5K"
 * read as what he cost in all) and says "yours" beside it at every width
 * (walk 16 T1-04: under 440px the word was dropped, and the big figure, the
 * price you locked, read as today's price). The price box never shrinks: the
 * given name beside it gives way (cut short) first, so the line never wraps.
 */
export const HELD_YOURS_MIN_WIDTH = 0;

export function heldPriceSaysYours(width: number, ownLine: boolean): boolean {
  return ownLine || width >= HELD_YOURS_MIN_WIDTH;
}

/**
 * The phone row's price box keeps the width of the widest price the list can
 * show (each digit as its widest, "0"), held or not, so the given name beside
 * it has the same room before and after an Add whatever the price does
 * (walk 11 lead note: at 390px Karl-Anthony Towns' row grew 92 -> 102px
 * right after Add, when his price moved $379.5K -> $380.4K and a hidden copy
 * of the other state's line wrapped "Karl-Anthony"). `amounts` are the price
 * texts without "/game" ("$379.5K").
 */
export function priceWidthReserve(amounts: readonly string[]): string {
  let widest = '';
  for (const amount of amounts) {
    const shape = amount.replace(/\d/g, '0');
    if (shape.length > widest.length || (shape.length === widest.length && shape.endsWith('M') && !widest.endsWith('M'))) widest = shape;
  }
  return widest;
}

/**
 * From this width a held phone row's value line also says today's price
 * ("· now $418.2K"); narrower, it would wrap onto a third line on every row.
 */
export const HELD_NOW_MIN_WIDTH = 360;

/**
 * An unheld phone row's two value lines, broken after "a game ·" on every
 * row so every row has the same height (walk 5 T1-04); with no last season
 * the second line still says something.
 */
export function unheldValueLines(signal: ValueSignal): { first: string; second: string } {
  if (signal.lead === null) return { first: 'No last season ·', second: 'nothing to compare with his price' };
  return { first: signal.lead, second: signal.text };
}

/** Width of a display-face letter in ems (bold, generous), for fitting a surname on its line. */
const NAME_EM_PER_CHAR = 0.62;
/** A surname never shrinks below this. */
const NAME_MIN_SIZE = 11;

/**
 * The surname's font size for a line `room` px wide: full size when its
 * longest word fits, smaller when that word would be broken mid-word (walk 7
 * T4-08: "Antetokounm / po" at 180px). A plain hyphen may end a line, so
 * "Gilgeous-" and "Alexander" are words of their own; a kept-whole name's
 * non-breaking hyphen is not a break.
 */
export function surnameFontSize(surname: string, room: number, fullSize: number): number {
  const longest = surname.replace(/-/g, '- ').split(/[\s\u00A0]+/).reduce((most, word) => Math.max(most, word.length), 0);
  const fits = Math.floor(room / (Math.max(1, longest) * NAME_EM_PER_CHAR));
  return Math.max(NAME_MIN_SIZE, Math.min(fullSize, fits));
}

/**
 * A row's value line as drawn: on two lines the first ends without its "·"
 * (walk 7 T1-02: "…$488.5K a game ·" pointed at nothing); on one line the dot
 * leads the second part, held to its first word, so a wrap can never leave
 * it alone at a line's end.
 */
export function valueLineParts(first: string, second: string, oneLine: boolean): { first: string; joiner: string; second: string } {
  // A second part that starts its own line reads as a sentence, never a
  // lowercase fragment (walk 14 T1-10: "No last season" over "nothing to
  // compare with his price"; "even with his price" too).
  const own = oneLine ? second : second.replace(/^\p{Ll}/u, (letter) => letter.toLocaleUpperCase());
  return { first: first.replace(/\s*·\s*$/, ''), joiner: oneLine ? '·\u00A0' : '', second: own };
}

/**
 * From this width the phone row's two value lines fit side by side (a phone
 * turned sideways, 844x390): one line, so a short window shows more players.
 */
export const VALUE_ONE_LINE_MIN_WIDTH = 640;

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
  // The press paints its result at once (walk 5 T2-18): the move is still on
  // its way, so "Added ✓" comes before "Wait"; a failed move reverts it.
  if (held && justOpened) return side === 'long' ? 'Added ✓' : 'Shorted ✓';
  if (!held && justClosed) return side === 'long' ? 'Dropped ✓' : 'Closed ✓';
  if (pending) return 'Wait';
  if (rosterLocked) return 'Locked';
  if (!held && full) return 'Full';
  return verb;
}


/**
 * What a press on "Added ✓" / "Dropped ✓" says while the tick holds (walk 12
 * T4-02: a click on "Dropped ✓" a second after the drop did nothing, and the
 * player took it for a re-add): what the move did, then what the button does
 * once it is back, with its fee; while the move still saves, that it is on
 * its way. The tick itself never becomes a move: a held key or a fast third
 * tap must not buy him back.
 */
export function tickPressNotice(
  side: PerGamePositionSide,
  playerName: string,
  closed: boolean,
  feeDollars: number,
  saving = false,
): string {
  if (saving) {
    if (closed) return side === 'long' ? `Dropping ${playerName} now.` : `Closing your short on ${playerName} now.`;
    return side === 'long' ? `Adding ${playerName} now.` : `Shorting ${playerName} now.`;
  }
  const done = closed
    ? side === 'long' ? `${playerName} dropped.` : `Short on ${playerName} closed.`
    : side === 'long' ? `${playerName} added.` : `Shorted ${playerName}.`;
  const next = closed ? openVerb(side) : closeVerb(side);
  const fee = feeDollars > 0 ? `: ${exactMoney(feeDollars)} fee` : '';
  return `${done} Changed your mind? Press ${next} when it shows${fee}.`;
}

/**
 * For this long after a Drop or Close lands, the row's Add or Short asks
 * before it buys him back (walk 13 T4-11: the tick lasts 1.2 s, and a tap on
 * the same spot at 1.25 s added him again at a new price, with a second fee
 * and no question). A deliberate comeback costs one more tap; a late repeat
 * costs nothing.
 */
export const REOPEN_ASKS_WITHIN_MS = 5000;

export function reopenAsks(closedAt: number, now: number): boolean {
  return closedAt > 0 && now >= closedAt && now - closedAt < REOPEN_ASKS_WITHIN_MS;
}

/** The question a quick comeback asks, its answers, and what backing out says. */
export function reopenQuestion(
  side: PerGamePositionSide,
  playerName: string,
  price: number,
  feeDollars: number,
): { message: string; confirm: string; confirmName: string; cancel: string; kept: string } {
  const fee = feeDollars > 0 ? ` Another ${exactMoney(feeDollars)} fee.` : '';
  const forFee = feeDollars > 0 ? ` for ${exactMoney(feeDollars)}` : '';
  if (side === 'long') {
    return {
      message: `Add ${playerName} back at ${perGame(price)}? You dropped him a moment ago.${fee}`,
      confirm: `Add back${forFee}`,
      confirmName: `Add ${playerName} back at ${perGame(price)}${forFee}`,
      cancel: 'Not now',
      kept: `${playerName} stays off your roster.`,
    };
  }
  return {
    message: `Short ${playerName} again at ${perGame(price)}? You closed that short a moment ago.${fee}`,
    confirm: `Short again${forFee}`,
    confirmName: `Short ${playerName} again at ${perGame(price)}${forFee}`,
    cancel: 'Not now',
    kept: `Your short on ${playerName} stays closed.`,
  };
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
  short = false,
}: {
  side: PerGamePositionSide;
  seasonOver: boolean;
  rosterLocked: boolean;
  lockGameDate: string | null;
  full: boolean;
  /** The narrow slot column (lockLineShort): the lock line in two short lines. */
  short?: boolean;
}): HeaderStatus {
  if (seasonOver) return { text: 'The season is over', kind: 'season' };
  if (rosterLocked) return { text: short ? shortReopensLine(lockGameDate) : rosterReopensLine(lockGameDate), kind: 'lock' };
  if (full) return { text: side === 'long' ? 'Full: drop one to add' : 'Full: close one to short', kind: 'full' };
  return { text: null, kind: null };
}

/**
 * Beside the side toggle at 320-339px the slot column is 86-105px wide, and
 * "Moves reopen after Oct 28" took three lines to the fee's two, so the list
 * dropped 16px on a lock eve (walk 11 T4-08). There the padlock line says
 * "Reopens after Oct 28" ("Reopens" / "after Oct 28"), two lines like the fee.
 */
export const LOCK_LINE_SHORT_BELOW = 340;

export function lockLineShort(width: number): boolean {
  return slotLineBeside(width) && width < LOCK_LINE_SHORT_BELOW;
}

function shortReopensLine(lockGameDate: string | null): string {
  return lockGameDate ? `Reopens after ${humanDate(lockGameDate)}` : 'Reopens after these games';
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
 * Whether the folded panel's search box takes the caret as "Search & sort"
 * opens it: for a key press (walk 6 T3-02) and for a mouse click, so the
 * letters a desktop player types next filter the list (walk 13 T2-10: they
 * went nowhere); never for a finger or a pen, whose on-screen keyboard would
 * cover the list the tap opened. `pointerType` is the press's, or null.
 */
export function searchFocusOnOpen(byPointer: boolean, pointerType: string | null): boolean {
  return !byPointer || pointerType === 'mouse';
}

/** Below this width the phone's search box shares its row with Watching and is too narrow to read a query. */
export const SEARCH_WIDENS_BELOW = 360;

/**
 * Whether the phone's search box takes Watching's room: below 360px, while it
 * has focus or holds a search, Watching keeps only its star and count (still
 * there, still named "Watching"), so what you typed stays readable (walk 13
 * T4-06: at 320px "Gilgeous" showed as "ilgeous"). The row keeps its height.
 */
export function searchWidens(width: number, focused: boolean, query: string): boolean {
  return width < SEARCH_WIDENS_BELOW && (focused || query.length > 0);
}

/**
 * The slot line ("0 of 10 on your roster", "$250 to add or drop") sits beside
 * the side toggle from this width, in up to three short lines; narrower, it
 * goes under the toggle, left-aligned, so no empty block is left beside it
 * (walk 3 T1-09).
 */
export const SLOT_LINE_BESIDE_MIN_WIDTH = 320;

export function slotLineBeside(width: number): boolean {
  return width >= SLOT_LINE_BESIDE_MIN_WIDTH;
}

/**
 * Beside the side toggle each part of the slot line takes two lines at most
 * ("3 of 10" / "on your roster", "Reopens" / "after Oct 28"). A reader's text
 * spacing (or a larger font) that wraps a part to three or more ("3 of 10" /
 * "on your" / "roster") puts the slot line under the toggle, full width, so a
 * whole player shows in the first view (walk 15 T3-01). Each part is its
 * drawn height and its computed line height, in px.
 */
export function slotLinesCrowded(parts: ReadonlyArray<{ height: number; lineHeight: number }>): boolean {
  return parts.some(({ height, lineHeight }) => height > 0 && lineHeight > 0 && Math.round(height / lineHeight) > 2);
}

/**
 * Below this height a phone toolbar whose slot line was crowded (a reader's
 * text spacing) also folds search, sort and Watching behind "Search & sort",
 * as at 200% zoom: at 320x568 the spaced toolbar took 270px, and with the
 * week's four-line notice strip up no whole player showed even with the slot
 * line under the toggle (walk 15 T3-01). Folded, two whole players show.
 */
export const CROWDED_FOLD_BELOW_HEIGHT = 600;

export function crowdedToolbarFolds(height: number): boolean {
  return height < CROWDED_FOLD_BELOW_HEIGHT;
}

/**
 * The share of the window the rows keep under a pinned toolbar and column
 * labels. Below it (a laptop at 125-150% zoom, 960x600: the rows scrolled in
 * the bottom 206px) the toolbar folds search, sort and Watching behind its
 * "Search & sort" button, as on a short phone, so the rows get the room back
 * while the labels stay put (walk 10 T2-16).
 */
export const PINNED_ROWS_MIN_SHARE = 0.55;

/**
 * The fold is for short windows only: from this height (a portrait iPad,
 * 768x1024) search, sort and Watching stay out, as at 820x1180, and the rows
 * still keep about half the window, nine players or more (walk 12 T2-03: at
 * 768-800x1024 searching took an extra press).
 */
export const PINNED_FOLD_BELOW_HEIGHT = 900;

export function pinnedChromeTooTall(rowsHeight: number, windowHeight: number): boolean {
  if (!(rowsHeight > 0) || !(windowHeight > 0)) return false;
  if (windowHeight >= PINNED_FOLD_BELOW_HEIGHT) return false;
  return rowsHeight < windowHeight * PINNED_ROWS_MIN_SHARE;
}

/**
 * A short table window (500-559px tall) scrolls its toolbar and labels away
 * with the rows, but on arrival they take the top: at 853x533 (a 1280x800
 * laptop at 150%) the rows got 126px, two players (walk 11 T3-13). Where the
 * rows under them would get less than half the window, the toolbar folds
 * search, sort and Watching behind "Search & sort", as a pinned one does.
 */
export const ROWS_MIN_SHARE_ON_ARRIVAL = 0.5;

export function rowsUnderToolbarTooFew(rowsHeight: number, windowHeight: number): boolean {
  if (!(windowHeight > 0)) return false;
  return rowsHeight < windowHeight * ROWS_MIN_SHARE_ON_ARRIVAL;
}

/**
 * Whether a table keeps its toolbar and column labels in view while its rows
 * scroll. A short table (500-559px tall: 853x533, a 1280x800 laptop at 150%)
 * scrolled them away with the list and left rows of bare figures ("$365K
 * $376.5K +$11.5K", walk 15 T2-06); now every table 500px tall or more keeps
 * them, as 960x600 and 1280x610 do.
 */
export function tablePinsChrome(height: number): boolean {
  return height >= SHORT_WINDOW_BELOW;
}

/**
 * Whether a table's toolbar folds search, sort and Watching behind "Search &
 * sort" for its height alone: under 560px the full toolbar left the rows two
 * players (walk 11 T3-13), so it folds at once, with nothing to measure, and
 * the order line scrolls away as the table's first row (walk 15 T2-06).
 */
export function shortTableFolds(height: number): boolean {
  return height < ROOMY_MIN_HEIGHT;
}

/**
 * In the folded toolbar the slot line shares a row with the 44px "Search and
 * sort" button while the room left beside it holds its longest unbreakable
 * piece ("on your roster", "to short or close": about 96px, with room for
 * text-spacing overrides); narrower (400% zoom, about 100px) it takes a line
 * of its own. It never runs under the button (walk 6 T3-01, T4-10).
 */
export const FOLDED_SLOT_ROOM = 96;

export function foldedSlotBeside(width: number): boolean {
  // The folded bar's 8px insets, the button and its 8px gap.
  return width - 2 * 8 - 44 - 8 >= FOLDED_SLOT_ROOM;
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

/** The tier where "Role player" does not fit: "Role"; "Starter" and "Star" are already short. */
export function shortTierLabel(tier: string | null | undefined): string {
  const word = (tier ?? '').toLowerCase();
  if (!word) return '';
  return word === 'role' ? 'Role' : `${word[0].toUpperCase()}${word.slice(1)}`;
}

/** Where a phone row names the tier. */
export interface RowTier {
  /** The given name, as the kicker prints it (it may be cut short, never the tier). */
  given: string;
  /** The list's tier word at this width: "Role" or "Role player", "Starter", "Star"; '' with no tier. */
  tier: string;
  /** Beside the given name ("NIKOLA · STAR") or after the surname ("Jokic STAR ›"): one place per width. */
  place: 'kicker' | 'after';
}

// Phone row geometry, from the row's own styles: the row's insets, avatar and
// gap take 76px, the Add button and its gap 84px, and the widest price box
// ("$417.5K/game", or "yours $417.5K") with its gap about 97px. Character
// widths are generous averages for the kicker's 11px capitals.
const PHONE_BAND_INSET = 160;
const PHONE_PRICE_BOX = 97;
const KICKER_CHAR = 7.2;

/**
 * Whether a phone list at this width says "Role player" or "Role": decided
 * once per width from the longest given name in the market, so one list
 * never shows both (walk 6 T1-01, T4-03; walk 5 T1-03 picked it per row).
 */
export function fullTierFits(width: number, longestGiven: number): boolean {
  const kicker = longestGiven + ' · Role player'.length;
  return kicker * KICKER_CHAR <= width - PHONE_BAND_INSET - PHONE_PRICE_BOX;
}

/**
 * The tier on a phone row, never dropped and never moved row to row: from
 * 380px beside the given name on every row (a long given name is cut short
 * before the tier moves, walk 6 T4-06), below that after the surname on
 * every row; in the one word the list uses at this width.
 */
export function rowTier({
  given,
  tier,
  width,
  fullTier,
}: {
  given: string;
  tier: string | null | undefined;
  width: number;
  /** fullTierFits for this list and width. */
  fullTier: boolean;
}): RowTier {
  const word = fullTier ? tierLabel(tier) : shortTierLabel(tier);
  return { given, tier: word, place: width >= KICKER_TIER_MIN_WIDTH ? 'kicker' : 'after' };
}

/**
 * What a held row says about value, aloud, at the price you locked: "value
 * +$71K a game at your price, last season $488.5K a game, now $418.5K a
 * game" (walk 5 T4-02; walk 3 T3-30: holding him used to drop it).
 */
export function heldValuePhrase(
  player: Pick<PerGameMarketPlayer, 'currentGameCost' | 'priorSeasonValuePerGame'>,
  side: PerGamePositionSide,
  lockedGameCost: number,
  /** He has played for you: today's price first, last season as history (heldPlayedWordings). */
  played = false,
): string {
  const now = `price now ${perGame(player.currentGameCost)}`;
  const edge = rowValueEdge(player, side, { lockedGameCost });
  if (played) {
    if (edge === null || player.priorSeasonValuePerGame === null) return `${now}, no last season`;
    return `${now}, last season ${netTone(edge) === 'even' ? 'even' : `${signedMoneyCompact(edge)} a game`} at your price`;
  }
  if (edge === null || player.priorSeasonValuePerGame === null) return `no last season, ${now}`;
  // Said as the row shows it: Value at your price (walk 9 T1-06, walk 13 T1-05).
  const value = netTone(edge) === 'even' ? 'value even at your price' : `value ${signedMoneyCompact(edge)} a game at your price`;
  return `${value}, dividend ${money(player.priorSeasonValuePerGame)} a game, ${now}`;
}

export type MarketLayout = 'phone' | 'large' | 'table';

/**
 * Below this width a phone row leaves out the player's photo: its 44px give
 * the name and price line room, so "Gilgeous-Alexander STAR ›" and
 * "KARL-ANTHONY  $379.5K/game" keep one line each and every row has one
 * height (walk 9 T4-07: 110 and 103px among 92px rows at 320).
 */
export const PHONE_PHOTO_MIN_WIDTH = 360;

export function phoneRowPhoto(width: number): boolean {
  return width >= PHONE_PHOTO_MIN_WIDTH;
}

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
  locked = null,
}: {
  name: string;
  tier: string;
  price: number;
  detail: string;
  reason?: string | null;
  /** The price you locked, for a player you hold: the name says "yours $417.5K a game", as the row shows (walk 5 T4-02). */
  locked?: number | null;
}): string {
  const priceWords = locked === null ? perGame(price) : `yours ${perGame(locked)}`;
  const facts = [name, spokenTier(tier), priceWords, detail].filter(Boolean).join(', ');
  return reason ? `${facts}. ${reason} View profile` : `${facts}, View profile`;
}

/**
 * The name of a table row's player button, the row's header (walk 9 T3-02):
 * who he is and the way into his profile ("Luka Doncic, star, view
 * profile"), with his tag while held ("on your roster") or why this side
 * cannot take him. The figures are left to their own cells, which a screen
 * reader moving down a column now hears under his name.
 */
export function rowHeaderLabel({
  name,
  tier,
  tag = null,
  reason = null,
}: {
  name: string;
  tier: string | null | undefined;
  tag?: string | null;
  reason?: string | null;
}): string {
  const facts = rowHeaderName({ name, tier, tag });
  return reason ? `${facts}. ${reason} View profile` : `${facts}, view profile`;
}

/**
 * The table row header cell's own name (walk 13 T3-03): who he is, his tier
 * and his tag while held ("Luka Doncic, star, on your roster"). A screen
 * reader says it before every cell of his row and down every column, so
 * "view profile" and a blocked row's reason stay on his button inside it.
 */
export function rowHeaderName({
  name,
  tier,
  tag = null,
}: {
  name: string;
  tier: string | null | undefined;
  tag?: string | null;
}): string {
  return [name, spokenTier(tier), tag ? `${tag[0].toLowerCase()}${tag.slice(1)}` : ''].filter(Boolean).join(', ');
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
 * ("Search cleared. Showing all 30 players."); the Watching filter's count against
 * everyone, naming the button that is really there (walk 8 T2-07): "Show all
 * 30" under a list ("Watching: 1 player. Show all 30 is below the list."), or
 * the empty list's "Show everyone" ("Watching: 0 players. Show everyone to
 * see all 30.").
 */
export function listCountLine({
  query,
  count,
  total,
  watchedOnly,
  cleared = false,
  listed = count,
}: {
  query: string;
  count: number;
  /** Every player on this side, before any filter. */
  total: number;
  watchedOnly: boolean;
  /** The search was just emptied. */
  cleared?: boolean;
  /** Rows on screen, kept (unwatched, dimmed) rows too; defaults to `count`. */
  listed?: number;
}): string {
  const players = (n: number) => `${n} ${n === 1 ? 'player' : 'players'}`;
  if (query && !searchHasLetters(query)) return `${SEARCH_NEEDS_LETTERS}.`;
  if (query) return searchResultLine(query, count);
  // Says the list is whole again, in the words the list uses (walk 6 T3-N4).
  if (cleared) return watchedOnly ? `Search cleared. Watching: ${players(count)}.` : `Search cleared. Showing all ${players(count)}.`;
  if (watchedOnly) {
    // Says where the way back is, as the line under the list does (walk 10 T3-08).
    return listed > 0
      ? `Watching: ${players(count)}. Show all ${total} is below the list.`
      : `Watching: ${players(count)}. Show everyone to see all ${total}.`;
  }
  return `Showing all ${players(count)}.`;
}

/**
 * The player list's heading, for jumping past the toolbar to the players
 * (walk 7 T3-13): "Players (30)", "Players to short (30)", "Players (6 of 30)"
 * while a search or the Watching filter is on.
 */
export function listHeading(side: PerGamePositionSide, shown: number, total: number): string {
  const words = side === 'short' ? 'Players to short' : 'Players';
  return shown === total ? `${words} (${total})` : `${words} (${shown} of ${total})`;
}

/**
 * Said once when the Market opens with a search or the Watching filter still
 * on (walk 7 T3-19: a listener met a short list with no reason): "Still
 * showing 6 players matching "ja". Show all 30 is under the list."
 */
export function stillFilteredLine({ query, count, total, watchedOnly }: { query: string; count: number; total: number; watchedOnly: boolean }): string | null {
  const players = `${count} ${count === 1 ? 'player' : 'players'}`;
  if (query && searchHasLetters(query)) {
    const watching = watchedOnly ? ' you watch' : '';
    return count > 0
      ? `Still showing ${players}${watching} matching "${query}". Show all ${total} is under the list.`
      : `Search still on: no players${watching} match "${query}".`;
  }
  if (watchedOnly) return `Still showing only players you watch: ${players}. Show all ${total} is under the list.`;
  return null;
}

/** The line under a searched list, on screen as well as aloud: "6 players match "ja"" (walk 7 T3-19). */
export function searchFooterLine(query: string, count: number): string {
  return searchResultLine(query, count).replace(/\.$/, '');
}

/**
 * The line right under the folded panel's search box, so what a search found
 * is in view while you type (walk 8 T3-11: at 200% zoom the open panel filled
 * the screen and the one match sat below it). Names one or two matches, in
 * list order ("1 player: Shai Gilgeous-Alexander"), counts more ("7 players
 * match "le""). Null until the box holds letters.
 */
export function searchMatchLine(query: string, names: readonly string[]): string | null {
  const text = query.trim();
  if (!text || !searchHasLetters(text)) return null;
  const count = names.length;
  if (count === 0) return `No players match "${echoQuery(text)}"`;
  if (count <= 2) return `${count} ${count === 1 ? 'player' : 'players'}: ${names.join(', ')}`;
  return `${count} players match "${echoQuery(text)}"`;
}

/**
 * Whether a sort runs low to high (aria-sort "ascending", the ↑ arrow).
 * Name starts A to Z; Price, Value and Dividend start with the highest, as a
 * fan reads a stat table (walk 9 T1-16: Price opened on the cheapest).
 */
export function sortAscending(sort: MarketSort, reversed = false): boolean {
  return sort === 'name' ? !reversed : reversed;
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
  if (sort === 'price') return { text: 'Showing the lowest price first.', restore: 'Highest price first' };
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

/** A player whose Add (or Short) is still saving on this side, in press order. */
export type SavingMove = { id: string; name: string };

/**
 * The players whose Adds are still saving on a side, oldest first, from move
 * keys in press order: this screen's own presses, then what `pendingActions`
 * holds (`position:<side>:<id>` while a move runs,
 * `queued:position:<side>:<id>` while it waits). Players already held on the
 * side are left out: their key is a Drop, or a move that has landed.
 */
export function savingMoves({
  side,
  keys,
  held,
  names,
}: {
  side: PerGamePositionSide;
  keys: Iterable<string>;
  held: ReadonlySet<string>;
  names: ReadonlyMap<string, string>;
}): SavingMove[] {
  const ids: string[] = [];
  const prefix = `position:${side}:`;
  for (const key of keys) {
    const bare = key.startsWith('queued:') ? key.slice('queued:'.length) : key;
    if (!bare.startsWith(prefix)) continue;
    const id = bare.slice(prefix.length);
    if (!held.has(id) && !ids.includes(id)) ids.push(id);
  }
  return ids.map((id) => ({ id, name: names.get(id) ?? 'another player' }));
}

/**
 * Whose saving Add takes this side's last free slot, when the saving Adds of
 * other players already fill every free one: this row then shows FULL at
 * once instead of an "Added ✓" that would fail (walk 7 T4-01). Null while a
 * slot is still free for this player, and for a side that is full already
 * (the row's own FULL says that).
 */
export function lastSlotTakenBy(remaining: number, saving: readonly SavingMove[], playerId: string): string | null {
  if (remaining <= 0) return null;
  const others = saving.filter((move) => move.id !== playerId);
  return others.length >= remaining ? others[remaining - 1].name : null;
}

/** The FULL note while the last slot's Add is still saving: why, and the usual way to make room. */
export function spokenForNote(side: PerGamePositionSide, takenBy: string, playerName: string, limit: number): { message: string; hint: string; action: string } {
  const hint = side === 'long' ? `Full once ${takenBy}'s add saves.` : `Full once ${takenBy}'s short saves.`;
  const { action } = fullNote(side, playerName, limit);
  return side === 'long'
    ? { hint, action, message: `Full once ${takenBy}'s add saves (${limit} of ${limit}). Drop a player to add ${playerName}.` }
    : { hint, action, message: `Full once ${takenBy}'s short saves (${limit} of ${limit} shorts). Close a short to short ${playerName}.` };
}

/**
 * FULL's accessible name: why it cannot add him, with the visible word in it
 * for voice control. It never starts with "Add" or "Short", so nothing reads
 * it as an offer.
 */
export function fullActionName(side: PerGamePositionSide, playerName: string): string {
  // Starts with the button's own words, "Full, make room" (walk 8 T1-11).
  return side === 'long'
    ? `Full, make room: drop a player to add ${playerName}`
    : `Full, make room: close a short to short ${playerName}`;
}

/**
 * FULL's visible words on the Market: a way forward, not a switched-off
 * button (walk 8 T1-11: the dashed FULL read as "nothing to do here"). Two
 * lines that fit the 76px phone button; the press opens the note with
 * "Choose who to drop".
 */
export const FULL_BUTTON_WORDS = 'Full\nmake room';

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
export function slotLine(side: PerGamePositionSide, slots: Pick<PerGameSlotSummary, 'used' | 'limit'>, saving = 0, waiting = false): string {
  // Adds still saving count too, so the number matches the ticked rows (walk
  // 8 T2-08: "7 of 10" beside ten ticks): "10 of 10 \u00B7 3 saving". It is no
  // longer than the plain line, so the toolbar never grows while you tap.
  // Pressed while practice games play, they wait for them: "3 waiting" (walk
  // 9 T4-04), with the games named on the line under it (waitingForLine).
  if (saving > 0) {
    const used = Math.min(slots.used + saving, slots.limit);
    return `${used}\u00A0of\u00A0${slots.limit} \u00B7\u00A0${saving}\u00A0${waiting ? 'waiting' : 'saving'}`;
  }
  const count = `${slots.used}\u00A0of\u00A0${slots.limit}`;
  return `${count} ${slotSummary(side, slots).slice(`${slots.used} of ${slots.limit} `.length).replace(/ /g, '\u00A0')}`;
}

/**
 * The slot line in the narrow column beside the toggle (320-339px, where it
 * already takes two lines): "2 of 10", then "on your roster" on a line of its
 * own whose words may wrap among themselves, so a text-spacing style never
 * pushes the unbroken phrase over the Short side button (walk 11 check at
 * 320px), and "2 of 10 on / your roster" still never happens.
 */
export function slotLineNarrow(side: PerGamePositionSide, slots: Pick<PerGameSlotSummary, 'used' | 'limit'>): string {
  const line = slotLine(side, slots);
  if (side !== 'long') return line;
  const gap = line.indexOf(' ');
  return gap < 0 ? line : `${line.slice(0, gap)}\n${line.slice(gap + 1).replace(/\u00A0/g, ' ')}`;
}

/**
 * Under "3 of 10 · 2 waiting", in the fee line's place: which games the
 * moves wait for ("for the Oct 21–27 games", "for the rest of the season's
 * games"); `playing` is usePracticePlaying().
 */
export function waitingForLine(playing: string): string {
  return `for the ${playing.replace(/ /g, '\u00A0')} games`;
}

/**
 * A move refused after it waited for games (his price moved with them, or
 * they brought a lock) marks its own row for this long (walk 16 T4-09: three
 * adds refused as a week landed went straight back to plain ADD).
 */
export const REFUSED_MARK_MS = 5000;

/** The row's button meanwhile: "Not added" / "Not shorted", in neutral ink. */
export function refusedWord(side: PerGamePositionSide): string {
  return side === 'long' ? 'Not added' : 'Not shorted';
}

/**
 * Its name, why first and then what a press does now: "Not added: his price
 * moved to $330K. Add Devin Booker at $330K a game"; locked, who, then the
 * lock and when moves reopen ("Not added: Devin Booker. Roster changes are
 * locked. …"; without his name a reader or voice control could not tell
 * whose row it was; walk 16 lead).
 */
export function refusedActionName(side: PerGamePositionSide, playerName: string, price: number, lock: string | null = null): string {
  if (lock) return `${refusedWord(side)}: ${playerName}. ${lock}`;
  return `${refusedWord(side)}: his price moved to ${moneyCompact(price)}. ${actionName('open', side, playerName, price)}`;
}

/**
 * The name of an Add or Short pressed while practice games play, while it
 * waits for them (walk 9 T4-04: it used to say "Added" before the games
 * decided whether it could be).
 */
export function waitingActionName(side: PerGamePositionSide, playerName: string, playing: string, move: 'open' | 'close' = 'open'): string {
  // A Drop or Close confirmed while games play waits for them too: he plays
  // them, then goes (walk 15 T4-06: "Dropped ✓" showed while he played on).
  const does = move === 'close'
    ? side === 'long' ? `drop ${playerName}` : `close your short on ${playerName}`
    : `${side === 'long' ? 'add' : 'short'} ${playerName}`;
  return `Waiting for the ${playing} games to ${does}`;
}

/**
 * A player whose Add (or Short) is still saving on the other side, as this
 * side shows him meanwhile (walk 8 T4-07: the Short side painted "Shorted \u2713"
 * on a roster add in flight): busy, in place, with no button, as he will be
 * once it saves ("On your roster").
 */
export function otherSideSaving(side: PerGamePositionSide): { tag: string; reason: string } {
  return side === 'short'
    ? { tag: 'Adding to your roster\u2026', reason: 'His add to your roster is still saving.' }
    : { tag: 'Shorting\u2026', reason: 'Your short on him is still saving.' };
}

/**
 * The fee line as the toolbar prints it: one phrase, the amount never on a
 * line of its own (walk 8 T1-10: "$250" / "to short or close" at 360 and
 * 375). Where even a line can't hold it (zoom, text spacing) it breaks inside
 * the words, "$250 to short" / "or close", never after the amount.
 */
export function feeLine(side: PerGamePositionSide, fee: number): string {
  return feeHint(side, fee).replace(' ', '\u00A0').replace(/ (\S+)$/, '\u00A0$1');
}

/**
 * Beside the side toggle on a narrow phone (340-389px) the slot column gets
 * the room before the toggle grows, so "$250 to short or close" (124px)
 * keeps one line at 360 and 375 (walk 8 T1-10).
 */
export const SLOT_ROOM_FIRST_BELOW = 390;

export function slotRoomFirst(width: number): boolean {
  return slotLineBeside(width) && width < SLOT_ROOM_FIRST_BELOW;
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

/** The day after an ISO date ("2025-10-21" -> "2025-10-22"). */
function dayAfter(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/**
 * What the list says when it re-sorts after a night or a week: "Re-sorted for
 * the Oct 21 games.", "Re-sorted for the Oct 21–27 games." `previousNight` is
 * the night the old order was sorted for ('' before any game).
 */
export function resortedLine(previousNight: string, night: string): string {
  return `Re-sorted for the ${gamesSince(previousNight, night)} games.`;
}

/** The games played since the night the list was sorted for: "Oct 21", "Oct 21–27". */
function gamesSince(previousNight: string, night: string): string {
  const first = previousNight ? dayAfter(previousNight) : night;
  return first < night ? humanDaySpan(first, night) : humanDate(night);
}

/**
 * Whether the list the player is looking at sorts afresh by itself once the
 * games settle. It keeps its order after every night, week or run of weeks
 * pressed while it shows, however old that order gets, so nothing moves
 * under the next tap (walk 7 T4-11; walk 14 T2-05: on day 8 a week re-sorted
 * silently and another player's Add sat under the pointer); the kept line
 * and Re-sort say what moved. It sorts afresh when the season ends (walk 10
 * T2-03: after Play to the end the list kept its Oct 20 order; no row has a
 * button then) and when a new season goes back to its start. Coming back to
 * the Market sorts afresh too (the screen's own state). `sortedNight` is the
 * night the order was sorted for.
 */
export function resortsAfterRun(sortedNight: string, night: string, seasonOver: boolean): boolean {
  if (!sortedNight || !night || sortedNight === night) return false;
  if (night < sortedNight) return true;
  return seasonOver;
}

/**
 * The group line over players held on the other side, who sit at the end of
 * the list (walk 5 T2-19): how to take one of them, or, once the season is
 * over and nothing can be dropped or closed, only who they are (walk 10 T2-04).
 */
export function otherSideGroupLine(side: PerGamePositionSide, seasonOver: boolean, count = 2): string {
  const one = count === 1;
  if (side === 'short') {
    if (seasonOver) return 'On your roster this season';
    return one ? 'On your roster: to short him, drop him there first' : 'On your roster: to short one of them, drop him there first';
  }
  if (seasonOver) return 'Shorted this season';
  return one ? 'Shorted: to add him, close his short first' : 'Shorted: to add one of them, close his short first';
}

/**
 * How far to scroll a list so an open Drop or Close question (its row and
 * strip, `region`) sits inside the list's visible box `view`, with `air` to
 * spare: the least scroll that shows it whole, or, when it is taller than the
 * box, its end at the bottom (the question and its buttons, where focus is).
 * Walk 12 T4-06: turned to landscape, the list kept its first player and the
 * question with its focused Keep sat below the fold.
 */
export function questionScrollDelta(
  view: { top: number; bottom: number },
  region: { top: number; bottom: number },
  air = 8,
): number {
  const room = view.bottom - view.top - 2 * air;
  if (region.bottom - region.top > room) return region.bottom + air - view.bottom;
  if (region.top < view.top + air) return region.top - air - view.top;
  if (region.bottom > view.bottom - air) return region.bottom + air - view.bottom;
  return 0;
}

/**
 * The group the line above goes over: the run of rows held on the other side
 * that ends the list, as its first player and its size. While the list keeps
 * its order, a player moved to the other side from his profile keeps his
 * place with his tag and his reason, and no line (walk 12 T2-04: "Shorted: to
 * add one of them…" sat over Towns, Cunningham and Knueppel, who had live ADD
 * buttons); he joins the group when the list sorts again.
 */
export function otherSideGroup<T extends { player: { playerId: string }; blockedByOpposingPosition: boolean }>(
  rows: readonly T[],
): { firstId: string; count: number } | null {
  let start = rows.length;
  while (start > 0 && rows[start - 1].blockedByOpposingPosition) start -= 1;
  if (start === rows.length) return null;
  return { firstId: rows[start].player.playerId, count: rows.length - start };
}

/**
 * A held player's tag, in the past once the season is over (walk 11 T2-03:
 * "ON YOUR ROSTER" read as if moves were still open): "On your roster this
 * season", "Shorted this season", as the group line over the other side says.
 */
export function heldTag(side: PerGamePositionSide, seasonOver: boolean): string {
  if (side === 'long') return seasonOver ? 'On your roster this season' : 'On your roster';
  return seasonOver ? 'Shorted this season' : 'Shorted';
}

/**
 * At season end a short that ended earlier is tagged on the Short side, as a
 * held row is ("Shorted this season"), so the past figure beside him explains
 * itself (walk 16 T2-06: "+$17.3K, 5 past games" showed with no tag); null
 * for anyone else.
 */
export function endedShortTag(side: PerGamePositionSide, seasonOver: boolean, held: boolean, pastGames: number): string | null {
  return side === 'short' && seasonOver && !held && pastGames > 0 ? heldTag('short', true) : null;
}

/**
 * The lock line keeps "after Oct 28" whole, so where it wraps the date never
 * sits alone on a line (walk 16 T2-08: "Moves reopen after" / "Oct 28" at
 * 1024 and 768): it breaks as "Moves reopen" / "after Oct 28".
 */
export function lockLineUnbroken(text: string): string {
  const at = text.lastIndexOf(' after ');
  if (at < 0) return text.replace(/ (\S+)$/, '\u00A0$1');
  return `${text.slice(0, at)} ${text.slice(at + 1).replace(/ /g, '\u00A0')}`;
}

/** The slot line once the season is over: what you held at its end ("2 held at season end"). */
export function seasonEndSlotLine(side: PerGamePositionSide, used: number, stacked = false): string {
  // "at season end" never leaves "end" alone on a line (walk 15 T1-08).
  if (side === 'long') return used === 0 ? 'None held at season\u00A0end' : `${used}\u00A0held at season\u00A0end`;
  // The Short side says its state once: the slot says the season is over, so
  // no "The season is over" line under it; its explainer says what comes next
  // (walk 15 T1-08: said twice within 50px, "end" alone on a line).
  const count = used === 0 ? 'No shorts' : `${used}\u00A0shorted`;
  // Beside a phone's side toggle it takes two lines, split where the dot was,
  // so no "·" hangs at a line's end (walk 16 T1-14: "No shorts ·" / "season over").
  return stacked ? `${count}\nseason\u00A0over` : `${count} · season\u00A0over`;
}

/** The slot's status line at season end: the Short side's slot already says it (walk 15 T1-08). */
export function seasonEndStatusShown(side: PerGamePositionSide): boolean {
  return side === 'long';
}

/**
 * The side's sentence once the season is over (walk 11 T2-03, T1-13): what
 * the figures show now, and on the Short side that shorts come back with a
 * new season, never how to open one. Value is still last season's dividend
 * against his price, not how he did this season (walk 12 T2-05); with players
 * held, their season is in Your profit a game.
 */
export function seasonEndExplainer(side: PerGamePositionSide, held = 0): string {
  // The slot above says "No shorts · season over" (walk 15 T1-08): this line says what comes next.
  if (side === 'short') return 'Shorts open again in a new season.';
  const value = "The season is over. Value still compares last season's dividend with his price.";
  return held > 0 ? `${value} Your profit a game shows how your players did.` : value;
}

/**
 * The "Your profit a game" cell of a player you do not hold on this side, in
 * words (the cell shows a dash): held on the other side says where he is
 * ("on your roster", "shorted"), never "not held" (walk 10 T2-04).
 */
/**
 * Why a row held on the other side cannot be taken, as its name says it: the
 * list's own reason while moves can happen ("He's on your roster. Drop him to
 * short him."), only where he is once the season is over (walk 10 T2-04).
 */
export function otherSideReason(side: PerGamePositionSide, reason: string | null, seasonOver: boolean): string | null {
  if (!seasonOver || reason === null) return reason;
  return side === 'short' ? "He's on your roster." : "You're shorting him.";
}

export function unheldProfitWords(side: PerGamePositionSide, heldOtherSide: boolean): string {
  if (!heldOtherSide) return 'not held';
  return side === 'short' ? 'on your roster' : 'shorted';
}

/**
 * The order line's wording for the room it has: `short` under 390px beside
 * Re-sort (walk 11 T4-08: one line at 320px), `phone` from there, `long` on
 * the tables (true: short; false: long, for older callers).
 */
export type OrderLineForm = 'short' | 'phone' | 'long';

/**
 * After a night the list keeps the order it had, so nothing moves under a tap
 * (walk 7 T4-11). The line says what moved and why the order stayed (walk 13
 * T1-17: "Same order as before the Oct 21 games" sounded like good news and
 * gave no reason to Re-sort): "Values moved in the Oct 21 games; order kept
 * so rows stay put." Sorted by price, it is the prices that moved.
 */
export function heldOrderLine(
  previousNight: string,
  night: string,
  form: boolean | OrderLineForm = 'long',
  sort: MarketSort = 'value',
): string {
  const shape: OrderLineForm = form === true ? 'short' : form === false ? 'long' : form;
  const moved = sort === 'price' ? 'Prices moved' : 'Values moved';
  // A phone's line swaps its words in place, one line with Re-sort at every
  // phone width (walk 16 T1-02: the two-line wording kept an empty line
  // under "Sorted by value, highest first." from the first view on); the
  // button names the games.
  if (shape === 'short' || shape === 'phone') return `${moved}; order kept`;
  return `${moved} in the ${gamesSince(previousNight, night)} games; order kept so rows stay put.`;
}

/**
 * The phone forms' boundary (walk 13): both now say "Values moved; order
 * kept", about 150px with Re-sort's 61px, one line from 320px (walk 16 T1-02).
 */
export const ORDER_LINE_LONG_MIN_WIDTH = 390;

export function orderLineForm(width: number, table: boolean): OrderLineForm {
  if (table) return 'long';
  return width < ORDER_LINE_LONG_MIN_WIDTH ? 'short' : 'phone';
}

export function orderLineNarrow(width: number, table: boolean): boolean {
  return orderLineForm(width, table) === 'short';
}

/**
 * The phone list's one quiet line under the sort, and the laptop table's
 * (walk 9 T4-10, T1-16, T2-12): the order in words, an unusual order said
 * plainly (the order button flips it back), or that the order is from before
 * the latest games, with Re-sort. `reserve` is its longest wording, kept as
 * an invisible copy so the line never changes height when a night lands.
 */
export function orderLine({
  sort,
  reversed,
  heldNote,
  narrow = false,
  form,
}: {
  sort: MarketSort;
  reversed: boolean;
  /** heldOrderLine(...) while the order is from before the latest games, else null. */
  heldNote: string | null;
  /** Kept for callers: the line's height no longer depends on it (walk 11 T4-08). */
  gamesIn?: boolean;
  /** A narrow phone (orderLineNarrow): the held wording is the short one. */
  narrow?: boolean;
  /** The room the line has (orderLineForm); wins over `narrow`. */
  form?: OrderLineForm;
}): { text: string; tone: 'quiet' | 'flipped' | 'stale'; resort: boolean; reserve: string; reserveResort: boolean; reserveOwn: string } {
  const said = sortedLine(sort, reversed);
  const flipped = flippedSortNote(sort).text;
  const plain = sortedLine(sort, false);
  // The line keeps one height from the first view on: the held wording with
  // Re-sort's 44px target (one line, in its short form on a narrow phone) and
  // its own longest wording, before and after every night, so the list never
  // drops under a thumb when a night lands (walk 11 T4-08: 28px at 320px after
  // each first night; walk 10 T4-04's two reserved lines are gone).
  const shape: OrderLineForm = form ?? (narrow ? 'short' : 'long');
  const reserve = heldOrderLine('2025-10-20', '2025-10-27', shape, 'value');
  const reserveOwn = flipped.length > plain.length ? flipped : plain;
  const reserveResort = true;
  if (heldNote) return { text: heldNote, tone: 'stale', resort: true, reserve, reserveResort, reserveOwn };
  if (reversed) return { text: flipped, tone: 'flipped', resort: false, reserve, reserveResort, reserveOwn };
  return { text: said, tone: 'quiet', resort: false, reserve, reserveResort, reserveOwn };
}

/**
 * "Re-sort"'s accessible name: what it sorts for, the same games the line
 * names ("Re-sort for the Oct 21–27 games"; it said "Oct 27" after a week).
 */
export function resortName(night: string, sortedNight = ''): string {
  return `Re-sort for the ${gamesSince(sortedNight, night)} games`;
}

/** Two orders list the same players in the same places. */
export function sameOrder(a: readonly string[] | null | undefined, b: readonly string[] | null | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((id, index) => id === b[index]);
}

/**
 * The Watching switch's name: its visible words first ("WATCHING 2"), so
 * voice control can say what it sees (walk 8 T3-16), then what it does.
 */
export function watchingToggleName(count: number): string {
  return `Watching ${count}, show only players you watch`;
}

/** The line under a Watching list, said on screen as well as aloud: "Watching: 2 players" (walk 6 T1-12). */
export function watchingLine(count: number): string {
  return `Watching: ${count} ${count === 1 ? 'player' : 'players'}`;
}

/**
 * How long a short runs, said where the Short side is chosen, before anyone
 * pays for one (walk 6 T1-11): "Each short runs 7 days, then ends by itself."
 */
export function shortTermLine(days: number | null): string {
  if (days === null) return 'Each short runs until you close it.';
  return `Each short runs ${days} ${days === 1 ? 'day' : 'days'}, then ends by itself.`;
}
