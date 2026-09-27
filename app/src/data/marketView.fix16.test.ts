import assert from 'node:assert/strict';
import test from 'node:test';

import {
  endedShortTag,
  filterMarketRows,
  heldDropsAverage,
  heldFirstStep,
  heldLineWordings,
  heldOrderLine,
  lockLineUnbroken,
  orderLine,
  seasonEndSlotLine,
  REFUSED_MARK_MS,
  refusedActionName,
  refusedWord,
  unlistedGuessLine,
  unlistedSearch,
  unlistedStarFor,
} from './marketView';
import { restoresPlace } from './marketViewMemory';

const listed = [
  'Luka Doncic', 'Scottie Barnes', 'Devin Booker', 'Jalen Duren', 'OG Anunoby', 'Nikola Jokic', 'Victor Wembanyama',
  'Giannis Antetokounmpo', 'Shai Gilgeous-Alexander', 'Jalen Brunson', 'Jaylen Brown', 'Karl-Anthony Towns',
];

test('a phone order line swaps its words in one line with Re-sort (walk 16 T1-02)', () => {
  assert.equal(heldOrderLine('2025-10-20', '2025-10-21', 'phone'), 'Rows kept as values moved');
  assert.equal(heldOrderLine('2025-10-20', '2025-10-27', 'short', 'price'), 'Rows kept as prices moved');
  assert.equal(heldOrderLine('2025-10-20', '2025-10-27', 'long'), 'Values moved in the Oct 21–27 games; order kept so rows stay put.', 'tables keep the long form');
  for (const form of ['short', 'phone'] as const) {
    const line = orderLine({ sort: 'value', reversed: false, heldNote: null, form });
    assert.equal(line.text, 'Sorted by value, highest first.');
    assert.equal(line.reserve, 'Rows kept as values moved', `${form}: the reserve is one short line`);
  }
});

test('a search names a player practice leaves out only on a real match of his name (walk 16 T4-01, T4-03)', () => {
  // Kobe is retired: never Rudy Gobert, and no near name.
  assert.deepEqual(unlistedSearch('Kobe', listed), { star: null, guess: null, retired: true });
  assert.deepEqual(unlistedSearch('kobe bryant', listed), { star: null, guess: null, retired: true });
  assert.deepEqual(unlistedSearch('Shaq', listed), { star: null, guess: null, retired: true }, 'never Shai Gilgeous-Alexander');
  assert.deepEqual(unlistedSearch('MJ', listed), { star: null, guess: null, retired: true });
  assert.deepEqual(unlistedSearch('michael jordan', listed), { star: null, guess: null, retired: true });
  assert.equal(unlistedSearch('kobi', listed).retired, true, 'a typo of a retired star offers nothing');
  // Nicknames and names of LeBron.
  for (const query of ['Bron', 'King James', 'the king', 'lebron', 'LeBron James']) {
    assert.equal(unlistedStarFor(query, listed), 'LeBron James', query);
  }
  assert.equal(unlistedStarFor('steph curry', listed), 'Stephen Curry', 'a shortened first name');
  assert.equal(unlistedStarFor('curry', listed), 'Stephen Curry', 'a surname');
  assert.equal(unlistedStarFor('gobert', listed), 'Rudy Gobert', 'his own surname still names him');
  // Close only: a question, not a statement.
  assert.deepEqual(unlistedSearch('embid', listed), { star: null, guess: 'Joel Embiid', retired: false });
  assert.equal(unlistedGuessLine('Joel Embiid', 30), "Did you mean Joel Embiid? He is not in this practice season's 30 players.");
  // Shared names and listed players name nobody.
  for (const query of ['james', 'jalen', 'kevin', 'luka', 'xyz', '🏀']) {
    assert.deepEqual(unlistedSearch(query, listed), { star: null, guess: null, retired: false }, query);
  }
});

test('"bron" is a nickname: it finds LeBron when he is listed (walk 16 T4-03)', () => {
  const rows = ['LeBron James', 'Jalen Brunson', 'Jaylen Brown'].map((name, index) => ({ player: { playerId: String(index), name } }));
  const found = filterMarketRows(rows as never, { query: 'Bron', watchedOnly: false, watched: [] });
  assert.deepEqual(found.map((row: { player: { name: string } }) => row.player.name), ['LeBron James']);
});

test('a move refused after it waited marks its row for a few seconds, then Add again (walk 16 T4-09)', () => {
  assert.equal(refusedWord('long'), 'Not added');
  assert.equal(refusedWord('short'), 'Not shorted');
  assert.equal(refusedActionName('long', 'Devin Booker', 330_000), 'Not added: his price moved to $330K. Add Devin Booker at $330K a game');
  assert.equal(refusedActionName('short', 'Cade Cunningham', 388_500), 'Not shorted: his price moved to $388.5K. Short Cade Cunningham at $388.5K a game');
  // At a lock the resting button adds the lock line to this name once (walk 17 T3-09).
  assert.equal(refusedActionName('long', 'Devin Booker', 330_000, true), 'Not added: Devin Booker');
  assert.ok(REFUSED_MARK_MS >= 3000 && REFUSED_MARK_MS <= 6000, 'a few seconds');
});

test('held rows decide their first line once per list: one drops its average, all do (walk 16 T1-13)', () => {
  const wembanyama = heldLineWordings({ text: '-$3K over 3 games, -$1K a game', total: '-$3K over 3 games', why: null });
  assert.equal(heldFirstStep(0, false, true, wembanyama.length), 0, 'alone, his line fits with the average');
  assert.equal(heldFirstStep(0, true, true, wembanyama.length), 1, 'a neighbour dropped his: so does he');
  assert.equal(wembanyama[heldFirstStep(0, true, true, wembanyama.length)].text.replace(/\u00A0/g, ' '), '-$3K over 3 games');
  assert.equal(heldFirstStep(2, true, true, 3), 2, 'his own fit may go further');
  assert.equal(heldFirstStep(0, true, false, 1), 0, 'a row with no average keeps its line');
  assert.equal(heldDropsAverage(1, true), true);
  assert.equal(heldDropsAverage(0, true), false);
  assert.equal(heldDropsAverage(1, false), false);
});

test('the season-end Short slot breaks as "No shorts" / "season over" beside a phone toggle (walk 16 T1-14)', () => {
  assert.equal(seasonEndSlotLine('short', 0, true), 'No shorts\nseason\u00A0over');
  assert.equal(seasonEndSlotLine('short', 2, true), '2\u00A0shorted\nseason\u00A0over');
  assert.equal(seasonEndSlotLine('short', 0).replace(/\u00A0/g, ' '), 'No shorts · season over', 'one line where it has room');
  assert.ok(!seasonEndSlotLine('short', 0, true).includes('·'));
});

test('at season end an ended short is tagged on the Short side (walk 16 T2-06)', () => {
  assert.equal(endedShortTag('short', true, false, 5), 'Shorted this season');
  assert.equal(endedShortTag('short', false, false, 5), null, 'mid-season');
  assert.equal(endedShortTag('short', true, true, 5), null, 'held: his own tag says it');
  assert.equal(endedShortTag('short', true, false, 0), null, 'never shorted');
  assert.equal(endedShortTag('long', true, false, 5), null);
});

test('the Market opens at its top when the season ended since you left it (walk 16 T1-07)', () => {
  assert.equal(restoresPlace(600, false, false), true, 'mid-season: your place comes back');
  assert.equal(restoresPlace(600, true, true), true, 'over when you left too');
  assert.equal(restoresPlace(600, true, false), false, 'the season ended meanwhile: the list was re-sorted');
  assert.equal(restoresPlace(0, false, false), false, 'at the top already');
});

test('the lock line keeps "after Oct 28" together (walk 16 T2-08)', () => {
  assert.equal(lockLineUnbroken('Moves reopen after Oct 28'), 'Moves reopen after\u00A0Oct\u00A028');
  assert.equal(lockLineUnbroken('Reopens after Oct 28'), 'Reopens after\u00A0Oct\u00A028');
  assert.equal(lockLineUnbroken('Moves reopen after these games'), 'Moves reopen after\u00A0these\u00A0games');
  assert.equal(lockLineUnbroken('Locked Oct 28'), 'Locked Oct\u00A028', 'no "after": the last two words stay together');
});
