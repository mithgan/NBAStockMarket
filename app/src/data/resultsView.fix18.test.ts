import assert from 'node:assert/strict';
import test from 'node:test';

import { extremeName } from './resultsView';

test('a best or worst game is named for what it is, never a "Worst game" that gained (walk 18 T2-11)', () => {
  // The tester's week with Luka: every game beat his price.
  assert.equal(extremeName('Best', 194_500, 'game'), 'Best game');
  assert.equal(extremeName('Worst', 10_500, 'game'), 'Smallest gain');
  // A week of losses: the best of them is the smallest loss.
  assert.equal(extremeName('Best', -12_000, 'night'), 'Smallest loss');
  assert.equal(extremeName('Worst', -120_800, 'night'), 'Worst night');
  // A mixed week keeps the plain names.
  assert.equal(extremeName('Best', 123_800, 'night'), 'Best night');
  assert.equal(extremeName('Worst', -120_800, 'game'), 'Worst game');
  // An amount shown as $0 keeps its plain name.
  assert.equal(extremeName('Worst', 0.4, 'game'), 'Worst game');
  assert.equal(extremeName('Best', -0.4, 'game'), 'Best game');
});
