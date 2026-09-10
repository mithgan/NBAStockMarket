import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { parsePerGameBootstrap } from '../api/contracts';
import { perGameRulesPresentation, positionSlotHint } from './perGameRules';

const example = JSON.parse(readFileSync(resolve(import.meta.dirname, '../api/fixtures/perGameApiExample.json'), 'utf8'));
const rules = parsePerGameBootstrap(example.bootstrap).ruleset;

test('rules explain the actual basis, fees, expiry and zero starting score', () => {
  const view = perGameRulesPresentation({ ...rules, dividendDollarsPerNetPoint: 12500, transactionFeeDollars: 750, longSlotLimit: 4, shortSlotLimit: 2, shortTermDays: null });
  const facts = Object.fromEntries(view.facts.map(({ label, value }) => [label, value]));
  assert.equal(facts['Starting score'], '$0');
  assert.equal(facts['Dividend rate'], '$12,500 per net point');
  assert.equal(facts['Open fee'], '$750');
  assert.equal(facts['Drop fee'], '$750');
  assert.equal(facts['Roster slots'], '4');
  assert.equal(facts['Inverse slots'], '2');
  assert.equal(facts['Inverse term'], 'No expiry');
  assert.match(view.explanation, /raw net points/);
  assert.doesNotMatch(view.explanation, /projected|bankroll/);
});

test('comparison rules name projection surprise only when that basis is active', () => {
  const view = perGameRulesPresentation({ ...rules, dividendBasis: 'surprise_vs_projection', shortTermDays: 3 });
  assert.match(view.explanation, /projection/);
  assert.equal(view.facts.find((fact) => fact.label === 'Inverse term')?.value, '3 days');
});

test('market accessibility hints use current server slot limits', () => {
  assert.equal(positionSlotHint('long', 4), 'Add players to your 4-player roster');
  assert.equal(positionSlotHint('short', 2), 'Open inverse positions in up to 2 slots');
});
