import type { PerGameBootstrap } from '../api/contracts';
import {
  mergePerGameBootstrap,
  samePerGameBootstrapIdentity,
} from './perGameState';

interface PerGameBootstrapLoaderOptions {
  previous: PerGameBootstrap | null;
  incremental: boolean;
  minimumSnapshot?: PerGameBootstrap | null;
  fetchBootstrap: (afterCursor?: number) => Promise<PerGameBootstrap>;
  isCurrent: () => boolean;
}

export async function loadPerGameBootstrapSnapshot({
  previous,
  incremental,
  minimumSnapshot = null,
  fetchBootstrap,
  isCurrent,
}: PerGameBootstrapLoaderOptions): Promise<PerGameBootstrap | null> {
  const useIncrementalCursor = incremental && previous !== null;
  const incoming = await fetchBootstrap(
    useIncrementalCursor ? previous.game.eventCursor : undefined,
  );
  if (!isCurrent()) return null;

  let next: PerGameBootstrap | null;
  if (
    useIncrementalCursor
    && !samePerGameBootstrapIdentity(previous, incoming)
  ) {
    next = await fetchBootstrap();
    if (!isCurrent()) return null;
  } else {
    next = useIncrementalCursor
      ? mergePerGameBootstrap(previous, incoming)
      : incoming;
  }
  if (
    next && previous
    && samePerGameBootstrapIdentity(previous, next)
    && (next.account.version < previous.account.version
      || next.game.eventCursor < previous.game.eventCursor)
  ) return null;
  if (
    next && minimumSnapshot
    && samePerGameBootstrapIdentity(minimumSnapshot, next)
    && next.account.version < minimumSnapshot.account.version
  ) return null;
  return next;
}
