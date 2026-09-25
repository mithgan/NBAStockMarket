import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const source = (path: string) => readFileSync(resolve(import.meta.dirname, path), 'utf8');
const optionalSource = (path: string) => {
  const full = resolve(import.meta.dirname, path);
  return existsSync(full) ? readFileSync(full, 'utf8') : '';
};
const app = source('../../App.tsx');
const context = source('../state/PerGameContext.tsx');
const state = source('../state/perGameState.ts');
const roster = source('../screens/PerGameRosterScreen.tsx');
const market = source('../screens/PerGameMarketScreen.tsx');
const results = source('../screens/PerGameResultsScreen.tsx');
const leaders = source('../screens/PerGameLeaderboardScreen.tsx');
const chart = source('../components/PerGamePnlChart.tsx');
const status = source('../components/PerGameStatusStrip.tsx');
const simBar = source('../components/SimBar.tsx');
const profileSheet = source('../components/PlayerProfileSheet.tsx');
const profile = optionalSource('../components/PerGamePlayerProfile.tsx');
const kit = source('../ui/kit.tsx');
const terms = source('../copy/terms.ts');
const rules = source('./perGameRules.ts');

/**
 * Every string a player can read: quoted literals, template literals with their
 * code holes removed, and JSX text that sits right before a closing tag.
 * Identifiers such as `const inverse = …` are code, not copy, and are skipped.
 */
function userFacingStrings(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)) out.push(m[1] ?? m[2] ?? '');
  for (const m of src.matchAll(/`([^`]*)`/g)) out.push(m[1].replace(/\$\{[^}]*\}/g, ' '));
  for (const m of src.matchAll(/>([^<>{}]*?)<\//g)) out.push(m[1]);
  return out;
}

const ACTIVE_SURFACES: Array<[string, string]> = [
  ['App', app],
  ['Roster', roster],
  ['Market', market],
  ['Results', results],
  ['Leaders', leaders],
  ['P&L chart', chart],
  ['Status strip', status],
  ['Practice bar', simBar],
  ['Profile sheet', profileSheet],
  ['Player profile', profile],
  ['Kit', kit],
];

test('the authenticated runtime exposes roster, market, results, and P&L leaders', () => {
  assert.match(app, /label: 'Roster'/);
  assert.match(app, /label: 'Market'/);
  assert.match(app, /label: 'Results'/);
  assert.match(app, /label: 'Leaders'/);
  assert.doesNotMatch(app, /label: 'Watch'/);
  assert.match(app, /PerGameProvider as PortfolioProvider/);
});

test('roster score starts from cumulative P&L and every position shows locked economics', () => {
  assert.match(roster, /your score/i);
  assert.match(roster, /bootstrap\.account\.cumulativePnl/);
  assert.match(roster, /lockedGameCost/);
  assert.match(roster, /cumulativeGameCost/);
  assert.match(roster, /cumulativeDividend/);
  assert.match(roster, /cumulativePnl/);
  assert.match(roster, /accessibilityLabel="Open the player market"/);
  assert.match(roster, /open market/i);
});

test('market rows expose both decision anchors and one duplicate-safe action', () => {
  assert.match(market, /currentGameCost/);
  assert.match(market, /priorSeasonValuePerGame/);
  assert.match(market, /priorSeasonValuePerGame === null/);
  assert.match(market, /pendingActions\.has\(actionKey\)/);
  assert.match(market, /pendingActions\.has\('account-mutation'\)/);
  assert.match(market, /if \(disabled\) return/);
  assert.match(market, /row\.unavailableReason/);
  assert.match(market, /<FlatList/);
});

test('the short explainer is one shared sentence in plain English', () => {
  assert.match(terms, /A short pays you when his dividend comes in under his price/);
  assert.match(rules, /SHORT_EXPLAINER/);
});

test('market explains shorts with the shared sentence and makes no stock-price claims', () => {
  assert.match(market, /SHORT_EXPLAINER/);
  assert.doesNotMatch(market, /stock price|share gain|share loss/i);
});

test('roster explains shorts with the shared sentence', () => {
  assert.match(roster, /SHORT_EXPLAINER/);
});

// One test per surface, so each owner can see their own file pass.
for (const [name, src] of [
  ...ACTIVE_SURFACES,
  ['Context notices', context],
  ['Row reasons', state],
  ['Rules', rules],
] as Array<[string, string]>) {
  test(`${name} never says "inverse" to a player`, () => {
    const hits = userFacingStrings(src).filter((text) => /\binverse\b/i.test(text));
    assert.deepEqual(hits, [], `${name} still says inverse: ${hits.join(' | ')}`);
  });
}

test('colours come from theme tokens so Appearance themes keep working', () => {
  for (const [name, src] of ACTIVE_SURFACES) {
    assert.doesNotMatch(src, /['"]#[0-9a-fA-F]{3,8}['"]/, `${name} hard-codes a hex colour`);
  }
});

test('tap targets are really 44px, not padded out with hitSlop', () => {
  for (const [name, src] of ACTIVE_SURFACES) {
    assert.doesNotMatch(src, /hitSlop=/, `${name} uses hitSlop`);
  }
});

test('settled games show arithmetic and visibly preserve corrections', () => {
  assert.match(results, /CORRECTION/);
  assert.match(results, /P&L adjustment/);
  assert.match(results, /Adjustment amount unavailable/);
  assert.doesNotMatch(results, /locked game cost was not charged again/);
  assert.match(state, /Price paid/);
  assert.match(state, /Price credited/);
  assert.match(results, /does not reconcile/);
});

test('missing projections remain visibly unsettled without fabricated P&L', () => {
  assert.match(results, /unsettled_missing_projection/);
  assert.match(results, /[Uu]nsettled|UNSETTLED/);
  assert.match(results, /Net profit and loss unavailable/);
});

test('P&L chart anchors at zero and leaders use cumulative P&L', () => {
  assert.match(chart, /buildPnlSeries/);
  assert.match(chart, /pnlChartDomain/);
  assert.match(chart, /starts at \$0/i);
  assert.match(leaders, /cumulativePnl/);
  assert.match(leaders, /[Rr]anked by/);
});

test('position mutations use global and per-player locks before transport', () => {
  assert.match(context, /MutationReconciliationCoordinator/);
  assert.match(context, /acquire\(key\)/);
  assert.match(context, /reconciliationRequired/);
  assert.match(context, /expectedAccountVersion: accountVersion/);
  assert.match(context, /expectedQuoteVersion/);
  assert.match(context, /result\.lockedGameCost/);
  assert.doesNotMatch(context, /player\.currentGameCost\.toLocaleString/);
  assert.match(market, /expectedQuoteVersion: player\.quoteVersion/);
  assert.match(context, /const refreshed = await loadSnapshot\(\)/);
  assert.doesNotMatch(context, /const refreshed = await loadSnapshot\(\{ incremental: false \}\)/);
  assert.match(status, /RECONCILE/);
});

test('active rules and lifecycle fees are visible account activity', () => {
  assert.match(status, /DIVIDEND/);
  assert.match(status, /dividendBasis/);
  assert.match(status, /dividendDollarsPerNetPoint/);
  assert.match(status, /OPEN FEE/);
  assert.match(status, /DROP FEE/);
  assert.match(status, /SHORT TERM/);
  assert.match(results, /FeeActivityRow/);
  assert.match(results, /Score change/);
});

test('server roster locks are visible and disable every mutation control accessibly', () => {
  assert.match(status, /ROSTER LOCKED/);
  assert.match(status, /rules\.rosterLockGameDate/);
  assert.match(status, /Roster changes are locked/);
  assert.match(market, /bootstrap\?\.ruleset\.rosterMutationsLocked \?\? true/);
  assert.match(market, /pending \|\| locked \|\| rosterLocked/);
  assert.match(market, /accessibilityHint=\{rosterLocked/);
  assert.match(market, /accessibilityState=\{\{ disabled \}\}/);
  assert.match(roster, /bootstrap\?\.ruleset\.rosterMutationsLocked \?\? true/);
  assert.match(roster, /pending \|\| locked \|\| rosterLocked/);
  assert.match(roster, /accessibilityHint=\{rosterLocked/);
  assert.match(roster, /accessibilityState=\{\{ disabled \}\}/);
  assert.match(roster, /rosterLocked \? 'LOCKED'/);
});

test('results use a virtualized feed and retained position names', () => {
  assert.match(results, /<FlatList/);
  assert.doesNotMatch(results, /<ScrollView/);
  assert.doesNotMatch(results, /results\.map\(/);
  assert.match(results, /perGamePlayerName/);
  assert.match(results, /initialNumToRender/);
  assert.match(results, /windowSize/);
});

test('large text reflows status, leaderboard, and result rows without truncation', () => {
  for (const screen of [status, leaders, results]) {
    assert.match(screen, /fontScale/);
    assert.doesNotMatch(screen, /numberOfLines=\{1\}/);
  }
  assert.match(status, /flexWrap: 'wrap'/);
  assert.match(leaders, /rowCompact/);
  assert.match(results, /rowHeaderCompact/);
});

test('an empty inverse roster opens Market with inverse mode selected', () => {
  assert.match(roster, /onOpenMarket\('short'\)/);
  assert.match(roster, /onOpenMarket\('long'\)/);
  assert.match(app, /marketSide/);
  assert.match(app, /<MarketScreen initialSide=\{marketSide\}/);
  assert.match(market, /initialSide/);
});

test('opposing-side market actions render as disabled and explained', () => {
  assert.match(market, /blockedByOpposingPosition/);
  assert.match(market, /BLOCKED|ON ROSTER|ON YOUR ROSTER|On your roster|SHORTED|Shorted/);
  assert.match(market, /rosterLocked \? rosterLockHint : row\.unavailableReason \?\? undefined/);
});

test('ambient web layers use style-based pointer events without deprecated View props', () => {
  assert.doesNotMatch(app, /<View[^>]*pointerEvents=/);
  assert.match(app, /pointerEvents: 'none'/);
});
