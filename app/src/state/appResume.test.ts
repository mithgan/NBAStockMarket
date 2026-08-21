import assert from 'node:assert/strict';
import test from 'node:test';

import { isAppResume } from './appResume';

test('only a transition back to active triggers a resume refresh', () => {
  assert.equal(isAppResume('background', 'active'), true);
  assert.equal(isAppResume('inactive', 'active'), true);
  assert.equal(isAppResume('active', 'active'), false);
  assert.equal(isAppResume('active', 'background'), false);
});
