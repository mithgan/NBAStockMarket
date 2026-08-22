import assert from 'node:assert/strict';
import test from 'node:test';

import { alignedAxisIndex, localSeriesIndex } from './watchlistAlignment';

test('short watchlist histories align their latest value to the shared right edge', () => {
  assert.equal(alignedAxisIndex(0, 5, 15), 10);
  assert.equal(alignedAxisIndex(4, 5, 15), 14);
  assert.equal(localSeriesIndex(14, 5, 15), 4);
});

test('scrubbing before a shorter history begins reports no game yet', () => {
  assert.equal(localSeriesIndex(9, 5, 15), null);
  assert.equal(localSeriesIndex(10, 5, 15), 0);
  assert.equal(localSeriesIndex(14, 15, 15), 14);
});
