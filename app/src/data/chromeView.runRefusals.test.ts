import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeRefusals, runRefusals, withRefusals } from './chromeView';

test('a run keeps the moves it refused, names first, a played lock in the past (walk 15 T4-04)', () => {
  const first = runRefusals('Oct 21–27 games: your score fell $158K. Moves pause for the Oct 28 games, so Devin Booker was not added.');
  const fuller = runRefusals('Oct 21–27 games: your score fell $158K. Moves pause for the Oct 28 games, so Devin Booker and Jalen Duren were not added.');
  const kept = mergeRefusals(first, fuller);
  assert.deepEqual(kept, ['Devin Booker and Jalen Duren were not added: moves paused for the Oct 28 games.']);
  assert.equal(
    withRefusals('Oct 21–Nov 3 games (2 weeks): your score rose $232.5K. Moves pause for the Nov 5 games.', kept),
    'Oct 21–Nov 3 games (2 weeks): your score rose $232.5K. Devin Booker and Jalen Duren were not added: moves paused for the Oct 28 games. Moves pause for the Nov 5 games.',
  );
});

test('a move refused by the lock still ahead names the whole run, in the present, once (walk 15 T4-08)', () => {
  const refused = runRefusals('Nov 4–10 games: your score rose $111.5K. Moves pause for the Nov 11 games, so Luka Doncic was not dropped.');
  assert.equal(
    withRefusals('Oct 21–Nov 10 games (3 weeks): your score rose $290K. Moves pause for the Nov 11 games.', refused),
    'Oct 21–Nov 10 games (3 weeks): your score rose $290K. Luka Doncic was not dropped: moves pause for the Nov 11 games.',
  );
});

test('refusals merge only when a later one covers an earlier one\'s names for the same reason', () => {
  const barnes = runRefusals('x. Scottie Barnes was not added: his price moved to $261.4K a game.');
  const both = runRefusals('x. Scottie Barnes and Devin Booker were not added: their prices moved to $261.4K and $336.1K a game.');
  assert.deepEqual(mergeRefusals(barnes, both), both);
  const duren = runRefusals('x. Jalen Duren was not added: his price moved to $177.1K a game.');
  assert.deepEqual(mergeRefusals(barnes, duren), [...barnes, ...duren], "another week's refusal is kept");
  assert.deepEqual(runRefusals('Devin Booker was not added. Your roster is locked. Moves reopen after Oct 28.'), ['Devin Booker was not added: moves paused for the Oct 28 games.']);
  assert.deepEqual(runRefusals('Devin Booker was not added. Your roster is locked.'), ['Devin Booker was not added: the roster was locked.']);
  assert.deepEqual(runRefusals('Oct 21 games: your score rose $194.5K.'), []);
  assert.equal(withRefusals('Oct 21 games: your score rose $194.5K.', []), 'Oct 21 games: your score rose $194.5K.');
});
