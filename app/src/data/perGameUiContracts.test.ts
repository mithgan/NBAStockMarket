import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const source = (path: string) => readFileSync(resolve(import.meta.dirname, path), 'utf8');
const app = source('../../App.tsx');
const context = source('../state/PerGameContext.tsx');
const state = source('../state/perGameState.ts');
const roster = source('../screens/PerGameRosterScreen.tsx');
const market = source('../screens/PerGameMarketScreen.tsx');
const results = source('../screens/PerGameResultsScreen.tsx');
const leaders = source('../screens/PerGameLeaderboardScreen.tsx');
const chart = source('../components/PerGamePnlChart.tsx');
const status = source('../components/PerGameStatusStrip.tsx');

test('the authenticated runtime exposes roster, market, results, and P&L leaders', () => {
  assert.match(app, /label: 'Roster'/);
  assert.match(app, /label: 'Market'/);
  assert.match(app, /label: 'Results'/);
  assert.match(app, /label: 'Leaders'/);
  assert.doesNotMatch(app, /label: 'Watch'/);
  assert.match(app, /PerGameProvider as PortfolioProvider/);
});

test('roster score starts from cumulative P&L and every position shows locked economics', () => {
  assert.match(roster, /YOUR SCORE/);
  assert.match(roster, /bootstrap\.account\.cumulativePnl/);
  assert.match(roster, /lockedGameCost/);
  assert.match(roster, /cumulativeGameCost/);
  assert.match(roster, /cumulativeDividend/);
  assert.match(roster, /cumulativePnl/);
  assert.match(roster, /accessibilityLabel="Open the player market"/);
  assert.match(roster, /OPEN MARKET/);
});

test('market rows expose both decision anchors and one duplicate-safe action', () => {
  assert.match(market, /currentGameCost/);
  assert.match(market, /priorSeasonValuePerGame/);
  assert.match(market, /LAST YEAR  —/);
  assert.match(market, /pendingActions\.has\(actionKey\)/);
  assert.match(market, /pendingActions\.has\('account-mutation'\)/);
  assert.match(market, /if \(disabled\) return/);
  assert.match(market, /row\.unavailableReason/);
  assert.match(market, /<FlatList/);
});

test('inverse language explains cash flow without stock-price claims', () => {
  assert.match(market, /Inverse P&amp;L is your locked game-cost credit minus the player's dividend/);
  assert.match(roster, /Each game credits your locked cost, then subtracts the player's dividend/);
  assert.doesNotMatch(market, /stock price|share gain|share loss/i);
});

test('settled games show arithmetic and visibly preserve corrections', () => {
  assert.match(results, /CORRECTION/);
  assert.match(results, /P&L adjustment/);
  assert.match(results, /locked game cost was not charged again/);
  assert.match(state, /Locked game cost/);
  assert.match(state, /Game cost credit/);
  assert.match(results, /does not reconcile/);
});

test('missing projections remain visibly unsettled without fabricated P&L', () => {
  assert.match(results, /UNSETTLED · missing saved pregame projection/);
  assert.match(results, /Net profit and loss unavailable/);
});

test('P&L chart anchors at zero and leaders use cumulative P&L', () => {
  assert.match(chart, /buildPnlSeries/);
  assert.match(chart, /pnlChartDomain/);
  assert.match(chart, /Your chart starts at \$0/);
  assert.match(leaders, /cumulativePnl/);
  assert.match(leaders, /Ranked by cumulative game P&amp;L from a \$0 starting score/);
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
  assert.match(market, /BLOCKED/);
  assert.match(market, /rosterLocked \? rosterLockHint : row\.unavailableReason \?\? undefined/);
});

test('ambient web layers use style-based pointer events without deprecated View props', () => {
  assert.doesNotMatch(app, /<View[^>]*pointerEvents=/);
  assert.match(app, /pointerEvents: 'none'/);
});
