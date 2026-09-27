import assert from 'node:assert/strict';
import test from 'node:test';

import {
  KEEP_NOTICES_STORAGE_KEY,
  keepNoticesUntilClosed,
  readKeepNotices,
  setKeepNoticesUntilClosed,
  setNoticePreferenceStorageForTests,
  subscribeKeepNotices,
} from './noticePreference';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

test('notices clear by themselves unless the player keeps them (walk 4 T3-N1)', () => {
  setNoticePreferenceStorageForTests(memoryStorage());
  assert.equal(keepNoticesUntilClosed(), false);
});

test('the choice is saved, read back, and announced to subscribers', () => {
  const storage = memoryStorage();
  setNoticePreferenceStorageForTests(storage);
  let heard = 0;
  const stop = subscribeKeepNotices(() => {
    heard += 1;
  });
  setKeepNoticesUntilClosed(true);
  assert.equal(keepNoticesUntilClosed(), true);
  assert.equal(storage.values.get(KEEP_NOTICES_STORAGE_KEY), '1');
  // Setting the same value again is no news.
  setKeepNoticesUntilClosed(true);
  assert.equal(heard, 1);
  setKeepNoticesUntilClosed(false);
  assert.equal(storage.values.get(KEEP_NOTICES_STORAGE_KEY), '0');
  assert.equal(heard, 2);
  stop();
  setKeepNoticesUntilClosed(true);
  assert.equal(heard, 2);
  // A later visit reads it back.
  setNoticePreferenceStorageForTests(memoryStorage({ [KEEP_NOTICES_STORAGE_KEY]: '1' }));
  assert.equal(keepNoticesUntilClosed(), true);
  assert.equal(readKeepNotices(memoryStorage({ [KEEP_NOTICES_STORAGE_KEY]: 'yes' })), false);
});

test('missing or failing storage never breaks the switch', () => {
  setNoticePreferenceStorageForTests({
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  });
  assert.equal(keepNoticesUntilClosed(), false);
  setKeepNoticesUntilClosed(true);
  assert.equal(keepNoticesUntilClosed(), true);
  setNoticePreferenceStorageForTests(null);
  assert.equal(keepNoticesUntilClosed(), false);
  setKeepNoticesUntilClosed(true);
  assert.equal(keepNoticesUntilClosed(), true);
  assert.equal(readKeepNotices(null), false);
});
