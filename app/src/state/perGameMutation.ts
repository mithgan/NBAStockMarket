import { PerGameApiError, perGameMutationOutcomeMayHaveCommitted } from '../api/perGameClient';
import type { ReconciliationReason } from './reconciliationCoordinator';

interface MutationOutcome<T> {
  result: T | null;
  error: unknown | null;
  refreshed: boolean;
  reconciliationReason: ReconciliationReason | null;
}

export async function runPerGameMutation<T extends { accountVersion: number }>({
  action,
  acknowledge,
  refresh,
}: {
  action: () => Promise<T>;
  acknowledge: (accountVersion: number) => void;
  refresh: () => Promise<boolean>;
}): Promise<MutationOutcome<T>> {
  try {
    const result = await action();
    acknowledge(result.accountVersion);
    const refreshed = await refresh().catch(() => false);
    return {
      result,
      error: null,
      refreshed,
      reconciliationReason: refreshed ? null : 'confirmed-global',
    };
  } catch (error) {
    if (perGameMutationOutcomeMayHaveCommitted(error)) {
      return { result: null, error, refreshed: false, reconciliationReason: 'ambiguous' };
    }
    const conflict = error instanceof PerGameApiError && (
      (error.status === 423 && error.code === 'roster_locked')
      || (error.status === 409 && [
        'stale_account_version', 'quote_conflict', 'position_exists',
        'opposing_position', 'roster_full', 'position_closed',
      ].includes(error.code))
    );
    const refreshed = conflict ? await refresh().catch(() => false) : false;
    return {
      result: null,
      error,
      refreshed,
      reconciliationReason: conflict && !refreshed ? 'conflict' : null,
    };
  }
}
