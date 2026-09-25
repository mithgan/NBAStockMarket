import assert from 'node:assert/strict';
import test from 'node:test';

import {
  closeVerb,
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
  assert.match(SHORT_EXPLAINER, /short pays you when he scores less than his price/);
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
  assert.equal(perGame(237_500), '$238K a game');
  assert.equal(perGameShort(105_000), '$105K/game');
  assert.equal(money(1_300_000), '$1.3M');
  assert.equal(signedMoney(-66_500), '-$67K');
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
