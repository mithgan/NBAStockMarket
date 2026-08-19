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
  assert.match(source('../ui/primitives.tsx'), /minHeight: 44/);
});

test('manual replay advancement is admin-gated and requires explicit confirmation', () => {
  assert.match(seasonControlSource, /const \[confirmation, setConfirmation\]/);
  assert.match(seasonControlSource, /canAdvanceDay && nextGameDate !== null/);
  assert.match(seasonControlSource, /LAST SETTLED/);
  assert.match(seasonControlSource, /NEXT ·/);
  assert.match(seasonControlSource, /latestSettledDate/);
  assert.match(seasonControlSource, /accessibilityLabel="Refresh market data"/);
  assert.match(seasonControlSource, /onPress=\{\(\) => \{\s*refreshData\(\);\s*\}\}/);
  assert.match(seasonControlSource, /Advance the shared replay\?/);
  assert.match(seasonControlSource, /This settles .* for every play-tester/);
  assert.match(seasonControlSource, /accessibilityLabel="Cancel replay simulation"/);
  assert.match(seasonControlSource, /'Confirm replay advancement'/);
  assert.match(seasonControlSource, /confirmation && \(confirmation === 'rewind' \|\| confirmation === 'me' \|\| canSettleNextDay\) \?/);
  assert.match(seasonControlSource, /await advanceDay\(\)/);
  assert.match(seasonControlSource, /SIMULATE SEASON/);
  assert.match(seasonControlSource, /await advanceSeason\(\)/);
  assert.match(portfolioContextSource, /settleRemainingSeason/);
  assert.match(seasonControlSource, /Completed dates are saved/);
});

test('market discovery supports search and a clear empty result', () => {
  assert.match(marketSource, /TextInput/);
  assert.match(marketSource, /accessibilityLabel="Search players"/);
  assert.match(marketSource, /No players match/);
});

test('the market removes nonessential sparklines from narrow phone rows', () => {
  assert.match(marketSource, /useWindowDimensions/);
  assert.match(marketSource, /const compact = width < 420/);
  // Also dropped when text is enlarged, so the name and price keep their room.
  assert.match(marketSource, /showSparkline=\{!compact && !largeText\}/);
  assert.match(marketSource, /const largeText = fontScale > 1\.3/);
  assert.match(marketSource, /maxFontSizeMultiplier=\{MAX_ROW_FONT_SCALE\}/);
  assert.match(marketSource, /showSparkline && chartPoints\.length > 0 \? <Sparkline points=\{chartPoints\}/);
  assert.match(marketSource, /const chartPoints = selectTrendRange\(trendPoints, 'L15'\)/);
  // Recent form still reaches narrow rows as text even without the sparkline.
  assert.match(marketSource, /L\{form\.games\} \{formatSignedMetric\(form\.averageSurprise\)\} NP/);
});

test('the market only widens into extra columns when the table has room', () => {
  assert.match(marketSource, /const roomy = width >= 900/);
  assert.match(marketSource, /showOwnership=\{roomy\}/);
  assert.match(marketSource, /showOwnership \? \(/);
  assert.match(marketSource, /formatOwnership\(player\.ownership_bps\)/);
  // An explicit accessibilityLabel replaces descendant text, so a visible
  // ownership column must also be named in the row label.
  assert.match(marketSource, /showOwnership \? formatOwnership\(player\.ownership_bps\) : null/);
  // Tier is visible on every row, so it belongs in the explicit label too.
  assert.match(marketSource, /player\.tier\.toUpperCase\(\),/);
});

test('every compact figure in a play row keeps an exact spoken value', () => {
  assert.match(playsSource, /markedLabel=\{`Marked at \$\{formatSignedMoney\(markedPayout\)\}`\}/);
  assert.match(playsSource, /`Settled at \$\{formatSignedMoney\(boost\.payout\)\}`/);
  // The candidate row shows a compact price, so the exact one must be spoken.
  assert.match(playsSource, /Price \$\{formatMoney\(priceOf\(player\.id\)\)\}/);
  assert.match(playsSource, /Fee \$\{formatMoney\(fee\)\}/);
});

test('the populated market list carries its own heading, not just its empty state', () => {
  // Screen readers navigate by heading, and the header renders in every state,
  // so the heading must live in the always-present list header.
  const start = marketSource.indexOf('const listHeader = (');
  const end = marketSource.indexOf('const emptyState = (');
  assert.ok(start >= 0 && end > start, 'could not locate the market list header');
  const listHeaderBlock = marketSource.slice(start, end);
  assert.match(listHeaderBlock, /accessibilityRole="header"/);
  // Heading survives the short-viewport treatment, which only swaps its style.
  assert.match(listHeaderBlock, /shortViewport \? styles\.titleShort : styles\.title/);
  assert.match(listHeaderBlock, />\s*MARKET\s*</);
  // Search must stay reachable in the empty state so the query can be cleared.
  assert.match(listHeaderBlock, /accessibilityLabel="Search players"/);
});

test('the buyable filter excludes players an active instrument blocks', () => {
  assert.match(marketSource, /isBlocked: \(playerId\) =>/);
  assert.match(marketSource, /activeShortPlayerIds\.has\(playerId\) \|\| activeBoostPlayerIds\.has\(playerId\)/);
  const orderingSource = source('./marketOrdering.ts');
  assert.match(orderingSource, /const blocked = isBlocked \? isBlocked\(player\.id\) : false/);
  assert.match(orderingSource, /!held && !soldOut && !blocked && buyTotal <= freeCash/);
});

test('the market virtualizes its ~300 listings instead of mounting every row', () => {
  assert.match(marketSource, /<FlatList/);
  assert.match(marketSource, /keyExtractor=\{\(item\) => item\.player\.id\}/);
  assert.match(marketSource, /windowSize=/);
  assert.doesNotMatch(marketSource, /visiblePlayers\.map\(/);
  // A variable-height ListHeaderComponent makes fixed getItemLayout offsets wrong.
  assert.doesNotMatch(marketSource, /getItemLayout=/);
});

test('the market scrolls as one surface so short viewports can reach the rows', () => {
  // Pinned controls left a 844x390 landscape phone with zero reachable rows.
  assert.match(marketSource, /ListHeaderComponent=\{listHeader\}/);
  assert.match(marketSource, /ListEmptyComponent=\{emptyState\}/);
  assert.doesNotMatch(marketSource, /rows\.length === 0 \? \(/);
});

test('each empty market filter offers recovery that actually works', () => {
  assert.match(marketSource, /filter === 'held'/);
  assert.match(marketSource, /clear the Owned filter/);
  assert.match(marketSource, /Sell a player or clear the filter/);
  // A filtered-out but real match must not be reported as an unknown name.
  assert.match(marketSource, /const marketHasQueryMatch = trimmedQuery !== ''/);
  assert.match(marketSource, /No “\$\{trimmedQuery\}” result in this filter\./);
  // An unmatchable query is the blocker, so its advice outranks filter advice.
  assert.match(marketSource, /const searchIsTheBlocker = trimmedQuery !== '' && !marketHasQueryMatch/);
  assert.match(marketSource, /\{searchIsTheBlocker\s*\?\s*'Try a first name/);
});

test('the trade action column scales with text size instead of truncating', () => {
  // Bounded by the viewport so it cannot squeeze out the player name.
  assert.match(marketSource, /marketActionWidth\(fontScale, width\)/);
  assert.match(marketSource, /\{ width: actionWidth \}/);
  assert.doesNotMatch(marketSource, /tradeButton: \{\s*width: 76/);
});

test('fixed horizontal layouts give way to enlarged text everywhere they appear', () => {
  const leaderboardSource = source('../screens/LeaderboardScreen.tsx');
  // Leaderboard numeric columns size to content once type is enlarged.
  assert.match(leaderboardSource, /const largeText = fontScale > 1\.3/);
  assert.match(leaderboardSource, /largeText \? styles\.flexColumn : styles\.valueColumn/);
  assert.match(leaderboardSource, /largeText \? styles\.flexColumn : styles\.returnColumn/);
  // The replay controls wrap instead of crushing the status text.
  assert.match(seasonControlSource, /flexWrap: 'wrap'/);
  // The rank summary wraps its tags rather than pushing the rank off screen.
  assert.match(leaderboardSource, /heroMeta: \{[^}]*flexWrap: 'wrap'/);
  // Long trade statuses wrap into the taller large-text row instead of clipping.
  assert.match(marketSource, /numberOfLines=\{2\}\s*style=\{\[\s*styles\.tradeText/);
});

test('reduced motion reaches every animated affordance, native included', () => {
  const authSource = source('../auth/AuthScreen.tsx');
  const webStyles = source('../web/globalStyles.ts');
  // Web: one stylesheet kills transitions/animations globally.
  assert.match(webStyles, /prefers-reduced-motion: reduce/);
  // Native: the media query never runs, so each animated element opts out.
  assert.match(appSource, /reducedMotion\s*\?\s*<Text style=\{styles\.stateBusy\}/);
  assert.match(authSource, /reducedMotion/);
  assert.match(seasonControlSource, /animationType=\{reducedMotion \? 'none' : 'fade'\}/);
});

test('the market exposes explicit sort and filter controls with tab semantics', () => {
  const orderingSource = source('./marketOrdering.ts');
  assert.match(marketSource, /MARKET_SORTS/);
  assert.match(marketSource, /MARKET_FILTERS/);
  assert.match(source('../ui/primitives.tsx'), /aria-label=\{groupLabel\}/);
  assert.match(marketSource, /accessibilityRole="tab"/);
  assert.match(orderingSource, /export function buildMarketRows/);
  // Rows missing a metric must sort last rather than masquerading as zero.
  assert.match(orderingSource, /if \(left === null\) return 1/);
  assert.match(orderingSource, /if \(right === null\) return -1/);
});

test('market charts only receive results through the latest settled replay date', () => {
  assert.match(marketSource, /playerTrends\[player\.id\] \?\? \[\]/);
  assert.match(marketSource, /latestSettledDate=\{latestSettledDate\}/);
  assert.doesNotMatch(marketSource, /data\/trends/);
  assert.doesNotMatch(serverStateSource, /data\/replay/);
  assert.match(marketSource, /No settled games yet/);
});

test('player details resolve current server data and lead with the stream, not the price', () => {
  assert.match(marketSource, /const \[selectedPlayerId, setSelectedPlayerId\]/);
  assert.match(marketSource, /players\.find\(\(player\) => player\.id === selectedPlayerId\)/);
  assert.match(portfolioSource, /const \[detailPlayerId, setDetailPlayerId\]/);
  assert.match(portfolioSource, /playerById\.get\(detailPlayerId\)/);
  // Money-first: the quote's headline is what he has PAID; the price rides
  // underneath as the cost of the stream, never as the lead figure.
  assert.match(marketSource, /styles\.detailPaid, season\.total >= 0/);
  assert.match(marketSource, /PAID · SEASON/);
  assert.match(marketSource, /price \$\{formatCompactMoney\(currentPrice\)\}/);
  // The dead since-listing percentage (always 0.0% while prices cannot move)
  // must not return to the profile meta.
  assert.doesNotMatch(marketSource, /since listing/);
  assert.match(marketSource, /label="Pays per night"/);
  assert.match(marketSource, /label="Vs avg payer"/);
  assert.match(marketSource, /const rowAccessibilityLabel = \[/);
  assert.match(marketSource, /`Price \$\{formatMoney\(currentPrice\)\}`/);
  assert.match(marketSource, /accessibilityLabel=\{rowAccessibilityLabel\}/);
});

test('compact display money never hides the exact figure from assistive tech', () => {
  // Screens show $34.6M-style values but still announce the full number.
  for (const [name, contents] of [
    ['Portfolio', portfolioSource],
    ['Market', marketSource],
    ['Leaders', source('../screens/LeaderboardScreen.tsx')],
  ] as const) {
    assert.match(contents, /formatCompactMoney|formatCompactSignedMoney/, `${name} does not use compact money`);
    assert.match(contents, /accessibilityLabel=\{`?[^`]*\$\{formatMoney|accessibilityLabel=\{formatSignedMoney/, `${name} drops the exact figure`);
  }
  assert.doesNotMatch(portfolioSource, /style=\{styles\.total\}>\s*\{formatMoney\(/);
});

test('every compacted money Stat on the player detail carries its exact value', () => {
  // A screen-level "has at least one exact label" check passes while individual
  // figures stay abbreviated, so each money Stat is asserted on its own.
  const moneyStats = [
    ['Current price', 'formatMoney\\(currentPrice\\)'],
    ['Opening price', 'formatMoney\\(player\\.listing_price\\)'],
    ['Actual salary', 'formatMoney\\(player\\.actual_salary\\)'],
    [
      'Best settled payout',
      'bestPoint \\? `\\$\\{formatSignedMoney\\(bestPayout\\)\\} on \\$\\{bestPoint\\.date\\}` : formatSignedMoney\\(bestPayout\\)',
    ],
  ] as const;

  for (const [label, exact] of moneyStats) {
    assert.match(
      marketSource,
      new RegExp(`exact=\\{${exact}\\}\\s*label="${label}"`),
      `${label} is announced only in compact form`,
    );
  }
  assert.match(marketSource, /exact \? `\$\{label\}, \$\{exact\}` : undefined/);
  // The stream headline and its rate line are compacted too, so both carry
  // the exact figure for assistive tech.
  assert.match(marketSource, /accessibilityLabel=\{`Paid holders \$\{formatSignedMoney\(season\.total\)\}/);
  assert.match(marketSource, /\$\{formatSignedMoney\(season\.perGame \?\? 0\)\} per night/);
});

test('the reduced-motion listener survives browsers with only the legacy API', () => {
  const hookSource = source('../hooks/useReducedMotion.ts');
  assert.match(hookSource, /typeof query\.addEventListener === 'function'/);
  assert.match(hookSource, /typeof query\.addListener === 'function'/);
  assert.match(hookSource, /query\.removeListener\(onChange\)/);
});

test('shared submit state never claims a specific action is running', () => {
  const authSource = source('../auth/AuthScreen.tsx');
  // isSubmitting is shared by sign-in, Google and CREATE ACCOUNT.
  assert.doesNotMatch(authSource, /SIGNING IN/);
  assert.match(authSource, /WORKING…/);
});

test('player details and trade actions are sibling controls instead of nested buttons', () => {
  assert.match(marketSource, /return \(\s*<View\s+style=\{\[/);
  assert.match(marketSource, /styles\.playerDetails/);
});

test('market trades use the account mutation lock and expose pending feedback', () => {
  assert.match(marketSource, /pendingActions\.has\('account-mutation'\)/);
  assert.match(marketSource, /const disabled = shorted \|\| boosted \|\| soldOut \|\| unaffordable \|\| locked/);
  assert.match(marketSource, /if \(pending\) return;/);
  assert.match(marketSource, /pending\s*\?\s*'WAIT'/);
  assert.match(marketSource, /locked\s*\?\s*'BUSY'/);
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
  assert.match(marketSource, /shorted=\{activeShortPlayerIds\.has\(item\.player\.id\)\}/);
  assert.match(marketSource, /shorted \|\| boosted \|\| soldOut \|\| unaffordable \|\| locked/);
  assert.match(marketSource, /SHORTED/);
  assert.match(marketSource, /keyboardShouldPersistTaps="handled"/);
});

test('market prevents selling the holding required by an armed boost', () => {
  assert.match(marketSource, /boost\.status === 'armed'/);
  assert.match(marketSource, /boosted=\{activeBoostPlayerIds\.has\(item\.player\.id\)\}/);
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
  assert.match(source('../ui/primitives.tsx'), /accessibilityRole="button"/);
  assert.doesNotMatch(playsSource, /price short/i);
});

test('weekly play eligibility, dates, and fees come only from server targets', () => {
  assert.match(playsSource, /weeklyShortTargets\.flatMap/);
  assert.match(playsSource, /boostTargets\.flatMap/);
  assert.match(playsSource, /fee \{formatCompactMoney\(fee\)\}/);
  // The exact fee still has to reach screen readers even though the row is compact.
  assert.match(playsSource, /fee \$\{formatMoney\(fee\)\}/);
  assert.match(playsSource, /armPlayerBoost\(player, gameDate\)/);
  assert.doesNotMatch(playsSource, /nextPlayerGame|nextEventForPlayer/);
});

test('portfolio provides server-backed activity, history, and exact cost basis', () => {
  // History renders as the always-on chart; activity groups under its heading.
  assert.match(portfolioSource, /<PortfolioHistoryChart/);
  assert.match(portfolioSource, />Recent activity</);
  assert.match(portfolioSource, /holding\.costBasis/);
  assert.match(portfolioSource, /holding\.unrealizedPnl/);
  assert.match(portfolioSource, /No server settlement has reached this account yet/);
  assert.match(
    portfolioSource,
    /Settled \$\{latestPoint\.date\}\. Includes cash payouts and player-price movement\./,
  );
  assert.doesNotMatch(portfolioSource, /Cash dividends, boosts, short settlements, and refunds/);
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
  assert.match(appSource, /const authError = auth\?\.error \?\? null/);
  assert.match(appSource, /message=\{authError\}/);
});

test('server and transition failures lock every gameplay surface until recovery', () => {
  assert.match(appSource, /if \(isLoading\) \{/);
  assert.doesNotMatch(appSource, /if \(isRefreshing\) \{/);
  assert.match(appSource, /if \(transitionRequired\)/);
  assert.match(appSource, /if \(serverError \|\| !state\)/);
  assert.match(appSource, /const ready = Boolean\(/);
  assert.match(appSource, /\{ready \? <SeasonControl/);
  assert.match(appSource, /\{ready \? \(wide \? null : renderTabBar\('bottom'\)\) : null\}/);
  assert.doesNotMatch(
    appSource.match(/const ready = Boolean\([\s\S]*?\);/)?.[0] ?? '',
    /isRefreshing/,
  );
  assert.match(seasonControlSource, /!isGameplayReady \|\| isRefreshing \|\| pendingActions\.size > 0/);
  assert.match(portfolioContextSource, /&& !isRefreshing/);
  assert.match(portfolioContextSource, /acquire\('account-refresh'\)/);
  assert.match(portfolioContextSource, /has\('account-refresh'\)/);
  assert.match(portfolioContextSource, /setServerError\(errorMessage\(error\)\)/);
  assert.match(
    portfolioContextSource,
    /reconciliationReason === 'confirmed-global'\s*\?\s*'blocking'/,
  );
  assert.match(
    portfolioContextSource,
    /bootstrapRef\.current\s*\?\s*'nonblocking'\s*:\s*'blocking'/,
  );
  assert.match(portfolioContextSource, /setMessage\(null\)/);
});

test('major screens and sections expose heading navigation to assistive technology', () => {
  // SectionHeader carries accessibilityRole="header", so a screen satisfies this
  // either directly or by composing it.
  assert.match(source('../ui/primitives.tsx'), /accessibilityRole="header"/);
  for (const [name, contents] of [
    ['Portfolio', portfolioSource],
    ['Market', marketSource],
    ['Plays', playsSource],
    ['Leaders', source('../screens/LeaderboardScreen.tsx')],
  ] as const) {
    assert.match(
      contents,
      /accessibilityRole="header"|<SectionHeader/,
      `${name} has no accessible heading`,
    );
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
