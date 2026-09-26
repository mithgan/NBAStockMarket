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
  rosterReopensLine,
  signedMoney,
  signedMoneyFine,
} from '../copy/terms';
import { formatMoney } from '../format';

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

/** "Day 16/174": the day count for the narrowest rows. */
export function practiceDayShort(progress: PracticeProgress): string {
  return progress.complete ? 'Season complete' : `Day ${progress.day}/${progress.total}`;
}

/**
 * What a practice season holds, for the Restart and Exit questions:
 * "Day 16 of 174, 8 players, 2 shorts, score +$120K".
 */
export function practiceStakes({ progress, players, shorts, score }: {
  progress: PracticeProgress;
  players: number;
  shorts: number;
  score: number;
}): string {
  const parts = [
    progress.complete ? 'a finished season' : `Day ${progress.day} of ${progress.total}`,
    players === 0 ? 'no players' : `${players} ${players === 1 ? 'player' : 'players'}`,
  ];
  if (shorts > 0) parts.push(`${shorts} ${shorts === 1 ? 'short' : 'shorts'}`);
  parts.push(`score ${signedMoney(score)}`);
  return parts.join(', ');
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
  { day, moves }: { day: number; moves: number },
): boolean {
  if (kind === 'play-again') return false;
  return day > 0 || moves > 0;
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

export function noGamesWords(nobody: boolean): string {
  return nobody ? ` games: ${NOBODY_ON_ROSTER}` : `: ${NO_PLAYERS_PLAYED}`;
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
  if (landed?.from && landed.step === 'week' && daysBetween(landed.from, lastSettled) > 1) {
    return {
      after: landed.from,
      through: lastSettled,
      label: dateSpanText(shiftDay(landed.from, 1), lastSettled),
      nobody,
    };
  }
  return { after: shiftDay(lastSettled, -1), through: lastSettled, label: humanDate(lastSettled), nobody };
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
 * "Practice, day 16 of 174. Nov 5 games +$323,000. Next games Thu, Nov 6."
 * Once a night has a result, its sentence carries the date.
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
}: StatusSummaryInput): string {
  const parts: string[] = [];
  const named = lastNight !== null;
  const label = resultLabel ?? (lastSettledDate ? humanDate(lastSettledDate) : null);
  if (mode === 'practice') {
    const clock = progress
      ? (progress.complete ? 'season complete' : `day ${progress.day} of ${progress.total}`)
      : null;
    const date = lastSettledDate && !named ? `, ${humanDate(lastSettledDate)}` : '';
    parts.push(`Practice${date}${clock ? `, ${clock}` : ''}.`);
  } else if (!named) {
    parts.push(lastSettledDate ? `Games through ${humanDate(lastSettledDate)}.` : 'No games settled yet.');
  }
  if (named) {
    parts.push(noGames
      ? (nobody && label ? `${label}${noGamesWords(true)}.` : `${label ?? 'Latest games'}: ${nobody ? NOBODY_ON_ROSTER : NO_PLAYERS_PLAYED}.`)
      : `${label ? `${label} games` : 'Latest games'} ${exactSignedMoney(lastNight)}.`);
  }
  const next = nextGamesText(nextGameDate);
  const opener = mode === 'practice' && progress?.day === 0;
  // A finished season states its result; the way on is the Play another
  // season button beside or under this row (walk 3 T4-04).
  if (mode === 'practice' && progress?.complete) {
    parts.push(finalScore !== null ? `Final score ${exactSignedMoney(finalScore)}.` : `${PRACTICE_OVER_TEXT}.`);
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
 * "His net points each game · $40,000 for each net point", with the rate held
 * together so a narrow sheet breaks at the dot, never inside the rate.
 */
export function dividendText(basis: DividendBasis, dollarsPerNetPoint: number): string {
  return `${dividendBasisText(basis)} · ${keepTogether(`${formatMoney(dollarsPerNetPoint)} for each net point`)}`;
}

/**
 * Below this window height the frame folds, as App's SHORT_LAYOUT_MAX_HEIGHT
 * does: the brand bar hides, and the status row and practice bar become one
 * row (day, +1 night, +1 week, More, Settings) so the game keeps the screen.
 */
export const CHROME_SHORT_MAX_HEIGHT = 500;

export function chromeFolded(height: number): boolean {
  return height < CHROME_SHORT_MAX_HEIGHT;
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
  return width >= SHEET_FLOATING_MIN_WIDTH && !chromeFolded(height);
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
 * What a lock does not stop, after "Moves reopen after Oct 30", in plain
 * words rather than "lineups set" (walk 2 T1-07): only moves wait; the games
 * count. Not held together: at high zoom the row is narrower than either half.
 */
export const LOCK_REASON = 'your players still play';

/** "Moves reopen after Oct 30 · your players still play". */
export function lockLine(lockGameDate: string | null | undefined): string {
  return `${rosterReopensLine(lockGameDate)} · ${LOCK_REASON}`;
}

/**
 * The lock in a row too narrow for its sentence (a folded row at 200% zoom):
 * "Locked · Nov 1" beside the padlock, under the day count, so the row keeps
 * its words and Settings keeps its place on the first line (walk 3 T3-29).
 */
export function lockShortText(lockGameDate: string | null | undefined): string {
  return lockGameDate ? `Locked · ${keepTogether(humanDate(lockGameDate))}` : 'Locked';
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
 * The same line once the first player is in, until the next advance: the
 * line keeps its place, so nothing under the player's finger moves the
 * moment an Add lands (a second tap would otherwise hit the row below).
 */
export function readyHint(nextGameDate: string | null | undefined): string {
  return nextGameDate ? `Ready. +1 night plays the ${humanDate(nextGameDate)} games.` : "Ready. +1 night plays the next night's games.";
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
}: {
  complete: boolean;
  emptyRoster: boolean;
  playedWithoutRoster: boolean;
  justFilled: boolean;
  nextGameDate: string | null | undefined;
}): string | null {
  if (complete) return null;
  if (emptyRoster) return playedWithoutRoster ? EMPTY_ROSTER_PLAYING_HINT : EMPTY_ROSTER_HINT;
  return justFilled ? readyHint(nextGameDate) : null;
}

/**
 * The practice hint in a short form, for the rows with no line to spare: the
 * folded row (landscape, 200% zoom), beside or under the day count, and the
 * top of More at 400% zoom. The full hint vanished there, so the quiet
 * buttons looked disabled for no reason (walk 4 T1-09, T3-11). Each fits the
 * 129px a 195px row leaves beside Settings.
 */
export const EMPTY_ROSTER_HINT_SHORT = 'Add a player first';
export const EMPTY_ROSTER_PLAYING_HINT_SHORT = 'No players yet';
export const READY_HINT_SHORT = 'Ready for +1 night';

export function practiceHintShort(input: Parameters<typeof practiceHint>[0]): string | null {
  const full = practiceHint(input);
  if (full === null) return null;
  if (full === EMPTY_ROSTER_HINT) return EMPTY_ROSTER_HINT_SHORT;
  if (full === EMPTY_ROSTER_PLAYING_HINT) return EMPTY_ROSTER_PLAYING_HINT_SHORT;
  return READY_HINT_SHORT;
}

/**
 * From this width a row that stacks its advance labels (a phone at 200% zoom,
 * 195px) still names the night +1 night plays: "+1 NIGHT" over "OCT 21", with
 * the night button taking a larger share and "+1" over "WEEK" beside it.
 * Narrower rows keep "+1" over "NIGHT" (walk 4 T3-11).
 */
export const NIGHT_DATE_STACKED_MIN_WIDTH = 180;

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
export function queuedLine(pressed: 'night' | 'week', playing: string | null): string {
  return `Next ${pressed} queued. It plays ${playing ? `once ${playing} is in` : 'in a moment'}.`;
}

/**
 * The queued button's label, where sighted players see it (the queue lived
 * only in a hidden live region): "+1 week" over "queued", no wider than the
 * button's own label, so nothing beside it moves; "Next" over "queued" in a
 * stacked row (195px), where the button is 55px wide.
 */
export function queuedLabel(step: 'night' | 'week', stacked: boolean): string {
  return stacked ? 'Next\nqueued' : `+1 ${step}\nqueued`;
}

/**
 * Whether +1 night / +1 week asks before playing with nobody on the roster:
 * only until the player has once said "Play anyway" this season.
 */
export function asksBeforeEmptyNight(emptyRoster: boolean, playedWithoutRoster: boolean): boolean {
  return emptyRoster && !playedWithoutRoster;
}

/** How long a short stays open, in words. */
export function shortTermText(shortTermDays: number | null): string {
  if (shortTermDays === null) return 'A short stays open until you close it';
  return `A short runs ${shortTermDays} ${shortTermDays === 1 ? 'day' : 'days'}, then ends by itself with no fee`;
}
