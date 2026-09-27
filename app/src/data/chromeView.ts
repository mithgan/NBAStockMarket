/**
 * The chrome above every screen: the status row and the practice bar.
 *
 * These are the pure parts — the practice clock, the layout decision and the
 * words — so they can be unit tested and so both bars agree on them. The bars
 * themselves live in components/PerGameStatusStrip.tsx and components/SimBar.tsx.
 */
import type { DividendBasis } from '../api/contracts';
import {
  exactSignedMoney,
  humanDate,
  humanDay,
  humanDaySpan,
  moneyFine,
  rosterReopensLine,
  signedMoney,
  signedMoneyFine,
} from '../copy/terms';

/** Length of the practice season: opening-night eve (day 0) to the last night. */
export const SEASON_TOTAL_DAYS = 174;

const DAY_MS = 86_400_000;

function utcDay(value: string): number {
  return Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
}

/** Whole days from one game date to another ("2025-10-20" → "2025-11-05" is 16). */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((utcDay(toIso) - utcDay(fromIso)) / DAY_MS);
}

export interface PracticeProgress {
  /** Day N of the season, clamped to 0..SEASON_TOTAL_DAYS. */
  day: number;
  total: number;
  /** Share of the season played, 0..1. */
  fraction: number;
  /** The last night has been played; there is nothing left to advance. */
  complete: boolean;
  /** "Practice progress: day 16 of 174". Screen readers and the QA harness read this. */
  accessibilityLabel: string;
}

/**
 * Where a practice season stands, from its opening eve to the last settled
 * night. Shared with the Roster screen: keep this signature and behaviour.
 */
export function practiceProgress(
  seasonStart: string | null | undefined,
  lastSettledDate: string | null | undefined,
): PracticeProgress {
  const raw = seasonStart && lastSettledDate ? daysBetween(seasonStart, lastSettledDate) : 0;
  const day = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), SEASON_TOTAL_DAYS) : 0;
  return {
    day,
    total: SEASON_TOTAL_DAYS,
    fraction: day / SEASON_TOTAL_DAYS,
    complete: day >= SEASON_TOTAL_DAYS,
    accessibilityLabel: `Practice progress: day ${day} of ${SEASON_TOTAL_DAYS}`,
  };
}

/**
 * Bind a short phrase ("Day 16 of 174", "Thu, Nov 6") with no-break spaces so
 * enlarged text wraps between facts, never inside one. Short phrases only: a
 * long unbreakable run could outgrow a narrow column. Shared with the Roster
 * screen: keep this signature and behaviour.
 */
export function keepTogether(phrase: string): string {
  return phrase.replace(/ /g, '\u00a0');
}

/** "Day 16 of 174", or "Season complete" once the last night is in. */
export function practiceDayText(progress: PracticeProgress): string {
  return progress.complete ? 'Season complete' : `Day ${progress.day} of ${progress.total}`;
}

/**
 * The progress bar's name: "Season 9% played" (walk 8 T1-03). Any night
 * played is at least 1%, and only a finished season is 100%.
 */
export function seasonPlayedLabel(progress: PracticeProgress): string {
  const pct = progress.complete ? 100
    : progress.day === 0 ? 0
      : Math.min(99, Math.max(1, Math.round(progress.fraction * 100)));
  return `Season ${pct}% played`;
}

/**
 * The day where a row is short of room (a phone at 200% or 400% zoom): the
 * date first, "Oct 20 · Day 0", since the date says where the season is and
 * "Day 0/174" did not (walk 8 T3-05); the bar beside it shows how far.
 * `twoLines`: the date over the day, for the narrowest rows.
 */
export function practiceDateDay(progress: PracticeProgress, settled: string | null | undefined, twoLines = false): string {
  if (progress.complete || !settled) return twoLines ? practiceDayTiny(progress) : practiceDayShort(progress);
  const date = keepTogether(humanDate(settled));
  const day = keepTogether(`Day ${progress.day}`);
  // One unbroken phrase: a break at the dot left it alone at a line's end (walk 8 T3-08).
  return twoLines ? `${date}\n${day}` : `${date}\u00a0·\u00a0${day}`;
}

/**
 * From this width the two-line folded row (a 320px phone) keeps the word
 * under Settings' icon (walk 13 T4-08, T1-11); narrower (a phone at 200%
 * zoom) the word pushed Settings onto a line of its own, so the icon stays.
 */
export const CHROME_FOLDED_SETTINGS_WORD_MIN_WIDTH = 300;

/**
 * The folded phone row's day, with the season from a visit's second one:
 * "S2 · Oct 20 · Day 0" (walk 13 T4-04: once the new-season notice went,
 * nothing on a 320px screen said it was season 2).
 */
export function seasonTagged(dayText: string, season: number | null): string {
  return season !== null && season >= 2 ? `S${season}\u00a0·\u00a0${dayText}` : dayText;
}

/** "Day 16/174": the day count for the narrowest rows. */
export function practiceDayShort(progress: PracticeProgress): string {
  return progress.complete ? 'Season complete' : `Day ${progress.day}/${progress.total}`;
}

/**
 * What a practice season holds, for the Restart and Exit questions:
 * "Day 16 of 174, 8 players, 2 shorts, score +$120K".
 */
export function practiceStakes({ progress, players, shorts, score, savingPlayers = 0, savingShorts = 0 }: {
  progress: PracticeProgress;
  /** Held on the roster, counting adds still saving (`savingPlayers` of them). */
  players: number;
  shorts: number;
  score: number;
  /** Adds (and shorts) pressed and still saving: counted, and said (walk 12 T4-04). */
  savingPlayers?: number;
  savingShorts?: number;
}): string {
  const saving = (count: number, total: number) => (count <= 0 ? '' : total === 1 ? ', still saving' : `, ${count} still saving`);
  const parts = [
    progress.complete ? 'a finished season' : `Day ${progress.day} of ${progress.total}`,
    players === 0 ? 'no players' : `${players} ${players === 1 ? 'player' : 'players'}${saving(savingPlayers, players)}`,
  ];
  if (shorts > 0) parts.push(`${shorts} ${shorts === 1 ? 'short' : 'shorts'}${saving(savingShorts, shorts)}`);
  parts.push(`score ${signedMoney(score)}`);
  return parts.join(', ');
}

/** A move still saving while a practice question is open (walk 12 T1-07, T4-04). */
export type FlightVerb = 'add' | 'short' | 'drop' | 'close';
export interface MoveInFlight {
  id: string;
  side: 'long' | 'short';
  name: string;
  verb: FlightVerb;
}

/**
 * The moves still saving, oldest first, from the context's pendingActions
 * keys (`position:<side>:<id>` while a move runs, `queued:position:<side>:<id>`
 * while it waits its turn): an Add or a Short for a player not held on that
 * side, a Drop or a short's close for one who is.
 */
export function movesInFlight(
  keys: Iterable<string>,
  positions: ReadonlyArray<{ playerId: string; side: string; status: string }>,
  names: ReadonlyMap<string, string>,
): MoveInFlight[] {
  const moves: MoveInFlight[] = [];
  for (const key of keys) {
    const bare = key.startsWith('queued:') ? key.slice('queued:'.length) : key;
    const match = /^position:(long|short):(.+)$/.exec(bare);
    if (!match) continue;
    const side = match[1] as 'long' | 'short';
    const id = match[2];
    if (moves.some((move) => move.id === id && move.side === side)) continue;
    const held = positions.some((position) => position.playerId === id && position.side === side && position.status === 'active');
    const verb: FlightVerb = side === 'long' ? (held ? 'drop' : 'add') : (held ? 'close' : 'short');
    moves.push({ id, side, name: names.get(id) ?? 'another player', verb });
  }
  return moves;
}

function listWords(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** "your add of Luka Doncic", "your adds of A and B and your drop of C". */
function flightWords(moves: readonly MoveInFlight[]): string {
  const verbs = [...new Set(moves.map((move) => move.verb))];
  return listWords(verbs.map((verb) => {
    const names = moves.filter((move) => move.verb === verb).map((move) => move.name);
    const one = names.length === 1;
    if (verb === 'close') return `closing your ${one ? 'short' : 'shorts'} on ${listWords(names)}`;
    return `your ${verb}${one ? '' : 's'} of ${listWords(names)}`;
  }));
}

const capitalFirst = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The line a practice question (Restart, Exit, Play to the end) gives what
 * was in flight when it opened: the step playing and the moves still saving
 * (walk 12 T1-07, T4-04). While any is in flight, its figures wait for them,
 * and it says so; once all are in, the figures update once, in place, and
 * this line says why, so the question never shows two different "what you'd
 * lose" figures (walk 12 T4-01). `outcomes`: null while in flight, then for
 * each move whether it went through. null when nothing was in flight.
 */
export function questionFlightLine({ playing, moves, outcomes }: {
  playing: string | null;
  moves: readonly MoveInFlight[];
  outcomes: readonly boolean[] | null;
}): string | null {
  if (!playing && moves.length === 0) return null;
  if (outcomes === null) {
    // What the figures wait for, never a promise about the answer: Start over
    // and Leave practice do not wait for a saving move (walk 12 fix 12 note).
    if (playing && moves.length > 0) {
      return `${playing} is still playing and ${flightWords(moves)} ${moves.length === 1 ? 'is' : 'are'} still saving: the figures above update when they are in.`;
    }
    if (playing) return `${playing} is still playing: the figures above update when it is in.`;
    const one = moves.length === 1;
    return `${capitalFirst(flightWords(moves))} ${one ? 'is' : 'are'} still saving: the figures above update when ${one ? 'it lands' : 'they land'}.`;
  }
  const done = moves.filter((_, index) => outcomes[index] !== false);
  const failed = moves.filter((_, index) => outcomes[index] === false);
  const inParts = [...(playing ? [playing] : []), ...(done.length > 0 ? [flightWords(done)] : [])];
  const inCount = (playing ? 1 : 0) + done.length;
  const said = inParts.length > 0 ? `${listWords(inParts)} ${inCount === 1 ? 'is' : 'are'} in` : null;
  const refused = failed.length > 0 ? `${flightWords(failed)} did not go through` : null;
  return `Updated: ${[said, refused].filter(Boolean).join('; ')}.`;
}

/**
 * Whether practice offers Exit: only where the live market is set up on this
 * site (the app's public config resolves; pass `resolvePublicAppConfig()`).
 * Elsewhere Exit threw the season away to land on "The live market isn't open
 * yet" (walk 4 T2-10, T4-05, T1-12), so practice keeps Restart alone there.
 */
export function practiceOffersExit(liveConfig: { config: unknown } | null | undefined): boolean {
  return Boolean(liveConfig?.config);
}

/**
 * Whether a season control asks before it acts. Restart and Exit ask once
 * the season holds something a reload throws away (a night played, or a
 * move); on the opening eve with no moves they just act. Play another season
 * never asks: the season is over, the result card's button of the same name
 * starts the next one at once, and the question's red button made the natural
 * next step look like a mistake (walk 4 T1-13).
 */
export function practiceAsksFirst(
  kind: 'restart' | 'play-again' | 'exit',
  { day, moves, inFlight = false }: {
    day: number;
    moves: number;
    /**
     * A move still saving, a step playing or a press queued: the season is
     * about to hold something, so Restart asks, and its question says what
     * is in flight (walk 12 T1-07: it said "nothing to restart" under the
     * closing menu, the add landed over it and the queued week played).
     */
    inFlight?: boolean;
  },
): boolean {
  if (kind === 'play-again') return false;
  return day > 0 || moves > 0 || inFlight;
}

/**
 * The season-level questions the practice controls ask before acting.
 * Play another season (Restart once the season is complete) acts at once
 * (practiceAsksFirst).
 */
export function practiceQuestion(
  kind: 'restart' | 'exit' | 'empty-night' | 'empty-week',
  stakes: string,
  nextGames: string | null = null,
): {
  title: string;
  lines: string[];
  confirmLabel: string;
  cancelLabel: string;
} {
  // +1 night / +1 week with nobody to play for: asked once, so a new
  // player's first tap does not spend the opening night on nothing.
  if (kind === 'empty-night' || kind === 'empty-week') {
    return {
      title: kind === 'empty-night' ? 'Play with nobody on your roster?' : 'Play a week with nobody on your roster?',
      lines: [
        kind === 'empty-night'
          ? `Nobody plays for you in the ${nextGames ?? 'next'} games, so your score won't move.`
          : "Nobody plays for you all week, so your score won't move.",
        'Add a player from the Market first to start earning.',
      ],
      // The way on is the Market (focused); playing an empty night loses
      // nothing, so it is a plain button, not a red one.
      confirmLabel: 'Play anyway',
      cancelLabel: 'Open market',
    };
  }
  return kind === 'restart'
    ? {
      title: 'Start over?',
      lines: [`You'd lose this season: ${stakes}.`, 'A new season starts at Day 0 with an empty roster.'],
      confirmLabel: 'Start over',
      cancelLabel: 'Keep playing',
    }
    : {
      title: 'Leave practice for the live market?',
      lines: [`You'd lose this season: ${stakes}.`, "Practice isn't saved anywhere, so it can't be picked up later."],
      confirmLabel: 'Leave practice',
      cancelLabel: 'Keep playing',
    };
}

/**
 * Restart on a season with nothing in it yet (the opening eve, no moves):
 * there is nothing to throw away, so it says so instead of reloading into an
 * identical screen, which looked like a dead button (walk 7 T1-09, T2-08).
 */
export const FRESH_SEASON_NOTICE = "This season hasn't started yet, so there's nothing to restart.";

export function restartHasNothingToDo({ day, moves, inFlight = false }: { day: number; moves: number; inFlight?: boolean }): boolean {
  return !practiceAsksFirst('restart', { day, moves, inFlight });
}

/**
 * Whether the frame shows (and says) the roster lock. A finished practice
 * season has no night left to lock, so a lock the last night left for the
 * day after ("Moves reopen after Apr 13") is never shown or said (walk 12
 * T4-12; seeds 3 and 11). The live market has no season end here.
 */
export function frameLocked(locked: boolean, progress: Pick<PracticeProgress, 'complete'> | null | undefined): boolean {
  return locked && !progress?.complete;
}

/** The practice control that plays the rest of the season (walk 6 T2-N1, T4-N3). */
export const PLAY_TO_END_LABEL = 'Play to the end';

/**
 * The question "Play to the end" asks, in a player's terms: the season to its
 * last date, its span in weeks ("Play the rest of the season, to Apr 12?"
 * "That's about 25 weeks (174 days), played in one go."), then what stays as
 * it is. It counted days alone ("Play the remaining 174 days now?"), a
 * number nothing else plans with (walk 14 T2-07). With nobody held it says
 * only that the score won't move: "Your roster and shorts stay as they are"
 * described a roster that did not exist (walk 14 T4-03). Escape or "Not now"
 * keeps the season.
 */
export function playToEndQuestion(
  remainingDays: number,
  emptyRoster: boolean,
  /** Each open short's last covered date (PerGamePosition.expiresOn). */
  shortEnds: readonly (string | null)[] = [],
  /** The season's last day (practiceSeasonEnd). */
  seasonEnd: string | null = null,
): {
  title: string;
  lines: string[];
  confirmLabel: string;
  cancelLabel: string;
} {
  const stays = shortEnds.length > 0 ? playToEndShortLines(shortEnds)
    // No shorts held: the roster alone (walk 15 T2-12: "and shorts" sent a
    // player without any looking for shorts they did not have).
    : emptyRoster ? [] : ['Your roster stays as it is; no moves between nights.'];
  return {
    title: seasonEnd ? `Play the rest of the season, to ${humanDate(seasonEnd)}?` : 'Play the rest of the season?',
    lines: [
      playToEndSpanLine(remainingDays),
      ...stays,
      ...(emptyRoster ? ["Nobody is on your roster, so your score won't move."] : []),
    ],
    confirmLabel: PLAY_TO_END_LABEL,
    cancelLabel: 'Not now',
  };
}

/**
 * The rest of the season in weeks, days beside: "about 25 weeks (174 days)",
 * "3 weeks (21 days)", "5 days".
 */
export function seasonSpanWords(remainingDays: number): string {
  const days = Math.max(1, Math.round(remainingDays));
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'}`;
  const weeks = Math.round(days / 7);
  return `${days % 7 === 0 ? '' : 'about '}${weeks} ${weeks === 1 ? 'week' : 'weeks'} (${days} days)`;
}

/** Play to the end's span line: "That's about 25 weeks (174 days), played in one go." */
export function playToEndSpanLine(remainingDays: number): string {
  return `That's ${seasonSpanWords(remainingDays)}, played in one go.`;
}

/**
 * With shorts open, "stay as they are" read as "keep running", but every
 * short ends by itself after its term and its slot then sits empty for the
 * rest of the season (walk 7 T4-04): say when they end.
 */
function playToEndShortLines(shortEnds: readonly (string | null)[]): string[] {
  const dated = shortEnds.filter((end): end is string => Boolean(end)).sort();
  const n = shortEnds.length;
  if (dated.length < n) return ['Your roster and shorts stay as they are; no moves between nights.'];
  const last = humanDate(dated[dated.length - 1]);
  const same = dated[0] === dated[dated.length - 1];
  const ends = n === 1
    ? `Your short ends by itself after ${last}; its slot stays empty.`
    : `Your ${n} shorts end by themselves ${same ? `after ${last}` : `by the ${last} games`}; their slots stay empty.`;
  return ['Your roster stays as it is; no moves between nights.', ends];
}

/**
 * The last day of the practice season's track: day 174 after opening-night eve
 * ("2025-10-20" gives "2026-04-12"). Practice plays no night once a night on or
 * after this day has settled, which is exactly when `practiceProgress` says
 * the season is complete.
 */
export function practiceSeasonEnd(seasonStart: string | null | undefined): string | null {
  if (!seasonStart) return null;
  const end = new Date(utcDay(seasonStart) + SEASON_TOTAL_DAYS * DAY_MS);
  return Number.isNaN(end.getTime()) ? null : end.toISOString().slice(0, 10);
}

/** At or above this width each bar lays out on one line. */
export const CHROME_WIDE_MIN_WIDTH = 720;
/**
 * At or above this width the practice controls join the status row, so the
 * whole frame is one line plus the progress rule (the app's own desktop
 * breakpoint, where the tabs move to the top).
 */
export const CHROME_MERGED_MIN_WIDTH = 900;
/**
 * Below this width the bars trade their 16px gutters and control padding for
 * room. 360px phones sit inside the band, which is what lets the ROSTER LOCKED
 * tag and the lock sentence share one line there (see below).
 */
export const CHROME_NARROW_MAX_WIDTH = 370;
/**
 * From this width a phone's status row fits the ROSTER LOCKED tag (108px) and
 * the lock sentence (161px) on one line beside the Rules control; narrower
 * rows show the sentence alone.
 */
export const CHROME_LOCK_TAG_MIN_WIDTH = 356;
/**
 * Below this width (a 390px phone at 125% zoom and beyond) the practice bars
 * go compact: three short lines of facts, and +1 night / +1 week beside a
 * More control that holds Restart and Exit.
 */
export const CHROME_COMPACT_MAX_WIDTH = 320;
/**
 * Below this width (down to compact) a practice phone row's first line
 * single-spaces its dots, so "Practice · Dec 30 · Last night +$999.9K", with
 * last night at the Results precision, still fits one line beside Rules. With
 * the roomy dots the widest such line wraps at 330px and narrower; 344px
 * keeps a margin.
 */
export const CHROME_ROOMY_DOTS_MIN_WIDTH = 344;
/**
 * The signed-in toolbar shows icons only in this band: narrow enough that
 * labels would squeeze the facts, wide enough that the toolbar still shares
 * the facts' row. Below it the toolbar drops under the facts, with labels.
 */
export const CHROME_ICON_ONLY_MAX_WIDTH = 374;
export const CHROME_ICON_ONLY_MIN_WIDTH = 340;
/**
 * Portrait phones (below CHROME_WIDE_MIN_WIDTH, not folded) keep +1 night,
 * +1 week and More in one row; Play to the end and Restart live in More, and
 * from this width the row's free slot beside +1 week carries the hint, the
 * lock or Cancel queued, so no line of its own comes and goes under the
 * buttons (walk 9 T1-13, T4-08). Narrower rows keep the line under them.
 */
export const PHONE_SLOT_MIN_WIDTH = 300;

/** Text enlarged past this scale stacks the controls under the facts. */
export const CHROME_LARGE_TEXT_SCALE = 1.3;

export interface ChromeLayout {
  /** Facts sit on one line, and each control shows its icon beside its label. */
  wide: boolean;
  /** Practice controls move up into the status row; the practice bar keeps only its rule. */
  merged: boolean;
  /**
   * Enlarged text: lines keep their natural height and wrap. Signed in, the
   * facts take the whole row and the three controls wrap below them.
   */
  largeText: boolean;
  /** The signed-in toolbar drops its visible labels (names stay in accessibility labels). */
  iconOnly: boolean;
  /** Tighter gutters and control padding so one row of practice controls still fits. */
  narrow: boolean;
  /** A phone at high zoom: short facts, and Restart and Exit behind More. */
  compact: boolean;
  /** The narrowest phones short of compact: the first line's dots lose their extra spaces. */
  tightDots: boolean;
}

export function chromeLayout(width: number, fontScale: number): ChromeLayout {
  const largeText = fontScale > CHROME_LARGE_TEXT_SCALE;
  return {
    wide: width >= CHROME_WIDE_MIN_WIDTH && !largeText,
    merged: width >= CHROME_MERGED_MIN_WIDTH && !largeText,
    largeText,
    iconOnly: width < CHROME_ICON_ONLY_MAX_WIDTH && width >= CHROME_ICON_ONLY_MIN_WIDTH && !largeText,
    narrow: width < CHROME_NARROW_MAX_WIDTH,
    compact: width < CHROME_COMPACT_MAX_WIDTH,
    tightDots: width < CHROME_ROOMY_DOTS_MIN_WIDTH && width >= CHROME_COMPACT_MAX_WIDTH,
  };
}

/** The next slate, in words: "Thu, Nov 6", or null when nothing is scheduled. */
export function nextGamesText(nextGameDate: string | null | undefined): string | null {
  return nextGameDate ? humanDay(nextGameDate) : null;
}

/**
 * The one name for the way on once practice is over: the practice bar's
 * button and the result card's button both use it, and both start the next
 * season at once (walk 4 T1-13).
 * The status row states the final score instead (walk 3 T4-04); this stands
 * in for it in the spoken summary only when no score is given.
 */
export const PRACTICE_OVER_TEXT = 'Play another season';

export type ChromeMode = 'practice' | 'live';

export interface StatusSummaryInput {
  mode: ChromeMode;
  lastSettledDate: string | null;
  nextGameDate: string | null;
  /**
   * What your players made on the last settled night, games only
   * (perGameMetrics.recentEarnings), or null before any games.
   */
  lastNight: number | null;
  /** None of your players had a game on the last settled day. */
  noGames?: boolean;
  /** …because nobody was on your roster (ResultSpan.nobody). */
  nobody?: boolean;
  /** Practice only. */
  progress?: PracticeProgress;
  /** A sentence about the roster lock, when it is on. */
  lockSentence?: string | null;
  /**
   * The days `lastNight` covers when it is more than the last night
   * ("Oct 21–27" after +1 week, resultSpan); the settled date otherwise.
   */
  resultLabel?: string | null;
  /** Practice, once the season is complete: the final score. */
  finalScore?: number | null;
  /**
   * Practice: this visit's season number. From the second it is spoken, as
   * the row shows it ("Practice, Season 2, …"; walk 12 T3-07).
   */
  season?: number | null;
}

/**
 * The bars name the night a result belongs to by its date, never "last night":
 * beside the date of the night just played, "last night" read as the day
 * before it, and "No games last night" read as an idle league right after
 * +1 night had played that date's games (walk 2 T1-07, T1-14, T4-09).
 */
export const NO_PLAYERS_PLAYED = 'none of your players played';

/** "Oct 21 games", the label before that night's figure. */
export function nightGamesLabel(date: string | null | undefined): string {
  return date ? `${humanDate(date)} games` : 'Latest games';
}

/** "Oct 22: none of your players played", in place of a figure. */
export function noGamesText(date: string | null | undefined): string {
  return `${date ? humanDate(date) : 'Latest games'}: ${NO_PLAYERS_PLAYED}`;
}

function shiftDay(iso: string, days: number): string {
  return new Date(utcDay(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

/** "Oct 21–27", "Oct 28–Nov 3", or just "Oct 27" when the span is one day. */
export function dateSpanText(firstDay: string, lastDay: string): string {
  // One spelling with the notice after +1 week (copy/terms).
  return humanDaySpan(firstDay, lastDay);
}

/** One press of the practice clock: its step and the settled date it started from. */
export interface PracticeAdvance {
  step: 'night' | 'week';
  from: string | null;
  /** Nobody on the roster or shorts when it was pressed (Play anyway). */
  emptyRoster?: boolean;
  /**
   * A press queued behind another plays straight after it, as one run: the
   * settled date the run started from, so the row names the whole run
   * ("Oct 21–Nov 3 games"), as its notice does (walk 6 T4-N2).
   */
  runFrom?: string | null;
}

/** The games the status row's figure covers: after `after`, through `through`. */
export interface ResultSpan {
  after: string;
  through: string;
  /** "Oct 21–27" after +1 week; "Oct 28" for one night. */
  label: string;
  /** Nobody was on the roster through those games. */
  nobody: boolean;
}

/**
 * The status row's words for games none of your players had, as the notice
 * after them says it: "Oct 21 games: nobody on your roster" when you held
 * nobody ("your players" implied you had some; walk 5 T1-17), else
 * "Oct 22: none of your players played". The words after the date.
 */
export const NOBODY_ON_ROSTER = 'nobody on your roster';

export function noGamesWords(nobody: boolean, short = false): string {
  // A phone's lead line leaves out "games", as "Oct 22: none of your players
  // played" does: "Practice · Oct 22–28 games: nobody on your roster" wrapped
  // at 375px and the whole frame grew (walk 12 T1-02).
  if (nobody) return short ? `: ${NOBODY_ON_ROSTER}` : ` games: ${NOBODY_ON_ROSTER}`;
  return `: ${NO_PLAYERS_PLAYED}`;
}

/**
 * Which games the status row reports. After +1 week, the whole span it
 * played ("Oct 21–27 games -$32.5K", the games-only figure the notice gives),
 * until the next advance lands; otherwise the last settled night alone
 * ("Oct 28 games +$X"). After a week the last night alone read "+$130.5K",
 * in green, for a week that lost $32.5K (walk 3 T1-20). `advances` are the
 * latest presses, oldest first; one still playing (it started from the date
 * on screen) is passed over, so the row never names a span it has not shown.
 */
export function resultSpan(
  advances: readonly PracticeAdvance[],
  lastSettled: string | null | undefined,
  /** Nobody on the roster now: the answer when no press recorded it. */
  emptyNow = false,
): ResultSpan | null {
  if (!lastSettled) return null;
  const landed = [...advances].reverse().find((advance) => advance.from !== null && advance.from < lastSettled);
  // Who you held through the games is who you held when you pressed, as the
  // notice after them counts it.
  const nobody = landed?.emptyRoster ?? emptyNow;
  // A run of presses played back to back is reported whole, from where the
  // run started (walk 6 T4-N2).
  const run = landed?.from && landed.runFrom && landed.runFrom < landed.from ? landed.runFrom : null;
  const from = run ?? landed?.from;
  if (from && (run || landed?.step === 'week') && daysBetween(from, lastSettled) > 1) {
    return {
      after: from,
      through: lastSettled,
      label: dateSpanText(shiftDay(from, 1), lastSettled),
      nobody,
    };
  }
  return { after: shiftDay(lastSettled, -1), through: lastSettled, label: humanDate(lastSettled), nobody };
}

/**
 * The notice after a run of presses that played back to back (a press made
 * while a night or week played is queued and plays straight after it). The
 * notice then covers the whole run and counts it: "Oct 21–Nov 3 games (2
 * weeks): your score rose $500.5K." It named only the last step, so a second
 * week played with no sign (walk 6 T4-N2, T2-09). `notice` is the notice for
 * the run's whole span (state/perGameNotices.refreshNotice from the bootstrap
 * before the run); one without a games span (season complete) is kept as is.
 */
/**
 * The sentences of a notice that say a move was refused, as a run's notice
 * carries them once later games have played, names first and the reason in
 * the past ("Devin Booker and Jalen Duren were not added: moves paused for
 * the Oct 28 games."): the run's growing notice replaced them and nothing on
 * screen said the adds had failed (walk 15 T4-04, T4-08).
 */
export function runRefusals(text: string): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const out: string[] = [];
  sentences.forEach((sentence, index) => {
    if (!/\b(?:was|were) not (?:added|dropped|shorted|closed)\b/.test(sentence)) return;
    const paused = /^Moves pause for (the .+? games), so (.+?)\.$/.exec(sentence);
    if (paused) {
      out.push(`${paused[2][0].toUpperCase()}${paused[2].slice(1)}: moves paused for ${paused[1]}.`);
      return;
    }
    if (/(?:was|were) not \w+\.$/.test(sentence) && /^Your roster is locked\.?$/.test(sentences[index + 1] ?? '')) {
      // "…was not added. Your roster is locked. Moves reopen after Nov 11."
      const reopens = /^Moves reopen after (\w{3} \d{1,2})\.?$/.exec(sentences[index + 2] ?? '');
      out.push(`${sentence.slice(0, -1)}: ${reopens ? `moves paused for the ${reopens[1]} games` : 'the roster was locked'}.`);
      return;
    }
    // Kept in one form: a lock ahead is put back in the present when shown (withRefusals).
    out.push(sentence.replace(/: moves pause for /, ': moves paused for '));
  });
  return out;
}

/** Who a refusal names, what was not done, and why in kind (a lock's date, or a moved price). */
function refusalParts(line: string): { names: string[]; verb: string; why: string } {
  const match = /^(.*?) (?:was|were) not (\w+)(?:: (.*))?\.$/.exec(line);
  if (!match) return { names: [line], verb: '', why: line };
  const names = match[1].split(/, and | and |, /).map((name) => name.trim()).filter(Boolean);
  const reason = match[3] ?? '';
  const why = /price/.test(reason) ? 'price' : reason;
  return { names, verb: match[2], why };
}

/**
 * A run's refusals with fresh ones added: a refusal said again with more
 * names ("Devin Booker" then "Devin Booker and Jalen Duren", the same lock
 * or a moved price) replaces the one it covers; others are kept.
 */
export function mergeRefusals(known: readonly string[], fresh: readonly string[]): string[] {
  let out = [...known];
  for (const line of fresh) {
    const next = refusalParts(line);
    out = out.filter((entry) => {
      const old = refusalParts(entry);
      return !(old.verb === next.verb && old.why === next.why && old.names.every((name) => next.names.includes(name)));
    });
    out.push(line);
  }
  return out;
}

/**
 * A run's games notice with its refusals, before any lock sentence it ends
 * with. A refusal by the lock still ahead is said in the present and stands
 * for that lock's sentence ("…were not added: moves pause for the Nov 11
 * games."); one by a lock the run has played is in the past.
 */
export function withRefusals(games: string, refusals: readonly string[]): string {
  if (refusals.length === 0) return games;
  const lock = /\s(Moves pause for (the [^.]+ games)\.)$/.exec(games);
  const head = lock ? games.slice(0, lock.index) : games;
  const ahead = lock?.[2] ?? null;
  let saysLock = false;
  const lines = refusals.map((line) => line.replace(/: moves paused for (the .+ games)\.$/, (whole, which: string) => {
    if (which !== ahead) return whole;
    saysLock = true;
    return `: moves pause for ${which}.`;
  }));
  return [head, ...lines, ...(lock && !saysLock ? [lock[1]] : [])].join(' ');
}

export function runNotice(steps: readonly ('night' | 'week')[], notice: string): string {
  if (steps.length < 2) return notice;
  const nights = steps.filter((step) => step === 'night').length;
  const weeks = steps.length - nights;
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const label = nights > 0 && weeks > 0
    ? `${count(nights, 'night')} and ${count(weeks, 'week')}`
    : nights > 0 ? count(nights, 'night') : count(weeks, 'week');
  const marker = ' games: ';
  const at = notice.indexOf(marker);
  return at < 0 ? notice : `${notice.slice(0, at)} games (${label}): ${notice.slice(at + marker.length)}`;
}

/** Whether any of your players played after `after`, through `through` (games, not fees). */
export function playedBetween(
  ledger: readonly { gameId: string | null; gameDate: string | null }[] | undefined,
  after: string,
  through: string,
): boolean {
  if (!ledger) return false;
  return ledger.some((entry) => (
    entry.gameId !== null && entry.gameDate !== null && entry.gameDate > after && entry.gameDate <= through
  ));
}

/**
 * The status row as one sentence for screen readers, e.g.
 * "Practice, day 16 of 174. Nov 5 games +$323.4K. Next games Thu, Nov 6."
 * Once a night has a result, its sentence carries the date. Money reads as
 * the screen shows it, in K and M (walk 13 T3-01: "-$167,500" was said beside
 * a drawn "-$167.5K", and every other spoken line uses K).
 */
export function statusSummary({
  mode,
  lastSettledDate,
  nextGameDate,
  lastNight,
  noGames = false,
  nobody = false,
  progress,
  lockSentence,
  resultLabel = null,
  finalScore = null,
  season = null,
}: StatusSummaryInput): string {
  const parts: string[] = [];
  const named = lastNight !== null;
  const label = resultLabel ?? (lastSettledDate ? humanDate(lastSettledDate) : null);
  if (mode === 'practice') {
    const clock = progress
      ? (progress.complete ? 'season complete' : `day ${progress.day} of ${progress.total}`)
      : null;
    const date = lastSettledDate && !named ? `, ${humanDate(lastSettledDate)}` : '';
    const which = season !== null && season >= 2 ? `, Season ${season}` : '';
    parts.push(`Practice${which}${date}${clock ? `, ${clock}` : ''}.`);
  } else if (!named) {
    parts.push(lastSettledDate ? `Games through ${humanDate(lastSettledDate)}.` : 'No games settled yet.');
  }
  if (named) {
    parts.push(noGames
      ? (nobody && label ? `${label}${noGamesWords(true)}.` : `${label ?? 'Latest games'}: ${nobody ? NOBODY_ON_ROSTER : NO_PLAYERS_PLAYED}.`)
      : `${label ? `${label} games` : 'Latest games'} ${signedMoneyFine(lastNight)}.`);
  }
  const next = nextGamesText(nextGameDate);
  const opener = mode === 'practice' && progress?.day === 0;
  // A finished season states its result; the way on is the Play another
  // season button beside or under this row (walk 3 T4-04).
  if (mode === 'practice' && progress?.complete) {
    parts.push(finalScore !== null ? `Final score ${signedMoneyFine(finalScore)}.` : `${PRACTICE_OVER_TEXT}.`);
  }
  else if (next) parts.push(opener ? `Season opens ${next}.` : `Next games ${next}.`);
  else parts.push('Next games not scheduled yet.');
  if (lockSentence) parts.push(lockSentence);
  return parts.join(' ');
}

/**
 * "Last night" in the bars, at the precision of that night's header on
 * Results (signedMoneyFine: "+$322.5K", "-$3,500", "$0"), so the two read the
 * same rather than "+$323K" above "+$322.5K". Screen readers get the amount
 * to the dollar.
 */
export function lastNightFigure(amount: number): { text: string; accessibilityLabel: string } {
  return { text: signedMoneyFine(amount), accessibilityLabel: exactSignedMoney(amount) };
}

/**
 * What the dividend is paid on, in the words the rules copy uses
 * (data/perGameRules.ts); the tests hold the two together.
 */
export function dividendBasisText(basis: DividendBasis): string {
  return basis === 'raw_net_points' ? 'His net points each game' : 'His net points above projection';
}

/**
 * "His net points each game · $40K for each net point", with the rate held
 * together so a narrow sheet breaks at the dot, never inside the rate. In K
 * like the welcome and Scoring: "$40,000" here read as another rate (walk 8
 * T1-04).
 */
export function dividendText(basis: DividendBasis, dollarsPerNetPoint: number): string {
  return `${dividendBasisText(basis)} · ${keepTogether(`${moneyFine(dollarsPerNetPoint)} for each net point`)}`;
}

/**
 * Below this window height the frame folds (App, the status row, the practice
 * bar and the sheets all use `chromeFolded`): the brand bar hides, and the status row and practice bar become one
 * row (day, +1 night, +1 week, More, Settings) so the game keeps the screen.
 */
export const CHROME_SHORT_MAX_HEIGHT = 500;

/**
 * Below this height a wide status row (a laptop at 960x600, 1280x610; a
 * tablet at 853x533) draws the lock as its short padlock words beside the
 * day, not as a line of its own, so the frame is a line shorter and the
 * rows under it keep more of the window (walk 11 T2-09).
 */
export const CHROME_SHORT_LAPTOP_MAX_HEIGHT = 640;

export function lockBesideDay(height: number, wideRow: boolean): boolean {
  return wideRow && height < CHROME_SHORT_LAPTOP_MAX_HEIGHT;
}

/**
 * A wide window folds a little taller: a laptop at 150% zoom (1280x800 is
 * 853x533, 1366x768 is 911x512) kept two players under a stacked brand bar,
 * status row, practice row and hint (walk 11 T3-13). Portrait phones keep the
 * height rule alone (an iPhone SE in Safari is about 375x553).
 */
export const CHROME_SHORT_WIDE_MIN_WIDTH = 600;
export const CHROME_SHORT_WIDE_MAX_HEIGHT = 560;

/**
 * The smallest phones fold a little taller too: a 320x568 phone (an iPhone
 * SE of the first kind) left 58% of its height to the Roster, one row at a
 * time, under a brand bar, a two-line status and the practice row (walk 12
 * T4-10). Folded, the brand bar goes and notices sit in the strip above the
 * tabs. Wider phones keep the height rule (a 375x553 SE in Safari).
 */
export const CHROME_SHORT_NARROW_MAX_WIDTH = 340;
export const CHROME_SHORT_NARROW_MAX_HEIGHT = 600;

export function chromeFolded(height: number, width = 0): boolean {
  return height < CHROME_SHORT_MAX_HEIGHT
    || (width >= CHROME_SHORT_WIDE_MIN_WIDTH && height < CHROME_SHORT_WIDE_MAX_HEIGHT)
    || (width > 0 && width < CHROME_SHORT_NARROW_MAX_WIDTH && height < CHROME_SHORT_NARROW_MAX_HEIGHT);
}

/** From this width the folded row has room for the facts beside its controls. */
export const CHROME_FOLDED_FACTS_MIN_WIDTH = 600;
/**
 * Below this width the folded row takes two lines (the day beside Settings,
 * then the three practice controls): "Day 16/174", +1 night, +1 week, More
 * and Settings need about 320px in one line.
 */
export const CHROME_FOLDED_ONE_LINE_MIN_WIDTH = 340;

/**
 * Below this height a folded row too narrow for one line of controls keeps to
 * one 44px line anyway: the day count and More, with +1 night, +1 week and
 * Settings inside More. A 390x844 phone at 400% zoom is 98x211, where two
 * lines of frame left the screen 58px (walk 2 T3-11).
 */
export const CHROME_TINY_MAX_HEIGHT = 300;

export function chromeTiny(width: number, height: number): boolean {
  return chromeFolded(height) && height < CHROME_TINY_MAX_HEIGHT && width < CHROME_FOLDED_ONE_LINE_MIN_WIDTH;
}

/**
 * From this width a tiny row (a window at 400% zoom) keeps +1 night on screen
 * beside More: the welcome says "Press +1 night to play Oct 21", and at
 * 320x200 the row showed only the day and More, with every control inside
 * (walk 14 T3-02). +1 week and the rest stay in More. Narrower (a phone at
 * 400%, 98px) the day and More fill the row.
 */
export const CHROME_TINY_NIGHT_MIN_WIDTH = 240;
/**
 * On a locked night the day's line carries the padlock and its date ("🔒 Oct
 * 28"): below this width that date ran under +1 night, so the row keeps the
 * day, the padlock and More, and +1 night is in More that night.
 */
export const CHROME_TINY_NIGHT_LOCKED_MIN_WIDTH = 320;

export function tinyRowHoldsNight(width: number, complete = false, locked = false): boolean {
  return !complete && width >= (locked ? CHROME_TINY_NIGHT_LOCKED_MIN_WIDTH : CHROME_TINY_NIGHT_MIN_WIDTH);
}

/**
 * Below this width a sheet's title and its Done no longer share a line (a
 * 390px phone at 400% zoom is 98px wide, where Done showed as "Do" or not at
 * all). The Rules and Settings sheets then put Done on a full-width row under
 * the title, narrow their gutters so headings wrap between words, and put
 * each theme's swatch under its name (walk 3 T3-31).
 */
export const SHEET_NARROW_MAX_WIDTH = 160;

export function sheetNarrow(width: number): boolean {
  return width < SHEET_NARROW_MAX_WIDTH;
}

/**
 * Below this width Settings' "IN USE" tag leaves the right edge of its theme
 * row and sits under the theme's name, so the name and its description get
 * the row's width. Beside them at 195px (a phone at 200% zoom) it squeezed
 * the words to 51px: "Defaul / t", and High contrast's "Gains in blue, losses
 * in orange" was cut (walk 6 T3-15).
 */
export const APPEARANCE_TAG_BESIDE_MIN_WIDTH = 300;

export function appearanceTagUnder(width: number): boolean {
  return width < APPEARANCE_TAG_BESIDE_MIN_WIDTH;
}

/**
 * Where the Rules and Settings sheets start: at the top of the status row,
 * which is the bottom of the brand bar, so the sheet's top edge never slices
 * a line of the frame in half behind the scrim (at a fixed 64px the top
 * halves of "Practice · Oct 20" peeked out above it, walk 4 T1-01). A short
 * window has no brand bar, so the sheet covers the row from the top. null
 * when the frame is not measured: the sheets keep their own margins.
 */
export function sheetTopFor(statusRowTop: number | null | undefined): number | null {
  if (statusRowTop === null || statusRowTop === undefined || !Number.isFinite(statusRowTop) || statusRowTop < 0) return null;
  return Math.round(statusRowTop);
}

/**
 * From this width, in a window tall enough not to fold the frame, Rules and
 * Settings open as a floating panel: it starts under the frame with a gap and
 * stops short of the bottom, edged all round. As a phone sheet it started on
 * the status row, cut through "+1 NIGHT" and ran into the bottom edge (walk 5
 * T2-05).
 */
export const SHEET_FLOATING_MIN_WIDTH = 720;
/** The floating panel's gap under the frame. */
export const SHEET_FLOAT_GAP = 16;

export function sheetFloats(width: number, height: number): boolean {
  return width >= SHEET_FLOATING_MIN_WIDTH && !chromeFolded(height, width);
}

/** The floating panel's top: under the frame's bottom edge, with the gap. */
export function floatTopFor(frameBottom: number | null | undefined): number | null {
  if (frameBottom === null || frameBottom === undefined || !Number.isFinite(frameBottom) || frameBottom < 0) return null;
  return Math.round(frameBottom + SHEET_FLOAT_GAP);
}

/** The day count in a tiny row, in two short lines: "Day 16" over "of 174". */
export function practiceDayTiny(progress: PracticeProgress): string {
  return progress.complete ? 'Season\nover' : `Day ${progress.day}\nof ${progress.total}`;
}

/**
 * From this width a tiny row (a window at 400% zoom) has room for the day on
 * one line with the progress bar beside it: at 320px "Day 1 / of 174" took
 * two lines and the bar a third, beside 200px of empty row (walk 6 T3-05).
 * The 98px row keeps the two short lines.
 */
export const CHROME_TINY_DAY_ONE_LINE_MIN_WIDTH = 240;

export function practiceDayTinyText(progress: PracticeProgress, width: number): string {
  return width >= CHROME_TINY_DAY_ONE_LINE_MIN_WIDTH ? keepTogether(practiceDayText(progress)) : practiceDayTiny(progress);
}

/**
 * A label drawn in capitals ("OPEN FEE") in sentence case, for screen
 * readers: capitals reach them as capitals (CSS ones too), and some spell a
 * short all-caps word letter by letter (walk 6 T3-09).
 */
export function spokenLabel(label: string): string {
  const lower = label.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * What a lock does not stop, after "Moves reopen after Oct 30", in plain
 * words rather than "lineups set" (walk 2 T1-07): only moves wait; the games
 * count. Not held together: at high zoom the row is narrower than either half.
 */
export const LOCK_REASON = 'your players still play';

/**
 * With nobody held there are no players to "still play": the lock says what
 * to do instead (walk 10 T2-13, where it argued with "Nobody on your roster").
 */
export const LOCK_NOBODY_REASON = 'play that night, then add players';

/**
 * "Moves reopen after Oct 30 · your players still play"; with nobody held
 * (`nobodyHeld`), "Moves reopen after Oct 30 · play that night, then add
 * players".
 */
export function lockLine(lockGameDate: string | null | undefined, nobodyHeld = false): string {
  return `${rosterReopensLine(lockGameDate)} · ${nobodyHeld ? LOCK_NOBODY_REASON : LOCK_REASON}`;
}

/**
 * The lock in a row too narrow for its sentence (a folded row at 200% zoom):
 * "Locked · Nov 1" beside the padlock, under the day count, so the row keeps
 * its words and Settings keeps its place on the first line (walk 3 T3-29).
 */
export function lockShortText(lockGameDate: string | null | undefined): string {
  return lockGameDate ? `Locked · ${keepTogether(humanDate(lockGameDate))}` : 'Locked';
}

/** Below this width the phone slot beside +1 week says "Locked · Oct 28", not the reopen line. */
export const LOCK_SLOT_LINE_MIN_WIDTH = 360;

/**
 * A landscape phone's folded row says the lock in full ("Moves reopen after
 * Oct 28") from this width, and "Locked · Oct 28" below it, so a locked night
 * keeps the row to two lines (walk 15 lead: 740px and 667px wrapped). With
 * nobody held the games' words ("nobody on your roster") are longer, so the
 * full words need more room.
 */
export const FOLDED_LOCK_WORDS_MIN_WIDTH = 700;
export const FOLDED_LOCK_WORDS_MIN_WIDTH_NOBODY = 800;

/**
 * The lock's words in the phone slot beside +1 week: the reopen line where
 * it fits, "Locked · Oct 28" on narrow phones, and with a reader's own text
 * spacing just the date beside the padlock, so the date is never cut to
 * "Locked · …" (walk 11 T3-04; the padlock already says locked).
 */
export function lockSlotText(lockGameDate: string | null | undefined, width: number, readerSpacing: boolean): string {
  if (readerSpacing && width < LOCK_SLOT_LINE_MIN_WIDTH) return lockGameDate ? humanDate(lockGameDate) : 'Locked';
  return width < LOCK_SLOT_LINE_MIN_WIDTH ? lockShortText(lockGameDate) : rosterReopensLine(lockGameDate);
}

/**
 * The padlock's name wherever it stands for the sentence (the short lock
 * words, the padlock alone at 400% zoom): "Roster locked until after Nov 1".
 */
export function lockIconName(lockGameDate: string | null | undefined): string {
  return lockGameDate ? `Roster locked until after ${humanDate(lockGameDate)}` : 'Roster locked until after these games';
}

/** Whether any of your players played on `date` (games, not fees). */
export function playedOn(
  ledger: readonly { gameId: string | null; gameDate: string | null }[] | undefined,
  date: string | null | undefined,
): boolean {
  if (!ledger || !date) return false;
  return ledger.some((entry) => entry.gameId !== null && entry.gameDate === date);
}

/** Under +1 night / +1 week while the roster is empty. */
export const EMPTY_ROSTER_HINT = "Add a player first. +1 night plays the next night's games.";

/**
 * The same line for someone who has held players or shorts before and holds
 * nobody now (every short ended, say): "Add a player first" read as if a
 * week of shorts had never happened (walk 8 T4-10).
 */
export const NOBODY_HELD_HINT = 'Nobody on your roster or shorts now: add or short someone before the next night.';

/**
 * The same line once the first player is in, until the next advance: the
 * line keeps its place, so nothing under the player's finger moves the
 * moment an Add lands (a second tap would otherwise hit the row below).
 */
export function readyHint(nextGameDate?: string | null): string {
  return `Ready. ${nightPlaysLine(nextGameDate)}`;
}

/**
 * What +1 night plays, by its night where it is known: "+1 night plays the
 * Oct 21 games." (walk 13 T2-01: "the next night's games" sat beside a button
 * reading OCT 21 and added words without information).
 */
export function nightPlaysLine(nextGameDate?: string | null): string {
  return nextGameDate ? `+1 night plays the ${humanDate(nextGameDate)} games.` : "+1 night plays the next night's games.";
}

/** The empty roster's line, naming the night: "Add a player first. +1 night plays the Oct 21 games." */
export function emptyRosterHint(nextGameDate?: string | null): string {
  return nextGameDate ? `Add a player first. ${nightPlaysLine(nextGameDate)}` : EMPTY_ROSTER_HINT;
}

/**
 * The hint line once the night it promised is in: "Oct 21 games in." (or
 * "Oct 21–27 games in." after a week). The line keeps its place through the
 * press, so the frame does not get shorter under the finger (it went at
 * once and the list jumped 24px; walk 6 T4-13).
 */
export function gamesInLine(label: string): string {
  return `${keepTogether(label)} games in.`;
}

/**
 * What ends the held "Oct 21 games in." line (heldLineEnds). The frame may
 * change height only when the player acts on it: their own press of +1
 * night, +1 week or Play to the end (the line sits under those buttons, so
 * they stay put), or a tab switch, when the whole screen changes anyway.
 * Never time alone: it went after 3 s without a touch and the list jumped
 * 24px under a finger that was about to tap (walk 7 T1-14); never a press
 * that was queued behind another (it plays by itself, later), nor a night
 * landing.
 */
export type HeldLineEvent = 'idle' | 'night-landed' | 'queued-press' | 'press' | 'tab-switch';

export function heldLineEnds(event: HeldLineEvent): boolean {
  return event === 'press' || event === 'tab-switch';
}

/**
 * Once the player has answered "Play anyway" to the empty-roster question,
 * it is not asked again that practice season (it came back on every press,
 * 22 times in one run: walk 3 T1-19, T2-14); this line says it instead.
 */
export const EMPTY_ROSTER_PLAYING_HINT = 'Nobody on your roster: nights play without you';

/**
 * The line beside +1 night / +1 week, or null for none: "Add a player
 * first…" while the roster is empty (the nights-without-you line once the
 * player chose to play anyway), then "Ready…" from the first add until the
 * next advance (`justFilled`: the roster was empty at this same settled date).
 */
export function practiceHint({
  complete,
  emptyRoster,
  playedWithoutRoster,
  justFilled,
  nextGameDate,
  heldBefore = false,
  locked = false,
  lockGameDate = null,
}: {
  complete: boolean;
  emptyRoster: boolean;
  playedWithoutRoster: boolean;
  justFilled: boolean;
  nextGameDate: string | null | undefined;
  /** A player or short has been held this season (a position of any status). */
  heldBefore?: boolean;
  /** Moves are locked for the next games (`lockGameDate`: their date). */
  locked?: boolean;
  lockGameDate?: string | null;
}): string | null {
  if (complete) return null;
  if (emptyRoster) {
    if (playedWithoutRoster) return EMPTY_ROSTER_PLAYING_HINT;
    // Nobody can be added before locked games: say what can be done, not
    // "add someone first", which the lock forbids (walk 9 T4-03).
    if (locked) return lockedEmptyHint(lockGameDate, heldBefore);
    return heldBefore ? NOBODY_HELD_HINT : emptyRosterHint(nextGameDate);
  }
  return justFilled ? readyHint(nextGameDate) : null;
}

/**
 * The hint on a locked night with nobody held: "Nobody on your roster or
 * shorts. Moves reopen after Oct 28." (walk 9 T4-03).
 */
export function lockedEmptyHint(lockGameDate: string | null | undefined, heldBefore = false): string {
  return `${heldBefore ? 'Nobody on your roster or shorts' : 'Nobody on your roster yet'}. ${rosterReopensLine(lockGameDate)}.`;
}

/** Whether a hint is the locked night's (lockedEmptyHint). */
function isLockedEmptyHint(hint: string): boolean {
  return /^Nobody on your roster (or shorts|yet)\. Moves reopen /.test(hint);
}

/**
 * The practice hint in a short form, for the rows with no line to spare: the
 * folded row (landscape, 200% zoom), beside or under the day count, and the
 * top of More at 400% zoom. The full hint vanished there, so the quiet
 * buttons looked disabled for no reason (walk 4 T1-09, T3-11). Each fits the
 * 129px a 195px row leaves beside Settings.
 */
/**
 * "+1 night" and "+1 week" kept on one line wherever a hint or question
 * names them: at 320px "Ready for +1 / night" split the control's name
 * (walk 11 T4-04).
 */
export function keepControlNames(text: string): string {
  return text.replace(/\+1 (night|week)/g, '+1\u00a0$1');
}

/**
 * The hint while a night or week plays (walk 11 T1-08): it said "Ready for
 * +1 night" beside a button reading PLAYING. `playing` reads before "games"
 * ("Oct 21", "Oct 21–27", "rest of the season's"; state/practicePlaying).
 */
export function playingHint(playing: string, short: boolean): string {
  if (!short) return `Playing the ${playing} games…`;
  return playing.endsWith("'s") ? 'Playing the rest…' : `Playing ${playing}…`;
}

/**
 * The hint while the first adds are still saving (walk 12 T2-08): "Add a
 * player first" sat beside rows reading "ADDED ✓". A press of +1 night now
 * waits for them, as moves wait for nights. `moves`: the adds (or shorts)
 * saving, from movesInFlight.
 */
export function savingHint(moves: readonly Pick<MoveInFlight, 'verb'>[], short: boolean, nextGameDate?: string | null): string {
  const adds = moves.filter((move) => move.verb === 'add').length;
  const kind = adds === moves.length ? 'add' : adds === 0 ? 'short' : 'move';
  const what = moves.length === 1 ? `your ${kind}` : `${moves.length} ${kind}s`;
  return short ? `Saving ${what}…` : `Saving ${what}… then ${nightPlaysLine(nextGameDate)}`;
}

/**
 * The hint while presses wait behind a move still saving (walk 15 T2-03): the
 * queue, not the one night a press used to play. "Saving your add… then Oct
 * 21–Nov 10 plays (3 weeks)." `lastSettled`: the last night in;
 * `seasonEnd`: the season's last day. Nights in the queue are counted, not
 * dated (a night plays the next game night).
 */
export function savingQueueHint(
  moves: readonly Pick<MoveInFlight, 'verb'>[],
  queued: readonly QueuedStep[],
  lastSettled: string | null | undefined,
  seasonEnd: string | null | undefined,
): string {
  const saving = savingHint(moves, true);
  const through = queuedThrough(lastSettled, null, queued, seasonEnd);
  if (through && lastSettled) {
    return `${saving} then ${keepTogether(dateSpanText(shiftDay(lastSettled, 1), through))} plays (${queuedPhrase(queued)}).`;
  }
  return `${saving} then ${queuedPhrase(queued)} ${queued.length === 1 ? 'plays' : 'play'}.`;
}

export const EMPTY_ROSTER_HINT_SHORT = 'Add a player first';
export const NOBODY_HELD_HINT_SHORT = 'Add or short someone';
export const EMPTY_ROSTER_PLAYING_HINT_SHORT = 'No players yet';
export const READY_HINT_SHORT = 'Ready for +1 night';

/**
 * +1 week's own description, where +1 night's is the hint line: it said
 * "+1 night plays the next night's games" on +1 week too (walk 7 T3-02).
 * `hint`: the hint line now; `weekSpan`: the days +1 week plays ("Oct 21–27").
 */
export function practiceWeekHint(hint: string | null, weekSpan: string | null): string | null {
  if (hint === null) return null;
  // The hint arrives with its control names kept together ("+1\u00a0night",
  // keepControlNames): compared as drawn, the empty roster's line matched
  // nothing and +1 week said "Ready" with nobody held (walk 12 T3-02).
  const plain = hint.replace(/\u00a0/g, ' ');
  if (isLockedEmptyHint(plain)) return hint;
  // While a night or week plays, both buttons say what the screen says.
  if (/^Playing /.test(plain)) return hint;
  const plays = weekSpan ? `+1 week plays the ${weekSpan} games.` : '+1 week plays the next seven days.';
  // The first adds still saving (savingHint): the week waits for them too.
  if (/^Saving /.test(plain)) return plain.replace(/\+1 night plays the [^.]*games\./, plays);
  // Spoken only (a description), so plain spaces. The line names its night
  // ("…plays the Oct 21 games.", walk 13 T2-01), so match its start.
  if (plain.startsWith('Add a player first.')) return `Add a player first. ${plays}`;
  if (plain === NOBODY_HELD_HINT) return 'Nobody on your roster or shorts now: add or short someone before the next week.';
  if (plain === EMPTY_ROSTER_PLAYING_HINT) return 'Nobody on your roster: the week plays without you.';
  return `Ready. ${plays}`;
}

/**
 * The figure the status row names beside the day: the last night or run,
 * except on the opening eve (nothing played yet) and once the season is
 * complete, where the final score is the result: after +1 week then Play to
 * the end the row read "Oct 28–Apr 12 games +$7.89M" beside "Final score
 * +$9.49M" (walk 7 T4-09).
 */
export function statusRowResult<T>(progress: Pick<PracticeProgress, 'day' | 'complete'> | null, result: T | null): T | null {
  if (progress && (progress.day === 0 || progress.complete)) return null;
  return result;
}

export function practiceHintShort(input: Parameters<typeof practiceHint>[0]): string | null {
  const full = practiceHint(input);
  if (full === null) return null;
  if (isLockedEmptyHint(full)) return lockShortText(input.lockGameDate);
  if (full.startsWith('Add a player first.')) return EMPTY_ROSTER_HINT_SHORT;
  if (full === NOBODY_HELD_HINT) return NOBODY_HELD_HINT_SHORT;
  if (full === EMPTY_ROSTER_PLAYING_HINT) return EMPTY_ROSTER_PLAYING_HINT_SHORT;
  return READY_HINT_SHORT;
}

/**
 * When a kept notice was said, for Settings' Recent notices (walk 8 T3-I2):
 * "Just now", "4 min ago", then the clock time ("1:05 PM") once it is an
 * hour old.
 */
export function noticeAgeText(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const date = new Date(at);
  const hours = date.getHours();
  return `${hours % 12 === 0 ? 12 : hours % 12}:${String(date.getMinutes()).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
}

/** Settings' Recent notices with none kept yet. */
export const NO_RECENT_NOTICES = 'No notices yet. Your moves and the nights you play are listed here, newest first.';

/**
 * "Match device" says which look it gives now ("Match device · Light now"):
 * "IN USE" alone left the player comparing swatches (walk 8 T2-I7).
 */
export function deviceChoiceName(onScreen: string | null): string {
  return onScreen ? `Match device · ${onScreen} now` : 'Match device';
}

/**
 * From this width a row that stacks its advance labels (a phone at 200% zoom,
 * 195px) still names the night +1 night plays: "+1 NIGHT" over "OCT 21", with
 * the night button taking a larger share and "+1" over "WEEK" beside it.
 * Narrower rows keep "+1" over "NIGHT" (walk 4 T3-11).
 */
export const NIGHT_DATE_STACKED_MIN_WIDTH = 180;

/**
 * From this width a stacked row keeps "+1 week" on one line ("+1 WEEK" is
 * 50px of words; the night keeps its 54px "+1 NIGHT" over "OCT 21"): at
 * 195px (a phone at 200% zoom) "+1" over "WEEK" read as two labels (walk 12
 * T3-03, T4-09). Narrower, the words stack as before.
 */
export const WEEK_ONE_LINE_STACKED_MIN_WIDTH = 192;

export function stackedWeekLabel(width: number): string {
  return width >= WEEK_ONE_LINE_STACKED_MIN_WIDTH ? '+1\u00a0week' : '+1\nweek';
}

/**
 * The days a +1 week pressed on settled date `from` plays: the next seven
 * ("Oct 21–27"), never past the season's last day.
 */
export function weekSpanLabel(from: string, seasonEnd: string | null | undefined): string {
  const last = shiftDay(from, 7);
  return dateSpanText(shiftDay(from, 1), seasonEnd && seasonEnd < last ? seasonEnd : last);
}

/**
 * What a press on +1 night or +1 week says while the last press is still
 * playing (or your last move is saving): it is queued, once, and plays as
 * soon as the nights on screen are in. It was dropped with "Still playing",
 * so a steady run of presses advanced only every other time (walk 5 T3-11,
 * T4-06). `playing`: the nights playing now ("Oct 21–27"), if any.
 */
export function queuedLine(pressed: 'night' | 'week', playing: string | null, count = 1): string {
  const when = playing ? `once ${playing} is in` : 'in a moment';
  // A second press on a queued button queues one more and says so; it was
  // swallowed without a word (walk 7 T2-06).
  return count > 1 ? `${count} ${pressed}s queued. They play ${when}.` : `Next ${pressed} queued. It plays ${when}.`;
}

type QueuedStep = 'night' | 'week';

/**
 * Where a queued run of weeks ends (walk 11 T4-N2: "+1 WEEK ×12 QUEUED" left
 * the date maths to the player): the last night the week playing and the
 * weeks queued behind it cover, from the last night in, capped at the
 * season's end. null while nights are part of it (a night plays the next
 * game night, not a fixed day) or nothing waits.
 */
export function queuedThrough(
  lastSettled: string | null | undefined,
  playing: QueuedStep | null,
  queued: readonly QueuedStep[],
  seasonEnd: string | null | undefined,
): string | null {
  if (!lastSettled || queued.length === 0 || playing === 'night' || queued.some((step) => step === 'night')) return null;
  const days = 7 * (queued.length + (playing === 'week' ? 1 : 0));
  const end = shiftDay(lastSettled, days);
  return seasonEnd && end > seasonEnd ? seasonEnd : end;
}

/**
 * +1 night while weeks play or wait (walk 12 T4-08): it named the next game
 * night ("+1 NIGHT NOV 5") while the week playing covered Nov 4–10 and the
 * queue ran to Nov 24; pressed, it queued a night after the queue. Its date
 * goes (the night after a run is not known until the run is in) and its name
 * says where it plays: after the day the weeks end, or that the season is
 * already queued. null while no week plays or waits.
 */
export function nightAfterQueue(
  lastSettled: string | null | undefined,
  playing: QueuedStep | null,
  queued: readonly QueuedStep[],
  seasonEnd: string | null | undefined,
  /** The days the week playing now covers ("Oct 28–Nov 3"). */
  playingSpan: string | null = null,
): { name: string; seasonQueued: boolean } | null {
  const weeks = queued.filter((step) => step === 'week').length + (playing === 'week' ? 1 : 0);
  if (weeks === 0) return null;
  const nights = queued.length - queued.filter((step) => step === 'week').length + (playing === 'night' ? 1 : 0);
  // A night in the run plays the next game night, not a fixed day: then the
  // day the run ends is not known.
  const end = lastSettled && nights === 0 ? shiftDay(lastSettled, 7 * weeks) : null;
  if (end && seasonEnd && end >= seasonEnd) {
    return { name: `+1 night: the rest of the season is already queued, to the ${humanDate(seasonEnd)} games`, seasonQueued: true };
  }
  // Only the week playing is left (after Cancel, say): it names that week,
  // not "the queued weeks" with none queued (walk 14 T4-08).
  const waitFor = queued.length === 0 && playing === 'week'
    ? (playingSpan ? keepTogether(playingSpan) : 'this week')
    : null;
  const once = waitFor ? `once ${waitFor} is in` : 'once the queued weeks are in';
  return {
    name: end ? `+1 night: plays the next night after ${humanDate(end)}, ${once}` : `+1 night: plays the next night ${once}`,
    seasonQueued: false,
  };
}

/** "12 weeks queued, through Feb 9. They play once Nov 4–10 is in." */
export function queuedLineThrough(line: string, through: string | null): string {
  return through ? line.replace(/^([^.]*)\./, `$1, through ${humanDate(through)}.`) : line;
}

/** "2 weeks", "1 night and 2 weeks" (`queued`: "2 queued weeks"). */
function queuedPhrase(steps: readonly QueuedStep[], queued = false): string {
  const nights = steps.filter((step) => step === 'night').length;
  const weeks = steps.length - nights;
  const noun = (n: number, word: string) => `${n === 1 ? word : `${word}s`}`;
  const lead = queued ? 'queued ' : '';
  if (nights > 0 && weeks > 0) return `${nights} ${lead}${noun(nights, 'night')} and ${weeks} ${noun(weeks, 'week')}`;
  const total = steps.length;
  return `${total} ${lead}${noun(total, nights > 0 ? 'night' : 'week')}`;
}

/**
 * What a practice question (Restart, Exit, Play to the end) adds while
 * presses wait behind the one playing: they wait for the answer instead of
 * playing under it, so the question's summary holds still (walk 8 T4-06:
 * "Day 14" became "Day 21" while the player read). null with none queued.
 */
export function queuedWaitLine(queued: readonly QueuedStep[], playing: string | null = null): string | null {
  // The step already playing cannot wait: it is named, so the summary
  // changing once when it lands is no surprise.
  const now = playing ? `${playing} is still playing.` : null;
  if (queued.length === 0) return now;
  const wait = `${queuedPhrase(queued)} still queued: ${queued.length === 1 ? 'it waits' : 'they wait'} until you choose.`;
  return now ? `${now} ${wait}` : wait;
}

/**
 * A question that ends the season (Restart, Exit) says what each answer does
 * to the presses waiting for it (walk 15 T4-02): "3 weeks are queued: Keep
 * playing plays them; Start over drops them." null with none queued.
 */
export function queuedAnswerLine(queued: readonly QueuedStep[], keepLabel: string, dropLabel: string): string | null {
  if (queued.length === 0) return null;
  const them = queued.length === 1 ? 'it' : 'them';
  return `${queuedPhrase(queued)} ${queued.length === 1 ? 'is' : 'are'} queued: ${keepLabel} plays ${them}; ${dropLabel} drops ${them}.`;
}

/** The control that drops what is queued and has not started (walk 8 T4-N1). */
export const QUEUED_CANCEL_LABEL = 'Cancel queued';

/** Its name: the visible words, then what it drops ("Cancel queued: 2 weeks"). */
export function queuedCancelName(queued: readonly QueuedStep[]): string {
  return queued.length === 0 ? QUEUED_CANCEL_LABEL : `${QUEUED_CANCEL_LABEL}: ${queuedPhrase(queued)}`;
}

/**
 * The notice once queued presses are cancelled: "2 queued weeks cancelled."
 * The one playing is not stopped, and says so: "Oct 21–27 still plays."
 */
export function queuedCancelledNotice(queued: readonly QueuedStep[], playing: string | null): string {
  const what = queued.length === 1 ? `Queued ${queued[0]}` : queuedPhrase(queued, true);
  return `${what} cancelled.${playing ? ` ${playing} still plays.` : ''}`;
}

/**
 * Where +1 night and +1 week were in a folded row once the season is over:
 * words, not a control, so a steady tap through the last night never lands on
 * a season-changing button (walk 13 T4-10). The way on waits in More. The
 * status line right above already says "Season complete", so the slot only
 * says where to go next (walk 14 lead: it read "Season complete" three times
 * in 120px at 320x568).
 */
export const SEASON_DONE_SLOT = 'New season is in More';

/**
 * +1 night / +1 week's name while a press would queue behind the games
 * playing (or a move saving): it says what a press does, and the button is
 * not announced as unavailable (walk 13 T3-06: "dimmed" while every press
 * queued a week). "+1 week: queue another week; Oct 21–27 is playing".
 */
export function queueingAdvanceName(
  step: QueuedStep,
  playing: { step: QueuedStep; date: string | null } | null,
  queuedOfStep: number,
): string {
  const another = queuedOfStep > 0 || playing?.step === step;
  const what = `+1 ${step}: queue ${another ? 'another' : 'a'} ${step}`;
  if (!playing) return `${what}; your move is saving`;
  return `${what}; ${playing.date ? `${playing.date} is` : 'the games are'} playing`;
}

/**
 * Queued presses that end without playing for any reason but Cancel are said
 * with the reason, never dropped in silence (walk 13 T4-09, T4-N2): "2 queued
 * weeks not played: nobody is on your roster." null with none dropped.
 */
export function queueEndedNotice(queued: readonly QueuedStep[], reason: 'empty-roster' | 'season-over'): string | null {
  if (queued.length === 0) return null;
  const what = queued.length === 1 ? `Queued ${queued[0]}` : queuedPhrase(queued, true);
  return `${what} not played: ${reason === 'empty-roster' ? 'nobody is on your roster' : 'the season is over'}.`;
}

/**
 * Cancel's visible words, with the count (walk 9 T4-N3): "Cancel queued
 * week", "Cancel 2 queued weeks", "Cancel 3 queued" for a mix.
 */
export function queuedCancelLabel(queued: readonly QueuedStep[]): string {
  if (queued.length === 0) return QUEUED_CANCEL_LABEL;
  const nights = queued.filter((step) => step === 'night').length;
  const kind = nights === queued.length ? 'night' : nights === 0 ? 'week' : null;
  if (queued.length === 1) return `Cancel queued ${queued[0]}`;
  return kind ? `Cancel ${queued.length} queued ${kind}s` : `Cancel ${queued.length} queued`;
}

/** Its name starts with the visible words (voice control), then what it drops for a mix. */
export function queuedCancelControlName(queued: readonly QueuedStep[]): string {
  const label = queuedCancelLabel(queued);
  const mixed = queued.some((step) => step === 'night') && queued.some((step) => step === 'week');
  return mixed ? `${label}: ${queuedPhrase(queued)}` : label;
}

/**
 * Where Cancel queued is drawn: beside +1 week (desktop, tablet, portrait
 * phones), before +1 night (a folded row with room for it: landscape phones,
 * a laptop at 150%; walk 15 T4-01, T2-08), or inside More (the narrowest
 * folded rows and 400% zoom).
 */
export type CancelPlace = 'week' | 'night' | 'more';

/**
 * From this width a folded row keeps Cancel in the row, before +1 night: its
 * facts (two lines, the games figure left out for the run) still fit beside
 * Cancel, +1 night, +1 week, More and Settings. At 667px they took a third
 * line; narrower, Cancel is More's first item.
 */
export const CHROME_FOLDED_CANCEL_MIN_WIDTH = 760;

/**
 * From this width a folded row keeps Rules in the row, between More and
 * Settings, as portrait keeps it in its status row: turning the phone hid it
 * inside More (walk 15 T1-05). The facts beside it take the short day
 * ("Day 8/174") and closer gaps, so the widest (the day, then a week's
 * figure) still keeps to two lines at 844px; narrower, Rules is in More.
 */
export const CHROME_FOLDED_RULES_MIN_WIDTH = 840;

export function rulesInFoldedRow(tiny: boolean, width: number): boolean {
  return !tiny && width >= CHROME_FOLDED_RULES_MIN_WIDTH;
}

export function cancelPlace(folded: boolean, tiny: boolean, width: number): CancelPlace {
  if (!folded) return 'week';
  return !tiny && width >= CHROME_FOLDED_CANCEL_MIN_WIDTH ? 'night' : 'more';
}

/** Said once a run, after the first press that queues: the way back (walk 9 T3-12). */
export function queuedCancelHint(count: number, place: CancelPlace = 'week'): string {
  const where = place === 'more' ? 'in More' : place === 'night' ? 'beside +1 night' : 'beside +1 week';
  return `Press Cancel ${where} to drop ${count === 1 ? 'it' : 'them'}.`;
}

/**
 * Cancel's two-line words in a folded row, left of +1 night: "CANCEL" over
 * "3 QUEUED" (its name starts with the same words, queuedCancelControlName).
 */
export function foldedCancelLabel(queued: readonly QueuedStep[]): string {
  return queued.length <= 1 ? 'Cancel\nqueued' : `Cancel\n${queued.length} queued`;
}

/**
 * How long the queue must still have to run for "Press Cancel…" to be worth
 * saying: a screen reader needs a few seconds for the line, and a queue that
 * empties sooner made the instruction arrive after its Cancel had nothing
 * left to drop (walk 10 T3-09).
 */
export const CANCEL_HINT_MIN_MS = 3000;

/**
 * Whether the queued line adds "Press Cancel…": only when the presses queued
 * (`count`) should take CANCEL_HINT_MIN_MS or more at the last step's pace
 * (`stepMs`, null before any step has been timed).
 */
export function cancelHintFits(count: number, stepMs: number | null): boolean {
  return stepMs !== null && count > 0 && count * stepMs >= CANCEL_HINT_MIN_MS;
}

/**
 * Whether one more press fits behind the ones queued: presses queue as far as
 * the season's last day (a week covers seven days, a night at least one), so
 * a steady run of +1 week reaches the end rather than stopping at five
 * without a word (walk 10 T4-02, T4-N1). `daysLeft`: the season's days after
 * the step playing now.
 */
export function queueHasRoom(queued: readonly QueuedStep[], daysLeft: number): boolean {
  const covered = queued.reduce((days, step) => days + (step === 'week' ? 7 : 1), 0);
  return covered < daysLeft;
}

/**
 * Said once when a press finds the rest of the season already queued. Where
 * Cancel is inside More, it says so: "Cancel (in More) drops it." (walk 15 T4-01).
 */
export function queueFullLine(seasonEnd: string | null | undefined, place: CancelPlace = 'week'): string {
  return `The rest of the season is already queued${seasonEnd ? `, to the ${humanDate(seasonEnd)} games` : ''}. Cancel${place === 'more' ? ' (in More)' : ''} drops it.`;
}

/**
 * The queue-full line, reworded in place once nothing waits: Cancel has
 * nothing left to drop (walk 11 T4-06).
 */
export function queueLastLine(step: 'night' | 'week', seasonEnd: string | null | undefined): string {
  return `The last ${step} is playing now: the season ends after the ${seasonEnd ? humanDate(seasonEnd) : 'last'} games.`;
}

/** Cancel's own answer to a press with nothing queued, on the button (walk 11 T1-14). */
export const NOTHING_TO_CANCEL = 'Nothing to cancel';
/** How long Cancel shows it. */
export const NOTHING_TO_CANCEL_MS = 2000;

/**
 * The spoken queue line waits for the presses to pause this long, then says
 * the count once (walk 11 T3-15: a burst said it per press, 25 times in 3 s).
 */
export const QUEUE_LINE_PAUSE_MS = 700;

/**
 * +1 night's name, its visible words first so a voice command matches what
 * the button shows (walk 10 T3-05): "+1 night Oct 21: play the Oct 21
 * games"; "+1 night: play the Oct 21 games" where the label has no room for
 * the date.
 */
export function nightButtonName(nightDate: string | null, showsDate: boolean): string {
  if (!nightDate) return "+1 night: play the next night's games";
  return `+1 night${showsDate ? ` ${nightDate}` : ''}: play the ${nightDate} games`;
}

/**
 * +1 week's name, as +1 night's names its night (walk 15 T3-06: after the
 * first week a reader could not hear which week came next): "+1 week Oct
 * 30–Nov 5: play the Oct 30–Nov 5 games". `weekSpan`: weekSpanLabel.
 */
export function weekButtonName(weekSpan: string | null): string {
  return weekSpan ? `+1 week ${weekSpan}: play the ${weekSpan} games` : '+1 week: advance one week';
}

/**
 * A games notice as the status row draws it ("Oct 21–27 games: your score
 * rose $540.5K. …", "Oct 21–Nov 3 games (2 weeks): …"): the step's result
 * that Play to the end's season notice may be heard with. Its drawn words
 * already leave a new lock to the status row, so said again silently they
 * replace the heard text that still had "Moves pause for the Oct 28 games."
 * once Play to the end had played them (walk 14 T4-02).
 */
export function isGamesNotice(text: string | null | undefined): boolean {
  return Boolean(text && /^\S.*? games(?: \([^)]*\))?: /.test(text));
}

/**
 * The words beside Play another season in a phone's frame at season end:
 * "Finished #2 of 5" (`rank`: rosterView.rankLine), or null without a
 * board. The button sat alone at the row's right end with the rest of the
 * row blank (walk 14 T1-04); the place is the one fact the status row above
 * leaves out, and words, not a button, keep +1 night's old spot (walk 13
 * T4-10).
 */
export function seasonEndStanding(rank: string | null): string | null {
  return rank ? `Finished ${keepTogether(rank)}` : null;
}

/**
 * Whether a phone's frame keeps its control row at season end: not on the
 * Roster, whose result card holds the gold Play another season (the row
 * held only "New season", pushed right; walk 14 T1-04), unless Exit is
 * offered there too.
 */
export function seasonEndRowShows(onRoster: boolean, exitOffered: boolean): boolean {
  return !onRoster || exitOffered;
}

/**
 * The frame's way on at season end. On the Roster, where the result card
 * carries the gold "Play another season", the frame's is a quiet "New
 * season", so the screen shows one primary action, not two identical ones
 * (walk 10 T4-03); on other screens it is the gold "Play another season".
 * Both names keep "restart practice" for anyone looking.
 */
export function seasonEndControl(cardOnScreen: boolean): { label: string; name: string; primary: boolean } {
  return cardOnScreen
    ? { label: 'New season', name: 'New season: restart practice', primary: false }
    : { label: PRACTICE_OVER_TEXT, name: `${PRACTICE_OVER_TEXT}: restart practice`, primary: true };
}

/**
 * A cancel that lands while a step still plays is said with that step's
 * result, at its end: "Oct 21–27 games: your score rose $454K. Queued week
 * cancelled." (walk 9 T1-15: its own notice was replaced 80 ms later).
 */
export function withCancelledNote(result: string, note: string | null): string {
  if (!note || result.endsWith(note)) return result;
  return `${result.replace(/\s+$/, '')}${/[.!?…]$/.test(result.trim()) ? '' : '.'} ${note}`;
}

/**
 * Taps on +1 night / +1 week (walk 9 T4-11): a second tap on the same button
 * within ADVANCE_DOUBLE_TAP_MS of an isolated tap is held, not played: alone
 * it was a double tap's second click and is dropped; a third tap inside the
 * window proves a steady run, so the held tap and this one both count. A
 * quick tap in the middle of a steady rhythm (the tap before it came within
 * ADVANCE_RHYTHM_MS of its own) is a press of its own: five deliberate taps
 * at uneven gaps (370, 380, 420, then 290 ms) played four nights. A repeat
 * sooner than ADVANCE_BOUNCE_MS is a finger bouncing and never counts.
 * `plays`: how many presses this tap makes.
 */
export interface AdvanceTapState {
  lastAt: number | null;
  held: boolean;
  /** The last tap came within ADVANCE_RHYTHM_MS of the one before it. */
  steady: boolean;
}

export const ADVANCE_DOUBLE_TAP_MS = 350;
export const ADVANCE_RHYTHM_MS = 700;
export const ADVANCE_BOUNCE_MS = 100;

export const NO_ADVANCE_TAPS: AdvanceTapState = { lastAt: null, held: false, steady: false };

export function advanceTap(
  state: AdvanceTapState,
  now: number,
  windowMs = ADVANCE_DOUBLE_TAP_MS,
): { plays: number; state: AdvanceTapState } {
  const gap = state.lastAt === null ? Number.POSITIVE_INFINITY : now - state.lastAt;
  if (gap < ADVANCE_BOUNCE_MS) return { plays: 0, state };
  if (gap < windowMs) {
    if (state.held) return { plays: 2, state: { lastAt: now, held: false, steady: true } };
    if (state.steady) return { plays: 1, state: { lastAt: now, held: false, steady: true } };
    return { plays: 0, state: { lastAt: now, held: true, steady: false } };
  }
  return { plays: 1, state: { lastAt: now, held: false, steady: gap < ADVANCE_RHYTHM_MS } };
}

/**
 * A press that arrives this soon after the last step landed continues that
 * step's run, as a queued press does: one notice for the whole run, and the
 * status row names all of it. Without a network delay each night finished
 * before the next press, so two quick presses got two notices and the first
 * night's news was gone in half a second (walk 7 T4-03, T2-05).
 */
export const RUN_CONTINUE_MS = 1500;

/**
 * Whether a press continues the run before it: a press queued behind a step
 * still playing always does; any other does when it comes within
 * RUN_CONTINUE_MS of the last step landing (`sinceLandedMs`, null when no run
 * has landed or the last one was closed by Play to the end or a question).
 */
export function continuesRun(queued: boolean, sinceLandedMs: number | null): boolean {
  if (queued) return true;
  return sinceLandedMs !== null && sinceLandedMs >= 0 && sinceLandedMs <= RUN_CONTINUE_MS;
}

/**
 * Play to the end confirmed while a night still plays (or a move saves): it
 * waits its turn and plays once the screen has caught up, rather than doing
 * nothing (walk 7 T2-04).
 */
export function playToEndQueuedLine(playing: string | null): string {
  return `Play to the end queued. It plays ${playing ? `once ${playing} is in` : 'in a moment'}.`;
}

/**
 * The queued button's label, where sighted players see it (the queue lived
 * only in a hidden live region): "+1 week" over "queued", no wider than the
 * button's own label, so nothing beside it moves; "Next" over "queued" in a
 * stacked row (195px), where the button is 55px wide.
 */
export function queuedLabel(step: 'night' | 'week', stacked: boolean, count = 1): string {
  if (count > 1) return stacked ? `×${count}\nqueued` : `+1 ${step}\n×${count} queued`;
  return stacked ? 'Next\nqueued' : `+1 ${step}\nqueued`;
}

/**
 * Whether +1 night / +1 week asks before playing with nobody on the roster:
 * only until the player has once said "Play anyway" this season.
 */
export function asksBeforeEmptyNight(emptyRoster: boolean, playedWithoutRoster: boolean, lockedNight = false): boolean {
  // +1 night on a locked night with nobody held: nothing can be done before
  // those games, so it just plays them (the hint says moves reopen after;
  // walk 9 T4-03). +1 week still asks, and offers the night instead.
  if (lockedNight) return false;
  return emptyRoster && !playedWithoutRoster;
}

/**
 * Whether +1 week asks first: with nobody on the roster or shorts, every
 * time, whatever was answered before. "Play anyway" answers one press:
 * seven nights is a big jump, and after one allowed night the next +1 week
 * spent a week and a lock night in silence (walk 14 T1-06). On a locked
 * night the question offers "+1 night instead" first (walk 10 T2-14).
 * +1 night keeps asking once a season (asksBeforeEmptyNight).
 */
export function asksBeforeEmptyWeek(emptyRoster: boolean, _playedWithoutRoster = false, _lockedNight = false): boolean {
  return emptyRoster;
}

/**
 * Whether +1 night / +1 week are drawn quiet (outlined, no gold): whenever
 * nobody is on the roster or shorts, whatever was answered before, so the
 * welcome's Open market stays the one gold call (after one "Play anyway"
 * both turned gold beside "No players yet"; walk 14 T1-06). On a locked
 * night +1 night keeps its full style: nothing can be added before those
 * games, so playing that night is the way on (walk 9 T4-03).
 */
export function advanceQuiet(step: 'night' | 'week', emptyRoster: boolean, lockedNight = false): boolean {
  if (!emptyRoster) return false;
  return step === 'week' || !lockedNight;
}

/**
 * "Play a week with nobody on your roster?" on a locked night: Open market
 * was a dead end (every Add was LOCKED), so the default is the one night the
 * lock covers, after which players can be added (walk 9 T4-03).
 */
export function lockedWeekQuestion(lockGameDate: string | null | undefined): {
  title: string;
  lines: string[];
  primaryLabel: string;
  secondLabel: string;
} {
  const games = lockGameDate ? `the ${humanDate(lockGameDate)} games` : 'the next games';
  return {
    title: 'Play a week with nobody on your roster?',
    lines: [
      `Moves are locked for ${games} and reopen after them.`,
      '+1 night plays just those games, so you can add players for the rest of the week.',
    ],
    primaryLabel: '+1 night instead',
    secondLabel: 'Play the week',
  };
}

/**
 * Play to the end with nobody on the roster: the question offers the Market
 * first (walk 9 T4-12), unless moves are locked for the next games.
 */
export function playToEndOffersMarket(rosterPlayers: number, locked: boolean): boolean {
  return rosterPlayers === 0 && !locked;
}

/**
 * Play to the end on a lock eve with nobody on the roster: Open market went
 * without a word (every Add was LOCKED), so it says why and offers the one
 * night the lock covers, as +1 week does there (walk 11 T4-03).
 */
export function playToEndOffersNight(rosterPlayers: number, locked: boolean): boolean {
  return rosterPlayers === 0 && locked;
}

export function playToEndLockedLine(lockGameDate: string | null | undefined): string {
  return lockGameDate
    ? `Moves are locked for the ${humanDate(lockGameDate)} games. +1 night plays just that night, then you can add players.`
    : 'Moves are locked for the next games. +1 night plays just those games, then you can add players.';
}

/**
 * The answers of every practice question, in one order (walk 11 T2-06):
 * the way out first ("Not now", "Keep playing"), the action that plays or
 * throws the season away next, and a recommended move (Open market, "+1
 * night instead") last, in gold. Left to right in a row, top to bottom when
 * stacked; focus starts on the way out, which changes nothing.
 */
/**
 * Below this width a practice question drops its margins and most of its
 * padding and sets its title a size smaller, so its words wrap at spaces:
 * a phone at 400% zoom (98px) left a 53px column that broke them in the
 * middle ("scor / e", "won' / t"; walk 12 T4-15).
 */
export const QUESTION_TIGHT_MAX_WIDTH = 240;

export function questionTight(width: number): boolean {
  return width < QUESTION_TIGHT_MAX_WIDTH;
}

export type QuestionAnswer = 'safe' | 'risky' | 'recommended';

export function questionAnswerOrder(recommended: boolean): { order: QuestionAnswer[]; focus: QuestionAnswer } {
  return { order: recommended ? ['safe', 'risky', 'recommended'] : ['safe', 'risky'], focus: 'safe' };
}

/**
 * The Play to the end lines when only shorts are held: after the last one
 * ends nobody plays for you, which "Your roster stays as it is" hid (walk 9
 * T4-12). null when players are on the roster or no short has an end date.
 */
export function playToEndShortsOnlyLines(shortEnds: readonly (string | null)[]): string[] | null {
  const dated = shortEnds.filter((end): end is string => Boolean(end)).sort();
  if (dated.length === 0 || dated.length < shortEnds.length) return null;
  const last = humanDate(dated[dated.length - 1]);
  const n = shortEnds.length;
  return [
    `Nobody is on your roster, so after ${last} nobody plays for you.`,
    n === 1 ? `Your short ends by itself after ${last}.` : `Your ${n} shorts end by themselves by the ${last} games.`,
  ];
}

/** How long a short stays open, in words. */
export function shortTermText(shortTermDays: number | null): string {
  if (shortTermDays === null) return 'A short stays open until you close it';
  return `A short runs ${shortTermDays} ${shortTermDays === 1 ? 'day' : 'days'}, then ends by itself with no fee`;
}
