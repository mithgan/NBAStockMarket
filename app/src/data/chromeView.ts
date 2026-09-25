/**
 * The chrome above every screen: the status row and the practice bar.
 *
 * These are the pure parts — the practice clock, the layout decision and the
 * words — so they can be unit tested and so both bars agree on them. The bars
 * themselves live in components/PerGameStatusStrip.tsx and components/SimBar.tsx.
 */
import type { DividendBasis } from '../api/contracts';
import { exactSignedMoney, humanDate, humanDay, signedMoneyFine } from '../copy/terms';
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

/** What the status row says in place of the next games once practice is over. */
export const PRACTICE_OVER_TEXT = 'Restart to play again';

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
  /** Practice only. */
  progress?: PracticeProgress;
  /** A sentence about the roster lock, when it is on. */
  lockSentence?: string | null;
}

/**
 * The status row as one sentence for screen readers, e.g.
 * "Practice, Nov 5, day 16 of 174. Last night +$323,000. Next games Thu, Nov 6."
 */
export function statusSummary({
  mode,
  lastSettledDate,
  nextGameDate,
  lastNight,
  progress,
  lockSentence,
}: StatusSummaryInput): string {
  const parts: string[] = [];
  if (mode === 'practice') {
    const clock = progress
      ? (progress.complete ? 'season complete' : `day ${progress.day} of ${progress.total}`)
      : null;
    parts.push(`Practice${lastSettledDate ? `, ${humanDate(lastSettledDate)}` : ''}${clock ? `, ${clock}` : ''}.`);
  } else {
    parts.push(lastSettledDate ? `Games through ${humanDate(lastSettledDate)}.` : 'No games settled yet.');
  }
  if (lastNight !== null) parts.push(`Last night ${exactSignedMoney(lastNight)}.`);
  const next = nextGamesText(nextGameDate);
  const opener = mode === 'practice' && progress?.day === 0;
  if (mode === 'practice' && progress?.complete) parts.push(`${PRACTICE_OVER_TEXT}.`);
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
  return basis === 'raw_net_points' ? 'Net points scored' : 'Net points above projection';
}

/**
 * "Net points scored · $40,000 per net point", with the rate held together so
 * a narrow sheet breaks at the dot, never inside "per net point".
 */
export function dividendText(basis: DividendBasis, dollarsPerNetPoint: number): string {
  return `${dividendBasisText(basis)} · ${keepTogether(`${formatMoney(dollarsPerNetPoint)} per net point`)}`;
}

/** How long a short stays open, in words. */
export function shortTermText(shortTermDays: number | null): string {
  if (shortTermDays === null) return 'A short stays open until you close it';
  return `A short closes after ${shortTermDays} ${shortTermDays === 1 ? 'day' : 'days'}`;
}
