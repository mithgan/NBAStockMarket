import assert from 'node:assert/strict';
import test from 'node:test';

import {
  confirmCloseMessage,
  CONFIRM_LABEL,
  closeActionName,
  confirmCloseButton,
  spoken,
  closeVerb,
  confirmCloseLine,
  confirmCloseName,
  rosterReopensLine,
  exactSignedMoney,
  moneyFine,
  signedMoneyFine,
  unbrokenName,
  gamesCount,
  humanDate,
  humanDateWithYear,
  humanDay,
  money,
  nightsCount,
  openVerb,
  perGame,
  perGameShort,
  SHORT_EXPLAINER,
  sideHeading,
  sideLabel,
  signedMoney,
} from './terms';

test('sides are called Roster and Short, never inverse', () => {
  assert.equal(sideLabel('long'), 'Roster');
  assert.equal(sideLabel('short'), 'Short');
  assert.equal(sideHeading('short'), 'Your shorts');
  assert.equal(openVerb('long'), 'Add');
  assert.equal(openVerb('short'), 'Short');
  assert.equal(closeVerb('long'), 'Drop');
  assert.equal(closeVerb('short'), 'Close');
  assert.doesNotMatch(SHORT_EXPLAINER, /inverse/i);
  assert.match(SHORT_EXPLAINER, /short pays you when his dividend comes in under his price/);
});

test('game dates read as people say them, not as ISO strings', () => {
  assert.equal(humanDate('2025-11-06'), 'Nov 6');
  assert.equal(humanDate('2025-11-06T23:10:00Z'), 'Nov 6');
  assert.equal(humanDay('2025-11-05'), 'Wed, Nov 5');
  assert.equal(humanDateWithYear('2025-11-06'), 'Nov 6, 2025');
  assert.equal(humanDate(null), '');
  assert.equal(humanDate('not-a-date'), 'not-a-date');
});

test('prices are per game in words, never /GM or spelled-out dollars', () => {
  assert.equal(perGame(237_500), '$237.5K a game');
  assert.equal(perGameShort(105_000), '$105K/game');
  assert.equal(money(1_300_000), '$1.3M');
  assert.equal(signedMoney(-66_500), '-$66.5K');
  assert.equal(signedMoney(0), '$0');
  assert.equal(signedMoney(-0.4), '$0');
  assert.doesNotMatch(perGame(237_500), /GM|dollars/);
});

test('counts pluralise', () => {
  assert.equal(gamesCount(1), '1 game');
  assert.equal(gamesCount(12), '12 games');
  assert.equal(nightsCount(7), '7 nights');
});

test('fine money keeps figures that sit side by side honest', () => {
  assert.equal(moneyFine(3_500), '$3,500');
  assert.equal(moneyFine(137_500), '$137.5K');
  assert.equal(moneyFine(288_000), '$288K');
  assert.equal(moneyFine(4_850_000), '$4.85M');
  assert.equal(moneyFine(5_200_000), '$5.2M');
  assert.equal(moneyFine(999_960), '$1M');
  assert.equal(moneyFine(-80_250), '-$80.3K');
  assert.equal(signedMoneyFine(150_500), '+$150.5K');
  assert.equal(signedMoneyFine(-3_500), '-$3,500');
  assert.equal(signedMoneyFine(0), '$0');
  assert.equal(exactSignedMoney(0), '$0');
});

test('names keep their hyphen together', () => {
  assert.equal(unbrokenName('Shai Gilgeous-Alexander'), 'Shai Gilgeous\u2011Alexander');
  assert.equal(unbrokenName('Nikola Jokic'), 'Nikola Jokic');
});

test('one lock sentence and one confirm line everywhere', () => {
  assert.equal(rosterReopensLine('2025-10-31'), 'Roster reopens after Oct 31');
  assert.equal(rosterReopensLine(null), 'Roster reopens after these games');
  assert.equal(CONFIRM_LABEL, 'Confirm');
  assert.equal(confirmCloseName('long', 'Nikola Jokic'), 'Confirm dropping Nikola Jokic');
  assert.equal(confirmCloseName('short', 'Tyrese Maxey'), 'Confirm closing your short on Tyrese Maxey');
  assert.equal(confirmCloseLine('long', 250, 764_000), '$250 fee · his +$764K stays in your score');
  assert.equal(confirmCloseLine('short', 250, -45_500), "$250 fee · this short's -$45.5K stays in your score");
  assert.equal(confirmCloseLine('long', 0, 0), 'his $0 stays in your score');
});

test('one money format everywhere, and shared action wording', () => {
  assert.equal(money(237_500), '$237.5K');
  assert.equal(signedMoney(1_062_500), '+$1.06M');
  assert.equal(signedMoney(3_500), '+$3,500');
  assert.equal(closeActionName('long', 'Nikola Jokic'), 'Drop Nikola Jokic');
  assert.equal(closeActionName('short', 'Luka Doncic'), 'Close your short on Luka Doncic');
  assert.equal(confirmCloseButton('long', 250), 'Drop for $250');
  assert.equal(confirmCloseButton('short', 250), 'Close for $250');
  assert.equal(spoken('Paid $584K · price $137.5K'), 'Paid $584K, price $137.5K');
});

test('a Drop or Close asks once, with the fee, what stays and what coming back costs', () => {
  assert.equal(
    confirmCloseMessage({ side: 'long', playerName: 'Nikola Jokic', feeDollars: 250, total: 4_000, priceNow: 98_800 }),
    'Drop Nikola Jokic for a $250 fee? His +$4,000 stays in your score. Adding him back later costs his price at that time (today $98.8K a game), plus another $250 fee.',
  );
  assert.equal(
    confirmCloseMessage({ side: 'short', playerName: 'Bam Adebayo', feeDollars: 250, total: -12_500, endsFreeAfter: '2025-10-27' }),
    "Close your short on Bam Adebayo for a $250 fee? This short's -$12.5K stays in your score. Left alone, it ends by itself after the Oct 27 games, at no cost. Shorting him again later sets a new price, plus another $250 fee.",
  );
  assert.equal(
    confirmCloseMessage({ side: 'long', playerName: 'LeBron James', feeDollars: 0, total: 0 }),
    'Drop LeBron James? He has not changed your score yet. Adding him back later costs his price at that time.',
  );
});
