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
  assert.match(view.explanation, /Each game a player plays, you pay his price and collect his dividend\./);
  assert.match(view.explanation, /Example: 3\.5 net points = \$43\.8K dividend; price \$36\.8K; profit \+\$7K\./);
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

test('practice rules name the rivals and the season right after the goal (walk 4 T2-17, T4-15)', async () => {
  const { perGameRulesPresentation, practiceGoalText, rulesParagraphs } = await import('./perGameRules');
  assert.equal(
    practiceGoalText({ rivals: 4, opens: 'Oct 21', ends: 'Apr 12', days: 174 }),
    'In practice you play 4 computer rivals over one season, Oct 21 to Apr 12 (174 days).',
  );
  const ruleset = {
    dividendBasis: 'raw_net_points', dividendDollarsPerNetPoint: 4000, longSlotLimit: 10, shortSlotLimit: 5,
    transactionFeeDollars: 250, shortTermDays: 7,
  } as unknown as Parameters<typeof perGameRulesPresentation>[0];
  const first = rulesParagraphs(perGameRulesPresentation(ruleset, { rivals: 4, opens: 'Oct 21', ends: 'Apr 12', days: 174 }).explanation)[0];
  assert.match(first, /^Finish the season with the highest score on the Leaders board\. In practice you play 4 computer rivals/);
  assert.doesNotMatch(rulesParagraphs(perGameRulesPresentation(ruleset).explanation)[0], /computer rivals/);
});

test('the rules read in steps: goal, scoring with the example after net points, then short headings (walk 5 T1-09, T3-13)', async () => {
  const { perGameRulesPresentation, rulesSections, rulesSummary } = await import('./perGameRules');
  const { explanation } = perGameRulesPresentation(rules, { rivals: 4, opens: 'Oct 21', ends: 'Apr 12', days: 174 });
  const sections = rulesSections(explanation);
  assert.deepEqual(sections.map((section) => section.heading), ['Goal', 'Scoring', 'Shorts', 'Fees', 'Prices', 'Locks']);
  assert.equal(sections.map((section) => section.text).join(' '), explanation);
  // The goal stands alone; how a game scores comes next.
  assert.match(sections[0].text, /^Finish the season with the highest score on the Leaders board\. In practice you play 4 computer rivals/);
  assert.doesNotMatch(sections[0].text, /net points|dividend/);
  // The worked night follows the net-points explanation.
  const scoring = sections[1].text;
  assert.ok(scoring.indexOf('Net points boil his box score') < scoring.indexOf('Example: 3.5 net points'));
  assert.match(sections[2].text, /^A short pays you/);
  assert.match(sections[2].text, /negative/);
  assert.match(sections[3].text, /^Your score adds up the games of every player you hold or short, minus a \$[\d,]+ fee/);
  // Settings' lede: the goal and the loop in one breath.
  assert.equal(
    rulesSummary(explanation),
    `${sections[0].text} Each game a player plays, you pay his price and collect his dividend. Beat his price and you profit.`,
  );
});

test('Scoring reads as three short lines with the example set apart in K, and the glossary says what Value and last season mean (walk 6 T1-03, T1-13, T2-16)', async () => {
  const { perGameRulesPresentation, rulesSections, rulesSummary } = await import('./perGameRules');
  const ruleset = { ...rules, dividendBasis: 'raw_net_points' as const, dividendDollarsPerNetPoint: 40000 };
  const view = perGameRulesPresentation(ruleset);
  assert.deepEqual(view.scoring.lines, [
    'Each game a player plays, you pay his price and collect his dividend.',
    'His dividend is his net points each game × $40K.',
    // A bad game's below-zero dividend, where a roster-only player looks (walk 8 T1-01).
    'A bad game can push his dividend below zero, and you pay that too.',
    'Beat his price and you profit.',
  ]);
  assert.equal(view.scoring.example, 'Example: 3.5 net points = $140K dividend; price $118K; profit +$22K.');
  // The sheet draws the same words the explanation holds, in order.
  const scoring = rulesSections(view.explanation).find((section) => section.heading === 'Scoring');
  assert.equal(scoring?.text, [...view.scoring.lines, view.scoring.netPoints, view.scoring.example, view.scoring.luck].join(' '));
  // Settings' lede keeps the loop in one breath.
  assert.match(rulesSummary(view.explanation) ?? '', /Each game a player plays, you pay his price and collect his dividend\. Beat his price and you profit\.$/);
  const meaning = (term: string) => view.glossary.find((entry) => entry.term === term)?.meaning ?? '';
  assert.match(meaning('Value'), /For a player you hold, it is measured against the price you locked\./);
  assert.match(meaning('Dividend last season'), /a guide, not a promise\. Players usually pay out less than last season, and prices already expect part of that\./);
  assert.doesNotMatch(meaning('Dividend last season'), /best guide/);
  // The projection basis says so in its line.
  assert.match(perGameRulesPresentation({ ...ruleset, dividendBasis: 'surprise_vs_projection' }).scoring.lines[1], /beat his pregame projection, × \$40K\.$/);
});

test('Scoring says a bad game can push a dividend below zero, and a roster spot pays it (walk 8 T1-01)', () => {
  const view = perGameRulesPresentation(rules);
  assert.ok(view.scoring.lines.includes('A bad game can push his dividend below zero, and you pay that too.'));
  const scoring = rulesParagraphs(view.explanation).find((paragraph) => paragraph.startsWith('Each game a player plays'));
  assert.ok(scoring?.includes('below zero, and you pay that too'));
  assert.equal(rulesParagraphs(view.explanation).join(' '), view.explanation);
});

test('the rules list the keys in plain words (walk 12 T3-N1)', async () => {
  const { KEYBOARD_KEYS } = await import('./perGameRules');
  const keys = KEYBOARD_KEYS.map((entry) => entry.keys);
  assert.deepEqual(keys, ['Tab', 'Enter or Space', 'Arrow keys', 'Score chart', 'Escape', 'Home and End', 'Market list']);
  const all = KEYBOARD_KEYS.map((entry) => entry.does).join(' ');
  assert.match(all, /Skip to content/);
  assert.match(all, /Page Up and Page Down a week/);
  assert.doesNotMatch(all, /—|—/);
});
