import assert from 'node:assert/strict';
import test from 'node:test';

import { phoneRowFloor } from './marketView';

test('a phone list keeps one row height: the tallest row\'s, never lowered (walk 18 T3-10)', () => {
  // Text spacing at 375: 95, 113, 130 and 136px rows become one height.
  assert.equal(phoneRowFloor(0, [81, 99, 116, 99]), 116);
  // A held row whose lines got shorter after its first game keeps the room.
  assert.equal(phoneRowFloor(116, [81]), 116);
  // Sub-pixel rounding never raises it; a real extra line does.
  assert.equal(phoneRowFloor(116, [116.4]), 116);
  assert.equal(phoneRowFloor(116, [134]), 134);
  assert.equal(phoneRowFloor(0, [112.2]), 113);
  assert.equal(phoneRowFloor(0, [Number.NaN, 0]), 0, 'nothing measured yet');
});

test('a reader\'s text spacing is a size of its own for the list\'s wording (walk 18 T3-10)', async () => {
  const { rememberTierOnGiven, tierAfterSurnameKey, tierOnGivenKnown } = await import('./marketViewMemory');
  const plain = tierAfterSurnameKey(375, 1);
  const spaced = tierAfterSurnameKey(375, 1, '1.92px/2.56px/24px');
  assert.notEqual(plain, spaced);
  assert.equal(plain, '375|1', 'the plain key is unchanged');
  assert.equal(tierOnGivenKnown(spaced), false, 'decided by measuring the list');
  rememberTierOnGiven(spaced);
  assert.equal(tierOnGivenKnown(spaced), true);
  assert.equal(tierOnGivenKnown(plain), false, 'the plain list keeps the tier after the surname at 375');
});

test('a phone\'s kept order says what moved and what was kept (walk 18 T1-06)', async () => {
  const { heldOrderLine } = await import('./marketView');
  assert.equal(heldOrderLine('2025-10-20', '2025-10-21', 'phone'), 'Rows kept as values moved');
  assert.equal(heldOrderLine('2025-10-20', '2025-10-21', 'short', 'price'), 'Rows kept as prices moved');
  assert.equal(heldOrderLine('2025-10-20', '2025-10-21', 'long'), 'Values moved in the Oct 21 games; order kept so rows stay put.', 'tables keep their sentence');
});

test('a LOCKED tap during a run is answered on its own row, not by the notice (walk 18 T1-12)', async () => {
  const { lockAnswerOnRow } = await import('./marketView');
  const now = 100_000;
  assert.equal(lockAnswerOnRow(null, now - 60_000, now), false, 'outside a run the notice answers, as before');
  assert.equal(lockAnswerOnRow('Oct 28–Nov 3', now - 5_000, now), true, 'a run plays: the row answers');
  assert.equal(lockAnswerOnRow('Oct 28–Nov 3', null, now), true, 'the lock was on when the Market opened');
  assert.equal(lockAnswerOnRow('Oct 28–Nov 3', now - 300, now), false, 'a press that may have raced the new lock is the games\' notice\'s');
});

test('at season end held rows speak of the season past (walk 18 T2-17, T2-02)', async () => {
  const { heldPlayedWordings, heldPriceCaption, heldValuePhrase, narrowHeldChip } = await import('./marketView');
  const luka = { currentGameCost: 439_500, priorSeasonValuePerGame: 488_500 };
  assert.equal(narrowHeldChip(false), 'Yours');
  assert.equal(narrowHeldChip(true), 'Held', 'no present-tense "YOURS" once the season is over');
  assert.equal(heldPriceCaption(417_500, 439_500), 'now $439.5K');
  assert.equal(heldPriceCaption(417_500, 439_500, true), 'last $439.5K');
  assert.match(heldPlayedWordings(luka, 'long', 417_500, true)[0], /^Last price \$439\.5K · last season /);
  assert.equal(heldPlayedWordings(luka, 'long', 417_500)[1], 'Price now $439.5K', 'during the season unchanged');
  assert.match(heldValuePhrase(luka, 'long', 417_500, true, true), /^his last price \$439\.5K a game, /);
  assert.match(heldValuePhrase(luka, 'long', 417_500, true), /^price now \$439\.5K a game, /);
});

test('a separator never starts a wrapped value line (walk 18 T3-07)', async () => {
  const { keepSeparators, valueJoinerTail } = await import('./marketView');
  assert.equal(keepSeparators('Price now $418.2K · last season +$71K a game at your price'), 'Price now $418.2K · last season +$71K a game at your price');
  assert.equal(valueJoinerTail(true), ' ·', 'on one line the dot ends the first part, held to its word');
  assert.equal(valueJoinerTail(false), '', 'on two lines there is no dot');
});

test('a folded toolbar names an active search or Watching filter in a chip (walk 18 T4-10)', async () => {
  const { filterChip } = await import('./marketView');
  assert.equal(filterChip({ query: '', watchedOnly: false, count: 30, total: 30 }), null);
  const search = filterChip({ query: 'ja ', watchedOnly: false, count: 4, total: 30 });
  assert.equal(search?.text, '“ja” · 4 of 30');
  assert.equal(search?.clearName, 'Clear the search "ja", show all 30');
  assert.equal(search?.spoken, 'Search "ja": 4 of 30 players');
  const watching = filterChip({ query: '', watchedOnly: true, count: 3, total: 30 });
  assert.equal(watching?.text, 'Watching · 3 of 30');
  assert.equal(watching?.clearName, 'Stop showing only Watching, show all 30');
});
