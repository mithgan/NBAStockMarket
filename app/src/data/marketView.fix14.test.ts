import assert from 'node:assert/strict';
import test from 'node:test';

import { heldPlayedWordings, heldValueLine, heldValuePhrase, resortsAfterRun } from './marketView';

const plain = (text: string) => text.replace(/ /g, ' ');

test('a list keeps its order through any run pressed while it shows; the season end re-sorts (walk 14 T2-05)', () => {
  assert.equal(resortsAfterRun('2025-10-20', '2025-10-28', false), false, '+1 night then +1 week: day 8');
  assert.equal(resortsAfterRun('2025-10-20', '2026-01-05', false), false, 'many weeks');
  assert.equal(resortsAfterRun('2025-10-20', '2026-04-12', true), true, 'Play to the end');
  assert.equal(resortsAfterRun('2026-04-12', '2025-10-20', false), true, 'a new season');
});

test('once he has played for you, a held row leads with today\'s price and says last season as history (walk 14 T1-09)', () => {
  const towns = { currentGameCost: 384_700, priorSeasonValuePerGame: 320_000 };
  const steps = heldPlayedWordings(towns, 'long', 379_500).map(plain);
  assert.deepEqual(steps, [
    'Price now $384.7K · last season -$59.5K a game at your price',
    'Price now $384.7K · last season -$59.5K at your price',
    'Price now $384.7K',
  ]);
  assert.ok(steps.every((step) => !/^Value\b/.test(step)), 'never a verdict word against his result');
  assert.ok(heldPlayedWordings(towns, 'long', 379_500)[0].includes('at your price'), '"at your price" never breaks');
  // Before his first game the guide stays.
  assert.equal(heldValueLine(towns, 'long', 379_500).value, 'Value -$59.5K at your price');
  // Even, and a rookie with no last season.
  assert.deepEqual(heldPlayedWordings({ currentGameCost: 100_200, priorSeasonValuePerGame: 100_000 }, 'long', 100_000).map(plain), [
    'Price now $100.2K · last season even at your price',
    'Price now $100.2K',
  ]);
  assert.deepEqual(heldPlayedWordings({ currentGameCost: 112_200, priorSeasonValuePerGame: null }, 'long', 111_500), ['Price now $112.2K']);
  // A short: the sign is the short's.
  assert.equal(plain(heldPlayedWordings({ currentGameCost: 150_000, priorSeasonValuePerGame: 120_000 }, 'short', 140_000)[1]), 'Price now $150K · last season +$20K at your price');
  // Aloud, the same order.
  assert.equal(heldValuePhrase(towns, 'long', 379_500, true), 'price now $384.7K a game, last season -$59.5K a game at your price');
  assert.equal(heldValuePhrase({ currentGameCost: 112_200, priorSeasonValuePerGame: null }, 'long', 111_500, true), 'price now $112.2K a game');
  assert.equal(heldValuePhrase(towns, 'long', 379_500), 'value -$59.5K a game at your price, dividend $320K a game, price now $384.7K a game', 'before games: unchanged');
});

test('a rookie\'s value lines read as sentences, never a lowercase fragment (walk 14 T1-10)', async () => {
  const { unheldValueLines, valueLineParts, valueSignal } = await import('./marketView');
  const rookie = unheldValueLines(valueSignal({ currentGameCost: 111_500, priorSeasonValuePerGame: null }, 'long'));
  const twoLines = valueLineParts(rookie.first, rookie.second, false);
  assert.equal(twoLines.first, 'No last season');
  assert.equal(twoLines.second, 'Nothing to compare with his price', 'its own line starts with a capital');
  // "even with his price" on a line of its own too; figures stay as they are.
  const even = unheldValueLines(valueSignal({ currentGameCost: 100_200, priorSeasonValuePerGame: 100_000 }, 'long'));
  assert.equal(valueLineParts(even.first, even.second, false).second, 'Even with his price');
  assert.equal(valueLineParts('Dividend last season $218K a game ·', '$8K over his price', false).second, '$8K over his price');
  // One line (a phone turned sideways): the dot joins them, lowercase after it.
  assert.equal(valueLineParts(rookie.first, rookie.second, true).second, 'nothing to compare with his price');
});

const PRACTICE = [
  'Nikola Jokic', 'Shai Gilgeous-Alexander', 'Giannis Antetokounmpo', 'Luka Doncic',
  'Victor Wembanyama', 'Jalen Brunson', 'Cade Cunningham', 'Karl-Anthony Towns',
  'Donovan Mitchell', 'Kevin Durant', 'Devin Booker', 'Tyrese Maxey', 'Evan Mobley',
  'Kawhi Leonard', 'LaMelo Ball', 'Jamal Murray', 'Bam Adebayo', 'Scottie Barnes',
  'Jaylen Brown', 'Chet Holmgren', "De'Aaron Fox", 'Desmond Bane', 'Derrick White',
  'Amen Thompson', 'Jalen Duren', 'OG Anunoby', 'Dyson Daniels', 'Donovan Clingan',
  'Collin Gillespie', 'Kon Knueppel',
];

test('a search that finds nobody offers the nearest name (walk 14 T4-N1)', async () => {
  const { didYouMeanLine, filterMarketRows, nearestNames } = await import('./marketView');
  const first = (query: string) => nearestNames(query, PRACTICE).map((entry) => entry.label).join(' / ');
  assert.equal(first('jokc'), 'Nikola Jokic');
  assert.equal(first('jokci'), 'Nikola Jokic');
  assert.equal(first('doncci'), 'Luka Doncic');
  assert.equal(first('lukka'), 'Luka Doncic');
  assert.equal(first('antetokounpo'), 'Giannis Antetokounmpo');
  assert.equal(first('brunsen'), 'Jalen Brunson');
  assert.equal(first('shai ga'), 'Shai Gilgeous-Alexander', 'first name and surname initials');
  assert.equal(first('nikola jokc'), 'Nikola Jokic');
  assert.equal(first('wembanyamma'), 'Victor Wembanyama');
  assert.equal(first('knuepel'), 'Kon Knueppel');
  // Two that tie are both offered, in the list's order; three on the same word offer that word.
  assert.equal(first('jlaen'), 'Jalen Brunson / Jalen Duren');
  const more = [...PRACTICE, 'Jalen Williams'];
  assert.deepEqual(nearestNames('jlaen', more), [{ label: 'Jalen', query: 'Jalen' }]);
  const rows = more.map((name, index) => ({ player: { playerId: String(index), name } as never }));
  assert.equal(filterMarketRows(rows, { query: 'Jalen', watchedOnly: false, watched: [] }).length, 3, 'the offered search finds them');
  assert.equal(filterMarketRows(rows, { query: 'Nikola Jokic', watchedOnly: false, watched: [] }).length, 1, 'a name finds him alone');
  // Nothing close, too short, or no letters: nothing offered.
  assert.deepEqual(nearestNames('stephen curry', PRACTICE), [], 'a real player not listed');
  assert.deepEqual(nearestNames('xyzzy', PRACTICE), []);
  assert.deepEqual(nearestNames('jk', PRACTICE), [], 'too short to guess');
  assert.deepEqual(nearestNames('🏀', PRACTICE), []);
  assert.equal(didYouMeanLine(nearestNames('jokc', PRACTICE)), 'Did you mean Nikola Jokic?');
  assert.equal(didYouMeanLine([{ label: 'Jalen Brunson', query: 'Jalen Brunson' }, { label: 'Jalen Duren', query: 'Jalen Duren' }]), 'Did you mean Jalen Brunson or Jalen Duren?');
  assert.equal(didYouMeanLine([]), '');
});

test('the phone rows\' tier place is remembered per window size, so a Market visit draws its list once (fix 14 perf)', async () => {
  const { rememberTierAfterSurname, tierAfterSurnameKey, tierAfterSurnameKnown } = await import('./marketViewMemory');
  const key = tierAfterSurnameKey(390.4, 1);
  assert.equal(key, '390|1');
  assert.equal(tierAfterSurnameKnown(key), false);
  rememberTierAfterSurname(key);
  assert.equal(tierAfterSurnameKnown(key), true);
  assert.equal(tierAfterSurnameKnown(tierAfterSurnameKey(430, 1)), false, 'another width measures for itself');
  assert.equal(tierAfterSurnameKnown(tierAfterSurnameKey(390, 1.3)), false, 'larger text measures for itself');
});
