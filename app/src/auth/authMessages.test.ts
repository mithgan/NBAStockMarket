import assert from 'node:assert/strict';
import test from 'node:test';

import { authErrorMessage } from './authMessages';

test('authentication errors replace raw transport failures with actionable copy', () => {
  const expected = 'Unable to reach the authentication service. Check your connection and try again.';

  assert.equal(authErrorMessage('Failed to fetch', 'Sign in failed.'), expected);
  assert.equal(authErrorMessage('Network request failed', 'Sign in failed.'), expected);
  assert.equal(authErrorMessage('Load failed while fetching', 'Sign in failed.'), expected);
  assert.equal(authErrorMessage('Invalid login credentials', 'Sign in failed.'), 'Invalid login credentials');
  assert.equal(authErrorMessage(undefined, 'Sign in failed.'), 'Sign in failed.');
});

test('authentication errors replace empty provider payloads with action-specific copy', () => {
  assert.equal(authErrorMessage('{}', 'Sign out failed.'), 'Sign out failed.');
  assert.equal(authErrorMessage('[object Object]', 'Sign out failed.'), 'Sign out failed.');
  assert.equal(authErrorMessage('Unknown error', 'Sign in failed.'), 'Sign in failed.');
});
