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
  assert.match(appSource, /tab: \{ flex: 1, minWidth: 0, minHeight: 44,/);
  assert.match(appSource, /style=\{\(\{ pressed \}\) => \[styles\.tab, active && styles\.activeTab/);
});

test('market actions expose concise player-specific button labels', () => {
  assert.match(marketSource, /accessibilityLabel=\{`View \$\{player\.name\} details`\}/);
  assert.match(marketSource, /accessibilityLabel=\{held \? `Sell \$\{player\.name\}` : `Buy \$\{player\.name\} for \$\{formatMoney\(currentPrice\)\} plus fee`\}/);
  assert.match(marketSource, /accessibilityLabel=\{`Close \$\{player\.name\} details`\}/);
  assert.match(marketSource, /option === 'Season' \? 'Full season' : `Last \$\{option\.slice\(1\)\} games`/);
});

test('detail dividend chart follows the selected range and renders labeled extrema', () => {
  assert.match(marketSource, /const rangeTotal = visiblePoints\.reduce/);
  assert.match(marketSource, /range === 'Season' \? 'Settled season'/);
  assert.match(marketSource, /\['L5', 'L15', 'Season'\]/);
  assert.match(marketSource, /<Path d=\{linePath\}/);
  assert.match(marketSource, /\['HIGH', extrema\.high\]/);
  assert.match(marketSource, /\['LOW', extrema\.low\]/);
});

test('market cash value is single-line, shrinkable, and its pill sizes to content', () => {
  assert.match(marketSource, /adjustsFontSizeToFit minimumFontScale=\{0\.8\} numberOfLines=\{1\} style=\{styles\.cashValue\}/);
  assert.match(marketSource, /cashPill: \{[^}]*flexShrink: 0/);
});
