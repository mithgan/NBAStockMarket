import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(resolve(testDirectory, '../../App.tsx'), 'utf8');
const marketSource = readFileSync(resolve(testDirectory, '../screens/MarketScreen.tsx'), 'utf8');

test('tab pills use their exact equal-width 44px Pressable bounds', () => {
  assert.doesNotMatch(appSource, /hitSlop=/);
  // Formatting-agnostic: equal-width tabs with a 44px minimum.
  assert.match(appSource, /tab: \{\s*flex: 1,\s*minWidth: 0,\s*minHeight: 44,/);
  assert.match(appSource, /style=\{\(\{ pressed \}\) => \[styles\.tab, pressed && styles\.pressed\]\}/);
  assert.match(
    appSource,
    /\[styles\.tabMarker, position === 'top' && styles\.tabMarkerBottomEdge, active && styles\.tabMarkerActive\]/,
  );
});

test('market actions expose concise player-specific button labels', () => {
  assert.match(marketSource, /const rowAccessibilityLabel = \[/);
  assert.match(marketSource, /`View \$\{player\.name\} details`/);
  assert.match(marketSource, /accessibilityLabel=\{rowAccessibilityLabel\}/);
  assert.match(marketSource, /\? `Sell \$\{player\.name\}`/);
  assert.match(marketSource, /\? `\$\{player\.name\} is sold out`/);
  assert.match(marketSource, /: `Buy \$\{player\.name\} for \$\{formatMoney\(buyTotal\)\} including fee`/);
  assert.match(marketSource, /accessibilityLabel=\{`Close \$\{player\.name\} details`\}/);
  assert.match(marketSource, /option === 'Season' \? 'Full season' : `Last \$\{option\.slice\(1\)\} games`/);
});

test('leaderboard rows use stable account identities instead of display names', () => {
  const leaderboardSource = readFileSync(resolve(testDirectory, '../screens/LeaderboardScreen.tsx'), 'utf8');
  assert.match(leaderboardSource, /key=\{entry\.id\}/);
  assert.doesNotMatch(leaderboardSource, /key=\{entry\.name\}/);
});

test('detail dividend chart follows the selected range and renders labeled extrema', () => {
  assert.match(marketSource, /const visiblePoints = selectTrendRange\(points, range\)/);
  // The idle readout pairs the window total with its exposure, so the two
  // zoom levels of the same stream sit on one line.
  assert.match(marketSource, /across \$\{points\.length\} \$\{points\.length === 1 \? 'game' : 'games'\}/);
  assert.match(marketSource, /\['L5', 'L15', 'L30', 'Season'\]/);
  assert.match(marketSource, /<Path d=\{linePath\}/);
  assert.match(marketSource, /\['HIGH', extrema\.high\]/);
  assert.match(marketSource, /\['LOW', extrema\.low\]/);
});

test('market cash value stays on one line and its block never gets squeezed', () => {
  assert.match(marketSource, /numberOfLines=\{1\}\s*style=\{styles\.cashValue\}/);
  assert.match(marketSource, /cashBlock: \{[^}]*flexShrink: 0/);
  assert.match(marketSource, /accessibilityLabel=\{`Free cash \$\{formatMoney\(freeCash\)\}`\}/);
});

test('interface radii stay flat and no type drops below 11px', () => {
  const themeSource = readFileSync(resolve(testDirectory, '../theme.ts'), 'utf8');
  assert.match(themeSource, /lg: 8/);
  assert.match(themeSource, /label: 11/);

  const screens = [
    ['Primitives', readFileSync(resolve(testDirectory, '../ui/primitives.tsx'), 'utf8')],
    ['App', appSource],
    ['Market', marketSource],
    ['Portfolio', readFileSync(resolve(testDirectory, '../screens/PortfolioScreen.tsx'), 'utf8')],
    ['Plays', readFileSync(resolve(testDirectory, '../screens/PlaysScreen.tsx'), 'utf8')],
    ['Leaders', readFileSync(resolve(testDirectory, '../screens/LeaderboardScreen.tsx'), 'utf8')],
    ['Season control', readFileSync(resolve(testDirectory, '../components/SeasonControl.tsx'), 'utf8')],
    // The signed-out screen is the first thing every user reads, so it is held
    // to the same minimum as the authenticated surfaces.
    ['Auth', readFileSync(resolve(testDirectory, '../auth/AuthScreen.tsx'), 'utf8')],
    ['Portfolio chart', readFileSync(resolve(testDirectory, '../components/PortfolioHistoryChart.tsx'), 'utf8')],
  ] as const;

  for (const [name, contents] of screens) {
    for (const match of contents.matchAll(/borderRadius: (\d+)/g)) {
      assert.ok(Number(match[1]) <= 8, `${name} uses a ${match[1]}px radius`);
    }
    for (const match of contents.matchAll(/fontSize: (\d+)/g)) {
      assert.ok(Number(match[1]) >= 11, `${name} uses a ${match[1]}px font size`);
    }
  }
});
