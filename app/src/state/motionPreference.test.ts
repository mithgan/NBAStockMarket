import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readReduceMotion,
  REDUCE_MOTION_ATTRIBUTE,
  REDUCE_MOTION_STORAGE_KEY,
  reduceMotionChosen,
  reduceMotionCss,
  setMotionPreferenceStorageForTests,
  setReduceMotion,
  subscribeReduceMotion,
} from './motionPreference';

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

test('motion follows the system unless the player reduces it (walk 5 T3 NYI-4)', () => {
  setMotionPreferenceStorageForTests(memoryStorage());
  assert.equal(reduceMotionChosen(), false);
});

test('the choice is saved, read back, and announced to subscribers', () => {
  const storage = memoryStorage();
  setMotionPreferenceStorageForTests(storage);
  let heard = 0;
  const stop = subscribeReduceMotion(() => {
    heard += 1;
  });
  setReduceMotion(true);
  assert.equal(reduceMotionChosen(), true);
  assert.equal(storage.values.get(REDUCE_MOTION_STORAGE_KEY), '1');
  // The same value again is no news.
  setReduceMotion(true);
  assert.equal(heard, 1);
  setReduceMotion(false);
  assert.equal(reduceMotionChosen(), false);
  assert.equal(storage.values.get(REDUCE_MOTION_STORAGE_KEY), '0');
  assert.equal(heard, 2);
  stop();
  setReduceMotion(true);
  assert.equal(heard, 2);
  // A later visit reads it back.
  setMotionPreferenceStorageForTests(storage);
  assert.equal(reduceMotionChosen(), true);
});

test('storage that is missing or throws never breaks the switch', () => {
  setMotionPreferenceStorageForTests(null);
  assert.equal(reduceMotionChosen(), false);
  setReduceMotion(true);
  assert.equal(reduceMotionChosen(), true);
  const throwing = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  assert.equal(readReduceMotion(throwing), false);
  setMotionPreferenceStorageForTests(throwing);
  assert.equal(reduceMotionChosen(), false);
  setReduceMotion(true);
  assert.equal(reduceMotionChosen(), true);
  assert.equal(readReduceMotion(memoryStorage({ [REDUCE_MOTION_STORAGE_KEY]: 'yes' })), false);
});

test('on the web the choice stills CSS motion as the system setting does', () => {
  const css = reduceMotionCss();
  assert.match(css, new RegExp(`html\\[${REDUCE_MOTION_ATTRIBUTE}="on"\\] \\*`));
  assert.match(css, /transition-duration: 0\.01ms !important/);
  assert.match(css, /animation-duration: 0\.01ms !important/);
});
