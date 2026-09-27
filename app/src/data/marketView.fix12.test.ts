import assert from 'node:assert/strict';
import test from 'node:test';

import {
  heldLineWordings,
  keepListOrder,
  otherSideGroup,
  otherSideGroupLine,
  pinnedChromeTooTall,
  questionScrollDelta,
  seasonEndExplainer,
  tickPressNotice,
} from './marketView';

const row = (playerId: string, blockedByOpposingPosition = false) => ({ player: { playerId }, blockedByOpposingPosition });

// walk 12 T2-04: after a short from the profile, "Shorted: …" sat over Towns,
// Cunningham and Knueppel (live ADD buttons) in the held order.
test('the other side\'s line goes over its own group at the end, never over players it does not describe', () => {
  const fresh = [row('booker'), row('towns'), row('cade'), row('kon'), row('duren', true)];
  assert.deepEqual(otherSideGroup(fresh), { firstId: 'duren', count: 1 });
  // Towns shorted from his profile: the held order keeps him in place.
  const held = keepListOrder(
    [row('booker'), row('cade'), row('kon'), row('towns', true), row('duren', true)],
    fresh.map((r) => r.player.playerId),
  );
  assert.deepEqual(held.map((r) => r.player.playerId), ['booker', 'towns', 'cade', 'kon', 'duren']);
  assert.deepEqual(otherSideGroup(held), { firstId: 'duren', count: 1 }, 'Towns keeps his place with no line');
  // Only Towns held on the other side, mid-list: no line at all.
  assert.equal(otherSideGroup([row('booker'), row('towns', true), row('cade'), row('kon')]), null);
  // Re-sorted: he joins the group, and the line counts both.
  assert.deepEqual(otherSideGroup([row('booker'), row('cade'), row('kon'), row('towns', true), row('duren', true)]), { firstId: 'towns', count: 2 });
  // One closed in the middle of the group: the line goes over the run that ends the list.
  assert.deepEqual(otherSideGroup([row('booker'), row('a', true), row('b'), row('c', true)]), { firstId: 'c', count: 1 });
  assert.equal(otherSideGroup([]), null);
});

test('the group line is worded for one player or several', () => {
  assert.equal(otherSideGroupLine('long', false, 1), 'Shorted: to add him, close his short first');
  assert.equal(otherSideGroupLine('long', false, 3), 'Shorted: to add one of them, close his short first');
  assert.equal(otherSideGroupLine('short', false, 1), 'On your roster: to short him, drop him there first');
  assert.equal(otherSideGroupLine('short', false, 2), 'On your roster: to short one of them, drop him there first');
  assert.equal(otherSideGroupLine('long', true, 1), 'Shorted this season');
  assert.equal(otherSideGroupLine('short', true, 1), 'On your roster this season');
});

// walk 12 T2-05: at season end the helper said Values show "how each player did
// against his price", but Value is still last season's dividend minus his price.
test('the season-end sentence says what Value is, and where your own players\' season is', () => {
  assert.equal(seasonEndExplainer('long', 0), "The season is over. Value still compares last season's dividend with his price.");
  assert.equal(
    seasonEndExplainer('long', 2),
    "The season is over. Value still compares last season's dividend with his price. Your profit a game shows how your players did.",
  );
  assert.doesNotMatch(seasonEndExplainer('long', 2), /how each player did/);
  assert.equal(seasonEndExplainer('short', 2), 'The season is over. Shorts open again in a new season.');
});

// walk 12 T4-06: turned to landscape, the Drop question and its focused Keep sat below the fold.
test('an open question comes back into the list\'s view after a resize, its buttons first', () => {
  const view = { top: 50, bottom: 297 };
  // Below the fold (Keep at y=429 in a 390px window): scrolled up just enough.
  assert.equal(questionScrollDelta(view, { top: 250, bottom: 380 }), 380 + 8 - 297);
  // Above the top: scrolled back just enough.
  assert.equal(questionScrollDelta(view, { top: 20, bottom: 150 }), 20 - 8 - 50);
  // Already clear: stays put.
  assert.equal(questionScrollDelta(view, { top: 100, bottom: 250 }), 0);
  // Taller than the view (row and question, 264px, in 247px): the question's end at the bottom.
  assert.equal(questionScrollDelta(view, { top: 300, bottom: 564 }), 564 + 8 - 297);
  assert.equal(questionScrollDelta(view, { top: -200, bottom: 64 }), 64 + 8 - 297);
});

// walk 12 T2-03: a portrait iPad (768x1024) folded search, sort and Watching behind "Search & sort".
test('the toolbar folds by measurement in short windows only', () => {
  assert.equal(pinnedChromeTooTall(555, 1024), false, '768x1024 keeps search, sort and Watching out');
  assert.equal(pinnedChromeTooTall(480, 900), false, '768x900 too');
  assert.equal(pinnedChromeTooTall(430, 880), true, 'a shorter window still folds');
  assert.equal(pinnedChromeTooTall(206, 600), true, '960x600 still folds');
});

// walk 12 T1-05: at 360px "(a below-zero" / "night)" and "+$5.50M over 82" / "games".
test('a held row\'s first line tries shorter wordings, each phrase kept whole', () => {
  const nb = (text: string) => text.replace(/ /g, '\u00A0');
  const night = heldLineWordings({ text: '-$315K in 1 game', total: '-$315K in 1 game', why: 'a below-zero night' });
  assert.deepEqual(night, [
    { text: nb('-$315K in 1 game'), why: nb('a below-zero night') },
    { text: nb('-$315K in 1 game'), why: nb('below zero') },
    { text: nb('-$315K in 1 game'), why: null },
    { text: '-$315K', why: null },
  ]);
  const season = heldLineWordings({ text: '+$5.50M over 82 games, +$67.1K a game', total: '+$5.50M over 82 games', why: null });
  assert.deepEqual(season.map((step) => step.text), [
    `${nb('+$5.50M over 82 games')}, ${nb('+$67.1K a game')}`,
    nb('+$5.50M over 82 games'),
    '+$5.50M',
  ]);
  // Below 360px the why starts short.
  assert.equal(heldLineWordings({ text: '-$315K in 1 game', total: '-$315K in 1 game', why: 'a below-zero night' }, true)[0].why, nb('below zero'));
  assert.deepEqual(heldLineWordings({ text: 'no games yet', total: 'no games yet', why: null }), [{ text: nb('no games yet'), why: null }]);
});

// walk 12 T4-02: a click on "Dropped ✓" during its tick did nothing and said nothing.
test('a press on the tick says what the move did and what the button does next', () => {
  assert.equal(tickPressNotice('long', 'Luka Doncic', true, 250), 'Luka Doncic dropped. Changed your mind? Press Add when it shows: $250\u00A0fee.');
  assert.equal(tickPressNotice('long', 'Luka Doncic', false, 250), 'Luka Doncic added. Changed your mind? Press Drop when it shows: $250\u00A0fee.');
  assert.equal(tickPressNotice('short', 'Jalen Duren', true, 250), 'Short on Jalen Duren closed. Changed your mind? Press Short when it shows: $250\u00A0fee.');
  assert.equal(tickPressNotice('short', 'Jalen Duren', false, 0), 'Shorted Jalen Duren. Changed your mind? Press Close when it shows.');
  assert.equal(tickPressNotice('long', 'Luka Doncic', false, 250, true), 'Adding Luka Doncic now.');
  assert.equal(tickPressNotice('long', 'Luka Doncic', true, 250, true), 'Dropping Luka Doncic now.');
});
