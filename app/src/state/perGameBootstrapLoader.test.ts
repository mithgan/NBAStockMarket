import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { parsePerGameBootstrap, type PerGameBootstrap } from '../api/contracts';
import { loadPerGameBootstrapSnapshot } from './perGameBootstrapLoader';

const example = JSON.parse(readFileSync(
  resolve(import.meta.dirname, '../api/fixtures/perGameApiExample.json'),
  'utf8',
)) as { bootstrap: unknown };

function bootstrap(): PerGameBootstrap {
  return parsePerGameBootstrap(example.bootstrap);
}

test('incremental load merges history when account, season, and ruleset are unchanged', async () => {
  const previous = bootstrap();
  const incoming = {
    ...previous,
    game: { ...previous.game, eventCursor: previous.game.eventCursor + 1 },
    ledger: {
      items: [{
        ...previous.ledger.items[0],
        eventCursor: previous.game.eventCursor + 1,
        entryId: 'incremental-entry',
      }],
      nextCursor: null,
    },
  };
  const cursors: Array<number | undefined> = [];

  const result = await loadPerGameBootstrapSnapshot({
    previous,
    incremental: true,
    fetchBootstrap: async (cursor) => {
      cursors.push(cursor);
      return incoming;
    },
    isCurrent: () => true,
  });

  assert.deepEqual(cursors, [previous.game.eventCursor]);
  assert.ok(result);
  assert.deepEqual(
    result.ledger.items.map((entry) => entry.entryId),
    [previous.ledger.items[0].entryId, 'incremental-entry'],
  );
});

test('identity rollover discards the cursor-truncated response and installs a full snapshot', async () => {
  const previous = bootstrap();
  const rolloverCases = [
    { ...previous, account: { ...previous.account, accountId: 'new-account' } },
    { ...previous, game: { ...previous.game, seasonId: '2027-28' } },
    { ...previous, ruleset: { ...previous.ruleset, version: previous.ruleset.version + 1 } },
  ];

  for (const rollover of rolloverCases) {
    const truncatedRollover = {
      ...rollover,
      game: { ...rollover.game, eventCursor: 3 },
      ledger: { items: [], nextCursor: null },
      settledResults: [],
    };
    const fullSnapshot = {
      ...truncatedRollover,
      ledger: {
        items: [{
          ...previous.ledger.items[0],
          eventCursor: 1,
          entryId: 'full-history-entry',
        }],
        nextCursor: null,
      },
      settledResults: [{ ...previous.settledResults[0], eventCursor: 1 }],
    };
    const cursors: Array<number | undefined> = [];

    const result = await loadPerGameBootstrapSnapshot({
      previous,
      incremental: true,
      fetchBootstrap: async (cursor) => {
        cursors.push(cursor);
        return cursor === undefined ? fullSnapshot : truncatedRollover;
      },
      isCurrent: () => true,
    });

    assert.deepEqual(cursors, [previous.game.eventCursor, undefined]);
    assert.equal(result, fullSnapshot);
    assert.deepEqual(result.ledger.items, fullSnapshot.ledger.items);
    assert.deepEqual(result.settledResults, fullSnapshot.settledResults);
  }
});

test('a stale generation cannot trigger or install a rollover refetch', async () => {
  const previous = bootstrap();
  const rollover = {
    ...previous,
    game: { ...previous.game, seasonId: '2027-28', eventCursor: 1 },
  };
  const cursors: Array<number | undefined> = [];

  const result = await loadPerGameBootstrapSnapshot({
    previous,
    incremental: true,
    fetchBootstrap: async (cursor) => {
      cursors.push(cursor);
      return rollover;
    },
    isCurrent: () => false,
  });

  assert.equal(result, null);
  assert.deepEqual(cursors, [previous.game.eventCursor]);
});

test('a rollover full snapshot is not returned after the request becomes stale', async () => {
  const previous = bootstrap();
  const rollover = {
    ...previous,
    game: { ...previous.game, seasonId: '2027-28', eventCursor: 1 },
  };
  let guardChecks = 0;

  const result = await loadPerGameBootstrapSnapshot({
    previous,
    incremental: true,
    fetchBootstrap: async (cursor) => (
      cursor === undefined
        ? { ...rollover, ledger: { items: [], nextCursor: null } }
        : rollover
    ),
    isCurrent: () => {
      guardChecks += 1;
      return guardChecks === 1;
    },
  });

  assert.equal(result, null);
  assert.equal(guardChecks, 2);
});

test('acknowledged account version remains a floor until a matching snapshot catches up', async () => {
  const previous = bootstrap();
  const minimumSnapshot = { ...previous, account: { ...previous.account, version: previous.account.version + 2 } };
  for (const version of [previous.account.version, minimumSnapshot.account.version - 1, minimumSnapshot.account.version]) {
    const result = await loadPerGameBootstrapSnapshot({
      previous,
      minimumSnapshot,
      incremental: true,
      fetchBootstrap: async () => ({ ...previous, account: { ...previous.account, version } }),
      isCurrent: () => true,
    });
    assert.equal(result !== null, version >= minimumSnapshot.account.version);
  }
});

test('an acknowledged old ruleset does not impose its account version on a new ruleset', async () => {
  const previous = bootstrap();
  const minimumSnapshot = { ...previous, account: { ...previous.account, version: 100 } };
  const next = { ...previous, ruleset: { ...previous.ruleset, version: 2 }, account: { ...previous.account, version: 1 } };
  const result = await loadPerGameBootstrapSnapshot({ previous, minimumSnapshot, incremental: true, fetchBootstrap: async () => next, isCurrent: () => true });
  assert.equal(result, next);
});

test('a rollover probe cannot bypass the acknowledged floor if the full response returns to the same identity', async () => {
  const previous = bootstrap();
  const minimumSnapshot = { ...previous, account: { ...previous.account, version: previous.account.version + 1 } };
  const rollover = { ...previous, ruleset: { ...previous.ruleset, version: 2 } };
  const result = await loadPerGameBootstrapSnapshot({ previous, minimumSnapshot, incremental: true, fetchBootstrap: async (cursor) => cursor === undefined ? previous : rollover, isCurrent: () => true });
  assert.equal(result, null);
});
