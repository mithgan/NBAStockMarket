import type { PerGameBootstrap } from '../api/contracts';
import { humanDate, humanDay, money } from '../copy/terms';

/**
 * The notice after a refresh says what changed for the player, not what the
 * app did. When new games settled it reports them and the score change, which
 * is the news the player refreshed (or pressed +1 night) for; when nothing
 * settled it confirms the account is current. The next game date already sits
 * in the status bar, so it is only repeated when there is nothing else to say.
 */
export function refreshNotice(
  previous: PerGameBootstrap | null,
  next: PerGameBootstrap,
  reconciled: boolean,
): string {
  if (reconciled) return 'Your account is back in sync. You can make roster moves again.';
  const before = previous?.game.lastSettledDate ?? null;
  const after = next.game.lastSettledDate;
  if (after && after !== before) {
    const change = next.account.cumulativePnl - (previous?.account.cumulativePnl ?? 0);
    const score = change === 0
      ? 'Your score is unchanged.'
      : `Your score ${change > 0 ? 'rose' : 'fell'} ${money(Math.abs(change))}.`;
    return `Games through ${humanDate(after)} are in. ${score}`;
  }
  return next.game.nextGameDate
    ? `You're up to date. Next games ${humanDay(next.game.nextGameDate)}.`
    : "You're up to date. The next games are not scheduled yet.";
}
