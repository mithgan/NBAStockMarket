import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collapseControls,
  crowdedToolbarFolds,
  heldPlayedWordings,
  heldStepFloor,
  marketLayout,
  seasonEndExplainer,
  seasonEndSlotLine,
  seasonEndStatusShown,
  shortTableFolds,
  slotLinesCrowded,
  tablePinsChrome,
  unlistedStarFor,
  unlistedStarLine,
} from './marketView';

const plain = (text: string) => text.replace(/\u00A0/g, ' ');

test('a short laptop table keeps its toolbar and column labels in view, folded to one row (walk 15 T2-06)', () => {
  // 853x533: a 1280x800 laptop at 150%.
  assert.equal(marketLayout(853, 1, 533), 'table');
  assert.equal(tablePinsChrome(533), true, '853x533 pins its labels, side toggle and Search & sort');
  assert.equal(shortTableFolds(533), true, 'and folds search, sort and Watching at once, nothing measured');
  assert.equal(collapseControls(853, 533), false, 'the fold is the short table\'s own, not the phone rule');
  // As 960x600 and 1280x610 already did, which keep their measured fold.
  assert.equal(tablePinsChrome(600), true);
  assert.equal(tablePinsChrome(610), true);
  assert.equal(shortTableFolds(600), false);
  assert.equal(shortTableFolds(560), false);
  assert.equal(shortTableFolds(559), true);
  // Under 500px a table only shows 1000px wide or more, folded by the height rule; its labels scroll.
  assert.equal(tablePinsChrome(440), false);
  assert.equal(collapseControls(1280, 440), true);
});

test('the slot line goes under the side toggle once a part wraps past two lines beside it (walk 15 T3-01)', () => {
  // 320px, plain: "3 of 10" / "on your roster" at 16px, "Reopens" / "after Oct 28" at 15px.
  assert.equal(slotLinesCrowded([{ height: 32, lineHeight: 16 }, { height: 30, lineHeight: 15 }]), false);
  // A reader's text spacing (line-height 1.5): "3 of 10" / "on your" / "roster", and the lock line in three.
  assert.equal(slotLinesCrowded([{ height: 54, lineHeight: 18 }, { height: 50.4, lineHeight: 16.8 }]), true);
  assert.equal(slotLinesCrowded([{ height: 36, lineHeight: 18 }, { height: 50.4, lineHeight: 16.8 }]), true, 'either part');
  assert.equal(slotLinesCrowded([]), false, 'nothing drawn yet');
  assert.equal(slotLinesCrowded([{ height: 0, lineHeight: 18 }, { height: 40, lineHeight: Number.NaN }]), false, 'unmeasured');
  // In a short window it folds search, sort and Watching as well, so two whole players show under the notice strip.
  assert.equal(crowdedToolbarFolds(568), true, '320x568');
  assert.equal(crowdedToolbarFolds(640), false, '360x640 keeps its toolbar');
  assert.equal(crowdedToolbarFolds(844), false);
});

test('held rows of one list show one step, and last season always says "a game" (walk 15 T1-02, T1-03)', () => {
  const luka = heldPlayedWordings({ currentGameCost: 416_100, priorSeasonValuePerGame: 488_500 }, 'long', 417_500).map(plain);
  const booker = heldPlayedWordings({ currentGameCost: 336_900, priorSeasonValuePerGame: 374_500 }, 'long', 339_500).map(plain);
  assert.deepEqual(luka, [
    'Price now $416.1K · last season +$71K a game at your price',
    'Price now $416.1K',
  ]);
  assert.equal(booker[1], 'Price now $336.9K');
  // Every player's steps line up: step 0 says both (last season with "a game"), step 1 today's price.
  const rookie = heldPlayedWordings({ currentGameCost: 112_300, priorSeasonValuePerGame: null }, 'long', 111_500);
  assert.equal(rookie.length, luka.length);
  assert.equal(rookie[1], 'Price now $112.3K');
  assert.ok([luka, booker].every((steps) => /last season [+-]\$[\d.]+K a game at your price$/i.test(steps[0])));
  // At 360 Luka's and Barnes' rows fit step 0 or 1, Booker's needs 1: all show 1.
  assert.equal(heldStepFloor([1, 1, 1]), 1);
  assert.equal(heldStepFloor([0, 1, 0]), 1);
  assert.equal(heldStepFloor([]), 0, 'no held row');
});

test('at season end the Short side says its state once, and "season end" keeps "end" (walk 15 T1-08)', () => {
  assert.equal(plain(seasonEndSlotLine('short', 0)), 'No shorts · season over');
  assert.equal(plain(seasonEndSlotLine('short', 2)), '2 shorted · season over');
  assert.equal(seasonEndStatusShown('short'), false, 'no "The season is over" line under it');
  assert.equal(seasonEndExplainer('short'), 'Shorts open again in a new season.', 'one explainer line, what comes next');
  assert.ok(!/season is over/i.test(seasonEndExplainer('short')));
  // The Roster side keeps its two lines, "at season end" in one piece.
  assert.ok(seasonEndSlotLine('long', 3).endsWith('season\u00A0end'));
  assert.ok(seasonEndSlotLine('long', 0).endsWith('season\u00A0end'));
  assert.equal(seasonEndStatusShown('long'), true);
});

test('a search for a star practice leaves out names him (walk 15 T1-N4)', () => {
  const listed = ['Luka Doncic', 'Nikola Jokic', 'Jalen Brunson', 'Jalen Duren', 'Devin Booker', 'Kawhi Leonard', 'Victor Wembanyama'];
  assert.equal(unlistedStarFor('lebron', listed), 'LeBron James');
  assert.equal(unlistedStarFor('steph curry', listed), 'Stephen Curry');
  assert.equal(unlistedStarFor('king james', listed), 'LeBron James', 'a nickname');
  // Walk 16 T4-01: a typo is a question now ("Did you mean Joel Embiid?"), never a statement.
  assert.equal(unlistedStarFor('embid', listed), null, 'a typo');
  assert.equal(unlistedStarFor('james', listed), null, 'two stars: say nothing new');
  assert.equal(unlistedStarFor('jalen', listed), null, 'a shared first name');
  assert.equal(unlistedStarFor('luka', listed), null, 'listed');
  assert.equal(unlistedStarFor('xyz', listed), null);
  assert.equal(unlistedStarFor('🏀', listed), null);
  assert.equal(unlistedStarLine('LeBron James', 30), "LeBron James is not in this practice season's 30 players");
});

test('one game reads the same on the Market and the profile as on the Roster (walk 15 T1-04, lead)', async () => {
  const { perGameFigure } = await import('./marketView');
  assert.equal(perGameFigure({ games: 1, avgNet: 7_148 }), '+$7.15K', 'one game: its total, as the Roster writes it');
  assert.equal(perGameFigure({ games: 3, avgNet: 7_148 }), '+$7.1K', 'more games: the per-game figure');
  assert.equal(perGameFigure({ games: 0, avgNet: null }), '');
});
