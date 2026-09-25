import type { PerGameBootstrap, PerGamePosition } from '../api/contracts';
import { humanDate, humanDay, money, signedMoney } from '../copy/terms';
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

function endedSentence(ended: PerGamePosition[]): string {
  if (ended.length === 0) return '';
  if (ended.length === 1) {
    return ` Your short on ${ended[0].playerName} ended: ${signedMoney(ended[0].cumulativePnl)}.`;
  }
  const total = ended.reduce((sum, position) => sum + position.cumulativePnl, 0);
  return ` ${ended.length} shorts ended: ${signedMoney(total)} in all.`;
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
 * app did. The money comes first and is read from the ledger over exactly the
 * nights that just settled, so it matches "Last night" after +1 night and
 * "Last 7 nights" after +1 week to the dollar (fees booked on those days
 * included). Any short that ran its term is named. A score that moved without
 * new games (a corrected result) is reported as such; otherwise the notice
 * confirms the account is current. The next game date already sits in the
 * status bar, so it is only repeated when there is nothing else to say.
 */
export function refreshNotice(
  previous: PerGameBootstrap | null,
  next: PerGameBootstrap,
  reconciled: boolean,
): string {
  if (reconciled) return 'Your account is back in sync. You can make roster moves again.';
  const before = previous?.game.lastSettledDate ?? null;
  const after = next.game.lastSettledDate;
  const ended = endedSentence(endedShorts(previous, next));
  if (after && after !== before) {
    const change = earningsBetween(next.ledger?.items, before, after);
    const nights = new Set(
      (next.ledger?.items ?? [])
        .filter((entry) => entry.gameDate && entry.gameDate <= after && (before === null || entry.gameDate > before))
        .map((entry) => entry.gameDate),
    ).size;
    const when = nights > 1 ? `${nights} nights through ${humanDate(after)}` : humanDate(after);
    const score = change === 0
      ? 'no change to your score.'
      : `your score ${change > 0 ? 'rose' : 'fell'} ${money(Math.abs(change))}.`;
    return `${when}: ${score}${ended}`;
  }
  const change = next.account.cumulativePnl - (previous?.account.cumulativePnl ?? 0);
  if (previous && change !== 0) {
    return `Your score changed by ${signedMoney(change)} since the last update.${ended}`;
  }
  return next.game.nextGameDate
    ? `You're up to date. Next games ${humanDay(next.game.nextGameDate)}.`
    : "You're up to date. The next games are not scheduled yet.";
}
