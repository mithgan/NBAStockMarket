import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GAME_STORAGE_KEY,
  clearPersistedGame,
  enqueuePersistedReset,
  loadPersistedGame,
  persistenceErrorAfterSave,
  resetPersistedGame,
  savePersistedGame,
  type StorageAdapter,
} from './persistence';

interface TestState {
  cash: number;
  settledDates: string[];
}

function isTestState(value: unknown): value is TestState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TestState>;
  return (
    typeof candidate.cash === 'number'
    && Number.isFinite(candidate.cash)
    && Array.isArray(candidate.settledDates)
    && candidate.settledDates.every((date) => typeof date === 'string')
  );
}

class MemoryStorage implements StorageAdapter {
  values = new Map<string, string>();
  readError: Error | null = null;
  writeError: Error | null = null;
  removeError: Error | null = null;

  async getItem(key: string) {
    if (this.readError) throw this.readError;
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string) {
    if (this.writeError) throw this.writeError;
    this.values.set(key, value);
  }

  async removeItem(key: string) {
    if (this.removeError) throw this.removeError;
    this.values.delete(key);
  }
}

test('a saved game round-trips through the versioned envelope', async () => {
  const storage = new MemoryStorage();
  const state: TestState = { cash: 123_000_000, settledDates: ['2025-10-21'] };

  assert.deepEqual(await savePersistedGame(storage, state), { error: null });
  assert.deepEqual(await loadPersistedGame(storage, isTestState), {
    state,
    error: null,
    canAutosave: true,
  });
  assert.match(storage.values.get(GAME_STORAGE_KEY) ?? '', /"version":1/);
});

test('missing storage starts clean without a warning', async () => {
  const result = await loadPersistedGame(new MemoryStorage(), isTestState);
  assert.deepEqual(result, { state: null, error: null, canAutosave: true });
});

test('malformed JSON and wrong versions fail safe', async () => {
  const malformed = new MemoryStorage();
  malformed.values.set(GAME_STORAGE_KEY, '{not-json');
  assert.deepEqual(await loadPersistedGame(malformed, isTestState), {
    state: null,
    error: 'Saved progress was invalid, so a new game was started.',
    canAutosave: true,
  });

  const stale = new MemoryStorage();
  stale.values.set(GAME_STORAGE_KEY, JSON.stringify({
    version: 99,
    state: { cash: 123, settledDates: [] },
  }));
  assert.deepEqual(await loadPersistedGame(stale, isTestState), {
    state: null,
    error: 'Saved progress was from an unsupported version, so a new game was started.',
    canAutosave: true,
  });
});

test('invalid state payloads never reach the app', async () => {
  const storage = new MemoryStorage();
  storage.values.set(GAME_STORAGE_KEY, JSON.stringify({
    version: 1,
    state: { cash: Number.NaN, settledDates: [5] },
  }));

  assert.deepEqual(await loadPersistedGame(storage, isTestState), {
    state: null,
    error: 'Saved progress was invalid, so a new game was started.',
    canAutosave: true,
  });
});

test('read, write, and clear failures are returned for visible feedback', async () => {
  const storage = new MemoryStorage();
  storage.readError = new Error('read failed');
  assert.deepEqual(await loadPersistedGame(storage, isTestState), {
    state: null,
    error: 'Progress could not be loaded. Saved data was left untouched. Reset progress to start over.',
    canAutosave: false,
  });

  storage.readError = null;
  storage.writeError = new Error('write failed');
  assert.deepEqual(
    await savePersistedGame(storage, { cash: 1, settledDates: [] }),
    { error: 'Progress could not be saved. Open Portfolio and reset progress to continue.' },
  );

  storage.writeError = null;
  storage.removeError = new Error('remove failed');
  assert.deepEqual(await clearPersistedGame(storage), {
    error: 'Saved progress could not be cleared on this device.',
  });
});

test('queued reset waits for pending saves, then atomically replaces saved state', async () => {
  const operations: string[] = [];
  const storage = new MemoryStorage();
  storage.values.set(GAME_STORAGE_KEY, 'old progress');

  const originalSet = storage.setItem.bind(storage);
  storage.setItem = async (key, value) => {
    operations.push('write');
    await originalSet(key, value);
  };

  const fresh: TestState = { cash: 140_000_000, settledDates: [] };
  let releasePendingSave!: () => void;
  const pendingSave = new Promise<void>((resolve) => {
    releasePendingSave = resolve;
  });
  const resetOperation = enqueuePersistedReset(pendingSave, storage, fresh);

  await Promise.resolve();
  assert.deepEqual(operations, []);
  assert.equal(storage.values.get(GAME_STORAGE_KEY), 'old progress');

  releasePendingSave();
  assert.deepEqual(await resetOperation, { error: null });
  assert.deepEqual(operations, ['write']);
  assert.deepEqual(
    JSON.parse(storage.values.get(GAME_STORAGE_KEY) ?? ''),
    { version: 1, state: fresh },
  );
});

test('reset keeps the previous save when the replacement write fails', async () => {
  const storage = new MemoryStorage();
  storage.values.set(GAME_STORAGE_KEY, 'old progress');
  storage.writeError = new Error('write failed');

  assert.deepEqual(await resetPersistedGame(
    storage,
    { cash: 140_000_000, settledDates: [] },
  ), {
    error: 'Progress could not be saved. Open Portfolio and reset progress to continue.',
  });
  assert.equal(storage.values.get(GAME_STORAGE_KEY), 'old progress');
});

test('a successful autosave does not erase a load warning before the user dismisses it', () => {
  const loadWarning = 'Saved progress was invalid, so a new game was started.';

  assert.equal(persistenceErrorAfterSave(loadWarning, { error: null }), loadWarning);
  assert.equal(
    persistenceErrorAfterSave(null, { error: 'Progress could not be saved on this device.' }),
    'Progress could not be saved on this device.',
  );
});
