import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { parsePerGameBootstrap } from '../api/contracts';
import { perGameRulesPresentation, positionSlotHint, rulesParagraphs } from './perGameRules';

const example = JSON.parse(readFileSync(resolve(import.meta.dirname, '../api/fixtures/perGameApiExample.json'), 'utf8'));
const rules = parsePerGameBootstrap(example.bootstrap).ruleset;

test('rules explain the actual basis, fees, expiry and zero starting score', () => {
  const view = perGameRulesPresentation({ ...rules, dividendDollarsPerNetPoint: 12500, transactionFeeDollars: 750, longSlotLimit: 4, shortSlotLimit: 2, shortTermDays: null });
  const facts = Object.fromEntries(view.facts.map(({ label, value }) => [label, value]));
  assert.equal(facts['Starting score'], '$0');
  assert.equal(facts['Dividend rate'], '$12,500 for each net point');
  // The loop and one worked night come first, with the real rate.
  // The goal first, then the loop and one worked night, with the real rate.
  assert.match(view.explanation, /^Finish the season with the highest score on the Leaders board\./);
  assert.match(view.explanation, /Each game he plays, you pay his price and collect his dividend\./);
  assert.match(view.explanation, /For example, a game of 3\.5 net points pays a \$43,750 dividend; at a \$37,000 price, you made \$6,750\./);
  assert.equal(facts['Open fee'], '$750');
  assert.equal(facts['Drop fee'], '$750');
  assert.equal(facts['Roster slots'], '4');
  assert.equal(facts['Short slots'], '2');
  assert.equal(facts['Shorts last'], 'Until you close them');
  assert.match(view.explanation, /his net points each game/);
  assert.doesNotMatch(view.explanation, /projected|bankroll/);
});

test('comparison rules name projection surprise only when that basis is active', () => {
  const view = perGameRulesPresentation({ ...rules, dividendBasis: 'surprise_vs_projection', shortTermDays: 3 });
  assert.match(view.explanation, /projection/);
  assert.equal(view.facts.find((fact) => fact.label === 'Shorts last')?.value, '3 days');
});

test('market accessibility hints use current server slot limits', () => {
  assert.equal(positionSlotHint('long', 4), 'Add players to your 4-player roster');
  assert.equal(positionSlotHint('short', 2), 'Short up to 2 players');
});

test('the rules read as short paragraphs without losing a word', () => {
  const { explanation } = perGameRulesPresentation(rules);
  const paragraphs = rulesParagraphs(explanation);
  assert.ok(paragraphs.length >= 4);
  assert.equal(paragraphs.join(' '), explanation);
  assert.ok(paragraphs.some((paragraph) => /negative/.test(paragraph)));
  assert.ok(paragraphs.some((paragraph) => /locked for as long as you hold him/.test(paragraph)));
  assert.match(paragraphs[paragraphs.length - 1], /moves pause/);
  assert.match(explanation, /minus a \$\d[\d,]* fee each time you add or drop a player, or open or close a short/);
  const glossary = perGameRulesPresentation(rules).glossary;
  assert.equal(glossary.length, 9);
  // The market's two value words are defined where the rules define the rest.
  assert.ok(glossary.some((entry) => entry.term === 'Value'));
  assert.ok(glossary.some((entry) => entry.term === 'Dividend last season'));
});
