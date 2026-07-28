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
const serverStateSource = source('../state/serverState.ts');
const authContextSource = source('../auth/AuthContext.tsx');

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
  assert.match(marketSource, /playerTrends\[player\.id\] \?\? \[\]/);
  assert.match(marketSource, /latestSettledDate=\{latestSettledDate\}/);
  assert.doesNotMatch(marketSource, /data\/trends/);
  assert.doesNotMatch(serverStateSource, /data\/replay/);
  assert.match(marketSource, /No settled games yet/);
});

test('player details and trade actions are sibling controls instead of nested buttons', () => {
  assert.match(marketSource, /return \(\s*<View\s+style=\{\[/);
  assert.match(marketSource, /styles\.playerDetails/);
});

test('market trades use the account mutation lock and expose pending feedback', () => {
  assert.match(marketSource, /pendingActions\.has\('account-mutation'\)/);
  assert.match(marketSource, /const disabled = shorted \|\| boosted \|\| soldOut \|\| unaffordable \|\| locked/);
  assert.match(marketSource, /pending \? \(/);
  assert.match(marketSource, />WAIT</);
  assert.match(portfolioContextSource, /acquire\('account-mutation'\)/);
  assert.match(portfolioContextSource, /acquire\(key\)/);
});

test('market honors authoritative sold-out listings before a buy attempt', () => {
  assert.match(marketSource, /player\.available_shares === 0/);
  assert.match(marketSource, /SOLD OUT/);
  assert.match(marketSource, /No shares are currently available/);
  assert.match(serverStateSource, /available_shares: listing\.available_shares/);
});

test('market affordability uses the authoritative account-specific buy fee', () => {
  assert.match(serverStateSource, /buy_fee: dollars\(listing\.buy_fee_cents\)/);
  assert.match(marketSource, /const buyTotal = currentPrice \+ \(player\.buy_fee \?\? 0\)/);
  assert.doesNotMatch(marketSource, /FEE_PCT/);
});

test('market prevents buying an actively shorted player and preserves native search taps', () => {
  assert.match(marketSource, /position\.status === 'active'/);
  assert.match(marketSource, /shorted=\{activeShortPlayerIds\.has\(player\.id\)\}/);
  assert.match(marketSource, /shorted \|\| boosted \|\| soldOut \|\| unaffordable \|\| locked/);
  assert.match(marketSource, /SHORTED/);
  assert.match(marketSource, /keyboardShouldPersistTaps="handled"/);
});

test('market prevents selling the holding required by an armed boost', () => {
  assert.match(marketSource, /boost\.status === 'armed'/);
  assert.match(marketSource, /boosted=\{activeBoostPlayerIds\.has\(player\.id\)\}/);
  assert.match(marketSource, /shorted \|\| boosted \|\| soldOut \|\| unaffordable \|\| locked/);
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

test('weekly play eligibility, dates, and fees come only from server targets', () => {
  assert.match(playsSource, /weeklyShortTargets\.flatMap/);
  assert.match(playsSource, /boostTargets\.flatMap/);
  assert.match(playsSource, /fee \{formatMoney\(fee\)\}/);
  assert.match(playsSource, /armPlayerBoost\(player, gameDate\)/);
  assert.doesNotMatch(playsSource, /nextPlayerGame|nextEventForPlayer/);
});

test('portfolio provides server-backed activity, history, and exact cost basis', () => {
  assert.match(portfolioSource, /Portfolio history/);
  assert.match(portfolioSource, /Activity/);
  assert.match(portfolioSource, /holding\.costBasis/);
  assert.match(portfolioSource, /incl\. fee/);
  assert.match(portfolioSource, /holding\.unrealizedPnl/);
  assert.match(portfolioSource, /No server settlement has reached this account yet/);
  assert.doesNotMatch(portfolioSource, /Reset progress|Alert\.alert/);
});

test('global server action notices are visible and dismissible', () => {
  assert.match(appSource, /dismissNotice/);
  assert.match(appSource, /message \? \(/);
  assert.match(appSource, /message=\{message\}/);
  assert.match(appSource, /accessibilityLiveRegion="polite"/);
});

test('ordinary sign out only revokes the current device session', () => {
  assert.match(authContextSource, /signOut\(\{ scope: 'local' \}\)/);
  assert.doesNotMatch(authContextSource, /auth\.signOut\(\)/);
  assert.match(appSource, /error: authError/);
  assert.match(appSource, /message=\{authError\}/);
});

test('server and transition failures lock every gameplay surface until recovery', () => {
  assert.match(appSource, /if \(isLoading\) \{/);
  assert.match(appSource, /if \(isRefreshing\) \{/);
  assert.match(appSource, /if \(transitionRequired\)/);
  assert.match(appSource, /if \(serverError \|\| !state\)/);
  assert.match(appSource, /\{isGameplayReady \? <SeasonControl/);
  assert.match(appSource, /\{isGameplayReady \? \(/);
  assert.match(seasonControlSource, /!isGameplayReady \|\| isRefreshing \|\| pendingActions\.size > 0/);
  assert.match(portfolioContextSource, /&& !isRefreshing/);
  assert.match(portfolioContextSource, /acquire\('account-refresh'\)/);
  assert.match(portfolioContextSource, /has\('account-refresh'\)/);
  assert.match(portfolioContextSource, /setServerError\(errorMessage\(error\)\)/);
  assert.match(portfolioContextSource, /let tradeCommitted = false/);
  assert.match(portfolioContextSource, /tradeCommitted \|\| mutationFailureMayHaveCommitted\(error\)/);
  assert.match(portfolioContextSource, /Your trade completed/);
  assert.match(portfolioContextSource, /Your trade may have completed/);
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
