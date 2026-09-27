import assert from 'node:assert/strict';
import test from 'node:test';

import {
  confirmCloseMessage,
  moneyCompact,
  signedMoneyCompact,
  CONFIRM_LABEL,
  closeActionName,
  confirmCloseButton,
  ordinalWords,
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
  assert.equal(money(1_300_000), '$1.30M');
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
  assert.equal(moneyFine(3_500), '$3.5K');
  assert.equal(moneyFine(1_250), '$1.25K');
  assert.equal(moneyFine(9_000), '$9K');
  assert.equal(moneyFine(9_996), '$10K');
  assert.equal(moneyFine(250), '$250');
  assert.equal(moneyFine(7_173), '$7.17K');
  assert.equal(moneyFine(137_500), '$137.5K');
  assert.equal(moneyFine(288_000), '$288K');
  assert.equal(moneyFine(4_850_000), '$4.85M');
  assert.equal(moneyFine(5_200_000), '$5.20M');
  assert.equal(moneyFine(999_960), '$1.00M');
  assert.equal(moneyFine(-80_250), '-$80.3K');
  assert.equal(signedMoneyFine(150_500), '+$150.5K');
  assert.equal(signedMoneyFine(-3_500), '-$3.5K');
  assert.equal(signedMoneyFine(0), '$0');
  assert.equal(exactSignedMoney(0), '$0');
});

test('names keep their hyphen together', () => {
  assert.equal(unbrokenName('Shai Gilgeous-Alexander'), 'Shai Gilgeous\u2011Alexander');
  assert.equal(unbrokenName('Nikola Jokic'), 'Nikola Jokic');
});

test('one lock sentence and one confirm line everywhere', () => {
  assert.equal(rosterReopensLine('2025-10-31'), 'Moves reopen after Oct 31');
  assert.equal(rosterReopensLine(null), 'Moves reopen after these games');
  assert.equal(CONFIRM_LABEL, 'Confirm');
  // Names start with the button's own words, for voice control (walk 8 T3-16).
  assert.equal(confirmCloseName('long', 'Nikola Jokic', 250), 'Drop for $250, Nikola Jokic');
  assert.equal(confirmCloseName('short', 'Tyrese Maxey', 250), 'Close for $250, your short on Tyrese Maxey');
  assert.equal(confirmCloseName('long', 'Nikola Jokic'), 'Drop, Nikola Jokic');
  assert.equal(confirmCloseLine('long', 250, 764_000), '$250 fee · his +$764K stays in your score');
  assert.equal(confirmCloseLine('short', 250, -45_500), "$250 fee · this short's -$45.5K stays in your score");
  assert.equal(confirmCloseLine('long', 0, 0), 'his $0 stays in your score');
});

test('one money format everywhere, and shared action wording', () => {
  assert.equal(money(237_500), '$237.5K');
  assert.equal(signedMoney(1_062_500), '+$1.06M');
  assert.equal(signedMoney(3_500), '+$3.5K');
  assert.equal(closeActionName('long', 'Nikola Jokic'), 'Drop Nikola Jokic');
  assert.equal(closeActionName('short', 'Luka Doncic'), 'Close your short on Luka Doncic');
  assert.equal(confirmCloseButton('long', 250), 'Drop for $250');
  assert.equal(confirmCloseButton('short', 250), 'Close for $250');
  assert.equal(spoken('Paid $584K · price $137.5K'), 'Paid $584K, price $137.5K');
});

test('a Drop or Close asks once, with the fee, what stays and what coming back costs', () => {
  assert.equal(
    confirmCloseMessage({ side: 'long', playerName: 'Nikola Jokic', feeDollars: 250, total: 4_000, priceNow: 98_800 }),
    'Drop Nikola Jokic for a $250 fee? His +$4K stays in your score. Adding him back later costs his price at that time (today about $98.8K a game), plus another $250 fee.',
  );
  assert.equal(
    confirmCloseMessage({ side: 'short', playerName: 'Bam Adebayo', feeDollars: 250, total: -12_500, endsFreeAfter: '2025-10-27' }),
    "Close your short on Bam Adebayo for a $250 fee? This short's -$12.5K stays in your score. Left alone, it ends by itself after Oct 27, at no cost. Shorting him again later sets a new price, plus another $250 fee.",
  );
  assert.equal(
    confirmCloseMessage({ side: 'long', playerName: 'LeBron James', feeDollars: 0, total: 0 }),
    'Drop LeBron James? His games have not changed your score yet. Adding him back later costs his price at that time.',
  );
  // Before his first game only the add fee is in the score (walk 6 T4-02).
  assert.equal(
    confirmCloseMessage({ side: 'long', playerName: 'Luka Doncic', feeDollars: 250, total: 0, priceNow: 418_500 }),
    'Drop Luka Doncic for a $250 fee? His games have not changed your score yet; only his $250 add fee has. Adding him back later costs his price at that time (today about $418.5K a game), plus another $250 fee.',
  );
});

test('per-game columns read one style: K from $1,000, dollars below', () => {
  assert.equal(moneyCompact(6_500), '$6.5K');
  assert.equal(moneyCompact(9_432), '$9.4K');
  assert.equal(moneyCompact(21_500), '$21.5K');
  assert.equal(moneyCompact(950), '$950');
  assert.equal(moneyCompact(1_062_500), '$1.06M');
  assert.equal(signedMoneyCompact(-4_000), '-$4K');
  assert.equal(signedMoneyCompact(0), '$0');
});

test('several nights at once name their days (walk 3 T1-20)', async () => {
  const { humanNightsSince } = await import('./terms');
  assert.equal(humanNightsSince('2025-10-20', '2025-10-27'), 'Oct 21–27');
  assert.equal(humanNightsSince('2025-10-27', '2025-11-03'), 'Oct 28–Nov 3');
  assert.equal(humanNightsSince('2025-10-20', '2025-10-21'), 'Oct 21');
  assert.equal(humanNightsSince(null, '2025-10-21'), 'Oct 21');
});

test('notices read places in words, even when "#2 of 5" is held together (walk 6 T3-07)', () => {
  assert.equal(spoken('Season complete. Final score +$4.13M, #2\u00a0of\u00a05.'), 'Season complete. Final score +$4.13M, second of 5.');
  assert.equal(spoken('New practice season. Your last one finished +$5.5M, #1 of 5.'), 'New practice season. Your last one finished +$5.5M, first of 5.');
  assert.equal(spoken('$12K behind #2'), '$12K behind second place');
  assert.equal(ordinalWords(22), '22nd');
});

test('a half always rounds up, in K and in millions, whatever its binary fraction (walk 14 lead)', () => {
  // toFixed read 2.065 as 2.06499… and 1.075 as 1.07499…: those halves went down, others up.
  assert.equal(moneyFine(2_065_000), '$2.07M');
  assert.equal(moneyFine(2_075_000), '$2.08M');
  assert.equal(moneyFine(-2_065_000), '-$2.07M');
  assert.equal(moneyFine(1_075_000), '$1.08M');
  assert.equal(moneyFine(1_605_000), '$1.61M');
  assert.equal(moneyFine(121_050), '$121.1K');
  assert.equal(moneyFine(137_450), '$137.5K');
  assert.equal(moneyCompact(1_605_000), '$1.61M');
  // The edges between K and M, and between two and one K decimals, hold.
  assert.equal(moneyFine(999_950), '$1.00M');
  assert.equal(moneyFine(999_949), '$999.9K');
  assert.equal(moneyFine(9_994), '$9.99K');
  assert.equal(moneyFine(9_995), '$10K');
  assert.equal(moneyFine(1_000), '$1K');
});
