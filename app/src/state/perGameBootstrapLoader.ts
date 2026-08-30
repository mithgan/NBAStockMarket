import type { PerGameBootstrap } from '../api/contracts';
import {
  mergePerGameBootstrap,
  samePerGameBootstrapIdentity,
} from './perGameState';

interface PerGameBootstrapLoaderOptions {
  previous: PerGameBootstrap | null;
  incremental: boolean;
  fetchBootstrap: (afterCursor?: number) => Promise<PerGameBootstrap>;
  isCurrent: () => boolean;
}

export async function loadPerGameBootstrapSnapshot({
  previous,
  incremental,
  fetchBootstrap,
  isCurrent,
}: PerGameBootstrapLoaderOptions): Promise<PerGameBootstrap | null> {
  const useIncrementalCursor = incremental && previous !== null;
  const incoming = await fetchBootstrap(
    useIncrementalCursor ? previous.game.eventCursor : undefined,
  );
  if (!isCurrent()) return null;

  if (
    useIncrementalCursor
    && !samePerGameBootstrapIdentity(previous, incoming)
  ) {
    const fullSnapshot = await fetchBootstrap();
    return isCurrent() ? fullSnapshot : null;
  }

  return useIncrementalCursor
    ? mergePerGameBootstrap(previous, incoming)
    : incoming;
}
