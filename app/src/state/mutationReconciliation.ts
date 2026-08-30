import { MarketApiError } from '../api/client';

export {
  MutationReconciliationCoordinator,
  type ReconciliationReason,
  type RefreshAttempt,
} from './reconciliationCoordinator';

export function mutationOutcomeMayHaveCommitted(error: unknown): boolean {
  if (!(error instanceof MarketApiError)) return true;
  if (error.requestMayHaveCommitted) return true;
  if (['clock_unavailable', 'quote_unavailable'].includes(error.code)) return false;
  if (error.status === null || error.status >= 500) return true;
  return (
    error.code === 'invalid_response'
    && error.status >= 200
    && error.status < 300
  );
}

export class SnapshotGeneration {
  private current = 0;

  begin(): number {
    this.current += 1;
    return this.current;
  }

  isCurrent(generation: number): boolean {
    return generation === this.current;
  }
}

export async function stageMutationThenReconcile<TMutation, TSnapshot>({
  mutate,
  stage,
  reconcile,
}: {
  mutate: () => Promise<TMutation>;
  stage: (mutation: TMutation) => void;
  reconcile: () => Promise<TSnapshot>;
}): Promise<{ mutation: TMutation; snapshot: TSnapshot }> {
  const mutation = await mutate();
  stage(mutation);
  const snapshot = await reconcile();
  return { mutation, snapshot };
}
