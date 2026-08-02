import assert from 'node:assert/strict';
import test from 'node:test';

import { MarketApiError } from '../api/client';
import { ActionLock } from './actionLock';
import {
  MutationReconciliationCoordinator,
  SnapshotGeneration,
  mutationOutcomeMayHaveCommitted,
  stageMutationThenReconcile,
} from './mutationReconciliation';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

test('mutation state stages before bootstrap reconciliation completes', async () => {
  const reconciliation = deferred<string>();
  const events: string[] = [];
  const running = stageMutationThenReconcile({
    mutate: async () => {
      events.push('mutation');
      return { cash: 80 };
    },
    stage: (mutation) => {
      events.push(`stage:${mutation.cash}`);
    },
    reconcile: async () => {
      events.push('reconcile');
      return reconciliation.promise;
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(events, ['mutation', 'stage:80', 'reconcile']);

  reconciliation.resolve('fresh bootstrap');
  assert.deepEqual(await running, {
    mutation: { cash: 80 },
    snapshot: 'fresh bootstrap',
  });
});

test('successful reconciliation releases the global mutation gate', () => {
  const lock = new ActionLock();
  const coordinator = new MutationReconciliationCoordinator(lock);

  assert.equal(coordinator.beginMutation(), true);
  assert.equal(lock.acquire('trade:sga'), true);
  assert.deepEqual(
    [...lock.snapshot()].sort(),
    ['account-mutation', 'trade:sga'],
  );

  lock.release('trade:sga');
  coordinator.finishMutation(null);
  assert.deepEqual([...lock.snapshot()], []);
  assert.equal(coordinator.beginMutation(), true);
});

test('failed reconciliation keeps mutations gated until a successful manual retry', () => {
  const lock = new ActionLock();
  const coordinator = new MutationReconciliationCoordinator(lock);

  assert.equal(coordinator.beginMutation(), true);
  assert.equal(lock.acquire('trade:sga'), true);
  lock.release('trade:sga');
  coordinator.finishMutation('confirmed-staged');
  assert.equal(coordinator.requiresReconciliation, true);
  assert.deepEqual([...lock.snapshot()], ['account-mutation']);
  assert.equal(coordinator.beginMutation(), false);

  const failedRetry = coordinator.beginRefresh();
  assert.deepEqual(failedRetry, { reconciliationReason: 'confirmed-staged' });
  coordinator.finishRefresh(failedRetry!, false);
  assert.equal(coordinator.requiresReconciliation, true);
  assert.deepEqual([...lock.snapshot()], ['account-mutation']);

  const successfulRetry = coordinator.beginRefresh();
  assert.deepEqual(successfulRetry, { reconciliationReason: 'confirmed-staged' });
  coordinator.finishRefresh(successfulRetry!, true);
  assert.equal(coordinator.requiresReconciliation, false);
  assert.deepEqual([...lock.snapshot()], []);
  assert.equal(coordinator.beginMutation(), true);
});

test('ordinary refresh and mutation gates exclude each other in both directions', () => {
  const lock = new ActionLock();
  const coordinator = new MutationReconciliationCoordinator(lock);

  assert.equal(coordinator.beginMutation(), true);
  assert.equal(lock.has('account-mutation'), true);
  assert.equal(coordinator.beginRefresh(), null);
  assert.equal(lock.has('account-refresh'), false);
  coordinator.finishMutation(null);

  const refresh = coordinator.beginRefresh();
  assert.deepEqual(refresh, { reconciliationReason: null });
  assert.equal(lock.has('account-refresh'), true);
  const beforeBlockedMutation = lock.snapshot();
  assert.equal(coordinator.beginMutation(), false);
  assert.deepEqual(lock.snapshot(), beforeBlockedMutation);
  coordinator.finishRefresh(refresh!, true);
  assert.deepEqual([...lock.snapshot()], []);
});

test('ambiguous mutation failures retain the reconciliation gate', () => {
  const ambiguous = [
    new MarketApiError('timeout', 'timeout', null),
    new MarketApiError('bad success body', 'invalid_response', 200),
    new MarketApiError('server error', 'request_failed', 503),
    new MarketApiError('account changed after retry', 'account_changed', 401, true),
    new Error('unknown client failure'),
  ];
  for (const error of ambiguous) {
    const lock = new ActionLock();
    const coordinator = new MutationReconciliationCoordinator(lock);
    assert.equal(coordinator.beginMutation(), true);
    coordinator.finishMutation(
      mutationOutcomeMayHaveCommitted(error) ? 'ambiguous' : null,
    );
    assert.equal(coordinator.requiresReconciliation, true);
    assert.deepEqual([...lock.snapshot()], ['account-mutation']);
    const failedRefresh = coordinator.beginRefresh();
    assert.deepEqual(failedRefresh, { reconciliationReason: 'ambiguous' });
    coordinator.finishRefresh(failedRefresh!, false);
    const successfulRefresh = coordinator.beginRefresh();
    assert.deepEqual(successfulRefresh, { reconciliationReason: 'ambiguous' });
    coordinator.finishRefresh(successfulRefresh!, true);
    assert.equal(coordinator.requiresReconciliation, false);
  }

  assert.equal(
    mutationOutcomeMayHaveCommitted(
      new MarketApiError('quote changed', 'quote_conflict', 409),
    ),
    false,
  );
  assert.equal(
    mutationOutcomeMayHaveCommitted(
      new MarketApiError('initial account mismatch', 'account_changed', 401),
    ),
    false,
  );
  assert.equal(
    mutationOutcomeMayHaveCommitted(
      new MarketApiError('missing quote', 'quote_unavailable', null),
    ),
    false,
  );
});

test('an older bootstrap generation cannot replace a newer response', () => {
  const generations = new SnapshotGeneration();
  const older = generations.begin();
  const newer = generations.begin();

  assert.equal(generations.isCurrent(older), false);
  assert.equal(generations.isCurrent(newer), true);
});
