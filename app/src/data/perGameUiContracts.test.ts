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
  // The name starts with the visible words (WCAG 2.5.3, walk 3 T3-01).
  assert.match(roster, /accessibilityLabel="Open market: browse players to add"/);
  assert.match(roster, /open market/i);
});

test('market rows expose both decision anchors and one duplicate-safe action', () => {
  assert.match(market, /currentGameCost/);
  assert.match(market, /priorSeasonValuePerGame/);
  assert.match(market, /priorSeasonValuePerGame === null/);
  assert.match(market, /pendingActions\.has\(actionKey\)/);
  // One move at a time is the context's queue now: a row does not rest while
  // another move saves, its press waits its turn (walk 5 T4-01).
  assert.match(context, /const queueMove = useCallback/);
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
  // Each fee row says who, what and the fee: "Dyson Daniels, short opened, fee $250" (walk 3 T3-32).
  assert.match(results, /moveWords\(playerName, feeExplanation\(entry, side\), entry\.amountDollars/);
});

test('server roster locks are visible and disable every mutation control accessibly', () => {
  assert.match(status, /ROSTER LOCKED/);
  assert.match(status, /rules\.rosterLockGameDate/);
  assert.match(status, /Roster changes are locked/);
  assert.match(market, /bootstrap\?\.ruleset\.rosterMutationsLocked \?\? true/);
  // A server roster lock still disables every move; another move saving no
  // longer does (moves wait their turn in the context's queue, walk 5 T4-01).
  assert.match(market, /pending \|\| rosterLocked/);
  assert.match(market, /accessibilityHint=\{rosterLocked/);
  assert.match(market, /accessibilityState=\{\{ disabled \}\}/);
  assert.match(roster, /bootstrap\?\.ruleset\.rosterMutationsLocked \?\? true/);
  assert.match(roster, /pending \|\| rosterLocked/);
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

test('at season end the Roster says "The season is over" once: its empty sections add nothing to it (walk 15 lead)', () => {
  assert.match(roster, /seasonOver \? 'The season is over\. Your roster is final\.'/);
  assert.equal((roster.match(/The season is over/g) ?? []).length, 1, 'only the roster line says it');
  assert.match(roster, /title=\{hadShorts \? 'No open shorts' : seasonOver \? 'No shorts this season'/);
});

test('a landscape phone keeps its folded status to two lines on a locked night (walk 15 lead)', async () => {
  const { FOLDED_LOCK_WORDS_MIN_WIDTH, FOLDED_LOCK_WORDS_MIN_WIDTH_NOBODY, lockShortText, noGamesWords } = await import('./chromeView');
  // Measured: "Moves reopen after Oct 28" fits beside a held week's figure from 700px and beside "nobody on your roster" from 800px.
  assert.equal(FOLDED_LOCK_WORDS_MIN_WIDTH, 700);
  assert.equal(FOLDED_LOCK_WORDS_MIN_WIDTH_NOBODY, 800);
  assert.equal(lockShortText('2026-10-28'), 'Locked · Oct 28');
  assert.equal(noGamesWords(true, true), ': nobody on your roster');
  assert.match(status, /const foldedLockNight = foldedFacts && locked && !!lockDate && lockDate === nextGameDate && !progress\?\.complete;/);
  // "Next Tue, Oct 28" gives way to the lock, which names the same night (+1 night shows it too).
  assert.match(status, /\) : foldedLockNight \? null : \(\s*<Text key="next"/);
  // "No players yet" never sits beside "nobody on your roster".
  assert.match(status, /!\(foldedFacts && noGames && span\?\.nobody\)/);
  assert.match(status, /lockCompact \|\| lockShortInRow\) \? \(/);
});

test('the notice strip waits for a tapping finger, holds once opened, and its skip link lands on its words (walk 16 T1-11, T1-15, T3-09)', () => {
  assert.match(app, /const DOCK_TAP_PAUSE_MS = 1500;/);
  assert.match(app, /const dockWaits = useTapPause\(noticePlacement === 'dock' && Boolean\(message\), noticeSeq, DOCK_TAP_PAUSE_MS\);/);
  assert.match(app, /!\(noticePlacement === 'dock' && dockWaits\)/);
  assert.match(app, /installScreenTaps\(\);/);
  // Opened with "more ▾", a success waits for the player; "less ▴" lets the bar fold back.
  assert.match(app, /if \(tone !== 'success' \|\| held \|\| keep \|\| expanded \|\| \(tinyDock && overflowing\)\) return undefined;/);
  assert.match(app, /if \(expanded\) onFold\?\.\(\);/);
  assert.match(app, /const foldBar = useCallback\(\(\) => setBarHold\(0\), \[\]\);/);
  // The skip link reads the notice itself.
  assert.match(app, /\(words \?\? first \?\? box\)\.focus\?\.\(\);/);
  assert.match(app, /nativeID: LATEST_NOTICE_WORDS_ID,\s+tabIndex: tinyDock \? 0 : -1,/);
});

test('loading draws its spinner silently, and the frame waits for its face before drawing the lockup (walk 16 T3-06, T1-03, T2-07)', () => {
  assert.match(app, /<View accessibilityElementsHidden aria-hidden importantForAccessibility="no-hide-descendants">\s+\{reducedMotion/);
  assert.match(app, /style=\{\[styles\.product, !fontReady && styles\.waitingForFont\]\}>STOCK MARKET</);
  assert.match(app, /<View style=\{!fontReady && styles\.waitingForFont\}>\s+<SettingsButton/);
  assert.match(app, /stateTitle: \{\s+fontFamily: fonts\.display,/);
});

test('loading is one look: the app draws the page shell\'s lockup, value for value, until it is ready (walk 17 T1-12)', () => {
  const shell = readFileSync(resolve(import.meta.dirname, '../../public/index.html'), 'utf8');
  const cssValue = (selector: string, property: string) => {
    const block = shell.slice(shell.indexOf(selector), shell.indexOf('}', shell.indexOf(selector)));
    return new RegExp(`${property}:\\s*([^;]+);`).exec(block)?.[1]?.trim();
  };
  // The early return, before the frame, while the season or the brand face loads.
  assert.match(app, /if \(isLoading \|\| !fontReady\) \{\s+const reload = slowStart/);
  assert.match(app, /return isMockActive\(\) \? \(\s+<LoadingLook/);
  // Sizes kept in step with the shell's CSS.
  assert.equal(cssValue('#shell-loading .shell-word', 'font-size'), '22px');
  assert.match(app, /loadingWord: \{[\s\S]*?fontSize: 22,/);
  assert.equal(cssValue('#shell-loading .shell-product', 'font-size'), '12px');
  assert.match(app, /loadingProduct: \{[\s\S]*?fontSize: 12,/);
  assert.equal(cssValue('#shell-loading .shell-mark', 'width'), '32px');
  assert.match(app, /const LOADING_MARK_SIZE = 32;/);
  assert.equal(cssValue('#shell-loading .shell-note', 'font-size'), '14px');
  assert.match(app, /loadingNote: \{[\s\S]*?fontSize: 14,/);
  // Centred in the same box: the shell clears the browser's 8px body margin
  // itself (the app's reset only runs once the app does), with the same gap
  // and padding, so the lockup never moves when the app takes over.
  assert.match(shell, /body \{\s+overflow: hidden;[^}]*margin: 0;/);
  assert.equal(cssValue('#shell-loading {', 'gap'), '14px');
  assert.equal(cssValue('#shell-loading {', 'padding'), '24px');
  assert.match(app, /loadingLook: \{\s+flex: 1,\s+alignItems: 'center',\s+justifyContent: 'center',\s+gap: 14,\s+padding: 24,/);
});

test('clamped notice lines end on "…" before "more ▾", and still know the rest is there (walk 17 T4-02, walk 18 T3-03)', () => {
  // Two lines, and the 400% strip's one line unless the keyboard is scrolling it.
  assert.match(app, /numberOfLines=\{clampLines > 0 && !expanded && !\(tinyDock && held\) \? clampLines : undefined\}/);
  // Overflow is read from the text's full scroll height (two lines) or width (one unwrapped line), clamped or not.
  assert.match(app, /setOverflowing\(node\.scrollHeight > TINY_NOTICE_LINE \* clampLines \+ 2 \|\| node\.scrollWidth > node\.clientWidth \+ 1\);/);
  assert.doesNotMatch(app, /onContentSizeChange=\{\(_contentWidth, contentHeight\) => \{\s+if \(clampLines < 2\)/);
  // The skip link lands on words with a role that takes their name.
  assert.match(app, /role: 'note',\s+'aria-label': `Notice: \$\{shown\}`,/);
});

test('opening a FULL note keeps the latest notice: the adds that filled the roster stay confirmed (walk 18 T4-01)', () => {
  // Notices sit in the brand bar or the strip above the tabs, never over a
  // row's note, so the note has no reason to take the last notice down.
  assert.doesNotMatch(market, /dismissNotice/);
  assert.match(market, /const toggleNote = repeatSafe\(\(\) => \{\s+setNoting\(\(open\) => !open\);\s+\}\);/);
});

test('the loading line says what is starting, the same before and after the app runs (walk 18 T2-07)', () => {
  const shell = readFileSync(resolve(import.meta.dirname, '../../public/index.html'), 'utf8');
  // The shell reads the words a restart left, else "Starting practice" on ?mock.
  assert.match(shell, /window\.sessionStorage\.getItem\('nba-stock-market:start-words'\)/);
  assert.match(shell, /if \(keys\.indexOf\('mock'\) !== -1\) words = 'Starting practice';/);
  // The app's loading look takes the same words, once.
  assert.match(app, /title=\{practiceStartWords\}/);
  const session = source('../web/practiceSession.ts');
  assert.match(session, /const START_WORDS_KEY = 'nba-stock-market:start-words';/);
  assert.match(session, /const FIRST_START_WORDS = 'Starting practice';/);
});
