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
export function refreshNotice(
  previous: PerGameBootstrap | null,
  next: PerGameBootstrap,
  reconciled: boolean,
  options: { seasonComplete?: (snapshot: PerGameBootstrap) => boolean } = {},
): string {
  if (reconciled) return 'Your account is back in sync. You can make roster moves again.';
  const complete = options.seasonComplete;
  if (complete && complete(next) && !(previous && complete(previous))) {
    return `Season complete. Final score ${signedMoneyFine(next.account.cumulativePnl)}${standing(next)}.`;
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
      ? (nobody ? 'nobody was on your roster, so your score did not move.' : 'none of your players played.')
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
