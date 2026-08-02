import assert from 'node:assert/strict';
import test from 'node:test';

import { GAME_STORAGE_KEY, type StorageAdapter } from './persistence';
import {
  finalizeLocalTransition,
  inspectLocalTransition,
  shouldInspectLocalTransition,
  transitionMarkerKey,
} from './localTransition';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const operations: string[] = [];
  const storage: StorageAdapter = {
    async getItem(key) {
      operations.push(`get:${key}`);
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      operations.push(`set:${key}:${value}`);
      values.set(key, value);
    },
    async removeItem(key) {
      operations.push(`remove:${key}`);
      values.delete(key);
    },
  };
  return { operations, storage, values };
}

test('inspectLocalTransition detects a legacy save without reading its contents', async () => {
  const fixture = memoryStorage({ [GAME_STORAGE_KEY]: '{not-valid-json' });

  const result = await inspectLocalTransition(fixture.storage, 'user:one');

  assert.deepEqual(result, {
    legacySavePresent: true,
    transitionComplete: false,
    error: null,
  });
  assert.deepEqual(fixture.operations, [
    `get:${transitionMarkerKey('user:one')}`,
    `get:${GAME_STORAGE_KEY}`,
  ]);
});

test('transition inspection remains required after an initial server failure', () => {
  assert.equal(shouldInspectLocalTransition(false, false), true);
  assert.equal(shouldInspectLocalTransition(true, true), true);
  assert.equal(shouldInspectLocalTransition(true, false), false);
});

test('a user-scoped marker suppresses another legacy-save prompt', async () => {
  const key = transitionMarkerKey('user/a');
  const fixture = memoryStorage({ [key]: 'complete', [GAME_STORAGE_KEY]: 'legacy' });

  const result = await inspectLocalTransition(fixture.storage, 'user/a');

  assert.equal(result.transitionComplete, true);
  assert.equal(result.legacySavePresent, false);
  assert.deepEqual(fixture.operations, [`get:${key}`]);
  assert.notEqual(transitionMarkerKey('user/a'), transitionMarkerKey('user/b'));
});

test('finalizeLocalTransition clears the legacy save before writing the marker', async () => {
  const fixture = memoryStorage({ [GAME_STORAGE_KEY]: 'legacy' });

  const result = await finalizeLocalTransition(fixture.storage, 'alice');

  assert.deepEqual(result, { complete: true, error: null });
  assert.deepEqual(fixture.operations, [
    `remove:${GAME_STORAGE_KEY}`,
    `set:${transitionMarkerKey('alice')}:complete`,
  ]);
  assert.equal(fixture.values.has(GAME_STORAGE_KEY), false);
  assert.equal(fixture.values.get(transitionMarkerKey('alice')), 'complete');
});

test('a failed legacy clear leaves the marker absent and the save retryable', async () => {
  const fixture = memoryStorage({ [GAME_STORAGE_KEY]: 'legacy' });
  fixture.storage.removeItem = async (key) => {
    fixture.operations.push(`remove:${key}`);
    throw new Error('disk full');
  };

  const result = await finalizeLocalTransition(fixture.storage, 'alice');

  assert.equal(result.complete, false);
  assert.match(result.error ?? '', /could not be cleared/i);
  assert.equal(fixture.values.get(GAME_STORAGE_KEY), 'legacy');
  assert.equal(fixture.values.has(transitionMarkerKey('alice')), false);
  assert.deepEqual(fixture.operations, [`remove:${GAME_STORAGE_KEY}`]);
});

test('a storage read failure blocks transition instead of guessing', async () => {
  const fixture = memoryStorage();
  fixture.storage.getItem = async () => {
    throw new Error('unavailable');
  };

  const result = await inspectLocalTransition(fixture.storage, 'alice');

  assert.equal(result.transitionComplete, false);
  assert.equal(result.legacySavePresent, false);
  assert.match(result.error ?? '', /could not be checked/i);
});
