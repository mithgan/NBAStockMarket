import { MarketApiError } from '../api/client';
import { ActionLock } from './actionLock';

const ACCOUNT_MUTATION = 'account-mutation';
const ACCOUNT_REFRESH = 'account-refresh';

export type ReconciliationReason =
  | 'confirmed-staged'
  | 'confirmed-global'
  | 'ambiguous';

export interface RefreshAttempt {
  reconciliationReason: ReconciliationReason | null;
}

export class MutationReconciliationCoordinator {
  private recoveryReason: ReconciliationReason | null = null;

  constructor(private readonly actionLock: ActionLock) {}

  get requiresReconciliation(): boolean {
    return this.recoveryReason !== null;
  }

  beginMutation(
    acquireMutation = () => this.actionLock.acquire(ACCOUNT_MUTATION),
  ): boolean {
    if (
      this.recoveryReason !== null
      || this.actionLock.has(ACCOUNT_REFRESH)
      || !acquireMutation()
    ) {
      return false;
    }
    return true;
  }

  finishMutation(reconciliationReason: ReconciliationReason | null): void {
    if (reconciliationReason) {
      this.recoveryReason = reconciliationReason;
      return;
    }
    this.actionLock.release(ACCOUNT_MUTATION);
  }

  beginRefresh(
    acquireRefresh = () => this.actionLock.acquire(ACCOUNT_REFRESH),
    acquireMutation = () => this.actionLock.acquire(ACCOUNT_MUTATION),
  ): RefreshAttempt | null {
    const reconciliationReason = this.recoveryReason;
    if (this.actionLock.has(ACCOUNT_MUTATION) && !reconciliationReason) return null;
    if (!acquireRefresh()) return null;
    if (
      !reconciliationReason
      && !acquireMutation()
    ) {
      this.actionLock.release(ACCOUNT_REFRESH);
      return null;
    }
    return { reconciliationReason };
  }

  finishRefresh(attempt: RefreshAttempt, succeeded: boolean): void {
    this.actionLock.release(ACCOUNT_REFRESH);
    if (attempt.reconciliationReason) {
      if (succeeded) {
        this.recoveryReason = null;
        this.actionLock.release(ACCOUNT_MUTATION);
      }
      return;
    }
    this.actionLock.release(ACCOUNT_MUTATION);
  }
}

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
