import type { PerGameBootstrap, PerGamePosition } from '../api/contracts';
import { humanDate, humanDay, money, signedMoney } from '../copy/terms';

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
 * app did. When new games settled it reports them and the score change, which
 * is the news the player refreshed (or pressed +1 night) for, plus any short
 * that ended; a score that moved without new games (a corrected result) is
 * reported as such; otherwise it confirms the account is current. The next
 * game date already sits in the status bar, so it is only repeated when there
 * is nothing else to say.
 */
export function refreshNotice(
  previous: PerGameBootstrap | null,
  next: PerGameBootstrap,
  reconciled: boolean,
): string {
  if (reconciled) return 'Your account is back in sync. You can make roster moves again.';
  const before = previous?.game.lastSettledDate ?? null;
  const after = next.game.lastSettledDate;
  const change = next.account.cumulativePnl - (previous?.account.cumulativePnl ?? 0);
  const ended = endedSentence(endedShorts(previous, next));
  if (after && after !== before) {
    const score = change === 0
      ? 'Your score is unchanged.'
      : `Your score ${change > 0 ? 'rose' : 'fell'} ${money(Math.abs(change))}.`;
    return `Games through ${humanDate(after)} are in. ${score}${ended}`;
  }
  if (previous && change !== 0) {
    return `Your score changed by ${signedMoney(change)} since the last update.${ended}`;
  }
  return next.game.nextGameDate
    ? `You're up to date. Next games ${humanDay(next.game.nextGameDate)}.`
    : "You're up to date. The next games are not scheduled yet.";
}
