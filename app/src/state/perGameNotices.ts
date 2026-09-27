import type { PerGameBootstrap, PerGamePosition } from '../api/contracts';
import { humanDate, humanDay, humanNightsSince, moneyFine, signedMoneyFine } from '../copy/terms';
import { earningsBetween } from '../data/perGameMetrics';

/** Shorts that were open before this refresh and have now run their term. */
function endedShorts(previous: PerGameBootstrap | null, next: PerGameBootstrap): PerGamePosition[] {
  if (!previous) return [];
  const wasOpen = new Set(
    previous.positions
      .filter((position) => position.side === 'short' && position.status === 'active')
      .map((position) => position.positionId),
  );
  return next.positions.filter((position) => (
    position.side === 'short' && position.status === 'closed' && wasOpen.has(position.positionId)
  ));
}

/** "Towns" from "Karl-Anthony Towns", "Jackson" from "Jaren Jackson Jr.". */
function surname(name: string): string {
  const words = name.trim().split(/\s+/);
  const last = words.length > 1 && /^(jr\.?|sr\.?|ii|iii|iv)$/i.test(words[words.length - 1])
    ? words[words.length - 2]
    : words[words.length - 1];
  return last ?? name;
}

function endedSentence(ended: PerGamePosition[]): string {
  if (ended.length === 0) return '';
  // Short, so a week's notice stays about two lines in a phone's brand bar
  // (walk 6 T1-16, walk 7 T3-18: four lines pushed the page down); the
  // Closed list keeps the detail. A signed figure after a colon reads as a
  // result either way, never "made -$15.5K" (walk 3 T1-10). Each figure is
  // the short's whole run, said so, and two are told apart by name: one
  // total beside the week's change read as a second answer to "what did
  // this week do?" (walk 9 T2-08).
  if (ended.length === 1) {
    return ` ${ended[0].playerName}'s short ended after 7 days: ${signedMoneyFine(ended[0].cumulativePnl)} in all.`;
  }
  if (ended.length === 2) {
    const [first, second] = ended;
    return ` 2 shorts ended after 7 days: ${surname(first.playerName)} ${signedMoneyFine(first.cumulativePnl)}, ${surname(second.playerName)} ${signedMoneyFine(second.cumulativePnl)}.`;
  }
  const total = ended.reduce((sum, position) => sum + position.cumulativePnl, 0);
  return ` ${ended.length} shorts ended after 7 days: ${signedMoneyFine(total)} in all.`;
}

/** A roster lock that begins with these games, in one sentence. */
function lockSentence(previous: PerGameBootstrap | null, next: PerGameBootstrap): string {
  const locked = next.ruleset?.rosterMutationsLocked === true;
  const wasLocked = previous?.ruleset?.rosterMutationsLocked === true;
  if (!locked || wasLocked) return '';
  const date = next.ruleset.rosterLockGameDate;
  return date
    ? ` Moves pause for the ${humanDate(date)} games.`
    : ' Moves pause for the next games.';
}

/** Your place on the board, by your own score. */
function standing(next: PerGameBootstrap): string {
  const board = next.leaderboard ?? [];
  if (board.length === 0) return '';
  const score = next.account.cumulativePnl;
  const others = board.filter((row) => !row.isCurrentUser);
  const rank = 1 + others.filter((row) => row.cumulativePnl > score).length;
  // "#2 of 5" never splits across lines (walk 6 T1-10).
  return `, #${rank}\u00a0of\u00a0${others.length + 1}`;
}

/**
 * Whether a refresh brought anything the player would want to hear about:
 * new games, a changed score, or a short that ran its term. Refreshes the app
 * runs on its own stay quiet otherwise.
 */
export function refreshHasNews(previous: PerGameBootstrap | null, next: PerGameBootstrap): boolean {
  if (!previous) return true;
  return next.game.lastSettledDate !== previous.game.lastSettledDate
    || next.account.cumulativePnl !== previous.account.cumulativePnl
    || endedShorts(previous, next).length > 0;
}

/**
 * The notice after a refresh says what changed for the player, not what the
 * app did. When games settled it leads with what your players made over
 * exactly those days, games only, which is the score change the refresh
 * brought (fees came off the score when each move was made). So it equals
 * "Last night" after +1 night and "Last 7 days" after +1 week, to the dollar.
 * Any short that ran its term is named. A score that moved without new games
 * (a corrected result) is reported as such; otherwise the notice confirms the
 * account is current. The next game date already sits in the status bar, so it
 * is only repeated when there is nothing else to say.
 */
/**
 * A games notice with its news first, for a strip too narrow to reach it in
 * two lines: "Oct 21–Nov 17 games (4 weeks): your score rose $1.20M." showed
 * only "Oct 21–Nov 17 / games" and "more ▾" at 195px (walk 14 T4-07); it
 * reads "Your score rose $1.20M in the Oct 21–Nov 17 games (4 weeks)." Any
 * sentence after it is kept; other notices are left as they are. Screen
 * readers hear the notice as written.
 */
export function outcomeFirst(message: string): string {
  // The games are a date span ("Oct 21", "Oct 21–27", "Oct 21–Nov 17"), never
  // any words before "games": "Season complete. Final score … Oct 21–Apr 12
  // games: …" became "Your score rose $4.95M in the Season complete. …" on a
  // phone (walk 17 T1-08).
  const match = /^([A-Z][a-z]{2} \d{1,2}(?:–(?:[A-Z][a-z]{2} )?\d{1,2})? games(?: \([^)]*\))?): your score (rose|fell) (\$[\d,]+(?:\.\d+)?[KM]?)\.(\s[\s\S]*)?$/.exec(message);
  if (!match) return message;
  const [, span, verb, amount, rest = ''] = match;
  return `Your score ${verb} ${amount} in the ${span}.${rest}`;
}

/** A sentence saying a move the player pressed did not happen. */
const REFUSED_MOVE = /\bnot (added|dropped|shorted|closed)\b/;

/**
 * A notice for a bar or strip narrower than a desktop's, which shows two
 * lines (one at 400% zoom) before "more ▾": its news first. Moves that did
 * not happen lead (walk 16 T4-09: "…your score rose $205K. Devin" hid three
 * refused adds), then the games' result with its figure first (T4-02: "(3
 * weeks): your score fell" hid the $529K). Everything else keeps its order.
 * Screen readers and Recent notices keep the notice as written.
 */
export function newsFirst(message: string): string {
  const sentences = message.replace(/([.!?])\s+(?=[A-Z])/g, '$1\u0000').split('\u0000');
  const refused = sentences.filter((sentence) => REFUSED_MOVE.test(sentence));
  if (refused.length === 0) return outcomeFirst(message);
  const [head = '', ...tail] = sentences.filter((sentence) => !REFUSED_MOVE.test(sentence));
  return [...refused, outcomeFirst(head), ...tail].filter(Boolean).join(' ');
}

/** The practice season's months, in playing order, for comparing game spans. */
const SEASON_MONTHS = ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
const GAMES_SPAN = /^([A-Z][a-z]{2}) (\d{1,2})(?:–(?:([A-Z][a-z]{2}) )?(\d{1,2}))? games\b/;

/** A games notice's first and last day, as season-ordered numbers, or null. */
function gamesSpan(text: string): { start: number; end: number } | null {
  const match = GAMES_SPAN.exec(text);
  if (!match) return null;
  const [, startMonth, startDay, endMonth = startMonth, endDay = startDay] = match;
  const day = (month: string, date: string) => SEASON_MONTHS.indexOf(month) * 100 + Number(date);
  return { start: day(startMonth, startDay), end: day(endMonth, endDay) };
}

/**
 * Whether a games notice reports a run that includes the earlier one's games
 * (same first night, reaching as far or further): "Oct 21–Nov 10 games (3
 * weeks)" covers "Oct 21–27 games". Recent notices keeps the run, not both
 * (walk 16 T4-11: a refusal in a run's first week left that week's notice
 * beside the run's, the refusal said twice).
 */
export function coversGames(later: string, earlier: string): boolean {
  const next = gamesSpan(later);
  const before = gamesSpan(earlier);
  return Boolean(next && before && next.start === before.start && next.end >= before.end && later !== earlier);
}

/** How the season's last games are announced; the Roster's result card says the same. */
export const SEASON_COMPLETE_NOTICE_START = 'Season complete. Final score ';

export function isSeasonCompleteNotice(message: string | null | undefined): boolean {
  return Boolean(message && message.startsWith(SEASON_COMPLETE_NOTICE_START));
}

export function refreshNotice(
  previous: PerGameBootstrap | null,
  next: PerGameBootstrap,
  reconciled: boolean,
  options: { seasonComplete?: (snapshot: PerGameBootstrap) => boolean } = {},
): string {
  if (reconciled) return 'Your account is back in sync. You can make roster moves again.';
  const complete = options.seasonComplete;
  if (complete && complete(next) && !(previous && complete(previous))) {
    return `${SEASON_COMPLETE_NOTICE_START}${signedMoneyFine(next.account.cumulativePnl)}${standing(next)}.`;
  }
  const before = previous?.game.lastSettledDate ?? null;
  const after = next.game.lastSettledDate;
  const ended = endedSentence(endedShorts(previous, next));
  if (after && after !== before) {
    const change = earningsBetween(next.ledger?.items, before, after, { gamesOnly: true });
    const span = before ? daysBetween(before, after) : 1;
    // Several nights at once (+1 week) name their days: "Nov 5–11 games". A
    // single game night names itself even when empty days came before it
    // (+1 night from Oct 25 plays the Oct 27 games: "Oct 27 games", as the
    // status row and the button say, not "Oct 26–27"; walk 5 T1-16).
    const oneNight = span <= 1 || previous?.game.nextGameDate === after;
    const when = `${oneNight ? humanDate(after) : humanNightsSince(before, after)} games`;
    const played = (next.ledger?.items ?? []).some((entry) => (
      entry.gameDate !== null && entry.gameDate <= after && (before === null || entry.gameDate > before)
    ));
    // Nobody on the roster or shorts through those nights (Play anyway): say
    // so, rather than suggesting players who sat out (walk 4 T2-16).
    const nobody = !(previous?.positions ?? next.positions).some((position) => position.status === 'active');
    const score = !played
      // The status row's own words, short enough that a run of nights keeps
      // to two lines in a phone's brand bar (walk 12 fix 12 note).
      ? (nobody ? 'nobody on your roster, so your score held.' : 'none of your players played.')
      : change === 0
        ? 'your players broke even.'
        : `your score ${change > 0 ? 'rose' : 'fell'} ${moneyFine(Math.abs(change))}.`;
    return `${when}: ${score}${ended}${lockSentence(previous, next)}`;
  }
  const change = next.account.cumulativePnl - (previous?.account.cumulativePnl ?? 0);
  if (previous && change !== 0) {
    return `Your score changed by ${signedMoneyFine(change)} since the last update.${ended}`;
  }
  return next.game.nextGameDate
    ? `You're up to date. Next games ${humanDay(next.game.nextGameDate)}.`
    : "You're up to date. The next games are not scheduled yet.";
}

function daysBetween(fromDay: string, toDay: string): number {
  const from = Date.parse(`${fromDay}T00:00:00Z`);
  const to = Date.parse(`${toDay}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}
