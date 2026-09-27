import assert from 'node:assert/strict';
import test from 'node:test';

import { bareNameSuffix, endedShortSecondLine, endedShortTag, HELD_VALUE_CAPTION, heldDetail, heldValueCaption, listCountLine, toolbarSplits, searchResultLine, unlistedSearch } from './marketView';

const LISTED = ['Luka Doncic', 'Jalen Brunson', 'Jalen Duren', 'Shai Gilgeous-Alexander', 'Karl-Anthony Towns'];

test('a search heard with three matches or fewer names them (walk 17 T3-05)', () => {
  const base = { total: 30, watchedOnly: false };
  assert.equal(listCountLine({ ...base, query: 'sga', count: 1, names: ['Shai Gilgeous-Alexander'] }), '1 player: Shai Gilgeous-Alexander.');
  assert.equal(listCountLine({ ...base, query: 'jalen', count: 2, names: ['Jalen Brunson', 'Jalen Duren'] }), '2 players: Jalen Brunson and Jalen Duren.');
  assert.equal(
    searchResultLine('ja', 3, ['Jalen Brunson', 'Jalen Duren', 'Jamal Murray']),
    '3 players: Jalen Brunson, Jalen Duren and Jamal Murray.',
  );
  assert.equal(listCountLine({ ...base, query: 'le', count: 7, names: [] }), '7 players match "le".', 'more than three: counted');
  assert.equal(searchResultLine('ja', 2, ['Jalen Brunson']), '2 players match "ja".', 'names that are not all of them: counted');
  assert.equal(listCountLine({ ...base, query: 'zz', count: 0, names: [] }), 'No players match "zz".');
});

test('a bare suffix is no name (walk 17 T4-05)', () => {
  for (const query of ['jr', 'Jr.', 'JR', 'sr', 'Sr.', 'ii', 'iii', ' jr ']) {
    assert.equal(bareNameSuffix(query), true, query);
    assert.deepEqual(unlistedSearch(query, LISTED), { star: null, guess: null, retired: false }, query);
  }
  for (const query of ['jrue', 'jaren', 'jackson jr', 'j', '']) assert.equal(bareNameSuffix(query), false, query);
  assert.equal(unlistedSearch('jaren jackson jr', LISTED).star, 'Jaren Jackson Jr.', 'his name with the suffix still names him');
  assert.equal(unlistedSearch('lebron', LISTED).star, 'LeBron James', 'a name still names its player');
});

test('a phone tags an ended short at season end with his result (walk 17 T1-11, T4-09)', () => {
  assert.equal(endedShortTag('short', true, false, 4), 'Shorted this season');
  assert.equal(endedShortTag('short', false, false, 4), null, 'mid-season: no tag');
  assert.equal(endedShortTag('long', true, false, 4), null);
  const past = heldDetail({ games: 4, total: 128_600, avgNet: 32_150, avgDividend: 300_000 } as Parameters<typeof heldDetail>[0], 0);
  assert.equal(past.total, '+$128.6K over 4 games', 'his result as Closed shows it');
  assert.equal(endedShortSecondLine({ lead: 'Dividend last season $319.5K a game ·', text: '+$67.9K for a short' }), 'Last season +$67.9K for a short');
  assert.equal(endedShortSecondLine({ lead: null, text: 'No last season' }), 'No last season');
});

test('a list that dropped "yours" at a size keeps that decision for the visit (walk 17 T1-03)', async () => {
  const { heldYoursDroppedKnown, rememberHeldYoursDropped, tierAfterSurnameKey } = await import('./marketViewMemory');
  const at360 = tierAfterSurnameKey(360, 1);
  assert.equal(heldYoursDroppedKnown(at360), false, 'decided by measuring the list');
  rememberHeldYoursDropped(at360);
  assert.equal(heldYoursDroppedKnown(at360), true);
  assert.equal(heldYoursDroppedKnown(tierAfterSurnameKey(390, 1)), false, 'one size at a time');
});

test('a narrow table\'s held Value caption is one short line (walk 17 T2-01)', () => {
  assert.equal(heldValueCaption(true), 'at\u00A0your\u00A0price', 'one unbreakable line under 1100px');
  assert.equal(heldValueCaption(false), HELD_VALUE_CAPTION, 'the wide table keeps "last season at your price"');
});

test('a 960-1100px laptop toolbar splits so the search keeps its width (walk 17 T2-06)', () => {
  assert.equal(toolbarSplits(1024, true, true), true);
  assert.equal(toolbarSplits(960, true, true), true);
  assert.equal(toolbarSplits(1100, true, true), false, 'the wide column set has room on one row');
  assert.equal(toolbarSplits(768, true, true), false, 'a portrait tablet already wraps sort and Watching under the search');
  assert.equal(toolbarSplits(1024, true, false), false, 'a folded toolbar is its own layout');
  assert.equal(toolbarSplits(1024, false, true), false);
});
