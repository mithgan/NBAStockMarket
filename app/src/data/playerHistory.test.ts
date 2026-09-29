import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPlayerHistory, parsePlayerHistory } from './playerHistory';
import { priorSeason } from './playerHistoryRequest';

const luka = { playerId: '3945274', name: 'Luka Doncic' };
const season = { id: '2024-25', endYear: 2025 };
const url = 'https://api.databallr.com/v1/nba/players/gamelog?nba_id=1629029&year=2025';
const row = (extra: Record<string, unknown> = {}) => ({
  nba_id: 1629029, player_name: 'Luka Dončić', year: 2025, playoffs: false, date: 20250411,
  PTS: 39, REB: 8, AST: 7, MIN: 31.11, Opponent: null, ...extra,
});
const response = (rows: unknown, status = 200) => new Response(JSON.stringify(rows), {
  status, headers: { 'Content-Type': 'application/json' },
});
const fetchRows = (rows: unknown) => (async () => response(rows)) as typeof fetch;

test('prior season follows the selected season rather than a frozen demo year', () => {
  assert.deepEqual(priorSeason('2025-26'), season);
  assert.deepEqual(priorSeason('2026-27'), { id: '2025-26', endYear: 2026 });
  assert.deepEqual(priorSeason('2000-01'), { id: '1999-00', endYear: 2000 });
  for (const value of ['', '2025', '2025-27', '2025-26-QA', '25-26', '1900-01']) assert.equal(priorSeason(value), null);
});

test('valid rows preserve API statistics, include zero-point appearances and sort chronologically', () => {
  const history = parsePlayerHistory([row(), row({ date: 20241024, PTS: 0, REB: 10, AST: 8, MIN: 36.25 })], luka, 1629029, season, url);
  assert.ok(history);
  assert.equal(history.seasonId, '2024-25');
  assert.equal(history.games[0].date, '2024-10-24');
  assert.equal(history.games[0].points, 0);
  assert.equal(history.games[1].minutes, 31.11);
  assert.equal(history.games[1].opponent, null);
  assert.equal(history.games[1].venue, null);
  assert.equal(history.sourceUrl, url);
  assert.equal(history.games[0].gameId, 'nba:1629029:2024-10-24');
});

test('empty seasons and explicit zero-minute DNPs have no invented games', () => {
  assert.equal(parsePlayerHistory([], luka, 1629029, season, url), null);
  assert.equal(parsePlayerHistory([row({ MIN: 0, PTS: null })], luka, 1629029, season, url), null);
});

test('malformed, duplicate, truncated, wrong-player or wrong-season responses fail visibly', () => {
  const bad = [
    {}, { data: [row()] }, [null], [row(), row()], Array.from({ length: 200 }, () => row()),
    ...[{ nba_id: 1 }, { player_name: 'Nikola Jokic' }, { year: 2026 }, { playoffs: true },
      { date: 20250230 }, { date: 20260411 }, { MIN: null }, { MIN: -1 }, { PTS: null },
      { PTS: '39' }, { PTS: -1 }, { AST: 1.5 }, { REB: Infinity },
    ].map((badField) => [row(badField)]),
  ];
  for (const payload of bad) assert.throws(() => parsePlayerHistory(payload, luka, 1629029, season, url));
});

test('requests use verified NBA identity, prior season and public credentials-omitted route', async () => {
  let called = 0;
  const fetcher: typeof fetch = async (input, init) => {
    called++;
    const requestUrl = new URL(String(input));
    assert.equal(requestUrl.origin + requestUrl.pathname, 'https://api.databallr.com/v1/nba/players/gamelog');
    assert.deepEqual(Object.fromEntries(requestUrl.searchParams), { nba_id: '1629029', year: '2025', playoffs: '0', limit: '200' });
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.redirect, 'error');
    assert.deepEqual(init?.headers, { Accept: 'application/json' });
    return response([row()]);
  };
  const history = await loadPlayerHistory({ ...luka, name: 'Luka Dončić' }, '2025-26', { fetcher });
  assert.equal(called, 1);
  assert.equal(history?.games.length, 1);
});

test('unmapped identities and malformed season never make a network request', async () => {
  const fetcher = (async () => { assert.fail('unexpected fetch'); }) as typeof fetch;
  assert.equal(await loadPlayerHistory({ ...luka, playerId: 'unknown' }, '2025-26', { fetcher }), null);
  assert.equal(await loadPlayerHistory({ ...luka, name: 'Nikola Jokic' }, '2025-26', { fetcher }), null);
  assert.equal(await loadPlayerHistory(luka, '2025-27', { fetcher }), null);
});

test('HTTP/network/malformed JSON failures reject and a retry can succeed', async () => {
  await assert.rejects(loadPlayerHistory(luka, '2025-26', { fetcher: async () => response({}, 500) }), /unavailable/);
  await assert.rejects(loadPlayerHistory(luka, '2025-26', { fetcher: async () => { throw new Error('offline'); } }), /offline/);
  await assert.rejects(loadPlayerHistory(luka, '2025-26', { fetcher: async () => new Response('not JSON') }));
  const recovered = await loadPlayerHistory(luka, '2025-26', { fetcher: fetchRows([row()]) });
  assert.equal(recovered?.games[0].points, 39);
});

test('request is aborted on cancellation or bounded timeout', async () => {
  const pending: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
  });
  const controller = new AbortController();
  const request = loadPlayerHistory(luka, '2025-26', { fetcher: pending, signal: controller.signal });
  controller.abort();
  await assert.rejects(request);
  await assert.rejects(loadPlayerHistory(luka, '2025-26', { fetcher: pending, timeoutMs: 5 }), /timed out/);
  await assert.rejects(loadPlayerHistory(luka, '2025-26', { fetcher: pending, signal: controller.signal }));
});

test('React Native signals without throwIfAborted support successful loading and cancellation', async () => {
  const controller = new AbortController();
  Object.defineProperty(controller.signal, 'throwIfAborted', { value: undefined });
  const history = await loadPlayerHistory(luka, '2025-26', { signal: controller.signal, fetcher: fetchRows([row()]) });
  assert.equal(history?.games.length, 1);
  controller.abort();
  await assert.rejects(loadPlayerHistory(luka, '2025-26', { signal: controller.signal, fetcher: fetchRows([row()]) }), { name: 'AbortError' });
});

test('a new selected season requests its own historical year', async () => {
  const history = await loadPlayerHistory(luka, '2026-27', { fetcher: async (input) => {
    assert.equal(new URL(String(input)).searchParams.get('year'), '2026');
    return response([row({ year: 2026, date: 20260411 })]);
  } });
  assert.equal(history?.seasonId, '2025-26');
});

test('successful real-client cache avoids repeat fetches without allowing caller mutation', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response([row()]); };
  try {
    const first = await loadPlayerHistory(luka, '2025-26');
    assert.ok(first);
    first.games[0].points = 900;
    const second = await loadPlayerHistory(luka, '2025-26');
    assert.equal(calls, 1);
    assert.equal(second?.games[0].points, 39);
  } finally { globalThis.fetch = original; }
});
