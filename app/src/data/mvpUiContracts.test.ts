import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const source = (relativePath: string) => {
  const path = resolve(testDirectory, relativePath);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
};

const appSource = source('../../App.tsx');
const portfolioContextSource = source('../state/PortfolioContext.tsx');
const portfolioSource = source('../screens/PortfolioScreen.tsx');
const marketSource = source('../screens/MarketScreen.tsx');
const playsSource = source('../screens/PlaysScreen.tsx');
const seasonControlSource = source('../components/SeasonControl.tsx');
const portfolioChartSource = source('../components/PortfolioHistoryChart.tsx');

test('the MVP exposes four stable primary workflows and an always-visible season control', () => {
  assert.match(appSource, /Portfolio/);
  assert.match(appSource, /Market/);
  assert.match(appSource, /Plays/);
  assert.match(appSource, /Leaders/);
  assert.match(appSource, /<SeasonControl/);
  assert.match(seasonControlSource, /accessibilityLabel=/);
  assert.match(seasonControlSource, /accessibilityState=\{\{ disabled \}\}/);
  assert.match(seasonControlSource, /minHeight: 44/);
});

test('market discovery supports search and a clear empty result', () => {
  assert.match(marketSource, /TextInput/);
  assert.match(marketSource, /accessibilityLabel="Search players"/);
  assert.match(marketSource, /No players match/);
});

test('the market removes nonessential sparklines from narrow phone rows', () => {
  assert.match(marketSource, /useWindowDimensions/);
  assert.match(marketSource, /const compact = width < 360/);
  assert.match(marketSource, /compact \|\| trendPoints\.length === 0 \? null : <Sparkline/);
});

test('market charts only receive results through the latest settled replay date', () => {
  assert.match(marketSource, /selectSettledTrendPoints\(playerTrends\[player\.id\] \?\? \[\], latestSettledDate\)/);
  assert.match(marketSource, /latestSettledDate=\{latestSettledDate\}/);
  assert.match(marketSource, /No settled games yet/);
});

test('player details and trade actions are sibling controls instead of nested buttons', () => {
  assert.match(marketSource, /return \(\s*<View\s+style=\{\[/);
  assert.match(marketSource, /styles\.playerDetails/);
});

test('market trades lock briefly so repeated taps cannot buy then immediately sell', () => {
  assert.match(marketSource, /const \[tradeLocked, setTradeLocked\] = useState\(false\)/);
  assert.match(marketSource, /if \(tradeLocked\) return/);
  assert.match(marketSource, /setTimeout\(\(\) => \{/);
  assert.match(marketSource, /tradeLocked \? \(/);
});

test('market prevents buying an actively shorted player and preserves native search taps', () => {
  assert.match(marketSource, /position\.status === 'active'/);
  assert.match(marketSource, /shorted=\{activeShortPlayerIds\.has\(player\.id\)\}/);
  assert.match(marketSource, /shorted \|\| boosted \|\| unaffordable \|\| tradeLocked/);
  assert.match(marketSource, /SHORTED/);
  assert.match(marketSource, /keyboardShouldPersistTaps="handled"/);
});

test('market prevents selling the holding required by an armed boost', () => {
  assert.match(marketSource, /boost\.status === 'armed'/);
  assert.match(marketSource, /boosted=\{activeBoostPlayerIds\.has\(player\.id\)\}/);
  assert.match(marketSource, /shorted \|\| boosted \|\| unaffordable \|\| tradeLocked/);
  assert.match(marketSource, /BOOSTED/);
});

test('player chart ranges expose tab semantics and selected state', () => {
  assert.match(marketSource, /accessibilityRole="tab"/);
  assert.match(marketSource, /accessibilityState=\{\{ selected \}\}/);
  assert.match(marketSource, /aria-selected=\{selected\}/);
  assert.match(appSource, /aria-selected=\{active\}/);
});

test('instrument UI explains finite weekly slots and never exposes price shorts', () => {
  assert.match(playsSource, /Weekly shorts/);
  assert.match(playsSource, /3/);
  assert.match(playsSource, /Boosts/);
  assert.match(playsSource, /2/);
  assert.match(playsSource, /accessibilityRole="button"/);
  assert.doesNotMatch(playsSource, /price short/i);
});

test('armed weekly plays remain in place as disabled controls after selection', () => {
  assert.match(playsSource, /selected \|\| activeShorts\.length >= WEEKLY_SHORT_SLOTS/);
  assert.match(playsSource, /selected \? 'ARMED' : 'SHORT'/);
  assert.match(playsSource, /boost\.status === 'armed'/);
  assert.match(playsSource, /selected \|\| usedBoosts\.length >= BOOST_SLOTS/);
  assert.match(playsSource, /selected \? 'ARMED' : 'BOOST'/);
});

test('portfolio provides visible activity, history, and confirmed reset', () => {
  assert.match(portfolioSource, /Portfolio history/);
  assert.match(portfolioSource, /Activity/);
  assert.match(portfolioSource, /holding\.costBasis/);
  assert.match(portfolioSource, /incl\. fee/);
  assert.match(portfolioSource, /holding\.unrealizedPnl/);
  assert.match(portfolioSource, /Alert\.alert/);
  assert.match(portfolioSource, /Reset progress/);
});

test('global notices can dismiss both action messages and persistence warnings', () => {
  assert.match(appSource, /dismissNotice/);
  assert.match(appSource, /dismissNotice\('persistence'\)/);
  assert.match(appSource, /dismissNotice\('message'\)/);
  assert.match(appSource, /\{persistenceError \? \(/);
  assert.match(appSource, /\{message \? \(/);
});

test('a persistence read failure locks gameplay until a durable reset succeeds', () => {
  assert.match(appSource, /!isGameplayReady && tab\.key !== 'portfolio'/);
  assert.match(seasonControlSource, /!isGameplayReady \|\| isAdvancing/);
  assert.match(portfolioSource, /Reset progress/);
  assert.match(portfolioSource, /disabled=\{isResetting\}/);
  assert.match(portfolioSource, /Saving is paused/);
  assert.match(portfolioSource, /RESET AND CONTINUE/);
  assert.match(portfolioSource, /isPersistenceBlocked \? \(/);
  assert.match(
    portfolioSource,
    /persistenceError \?\? 'Progress cannot be saved right now\. Reset progress to resume\.'/,
  );
  assert.match(portfolioContextSource, /setMessage\(null\)/);
});

test('major screens and sections expose heading navigation to assistive technology', () => {
  for (const [name, contents] of [
    ['Portfolio', portfolioSource],
    ['Market', marketSource],
    ['Plays', playsSource],
    ['Leaders', source('../screens/LeaderboardScreen.tsx')],
  ] as const) {
    assert.match(contents, /accessibilityRole="header"/, `${name} has no accessible heading`);
  }
});

test('the empty portfolio chart measures its width before the first replay point arrives', () => {
  assert.match(
    portfolioChartSource,
    /if \(visible\.length === 0\) \{\s*return \(\s*<View\s+onLayout=/,
  );
});

test('touched MVP screens avoid negative letter spacing', () => {
  for (const [name, contents] of [
    ['App', appSource],
    ['Portfolio', portfolioSource],
    ['Market', marketSource],
    ['Plays', playsSource],
    ['Season control', seasonControlSource],
  ] as const) {
    assert.doesNotMatch(contents, /letterSpacing:\s*-/i, `${name} uses negative letter spacing`);
  }
});
