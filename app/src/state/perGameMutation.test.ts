import assert from 'node:assert/strict';
import test from 'node:test';
import { PerGameApiError } from '../api/perGameClient';
import { runPerGameMutation } from './perGameMutation';
import { ActionLock } from './actionLock';
import { MutationReconciliationCoordinator } from './reconciliationCoordinator';

test('mutation acknowledgement precedes refresh and a failed refresh keeps actions locked', async () => {
  const order: string[] = [];
  const lock = new ActionLock();
  const coordinator = new MutationReconciliationCoordinator(lock);
  assert.equal(coordinator.beginMutation(), true);
  const outcome = await runPerGameMutation({
    action: async () => ({ accountVersion: 12 }),
    acknowledge: (version) => order.push(`ack:${version}`),
    refresh: async () => { order.push('refresh'); return false; },
  });
  coordinator.finishMutation(outcome.reconciliationReason);
  assert.deepEqual(order, ['ack:12', 'refresh']);
  assert.equal(coordinator.beginMutation(), false);
  assert.equal(outcome.reconciliationReason, 'confirmed-global');
  const attempt = coordinator.beginRefresh()!;
  coordinator.finishRefresh(attempt, true);
  assert.equal(coordinator.beginMutation(), true);
});

test('known version, roster and position rejections refresh once without replaying intent', async () => {
  const cases = [
    [409, 'stale_account_version'], [409, 'quote_conflict'], [409, 'position_exists'],
    [409, 'opposing_position'], [409, 'roster_full'], [409, 'position_closed'], [423, 'roster_locked'],
  ] as const;
  for (const [status, code] of cases) {
    let calls = 0;
    let refreshes = 0;
    const error = new PerGameApiError('Review updated market', code, status);
    const outcome = await runPerGameMutation({
      action: async () => { calls++; throw error; },
      acknowledge: () => assert.fail('rejection cannot be acknowledged'),
      refresh: async () => { refreshes++; return true; },
    });
    assert.equal(calls, 1);
    assert.equal(refreshes, 1);
    assert.equal(outcome.error, error);
    assert.equal(outcome.reconciliationReason, null);
    assert.equal(outcome.refreshed, true);
  }
});

test('failed refresh after a confirmed conflict preserves a reconcile lock', async () => {
  const outcome = await runPerGameMutation({
    action: async () => { throw new PerGameApiError('Stale quote', 'quote_conflict', 409); },
    acknowledge: () => assert.fail(),
    refresh: async () => false,
  });
  assert.equal(outcome.reconciliationReason, 'conflict');
});

test('ambiguous and unrelated rejections retain existing recovery semantics', async () => {
  for (const error of [new PerGameApiError('Timeout', 'timeout', null, true), new Error('Transport')]) {
    const outcome = await runPerGameMutation({ action: async () => { throw error; }, acknowledge: () => assert.fail(), refresh: async () => assert.fail('ambiguous intent needs explicit reconciliation') });
    assert.equal(outcome.reconciliationReason, 'ambiguous');
  }
  const outcome = await runPerGameMutation({ action: async () => { throw new PerGameApiError('Sign in', 'unauthorized', 401); }, acknowledge: () => assert.fail(), refresh: async () => assert.fail() });
  assert.equal(outcome.reconciliationReason, null);
});
