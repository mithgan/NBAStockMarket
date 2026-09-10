import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreSavedVariant } from './variantPersistence';

test('a delayed saved appearance cannot replace a newer choice or update an unmounted provider', async () => {
  let resolveRead!: (value: string) => void;
  let current = true;
  const choices: string[] = [];
  const restoring = restoreSavedVariant(() => new Promise((resolve) => { resolveRead = resolve; }), (choice) => choices.push(choice), () => current);
  choices.push('light');
  current = false;
  resolveRead('dark');
  await restoring;
  assert.deepEqual(choices, ['light']);
});

test('valid saved appearance is restored, while unknown choices and failed storage are ignored', async () => {
  const choices: string[] = [];
  await restoreSavedVariant(async () => 'dark', (choice) => choices.push(choice), () => true);
  await restoreSavedVariant(async () => 'unknown', (choice) => choices.push(choice), () => true);
  await restoreSavedVariant(async () => { throw new Error('unavailable'); }, () => assert.fail(), () => true);
  assert.deepEqual(choices, ['dark']);
});
