import assert from 'node:assert/strict';
import test from 'node:test';

import { writeSettlementMarker } from './settlementMarker';

function storageLog() {
  const calls: string[] = [];
  return {
    calls,
    storage: {
      async removeItem(key: string) { calls.push(`remove:${key}`); },
      async setItem(key: string, value: string) { calls.push(`set:${key}:${value}`); },
    },
  };
}

test('a season reset clears the stale last-seen settlement marker', async () => {
  const { calls, storage } = storageLog();
  await writeSettlementMarker(storage, 'seen', '2026-04-15', null);
  assert.deepEqual(calls, ['remove:seen']);
});

test('a rewound replay replaces the old-season marker before saving the new clock', async () => {
  const { calls, storage } = storageLog();
  await writeSettlementMarker(storage, 'seen', '2026-04-15', '2026-10-20');
  // Lexicographically this date is later because the year changed; a same-year
  // historical replay demonstrates the actual backward-clock case.
  assert.deepEqual(calls, ['set:seen:2026-10-20']);

  calls.length = 0;
  await writeSettlementMarker(storage, 'seen', '2026-04-15', '2025-10-20');
  assert.deepEqual(calls, ['remove:seen', 'set:seen:2025-10-20']);
});
