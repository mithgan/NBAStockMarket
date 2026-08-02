import assert from 'node:assert/strict';
import test from 'node:test';

import { ActionLock } from './actionLock';

test('ActionLock blocks duplicate actions until the original releases', () => {
  const lock = new ActionLock();

  assert.equal(lock.acquire('trade:sga'), true);
  assert.equal(lock.acquire('trade:sga'), false);
  assert.equal(lock.acquire('trade:jokic'), true);
  assert.deepEqual([...lock.snapshot()].sort(), ['trade:jokic', 'trade:sga']);

  lock.release('trade:sga');
  assert.equal(lock.acquire('trade:sga'), true);
});
