import assert from 'node:assert/strict';
import test from 'node:test';

import { searchFocusOnOpen } from './marketView';

test('"Search & sort" puts the caret in the search box for a key or a mouse click, not a tap (walk 13 T2-10)', () => {
  assert.equal(searchFocusOnOpen(false, null), true, 'a key press');
  assert.equal(searchFocusOnOpen(true, 'mouse'), true, 'a mouse click');
  assert.equal(searchFocusOnOpen(true, 'touch'), false, 'a finger: no on-screen keyboard over the list');
  assert.equal(searchFocusOnOpen(true, 'pen'), false, 'a pen');
  assert.equal(searchFocusOnOpen(true, null), false, 'a pointer of unknown kind keeps the old behaviour');
});

test('the phone Market says what Value is, true to the side (walk 13 T1-01)', async () => {
  const { valueDefinition } = await import('./marketView');
  assert.equal(valueDefinition('long'), "Value: last season's dividend a game minus today's price.");
  assert.equal(valueDefinition('short'), "Value: today's price minus last season's dividend a game.");
  assert.equal(valueDefinition('long', true), "Value: last season's dividend minus his price.", 'one line at 320px');
  const { forgetMarket, marketMemory, rememberMarket } = await import('./marketViewMemory');
  forgetMarket();
  assert.equal(marketMemory().valueTipSeen, false, 'a new session shows it');
  rememberMarket({ valueTipSeen: true });
  assert.equal(marketMemory().valueTipSeen, true, 'later visits leave the rows its room');
  forgetMarket();
  assert.equal(marketMemory().valueTipSeen, false, 'Restart shows it again');
});

test('a held row names its Value at your price, and today\'s price has its noun (walk 13 T1-05)', async () => {
  const { heldValueLine, heldValuePhrase } = await import('./marketView');
  const doncic = { currentGameCost: 418_500, priorSeasonValuePerGame: 488_500 };
  const line = heldValueLine(doncic, 'long', 417_500);
  assert.equal(`${line.value} · ${line.now}`, 'Value +$71K at your price · price now $418.5K');
  assert.doesNotMatch(line.value, /^Last season/, 'never money he made you last season');
  assert.equal(heldValuePhrase(doncic, 'long', 417_500), 'value +$71K a game at your price, dividend $488.5K a game, price now $418.5K a game');
});

test('a quick comeback after a Drop or Close asks first (walk 13 T4-11)', async () => {
  const { JUST_OPENED_MS, REOPEN_ASKS_WITHIN_MS, reopenAsks, reopenQuestion } = await import('./marketView');
  const landed = 1_000_000;
  assert.equal(reopenAsks(landed, landed + JUST_OPENED_MS + 50), true, 'a tap where the tick just was');
  assert.equal(reopenAsks(landed, landed + REOPEN_ASKS_WITHIN_MS - 1), true);
  assert.equal(reopenAsks(landed, landed + REOPEN_ASKS_WITHIN_MS), false, 'later, Add acts at once');
  assert.equal(reopenAsks(0, landed), false, 'no drop on this row');
  assert.ok(REOPEN_ASKS_WITHIN_MS - JUST_OPENED_MS >= 3000, 'asks for at least 3 s after the tick ends');
  const long = reopenQuestion('long', 'Devin Booker', 336_100, 250);
  assert.equal(long.message, 'Add Devin Booker back at $336.1K a game? You dropped him a moment ago. Another $250 fee.');
  assert.equal(long.confirm, 'Add back for $250');
  assert.equal(long.cancel, 'Not now');
  assert.equal(long.kept, 'Devin Booker stays off your roster.');
  const short = reopenQuestion('short', 'Devin Booker', 336_100, 250);
  assert.equal(short.message, 'Short Devin Booker again at $336.1K a game? You closed that short a moment ago. Another $250 fee.');
  assert.equal(short.confirm, 'Short again for $250');
});

test('the kept-order line says what moved and why the order stayed, in the room it has (walk 13 T1-17)', async () => {
  const { heldOrderLine, orderLine, orderLineForm } = await import('./marketView');
  assert.equal(orderLineForm(320, false), 'short');
  assert.equal(orderLineForm(389, false), 'short');
  assert.equal(orderLineForm(390, false), 'phone');
  assert.equal(orderLineForm(768, true), 'long');
  assert.equal(heldOrderLine('2025-10-20', '2025-10-21', 'short'), 'Order kept so rows stay put');
  assert.equal(heldOrderLine('2025-10-20', '2025-10-21', 'phone'), 'Values moved; order kept so rows stay put.');
  assert.equal(heldOrderLine('2025-10-20', '2025-10-21', 'phone', 'price'), 'Prices moved; order kept so rows stay put.');
  assert.equal(heldOrderLine('2025-10-20', '2025-10-21', 'long', 'price'), 'Prices moved in the Oct 21 games; order kept so rows stay put.');
  for (const form of ['short', 'phone', 'long'] as const) {
    const line = orderLine({ sort: 'value', reversed: false, heldNote: null, form });
    assert.equal(line.reserve, heldOrderLine('2025-10-20', '2025-10-27', form), `${form}: the reserve is its own held wording`);
  }
});

test('below 360px a search in progress takes Watching\'s words, so the query stays readable (walk 13 T4-06)', async () => {
  const { searchWidens, SEARCH_WIDENS_BELOW } = await import('./marketView');
  assert.equal(SEARCH_WIDENS_BELOW, 360);
  assert.equal(searchWidens(320, false, ''), false, 'at rest, Watching keeps its word');
  assert.equal(searchWidens(320, true, ''), true, 'focused');
  assert.equal(searchWidens(320, false, 'Gilgeous'), true, 'holding a search, even after the keyboard goes');
  assert.equal(searchWidens(360, true, 'Gilgeous'), false, 'from 360px the box has room');
});

test('a table row header is named for the player alone; "view profile" stays on his button (walk 13 T3-03)', async () => {
  const { rowHeaderLabel, rowHeaderName } = await import('./marketView');
  assert.equal(rowHeaderName({ name: 'Luka Doncic', tier: 'star' }), 'Luka Doncic, star');
  assert.equal(rowHeaderName({ name: 'Luka Doncic', tier: 'star', tag: 'On your roster' }), 'Luka Doncic, star, on your roster');
  assert.doesNotMatch(rowHeaderName({ name: 'Kon Knueppel', tier: 'role' }), /view profile/i);
  assert.equal(rowHeaderLabel({ name: 'Luka Doncic', tier: 'star', tag: 'On your roster' }), 'Luka Doncic, star, on your roster, view profile', 'the button keeps its way in');
});
